/**
 * One satellite in view, as the Real-Time backend (rtkrcv satellite status)
 * and the Stream Monitor (receiver stream) send it. Fields only one source
 * has are optional; `null` means the source did not report the value.
 */
export interface Satellite {
  prn: string;
  system: string;
  /** Degrees; null when the stream gave no position (e.g. SBF without SatVisibility). */
  azimuth: number | null;
  elevation: number | null;
  /** C/N0 in dBHz; null or ≤ 0 = not available. */
  snr: number | null;
  /** Counted in the solution's ns. RT: valid on L1 in the RTK / PPP filter, or
   *  the SPP flag when no filter is running (#120). Stream Monitor: as the
   *  receiver reports it; null = the format does not say. */
  used?: boolean | null;
  /** RT only: valid in the single point (SPP) solution (rtkrcv C1 column). */
  valid?: boolean;
  /** RT only: ambiguity state (rtkrcv "Fix" column, e.g. FIX / FLOAT / NONE). */
  fix?: string;
  /** Stream Monitor only: C/N0 per band, e.g. { L1: 44, L5: 47 }. */
  snr_by_band?: Record<string, number>;
}
