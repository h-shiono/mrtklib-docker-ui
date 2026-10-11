/**
 * MRTKLIB real-time processing (mrtk run) configuration types.
 *
 * Extends the shared processing config with [streams], [server] (full),
 * and [console] sections specific to mrtk run (rtkrcv).
 */

// Re-export shared config type
export type { MrtkPostConfig as MrtkProcessingConfig } from './mrtkPostConfig';

// ─── [streams] ──────────────────────────────────────────────────────────────

export type StreamType = 'off' | 'serial' | 'file' | 'tcpsvr' | 'tcpcli' | 'ntrip';

export type StreamFormat =
  | 'rtcm3' | 'ubx' | 'sbf' | 'binex' | 'rinex'
  | 'clas' | 'l6e' | 'nmea' | '';

export interface StreamConfig {
  type: StreamType;
  path: string;
  format: StreamFormat;
}

export interface BaseStreamConfig extends StreamConfig {
  nmeareq: boolean;
  nmealat: number;
  nmealon: number;
}

export interface StreamsConfig {
  input: {
    rover: StreamConfig;
    base: BaseStreamConfig;
    correction: StreamConfig;
  };
  output: {
    stream1: StreamConfig;
    stream2: StreamConfig;
  };
  log: {
    stream1: StreamConfig;
    stream2: StreamConfig;
    stream3: StreamConfig;
  };
}

// ─── [console] ──────────────────────────────────────────────────────────────

export interface ConsoleConfig {
  passwd: string;
  timetype: 'gpst' | 'utc' | 'jst';
  soltype: 'deg' | 'dms' | 'xyz' | 'enu';
  solflag: 'off' | 'on';
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const OFF_STREAM: StreamConfig = { type: 'off', path: '', format: '' };

export const DEFAULT_STREAMS: StreamsConfig = {
  input: {
    rover: { type: 'off', path: '', format: 'rtcm3' },
    base: { type: 'off', path: '', format: '', nmeareq: false, nmealat: 0, nmealon: 0 },
    correction: { type: 'off', path: '', format: '' },
  },
  output: {
    stream1: { ...OFF_STREAM },
    stream2: { ...OFF_STREAM },
  },
  log: {
    stream1: { ...OFF_STREAM },
    stream2: { ...OFF_STREAM },
    stream3: { ...OFF_STREAM },
  },
};

export const DEFAULT_CONSOLE: ConsoleConfig = {
  passwd: '',
  timetype: 'gpst',
  soltype: 'deg',
  solflag: 'off',
};

// ─── Monitor types (real-time status from mrtk run) ─────────────────────────

export interface PositionUpdate {
  timestamp: string;
  lat: number;
  lon: number;
  height: number;
  quality: number;   // 1=Fix, 2=Float, 5=Single
  ns: number;        // number of satellites
  ratio: number;     // AR ratio
  age: number;       // age of differential (s)
}

/** Live state of one input stream, derived by the backend from rtkrcv `stream`. */
export type InputStreamState = 'off' | 'connecting' | 'receiving' | 'stalled' | 'nodecode' | 'error';

export interface InputStreamStatus {
  name: 'rover' | 'base' | 'correction';
  type: string;           // rtkrcv stream type (ntripcli, tcpcli, serial, ...; '-' = off)
  format: string;
  state: InputStreamState;
  in_bytes: number;
  in_bps: number;
  message: string;        // current rtkrcv stream message (credentials masked)
  decoded: number | null; // decoded messages (obs/nav/ssr/...) from `status`
  errors: number | null;  // decode errors from `status`
  last_error: string | null; // latched error message (survives reconnect retries)
  hint: string | null;    // human-readable cause
}

export type RunStatus ='idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
