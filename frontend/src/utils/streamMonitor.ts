/**
 * Adapters from Stream Monitor epochs to the shapes of the Real-Time
 * components it reuses (#96 P1). Every `null` → number decision for epochs
 * lives here; satellites need none (the Sky / SNR panel takes the shared
 * nullable `Satellite`).
 */

import type { MonitorEpoch } from '../api/streamMonitor';
import type { PositionPoint } from '../components/PositionScatter';
import type { TimeSeriesPoint } from '../components/TimeSeriesChart';
import type { MetricsPosition } from '../components/RtMetricsRow';
import type { PosEpoch } from '../components/viewer';

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

export function toPositionPoint(e: MonitorEpoch): PositionPoint {
  // The scatter only plots lat / lon; height is not shown.
  return { lat: e.lat, lon: e.lon, height: e.height ?? 0, quality: e.Q, timestamp: rtTimestamp(e.time) };
}

export function toTimeSeriesPoint(e: MonitorEpoch): TimeSeriesPoint {
  // No AR ratio (NMEA, SBF PVT, UBX) plots as 0, as RT does in SPP.
  return { timestamp: rtTimestamp(e.time), quality: e.Q, ns: e.ns ?? 0, ratio: e.ratio ?? 0 };
}

export function toPosEpoch(e: MonitorEpoch): PosEpoch {
  // The clock of `time_sys` as a UTC Date, as posParser does for .pos files.
  const t = new Date(e.time);
  const time = isNaN(t.getTime()) ? new Date(0) : t;
  return {
    time,
    timeUnix: time.getTime() / 1000,
    lat: e.lat,
    lon: e.lon,
    height: e.height ?? 0,
    Q: e.Q,
    ns: e.ns ?? 0,
    sdn: e.sdn ?? 0,
    sde: e.sde ?? 0,
    sdu: e.sdu ?? 0,
    age: e.age ?? 0,
    ratio: e.ratio ?? 0,
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
