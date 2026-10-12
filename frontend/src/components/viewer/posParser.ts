import type { PosEpoch, PosFileData, ReferencePosition } from './types';
import { xyzToLlh } from './enuUtils';

/**
 * Parse the "% ref pos" line from a .pos file header.
 * Example: "% ref pos   : 35.326680366  139.466069646    46.4279"
 */
function parseHeaderRefPos(headerLines: string[]): ReferencePosition | null {
  for (const line of headerLines) {
    const match = line.match(/^%\s*ref\s+pos\s*:\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      const height = parseFloat(match[3]);
      if (!isNaN(lat) && !isNaN(lon) && !isNaN(height)) {
        return { lat, lon, height };
      }
    }
  }
  return null;
}

/** Solution coordinate format written to the .pos file. */
type PosFormat = 'llh' | 'xyz' | 'nmea';

/**
 * Detect the solution format so we can map every layout to lat/lon/height:
 *  - NMEA-0183: sentence lines ($--GGA / $--RMC).
 *  - XYZ-ECEF : header column line contains "x-ecef".
 *  - LLH      : header column line contains "latitude" (default).
 * Falls back to a range heuristic on the first data row when the header is
 * suppressed (ECEF coordinates are far outside valid lat/lon ranges).
 */
function detectFormat(lines: string[]): PosFormat {
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('$') && ['GGA', 'RMC', 'GLL'].includes(t.substring(3, 6))) {
      return 'nmea';
    }
    // Stop scanning for NMEA once real data/header begins for column formats.
    if (t && !t.startsWith('$') && !t.startsWith('%')) break;
  }
  for (const line of lines) {
    if (!line.startsWith('%')) continue;
    const low = line.toLowerCase();
    if (low.includes('x-ecef')) return 'xyz';
    if (low.includes('latitude')) return 'llh';
  }
  // Header suppressed: sniff the first data row (|ECEF| ≫ lat/lon bounds).
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('%') || t.startsWith('$')) continue;
    const p = t.split(/\s+/);
    if (p.length < 7) continue;
    const c0 = Math.abs(parseFloat(p[2]));
    const c1 = Math.abs(parseFloat(p[3]));
    if (c0 > 90 || c1 > 180) return 'xyz';
    break;
  }
  return 'llh';
}

/** Parse "YYYY/MM/DD HH:MM:SS.sss" or "WEEK TOW" time; returns null on failure. */
function parseColumnTime(parts: string[]): Date | null {
  if (parts[0].includes('/')) {
    const time = new Date(`${parts[0].replace(/\//g, '-')}T${parts[1]}Z`);
    return isNaN(time.getTime()) ? null : time;
  }
  const week = parseInt(parts[0], 10);
  const tow = parseFloat(parts[1]);
  if (isNaN(week) || isNaN(tow)) return null;
  const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
  // Approximate: assume current leap seconds (18 s GPS→UTC offset).
  const time = new Date(GPS_EPOCH_MS + (week * 604800 + tow - 18) * 1000);
  return isNaN(time.getTime()) ? null : time;
}

/**
 * Parse a column-based .pos solution (LLH or XYZ-ECEF). Both share the layout
 *   TIME  c0 c1 c2  Q ns  sd0 sd1 sd2 ...  age ratio
 * where (c0,c1,c2) is (lat,lon,height) or (x,y,z). XYZ rows are converted to
 * geodetic lat/lon/height so downstream views (map, 2D, chart) work uniformly.
 */
function parseColumns(lines: string[], fmt: PosFormat): PosEpoch[] {
  const epochs: PosEpoch[] = [];
  for (const line of lines) {
    if (line.startsWith('%') || line.trim() === '') continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;

    const time = parseColumnTime(parts);
    if (!time) continue;
    const off = 2; // both time formats occupy 2 leading fields

    const c0 = parseFloat(parts[off]);
    const c1 = parseFloat(parts[off + 1]);
    const c2 = parseFloat(parts[off + 2]);
    if (isNaN(c0) || isNaN(c1) || isNaN(c2)) continue;

    let lat: number, lon: number, height: number;
    if (fmt === 'xyz') {
      ({ lat, lon, height } = xyzToLlh(c0, c1, c2));
    } else {
      lat = c0;
      lon = c1;
      height = c2;
    }

    const qi = off + 3;
    // sd columns are ENU (llh) or ECEF (xyz); only meaningful for llh.
    const isLlh = fmt === 'llh';
    epochs.push({
      time,
      timeUnix: time.getTime() / 1000,
      lat,
      lon,
      height,
      Q: parseInt(parts[qi], 10) || 0,
      ns: parseInt(parts[qi + 1], 10) || 0,
      sdn: isLlh && parts.length > qi + 2 ? parseFloat(parts[qi + 2]) || 0 : 0,
      sde: isLlh && parts.length > qi + 3 ? parseFloat(parts[qi + 3]) || 0 : 0,
      sdu: isLlh && parts.length > qi + 4 ? parseFloat(parts[qi + 4]) || 0 : 0,
      age: parts.length > qi + 8 ? parseFloat(parts[qi + 8]) || 0 : 0,
      ratio: parts.length > qi + 9 ? parseFloat(parts[qi + 9]) || 0 : 0,
    });
  }
  return epochs;
}

// NMEA GGA fix-quality → internal Q (matches MRTKLIB nmea_solq[]):
// GGA 1=Single 2=DGPS 3=PPP 4=Fix 5=Float 6=DeadReckoning.
const NMEA_GGA_TO_Q = [0, 5, 4, 6, 1, 2, 7, 0, 0];

/** Convert an NMEA ddmm.mmmm / dddmm.mmmm coordinate to signed degrees. */
function nmeaToDeg(field: string, hemi: string): number {
  const v = parseFloat(field);
  if (isNaN(v)) return NaN;
  const deg = Math.floor(v / 100);
  const min = v - deg * 100;
  const d = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -d : d;
}

type YMD = { y: number; mo: number; d: number };

function addDay(date: YMD, n = 1): YMD {
  const t = new Date(Date.UTC(date.y, date.mo - 1, date.d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Date carried by an RMC (ddmmyy in field 9) or ZDA (dd, mm, yyyy) sentence. */
function nmeaDate(type: string, f: string[]): YMD | null {
  if (type === 'RMC') {
    const ddmmyy = f[9] || '';
    if (ddmmyy.length < 6) return null;
    const d = parseInt(ddmmyy.slice(0, 2), 10);
    const mo = parseInt(ddmmyy.slice(2, 4), 10);
    const yy = parseInt(ddmmyy.slice(4, 6), 10);
    return isNaN(d) || isNaN(mo) || isNaN(yy) ? null : { y: 2000 + yy, mo, d };
  }
  if (type === 'ZDA') {
    const d = parseInt(f[2], 10);
    const mo = parseInt(f[3], 10);
    const y = parseInt(f[4], 10);
    return isNaN(d) || isNaN(mo) || isNaN(y) ? null : { y, mo, d };
  }
  return null;
}

/** YYYYMMDD / YYYY-MM-DD / YYYY_MM_DD in a file name, e.g. "rover_20260412.nmea". */
function dateFromFileName(fileName: string | undefined): YMD | null {
  const base = fileName?.split(/[\\/]/).pop() ?? '';
  const m = base.match(/(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])/);
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Seconds of day from an NMEA hhmmss[.ss] field, or NaN. */
function nmeaTod(field: string | undefined): number {
  const s = field || '';
  if (s.length < 6) return NaN;
  return parseInt(s.slice(0, 2), 10) * 3600 + parseInt(s.slice(2, 4), 10) * 60 + parseFloat(s.slice(4));
}

/**
 * Parse NMEA-0183 output. GGA carries position, height, satellites and fix
 * quality but only a time of day, so the date comes from RMC / ZDA sentences
 * (MRTKLIB emits an RMC per epoch). GGAs before the first dated sentence take
 * its date, or the day before when their time of day is more than 12 h after
 * it (the log started before UTC midnight). Logs with GGA only fall back to a
 * date in the file name,
 * else 1970-01-01, and say so via `notice`. Without a dated sentence, a time
 * of day going back by more than 12 h is taken as a UTC midnight rollover.
 */
function parseNmea(lines: string[], fileName?: string): { epochs: PosEpoch[]; notice?: string } {
  const epochs: PosEpoch[] = [];
  let notice: string | undefined;

  let date: YMD | null = null;
  let firstTod = NaN; // time of day of the first dated sentence
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith('$')) continue;
    const f = t.split('*')[0].split(',');
    date = nmeaDate(t.substring(3, 6), f);
    if (date) {
      firstTod = nmeaTod(f[1]);
      break;
    }
  }
  const firstDate = date;
  if (!date) {
    date = dateFromFileName(fileName);
    notice = date
      ? `No RMC/ZDA date in file; using ${date.y}-${pad2(date.mo)}-${pad2(date.d)} from the file name`
      : 'No RMC/ZDA date in file; times are shown on 1970-01-01';
    date ??= { y: 1970, mo: 1, d: 1 };
  }

  let prevTod: number | null = null;
  let seenDated = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith('$')) continue;
    const type = t.substring(3, 6);
    const f = t.split('*')[0].split(','); // drop checksum, split fields

    if (type === 'RMC' || type === 'ZDA') {
      const d = nmeaDate(type, f);
      if (d) {
        date = d;
        prevTod = null;
        seenDated = true;
      }
      continue;
    }

    if (type !== 'GGA') continue;
    const timeStr = f[1] || '';
    const lat = nmeaToDeg(f[2], f[3]);
    const lon = nmeaToDeg(f[4], f[5]);
    if (isNaN(lat) || isNaN(lon) || timeStr.length < 6) continue;

    const hh = parseInt(timeStr.slice(0, 2), 10);
    const mi = parseInt(timeStr.slice(2, 4), 10);
    const ss = parseFloat(timeStr.slice(4));
    if (isNaN(hh) || isNaN(mi) || isNaN(ss)) continue;

    const tod = hh * 3600 + mi * 60 + ss;
    if (!seenDated && firstDate && !isNaN(firstTod)) {
      // Before the first dated sentence: anchor to it, not to a rollover guess.
      date = tod > firstTod + 43200 ? addDay(firstDate, -1) : firstDate;
    } else if (prevTod !== null && tod < prevTod - 43200) {
      date = addDay(date);
    }
    prevTod = tod;

    const time = new Date(
      Date.UTC(date.y, date.mo - 1, date.d, hh, mi, Math.floor(ss), Math.round((ss % 1) * 1000)),
    );
    if (isNaN(time.getTime())) continue;

    const solq = parseInt(f[6], 10);
    // Ellipsoidal height = orthometric altitude (f[9]) + geoid separation (f[11]).
    const alt = parseFloat(f[9]);
    const geoid = parseFloat(f[11]);
    const height = (isNaN(alt) ? 0 : alt) + (isNaN(geoid) ? 0 : geoid);

    epochs.push({
      time,
      timeUnix: time.getTime() / 1000,
      lat,
      lon,
      height,
      Q: NMEA_GGA_TO_Q[solq] ?? 0,
      ns: parseInt(f[7], 10) || 0,
      sdn: 0,
      sde: 0,
      sdu: 0,
      age: parseFloat(f[13]) || 0,
      ratio: 0,
    });
  }
  return { epochs, notice };
}

/**
 * Parse an MRTKLIB solution file into structured data. Supports LLH,
 * XYZ-ECEF and NMEA-0183 output formats — XYZ and NMEA epochs are converted
 * to lat/lon/height so the map and 2D views render for every format.
 */
export function parsePosFile(content: string, fileName?: string): PosFileData {
  const lines = content.split('\n');
  const headerLines = lines.filter((l) => l.startsWith('%'));
  const fmt = detectFormat(lines);
  const { epochs, notice } = fmt === 'nmea'
    ? parseNmea(lines, fileName)
    : { epochs: parseColumns(lines, fmt), notice: undefined };

  return {
    epochs,
    headerRefPos: parseHeaderRefPos(headerLines),
    notice,
  };
}
