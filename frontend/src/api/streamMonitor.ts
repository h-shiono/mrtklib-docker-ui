/**
 * API client for the Stream Monitor (#96): decode a live stream through
 * `mrtk relay` and show its positions and satellites.
 *
 * The wire shapes follow `services/stream_decoders/events.py`. Fields a
 * stream format does not carry are `null`, never a made-up 0.
 */

import type { Satellite } from '../types/satellite';

const API_BASE = '/api/stream-monitor';

/** Input stream types the backend accepts (`INPUT_SCHEMES`). */
export type MonitorInputType = 'serial' | 'tcpcli' | 'tcpsvr' | 'ntripcli' | 'file';

export interface MonitorStartRequest {
  input: { type: MonitorInputType; path: string };
  raw_log: string | null;
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
  error_message: string | null;
  started_at: string | null;
  /** Input stream with credentials masked. */
  input: string | null;
  raw_log: string | null;
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

export type MonitorMessage =
  | MonitorStatus
  | { type: 'history'; epochs: MonitorEpoch[]; satellites: MonitorSatellites | null; logs: string[] }
  | { type: 'epochs'; epochs: MonitorEpoch[] }
  | ({ type: 'satellites' } & MonitorSatellites)
  | { type: 'log'; message: string };

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

  stop: async (): Promise<MonitorStatus> => {
    const response = await fetch(`${API_BASE}/stop`, { method: 'POST' });
    return handleResponse<MonitorStatus>(response);
  },

  connectWs: (): WebSocket => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${protocol}//${window.location.host}${API_BASE}/ws`);
  },
};
