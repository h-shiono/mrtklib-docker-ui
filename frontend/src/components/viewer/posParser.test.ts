import { describe, expect, it } from 'vitest';
import { parsePosFile } from './posParser';
import { readFixtureText } from '../../test/fixtures';

// Real `mrtk post` output, see tests/fixtures/pos/README.md: four epochs,
// 2005/04/02 00:00:00 to 00:45:00 GPST every 900 s.
const pos = (name: string) => parsePosFile(readFixtureText('pos', name), name);
const iso = (d: Date) => d.toISOString();

const GPST_TIMES = [
  '2005-04-02T00:00:00.000Z',
  '2005-04-02T00:15:00.000Z',
  '2005-04-02T00:30:00.000Z',
  '2005-04-02T00:45:00.000Z',
];
// GPST - 13 s (leap seconds in 2005); the first one is on the day before.
const UTC_TIMES = [
  '2005-04-01T23:59:47.000Z',
  '2005-04-02T00:14:47.000Z',
  '2005-04-02T00:29:47.000Z',
  '2005-04-02T00:44:47.000Z',
];

/** GGA / RMC lines of the NMEA fixture. */
function nmeaLines() {
  const lines = readFixtureText('pos', 'nmea_utc.nmea').trim().split('\n');
  return {
    gga: lines.filter((l) => l.startsWith('$GNGGA')),
    rmc: lines.filter((l) => l.startsWith('$GNRMC')),
  };
}

describe('parsePosFile: column formats', () => {
  it('LLH, GPST, calendar time', () => {
    const d = pos('llh_gpst_ymd.pos');
    expect(d.timeSystem).toBe('GPST');
    expect(d.notice).toBeUndefined();
    expect(d.headerRefPos).toBeNull();
    expect(d.epochs.map((e) => iso(e.time))).toEqual(GPST_TIMES);
    expect(d.epochs[0]).toMatchObject({
      timeUnix: Date.UTC(2005, 3, 2) / 1000,
      lat: 35.160868346,
      lon: 139.613825769,
      height: 83.8246,
      Q: 5,
      ns: 7,
      sdn: 5.8171,
      sde: 4.4367,
      sdu: 12.7659,
      age: 0,
      ratio: 0,
    });
    expect(d.epochs[2].ns).toBe(6);
  });

  it('UTC: times stay in the file time system, not shifted', () => {
    const d = pos('llh_utc_ymd.pos');
    expect(d.timeSystem).toBe('UTC');
    expect(d.epochs.map((e) => iso(e.time))).toEqual(UTC_TIMES);
    expect(d.epochs[0].lat).toBe(35.160868346);
  });

  it('GPS week + TOW gives the same epochs as calendar time', () => {
    const d = pos('llh_gpst_tow.pos');
    expect(d.timeSystem).toBe('GPST');
    expect(d.epochs.map((e) => iso(e.time))).toEqual(GPST_TIMES);
    expect(d.epochs.map((e) => e.height)).toEqual(pos('llh_gpst_ymd.pos').epochs.map((e) => e.height));
  });

  it('XYZ-ECEF is converted to the same lat / lon / height', () => {
    const xyz = pos('xyz_gpst_ymd.pos');
    const llh = pos('llh_gpst_ymd.pos');
    expect(xyz.epochs.map((e) => iso(e.time))).toEqual(GPST_TIMES);
    xyz.epochs.forEach((e, i) => {
      expect(e.lat).toBeCloseTo(llh.epochs[i].lat, 8);
      expect(e.lon).toBeCloseTo(llh.epochs[i].lon, 8);
      expect(e.height!).toBeCloseTo(llh.epochs[i].height!, 3);
      // sd columns are ECEF in this format: not shown as ENU.
      expect([e.sdn, e.sde, e.sdu]).toEqual([null, null, null]);
      expect(e.Q).toBe(5);
    });
  });

  it('XYZ without the header is still detected as ECEF', () => {
    const body = readFixtureText('pos', 'xyz_gpst_ymd.pos')
      .split('\n')
      .filter((l) => !l.startsWith('%'))
      .join('\n');
    const d = parsePosFile(body);
    expect(d.timeSystem).toBe('GPST');
    expect(d.epochs[0].lat).toBeCloseTo(35.160868346, 8);
  });

  it('reads the "% ref pos" header line', () => {
    const text = '% ref pos   : 35.326680366  139.466069646    46.4279\n' +
      readFixtureText('pos', 'llh_gpst_ymd.pos');
    expect(pos('llh_gpst_ymd.pos').headerRefPos).toBeNull();
    expect(parsePosFile(text).headerRefPos).toEqual({ lat: 35.326680366, lon: 139.466069646, height: 46.4279 });
  });

  it('JST column header', () => {
    const text = readFixtureText('pos', 'llh_utc_ymd.pos').replace('%  UTC  ', '%  JST  ');
    expect(parsePosFile(text).timeSystem).toBe('JST');
  });

  it('skips rows with an unparsable time or coordinate', () => {
    const text = readFixtureText('pos', 'llh_gpst_ymd.pos')
      .replace('2005/04/02 00:15:00.000', '2005/04/02 xx:15:00.000')
      .replace('35.160874565', 'nan');
    expect(parsePosFile(text).epochs.map((e) => iso(e.time))).toEqual([GPST_TIMES[0], GPST_TIMES[3]]);
  });
});

describe('parsePosFile: NMEA', () => {
  it('GGA dated by RMC, across a UTC midnight', () => {
    const d = pos('nmea_utc.nmea');
    expect(d.timeSystem).toBe('UTC');
    expect(d.notice).toBeUndefined();
    expect(d.epochs.map((e) => iso(e.time))).toEqual(UTC_TIMES);
    const llh = pos('llh_utc_ymd.pos').epochs;
    d.epochs.forEach((e, i) => {
      // ddmm.mmmmmmm keeps ~1e-9 deg; height = altitude + geoid separation.
      expect(e.lat).toBeCloseTo(llh[i].lat, 7);
      expect(e.lon).toBeCloseTo(llh[i].lon, 7);
      expect(e.height!).toBeCloseTo(llh[i].height!, 2);
    });
    expect(d.epochs[0]).toMatchObject({
      Q: 5, // GGA quality 1 = single
      ns: 7,
      sdn: null,
      sde: null,
      sdu: null,
      ratio: null,
      age: 0,
      refid: 0,
    });
  });

  it('GGA before the first RMC is dated back across the midnight', () => {
    const { gga, rmc } = nmeaLines();
    // GGA 23:59:47, then RMC 00:14:47 (2005-04-02) and the rest.
    const text = [gga[0], rmc[1], gga[1], rmc[2], gga[2]].join('\n');
    expect(parsePosFile(text).epochs.map((e) => iso(e.time))).toEqual(UTC_TIMES.slice(0, 3));
  });

  it('GGA only: date from the file name, with a notice', () => {
    const { gga } = nmeaLines();
    const d = parsePosFile(gga.join('\n'), '/workspace/rover_20050401.nmea');
    expect(d.notice).toMatch(/2005-04-01 from the file name/);
    // 23:59:47 -> 00:14:47 goes back by more than 12 h: a midnight rollover.
    expect(d.epochs.map((e) => iso(e.time))).toEqual(UTC_TIMES);
  });

  it('GGA only, no date in the name: 1970-01-01, with a notice', () => {
    const { gga } = nmeaLines();
    const d = parsePosFile(gga.join('\n'), 'rover.nmea');
    expect(d.notice).toMatch(/1970-01-01/);
    expect(iso(d.epochs[0].time)).toBe('1970-01-01T23:59:47.000Z');
    expect(iso(d.epochs[1].time)).toBe('1970-01-02T00:14:47.000Z');
  });

  it('missing geoid separation leaves the height unknown', () => {
    const { gga } = nmeaLines();
    const line = gga[1].replace(',36.478,M,', ',,M,');
    expect(parsePosFile(line, 'x_20050402.nmea').epochs[0].height).toBeNull();
  });

  it('maps GGA fix quality to the internal Q', () => {
    const { gga } = nmeaLines();
    const withQ = (q: number) => gga[1].replace(/,E,1,07,/, `,E,${q},07,`);
    const qs = [1, 2, 4, 5, 6].map((q) => parsePosFile(withQ(q), 'x_20050402.nmea').epochs[0].Q);
    // single, DGPS, fix, float, dead reckoning
    expect(qs).toEqual([5, 4, 1, 2, 7]);
  });
});
