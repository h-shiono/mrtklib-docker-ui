/**
 * API client for the Stream Monitor (#96): decode a live stream through
 * `mrtk relay` and show its positions and satellites.
 *
 * The wire shapes follow `services/stream_decoders/events.py`. Fields a
 * stream format does not carry are `null`, never a made-up 0.
 */

import type { Satellite } from '../types/satellite';

const API_BASE = '/api/stream-monitor';

/** Input stream types the backend accepts (`INPUT_SCHEMES`), and `browser`:
 *  a serial port this page opened with Web Serial (#136). */
export type MonitorInputType = 'serial' | 'tcpcli' | 'tcpsvr' | 'ntripcli' | 'file' | 'browser';

/** What feeds a session: `mrtk relay`, a file read by the server, or a page. */
export type MonitorSessionKind = 'relay' | 'file' | 'browser';

export interface MonitorStartRequest {
  /** Default on the server: stream a. */
  stream?: MonitorStreamId;
  input: { type: MonitorInputType; path: string };
  /** File input: × real time, paced by the epoch times; null = all at once. */
  file_speed?: number | null;
}

/** A file input's progress (#161); the session stays open at the end. */
export interface MonitorFile {
  size: number;
  read: number;
  eof: boolean;
  speed: number | null;
}

/** One position solution (PosEpoch-shaped). `time` is ISO 8601 with a `Z`
 *  suffix, in the clock of `time_sys` (no leap seconds applied). */
export interface MonitorEpoch {
  /** NMEA GGA station id (CLAS L6 source in MRTKLIB output, #144). */
  refid?: number | null;
  time: string;
  time_sys: string;
  lat: number;
  lon: number;
  height: number | null;
  Q: number;
  ns: number | null;
  sdn: number | null;
  sde: number | null;
  sdu: number | null;
  age: number | null;
  ratio: number | null;
}

/** One satellite (Satellite-shaped). `used: null` = the stream did not say. */
/** The shared Satellite shape; a stream always says `used` (maybe null)
 *  and gives the per-band C/N0. */
export interface MonitorSatellite extends Satellite {
  used: boolean | null;
  snr_by_band: Record<string, number>;
}

export interface MonitorSatellites {
  time: string | null;
  time_sys: string;
  satellites: MonitorSatellite[];
}

export type MonitorState = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface MonitorStatus {
  type: 'status';
  running: boolean;
  state: MonitorState;
  kind: MonitorSessionKind;
  error_message: string | null;
  started_at: string | null;
  /** Input stream with credentials masked. */
  input: string | null;
  connected: boolean;
  bytes_per_sec: number;
  /** File input only. */
  file: MonitorFile | null;
  epoch_source: string | null;
  satellite_source: string | null;
  sources: string[];
  bytes_total: number;
  unknown_bytes: number;
  bad_frames: number;
  decode_errors: number;
  msg_counts: Record<string, number>;
  /** Set on the broadcast that ends a session. */
  exited?: boolean;
}

/** One message type's counters (Message tab, #136). */
export interface MonitorMessageType {
  label: string;
  kind: string;
  count: number;
  bytes: number;
  /** Size of the last frame. */
  length: number;
  /** Per second; null when a file is read all at once. */
  rate: number | null;
  /** Server time of the last frame, seconds. */
  last: number;
}

/** A frame of the selected message type. */
export interface MonitorMessageRow {
  seq: number;
  /** Satellite and signal for navigation data, else null. */
  key: string | null;
  t: number;
  length: number;
  summary: string | null;
  /** Start of the content in hex; null for a text frame. */
  preview: string | null;
  /** The whole frame in hex, or the line of a text frame. */
  data: string;
}

export interface MonitorMessageCounters {
  now: number;
  types: MonitorMessageType[];
}

/** The stream a message belongs to (#171). */
export type MonitorStreamId = 'a' | 'b';

/** Receiver console (#136): a command sent, or the receiver's reply (the
 *  Streams page's stream sessions). */
export interface MonitorConsoleEntry {
  t: number;
  dir: 'tx' | 'rx';
  /** "sent", "Septentrio reply", "Septentrio error", "UBX ACK-ACK", ... */
  label: string;
  /** The command, or a Septentrio ASCII reply up to its prompt. */
  text?: string;
  /** UBX reply: a short description and the frame in hex. */
  summary?: string | null;
  data?: string;
}

export type MonitorMessage = { stream?: MonitorStreamId } & (
  | MonitorStatus
  | {
      type: 'history';
      epochs: MonitorEpoch[];
      satellites: MonitorSatellites | null;
      messages: MonitorMessageCounters | null;
      logs: string[];
    }
  | ({ type: 'messages' } & MonitorMessageCounters)
  | { type: 'message_rows'; label: string; reset: boolean; rows: MonitorMessageRow[] }
  | { type: 'epochs'; epochs: MonitorEpoch[] }
  | ({ type: 'satellites' } & MonitorSatellites)
  | { type: 'log'; message: string }

);

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const streamMonitorApi = {
  start: async (request: MonitorStartRequest): Promise<MonitorStatus> => {
    const response = await fetch(`${API_BASE}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return handleResponse<MonitorStatus>(response);
  },

  stop: async (stream: MonitorStreamId = 'a'): Promise<MonitorStatus> => {
    const response = await fetch(`${API_BASE}/stop?stream=${stream}`, { method: 'POST' });
    return handleResponse<MonitorStatus>(response);
  },

  /** Where a page sends the bytes of a browser input; `startedAt` names the
   *  session it started, so a stale page cannot feed a newer one. */
  ingestUrl: (stream: MonitorStreamId, startedAt: string): string => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ stream, session: startedAt });
    return `${protocol}//${window.location.host}${API_BASE}/ingest?${query}`;
  },

  connectWs: (): WebSocket => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${protocol}//${window.location.host}${API_BASE}/ws`);
  },
};
