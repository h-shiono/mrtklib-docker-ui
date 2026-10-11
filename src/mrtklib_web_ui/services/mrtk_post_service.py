"""
mrtk_post service for post-processing GNSS data.
"""

import asyncio
import logging
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Annotated, Any, Optional

from pydantic import BaseModel, BeforeValidator, Field

from mrtklib_web_ui.services.mask_credentials import mask_log_line
from mrtklib_web_ui.services.input_staging import remove_stage_dir, stage_paths
from mrtklib_web_ui.services.stream_lines import iter_lines


def _bool_to_onoff(v: Any) -> str:
    """Convert bool to 'on'/'off' string, pass strings through."""
    if isinstance(v, bool):
        return "on" if v else "off"
    return v


BoolOrStr = Annotated[str, BeforeValidator(_bool_to_onoff)]

logger = logging.getLogger(__name__)

# Pattern to match mrtk_post progress output:
# "processing : 2024/01/01 00:00:00.0 Q=1 ns=10 ratio=50.0"
_PROGRESS_PATTERN = re.compile(
    r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)"  # epoch time
    r".*?Q=(\d+)"                                             # quality
    r"(?:.*?ns=\s*(\d+))?"                                    # num satellites (optional)
    r"(?:.*?ratio=\s*([\d.]+))?"                              # AR ratio (optional)
)


def parse_progress(line: str) -> dict[str, Any] | None:
    """Parse mrtk_post progress output line."""
    m = _PROGRESS_PATTERN.search(line)
    if not m:
        return None
    return {
        "epoch": m.group(1).strip(),
        "quality": int(m.group(2)),
        "ns": int(m.group(3)) if m.group(3) else None,
        "ratio": float(m.group(4)) if m.group(4) else None,
    }


# ── [positioning] ────────────────────────────────────────────────────────────

class ConstellationSelection(BaseModel):
    gps: bool = True
    glonass: bool = True
    galileo: bool = True
    qzss: bool = True
    sbas: bool = True
    beidou: bool = True
    irnss: bool = False


class SnrMaskConfig(BaseModel):
    enable_rover: bool = False
    enable_base: bool = False
    mask: list[list[float]] = Field(default=[[0.0] * 9, [0.0] * 9, [0.0] * 9])


class ClasConfig(BaseModel):
    grid_selection_radius: float = 1000.0
    receiver_type: str = ""
    enhanced_spp_seed: str = "cn0+tdcp"   # v0.7.6
    l6_merge: int = 0                      # v0.7.6 (clas.resilience)
    reset_interval: int = 0                # v0.7.6 (clas.resilience)


class CorrectionsConfig(BaseModel):
    satellite_antenna: bool = False
    receiver_antenna: bool = False
    phase_windup: str = "off"          # off/on/precise
    exclude_eclipse: bool = False
    raim_fde: bool = False
    iono_compensation: str = "off"     # off/ssr/meas
    partial_ar: bool = False
    shapiro_delay: bool = False
    exclude_qzs_ref: bool = False
    no_phase_bias_adj: bool = False
    gps_frequency: str = "l1+l2"
    qzs_frequency: str = "l1+l2"
    tidal_correction: str = "off"      # off/on/otl/solid+otl-clasgrid+pole
    snr_fixed: int = 0                 # v0.7.6


class AtmosphereConfig(BaseModel):
    ionosphere: str = "broadcast"
    troposphere: str = "saastamoinen"


class PositioningConfig(BaseModel):
    positioning_mode: str = "kinematic"
    correction: str = "auto"   # SSR/PPP provider: none/igs/igs-rts/qzs-madoca/gal-has/bds-b2b/qzs-clas
    frequency: str = "l1+l2"
    signal_mode: str = "frequency"
    signals: str = ""
    filter_type: str = "forward"
    elevation_mask: float = 15.0
    receiver_dynamics: str = "off"
    ephemeris_option: str = "broadcast"
    constellations: ConstellationSelection = Field(default_factory=ConstellationSelection)
    excluded_satellites: str = ""
    # v0.7.6 additions
    robust: str = "off"
    robust_k0: float = 1.5   # IGG-III code default (mrtk_rtkpos.c)
    robust_k1: float = 4.0   # IGG-III code default (mrtk_rtkpos.c)
    tdcp: str = "off"
    tdcp_jump: float = 5.0   # code default (mrtk_spp.c)
    snr_mask: SnrMaskConfig = Field(default_factory=SnrMaskConfig)
    corrections: CorrectionsConfig = Field(default_factory=CorrectionsConfig)
    atmosphere: AtmosphereConfig = Field(default_factory=AtmosphereConfig)
    clas: ClasConfig = Field(default_factory=ClasConfig)


# ── [ambiguity_resolution] ───────────────────────────────────────────────────

class ARThresholds(BaseModel):
    ratio: float = 3.0
    ratio1: float = 0.9999
    ratio5: float = 0.0
    ratio6: float = 0.0
    alpha: str = "0.1%"
    elevation_mask: float = 0.0
    hold_elevation: float = 0.0
    max_pdop_ar: float = 0.0       # v0.7.6 (0: no limit)
    max_pdop_hold: float = 0.0     # v0.7.6 (0: no limit)
    reference_dop: str = "zd"      # v0.7.6 (zd/sd)


class ARCounters(BaseModel):
    lock_count: int = 0
    min_fix: int = 10
    max_iterations: int = 1
    out_count: int = 5


class PartialARConfig(BaseModel):
    min_ambiguities: int = 0
    max_excluded_sats: int = 0
    min_fix_sats: int = 4
    min_drop_sats: int = 0
    min_hold_sats: int = 0
    ar_filter: bool = False


class ARHoldConfig(BaseModel):
    variance: float = 0.001


class AmbiguityResolutionConfig(BaseModel):
    mode: str = "continuous"
    gps_ar: bool = True
    glonass_ar: BoolOrStr = "on"
    bds_ar: BoolOrStr = "on"
    qzs_ar: BoolOrStr = "on"
    systems: int = 1               # v0.7.6 (PPP-AR system bitmask; SYS_GPS)
    thresholds: ARThresholds = Field(default_factory=ARThresholds)
    counters: ARCounters = Field(default_factory=ARCounters)
    partial_ar: PartialARConfig = Field(default_factory=PartialARConfig)
    hold: ARHoldConfig = Field(default_factory=ARHoldConfig)


# ── [rejection] ──────────────────────────────────────────────────────────────

class RejectionConfig(BaseModel):
    innovation: float = 30.0
    l1_l2_residual: float = 0.0
    dispersive: float = 0.0
    non_dispersive: float = 0.0
    hold_chi_square: float = 0.0
    fix_chi_square: float = 0.0
    gdop: float = 30.0
    pseudorange_diff: float = 0.0
    position_error_count: int = 0
    spp_residual: float = 0.0      # v0.7.6
    spp_min_sats: int = 7          # v0.7.6


# ── [slip_detection] ─────────────────────────────────────────────────────────

class SlipDetectionConfig(BaseModel):
    threshold: float = 0.05
    doppler: float = 0.0


# ── [kalman_filter] ──────────────────────────────────────────────────────────

class MeasurementErrorConfig(BaseModel):
    code_phase_ratio_l1: float = 100.0
    code_phase_ratio_l2: float = 100.0
    code_phase_ratio_l5: float = 100.0
    phase: float = 0.003
    phase_elevation: float = 0.003
    phase_baseline: float = 0.0
    doppler: float = 1.0
    ura_ratio: float = 0.0
    snr_max: float = 0.0           # v0.7.6
    snr_error: float = 0.0         # v0.7.6
    ionosphere: float = 0.0        # v0.7.6 (stats_erriono)
    troposphere: float = 0.0       # v0.7.6 (stats_errtrop)


class InitialStdConfig(BaseModel):
    bias: float = 30.0
    ionosphere: float = 0.03
    troposphere: float = 0.3


class ProcessNoiseConfig(BaseModel):
    bias: float = 0.0001
    ionosphere: float = 0.001
    iono_max: float = 0.0
    troposphere: float = 0.0001
    accel_h: float = 1.0
    accel_v: float = 0.1
    position_h: float = 0.0
    position_v: float = 0.0
    position: float = 0.0
    ifb: float = 0.0
    iono_time_const: float = 0.0
    clock_stability: float = 5e-12


class KalmanFilterConfig(BaseModel):
    iterations: int = 1
    measurement_error: MeasurementErrorConfig = Field(default_factory=MeasurementErrorConfig)
    initial_std: InitialStdConfig = Field(default_factory=InitialStdConfig)
    process_noise: ProcessNoiseConfig = Field(default_factory=ProcessNoiseConfig)


# ── [adaptive_filter] ────────────────────────────────────────────────────────

class AdaptiveFilterConfig(BaseModel):
    enabled: bool = False
    iono_forgetting: float = 0.0
    iono_gain: float = 0.0
    pva_forgetting: float = 0.0
    pva_gain: float = 0.0


# ── [signals] ────────────────────────────────────────────────────────────────

class SignalSelectionConfig(BaseModel):
    gps: str = "L1/L2"
    qzs: str = "L1/L5"
    galileo: str = "E1/E5a"
    bds2: str = "B1I/B3I"
    bds3: str = "B1I/B3I"


# ── [receiver] ───────────────────────────────────────────────────────────────

class ReceiverConfig(BaseModel):
    iono_correction: bool = True
    ignore_chi_error: bool = False
    ppp_sat_clock_bias: int = 0
    ppp_sat_phase_bias: int = 0
    uncorr_bias: int = 0
    max_bias_dt: int = 0
    phase_shift: str = "off"
    isb: bool = False
    reference_type: str = ""
    max_age: float = 30.0
    baseline_length: float = 0.0
    baseline_sigma: float = 0.0
    clock_jump: bool = False       # v0.7.6 (positioning.ppp.clock_jump)


# ── [antenna] ────────────────────────────────────────────────────────────────

class StationPosition(BaseModel):
    mode: str = "llh"
    values: list[float] = Field(default=[0.0, 0.0, 0.0])
    antenna_type_enabled: bool = False
    antenna_type: str = ""
    antenna_delta: list[float] = Field(default=[0.0, 0.0, 0.0])


class BaseStationPosition(StationPosition):
    max_average_epochs: int = 0
    init_reset: bool = False


class AntennaConfig(BaseModel):
    rover: StationPosition = Field(default_factory=StationPosition)
    base: BaseStationPosition = Field(default_factory=BaseStationPosition)


# ── [output] ─────────────────────────────────────────────────────────────────

class OutputConfig(BaseModel):
    solution_format: str = "llh"
    output_header: bool = True
    output_processing_options: bool = False
    output_velocity: bool = False
    time_format: str = "gpst"
    num_decimals: int = 3
    lat_lon_format: str = "ddd.ddddddd"
    field_separator: str = ""
    height: str = "ellipsoidal"
    geoid_model: str = "internal"
    static_solution_mode: str = "all"
    output_single_on_outage: bool = False
    max_solution_std: float = 0.0
    nmea_interval_rmc_gga: int = 0
    nmea_interval_gsa_gsv: int = 0
    output_solution_status: str = "off"
    debug_trace: str = "off"


# ── [files] ──────────────────────────────────────────────────────────────────

class FilesConfig(BaseModel):
    satellite_atx: str = ""
    receiver_atx: str = ""
    station_pos: str = ""
    geoid: str = ""
    ionosphere: str = ""
    dcb: str = ""
    eop: str = ""
    ocean_loading: str = ""
    fcb: str = ""
    bias_sinex: str = ""
    cssr_grid: str = ""
    isb_table: str = ""
    phase_cycle: str = ""
    temp_dir: str = ""             # v0.7.6
    trace: str = ""                # v0.7.6
    cmd_file_1: str = ""           # v0.7.6 (rtkrcv)
    cmd_file_2: str = ""
    cmd_file_3: str = ""


# ── [server] ─────────────────────────────────────────────────────────────────

class ServerConfig(BaseModel):
    cycle_ms: int = 10
    timeout_ms: int = 10000
    reconnect_ms: int = 10000
    nmea_cycle_ms: int = 5000
    buffer_size: int = 32768
    nav_msg_select: str = "all"
    proxy: str = ""
    swap_margin: int = 30
    time_interpolation: bool = False
    sbas_satellite: str = "0"
    rinex_option_1: str = ""
    rinex_option_2: str = ""
    ppp_option: str = ""
    rtcm_option: str = ""
    l6_margin: int = 0
    max_obs_loss: float = 90.0
    float_count: int = 15
    start_cmd: str = ""            # v0.7.6
    stop_cmd: str = ""             # v0.7.6


# ── Top-level config ─────────────────────────────────────────────────────────

class MrtkPostConfig(BaseModel):
    """Complete MRTKLIB post-processing configuration, structured by TOML sections."""
    positioning: PositioningConfig = Field(default_factory=PositioningConfig)
    ambiguity_resolution: AmbiguityResolutionConfig = Field(default_factory=AmbiguityResolutionConfig)
    rejection: RejectionConfig = Field(default_factory=RejectionConfig)
    slip_detection: SlipDetectionConfig = Field(default_factory=SlipDetectionConfig)
    kalman_filter: KalmanFilterConfig = Field(default_factory=KalmanFilterConfig)
    adaptive_filter: AdaptiveFilterConfig = Field(default_factory=AdaptiveFilterConfig)
    signal_selection: SignalSelectionConfig = Field(default_factory=SignalSelectionConfig)
    receiver: ReceiverConfig = Field(default_factory=ReceiverConfig)
    antenna: AntennaConfig = Field(default_factory=AntennaConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    files: FilesConfig = Field(default_factory=FilesConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)


# ── Job types ────────────────────────────────────────────────────────────────

class MrtkPostInputFiles(BaseModel):
    rover_obs_file: str
    nav_file: str
    base_obs_file: Optional[str] = None
    correction_files: list[str] = Field(default_factory=list)
    output_file: str


class MrtkPostTimeRange(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    interval: Optional[float] = None


class MrtkPostJob(BaseModel):
    input_files: MrtkPostInputFiles
    config: MrtkPostConfig
    time_range: Optional[MrtkPostTimeRange] = None


# ── Service ──────────────────────────────────────────────────────────────────

class MrtkPostService:
    """Service for running mrtk post post-processing."""

    def __init__(self, mrtk_bin_path: str = "/usr/local/bin/mrtk"):
        self.mrtk_bin_path = mrtk_bin_path

    def generate_conf_file(self, config: MrtkPostConfig) -> str:
        """Generate MRTKLIB TOML configuration file content."""
        lines = ["# MRTKLIB Configuration (TOML v1.0.0)", ""]

        # --- Value maps ---
        pos_mode_map = {
            "single": "single", "dgps": "dgps", "kinematic": "kinematic",
            "static": "static", "moving-base": "movingbase", "fixed": "fixed",
            "ppp-kinematic": "ppp-kine", "ppp-static": "ppp-static",
            "ppp-fixed": "ppp-fixed", "ppp-rtk": "ppp-rtk", "vrs-rtk": "vrs-rtk",
        }
        freq_map = {
            "l1": "l1", "l1+l2": "l1+2", "l1+l2+l5": "l1+2+3",
            "l1+l2+l5+l6": "l1+2+3+4", "l1+l2+l5+l6+l7": "l1+2+3+4+5",
        }
        iono_map = {
            "off": "off", "broadcast": "brdc", "sbas": "sbas", "dual-freq": "dual-freq",
            "est-stec": "est-stec", "ionex-tec": "ionex-tec", "qzs-brdc": "qzs-brdc",
            "est-adaptive": "est-adaptive",
        }
        tropo_map = {
            "off": "off", "saastamoinen": "saas", "sbas": "sbas",
            "est-ztd": "est-ztd", "est-ztd-grad": "est-ztdgrad", "est-ztdgrad": "est-ztdgrad",
        }
        ephem_map = {
            "broadcast": "brdc", "precise": "precise", "broadcast+sbas": "brdc+sbas",
            "broadcast+ssrapc": "brdc+ssrapc", "broadcast+ssrcom": "brdc+ssrcom",
        }
        sol_format_map = {"llh": "llh", "xyz": "xyz", "enu": "enu", "nmea": "nmea"}
        time_sys_map = {"gpst": "gpst", "gpst-hms": "gpst", "utc": "utc", "jst": "jst"}
        time_form_map = {"gpst": "tow", "gpst-hms": "hms", "utc": "hms", "jst": "hms"}
        height_map = {"ellipsoidal": "ellipsoidal", "geodetic": "geodetic"}
        geoid_map = {
            "internal": "internal", "egm96": "egm96", "egm08_2.5": "egm08_2.5",
            "egm08_1": "egm08_1", "gsi2000": "gsi2000",
        }
        postype_map = {
            "llh": "llh", "xyz": "xyz", "single": "single",
            "posfile": "posfile", "rinexhead": "rinexhead", "rtcm": "rtcm", "raw": "raw",
        }
        alpha_map = {
            "0.1%": "0.1%", "0.5%": "0.5%", "1%": "1%",
            "5%": "5%", "10%": "10%", "20%": "20%",
        }

        def _s(v: str) -> str:
            return f'"{v}"'

        def _b(v: bool) -> str:
            return "true" if v else "false"

        def _arr(vals: list) -> str:
            return "[" + ", ".join(str(int(v)) if v == int(v) else str(v) for v in vals) + "]"

        def _flt(v: float) -> str:
            """Format float, using scientific notation for very small values."""
            if v != 0.0 and abs(v) < 0.001:
                return f"{v:.2e}"
            return str(v)

        p = config.positioning

        # ── [positioning] ─────────────────────────────────────────────────
        lines.append("[positioning]")
        lines.append(f"mode                = {_s(pos_mode_map.get(p.positioning_mode, 'kinematic'))}")
        lines.append(f"correction          = {_s(p.correction)}")

        is_madoca_ppp = p.positioning_mode in ("ppp-kinematic", "ppp-static", "ppp-fixed")
        use_signals = p.signals.strip() != "" and not is_madoca_ppp
        if use_signals:
            sig_list = [s.strip() for s in p.signals.replace(",", " ").split() if s.strip()]
            lines.append(f"signals             = [{', '.join(_s(s) for s in sig_list)}]")
        else:
            lines.append(f"frequency           = {_s(freq_map.get(p.frequency, 'l1+2'))}")

        lines.append(f"solution_type       = {_s(p.filter_type)}")
        lines.append(f"elevation_mask      = {p.elevation_mask}")
        lines.append(f"dynamics            = {_b(p.receiver_dynamics == 'on')}")
        lines.append(f"satellite_ephemeris = {_s(ephem_map.get(p.ephemeris_option, 'brdc'))}")

        if p.excluded_satellites.strip():
            sats = [s.strip() for s in p.excluded_satellites.replace(",", " ").split() if s.strip()]
            lines.append(f"excluded_sats       = [{', '.join(_s(s) for s in sats)}]")
        else:
            lines.append("excluded_sats       = []")

        c = p.constellations
        systems = []
        if c.gps:
            systems.append('"GPS"')
        if c.glonass:
            systems.append('"GLONASS"')
        if c.galileo:
            systems.append('"Galileo"')
        if c.qzss:
            systems.append('"QZSS"')
        if c.sbas:
            systems.append('"SBAS"')
        if c.beidou:
            systems.append('"BeiDou"')
        if c.irnss:
            systems.append('"NavIC"')
        lines.append(f"systems             = [{', '.join(systems)}]")
        # v0.7.6: robust estimation + TDCP
        if p.robust != "off":
            lines.append(f"robust              = {_s(p.robust)}")
            if p.robust_k0:
                lines.append(f"robust_k0           = {p.robust_k0}")
            if p.robust_k1:
                lines.append(f"robust_k1           = {p.robust_k1}")
        if p.tdcp != "off":
            lines.append(f"tdcp                = {_s(p.tdcp)}")
            if p.tdcp_jump:
                lines.append(f"tdcp_jump           = {p.tdcp_jump}")
        lines.append("")

        # ── [positioning.snr_mask] ────────────────────────────────────────
        lines.append("[positioning.snr_mask]")
        lines.append(f"rover_enabled = {_b(p.snr_mask.enable_rover)}")
        lines.append(f"base_enabled  = {_b(p.snr_mask.enable_base)}")
        for i, label in enumerate(["L1", "L2", "L5"]):
            if i < len(p.snr_mask.mask):
                lines.append(f"{label}            = {_arr(p.snr_mask.mask[i])}")
        lines.append("")

        # ── [positioning.corrections] ─────────────────────────────────────
        cor = p.corrections
        lines.append("[positioning.corrections]")
        lines.append(f"satellite_antenna  = {_b(cor.satellite_antenna)}")
        lines.append(f"receiver_antenna   = {_b(cor.receiver_antenna)}")
        lines.append(f"phase_windup       = {_s(cor.phase_windup)}")
        lines.append(f"exclude_eclipse    = {_b(cor.exclude_eclipse)}")
        lines.append(f"raim_fde           = {_b(cor.raim_fde)}")
        lines.append(f"iono_compensation  = {_s(cor.iono_compensation)}")
        lines.append(f"partial_ar         = {_b(cor.partial_ar)}")
        lines.append(f"shapiro_delay      = {_b(cor.shapiro_delay)}")
        lines.append(f"exclude_qzs_ref    = {_b(cor.exclude_qzs_ref)}")
        lines.append(f"no_phase_bias_adj  = {_b(cor.no_phase_bias_adj)}")
        lines.append(f"gps_frequency      = {_s(cor.gps_frequency)}")
        lines.append(f"qzs_frequency      = {_s(cor.qzs_frequency)}")
        if cor.snr_fixed:
            lines.append(f"snr_fixed          = {cor.snr_fixed}")
        lines.append(f"tidal_correction   = {_s(cor.tidal_correction)}")
        lines.append("")

        # ── [positioning.atmosphere] ──────────────────────────────────────
        atm = p.atmosphere
        lines.append("[positioning.atmosphere]")
        lines.append(f"ionosphere  = {_s(iono_map.get(atm.ionosphere, 'brdc'))}")
        lines.append(f"troposphere = {_s(tropo_map.get(atm.troposphere, 'saas'))}")
        lines.append("")

        # ── [positioning.spp] ─────────────────────────────────────────────
        rx = config.receiver
        srv = config.server
        lines.append("[positioning.spp]")
        lines.append(f"ignore_chi_error = {_b(rx.ignore_chi_error)}")
        lines.append("")

        # ── [positioning.relative] ────────────────────────────────────────
        lines.append("[positioning.relative]")
        lines.append(f"max_age            = {rx.max_age}")
        if rx.baseline_length:
            lines.append(f"baseline_length    = {rx.baseline_length}")
        if rx.baseline_sigma:
            lines.append(f"baseline_sigma     = {rx.baseline_sigma}")
        lines.append(f"time_interpolation = {_b(srv.time_interpolation)}")
        lines.append("")

        # ── [positioning.ppp] ─────────────────────────────────────────────
        ppp_lines = []
        if rx.ppp_sat_clock_bias:
            ppp_lines.append(f"satellite_clock_bias  = {rx.ppp_sat_clock_bias}")
        if rx.ppp_sat_phase_bias:
            ppp_lines.append(f"satellite_phase_bias  = {rx.ppp_sat_phase_bias}")
        if rx.uncorr_bias:
            ppp_lines.append("drop_uncorrected_code = true")
        if rx.clock_jump:
            ppp_lines.append("clock_jump            = true")
        if rx.max_bias_dt:
            ppp_lines.append(f"max_bias_dt           = {rx.max_bias_dt}")
        if srv.ppp_option:
            ppp_lines.append(f"options               = {_s(srv.ppp_option)}")
        if ppp_lines:
            lines.append("[positioning.ppp]")
            lines.extend(ppp_lines)
            lines.append("")

        # ── [positioning.madoca] ──────────────────────────────────────────
        lines.append("[positioning.madoca]")
        lines.append(f"iono_correction = {_b(rx.iono_correction)}")
        lines.append("")

        # ── [positioning.clas.*] (PPP-RTK / VRS only) ─────────────────────
        is_clas = p.positioning_mode in ("ppp-rtk", "vrs-rtk")
        if is_clas:
            cl = p.clas
            lines.append("[positioning.clas]")
            lines.append(f"grid_selection_radius = {cl.grid_selection_radius}")
            lines.append(f"receiver_type         = {_s(cl.receiver_type)}")
            lines.append(f"enhanced_spp_seed     = {_s(cl.enhanced_spp_seed)}")
            lines.append("")

            lines.append("[positioning.clas.ambiguities]")
            lines.append(f"phase_shift    = {_s(rx.phase_shift)}")
            lines.append(f"isb            = {_b(rx.isb)}")
            if rx.reference_type:
                lines.append(f"reference_type = {_s(rx.reference_type)}")
            lines.append("")

            lines.append("[positioning.clas.resilience]")
            lines.append(f"max_obs_loss   = {srv.max_obs_loss}")
            lines.append(f"float_count    = {srv.float_count}")
            if cl.l6_merge:
                lines.append(f"l6_merge       = {cl.l6_merge}")
            if cl.reset_interval:
                lines.append(f"reset_interval = {cl.reset_interval}")
            lines.append("")

            af = config.adaptive_filter
            lines.append("[positioning.clas.adaptive_filter]")
            lines.append(f"enabled         = {_b(af.enabled)}")
            lines.append(f"iono_forgetting = {af.iono_forgetting}")
            lines.append(f"iono_gain       = {af.iono_gain}")
            lines.append(f"pva_forgetting  = {af.pva_forgetting}")
            lines.append(f"pva_gain        = {af.pva_gain}")
            lines.append("")

        # ── [ambiguity_resolution] ────────────────────────────────────────
        ar = config.ambiguity_resolution
        lines.append("[ambiguity_resolution]")
        def _ar_flag(v: str) -> str:
            """AR flag: 'on'→true, 'off'→false, else quoted string."""
            if v == "on":
                return "true"
            if v == "off":
                return "false"
            return _s(v)

        lines.append(f"mode       = {_s(ar.mode)}")
        lines.append(f"gps_ar     = {_b(ar.gps_ar)}")
        lines.append(f"glonass_ar = {_ar_flag(ar.glonass_ar)}")
        lines.append(f"bds_ar     = {_ar_flag(ar.bds_ar)}")
        lines.append(f"qzs_ar     = {_ar_flag(ar.qzs_ar)}")
        lines.append("")

        # ── [ambiguity_resolution.thresholds] ─────────────────────────────
        t = ar.thresholds
        lines.append("[ambiguity_resolution.thresholds]")
        lines.append(f"ratio          = {t.ratio}")
        lines.append(f"ratio1         = {t.ratio1}")
        if t.ratio5:
            lines.append(f"ratio5         = {t.ratio5}")
        if t.ratio6:
            lines.append(f"ratio6         = {t.ratio6}")
        lines.append(f"alpha          = {_s(alpha_map.get(t.alpha, '0.1%'))}")
        lines.append(f"elevation_mask = {t.elevation_mask}")
        lines.append(f"hold_elevation = {t.hold_elevation}")
        if t.max_pdop_ar:
            lines.append(f"max_pdop_ar    = {t.max_pdop_ar}")
        if t.max_pdop_hold:
            lines.append(f"max_pdop_hold  = {t.max_pdop_hold}")
        if t.reference_dop != "zd":
            lines.append(f"reference_dop  = {_s(t.reference_dop)}")
        lines.append("")

        # ── [ambiguity_resolution.counters] ───────────────────────────────
        cnt = ar.counters
        lines.append("[ambiguity_resolution.counters]")
        lines.append(f"lock_count     = {cnt.lock_count}")
        lines.append(f"min_fix        = {cnt.min_fix}")
        lines.append(f"max_iterations = {cnt.max_iterations}")
        lines.append(f"out_count      = {cnt.out_count}")
        lines.append("")

        # ── [ambiguity_resolution.partial_ar] ─────────────────────────────
        par = ar.partial_ar
        lines.append("[ambiguity_resolution.partial_ar]")
        if par.min_ambiguities:
            lines.append(f"min_ambiguities   = {par.min_ambiguities}")
        if par.max_excluded_sats:
            lines.append(f"max_excluded_sats = {par.max_excluded_sats}")
        lines.append(f"min_fix_sats      = {par.min_fix_sats}")
        if par.min_drop_sats:
            lines.append(f"min_drop_sats     = {par.min_drop_sats}")
        if par.min_hold_sats:
            lines.append(f"min_hold_sats     = {par.min_hold_sats}")
        lines.append(f"ar_filter         = {_b(par.ar_filter)}")
        lines.append("")

        # ── [ambiguity_resolution.hold] ───────────────────────────────────
        lines.append("[ambiguity_resolution.hold]")
        lines.append(f"variance = {ar.hold.variance}")
        lines.append("")

        # ── [rejection] ──────────────────────────────────────────────────
        rej = config.rejection
        lines.append("[rejection]")
        lines.append(f"innovation         = {rej.innovation}")
        lines.append(f"gdop               = {rej.gdop}")
        if rej.l1_l2_residual:
            lines.append(f"l1_l2_residual     = {rej.l1_l2_residual}")
        if rej.dispersive:
            lines.append(f"dispersive         = {rej.dispersive}")
        if rej.non_dispersive:
            lines.append(f"non_dispersive     = {rej.non_dispersive}")
        if rej.hold_chi_square:
            lines.append(f"hold_chi_square    = {rej.hold_chi_square}")
        if rej.fix_chi_square:
            lines.append(f"fix_chi_square     = {rej.fix_chi_square}")
        if rej.spp_residual:
            lines.append(f"spp_residual       = {rej.spp_residual}")
        if rej.spp_min_sats != 7:
            lines.append(f"spp_min_sats       = {rej.spp_min_sats}")
        if rej.pseudorange_diff:
            lines.append(f"pseudorange_diff   = {rej.pseudorange_diff}")
        if rej.position_error_count:
            lines.append(f"position_error_count = {rej.position_error_count}")
        lines.append("")

        # ── [slip_detection] ─────────────────────────────────────────────
        sd = config.slip_detection
        lines.append("[slip_detection]")
        lines.append(f"threshold = {sd.threshold}")
        if sd.doppler:
            lines.append(f"doppler   = {sd.doppler}")
        lines.append("")

        # ── [kalman_filter] ──────────────────────────────────────────────
        kf = config.kalman_filter
        lines.append("[kalman_filter]")
        lines.append(f"iterations    = {kf.iterations}")
        lines.append("")

        me = kf.measurement_error
        lines.append("[kalman_filter.measurement_error]")
        lines.append(f"code_phase_ratio_L1 = {me.code_phase_ratio_l1}")
        lines.append(f"code_phase_ratio_L2 = {me.code_phase_ratio_l2}")
        lines.append(f"code_phase_ratio_L5 = {me.code_phase_ratio_l5}")
        lines.append(f"phase               = {me.phase}")
        lines.append(f"phase_elevation     = {me.phase_elevation}")
        lines.append(f"phase_baseline      = {me.phase_baseline}")
        lines.append(f"doppler             = {me.doppler}")
        if me.snr_max:
            lines.append(f"snr_max             = {me.snr_max}")
        if me.snr_error:
            lines.append(f"snr_error           = {me.snr_error}")
        if me.ionosphere:
            lines.append(f"ionosphere          = {me.ionosphere}")
        if me.troposphere:
            lines.append(f"troposphere         = {me.troposphere}")
        if me.ura_ratio:
            lines.append(f"ura_ratio           = {me.ura_ratio}")
        lines.append("")

        ist = kf.initial_std
        lines.append("[kalman_filter.initial_std]")
        lines.append(f"bias        = {ist.bias}")
        lines.append(f"ionosphere  = {ist.ionosphere}")
        lines.append(f"troposphere = {ist.troposphere}")
        lines.append("")

        pn = kf.process_noise
        lines.append("[kalman_filter.process_noise]")
        lines.append(f"accel_h         = {pn.accel_h}")
        lines.append(f"accel_v         = {pn.accel_v}")
        lines.append(f"position_h      = {pn.position_h}")
        lines.append(f"position_v      = {pn.position_v}")
        lines.append(f"position        = {pn.position}")
        lines.append(f"bias            = {_flt(pn.bias)}")
        lines.append(f"ionosphere      = {pn.ionosphere}")
        lines.append(f"iono_max        = {pn.iono_max}")
        lines.append(f"troposphere     = {_flt(pn.troposphere)}")
        lines.append(f"iono_time_const = {pn.iono_time_const}")
        lines.append(f"clock_stability = {_flt(pn.clock_stability)}")
        if pn.ifb:
            lines.append(f"ifb             = {pn.ifb}")
        lines.append("")

        # NOTE: [adaptive_filter] moved to [positioning.clas.adaptive_filter]
        # (emitted above, CLAS modes only).

        # ── [signals] (only when using frequency mode, not signals list) ─
        if not use_signals:
            sig = config.signal_selection
            lines.append("[signals]")
            lines.append(f"gps     = {_s(sig.gps)}")
            lines.append(f"qzs     = {_s(sig.qzs)}")
            lines.append(f"galileo = {_s(sig.galileo)}")
            lines.append(f"bds2    = {_s(sig.bds2)}")
            lines.append(f"bds3    = {_s(sig.bds3)}")
            lines.append("")

        # NOTE: [receiver] dissolved in v0.7.6 — its fields were relocated to
        # positioning.{spp,relative,ppp,madoca,clas.ambiguities} (emitted above).

        # ── [input.*] (decoding options; emitted only when set) ──────────
        if srv.rinex_option_1 or srv.rinex_option_2:
            lines.append("[input.rinex]")
            if srv.rinex_option_1:
                lines.append(f"option_1 = {_s(srv.rinex_option_1)}")
            if srv.rinex_option_2:
                lines.append(f"option_2 = {_s(srv.rinex_option_2)}")
            lines.append("")
        if srv.rtcm_option:
            lines.append("[input.rtcm]")
            lines.append(f"options = {_s(srv.rtcm_option)}")
            lines.append("")
        if srv.sbas_satellite and srv.sbas_satellite != "0":
            lines.append("[input.sbas]")
            lines.append(f"satellite = {srv.sbas_satellite}")
            lines.append("")

        # ── [antenna.rover] ──────────────────────────────────────────────
        ant = config.antenna
        lines.append("[antenna.rover]")
        lines.append(f"position_type = {_s(postype_map.get(ant.rover.mode, 'llh'))}")
        lines.append(f"position_1    = {ant.rover.values[0]}")
        lines.append(f"position_2    = {ant.rover.values[1]}")
        lines.append(f"position_3    = {ant.rover.values[2]}")
        ant_type = ant.rover.antenna_type if ant.rover.antenna_type_enabled and ant.rover.antenna_type else "*"
        lines.append(f"type          = {_s(ant_type)}")
        lines.append(f"delta_e       = {ant.rover.antenna_delta[0]}")
        lines.append(f"delta_n       = {ant.rover.antenna_delta[1]}")
        lines.append(f"delta_u       = {ant.rover.antenna_delta[2]}")
        lines.append("")

        # ── [antenna.base] ───────────────────────────────────────────────
        no_base = {"single", "ppp-kinematic", "ppp-static"}
        lines.append("[antenna.base]")
        if p.positioning_mode in no_base:
            lines.append(f"position_type      = {_s('llh')}")
            lines.append("position_1         = 90.0")
            lines.append("position_2         = 0.0")
            lines.append("position_3         = -6335367.6285")
        else:
            lines.append(f"position_type      = {_s(postype_map.get(ant.base.mode, 'llh'))}")
            lines.append(f"position_1         = {ant.base.values[0]}")
            lines.append(f"position_2         = {ant.base.values[1]}")
            lines.append(f"position_3         = {ant.base.values[2]}")
        base_ant = ant.base.antenna_type if ant.base.antenna_type_enabled and ant.base.antenna_type else ""
        lines.append(f"type               = {_s(base_ant)}")
        lines.append(f"delta_e            = {ant.base.antenna_delta[0]}")
        lines.append(f"delta_n            = {ant.base.antenna_delta[1]}")
        lines.append(f"delta_u            = {ant.base.antenna_delta[2]}")
        lines.append(f"max_average_epochs = {ant.base.max_average_epochs}")
        lines.append(f"init_reset         = {_b(ant.base.init_reset)}")
        lines.append("")

        # ── [output] ─────────────────────────────────────────────────────
        out = config.output
        sol_status_map = {"off": "off", "state": "state", "residual": "residual"}
        lines.append("[output]")
        lines.append(f"format            = {_s(sol_format_map.get(out.solution_format, 'llh'))}")
        lines.append(f"header            = {_b(out.output_header)}")
        lines.append(f"options           = {_b(out.output_processing_options)}")
        lines.append(f"velocity          = {_b(out.output_velocity)}")
        lines.append(f"time_system       = {_s(time_sys_map.get(out.time_format, 'gpst'))}")
        lines.append(f"time_format       = {_s(time_form_map.get(out.time_format, 'hms'))}")
        lines.append(f"time_decimals     = {out.num_decimals}")
        lines.append(f"coordinate_format = {_s('deg' if 'ddd.d' in out.lat_lon_format else 'dms')}")
        lines.append(f"field_separator   = {_s(out.field_separator)}")
        lines.append(f"single_output     = {_b(out.output_single_on_outage)}")
        lines.append(f"max_solution_std  = {out.max_solution_std}")
        lines.append(f"height_type       = {_s(height_map.get(out.height, 'ellipsoidal'))}")
        lines.append(f"geoid_model       = {_s(geoid_map.get(out.geoid_model, 'internal'))}")
        lines.append(f"static_solution   = {_s(out.static_solution_mode)}")
        lines.append(f"nmea_interval_1   = {float(out.nmea_interval_rmc_gga)}")
        lines.append(f"nmea_interval_2   = {float(out.nmea_interval_gsa_gsv)}")
        lines.append(f"solution_status   = {_s(sol_status_map.get(out.output_solution_status, 'off'))}")
        lines.append("")

        # ── [files] ──────────────────────────────────────────────────────
        fl = config.files
        lines.append("[files]")
        lines.append(f"satellite_atx      = {_s(fl.satellite_atx)}")
        lines.append(f"receiver_atx       = {_s(fl.receiver_atx)}")
        lines.append(f"station_pos        = {_s(fl.station_pos)}")
        lines.append(f"geoid              = {_s(fl.geoid)}")
        lines.append(f"ionosphere         = {_s(fl.ionosphere)}")
        lines.append(f"dcb                = {_s(fl.dcb)}")
        lines.append(f"eop                = {_s(fl.eop)}")
        lines.append(f"ocean_loading      = {_s(fl.ocean_loading)}")
        if fl.temp_dir:
            lines.append(f"temp_dir           = {_s(fl.temp_dir)}")
        if fl.trace:
            lines.append(f"trace              = {_s(fl.trace)}")
        if fl.fcb:
            lines.append(f"fcb                = {_s(fl.fcb)}")
        if fl.bias_sinex:
            lines.append(f"bias_sinex         = {_s(fl.bias_sinex)}")
        if fl.cssr_grid:
            lines.append(f"cssr_grid          = {_s(fl.cssr_grid)}")
        if fl.isb_table:
            lines.append(f"isb_table          = {_s(fl.isb_table)}")
        if fl.phase_cycle:
            lines.append(f"phase_cycle        = {_s(fl.phase_cycle)}")
        if fl.cmd_file_1:
            lines.append(f"cmd_file_1         = {_s(fl.cmd_file_1)}")
        if fl.cmd_file_2:
            lines.append(f"cmd_file_2         = {_s(fl.cmd_file_2)}")
        if fl.cmd_file_3:
            lines.append(f"cmd_file_3         = {_s(fl.cmd_file_3)}")
        lines.append("")

        # ── [server] (rtkrcv runtime only; v0.7.6 trimmed) ───────────────
        # rinex/rtcm/sbas → [input.*]; ppp_option → [positioning.ppp];
        # time_interpolation → [positioning.relative]; max_obs_loss/float_count
        # → [positioning.clas.resilience]; l6_margin dropped (not in v0.7.6).
        lines.append("[server]")
        lines.append(f"cycle_ms       = {srv.cycle_ms}")
        lines.append(f"timeout_ms     = {srv.timeout_ms}")
        lines.append(f"reconnect_ms   = {srv.reconnect_ms}")
        lines.append(f"nmea_cycle_ms  = {srv.nmea_cycle_ms}")
        lines.append(f"buffer_size    = {srv.buffer_size}")
        lines.append(f"nav_msg_select = {_s(srv.nav_msg_select)}")
        lines.append(f"proxy          = {_s(srv.proxy)}")
        lines.append(f"swap_margin    = {srv.swap_margin}")
        if srv.start_cmd:
            lines.append(f"start_cmd      = {_s(srv.start_cmd)}")
        if srv.stop_cmd:
            lines.append(f"stop_cmd       = {_s(srv.stop_cmd)}")
        lines.append("")

        return "\n".join(lines)

    async def run_mrtk_post(
        self,
        job: MrtkPostJob,
        log_callback: Optional[callable] = None,
        progress_callback: Optional[callable] = None,
    ) -> subprocess.CompletedProcess:
        """Run mrtk post with the given job configuration."""
        # Wrap log callback to mask credentials
        if log_callback:
            _raw_log_cb = log_callback
            async def _masked_log_cb(line: str) -> None:
                await _raw_log_cb(mask_log_line(line))
            log_callback = _masked_log_cb
        conf_content = self.generate_conf_file(job.config)

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".toml", delete=False
        ) as conf_file:
            conf_file.write(conf_content)
            conf_path = conf_file.name

        stage_dir = None
        try:
            cmd = [self.mrtk_bin_path, "post", "-k", conf_path, "-o", job.input_files.output_file]

            _trace_levels = {"level1": "1", "level2": "2", "level3": "3", "level4": "4", "level5": "5"}
            trace_level = _trace_levels.get(job.config.output.debug_trace)
            if trace_level:
                cmd.extend(["-x", trace_level])

            if job.time_range:
                if job.time_range.start_time:
                    cmd.extend(["-ts", job.time_range.start_time])
                if job.time_range.end_time:
                    cmd.extend(["-te", job.time_range.end_time])
                if job.time_range.interval and job.time_range.interval > 0:
                    cmd.extend(["-ti", str(job.time_range.interval)])

            # Stage compressed inputs that live on read-only mounts (/data,
            # corrections). mrtk decompresses beside the source, which fails on
            # a read-only FS, so copy those into a writable temp dir first.
            rover = job.input_files.rover_obs_file
            base = job.input_files.base_obs_file
            nav = job.input_files.nav_file
            corr = [cf.strip() for cf in job.input_files.correction_files if cf.strip()]
            staged, stage_dir = stage_paths([rover, base, nav, *corr])

            cmd.append(staged.get(rover, rover))
            if base:
                cmd.append(staged.get(base, base))
            cmd.append(staged.get(nav, nav))
            for cf in corr:
                cmd.append(staged.get(cf, cf))

            if log_callback:
                await log_callback(f"[CMD] {' '.join(cmd)}")
                await log_callback(f"[INFO] Configuration file: {conf_path}")
                for conf_line in conf_content.split("\n"):
                    await log_callback(f"[CONF] {conf_line}")

            process = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )

            async def read_stdout(stream, callback):
                async for line in iter_lines(stream):
                    if callback:
                        await callback(line.strip())

            async def read_stderr_with_progress(stream, log_cb, progress_cb):
                buf = b""
                last_progress_time = 0.0
                while True:
                    chunk = await stream.read(1024)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\r" in buf or b"\n" in buf:
                        r_pos = buf.find(b"\r")
                        n_pos = buf.find(b"\n")
                        if r_pos == -1:
                            pos = n_pos
                        elif n_pos == -1:
                            pos = r_pos
                        else:
                            pos = min(r_pos, n_pos)
                        line = buf[:pos].decode(errors="replace").strip()
                        if pos + 1 < len(buf) and buf[pos:pos + 2] == b"\r\n":
                            buf = buf[pos + 2:]
                        else:
                            buf = buf[pos + 1:]
                        if not line:
                            continue
                        progress = parse_progress(line)
                        if progress and progress_cb:
                            now = time.monotonic()
                            if now - last_progress_time >= 0.5:
                                last_progress_time = now
                                await progress_cb(progress)
                        elif log_cb:
                            await log_cb(line)
                if buf.strip() and log_cb:
                    await log_cb(buf.decode(errors="replace").strip())

            if log_callback:
                await asyncio.gather(
                    read_stdout(process.stdout, log_callback),
                    read_stderr_with_progress(process.stderr, log_callback, progress_callback),
                )

            await process.wait()

            if log_callback:
                await log_callback(f"[INFO] Process finished with code {process.returncode}")

            return subprocess.CompletedProcess(
                args=cmd, returncode=process.returncode, stdout=b"", stderr=b"",
            )

        finally:
            try:
                Path(conf_path).unlink()
            except Exception as e:
                logger.warning(f"Failed to delete temp config file: {e}")
            remove_stage_dir(stage_dir)
