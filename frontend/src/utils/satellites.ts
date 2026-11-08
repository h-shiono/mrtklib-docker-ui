import type { Satellite } from '../types/satellite';

/** In the solution's satellite count (ns). RT: the backend's `used` (valid on
 *  L1 in the RTK / PPP filter, else the SPP flag; #120). A stream that does
 *  not report usage (`used: null`) lists the satellites it tracks, shown as
 *  used. Shared by the metrics row and the Sky / SNR panel so both count the
 *  same satellites. */
export function isUsed(sat: Satellite): boolean {
  return sat.used ?? sat.valid ?? true;
}

/** Has a sky position (az / el), so it can go on the sky plot. */
export function hasSkyPosition(
  sat: Satellite,
): sat is Satellite & { azimuth: number; elevation: number } {
  return (
    sat.azimuth != null && sat.elevation != null
    && Number.isFinite(sat.azimuth) && Number.isFinite(sat.elevation)
  );
}

/**
 * Frequency groups of the Sky / SNR band filter, by carrier frequency. The
 * names are the bands the Stream Monitor reports in `snr_by_band`
 * (services/stream_decoders: NMEA signal ids, SBF signal types).
 * L2 takes Galileo E5b and BeiDou B2I / B2b (1207 MHz): the second band of
 * L1 / L2 receivers such as the u-blox F9. E5 AltBOC, B2 (B2a + B2b) and
 * NavIC S show under All only.
 */
export const BAND_GROUPS: Record<string, string[]> = {
  L1: ['L1', 'G1', 'E1', 'B1I', 'B1C'],
  L2: ['L2', 'G2', 'E5b', 'B2I', 'B2b'],
  L5: ['L5', 'G3', 'E5a', 'B2a'],
  L6: ['E6', 'L6', 'B3'],
};

/** Satellites that report per-band C/N0 (the Stream Monitor does; RT does not). */
export function hasBandSnr(sats: Satellite[]): boolean {
  return sats.some((s) => s.snr_by_band && Object.keys(s.snr_by_band).length > 0);
}

/** Groups with at least one band in the data, in BAND_GROUPS order. */
export function bandGroupsIn(sats: Satellite[]): string[] {
  const bands = new Set(sats.flatMap((s) => Object.keys(s.snr_by_band ?? {})));
  return Object.keys(BAND_GROUPS).filter((g) => BAND_GROUPS[g].some((b) => bands.has(b)));
}

/** The satellite's strongest signal in a group, or null when it has none. */
export function bandSnr(sat: Satellite, group: string): { band: string; snr: number } | null {
  let best: { band: string; snr: number } | null = null;
  for (const band of BAND_GROUPS[group] ?? []) {
    const snr = sat.snr_by_band?.[band];
    if (snr != null && (best === null || snr > best.snr)) best = { band, snr };
  }
  return best;
}
