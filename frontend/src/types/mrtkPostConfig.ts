/**
 * MRTKLIB post-processing configuration types.
 *
 * Structured to match MRTKLIB TOML configuration sections:
 *   [positioning]  [ambiguity_resolution]  [rejection]  [slip_detection]
 *   [kalman_filter]  [antenna]  [output]  [files]  [server]  [receiver]
 */

// ─── Enums & Union Types ─────────────────────────────────────────────────────

export type PositioningMode =
  | 'single' | 'dgps' | 'kinematic' | 'static'
  | 'moving-base' | 'fixed'
  | 'ppp-kinematic' | 'ppp-static' | 'ppp-fixed' | 'ppp-rtk';

export type Frequency = 'l1' | 'l1+l2' | 'l1+l2+l5' | 'l1+l2+l5+l6' | 'l1+l2+l5+l6+l7';

export type FilterType = 'forward' | 'backward' | 'combined';

export type IonosphereCorrection = 'off' | 'broadcast' | 'sbas' | 'dual-freq' | 'est-stec' | 'ionex-tec';

export type TroposphereCorrection = 'off' | 'saastamoinen' | 'sbas' | 'est-ztd' | 'est-ztd-grad';

export type EphemerisOption = 'broadcast' | 'precise' | 'broadcast+sbas' | 'broadcast+ssrapc' | 'broadcast+ssrcom';

export type EarthTidesCorrection = 'off' | 'solid' | 'solid+otl' | 'solid+otl+pole';

export type ReceiverDynamics = 'off' | 'on';

export type ARMode = 'off' | 'continuous' | 'instantaneous' | 'fix-and-hold' | 'ppp-ar';

export type SolutionFormat = 'llh' | 'xyz' | 'enu' | 'nmea';

export type TimeFormat = 'gpst' | 'gpst-hms' | 'utc' | 'jst';

export type LatLonFormat = 'ddd.ddddddd' | 'ddd-mm-ss.sss';

export type Datum = 'wgs84' | 'tokyo' | 'pz90.11';

export type HeightType = 'ellipsoidal' | 'geodetic';

export type GeoidModel = 'internal' | 'egm96' | 'egm08' | 'gsi2000';

export type StaticSolutionMode = 'all' | 'single' | 'fixed';

export type DebugTraceLevel = 'off' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5';

export type PositionType = 'llh' | 'xyz' | 'rtcm' | 'rinex' | 'average';

// ─── [positioning] ───────────────────────────────────────────────────────────

export interface ConstellationSelection {
  gps: boolean;
  glonass: boolean;
  galileo: boolean;
  qzss: boolean;
  sbas: boolean;
  beidou: boolean;
  irnss: boolean;
}

export interface SnrMaskConfig {
  enableRover: boolean;
  enableBase: boolean;
  mask: number[][]; // 3x9 matrix: [L1, L2, L5] × [<5, 15, 25, 35, 45, 55, 65, 75, >85]
}

export type SignalMode = 'frequency' | 'signals';

export interface ClasConfig {
  gridSelectionRadius: number;   // m
  receiverType: string;
  positionUncertaintyX: number;  // m
  positionUncertaintyY: number;  // m
  positionUncertaintyZ: number;  // m
}

export interface PositioningConfig {
  // [positioning] core
  positioningMode: PositioningMode;
  frequency: Frequency;
  signalMode: SignalMode;         // UI-only: choose between frequency or signals
  signals: string;                // e.g. "G1C,G2W,E1C,E5Q,E7Q,J1C,J5Q,J2X"
  filterType: FilterType;
  elevationMask: number;
  receiverDynamics: ReceiverDynamics;
  ephemerisOption: EphemerisOption;
  constellations: ConstellationSelection;
  excludedSatellites: string;

  // [positioning.snr_mask]
  snrMask: SnrMaskConfig;

  // [positioning.corrections]
  satellitePcv: boolean;
  receiverPcv: boolean;
  phaseWindup: boolean;
  rejectEclipse: boolean;
  raimFde: boolean;
  earthTidesCorrection: EarthTidesCorrection;

  // [positioning.atmosphere]
  ionosphereCorrection: IonosphereCorrection;
  troposphereCorrection: TroposphereCorrection;

  // [positioning.clas] — only relevant when positioningMode === 'ppp-rtk'
  clas: ClasConfig;
}

// ─── [ambiguity_resolution] ──────────────────────────────────────────────────

export interface AmbiguityResolutionConfig {
  // [ambiguity_resolution]
  mode: ARMode;

  // [ambiguity_resolution.thresholds]
  ratio: number;
  elevationMask: number;
  holdElevation: number;

  // [ambiguity_resolution.counters]
  lockCount: number;
  minFix: number;
  maxIterations: number;
  outCount: number;
}

// ─── [rejection] ─────────────────────────────────────────────────────────────

export interface RejectionConfig {
  innovation: number;
  gdop: number;
}

// ─── [slip_detection] ────────────────────────────────────────────────────────

export interface SlipDetectionConfig {
  threshold: number;
}

// ─── [kalman_filter] ─────────────────────────────────────────────────────────

export interface KalmanFilterConfig {
  // [kalman_filter]
  iterations: number;
  syncSolution: boolean;

  // [kalman_filter.measurement_error]
  measurementError: {
    codePhaseRatioL1: number;
    codePhaseRatioL2: number;
    phase: number;
    phaseElevation: number;
    phaseBaseline: number;
    doppler: number;
  };

  // [kalman_filter.process_noise]
  processNoise: {
    bias: number;
    ionosphere: number;
    troposphere: number;
    accelH: number;
    accelV: number;
    clockStability: number;
  };
}

// ─── [antenna] ───────────────────────────────────────────────────────────────

export interface StationPosition {
  mode: PositionType;
  values: [number, number, number];
  antennaTypeEnabled: boolean;
  antennaType: string;
  antennaDelta: [number, number, number]; // [E, N, U]
}

export interface AntennaConfig {
  rover: StationPosition;
  base: StationPosition;
}

// ─── [output] ────────────────────────────────────────────────────────────────

export interface OutputConfig {
  solutionFormat: SolutionFormat;
  outputHeader: boolean;
  outputProcessingOptions: boolean;
  timeFormat: TimeFormat;
  numDecimals: number;
  latLonFormat: LatLonFormat;
  fieldSeparator: string;
  outputVelocity: boolean;
  datum: Datum;
  height: HeightType;
  geoidModel: GeoidModel;
  staticSolutionMode: StaticSolutionMode;
  outputSingleOnOutage: boolean;
  nmeaIntervalRmcGga: number;
  nmeaIntervalGsaGsv: number;
  outputSolutionStatus: DebugTraceLevel;
  debugTrace: DebugTraceLevel;
}

// ─── [files] ─────────────────────────────────────────────────────────────────

export interface FilesConfig {
  satelliteAtx: string;
  receiverAtx: string;
  stationPos: string;
  geoid: string;
  ionosphere: string;
  dcb: string;
  eop: string;
  oceanLoading: string;
  cssrGrid: string;
}

// ─── [server] + [receiver] ───────────────────────────────────────────────────

export interface ServerConfig {
  timeInterpolation: boolean;
  sbasSatellite: number;
  rinexOption1: string;
  rinexOption2: string;
}

export interface ReceiverConfig {
  ionoCorrection: boolean;
}

// ─── Time (UI-only, maps to CLI flags -ts/-te/-ti) ───────────────────────────

export interface TimeConfig {
  startEnabled: boolean;
  startDate: string;
  startTime: string;
  endEnabled: boolean;
  endDate: string;
  endTime: string;
  interval: number;
}

// ─── Top-level config ────────────────────────────────────────────────────────

export interface MrtkPostConfig {
  positioning: PositioningConfig;
  ambiguityResolution: AmbiguityResolutionConfig;
  rejection: RejectionConfig;
  slipDetection: SlipDetectionConfig;
  kalmanFilter: KalmanFilterConfig;
  antenna: AntennaConfig;
  output: OutputConfig;
  files: FilesConfig;
  server: ServerConfig;
  receiver: ReceiverConfig;
  time: TimeConfig;
}

// ─── API types ───────────────────────────────────────────────────────────────

export interface MrtkPostInputFiles {
  rover_obs_file: string;
  base_obs_file?: string;
  nav_file: string;
  output_file: string;
}

export interface MrtkPostTimeRange {
  start_time?: string;
  end_time?: string;
  interval?: number;
}

export interface MrtkPostJob {
  inputFiles: MrtkPostInputFiles;
  timeRange?: MrtkPostTimeRange;
  config: MrtkPostConfig;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_POSITIONING: PositioningConfig = {
  positioningMode: 'kinematic',
  frequency: 'l1+l2',
  signalMode: 'frequency',
  signals: '',
  filterType: 'forward',
  elevationMask: 15,
  receiverDynamics: 'off',
  ephemerisOption: 'broadcast',
  constellations: {
    gps: true, glonass: true, galileo: true, qzss: true,
    sbas: true, beidou: true, irnss: false,
  },
  excludedSatellites: '',
  snrMask: {
    enableRover: false,
    enableBase: false,
    mask: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  satellitePcv: false,
  receiverPcv: false,
  phaseWindup: false,
  rejectEclipse: false,
  raimFde: false,
  earthTidesCorrection: 'off',
  ionosphereCorrection: 'broadcast',
  troposphereCorrection: 'saastamoinen',
  clas: {
    gridSelectionRadius: 1000,
    receiverType: '',
    positionUncertaintyX: 10.0,
    positionUncertaintyY: 10.0,
    positionUncertaintyZ: 10.0,
  },
};

export const DEFAULT_AMBIGUITY_RESOLUTION: AmbiguityResolutionConfig = {
  mode: 'continuous',
  ratio: 3.0,
  elevationMask: 0,
  holdElevation: 0,
  lockCount: 0,
  minFix: 10,
  maxIterations: 1,
  outCount: 5,
};

export const DEFAULT_REJECTION: RejectionConfig = {
  innovation: 30.0,
  gdop: 30.0,
};

export const DEFAULT_SLIP_DETECTION: SlipDetectionConfig = {
  threshold: 0.05,
};

export const DEFAULT_KALMAN_FILTER: KalmanFilterConfig = {
  iterations: 1,
  syncSolution: false,
  measurementError: {
    codePhaseRatioL1: 100.0,
    codePhaseRatioL2: 100.0,
    phase: 0.003,
    phaseElevation: 0.003,
    phaseBaseline: 0.0,
    doppler: 1.0,
  },
  processNoise: {
    bias: 0.0001,
    ionosphere: 0.001,
    troposphere: 0.0001,
    accelH: 1.0,
    accelV: 0.1,
    clockStability: 5e-12,
  },
};

export const DEFAULT_ANTENNA: AntennaConfig = {
  rover: {
    mode: 'llh',
    values: [0, 0, 0],
    antennaTypeEnabled: false,
    antennaType: '',
    antennaDelta: [0, 0, 0],
  },
  base: {
    mode: 'llh',
    values: [0, 0, 0],
    antennaTypeEnabled: false,
    antennaType: '',
    antennaDelta: [0, 0, 0],
  },
};

export const DEFAULT_OUTPUT: OutputConfig = {
  solutionFormat: 'llh',
  outputHeader: true,
  outputProcessingOptions: false,
  timeFormat: 'gpst',
  numDecimals: 3,
  latLonFormat: 'ddd.ddddddd',
  fieldSeparator: '',
  outputVelocity: false,
  datum: 'wgs84',
  height: 'ellipsoidal',
  geoidModel: 'internal',
  staticSolutionMode: 'all',
  outputSingleOnOutage: false,
  nmeaIntervalRmcGga: 0,
  nmeaIntervalGsaGsv: 0,
  outputSolutionStatus: 'off',
  debugTrace: 'off',
};

export const DEFAULT_FILES: FilesConfig = {
  satelliteAtx: '',
  receiverAtx: '',
  stationPos: '',
  geoid: '',
  ionosphere: '',
  dcb: '',
  eop: '',
  oceanLoading: '',
  cssrGrid: '',
};

export const DEFAULT_SERVER: ServerConfig = {
  timeInterpolation: false,
  sbasSatellite: 0,
  rinexOption1: '',
  rinexOption2: '',
};

export const DEFAULT_RECEIVER: ReceiverConfig = {
  ionoCorrection: true,
};

// Generate today's date as YYYY/MM/DD
function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export const DEFAULT_TIME: TimeConfig = {
  startEnabled: false,
  startDate: getTodayString(),
  startTime: '00:00:00',
  endEnabled: false,
  endDate: getTodayString(),
  endTime: '23:59:59',
  interval: 0,
};

export const DEFAULT_MRTK_POST_CONFIG: MrtkPostConfig = {
  positioning: DEFAULT_POSITIONING,
  ambiguityResolution: DEFAULT_AMBIGUITY_RESOLUTION,
  rejection: DEFAULT_REJECTION,
  slipDetection: DEFAULT_SLIP_DETECTION,
  kalmanFilter: DEFAULT_KALMAN_FILTER,
  antenna: DEFAULT_ANTENNA,
  output: DEFAULT_OUTPUT,
  files: DEFAULT_FILES,
  server: DEFAULT_SERVER,
  receiver: DEFAULT_RECEIVER,
  time: DEFAULT_TIME,
};
