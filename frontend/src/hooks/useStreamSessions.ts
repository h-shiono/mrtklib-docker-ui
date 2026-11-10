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
import { REPLY_TIMEOUT_MS } from './useMonitorStream';

/** Same cap as the backend (CONSOLE_MAX). */
const MAX_CONSOLE = 300;

/** Labels of replies that answer a command (not $TD / $TE / blocks). */
const ANSWERS = new Set(['Septentrio reply', 'Septentrio error', 'UBX ACK-ACK', 'UBX ACK-NAK', 'UBX CFG-VALGET', 'UBX MON-VER']);

export interface SessionState {
  status: SessionStatus | null;
  messageTypes: MonitorMessageType[];
  messageNow: number;
  consoleEntries: MonitorConsoleEntry[];
}

const EMPTY: SessionState = { status: null, messageTypes: [], messageNow: 0, consoleEntries: [] };

/** The message type whose rows the page wants (its Messages tab is open). */
export interface RowSubscription {
  stream: string;
  label: string;
}

const keyOf = (s: RowSubscription | null) => (s ? `${s.stream}\n${s.label}` : '');

export function useStreamSessions(subscription: RowSubscription | null) {
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});
  const [wsOpen, setWsOpen] = useState(false);
  // Rows of the subscribed type, tagged with it: rows of an earlier
  // subscription are never shown for the current one.
  const [rowState, setRowState] = useState<{ key: string; rows: MonitorMessageRow[] }>({ key: '', rows: [] });
  const subKey = keyOf(subscription);
  const subRef = useRef(subscription);
  useLayoutEffect(() => {
    subRef.current = subscription;
  });
  // Commands waiting for their answer, per relay, oldest first.
  const waitersRef = useRef<Map<string, ((e: MonitorConsoleEntry | null) => void)[]>>(new Map());
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
          }));
          break;
        case 'status':
          if (msg.exited) {
            // The relay stopped: its data goes, its console stays readable.
            update(stream, (s) => ({ ...s, status: msg, messageTypes: [] }));
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
          update(stream, (s) => ({ ...s, consoleEntries: [...s.consoleEntries.slice(-(MAX_CONSOLE - 1)), entry] }));
          if (entry.dir === 'rx' && ANSWERS.has(entry.label)) waitersRef.current.get(stream)?.shift()?.(entry);
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
    ws.send(JSON.stringify({ type: 'select_message', stream: sub?.stream ?? '', label: sub?.label ?? null }));
  }, [subKey, wsOpen]);

  /** Send one command and wait for the receiver's answer (null on timeout). */
  const sendCommand = useCallback(async (
    stream: string,
    command: { line: string } | { hex: string },
  ): Promise<MonitorConsoleEntry | null> => {
    let resolve: (entry: MonitorConsoleEntry | null) => void = () => {};
    const answer = new Promise<MonitorConsoleEntry | null>((r) => { resolve = r; });
    const queue = waitersRef.current.get(stream) ?? [];
    waitersRef.current.set(stream, [...queue, resolve]);
    const forget = () => waitersRef.current.set(stream, (waitersRef.current.get(stream) ?? []).filter((w) => w !== resolve));
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
