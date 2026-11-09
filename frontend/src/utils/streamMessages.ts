/**
 * Helpers for the Stream Monitor's Message tab (#136).
 */

import type { MonitorMessageRow, MonitorMessageType } from '../api/streamMonitor';

/** Same caps as the backend (MAX_ROWS_KEYED / MAX_ROWS_LATEST). */
const MAX_KEYED_ROWS = 128;
const MAX_LATEST_ROWS = 64;

const KIND_ORDER = ['sbf', 'ubx', 'rtcm3', 'nmea', 'text'];

export function messageRowId(row: MonitorMessageRow): string | number {
  return row.key ?? row.seq;
}

/** Apply new rows: a satellite's row is replaced in place (satellite order);
 *  a type without satellites is listed newest first. */
export function mergeMessageRows(
  prev: MonitorMessageRow[],
  incoming: MonitorMessageRow[],
  reset: boolean,
): MonitorMessageRow[] {
  const byId = new Map<string | number, MonitorMessageRow>();
  for (const row of reset ? [] : prev) byId.set(messageRowId(row), row);
  for (const row of incoming) byId.set(messageRowId(row), row);
  const newestFirst = [...byId.values()].sort((a, b) => b.seq - a.seq);
  const keyed = newestFirst.some((row) => row.key !== null);
  if (!keyed) return newestFirst.slice(0, MAX_LATEST_ROWS);
  return newestFirst
    .slice(0, MAX_KEYED_ROWS)
    .sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));
}

/** Stable order for the type list: by protocol, then label (numbers in order). */
export function sortMessageTypes(types: MonitorMessageType[]): MonitorMessageType[] {
  const rank = (kind: string) => {
    const i = KIND_ORDER.indexOf(kind);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...types].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

/** Offset, 16 bytes of hex and their ASCII, one line per 16 bytes. */
export function hexDump(hex: string): string {
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 32) {
    const chunk = hex.slice(i, i + 32);
    const bytes = chunk.match(/../g) ?? [];
    const ascii = bytes
      .map((b) => {
        const c = parseInt(b, 16);
        return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
      })
      .join('');
    const offset = (i / 2).toString(16).toUpperCase().padStart(4, '0');
    lines.push(`${offset}  ${bytes.join(' ').toUpperCase().padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return rate >= 100 ? rate.toFixed(0) : rate >= 10 ? rate.toFixed(1) : rate.toFixed(2);
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 120) return `${s.toFixed(0)} s`;
  if (s < 7200) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(0)} h`;
}
