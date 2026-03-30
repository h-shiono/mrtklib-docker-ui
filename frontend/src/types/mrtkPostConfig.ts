/**
 * MRTKLIB post-processing configuration types.
 *
 * Structured to match MRTKLIB TOML configuration sections (config-options.md):
 *   [positioning]  [ambiguity_resolution]  [rejection]  [slip_detection]
 *   [kalman_filter]  [adaptive_filter]  [signals]  [receiver]
 *   [antenna]  [output]  [files]  [server]
 */

// ─── Enums & Union Types ─────────────────────────────────────────────────────

export type PositioningMode =
  | 'single' | 'dgps' | 'kinematic' | 'static'
  | 'moving-base' | 'fixed'
  | 'ppp-kinematic' | 'ppp-static' | 'ppp-fixed' | 'ppp-rtk';

export type Frequency = 'l1' | 'l1+l2' | 'l1+l2+l5' | 'l1+l2+l5+l6' | 'l1+l2+l5+l6+l7';

export type FilterType = 'forward' | 'backward' | 'combined';

export type IonosphereCorrection =
  | 'off' | 'broadcast' | 'sbas' | 'dual-freq'
  | 'est-stec' | 'ionex-tec' | 'qzs-brdc' | 'est-adaptive';

export type TroposphereCorrection = 'off' | 'saastamoinen' | 'sbas' | 'est-ztd' | 'est-ztd-grad';

export type EphemerisOption = 'broadcast' | 'precise' | 'broadcast+sbas' | 'broadcast+ssrapc' | 'broadcast+ssrcom';

export type TidalCorrection = 'off' | 'on' | 'otl' | 'solid+otl-clasgrid+pole';

export type PhaseWindup = 'off' | 'on' | 'precise';

export type IonoCompensation = 'off' | 'ssr' | 'meas';

export type ReceiverDynamics = 'off' | 'on';

export type ARMode = 'off' | 'continuous' | 'instantaneous' | 'fix-and-hold' | 'ppp-ar';

export type GloARMode = 'off' | 'on' | 'autocal';

export type BdsARMode = 'off' | 'on';

export type QzsARMode = 'off' | 'on';

export type ARAlpha = '0.1%' | '0.5%' | '1%' | '5%' | '10%' | '20%';

export type SolutionFormat = 'llh' | 'xyz' | 'enu' | 'nmea';

export type TimeSystem = 'gpst' | 'utc' | 'jst';

export type TimeDisplayFormat = 'tow' | 'hms';

// UI-combined time format (kept for backward compat in UI selectors)
export type TimeFormat = 'gpst' | 'gpst-hms' | 'utc' | 'jst';

export type CoordinateFormat = 'deg' | 'dms';

export type LatLonFormat = 'ddd.ddddddd' | 'ddd-mm-ss.sss';

export type Datum = 'wgs84' | 'tokyo' | 'pz90.11';

export type HeightType = 'ellipsoidal' | 'geodetic';

export type GeoidModel = 'internal' | 'egm96' | 'egm08_2.5' | 'egm08_1' | 'gsi2000';

export type StaticSolutionMode = 'all' | 'single' | 'fixed';

export type SolutionStatus = 'off' | 'state' | 'residual';

export type DebugTraceLevel = 'off' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5';

export type PositionType = 'llh' | 'xyz' | 'single' | 'posfile' | 'rinexhead' | 'rtcm' | 'raw';

export type PhaseShift = 'off' | 'table';

export type GpsFrequency = 'l1' | 'l1+l2' | 'l1+l5' | 'l1+l2+l5' | 'l1+l5(l2)';

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

export interface CorrectionsConfig {
  satelliteAntenna: boolean;
  receiverAntenna: boolean;
  phaseWindup: PhaseWindup;
  excludeEclipse: boolean;
  raimFde: boolean;
  ionoCompensation: IonoCompensation;
  partialAr: boolean;
  shapiroDelay: boolean;
  excludeQzsRef: boolean;
  noPhaseBiasAdj: boolean;
  gpsFrequency: GpsFrequency;
  qzsFrequency: GpsFrequency;
  tidalCorrection: TidalCorrection;
}

export interface AtmosphereConfig {
  ionosphere: IonosphereCorrection;
  troposphere: TroposphereCorrection;
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
  corrections: CorrectionsConfig;

  // [positioning.atmosphere]
  atmosphere: AtmosphereConfig;

  // [positioning.clas] — only relevant when positioningMode === 'ppp-rtk'
  clas: ClasConfig;
}

// ─── [ambiguity_resolution] ──────────────────────────────────────────────────

export interface ARThresholds {
  ratio: number;
  ratio1: number;
  ratio2: number;
  ratio3: number;
  ratio4: number;
  ratio5: number;
  ratio6: number;
  alpha: ARAlpha;
  elevationMask: number;
  holdElevation: number;
}

export interface ARCounters {
  lockCount: number;
  minFix: number;
  maxIterations: number;
  outCount: number;
}

export interface PartialARConfig {
  minAmbiguities: number;
  maxExcludedSats: number;
  minFixSats: number;
  minDropSats: number;
  minHoldSats: number;
  arFilter: boolean;
}

export interface ARHoldConfig {
  variance: number;
  gain: number;
}

export interface AmbiguityResolutionConfig {
  // [ambiguity_resolution]
  mode: ARMode;
  gpsAr: boolean;
  glonassAr: GloARMode;
  bdsAr: BdsARMode;
  qzsAr: QzsARMode;

  // [ambiguity_resolution.thresholds]
  thresholds: ARThresholds;

  // [ambiguity_resolution.counters]
  counters: ARCounters;

  // [ambiguity_resolution.partial_ar]
  partialAr: PartialARConfig;

  // [ambiguity_resolution.hold]
  hold: ARHoldConfig;
}

// ─── [rejection] ─────────────────────────────────────────────────────────────

export interface RejectionConfig {
  innovation: number;
  l1L2Residual: number;
  dispersive: number;
  nonDispersive: number;
  holdChiSquare: number;
  fixChiSquare: number;
  gdop: number;
  pseudorangeDiff: number;
  positionErrorCount: number;
}

// ─── [slip_detection] ────────────────────────────────────────────────────────

export interface SlipDetectionConfig {
  threshold: number;
  doppler: number;
}

// ─── [kalman_filter] ─────────────────────────────────────────────────────────

export interface MeasurementErrorConfig {
  codePhaseRatioL1: number;
  codePhaseRatioL2: number;
  codePhaseRatioL5: number;
  phase: number;
  phaseElevation: number;
  phaseBaseline: number;
  doppler: number;
  uraRatio: number;
}

export interface InitialStdConfig {
  bias: number;
  ionosphere: number;
  troposphere: number;
}

export interface ProcessNoiseConfig {
  bias: number;
  ionosphere: number;
  ionoMax: number;
  troposphere: number;
  accelH: number;
  accelV: number;
  positionH: number;
  positionV: number;
  position: number;
  ifb: number;
  ionoTimeConst: number;
  clockStability: number;
}

export interface KalmanFilterConfig {
  // [kalman_filter]
  iterations: number;
  syncSolution: boolean;

  // [kalman_filter.measurement_error]
  measurementError: MeasurementErrorConfig;

  // [kalman_filter.initial_std]
  initialStd: InitialStdConfig;

  // [kalman_filter.process_noise]
  processNoise: ProcessNoiseConfig;
}

// ─── [adaptive_filter] ──────────────────────────────────────────────────────

export interface AdaptiveFilterConfig {
  enabled: boolean;
  ionoForgetting: number;
  ionoGain: number;
  pvaForgetting: number;
  pvaGain: number;
}

// ─── [signals] ──────────────────────────────────────────────────────────────

export interface SignalSelectionConfig {
  gps: string;       // e.g. "L1/L2", "L1/L5", "L1/L2/L5"
  qzs: string;
  galileo: string;
  bds2: string;
  bds3: string;
}

// ─── [receiver] ─────────────────────────────────────────────────────────────

export interface ReceiverConfig {
  ionoCorrection: boolean;
  ignoreChiError: boolean;
  bds2Bias: boolean;
  pppSatClockBias: number;
  pppSatPhaseBias: number;
  uncorrBias: number;
  maxBiasDt: number;
  satelliteMode: number;
  phaseShift: PhaseShift;
  isb: boolean;
  referenceType: string;
  maxAge: number;
  baselineLength: number;
  baselineSigma: number;
}

// ─── [antenna] ───────────────────────────────────────────────────────────────

export interface StationPosition {
  mode: PositionType;
  values: [number, number, number];
  antennaTypeEnabled: boolean;
  antennaType: string;
  antennaDelta: [number, number, number]; // [E, N, U]
}

export interface BaseStationPosition extends StationPosition {
  maxAverageEpochs: number;
  initReset: boolean;
}

export interface AntennaConfig {
  rover: StationPosition;
  base: BaseStationPosition;
}

// ─── [output] ────────────────────────────────────────────────────────────────

export interface OutputConfig {
  solutionFormat: SolutionFormat;
  outputHeader: boolean;
  outputProcessingOptions: boolean;
  outputVelocity: boolean;
  timeFormat: TimeFormat;     // UI combined: gpst/gpst-hms/utc/jst
  numDecimals: number;
  latLonFormat: LatLonFormat;
  fieldSeparator: string;
  datum: Datum;
  height: HeightType;
  geoidModel: GeoidModel;
  staticSolutionMode: StaticSolutionMode;
  outputSingleOnOutage: boolean;
  maxSolutionStd: number;
  nmeaIntervalRmcGga: number;
  nmeaIntervalGsaGsv: number;
  outputSolutionStatus: SolutionStatus;
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
  elevationMaskFile: string;
  fcb: string;
  biasSinex: string;
  cssrGrid: string;
  isbTable: string;
  phaseCycle: string;
}

// ─── [server] ────────────────────────────────────────────────────────────────

export interface ServerConfig {
  cycleMs: number;
  timeoutMs: number;
  reconnectMs: number;
  nmeaCycleMs: number;
  bufferSize: number;
  navMsgSelect: string;
  proxy: string;
  swapMargin: number;
  timeInterpolation: boolean;
  sbasSatellite: string;
  rinexOption1: string;
  rinexOption2: string;
  pppOption: string;
  rtcmOption: string;
  l6Margin: number;
  maxObsLoss: number;
  floatCount: number;
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
  adaptiveFilter: AdaptiveFilterConfig;
  signalSelection: SignalSelectionConfig;
  receiver: ReceiverConfig;
  antenna: AntennaConfig;
  output: OutputConfig;
  files: FilesConfig;
  server: ServerConfig;
  time: TimeConfig;
}

// ─── API types ───────────────────────────────────────────────────────────────

export interface MrtkPostInputFiles {
  rover_obs_file: string;
  base_obs_file?: string;
  nav_file: string;
  correction_files: string[];  // SP3, CLK, FCB, IONEX, L6, etc.
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

export const DEFAULT_CORRECTIONS: CorrectionsConfig = {
  satelliteAntenna: false,
  receiverAntenna: false,
  phaseWindup: 'off',
  excludeEclipse: false,
  raimFde: false,
  ionoCompensation: 'off',
  partialAr: false,
  shapiroDelay: false,
  excludeQzsRef: false,
  noPhaseBiasAdj: false,
  gpsFrequency: 'l1+l2',
  qzsFrequency: 'l1+l2',
  tidalCorrection: 'off',
};

export const DEFAULT_ATMOSPHERE: AtmosphereConfig = {
  ionosphere: 'broadcast',
  troposphere: 'saastamoinen',
};

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
  corrections: DEFAULT_CORRECTIONS,
  atmosphere: DEFAULT_ATMOSPHERE,
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
  gpsAr: true,
  glonassAr: 'on',
  bdsAr: 'on',
  qzsAr: 'on',
  thresholds: {
    ratio: 3.0,
    ratio1: 0.9999,
    ratio2: 0.25,
    ratio3: 0.0,
    ratio4: 0.0,
    ratio5: 0.0,
    ratio6: 0.0,
    alpha: '0.1%',
    elevationMask: 0,
    holdElevation: 0,
  },
  counters: {
    lockCount: 0,
    minFix: 10,
    maxIterations: 1,
    outCount: 5,
  },
  partialAr: {
    minAmbiguities: 0,
    maxExcludedSats: 0,
    minFixSats: 4,
    minDropSats: 0,
    minHoldSats: 0,
    arFilter: false,
  },
  hold: {
    variance: 0.001,
    gain: 0.01,
  },
};

export const DEFAULT_REJECTION: RejectionConfig = {
  innovation: 30.0,
  l1L2Residual: 0.0,
  dispersive: 0.0,
  nonDispersive: 0.0,
  holdChiSquare: 0.0,
  fixChiSquare: 0.0,
  gdop: 30.0,
  pseudorangeDiff: 0.0,
  positionErrorCount: 0,
};

export const DEFAULT_SLIP_DETECTION: SlipDetectionConfig = {
  threshold: 0.05,
  doppler: 0.0,
};

export const DEFAULT_KALMAN_FILTER: KalmanFilterConfig = {
  iterations: 1,
  syncSolution: false,
  measurementError: {
    codePhaseRatioL1: 100.0,
    codePhaseRatioL2: 100.0,
    codePhaseRatioL5: 100.0,
    phase: 0.003,
    phaseElevation: 0.003,
    phaseBaseline: 0.0,
    doppler: 1.0,
    uraRatio: 0.0,
  },
  initialStd: {
    bias: 30.0,
    ionosphere: 0.03,
    troposphere: 0.3,
  },
  processNoise: {
    bias: 0.0001,
    ionosphere: 0.001,
    ionoMax: 0.0,
    troposphere: 0.0001,
    accelH: 1.0,
    accelV: 0.1,
    positionH: 0.0,
    positionV: 0.0,
    position: 0.0,
    ifb: 0.0,
    ionoTimeConst: 0.0,
    clockStability: 5e-12,
  },
};

export const DEFAULT_ADAPTIVE_FILTER: AdaptiveFilterConfig = {
  enabled: false,
  ionoForgetting: 0.0,
  ionoGain: 0.0,
  pvaForgetting: 0.0,
  pvaGain: 0.0,
};

export const DEFAULT_SIGNAL_SELECTION: SignalSelectionConfig = {
  gps: 'L1/L2',
  qzs: 'L1/L5',
  galileo: 'E1/E5a',
  bds2: 'B1I/B3I',
  bds3: 'B1I/B3I',
};

export const DEFAULT_RECEIVER: ReceiverConfig = {
  ionoCorrection: true,
  ignoreChiError: false,
  bds2Bias: false,
  pppSatClockBias: 0,
  pppSatPhaseBias: 0,
  uncorrBias: 0,
  maxBiasDt: 0,
  satelliteMode: 0,
  phaseShift: 'off',
  isb: false,
  referenceType: '',
  maxAge: 30.0,
  baselineLength: 0.0,
  baselineSigma: 0.0,
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
    maxAverageEpochs: 0,
    initReset: false,
  },
};

export const DEFAULT_OUTPUT: OutputConfig = {
  solutionFormat: 'llh',
  outputHeader: true,
  outputProcessingOptions: false,
  outputVelocity: false,
  timeFormat: 'gpst',
  numDecimals: 3,
  latLonFormat: 'ddd.ddddddd',
  fieldSeparator: '',
  datum: 'wgs84',
  height: 'ellipsoidal',
  geoidModel: 'internal',
  staticSolutionMode: 'all',
  outputSingleOnOutage: false,
  maxSolutionStd: 0.0,
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
  elevationMaskFile: '',
  fcb: '',
  biasSinex: '',
  cssrGrid: '',
  isbTable: '',
  phaseCycle: '',
};

export const DEFAULT_SERVER: ServerConfig = {
  cycleMs: 10,
  timeoutMs: 10000,
  reconnectMs: 10000,
  nmeaCycleMs: 5000,
  bufferSize: 32768,
  navMsgSelect: 'all',
  proxy: '',
  swapMargin: 30,
  timeInterpolation: false,
  sbasSatellite: '0',
  rinexOption1: '',
  rinexOption2: '',
  pppOption: '',
  rtcmOption: '',
  l6Margin: 0,
  maxObsLoss: 90.0,
  floatCount: 15,
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
  adaptiveFilter: DEFAULT_ADAPTIVE_FILTER,
  signalSelection: DEFAULT_SIGNAL_SELECTION,
  receiver: DEFAULT_RECEIVER,
  antenna: DEFAULT_ANTENNA,
  output: DEFAULT_OUTPUT,
  files: DEFAULT_FILES,
  server: DEFAULT_SERVER,
  time: DEFAULT_TIME,
};
