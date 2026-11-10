/**
 * Stream Monitor: the form and the session data of one stream (#171).
 *
 * The WebSocket is the page's (lessons L17) and hands each stream its
 * messages through `handleMessage`. `history` on connect is authoritative;
 * `exited: true` ends a session for every open page.
 */

import { useCallback, useRef, useState } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  streamMonitorApi,
  type MonitorEpoch,
  type MonitorInputType,
  type MonitorMessage,
  type MonitorMessageRow,
  type MonitorMessageType,
  type MonitorSatellites,
  type MonitorState,
  type MonitorStatus,
  type MonitorStreamId,
} from '../api/streamMonitor';
import { isRelayStatusLine } from '../utils/streamMonitor';
import {
  BrowserSerialSession,
  DEFAULT_BAUD,
  isPickerCancelled,
  webSerialAvailable,
} from '../utils/webSerial';
import { mergeMessageRows } from '../utils/streamMessages';

/** Same cap as the backend history (HISTORY_EPOCHS, 1 Hz → one hour). */
const MAX_EPOCHS = 3600;
const MAX_LOG_LINES = 500;

/** The form's input types: the server's, and `relay`, a running Stream Relay
 *  relay's TCP server output, read as a TCP client (#192). */
export type MonitorFormInputType = MonitorInputType | 'relay';

export const INPUT_TYPES: { value: MonitorFormInputType; label: string; placeholder: string }[] = [
  { value: 'relay', label: 'Streams', placeholder: 'A running stream with a TCP Server output' },
  { value: 'serial', label: 'Serial', placeholder: 'ttyACM0:115200' },
  { value: 'tcpcli', label: 'TCP Client', placeholder: '192.168.1.100:9001' },
  { value: 'tcpsvr', label: 'TCP Server', placeholder: ':9001' },
  { value: 'ntripcli', label: 'NTRIP', placeholder: 'user:pass@caster:2101/MOUNT' },
  { value: 'file', label: 'File', placeholder: '/data/rover.sbf' },
  { value: 'browser', label: 'Browser serial', placeholder: '' },
];

/** Web Serial works in this browser and page (Chrome / Edge, localhost or
 *  https). Fixed for the page's lifetime. */
export const BROWSER_SERIAL_AVAILABLE = webSerialAvailable();

/** Keep at most one relay status line (the newest): they arrive every few
 *  seconds and would push everything else out of the buffer. */
function appendLog(prev: string[], line: string): string[] {
  const base = isRelayStatusLine(line) ? prev.filter((l) => !isRelayStatusLine(l)) : prev;
  return [...base.slice(-(MAX_LOG_LINES - 1)), line];
}

export function useMonitorStream(id: MonitorStreamId, wsOpen: boolean) {
  // ── form (persisted; separate keys so an old stored shape cannot break it,
  // L28). Stream a keeps the keys from before there were two streams.
  const key = (name: string) => `mrtk-stream-monitor-${id === 'a' ? '' : `${id}-`}${name}`;
  const [inputType, setInputType] = useLocalStorage<string>({ key: key('input-type'), defaultValue: 'tcpcli' });
  const [inputPath, setInputPath] = useLocalStorage<string>({ key: key('input-path'), defaultValue: '' });
  // The relay output picked for the `relay` type, as a TCP client path
  // (127.0.0.1:PORT). Kept apart so it does not overwrite a typed path.
  const [relayPath, setRelayPath] = useLocalStorage<string>({ key: key('relay-path'), defaultValue: '' });
  const [fileSpeed, setFileSpeed] = useLocalStorage<string>({ key: key('file-speed'), defaultValue: '0' });
  const [baud, setBaud] = useLocalStorage<string>({ key: key('baud'), defaultValue: DEFAULT_BAUD });
  // Read the GGA station id as the CLAS L6 source (#144). Off by default:
  // only `mrtk run` CLAS output puts the source there; any other receiver
  // puts its base station id, which can look like a valid source.
  const [clasSource, setClasSource] = useLocalStorage<boolean>({ key: key('clas-source'), defaultValue: false });
  // A stored `browser` falls back where Web Serial is missing (Safari, or the
  // page opened over plain http from another machine).
  const typeMeta = INPUT_TYPES.find((t) => t.value === inputType && (t.value !== 'browser' || BROWSER_SERIAL_AVAILABLE))
    ?? INPUT_TYPES.find((t) => t.value === 'tcpcli')!;
  const isFile = typeMeta.value === 'file';
  const isRelay = typeMeta.value === 'relay';
  const isBrowser = typeMeta.value === 'browser';
  const startInput: { type: MonitorInputType; path: string } = isRelay
    ? { type: 'tcpcli', path: relayPath }
    : { type: typeMeta.value as MonitorInputType, path: inputPath.trim() };
  const canStart = isBrowser || startInput.path !== '';

  // ── session data
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [epochs, setEpochs] = useState<MonitorEpoch[]>([]);
  const [sats, setSats] = useState<MonitorSatellites | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  // Message tab (#136): counters of every type, rows of the selected one.
  const [messageTypes, setMessageTypes] = useState<MonitorMessageType[]>([]);
  const [messageNow, setMessageNow] = useState(0);
  const [messageLabel, setMessageLabel] = useState<string | null>(null);
  const [messageRows, setMessageRows] = useState<MonitorMessageRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // A start request is in flight: a "not running" status sent before it
  // (e.g. on WS connect) must not flip the page back to idle.
  const startingRef = useRef(false);
  // Counts `exited` statuses. A Start response that arrives after a session
  // ended (relay exit, Stop from another page) is older than that exit and
  // must not bring Running back: no further status would correct it.
  const exitCountRef = useRef(0);
  // `started_at` of the session this page shows. A status with another one
  // means a new session (maybe started from another page): its console and
  // data start empty. `undefined` = take the next status as is (`history`
  // just replaced everything).
  const sessionRef = useRef<string | null | undefined>(undefined);
  // The serial port this page opened for a browser input. It runs on its own:
  // leaving the page keeps it sending until the session ends.
  const serialRef = useRef<BrowserSerialSession | null>(null);

  const clearData = useCallback(() => {
    setEpochs([]);
    setSats(null);
    setMessageTypes([]);
    setMessageRows([]);
  }, []);

  const handleMessage = useCallback((msg: MonitorMessage) => {
    switch (msg.type) {
      case 'history':
        // Authoritative: empty when no session is running.
        setEpochs((msg.epochs ?? []).slice(-MAX_EPOCHS));
        setSats(msg.satellites ?? null);
        setMessageTypes(msg.messages?.types ?? []);
        setMessageNow(msg.messages?.now ?? 0);
        setLogLines((msg.logs ?? []).reduce(appendLog, [] as string[]));
        sessionRef.current = undefined;
        break;
      case 'status':
        if (!msg.running && !msg.exited && startingRef.current) break;
        if (
          sessionRef.current !== undefined &&
          msg.started_at &&
          msg.started_at !== sessionRef.current
        ) {
          clearData();
          setLogLines([]);
        }
        sessionRef.current = msg.started_at;
        setStatus(msg);
        if (msg.exited) {
          exitCountRef.current += 1;
          clearData();
        }
        break;
      case 'epochs':
        setEpochs((prev) => [...prev, ...msg.epochs].slice(-MAX_EPOCHS));
        break;
      case 'satellites':
        setSats({ time: msg.time, time_sys: msg.time_sys, satellites: msg.satellites });
        break;
      case 'log':
        setLogLines((prev) => appendLog(prev, msg.message));
        break;
      case 'messages':
        setMessageTypes(msg.types);
        setMessageNow(msg.now);
        break;
      case 'message_rows':
        setMessageRows((prev) => mergeMessageRows(prev, msg.rows, msg.reset));
        break;
    }
  }, [clearData]);

  const selectMessage = (label: string) => {
    if (label === messageLabel) return;
    setMessageLabel(label);
    setMessageRows([]);
  };

  const running = !!status?.running;
  const state: MonitorState = submitting && !running ? 'starting' : status?.state ?? 'idle';

  /** `pacing`: honour the playback speed of a file input. */
  const start = async (pacing: boolean) => {
    // A browser input opens its port first: the picker needs the click's
    // user activation, so nothing may be awaited before it.
    let serial: BrowserSerialSession | null = null;
    if (isBrowser) {
      setRequestError(null);
      try {
        serial = await BrowserSerialSession.open(baud, (reason) => {
          if (serialRef.current === serial) serialRef.current = null;
          if (reason) setRequestError(reason);
        });
      } catch (err) {
        if (!isPickerCancelled(err)) setRequestError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    startingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    clearData();
    setLogLines([]);
    const exitsBefore = exitCountRef.current;
    try {
      const st = await streamMonitorApi.start({
        stream: id,
        input: serial ? { type: 'browser', path: serial.label } : startInput,
        file_speed: isFile && pacing && Number(fileSpeed) > 0 ? Number(fileSpeed) : null,
      });
      if (serial) {
        serialRef.current = serial;
        serial.attach(streamMonitorApi.ingestUrl(id, st.started_at ?? ''));
      }
      // A session that ended meanwhile keeps its exit status. If the exit
      // was another session's, the next status tick (1 s) shows this one.
      if (exitCountRef.current === exitsBefore) setStatus(st);
    } catch (err) {
      void serial?.close();
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      startingRef.current = false;
      setSubmitting(false);
    }
  };

  const stop = async () => {
    setSubmitting(true);
    setRequestError(null);
    try {
      setStatus(await streamMonitorApi.stop(id));
      clearData();
      void serialRef.current?.close();  // the server closes its socket too
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return {
    id,
    // form
    typeMeta, isFile, isRelay, isBrowser, setInputType,
    baud, setBaud,
    inputPath, setInputPath,
    relayPath, setRelayPath,
    canStart,
    fileSpeed, setFileSpeed,
    clasSource, setClasSource,
    // session
    status, epochs, sats, logLines,
    messageTypes, messageNow, messageLabel, messageRows,
    requestError, submitting, running, state,
    busy: running || submitting,
    // Live figures only while the WebSocket delivers them.
    live: running && wsOpen,
    handleMessage, selectMessage, start, stop,
  };
}

export type MonitorStream = ReturnType<typeof useMonitorStream>;
