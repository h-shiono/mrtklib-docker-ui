/**
 * rnx2rtkp configuration types
 */

export type PositioningMode =
  | 'single'
  | 'dgps'
  | 'kinematic'
  | 'static'
  | 'moving-base'
  | 'fixed'
  | 'ppp-kinematic'
  | 'ppp-static';

export type Frequency = 'l1' | 'l1+l2' | 'l1+l2+l5' | 'l1+l2+l5+l6' | 'l1+l2+l5+l6+l7';

export type FilterType = 'forward' | 'backward' | 'combined';

export type IonosphereCorrection = 'off' | 'broadcast' | 'sbas' | 'dual-freq' | 'est-stec' | 'ionex-tec';

export type TroposphereCorrection = 'off' | 'saastamoinen' | 'sbas' | 'est-ztd' | 'est-ztd-grad';

export type EphemerisOption = 'broadcast' | 'precise' | 'broadcast+sbas' | 'broadcast+ssrapc' | 'broadcast+ssrcom';

export type EarthTidesCorrection = 'off' | 'solid' | 'solid+otl' | 'solid+otl+pole';

export type ReceiverDynamics = 'off' | 'on';

export interface ConstellationSelection {
  gps: boolean;
  glonass: boolean;
  galileo: boolean;
  qzss: boolean;
  sbas: boolean;
  beidou: boolean;
  irnss: boolean;
}

export type ARMode = 'off' | 'continuous' | 'instantaneous' | 'fix-and-hold';

export type SolutionFormat = 'llh' | 'xyz' | 'enu' | 'nmea';

export type TimeFormat =
  | 'gpst'
  | 'gpst-hms'
  | 'utc'
  | 'jst';

export type LatLonFormat = 'ddd.ddddddd' | 'ddd-mm-ss.sss';

export type Datum = 'wgs84' | 'tokyo' | 'pz90.11';

export type HeightType = 'ellipsoidal' | 'geodetic';

export type GeoidModel = 'internal' | 'egm96' | 'egm08' | 'gsi2000';

export type StaticSolutionMode = 'all' | 'single' | 'fixed';

export type DebugTraceLevel = 'off' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5';

export interface SnrMaskConfig {
  enableRover: boolean;
  enableBase: boolean;
  // Matrix: [Frequency_Index][Elevation_Bin_Index]
  // Frequencies: L1=0, L2=1, L5=2
  // Elevation bins: <5, 15, 25, 35, 45, 55, 65, 75, >85 (9 bins)
  mask: number[][]; // 3x9 matrix
}

export interface Setting1Config {
  // Group A: Basic Strategy
  positioningMode: PositioningMode;
  frequency: Frequency;
  filterType: FilterType;

  // Group B: Masks & Environment
  elevationMask: number; // degrees
  snrMask: SnrMaskConfig;
  ionosphereCorrection: IonosphereCorrection;
  troposphereCorrection: TroposphereCorrection;
  ephemerisOption: EphemerisOption;

  // Group C: Satellite Selection
  constellations: ConstellationSelection;
  excludedSatellites: string;

  // Group D: Advanced Options
  earthTidesCorrection: EarthTidesCorrection;
  receiverDynamics: ReceiverDynamics;
  satellitePcv: boolean;
  receiverPcv: boolean;
  phaseWindup: boolean;
  rejectEclipse: boolean;
  raimFde: boolean;
  dbCorr: boolean;
}

export type GpsArMode = 'off' | 'continuous' | 'instantaneous' | 'fix-and-hold' | 'ppp-ar';
export type GloArMode = 'off' | 'on' | 'autocal';
export type BdsArMode = 'off' | 'on';

export interface BaselineLengthConstraint {
  enabled: boolean;
  length: number; // meters
  sigma: number; // meters
}

export interface Setting2Config {
  // Section A: Ambiguity Resolution Strategy
  gpsArMode: GpsArMode;
  gloArMode: GloArMode;
  bdsArMode: BdsArMode;
  minRatioToFix: number;

  // Section B: Thresholds & Validation
  minConfidence: number;
  maxFcb: number;
  minLockToFix: number;
  minElevationToFix: number; // degrees
  minFixToHold: number;
  minElevationToHold: number; // degrees
  outageToReset: number; // seconds
  slipThreshold: number; // meters
  maxAgeDiff: number; // seconds
  syncSolution: boolean;
  rejectThresholdGdop: number;
  rejectThresholdInnovation: number; // meters

  // Section C: Advanced Filter
  maxArIter: number;
  numFilterIterations: number;
  baselineLengthConstraint: BaselineLengthConstraint;
}

export interface OutputConfig {
  // Group A: Format Configuration
  solutionFormat: SolutionFormat;
  outputHeader: boolean;
  outputProcessingOptions: boolean;
  timeFormat: TimeFormat;
  numDecimals: number;
  latLonFormat: LatLonFormat;
  fieldSeparator: string;
  outputVelocity: boolean;

  // Group B: Datum & Geoid
  datum: Datum;
  height: HeightType;
  geoidModel: GeoidModel;

  // Group C: Output Control
  staticSolutionMode: StaticSolutionMode;
  outputSingleOnOutage: boolean;
  nmeaIntervalRmcGga: number; // seconds
  nmeaIntervalGsaGsv: number; // seconds
  outputSolutionStatus: DebugTraceLevel;
  debugTrace: DebugTraceLevel;
}

export interface StatsConfig {
  // Group A: Measurement Errors (1-sigma)
  codePhaseRatioL1: number;
  codePhaseRatioL2: number;
  phaseErrorA: number; // meters
  phaseErrorB: number; // meters
  phaseErrorBaseline: number; // m/10km
  dopplerFrequency: number; // Hz

  // Group B: Process Noises (1-sigma/sqrt(s))
  receiverAccelHoriz: number; // m/s²
  receiverAccelVert: number; // m/s²
  carrierPhaseBias: number; // cycle
  ionosphericDelay: number; // m/10km
  troposphericDelay: number; // m
  satelliteClockStability: number; // s/s
}

export type PositionType =
  | 'llh'
  | 'xyz'
  | 'rtcm'
  | 'rinex'
  | 'average';

export interface StationPosition {
  mode: PositionType;
  values: [number, number, number]; // [lat/x, lon/y, height/z]
  antennaTypeEnabled: boolean;
  antennaType: string;
  antennaDelta: [number, number, number]; // [E, N, U] in meters
}

export interface PositionsConfig {
  rover: StationPosition;
  base: StationPosition;
  stationPositionFile: string;
}

export interface BasePositionConfig {
  latitude: number;
  longitude: number;
  height: number;
  useRinexHeader: boolean;
}

export interface FilesConfig {
  antex1: string;
  antex2: string;
  geoid: string;
  dcb: string;
  eop: string;
  blq: string;
  ionosphere: string;
}

export interface MiscConfig {
  timeSystem: 'gpst' | 'utc' | 'jst';
  ionosphereCorrection: boolean;
  troposphereCorrection: boolean;
  timeInterpolation: boolean;
  dgpsCorrections: string;
  sbasSatSelection: number;
  rinexOptRover: string;
  rinexOptBase: string;
}

export interface TimeConfig {
  startEnabled: boolean;
  startDate: string; // "YYYY/MM/DD"
  startTime: string; // "HH:MM:SS"
  endEnabled: boolean;
  endDate: string;   // "YYYY/MM/DD"
  endTime: string;   // "HH:MM:SS"
  interval: number;  // seconds, 0 = use all epochs
}

export interface Rnx2RtkpConfig {
  setting1: Setting1Config;
  setting2: Setting2Config;
  output: OutputConfig;
  stats: StatsConfig;
  positions: PositionsConfig;
  basePosition: BasePositionConfig;
  files: FilesConfig;
  misc: MiscConfig;
  time: TimeConfig;
}

export interface Rnx2RtkpInputFiles {
  rover_obs_file: string;
  base_obs_file?: string;
  nav_file: string;
  output_file: string;
}

export interface Rnx2RtkpTimeRange {
  start_time?: string; // "YYYY/MM/DD HH:MM:SS" GPST format
  end_time?: string;
  interval?: number; // seconds
}

export interface Rnx2RtkpJob {
  inputFiles: Rnx2RtkpInputFiles;
  timeRange?: Rnx2RtkpTimeRange;
  config: Rnx2RtkpConfig;
}

// Default configurations
export const DEFAULT_SETTING1: Setting1Config = {
  // Group A: Basic Strategy
  positioningMode: 'kinematic',
  frequency: 'l1+l2',
  filterType: 'forward',

  // Group B: Masks & Environment
  elevationMask: 15,
  snrMask: {
    enableRover: false,
    enableBase: false,
    // Default mask values: 3 frequencies (L1, L2, L5) × 9 elevation bins
    mask: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0], // L1
      [0, 0, 0, 0, 0, 0, 0, 0, 0], // L2
      [0, 0, 0, 0, 0, 0, 0, 0, 0], // L5
    ],
  },
  ionosphereCorrection: 'broadcast',
  troposphereCorrection: 'saastamoinen',
  ephemerisOption: 'broadcast',

  // Group C: Satellite Selection
  constellations: {
    gps: true,
    glonass: true,
    galileo: true,
    qzss: true,
    sbas: true,
    beidou: true,
    irnss: false,
  },
  excludedSatellites: '',

  // Group D: Advanced Options
  earthTidesCorrection: 'off',
  receiverDynamics: 'off',
  satellitePcv: false,
  receiverPcv: false,
  phaseWindup: false,
  rejectEclipse: false,
  raimFde: false,
  dbCorr: false,
};

export const DEFAULT_SETTING2: Setting2Config = {
  // Section A: Ambiguity Resolution Strategy
  gpsArMode: 'continuous',
  gloArMode: 'on',
  bdsArMode: 'on',
  minRatioToFix: 3.0,

  // Section B: Thresholds & Validation
  minConfidence: 0.9999,
  maxFcb: 0.25,
  minLockToFix: 0,
  minElevationToFix: 0,
  minFixToHold: 10,
  minElevationToHold: 0,
  outageToReset: 5,
  slipThreshold: 0.05,
  maxAgeDiff: 30.0,
  syncSolution: false,
  rejectThresholdGdop: 30.0,
  rejectThresholdInnovation: 30.0,

  // Section C: Advanced Filter
  maxArIter: 1,
  numFilterIterations: 1,
  baselineLengthConstraint: {
    enabled: false,
    length: 0.0,
    sigma: 0.0,
  },
};

export const DEFAULT_OUTPUT: OutputConfig = {
  // Group A: Format Configuration
  solutionFormat: 'llh',
  outputHeader: true,
  outputProcessingOptions: false,
  timeFormat: 'gpst',
  numDecimals: 3,
  latLonFormat: 'ddd.ddddddd',
  fieldSeparator: '',
  outputVelocity: false,

  // Group B: Datum & Geoid
  datum: 'wgs84',
  height: 'ellipsoidal',
  geoidModel: 'internal',

  // Group C: Output Control
  staticSolutionMode: 'all',
  outputSingleOnOutage: false,
  nmeaIntervalRmcGga: 0,
  nmeaIntervalGsaGsv: 0,
  outputSolutionStatus: 'off',
  debugTrace: 'off',
};

export const DEFAULT_STATS: StatsConfig = {
  // Group A: Measurement Errors (1-sigma)
  codePhaseRatioL1: 100.0,
  codePhaseRatioL2: 100.0,
  phaseErrorA: 0.003,
  phaseErrorB: 0.003,
  phaseErrorBaseline: 0.0,
  dopplerFrequency: 1.0,

  // Group B: Process Noises (1-sigma/sqrt(s))
  receiverAccelHoriz: 1.0,
  receiverAccelVert: 0.1,
  carrierPhaseBias: 0.0001,
  ionosphericDelay: 0.001,
  troposphericDelay: 0.0001,
  satelliteClockStability: 5e-12,
};

export const DEFAULT_POSITIONS: PositionsConfig = {
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
  stationPositionFile: '',
};

export const DEFAULT_BASE_POSITION: BasePositionConfig = {
  latitude: 0,
  longitude: 0,
  height: 0,
  useRinexHeader: true,
};

export const DEFAULT_FILES: FilesConfig = {
  antex1: '',
  antex2: '',
  geoid: '',
  dcb: '',
  eop: '',
  blq: '',
  ionosphere: '',
};

export const DEFAULT_MISC: MiscConfig = {
  timeSystem: 'gpst',
  ionosphereCorrection: true,
  troposphereCorrection: true,
  timeInterpolation: false,
  dgpsCorrections: 'off',
  sbasSatSelection: 0,
  rinexOptRover: '',
  rinexOptBase: '',
};

export const DEFAULT_TIME: TimeConfig = {
  startEnabled: false,
  startDate: '2000/01/01',
  startTime: '00:00:00',
  endEnabled: false,
  endDate: '2000/01/01',
  endTime: '00:00:00',
  interval: 0,
};

export const DEFAULT_RNX2RTKP_CONFIG: Rnx2RtkpConfig = {
  setting1: DEFAULT_SETTING1,
  setting2: DEFAULT_SETTING2,
  output: DEFAULT_OUTPUT,
  stats: DEFAULT_STATS,
  positions: DEFAULT_POSITIONS,
  basePosition: DEFAULT_BASE_POSITION,
  files: DEFAULT_FILES,
  misc: DEFAULT_MISC,
  time: DEFAULT_TIME,
};
