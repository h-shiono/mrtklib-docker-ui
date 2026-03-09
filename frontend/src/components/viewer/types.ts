/** Single epoch from a RTKLIB .pos file */
export interface PosEpoch {
  /** GPST timestamp as Date object */
  time: Date;
  /** GPST timestamp as unix seconds (for uPlot X-axis) */
  timeUnix: number;
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lon: number;
  /** Height in meters (ellipsoidal) */
  height: number;
  /** Quality flag: 1=fix, 2=float, 3=sbas, 4=dgps, 5=single, 6=ppp */
  Q: number;
  /** Number of satellites */
  ns: number;
  /** Standard deviation north (m) */
  sdn: number;
  /** Standard deviation east (m) */
  sde: number;
  /** Standard deviation up (m) */
  sdu: number;
  /** Age of differential (s) */
  age: number;
  /** AR ratio */
  ratio: number;
}

/** Parsed .pos file data including header info */
export interface PosFileData {
  epochs: PosEpoch[];
  headerRefPos: ReferencePosition | null;
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
  u: number;
  Q: number;
  ns: number;
  ratio: number;
}

/** Reference coordinate mode for ENU conversion */
export type ReferenceMode = 'mean' | 'median' | 'rinex-header' | 'manual-llh' | 'manual-xyz';

/** Color mapping for Q flags */
export const Q_COLORS: Record<number, string> = {
  1: '#40c057', // green - fix
  2: '#fab005', // yellow/orange - float
  3: '#228be6', // blue - sbas
  4: '#15aabf', // cyan - dgps
  5: '#fa5252', // red - single
  6: '#be4bdb', // purple - ppp
};

/** Labels for Q flags */
export const Q_LABELS: Record<number, string> = {
  1: 'Fix',
  2: 'Float',
  3: 'SBAS',
  4: 'DGPS',
  5: 'Single',
  6: 'PPP',
};

/** Which metric to plot on ENU chart Y-axis */
export type ChartMetric = 'e' | 'n' | 'u' | 'ns';
