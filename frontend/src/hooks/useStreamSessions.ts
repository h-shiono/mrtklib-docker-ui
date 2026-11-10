/**
 * The stream sessions of the Streams page (#136): one WebSocket for the page
 * (lessons L17: opened on mount, reconnected on drop, `history` replayed on
 * connect), state per relay process ID, and commands that wait for the
 * receiver's answer.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MonitorConsoleEntry, MonitorMessageRow, MonitorMessageType } from '../api/streamMonitor';
import { streamSessionsApi, type SessionMessage, type SessionStatus } from '../api/streamSessions';
import { mergeMessageRows } from '../utils/streamMessages';
import { EMPTY_SETTINGS, applyReply, type SeptentrioSettings } from '../utils/septentrio';
import { EMPTY_UBLOX, foldUblox, type UbloxSettings } from '../utils/ublox';

/** Same cap as the backend (CONSOLE_MAX). */
const MAX_CONSOLE = 300;
/** How long a command may take to answer before the next one is sent. */
const REPLY_TIMEOUT_MS = 5000;

/** Labels of replies that answer an ASCII command line (not $TD / $TE /
 *  blocks). A binary command names its own reply: a UBX reply must never be
 *  taken by a line still waiting (e.g. Septentrio reads sent before the
 *  model was switched to u-blox). */
const LINE_ANSWERS = new Set(['Septentrio reply', 'Septentrio error']);

interface Waiter {
  accept: (entry: MonitorConsoleEntry) => boolean;
  resolve: (entry: MonitorConsoleEntry | null) => void;
}

export interface SessionState {
  status: SessionStatus | null;
  messageTypes: MonitorMessageType[];
  messageNow: number;
  consoleEntries: MonitorConsoleEntry[];
  /** What the receiver reported in its replies, kept apart from the console
   *  (capped): a setting read long ago is still known. */
  septentrio: SeptentrioSettings;
  ublox: UbloxSettings;
}

const EMPTY: SessionState = {
  status: null, messageTypes: [], messageNow: 0, consoleEntries: [], septentrio: EMPTY_SETTINGS, ublox: EMPTY_UBLOX,
};

/** The session's receiver reports after more console entries, in order. */
function report(s: SessionState, entries: MonitorConsoleEntry[]): Pick<SessionState, 'septentrio' | 'ublox'> {
  let { septentrio, ublox } = s;
  for (const e of entries) {
    if (e.dir === 'rx' && e.text && e.label === 'Septentrio reply') septentrio = applyReply(septentrio, e.text);
    ublox = foldUblox(ublox, e);
  }
  return { septentrio, ublox };
}

/** The message type whose rows the page wants (its Messages tab is open). */
export interface RowSubscription {
  stream: string;
  label: string;
}

const keyOf = (s: RowSubscription | null) => (s ? `${s.stream}\n${s.label}` : '');

/** `keep`: the sessions the page may still show (each card's latest one);
 *  other finished sessions are dropped when a session ends. */
export function useStreamSessions(subscription: RowSubscription | null, keep: string[] = []) {
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});
  const [wsOpen, setWsOpen] = useState(false);
  // Rows of the subscribed type, tagged with it: rows of an earlier
  // subscription are never shown for the current one.
  const [rowState, setRowState] = useState<{ key: string; rows: MonitorMessageRow[] }>({ key: '', rows: [] });
  const subKey = keyOf(subscription);
  const subRef = useRef(subscription);
  const keepRef = useRef(keep);
  // The stream the server sends rows of: unsubscribing must name it.
  const sentStreamRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    subRef.current = subscription;
    keepRef.current = keep;
  });
  // Commands waiting for their answer, per relay, oldest first; each takes
  // the first reply it accepts.
  const waitersRef = useRef<Map<string, Waiter[]>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  const update = (stream: string, change: (s: SessionState) => SessionState) =>
    setSessions((prev) => ({ ...prev, [stream]: change(prev[stream] ?? EMPTY) }));

  useEffect(() => {
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const handle = (msg: SessionMessage) => {
      const stream = msg.stream;
      switch (msg.type) {
        case 'history':
          update(stream, (s) => ({
            ...s,
            messageTypes: msg.messages?.types ?? [],
            messageNow: msg.messages?.now ?? 0,
            consoleEntries: (msg.console ?? []).slice(-MAX_CONSOLE),
            // Replayed on a reconnect: in order, so the latest still wins.
            ...report(s, msg.console ?? []),
          }));
          break;
        case 'status':
          if (msg.exited) {
            // The relay stopped: its data goes, its console stays readable.
            // Its console stays readable; finished sessions no card shows go.
            setSessions((prev) => {
              const next: Record<string, SessionState> = {};
              for (const [id, s] of Object.entries(prev)) {
                if (id === stream) next[id] = { ...s, status: msg, messageTypes: [] };
                else if (!s.status?.exited || keepRef.current.includes(id)) next[id] = s;
              }
              return next;
            });
            setRowState((prev) => (prev.key.startsWith(`${stream}\n`) ? { key: prev.key, rows: [] } : prev));
          } else {
            update(stream, (s) => ({ ...s, status: msg }));
          }
          break;
        case 'messages':
          update(stream, (s) => ({ ...s, messageTypes: msg.types, messageNow: msg.now }));
          break;
        case 'message_rows': {
          // Rows of a previous subscription may still be on their way.
          const key = keyOf(subRef.current);
          if (key && key === keyOf({ stream, label: msg.label })) {
            setRowState((prev) => ({
              key,
              rows: mergeMessageRows(prev.key === key ? prev.rows : [], msg.rows, msg.reset),
            }));
          }
          break;
        }
        case 'console': {
          const entry = msg.entry;
          update(stream, (s) => ({
            ...s,
            consoleEntries: [...s.consoleEntries.slice(-(MAX_CONSOLE - 1)), entry],
            ...report(s, [entry]),
          }));
          if (entry.dir === 'rx') {
            const queue = waitersRef.current.get(stream) ?? [];
            const waiter = queue.find((w) => w.accept(entry));
            if (waiter) {
              waitersRef.current.set(stream, queue.filter((w) => w !== waiter));
              waiter.resolve(entry);
            }
          }
          break;
        }
      }
    };

    const connect = () => {
      if (wsRef.current || closed) return;
      const ws = streamSessionsApi.connectWs();
      wsRef.current = ws;
      ws.onopen = () => {
        if (wsRef.current === ws) setWsOpen(true);
      };
      ws.onmessage = (event) => {
        try {
          handle(JSON.parse(event.data) as SessionMessage);
        } catch {
          // not a message of ours
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (closed) return;
        setWsOpen(false);
        reconnect = setTimeout(() => {
          reconnect = null;
          connect();
        }, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, []);

  // Tell the server which rows to send; again after a reconnect.
  useEffect(() => {
    const ws = wsRef.current;
    if (!wsOpen || ws?.readyState !== WebSocket.OPEN) return;
    const sub = subRef.current;
    if (sub) {
      ws.send(JSON.stringify({ type: 'select_message', stream: sub.stream, label: sub.label }));
      sentStreamRef.current = sub.stream;
    } else if (sentStreamRef.current) {
      // Stop the rows: the server needs the stream it sends them for.
      ws.send(JSON.stringify({ type: 'select_message', stream: sentStreamRef.current, label: null }));
      sentStreamRef.current = null;
    }
  }, [subKey, wsOpen]);

  /** Send one command and wait for the receiver's answer (null on timeout).
   *  `accept` picks the reply that answers it (a UBX command: its own ACK or
   *  response); by default a Septentrio reply, which answers a line. */
  const sendCommand = useCallback(async (
    stream: string,
    command: { line: string } | { hex: string },
    accept: (entry: MonitorConsoleEntry) => boolean = (e) => LINE_ANSWERS.has(e.label),
  ): Promise<MonitorConsoleEntry | null> => {
    let resolve: (entry: MonitorConsoleEntry | null) => void = () => {};
    const answer = new Promise<MonitorConsoleEntry | null>((r) => { resolve = r; });
    const waiter: Waiter = { accept, resolve };
    const queue = waitersRef.current.get(stream) ?? [];
    waitersRef.current.set(stream, [...queue, waiter]);
    const forget = () => waitersRef.current.set(stream, (waitersRef.current.get(stream) ?? []).filter((w) => w !== waiter));
    const timer = setTimeout(() => {
      forget();
      resolve(null);
    }, REPLY_TIMEOUT_MS);
    try {
      await streamSessionsApi.send(stream, command);
    } catch (err) {
      clearTimeout(timer);
      forget();
      throw err;
    }
    const entry = await answer;
    clearTimeout(timer);
    return entry;
  }, []);

  const rows = rowState.key === subKey ? rowState.rows : [];
  return { sessions, wsOpen, rows, sendCommand };
}

export type StreamSessions = ReturnType<typeof useStreamSessions>;
