/**
 * Map a parsed TOML config dict to MrtkPostConfig form state.
 * Unknown keys are ignored (preserved in rawConfig for lossless re-export).
 */

import type { MrtkPostConfig } from '../types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';

type AnyDict = Record<string, unknown>;

function get<T>(obj: AnyDict | undefined, key: string, fallback: T): T {
  if (!obj || !(key in obj)) return fallback;
  return obj[key] as T;
}

/** Convert TOML bool (true/false) to "on"/"off" string, pass strings through. */
function boolToOnOff(obj: AnyDict | undefined, key: string, fallback: string): string {
  if (!obj || !(key in obj)) return fallback;
  const v = obj[key];
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

// Reverse maps: MRTKLIB TOML values → frontend internal values
const EPHEM_REV: Record<string, string> = {
  'brdc': 'broadcast', 'precise': 'precise', 'brdc+sbas': 'broadcast+sbas',
  'brdc+ssrapc': 'broadcast+ssrapc', 'brdc+ssrcom': 'broadcast+ssrcom',
};
const IONO_REV: Record<string, string> = {
  'off': 'off', 'brdc': 'broadcast', 'sbas': 'sbas', 'dual-freq': 'dual-freq',
  'est-stec': 'est-stec', 'ionex-tec': 'ionex-tec', 'qzs-brdc': 'qzs-brdc',
  'est-adaptive': 'est-adaptive',
};
const TROPO_REV: Record<string, string> = {
  'off': 'off', 'saas': 'saastamoinen', 'sbas': 'sbas',
  'est-ztd': 'est-ztd', 'est-ztdgrad': 'est-ztd-grad',
};
const FREQ_REV: Record<string, string> = {
  'l1': 'l1', 'l1+2': 'l1+l2', 'l1+2+3': 'l1+l2+l5',
  'l1+2+3+4': 'l1+l2+l5+l6', 'l1+2+3+4+5': 'l1+l2+l5+l6+l7',
};
const MODE_REV: Record<string, string> = {
  'ppp-kine': 'ppp-kinematic', 'movingbase': 'moving-base',
};
const COORD_FMT_REV: Record<string, string> = {
  'deg': 'ddd.ddddddd', 'dms': 'ddd-mm-ss.sss',
};

function revMap(v: string, map: Record<string, string>): string {
  return map[v] ?? v;
}

/** Reconstruct frontend timeFormat from TOML time_system + time_format. */
function revTimeFormat(timeSys: string, timeFmt: string): string {
  if (timeSys === 'utc') return 'utc';
  if (timeSys === 'jst') return 'jst';
  // gpst: tow → "gpst", hms → "gpst-hms"
  return timeFmt === 'tow' ? 'gpst' : 'gpst-hms';
}

export function tomlToConfig(toml: AnyDict): MrtkPostConfig {
  const d = DEFAULT_MRTK_POST_CONFIG;
  const pos = (toml.positioning ?? {}) as AnyDict;
  const corr = (pos.corrections ?? {}) as AnyDict;
  const atm = (pos.atmosphere ?? {}) as AnyDict;
  const snr = (pos.snr_mask ?? {}) as AnyDict;
  const clas = (pos.clas ?? {}) as AnyDict;
  const ar = (toml.ambiguity_resolution ?? {}) as AnyDict;
  const arTh = (ar.thresholds ?? {}) as AnyDict;
  const arCt = (ar.counters ?? {}) as AnyDict;
  const arPar = (ar.partial_ar ?? {}) as AnyDict;
  const arHold = (ar.hold ?? {}) as AnyDict;
  const rej = (toml.rejection ?? {}) as AnyDict;
  const slip = (toml.slip_detection ?? {}) as AnyDict;
  const kf = (toml.kalman_filter ?? {}) as AnyDict;
  const kfMe = (kf.measurement_error ?? {}) as AnyDict;
  const kfPn = (kf.process_noise ?? {}) as AnyDict;
  const kfIs = (kf.initial_std ?? {}) as AnyDict;
  const sig = (toml.signals ?? {}) as AnyDict;
  const rx = (toml.receiver ?? {}) as AnyDict;
  const antR = ((toml.antenna ?? {}) as AnyDict).rover as AnyDict | undefined;
  const antB = ((toml.antenna ?? {}) as AnyDict).base as AnyDict | undefined;
  const out = (toml.output ?? {}) as AnyDict;
  const files = (toml.files ?? {}) as AnyDict;
  const srv = (toml.server ?? {}) as AnyDict;
  const af = (toml.adaptive_filter ?? {}) as AnyDict;

  // Map systems array back to constellations object
  const systems = (pos.systems ?? []) as string[];
  const constellations = systems.length > 0
    ? {
        gps: systems.includes('GPS'),
        glonass: systems.includes('GLONASS'),
        galileo: systems.includes('Galileo'),
        qzss: systems.includes('QZSS'),
        sbas: systems.includes('SBAS'),
        beidou: systems.includes('BeiDou'),
        irnss: systems.includes('NavIC'),
      }
    : d.positioning.constellations;

  return {
    positioning: {
      positioningMode: revMap(get(pos, 'mode', d.positioning.positioningMode), MODE_REV) as MrtkPostConfig['positioning']['positioningMode'],
      frequency: revMap(get(pos, 'frequency', d.positioning.frequency), FREQ_REV) as MrtkPostConfig['positioning']['frequency'],
      signals: Array.isArray(pos.signals) ? (pos.signals as string[]).join(',') : get(pos, 'signals', d.positioning.signals),
      signalMode: pos.signals ? 'signals' : 'frequency',
      filterType: get(pos, 'solution_type', d.positioning.filterType),
      elevationMask: get(pos, 'elevation_mask', d.positioning.elevationMask),
      receiverDynamics: get(pos, 'dynamics', false) ? 'on' : 'off',
      ephemerisOption: revMap(
        get(pos, 'satellite_ephemeris', '') || get(pos, 'ephemeris_option', '') || d.positioning.ephemerisOption,
        EPHEM_REV,
      ) as MrtkPostConfig['positioning']['ephemerisOption'],
      constellations,
      excludedSatellites: Array.isArray(pos.excluded_sats) ? (pos.excluded_sats as string[]).join(' ') : get(pos, 'excluded_sats', d.positioning.excludedSatellites),
      snrMask: {
        enableRover: get(snr, 'rover_enabled', d.positioning.snrMask.enableRover),
        enableBase: get(snr, 'base_enabled', d.positioning.snrMask.enableBase),
        mask: [
          get(snr, 'L1', d.positioning.snrMask.mask[0]),
          get(snr, 'L2', d.positioning.snrMask.mask[1]),
          get(snr, 'L5', d.positioning.snrMask.mask[2]),
        ],
      },
      corrections: {
        ...d.positioning.corrections,
        satelliteAntenna: get(corr, 'satellite_antenna', d.positioning.corrections.satelliteAntenna),
        receiverAntenna: get(corr, 'receiver_antenna', d.positioning.corrections.receiverAntenna),
        phaseWindup: get(corr, 'phase_windup', d.positioning.corrections.phaseWindup),
        excludeEclipse: get(corr, 'exclude_eclipse', d.positioning.corrections.excludeEclipse),
        raimFde: get(corr, 'raim_fde', d.positioning.corrections.raimFde),
        ionoCompensation: get(corr, 'iono_compensation', d.positioning.corrections.ionoCompensation),
        partialAr: get(corr, 'partial_ar', d.positioning.corrections.partialAr),
        shapiroDelay: get(corr, 'shapiro_delay', d.positioning.corrections.shapiroDelay),
        excludeQzsRef: get(corr, 'exclude_qzs_ref', d.positioning.corrections.excludeQzsRef),
        noPhaseBiasAdj: get(corr, 'no_phase_bias_adj', d.positioning.corrections.noPhaseBiasAdj),
        tidalCorrection: get(corr, 'tidal_correction', d.positioning.corrections.tidalCorrection),
      },
      atmosphere: {
        ionosphere: revMap(get(atm, 'ionosphere', d.positioning.atmosphere.ionosphere), IONO_REV) as MrtkPostConfig['positioning']['atmosphere']['ionosphere'],
        troposphere: revMap(get(atm, 'troposphere', d.positioning.atmosphere.troposphere), TROPO_REV) as MrtkPostConfig['positioning']['atmosphere']['troposphere'],
      },
      clas: {
        gridSelectionRadius: get(clas, 'grid_selection_radius', d.positioning.clas.gridSelectionRadius),
        receiverType: get(clas, 'receiver_type', d.positioning.clas.receiverType),
        positionUncertaintyX: get(clas, 'position_uncertainty_x', d.positioning.clas.positionUncertaintyX),
        positionUncertaintyY: get(clas, 'position_uncertainty_y', d.positioning.clas.positionUncertaintyY),
        positionUncertaintyZ: get(clas, 'position_uncertainty_z', d.positioning.clas.positionUncertaintyZ),
      },
    },
    ambiguityResolution: {
      ...d.ambiguityResolution,
      mode: get(ar, 'mode', d.ambiguityResolution.mode),
      gpsAr: get(ar, 'gps_ar', d.ambiguityResolution.gpsAr),
      glonassAr: boolToOnOff(ar, 'glonass_ar', d.ambiguityResolution.glonassAr) as typeof d.ambiguityResolution.glonassAr,
      bdsAr: boolToOnOff(ar, 'bds_ar', d.ambiguityResolution.bdsAr) as typeof d.ambiguityResolution.bdsAr,
      qzsAr: boolToOnOff(ar, 'qzs_ar', d.ambiguityResolution.qzsAr) as typeof d.ambiguityResolution.qzsAr,
      thresholds: {
        ...d.ambiguityResolution.thresholds,
        ratio: get(arTh, 'ratio', d.ambiguityResolution.thresholds.ratio),
        ratio1: get(arTh, 'ratio1', d.ambiguityResolution.thresholds.ratio1),
        ratio2: get(arTh, 'ratio2', d.ambiguityResolution.thresholds.ratio2),
        ratio3: get(arTh, 'ratio3', d.ambiguityResolution.thresholds.ratio3),
        ratio4: get(arTh, 'ratio4', d.ambiguityResolution.thresholds.ratio4),
        ratio5: get(arTh, 'ratio5', d.ambiguityResolution.thresholds.ratio5),
        ratio6: get(arTh, 'ratio6', d.ambiguityResolution.thresholds.ratio6),
        alpha: get(arTh, 'alpha', d.ambiguityResolution.thresholds.alpha),
        elevationMask: get(arTh, 'elevation_mask', d.ambiguityResolution.thresholds.elevationMask),
        holdElevation: get(arTh, 'hold_elevation', d.ambiguityResolution.thresholds.holdElevation),
      },
      counters: {
        ...d.ambiguityResolution.counters,
        lockCount: get(arCt, 'lock_count', d.ambiguityResolution.counters.lockCount),
        minFix: get(arCt, 'min_fix', d.ambiguityResolution.counters.minFix),
        maxIterations: get(arCt, 'max_iterations', d.ambiguityResolution.counters.maxIterations),
        outCount: get(arCt, 'out_count', d.ambiguityResolution.counters.outCount),
      },
      partialAr: {
        ...d.ambiguityResolution.partialAr,
        minAmbiguities: get(arPar, 'min_ambiguities', d.ambiguityResolution.partialAr.minAmbiguities),
        maxExcludedSats: get(arPar, 'max_excluded_sats', d.ambiguityResolution.partialAr.maxExcludedSats),
        minFixSats: get(arPar, 'min_fix_sats', d.ambiguityResolution.partialAr.minFixSats),
        minDropSats: get(arPar, 'min_drop_sats', d.ambiguityResolution.partialAr.minDropSats),
        minHoldSats: get(arPar, 'min_hold_sats', d.ambiguityResolution.partialAr.minHoldSats),
        arFilter: get(arPar, 'ar_filter', d.ambiguityResolution.partialAr.arFilter),
      },
      hold: {
        variance: get(arHold, 'variance', d.ambiguityResolution.hold.variance),
        gain: get(arHold, 'gain', d.ambiguityResolution.hold.gain),
      },
    },
    rejection: {
      ...d.rejection,
      innovation: get(rej, 'innovation', d.rejection.innovation),
      gdop: get(rej, 'gdop', d.rejection.gdop),
      l1L2Residual: get(rej, 'l1_l2_residual', d.rejection.l1L2Residual),
      dispersive: get(rej, 'dispersive', d.rejection.dispersive),
      nonDispersive: get(rej, 'non_dispersive', d.rejection.nonDispersive),
      holdChiSquare: get(rej, 'hold_chi_square', d.rejection.holdChiSquare),
      fixChiSquare: get(rej, 'fix_chi_square', d.rejection.fixChiSquare),
      pseudorangeDiff: get(rej, 'pseudorange_diff', d.rejection.pseudorangeDiff),
      positionErrorCount: get(rej, 'position_error_count', d.rejection.positionErrorCount),
    },
    slipDetection: {
      ...d.slipDetection,
      threshold: get(slip, 'threshold', d.slipDetection.threshold),
    },
    kalmanFilter: {
      iterations: get(kf, 'iterations', d.kalmanFilter.iterations),
      syncSolution: get(kf, 'sync_solution', d.kalmanFilter.syncSolution),
      measurementError: {
        ...d.kalmanFilter.measurementError,
        codePhaseRatioL1: get(kfMe, 'code_phase_ratio_L1', d.kalmanFilter.measurementError.codePhaseRatioL1),
        codePhaseRatioL2: get(kfMe, 'code_phase_ratio_L2', d.kalmanFilter.measurementError.codePhaseRatioL2),
        codePhaseRatioL5: get(kfMe, 'code_phase_ratio_L5', d.kalmanFilter.measurementError.codePhaseRatioL5),
        phase: get(kfMe, 'phase', d.kalmanFilter.measurementError.phase),
        phaseElevation: get(kfMe, 'phase_elevation', d.kalmanFilter.measurementError.phaseElevation),
        phaseBaseline: get(kfMe, 'phase_baseline', d.kalmanFilter.measurementError.phaseBaseline),
        doppler: get(kfMe, 'doppler', d.kalmanFilter.measurementError.doppler),
      },
      initialStd: {
        bias: get(kfIs, 'bias', d.kalmanFilter.initialStd.bias),
        ionosphere: get(kfIs, 'ionosphere', d.kalmanFilter.initialStd.ionosphere),
        troposphere: get(kfIs, 'troposphere', d.kalmanFilter.initialStd.troposphere),
      },
      processNoise: {
        ...d.kalmanFilter.processNoise,
        accelH: get(kfPn, 'accel_h', d.kalmanFilter.processNoise.accelH),
        accelV: get(kfPn, 'accel_v', d.kalmanFilter.processNoise.accelV),
        positionH: get(kfPn, 'position_h', d.kalmanFilter.processNoise.positionH),
        positionV: get(kfPn, 'position_v', d.kalmanFilter.processNoise.positionV),
        position: get(kfPn, 'position', d.kalmanFilter.processNoise.position),
        bias: get(kfPn, 'bias', d.kalmanFilter.processNoise.bias),
        ionosphere: get(kfPn, 'ionosphere', d.kalmanFilter.processNoise.ionosphere),
        ionoMax: get(kfPn, 'iono_max', d.kalmanFilter.processNoise.ionoMax),
        troposphere: get(kfPn, 'troposphere', d.kalmanFilter.processNoise.troposphere),
        ionoTimeConst: get(kfPn, 'iono_time_const', d.kalmanFilter.processNoise.ionoTimeConst),
        clockStability: get(kfPn, 'clock_stability', d.kalmanFilter.processNoise.clockStability),
        ifb: get(kfPn, 'ifb', d.kalmanFilter.processNoise.ifb),
      },
    },
    signalSelection: {
      gps: get(sig, 'gps', d.signalSelection.gps),
      qzs: get(sig, 'qzs', d.signalSelection.qzs),
      galileo: get(sig, 'galileo', d.signalSelection.galileo),
      bds2: get(sig, 'bds2', d.signalSelection.bds2),
      bds3: get(sig, 'bds3', d.signalSelection.bds3),
    },
    receiver: {
      ...d.receiver,
      ionoCorrection: get(rx, 'iono_correction', d.receiver.ionoCorrection),
      isb: get(rx, 'isb', d.receiver.isb),
      phaseShift: get(rx, 'phase_shift', d.receiver.phaseShift),
      referenceType: get(rx, 'reference_type', d.receiver.referenceType),
      maxAge: get(rx, 'max_age', d.receiver.maxAge),
      baselineLength: get(rx, 'baseline_length', d.receiver.baselineLength),
      baselineSigma: get(rx, 'baseline_sigma', d.receiver.baselineSigma),
    },
    antenna: {
      rover: {
        mode: get(antR, 'position_type', d.antenna.rover.mode),
        values: [
          get(antR, 'position_1', d.antenna.rover.values[0]),
          get(antR, 'position_2', d.antenna.rover.values[1]),
          get(antR, 'position_3', d.antenna.rover.values[2]),
        ],
        antennaTypeEnabled: (antR?.type && antR.type !== '*') ? true : d.antenna.rover.antennaTypeEnabled,
        antennaType: get(antR, 'type', d.antenna.rover.antennaType),
        antennaDelta: [
          get(antR, 'delta_e', d.antenna.rover.antennaDelta[0]),
          get(antR, 'delta_n', d.antenna.rover.antennaDelta[1]),
          get(antR, 'delta_u', d.antenna.rover.antennaDelta[2]),
        ],
      },
      base: {
        mode: get(antB, 'position_type', d.antenna.base.mode),
        values: [
          get(antB, 'position_1', d.antenna.base.values[0]),
          get(antB, 'position_2', d.antenna.base.values[1]),
          get(antB, 'position_3', d.antenna.base.values[2]),
        ],
        antennaTypeEnabled: (antB?.type && antB.type !== '') ? true : d.antenna.base.antennaTypeEnabled,
        antennaType: get(antB, 'type', d.antenna.base.antennaType),
        antennaDelta: [
          get(antB, 'delta_e', d.antenna.base.antennaDelta[0]),
          get(antB, 'delta_n', d.antenna.base.antennaDelta[1]),
          get(antB, 'delta_u', d.antenna.base.antennaDelta[2]),
        ],
        maxAverageEpochs: get(antB, 'max_average_epochs', d.antenna.base.maxAverageEpochs),
        initReset: get(antB, 'init_reset', d.antenna.base.initReset),
      },
    },
    output: {
      ...d.output,
      solutionFormat: get(out, 'format', d.output.solutionFormat),
      outputHeader: get(out, 'header', d.output.outputHeader),
      outputProcessingOptions: get(out, 'options', d.output.outputProcessingOptions),
      outputVelocity: get(out, 'velocity', d.output.outputVelocity),
      timeFormat: revTimeFormat(
        get(out, 'time_system', 'gpst'),
        get(out, 'time_format', 'hms'),
      ) as MrtkPostConfig['output']['timeFormat'],
      numDecimals: get(out, 'time_decimals', d.output.numDecimals),
      latLonFormat: revMap(
        get(out, 'coordinate_format', d.output.latLonFormat),
        COORD_FMT_REV,
      ) as MrtkPostConfig['output']['latLonFormat'],
      fieldSeparator: get(out, 'field_separator', d.output.fieldSeparator),
      height: get(out, 'height_type', d.output.height),
      geoidModel: get(out, 'geoid_model', d.output.geoidModel),
      staticSolutionMode: get(out, 'static_solution', d.output.staticSolutionMode),
      outputSingleOnOutage: get(out, 'single_output', d.output.outputSingleOnOutage),
      nmeaIntervalRmcGga: get(out, 'nmea_interval_1', d.output.nmeaIntervalRmcGga),
      nmeaIntervalGsaGsv: get(out, 'nmea_interval_2', d.output.nmeaIntervalGsaGsv),
      outputSolutionStatus: get(out, 'solution_status', d.output.outputSolutionStatus),
      debugTrace: get(out, 'debug_trace', d.output.debugTrace),
    },
    files: {
      ...d.files,
      satelliteAtx: get(files, 'satellite_atx', d.files.satelliteAtx),
      receiverAtx: get(files, 'receiver_atx', d.files.receiverAtx),
      stationPos: get(files, 'station_pos', d.files.stationPos),
      geoid: get(files, 'geoid', d.files.geoid),
      ionosphere: get(files, 'ionosphere', d.files.ionosphere),
      dcb: get(files, 'dcb', d.files.dcb),
      eop: get(files, 'eop', d.files.eop),
      oceanLoading: get(files, 'ocean_loading', d.files.oceanLoading),
      cssrGrid: get(files, 'cssr_grid', d.files.cssrGrid),
      isbTable: get(files, 'isb_table', d.files.isbTable),
      phaseCycle: get(files, 'phase_cycle', d.files.phaseCycle),
      fcb: get(files, 'fcb', d.files.fcb),
      biasSinex: get(files, 'bias_sinex', d.files.biasSinex),
      elevationMaskFile: get(files, 'elevation_mask_file', d.files.elevationMaskFile),
    },
    server: {
      ...d.server,
      cycleMs: get(srv, 'cycle_ms', d.server.cycleMs),
      timeoutMs: get(srv, 'timeout_ms', d.server.timeoutMs),
      reconnectMs: get(srv, 'reconnect_ms', d.server.reconnectMs),
      nmeaCycleMs: get(srv, 'nmea_cycle_ms', d.server.nmeaCycleMs),
      bufferSize: get(srv, 'buffer_size', d.server.bufferSize),
      navMsgSelect: get(srv, 'nav_msg_select', d.server.navMsgSelect),
      proxy: get(srv, 'proxy', d.server.proxy),
      swapMargin: get(srv, 'swap_margin', d.server.swapMargin),
      timeInterpolation: get(srv, 'time_interpolation', d.server.timeInterpolation),
      sbasSatellite: get(srv, 'sbas_satellite', d.server.sbasSatellite),
      rinexOption1: get(srv, 'rinex_option_1', d.server.rinexOption1),
      rinexOption2: get(srv, 'rinex_option_2', d.server.rinexOption2),
      pppOption: get(srv, 'ppp_option', d.server.pppOption),
      rtcmOption: get(srv, 'rtcm_option', d.server.rtcmOption),
      l6Margin: get(srv, 'l6_margin', d.server.l6Margin),
      maxObsLoss: get(srv, 'max_obs_loss', d.server.maxObsLoss),
      floatCount: get(srv, 'float_count', d.server.floatCount),
    },
    adaptiveFilter: {
      ...d.adaptiveFilter,
      enabled: get(af, 'enabled', d.adaptiveFilter.enabled),
      ionoForgetting: get(af, 'iono_forgetting', d.adaptiveFilter.ionoForgetting),
      ionoGain: get(af, 'iono_gain', d.adaptiveFilter.ionoGain),
      pvaForgetting: get(af, 'pva_forgetting', d.adaptiveFilter.pvaForgetting),
      pvaGain: get(af, 'pva_gain', d.adaptiveFilter.pvaGain),
    },
    time: d.time,
  };
}
