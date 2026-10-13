import type { Satellite } from '../components/SkySnrPanel';

/** In the solution's satellite count (ns): the backend's `used` (valid on L1
 *  in the RTK / PPP filter, else the SPP flag; #120). Shared by the metrics
 *  row and the Sky / SNR panel so both count the same satellites. */
export function isUsed(sat: Satellite): boolean {
  return sat.used ?? sat.valid;
}
