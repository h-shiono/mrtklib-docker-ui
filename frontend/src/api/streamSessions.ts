/**
 * API client for the stream sessions of the Streams page (#136): the decoded
 * messages and the receiver console of each running relay, read through the
 * message tap the server adds to it.
 */

import type {
  MonitorConsoleEntry,
  MonitorMessageCounters,
  MonitorMessageRow,
} from './streamMonitor';

const API_BASE = '/api/mrtk-relay/sessions';

/** A relay's session, each second. `stream` is the relay's process ID. */
export interface SessionStatus {
  type: 'status';
  stream: string;
  running: boolean;
  /** The server reads the relay's tap. */
  connected: boolean;
  bytes_per_sec: number;
  /** Commands can go to the receiver; otherwise `blocked` says why. */
  commands: boolean;
  blocked: string | null;
  bytes_total: number;
  unknown_bytes: number;
  bad_frames: number;
  decode_errors: number;
  msg_counts: Record<string, number>;
  /** Set on the broadcast that ends the session (the relay stopped). */
  exited?: boolean;
}

export type SessionMessage =
  | SessionStatus
  | ({ type: 'history'; stream: string; messages: MonitorMessageCounters; console: MonitorConsoleEntry[] })
  | ({ type: 'messages'; stream: string } & MonitorMessageCounters)
  | { type: 'message_rows'; stream: string; label: string; reset: boolean; rows: MonitorMessageRow[] }
  | { type: 'console'; stream: string; entry: MonitorConsoleEntry };

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const streamSessionsApi = {
  /** One command for the receiver behind a relay: an ASCII `line` (CR LF is
   *  added) or a binary frame in `hex`. */
  send: async (processId: string, command: { line: string } | { hex: string }): Promise<void> => {
    const response = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ process_id: processId, ...command }),
    });
    await handleResponse<{ ok: boolean }>(response);
  },

  connectWs: (): WebSocket => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${protocol}//${window.location.host}${API_BASE}/ws`);
  },
};
