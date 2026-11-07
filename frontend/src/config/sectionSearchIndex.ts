// Keyword index for the config category-rail Filter… box (console redesign).
//
// Maps each rail section to searchable terms — the visible field labels AND the
// underlying snake_case TOML keys rendered in that section — so the filter can
// surface a section by an individual parameter name or its TOML key, not just
// the nav label. Presentation-only; derived from the fields rendered in
// ProcessingConfigTabs, configToBackend (TOML keys) and optionMeta (labels).
//
// Terms include both the human label ("elevation mask") and the dotted TOML key
// ("positioning.elevation_mask") so either typing style matches via substring.

const SECTION_SEARCH: Record<string, string[]> = {
  'input-files': [
    'time start', 'time end', 'interval', 'rover obs', 'rover observation', 'navigation',
    'base obs', 'base observation', 'corrections', 'precise ephemeris', 'output file',
    'rover_obs', 'nav_file', 'base_obs', 'correction_files', 'output_file',
  ],

  streams: [
    'input streams', 'rover', 'base station', 'correction', 'output streams', 'log streams',
    'ntrip', 'tcp client', 'tcp server', 'serial', 'file', 'rtcm', 'ubx', 'sbf', 'binex',
    'rinex', 'clas l6', 'l6e', 'nmea', 'stream format', 'nmea request',
  ],

  mode: [
    'positioning mode', 'correction', 'correction provider', 'clas', 'madoca', 'igs', 'igs-rts',
    'galileo has', 'beidou b2b', 'ppp-b2b', 'bds-b2b', 'southpan', 'southpan-pvs', 'pvs',
    'ssr provider', 'positioning.correction', 'qzs-clas', 'qzs-madoca',
    'filter direction', 'solution type', 'frequencies', 'frequency',
    'signals', 'signal mode', 'elevation mask', 'snr mask', 'ionosphere', 'troposphere',
    'atmosphere', 'satellite ephemeris', 'ephemeris', 'constellations', 'gps', 'glonass',
    'galileo', 'qzss', 'sbas', 'beidou', 'irnss', 'excluded satellites',
    'positioning.mode', 'positioning.correction', 'positioning.solution_type', 'positioning.frequency',
    'positioning.signals', 'positioning.elevation_mask',
    'positioning.snr_mask', 'positioning.atmosphere.ionosphere', 'positioning.atmosphere.troposphere',
    'positioning.satellite_ephemeris', 'positioning.constellations',
    'positioning.excluded_sats',
    'bds-2 sats', 'bds2 sats', 'beidou prn reassignment', 'bds geo sats', 'beidou geo',
    'positioning.bds2_sats', 'positioning.bds_geo_sats',
    // Receiver Dynamics + Earth Tides + corrections toggles (relocated into Basic Strategy)
    'earth tides', 'tidal correction', 'receiver dynamics', 'sat pcv', 'rec pcv',
    'satellite antenna pcv', 'receiver antenna pcv', 'phase windup', 'reject eclipse',
    'exclude eclipse', 'raim fde', 'positioning.receiver_dynamics',
    'positioning.corrections.tidal_correction', 'positioning.corrections.satellite_antenna',
    'positioning.corrections.receiver_antenna', 'positioning.corrections.phase_windup',
    'positioning.corrections.exclude_eclipse', 'positioning.corrections.raim_fde',
    // Corrections (bias / frequency / model)
    'corrections', 'iono compensation', 'iono comp', 'gps frequency', 'qzs frequency',
    'snr fixed', 'shapiro', 'shapiro delay', 'exclude qzs ref', 'no phase bias adj',
    'partial ar', 'partial ambiguity',
    'positioning.corrections.iono_compensation', 'positioning.corrections.gps_frequency',
    'positioning.corrections.qzs_frequency', 'positioning.corrections.snr_fixed',
    'positioning.corrections.shapiro_delay', 'positioning.corrections.exclude_qzs_ref',
    'positioning.corrections.no_phase_bias_adj', 'positioning.corrections.partial_ar',
  ],

  ar: [
    'ar mode', 'ambiguity resolution', 'gps ar', 'glonass ar', 'beidou ar', 'bds ar', 'qzss ar',
    'ambiguity_resolution.gps_ar',
    'bds-3 igso', 'bds3 igso sats', 'ambiguity_resolution.bds3_igso_sats',
    'ratio threshold', 'ar elevation mask', 'hold elevation mask', 'ratio 1', 'ratio 2',
    'ratio 3', 'ratio 4', 'ratio 5', 'ratio 6',
    'lock count', 'min fix epochs', 'max lambda iterations', 'outage reset count',
    'slip threshold', 'doppler', 'cycle slip', 'min ambiguities', 'max excluded sats',
    'min fix pairs', 'min drop pairs', 'min hold pairs', 'ar filter', 'partial ar',
    'ambiguity_resolution.mode', 'ambiguity_resolution.glonass_ar', 'ambiguity_resolution.bds_ar',
    'ambiguity_resolution.qzs_ar', 'ambiguity_resolution.thresholds.ratio',
    'ambiguity_resolution.thresholds.elevation_mask', 'ambiguity_resolution.thresholds.hold_elevation',
    'ambiguity_resolution.thresholds.ratio1',
    'ambiguity_resolution.counters.lock_count', 'ambiguity_resolution.counters.min_fix',
    'ambiguity_resolution.counters.max_iterations', 'ambiguity_resolution.counters.out_count',
    'ambiguity_resolution.partial_ar.min_ambiguities', 'ambiguity_resolution.partial_ar.ar_filter',
    'slip_detection.threshold', 'slip_detection.doppler',
  ],

  kf: [
    'kalman filter', 'iterations', 'code phase ratio', 'phase error',
    'phase error base', 'phase error elevation', 'phase error baseline', 'doppler', 'ura ratio',
    'accel noise', 'acceleration noise', 'horizontal', 'vertical', 'iono noise', 'ifb noise',
    'clock stability', 'phase bias', 'process noise', 'ztd', 'position noise', 'iono time const',
    'initial std', 'initial standard deviation', 'measurement error',
    'kalman_filter.iterations',
    'kalman_filter.measurement_error.code_phase_ratio_l1', 'kalman_filter.measurement_error.code_phase_ratio_l2',
    'kalman_filter.measurement_error.code_phase_ratio_l5', 'kalman_filter.measurement_error.phase',
    'kalman_filter.measurement_error.phase_elevation', 'kalman_filter.measurement_error.phase_baseline',
    'kalman_filter.measurement_error.doppler', 'kalman_filter.measurement_error.ura_ratio',
    'kalman_filter.process_noise.accel_h', 'kalman_filter.process_noise.accel_v',
    'kalman_filter.process_noise.iono_max', 'kalman_filter.process_noise.ifb',
    'kalman_filter.process_noise.clock_stability', 'kalman_filter.process_noise.bias',
    'kalman_filter.process_noise.position_h', 'kalman_filter.process_noise.position_v',
    'kalman_filter.initial_std.bias', 'kalman_filter.initial_std.ionosphere',
    'kalman_filter.initial_std.troposphere',
    // Rejection Criteria (merged into Kalman Filter from the former Advanced section)
    'rejection criteria', 'innovation threshold', 'l1 l2 residual', 'dispersive residual',
    'non-dispersive residual', 'hold chi-square', 'fix chi-square', 'max gdop', 'pseudorange diff',
    'pos error count', 'rejection.innovation', 'rejection.l1_l2_residual', 'rejection.dispersive',
    'rejection.non_dispersive', 'rejection.gdop',
  ],

  clas: [
    'clas', 'ppp-rtk', 'vrs', 'vrs-rtk', 'grid radius', 'grid selection radius', 'receiver type',
    'enhanced spp seed', 'seed', 'ar significance level', 'significance level', 'alpha',
    'ambiguity_resolution.thresholds.alpha',
    'positioning.clas.grid_selection_radius', 'positioning.clas.receiver_type',
    'positioning.clas.enhanced_spp_seed',
    // CLAS Ambiguities (positioning.clas.ambiguities)
    'clas ambiguities', 'isb', 'inter-system bias', 'phase shift', 'reference type',
    'positioning.clas.ambiguities.isb', 'positioning.clas.ambiguities.phase_shift',
    'positioning.clas.ambiguities.reference_type',
    // CLAS Resilience (positioning.clas.resilience)
    'clas resilience', 'max obs loss', 'float count', 'l6 merge', 'reset interval',
    'positioning.clas.resilience.max_obs_loss', 'positioning.clas.resilience.float_count',
    'positioning.clas.resilience.l6_merge', 'positioning.clas.resilience.reset_interval',
    // Adaptive Filter (positioning.clas.adaptive_filter — PPP-RTK / VRS only)
    'adaptive filter', 'iono forgetting factor', 'iono gain', 'pva forgetting factor',
    'pva gain', 'forgetting factor',
    'positioning.clas.adaptive_filter.enabled', 'positioning.clas.adaptive_filter.iono_forgetting',
    'positioning.clas.adaptive_filter.iono_gain', 'positioning.clas.adaptive_filter.pva_forgetting',
    'positioning.clas.adaptive_filter.pva_gain',
  ],

  // Combined section: SPP / Relative / Signal Selection
  method: [
    // SPP / Robust QC
    'spp', 'single point', 'robust', 'igg3', 'igg-iii', 'robust k0', 'robust k1',
    'tdcp', 'tdcp jump', 'ignore chi error', 'chi error',
    'positioning.robust', 'positioning.robust_k0', 'positioning.robust_k1',
    'positioning.tdcp', 'positioning.tdcp_jump', 'positioning.spp.ignore_chi_error',
    // Relative
    'relative', 'differential', 'rtk', 'max age', 'baseline length', 'baseline sigma',
    'time interpolation', 'base interpolation',
    'positioning.relative.max_age', 'positioning.relative.baseline_length',
    'positioning.relative.baseline_sigma', 'positioning.relative.time_interpolation',
    // Signal Selection
    'signal selection', 'signals', 'gps', 'qzss', 'galileo', 'beidou', 'bds-2', 'bds-3',
    'l1/l2', 'l1/l5', 'e1/e5a', 'b1i/b3i',
    'signals.gps', 'signals.qzs', 'signals.galileo', 'signals.bds2', 'signals.bds3',
  ],

  ppp: [
    'ppp', 'precise point positioning', 'madoca', 'iono compensation', 'iono comp',
    'ppp sat clock bias', 'ppp sat phase bias', 'satellite clock bias', 'satellite phase bias',
    'uncorrected bias', 'drop uncorrected code', 'clock jump', 'max bias dt', 'ppp option', 'options',
    'positioning.madoca.iono_correction', 'positioning.ppp.satellite_clock_bias',
    'positioning.ppp.satellite_phase_bias', 'positioning.ppp.drop_uncorrected_code',
    'positioning.ppp.clock_jump', 'positioning.ppp.max_bias_dt', 'positioning.ppp.options',
  ],

  antenna: [
    'rover position', 'base position', 'position type', 'lat lon height', 'ecef', 'xyz',
    'antenna type', 'antenna name', 'antenna delta', 'delta-e', 'delta-n', 'delta-u',
    'max avg epochs', 'init reset', 'station position file', 'station pos',
    'antenna.rover.mode', 'antenna.rover.values', 'antenna.rover.antenna_type',
    'antenna.rover.antenna_delta', 'antenna.base.mode', 'antenna.base.values',
    'antenna.base.antenna_type', 'antenna.base.antenna_delta', 'files.station_pos',
  ],

  format: [
    'solution format', 'output header', 'processing options', 'velocity', 'time format',
    'decimals', 'lat lon format', 'field separator', 'height', 'geoid model',
    'static solution mode', 'single on outage', 'nmea rmc gga', 'nmea gsa gsv',
    'solution status', 'debug trace', 'trace level',
    'output.solution_format', 'output.output_header', 'output.output_processing_options',
    'output.output_velocity', 'output.time_format', 'output.num_decimals', 'output.lat_lon_format',
    'output.field_separator', 'output.height', 'output.geoid_model',
    'output.static_solution_mode', 'output.output_single_on_outage', 'output.output_solution_status',
    'output.debug_trace',
    'clas nmea source id', 'gga station id', 'output.clas_nmea_source_id',
  ],

  files: [
    'satellite antenna pcv file', 'receiver antenna pcv file', 'atx', 'geoid data file',
    'dcb data file', 'eop data file', 'ocean loading file', 'blq', 'ionosphere data file',
    'fcb file', 'bias sinex file', 'cssr grid file', 'isb table file',
    'phase cycle file', 'temp dir', 'trace file', 'command file', 'cmd file',
    'files.satellite_atx', 'files.receiver_atx', 'files.geoid', 'files.dcb', 'files.eop',
    'files.ocean_loading', 'files.ionosphere', 'files.fcb',
    'files.bias_sinex', 'files.cssr_grid', 'files.isb_table', 'files.phase_cycle',
    'files.temp_dir', 'files.trace', 'files.cmd_file_1', 'files.cmd_file_2', 'files.cmd_file_3',
  ],

  'input-options': [
    'input options', 'input decoding', 'rinex option', 'rtcm option', 'rtcm options',
    'sbas satellite', 'decode',
    'input.rinex.option_1', 'input.rinex.option_2', 'input.rtcm.options', 'input.sbas.satellite',
  ],

  server: [
    'server', 'rtkrcv', 'cycle', 'timeout', 'reconnect', 'nmea cycle', 'buffer size',
    'nav msg select', 'proxy', 'swap margin', 'start cmd', 'stop cmd',
    'server.cycle_ms', 'server.timeout_ms', 'server.reconnect_ms', 'server.nmea_cycle_ms',
    'server.buffer_size', 'server.nav_msg_select', 'server.proxy', 'server.swap_margin',
    'server.start_cmd', 'server.stop_cmd',
  ],
};

/** Precomputed lowercased search text per section (labels + TOML keys joined). */
export const SECTION_SEARCH_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_SEARCH).map(([section, terms]) => [section, terms.join(' ').toLowerCase()]),
);
