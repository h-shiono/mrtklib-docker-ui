// Option metadata — single source of truth for labels, tooltips, and docs anchors.

export interface OptionMeta {
  label: string;
  description?: string;
  docsAnchor: string;
  modes?: string[];
}

export const DOCS_BASE =
  'https://h-shiono.github.io/MRTKLIB/reference/config-options/';

// Mode abbreviation sets (from reference "Mode Abbreviations" table).
// SSR2OSR and VRS are future modes not yet in the PositioningMode union;
// they are included here so that option metadata is ready when support lands.
export const MODE_SETS = {
  ALL:     null,
  SPP:     ['single'],
  DGPS:    ['dgps'],
  RTK:     ['kinematic', 'static', 'moving-base', 'fixed'],
  PPP:     ['ppp-kinematic', 'ppp-static', 'ppp-fixed'],
  PPP_RTK: ['ppp-rtk'],
  SSR2OSR: ['ssr2osr', 'ssr2osr-fixed'],
  VRS:     ['vrs-rtk'],
} as const;

function modes(...sets: (readonly string[] | null)[]): string[] | undefined {
  const flat = sets.flatMap(s => s ?? []);
  return flat.length > 0 ? flat : undefined;
}

const OPTION_META_DEF = {

  // ── [positioning] ─────────────────────────────────────────────
  'positioning.mode': {
    label: 'Positioning Mode',
    docsAnchor: '#positioning',
  },
  'positioning.frequency': {
    label: 'Frequencies',
    description:
      'Number of carrier frequency slots to use. ' +
      'CLAS PPP-RTK requires L1+2 (nf=2). ' +
      'Using L1+2+3 with CLAS adds the E5b slot without valid bias, ' +
      'causing false cycle slips on Galileo.',
    docsAnchor: '#positioning',
  },
  'positioning.solution_type': {
    label: 'Filter Direction',
    description:
      'Processing direction for post-processing. ' +
      'Combined runs forward then backward and merges results.',
    docsAnchor: '#positioning',
  },
  'positioning.elevation_mask': {
    label: 'Elevation Mask (deg)',
    description:
      'Satellites below this elevation angle are excluded from processing.',
    docsAnchor: '#positioning',
  },
  'positioning.dynamics': {
    label: 'Receiver Dynamics',
    description:
      'Enable velocity/acceleration state estimation in the Kalman filter. ' +
      'Recommended for kinematic applications.',
    docsAnchor: '#positioning',
  },
  'positioning.satellite_ephemeris': {
    label: 'Satellite Ephemeris',
    description:
      'Ephemeris source. Use brdc+ssrapc or brdc+ssrcom for PPP/PPP-RTK ' +
      '(SSR orbit/clock corrections via L6E).',
    docsAnchor: '#positioning',
  },

  // ── [positioning.atmosphere] ───────────────────────────────────
  'atmosphere.ionosphere': {
    label: 'Ionosphere',
    description:
      'Ionospheric correction model. ' +
      'PPP: dual-freq or est-stec. ' +
      'PPP-RTK: est-stec or est-adaptive. ' +
      'RTK: dual-freq (dual frequency) or brdc (Klobuchar).',
    docsAnchor: '#positioning-atmosphere',
  },
  'atmosphere.troposphere': {
    label: 'Troposphere',
    description:
      'Tropospheric correction model. ' +
      'PPP/PPP-RTK: est-ztd or est-ztdgrad. ' +
      'SPP/RTK: saas (Saastamoinen).',
    docsAnchor: '#positioning-atmosphere',
  },

  // ── [ambiguity_resolution] ────────────────────────────────────
  'ar.mode': {
    label: 'AR Mode',
    description:
      'Ambiguity resolution strategy. ' +
      'fix-and-hold applies integer constraints after first fix.',
    docsAnchor: '#ambiguity-resolution',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.glonass_ar': {
    label: 'GLONASS AR',
    description: 'GLONASS ambiguity resolution. Requires GLONASS inter-channel bias calibration.',
    docsAnchor: '#ambiguity-resolution',
    modes: modes(MODE_SETS.RTK),
  },
  'ar.bds_ar': {
    label: 'BeiDou AR',
    docsAnchor: '#ambiguity-resolution',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.qzs_ar': {
    label: 'QZSS AR',
    docsAnchor: '#ambiguity-resolution',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },

  // ── [ambiguity_resolution.thresholds] ────────────────────────
  'ar.thresholds.ratio': {
    label: 'Ratio Threshold',
    description:
      'LAMBDA ratio test: 2nd-best / best integer candidate. ' +
      'Fix accepted when ratio exceeds this value. Typical: 3.0.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.thresholds.ratio1': {
    label: 'Ratio 1 (AR start threshold)',
    description:
      'In MADOCA-PPP: maximum 3D position std-dev (m) allowed before ' +
      'narrow-lane AR is attempted. AR is suppressed when position ' +
      'uncertainty exceeds this value.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP, MODE_SETS.PPP_RTK),
  },
  'ar.thresholds.ratio2': {
    label: 'Ratio 2',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.thresholds.ratio3': {
    label: 'Ratio 3',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.thresholds.ratio4': {
    label: 'Ratio 4',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK),
  },
  'ar.thresholds.ratio5': {
    label: 'Ratio 5 (hold chi-sq threshold)',
    description: 'Chi-square threshold for hold-mode outlier validation.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.PPP_RTK),
  },
  'ar.thresholds.ratio6': {
    label: 'Ratio 6 (fix chi-sq threshold)',
    description: 'Chi-square threshold for fix-mode outlier validation.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.PPP_RTK),
  },
  'ar.thresholds.alpha': {
    label: 'AR Significance Level',
    description:
      'ILS (Integer Least Squares) success rate significance level. ' +
      'Lower percentage = stricter fix criterion.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.thresholds.elevation_mask': {
    label: 'AR Elevation Mask (deg)',
    description: 'Minimum satellite elevation for AR participation.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.thresholds.hold_elevation': {
    label: 'Hold Elevation Mask (deg)',
    description:
      'Minimum satellite elevation for fix-and-hold constraint application.',
    docsAnchor: '#ambiguity-resolution-thresholds',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },

  // ── [ambiguity_resolution.counters] ───────────────────────────
  'ar.counters.lock_count': {
    label: 'Lock Count (min)',
    description:
      'Minimum continuous lock count before a satellite participates in AR.',
    docsAnchor: '#ambiguity-resolution-counters',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.counters.min_fix': {
    label: 'Min Fix Epochs',
    description: 'Minimum consecutive fix epochs before fix-and-hold activates.',
    docsAnchor: '#ambiguity-resolution-counters',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.counters.max_iterations': {
    label: 'Max LAMBDA Iterations',
    description: 'Maximum LAMBDA integer search iterations per epoch.',
    docsAnchor: '#ambiguity-resolution-counters',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.counters.out_count': {
    label: 'Outage Reset Count',
    description: 'Reset ambiguity states after this many consecutive outage epochs.',
    docsAnchor: '#ambiguity-resolution-counters',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },

  // ── [ambiguity_resolution.partial_ar] ────────────────────────
  'ar.partial_ar.min_ambiguities': {
    label: 'Min Ambiguities',
    description: 'Minimum ambiguities required for a partial AR attempt.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.partial_ar.max_excluded_sats': {
    label: 'Max Excluded Sats',
    description: 'Maximum satellites to exclude during partial AR rotation.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'ar.partial_ar.min_fix_sats': {
    label: 'Min Fix Pairs',
    description: 'Minimum DD pairs for a valid fix. 0 = disabled.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },
  'ar.partial_ar.min_drop_sats': {
    label: 'Min Drop Pairs',
    description:
      'Minimum DD pairs before excluding the weakest satellite. 0 = disabled.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.RTK),
  },
  'ar.partial_ar.min_hold_sats': {
    label: 'Min Hold Pairs',
    description: 'Minimum DD pairs for fix-and-hold activation. 0 = no minimum.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.RTK),
  },
  'ar.partial_ar.ar_filter': {
    label: 'AR Filter',
    description:
      'Exclude newly-locked satellites that would degrade the AR ratio.',
    docsAnchor: '#ambiguity-resolution-partial-ar',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP_RTK),
  },

  // ── [rejection] ───────────────────────────────────────────────
  'rejection.innovation': {
    label: 'Innovation Threshold (m)',
    description:
      'Pre-fit residual rejection threshold. Observations exceeding this are excluded.',
    docsAnchor: '#rejection-criteria',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP),
  },
  'rejection.l1_l2_residual': {
    label: 'L1/L2 Residual (sigma)',
    docsAnchor: '#rejection-criteria',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'rejection.dispersive': {
    label: 'Dispersive Residual (sigma)',
    description: 'Ionospheric residual rejection threshold.',
    docsAnchor: '#rejection-criteria',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'rejection.non_dispersive': {
    label: 'Non-Dispersive Residual (sigma)',
    description: 'Geometric residual rejection threshold.',
    docsAnchor: '#rejection-criteria',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'rejection.gdop': {
    label: 'Max GDOP',
    description: 'Solution is invalidated when GDOP exceeds this value.',
    docsAnchor: '#rejection-criteria',
  },

  // ── [slip_detection] ─────────────────────────────────────────
  'slip.threshold': {
    label: 'Slip Threshold — LG (m)',
    description:
      'Geometry-free combination cycle slip detection threshold.',
    docsAnchor: '#slip-detection',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP, MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'slip.doppler': {
    label: 'Slip Threshold — Doppler (cyc/s)',
    description:
      'Doppler-phase rate cycle slip detection threshold. 0 = disabled.',
    docsAnchor: '#slip-detection',
    modes: modes(MODE_SETS.RTK, MODE_SETS.PPP, MODE_SETS.PPP_RTK),
  },

  // ── [kalman_filter.measurement_error] ────────────────────────
  'kf.meas.code_phase_ratio_L1': {
    label: 'Code/Phase Ratio L1',
    description:
      'Code measurement error = phase error x ratio. Typical: 100.',
    docsAnchor: '#kalman-filter-measurement-error',
  },
  'kf.meas.code_phase_ratio_L2': {
    label: 'Code/Phase Ratio L2',
    docsAnchor: '#kalman-filter-measurement-error',
  },
  'kf.meas.code_phase_ratio_L5': {
    label: 'Code/Phase Ratio L5',
    docsAnchor: '#kalman-filter-measurement-error',
  },
  'kf.meas.phase': {
    label: 'Phase Error Base (m)',
    description:
      'Base carrier phase measurement error. ' +
      'Total error = phase + phase_elevation / sin(elevation).',
    docsAnchor: '#kalman-filter-measurement-error',
  },
  'kf.meas.phase_elevation': {
    label: 'Phase Error — Elevation (m)',
    description: 'Elevation-dependent carrier phase error coefficient.',
    docsAnchor: '#kalman-filter-measurement-error',
  },
  'kf.meas.phase_baseline': {
    label: 'Phase Error — Baseline (m/10km)',
    description:
      'Baseline-length-dependent phase error. Proportional to rover-base distance.',
    docsAnchor: '#kalman-filter-measurement-error',
    modes: modes(MODE_SETS.RTK),
  },
  'kf.meas.ura_ratio': {
    label: 'URA Ratio',
    description:
      'User Range Accuracy scaling. Adjusts per-satellite weighting based on broadcast URA.',
    docsAnchor: '#kalman-filter-measurement-error',
    modes: modes(MODE_SETS.PPP),
  },

  // ── [kalman_filter.process_noise] ────────────────────────────
  'kf.pn.accel_h': {
    label: 'Accel. Noise — Horizontal (m/s2)',
    description: 'Horizontal acceleration process noise. Active when dynamics = true.',
    docsAnchor: '#kalman-filter-process-noise',
  },
  'kf.pn.accel_v': {
    label: 'Accel. Noise — Vertical (m/s2)',
    description: 'Vertical acceleration process noise. Active when dynamics = true.',
    docsAnchor: '#kalman-filter-process-noise',
  },
  'kf.pn.iono_max': {
    label: 'Iono Noise Max (m)',
    description: 'Maximum ionospheric process noise clamp. Prevents excessive iono state growth.',
    docsAnchor: '#kalman-filter-process-noise',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'kf.pn.ifb': {
    label: 'IFB Noise (m)',
    description: 'Inter-frequency bias process noise for multi-frequency PPP.',
    docsAnchor: '#kalman-filter-process-noise',
    modes: modes(MODE_SETS.PPP),
  },
  'kf.pn.clock_stability': {
    label: 'Clock Stability (s/s)',
    description: 'Receiver clock stability for PPP clock state prediction.',
    docsAnchor: '#kalman-filter-process-noise',
    modes: modes(MODE_SETS.PPP),
  },

  // ── [adaptive_filter] ─────────────────────────────────────────
  'adaptive.iono_forgetting': {
    label: 'Iono Forgetting Factor',
    description: 'Forgetting factor for ionospheric state (0-1). Lower = faster adaptation.',
    docsAnchor: '#adaptive-filter',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
  'adaptive.pva_forgetting': {
    label: 'PVA Forgetting Factor',
    description: 'Forgetting factor for position/velocity/acceleration state.',
    docsAnchor: '#adaptive-filter',
    modes: modes(MODE_SETS.PPP_RTK, MODE_SETS.VRS),
  },
} satisfies Record<string, OptionMeta>;

export type OptionMetaKey = keyof typeof OPTION_META_DEF;
export const OPTION_META: Record<OptionMetaKey, OptionMeta> = OPTION_META_DEF;
