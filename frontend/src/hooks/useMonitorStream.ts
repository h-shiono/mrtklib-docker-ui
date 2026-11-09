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
import { mergeMessageRows } from '../utils/streamMessages';

/** Same cap as the backend history (HISTORY_EPOCHS, 1 Hz → one hour). */
const MAX_EPOCHS = 3600;
const MAX_LOG_LINES = 500;

export const INPUT_TYPES: { value: MonitorInputType; label: string; placeholder: string }[] = [
  { value: 'serial', label: 'Serial', placeholder: 'ttyACM0:115200' },
  { value: 'tcpcli', label: 'TCP Client', placeholder: '192.168.1.100:9001' },
  { value: 'tcpsvr', label: 'TCP Server', placeholder: ':9001' },
  { value: 'ntripcli', label: 'NTRIP Client', placeholder: 'user:pass@caster:2101/MOUNT' },
  { value: 'file', label: 'File', placeholder: '/data/rover.sbf' },
];

export const DEFAULT_RAW_LOG = '/workspace/rtlog/monitor_%Y%m%d%h%M.raw';

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
  const [saveRaw, setSaveRaw] = useLocalStorage<boolean>({ key: key('save-raw'), defaultValue: false });
  const [rawLog, setRawLog] = useLocalStorage<string>({ key: key('raw-log'), defaultValue: DEFAULT_RAW_LOG });
  const [fileSpeed, setFileSpeed] = useLocalStorage<string>({ key: key('file-speed'), defaultValue: '0' });
  // Read the GGA station id as the CLAS L6 source (#144). Off by default:
  // only `mrtk run` CLAS output puts the source there; any other receiver
  // puts its base station id, which can look like a valid source.
  const [clasSource, setClasSource] = useLocalStorage<boolean>({ key: key('clas-source'), defaultValue: false });
  const typeMeta = INPUT_TYPES.find((t) => t.value === inputType) ?? INPUT_TYPES[1];
  const isFile = typeMeta.value === 'file';

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
    startingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    clearData();
    setLogLines([]);
    const exitsBefore = exitCountRef.current;
    try {
      const st = await streamMonitorApi.start({
        stream: id,
        input: { type: typeMeta.value, path: inputPath.trim() },
        raw_log: !isFile && saveRaw && rawLog.trim() ? rawLog.trim() : null,
        file_speed: isFile && pacing && Number(fileSpeed) > 0 ? Number(fileSpeed) : null,
      });
      // A session that ended meanwhile keeps its exit status. If the exit
      // was another session's, the next status tick (1 s) shows this one.
      if (exitCountRef.current === exitsBefore) setStatus(st);
    } catch (err) {
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
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return {
    id,
    // form
    typeMeta, isFile, setInputType,
    inputPath, setInputPath,
    saveRaw, setSaveRaw,
    rawLog, setRawLog,
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
