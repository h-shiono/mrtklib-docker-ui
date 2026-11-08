/** One position epoch: from a solution file (.pos / NMEA), Real-Time or a
 *  live stream (Stream Monitor). `null` = the source does not carry the
 *  value (e.g. NMEA has no AR ratio); never a made-up 0. */
export interface PosEpoch {
  /** Epoch time as a Date whose UTC fields carry the source's time system */
  time: Date;
  /** `time` as unix seconds (for uPlot X-axis) */
  timeUnix: number;
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lon: number;
  /** Height in meters (ellipsoidal) */
  height: number | null;
  /** Quality flag (utils/quality.ts): 1=fix 2=float 3=sbas 4=dgps 5=single 6=ppp 7=dr */
  Q: number;
  /** Number of satellites */
  ns: number | null;
  /** Standard deviation north (m) */
  sdn: number | null;
  /** Standard deviation east (m) */
  sde: number | null;
  /** Standard deviation up (m) */
  sdu: number | null;
  /** Age of differential (s) */
  age: number | null;
  /** AR ratio */
  ratio: number | null;
  /** NMEA GGA station id (field 14); in MRTKLIB CLAS output the L6 source
   *  (utils/clasSource.ts). Absent for .pos and other sources. */
  refid?: number | null;
}

/** Parsed .pos file data including header info */
export interface PosFileData {
  epochs: PosEpoch[];
  headerRefPos: ReferencePosition | null;
  /** Caveat about the parsed data to show the user (e.g. NMEA date assumed). */
  notice?: string;
  /** Time system the epoch times are in: "GPST", "UTC" or "JST". */
  timeSystem: string;
}

/** A geodetic reference position (WGS84) */
export interface ReferencePosition {
  lat: number;
  lon: number;
  height: number;
}

/** Epoch with ENU coordinates relative to a reference point */
export interface ENUEpoch {
  time: Date;
  timeUnix: number;
  e: number;
  n: number;
  /** null when the epoch has no height */
  u: number | null;
  Q: number;
  ns: number | null;
  ratio: number | null;
}

/** Reference coordinate mode for ENU conversion */
export type ReferenceMode = 'mean' | 'median' | 'rinex-header' | 'manual-llh' | 'manual-xyz';

/** Which metric to plot on ENU chart Y-axis */
export type ChartMetric = 'e' | 'n' | 'u' | 'ns';
