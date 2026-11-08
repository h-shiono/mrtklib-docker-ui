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
