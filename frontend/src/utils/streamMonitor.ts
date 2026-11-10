/**
 * Adapters from Stream Monitor epochs to the metrics row and the position
 * viewer (#96). Both take nullable values, so nothing is made up here;
 * satellites go to the Sky / SNR panel as they come (shared `Satellite`).
 */

import type { MonitorEpoch, MonitorState, MonitorStatus, MonitorStreamId } from '../api/streamMonitor';
import type { MetricsPosition } from '../components/RtMetricsRow';
import type { PosEpoch } from '../components/viewer';
import { STATUS_COLOR } from './status';

/** Colour of each stream when overlaid (#171). Fixed per stream, whichever is
 *  selected; apart under colour-vision deficiency on both themes. */
export const STREAM_COLOR: Record<MonitorStreamId, string> = {
  a: '#0284c7',
  b: '#db2777',
};

/** '2026-03-14T06:59:32.000Z' → '2026/03/14 06:59:32.000', the rtkrcv-style
 *  timestamp the RT components show (TimeSeriesChart takes the part after
 *  the space as the axis label). The clock is kept: no time system shift. */
export function rtTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T([\d:.]+)Z?$/.exec(iso);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}` : iso;
}

export function toMetricsPosition(e: MonitorEpoch): MetricsPosition {
  return {
    timestamp: rtTimestamp(e.time),
    lat: e.lat,
    lon: e.lon,
    height: e.height,
    quality: e.Q,
    ratio: e.ratio,
    age: e.age,
  };
}

export function toPosEpoch(e: MonitorEpoch): PosEpoch {
  // The clock of `time_sys` as a UTC Date, as posParser does for .pos files.
  // Missing values stay null, as in PosEpoch.
  const t = new Date(e.time);
  const time = isNaN(t.getTime()) ? new Date(0) : t;
  return {
    time,
    timeUnix: time.getTime() / 1000,
    lat: e.lat,
    lon: e.lon,
    height: e.height,
    Q: e.Q,
    ns: e.ns,
    sdn: e.sdn,
    sde: e.sde,
    sdu: e.sdu,
    age: e.age,
    ratio: e.ratio,
    refid: e.refid ?? null,
  };
}

/** mrtk relay (str2str) status line, printed every few seconds:
 *  '2026/11/07 15:13:43 [CC---]      91368 B   60729 bps (0) ...' */
const RELAY_STATUS_RE = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[[A-Z-]{5}\]/;

export function isRelayStatusLine(line: string): boolean {
  return RELAY_STATUS_RE.test(line);
}

/** Split the relay log into the console lines and the latest status line,
 *  so the periodic status lines do not bury the rest. */
export function splitRelayLog(lines: string[]): { console: string[]; status: string | null } {
  const out: string[] = [];
  let status: string | null = null;
  for (const line of lines) {
    if (isRelayStatusLine(line)) status = line;
    else out.push(line);
  }
  return { console: out, status };
}

/** Name shown for a stream; the ids stay a / b in the API and saved settings. */
export function streamLabel(id: MonitorStreamId): string {
  return `Stream ${id === 'a' ? 1 : 2}`;
}

/** State of the input. `connected` is the backend's link to the relay, not
 *  the relay's input: the input is judged by the bytes arriving. */
export function inputLight(status: MonitorStatus | null, state: MonitorState, live: boolean) {
  if (live && status?.file) {
    return status.file.eof
      ? { label: 'END OF FILE', color: STATUS_COLOR.off, dimmed: true }
      : { label: 'READING', color: STATUS_COLOR.ok, dimmed: false };
  }
  if (live && status) {
    if (status.bytes_per_sec > 0) return { label: 'RECEIVING', color: STATUS_COLOR.ok, dimmed: false };
    if (status.connected) return { label: 'NO DATA', color: STATUS_COLOR.warn, dimmed: false };
    return status.kind === 'browser'
      ? { label: 'WAITING FOR BROWSER', color: STATUS_COLOR.starting, dimmed: false }
      : { label: 'STARTING RELAY', color: STATUS_COLOR.starting, dimmed: false };
  }
  if (state === 'error') return { label: 'ERROR', color: STATUS_COLOR.error, dimmed: false };
  if (state === 'starting') return { label: 'STARTING', color: STATUS_COLOR.starting, dimmed: false };
  return { label: 'STOPPED', color: STATUS_COLOR.off, dimmed: true };
}

/** Seconds from a time system to GPST. GPST - UTC is 18 s since 2017. */
const TO_GPST_S: Record<string, number> = { GPST: 0, UTC: 18, JST: 18 - 9 * 3600 };

/** The time system two overlaid streams share: their own if they agree (no
 *  leap second assumed then), otherwise GPST. */
export function commonTimeSystem(epochs: MonitorEpoch[]): string {
  const first = epochs[0]?.time_sys ?? 'GPST';
  return epochs.every((e) => e.time_sys === first) ? first : 'GPST';
}

/** `pos` (one per `raw` epoch) on `timeSystem`, as `commonTimeSystem` gave it:
 *  NMEA epochs are UTC, SBF and MRTKLIB .pos GPST, and a chart compares by time. */
export function alignEpochs(raw: MonitorEpoch[], pos: PosEpoch[], timeSystem: string): PosEpoch[] {
  return pos.map((p, i) => {
    if (raw[i].time_sys === timeSystem) return p;
    const timeUnix = p.timeUnix + (TO_GPST_S[raw[i].time_sys] ?? 0);
    return { ...p, timeUnix, time: new Date(timeUnix * 1000) };
  });
}
