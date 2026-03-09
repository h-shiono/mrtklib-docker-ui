"""
rnx2rtkp service for post-processing GNSS data.
"""

import asyncio
import logging
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Pattern to match rnx2rtkp progress output:
# "processing : 2024/01/01 00:00:00.0 Q=1 ns=10 ratio=50.0"
_PROGRESS_PATTERN = re.compile(
    r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)"  # epoch time
    r".*?Q=(\d+)"                                             # quality
    r"(?:.*?ns=\s*(\d+))?"                                    # num satellites (optional)
    r"(?:.*?ratio=\s*([\d.]+))?"                              # AR ratio (optional)
)


def parse_progress(line: str) -> dict[str, Any] | None:
    """Parse rnx2rtkp progress output line.

    Returns dict with epoch, quality, ns, ratio if matched, else None.
    """
    m = _PROGRESS_PATTERN.search(line)
    if not m:
        return None
    return {
        "epoch": m.group(1).strip(),
        "quality": int(m.group(2)),
        "ns": int(m.group(3)) if m.group(3) else None,
        "ratio": float(m.group(4)) if m.group(4) else None,
    }


class ConstellationSelection(BaseModel):
    """Satellite constellation selection."""

    gps: bool = Field(default=True)
    glonass: bool = Field(default=True)
    galileo: bool = Field(default=True)
    qzss: bool = Field(default=True)
    sbas: bool = Field(default=True)
    beidou: bool = Field(default=True)
    irnss: bool = Field(default=False)


class SnrMaskConfig(BaseModel):
    """SNR mask configuration."""

    enable_rover: bool = Field(default=False)
    enable_base: bool = Field(default=False)
    # Matrix: [Frequency_Index][Elevation_Bin_Index]
    # Frequencies: L1=0, L2=1, L5=2
    # Elevation bins: <5, 15, 25, 35, 45, 55, 65, 75, >85 (9 bins)
    mask: list[list[float]] = Field(
        default=[
            [0.0] * 9,  # L1
            [0.0] * 9,  # L2
            [0.0] * 9,  # L5
        ]
    )


class Setting1Config(BaseModel):
    """Setting 1: Basic positioning parameters."""

    # Group A: Basic Strategy
    positioning_mode: str = Field(default="kinematic")
    frequency: str = Field(default="l1+l2")
    filter_type: str = Field(default="forward")

    # Group B: Masks & Environment
    elevation_mask: float = Field(default=15.0)
    snr_mask: SnrMaskConfig = Field(default_factory=SnrMaskConfig)
    ionosphere_correction: str = Field(default="broadcast")
    troposphere_correction: str = Field(default="saastamoinen")
    ephemeris_option: str = Field(default="broadcast")

    # Group C: Satellite Selection
    constellations: ConstellationSelection = Field(default_factory=ConstellationSelection)
    excluded_satellites: str = Field(default="")

    # Group D: Advanced Options
    earth_tides_correction: str = Field(default="off")
    receiver_dynamics: str = Field(default="off")
    satellite_pcv: bool = Field(default=False)
    receiver_pcv: bool = Field(default=False)
    phase_windup: bool = Field(default=False)
    reject_eclipse: bool = Field(default=False)
    raim_fde: bool = Field(default=False)
    db_corr: bool = Field(default=False)


class BaselineLengthConstraint(BaseModel):
    """Baseline length constraint configuration."""

    enabled: bool = Field(default=False)
    length: float = Field(default=0.0)
    sigma: float = Field(default=0.0)


class Setting2Config(BaseModel):
    """Setting 2: Ambiguity resolution parameters."""

    # Section A: Ambiguity Resolution Strategy
    gps_ar_mode: str = Field(default="continuous")
    glo_ar_mode: str = Field(default="on")
    bds_ar_mode: str = Field(default="on")
    min_ratio_to_fix: float = Field(default=3.0)

    # Section B: Thresholds & Validation
    min_confidence: float = Field(default=0.9999)
    max_fcb: float = Field(default=0.25)
    min_lock_to_fix: int = Field(default=0)
    min_elevation_to_fix: float = Field(default=0.0)
    min_fix_to_hold: int = Field(default=10)
    min_elevation_to_hold: float = Field(default=0.0)
    outage_to_reset: int = Field(default=5)
    slip_threshold: float = Field(default=0.05)
    max_age_diff: float = Field(default=30.0)
    sync_solution: bool = Field(default=False)
    reject_threshold_gdop: float = Field(default=30.0)
    reject_threshold_innovation: float = Field(default=30.0)

    # Section C: Advanced Filter
    max_ar_iter: int = Field(default=1)
    num_filter_iterations: int = Field(default=1)
    baseline_length_constraint: BaselineLengthConstraint = Field(default_factory=BaselineLengthConstraint)


class OutputConfig(BaseModel):
    """Output format configuration."""

    # Group A: Format Configuration
    solution_format: str = Field(default="llh")
    output_header: bool = Field(default=True)
    output_processing_options: bool = Field(default=False)
    time_format: str = Field(default="gpst")
    num_decimals: int = Field(default=3)
    lat_lon_format: str = Field(default="ddd.ddddddd")
    field_separator: str = Field(default="")
    output_velocity: bool = Field(default=False)

    # Group B: Datum & Geoid
    datum: str = Field(default="wgs84")
    height: str = Field(default="ellipsoidal")
    geoid_model: str = Field(default="internal")

    # Group C: Output Control
    static_solution_mode: str = Field(default="all")
    output_single_on_outage: bool = Field(default=False)
    nmea_interval_rmc_gga: int = Field(default=0)
    nmea_interval_gsa_gsv: int = Field(default=0)
    output_solution_status: str = Field(default="off")
    debug_trace: str = Field(default="off")


class StatsConfig(BaseModel):
    """Error models and process noises configuration."""

    # Group A: Measurement Errors (1-sigma)
    code_phase_ratio_l1: float = Field(default=100.0)
    code_phase_ratio_l2: float = Field(default=100.0)
    phase_error_a: float = Field(default=0.003)
    phase_error_b: float = Field(default=0.003)
    phase_error_baseline: float = Field(default=0.0)
    doppler_frequency: float = Field(default=1.0)

    # Group B: Process Noises (1-sigma/sqrt(s))
    receiver_accel_horiz: float = Field(default=1.0)
    receiver_accel_vert: float = Field(default=0.1)
    carrier_phase_bias: float = Field(default=0.0001)
    ionospheric_delay: float = Field(default=0.001)
    tropospheric_delay: float = Field(default=0.0001)
    satellite_clock_stability: float = Field(default=5e-12)


class StationPosition(BaseModel):
    """Station position configuration."""

    mode: str = Field(default="llh")  # llh, xyz, rtcm, rinex, average
    values: list[float] = Field(default=[0.0, 0.0, 0.0])
    antenna_type_enabled: bool = Field(default=False)
    antenna_type: str = Field(default="")
    antenna_delta: list[float] = Field(default=[0.0, 0.0, 0.0])  # E, N, U in meters


class PositionsConfig(BaseModel):
    """Rover and base station positions configuration."""

    rover: StationPosition = Field(default_factory=StationPosition)
    base: StationPosition = Field(default_factory=StationPosition)
    station_position_file: str = Field(default="")


class BasePositionConfig(BaseModel):
    """Base station position configuration."""

    latitude: float = Field(default=0.0)
    longitude: float = Field(default=0.0)
    height: float = Field(default=0.0)
    use_rinex_header: bool = Field(default=True)


class FilesConfig(BaseModel):
    """Auxiliary files configuration."""

    antex1: str = Field(default="")
    antex2: str = Field(default="")
    geoid: str = Field(default="")
    dcb: str = Field(default="")
    eop: str = Field(default="")
    blq: str = Field(default="")
    ionosphere: str = Field(default="")


class MiscConfig(BaseModel):
    """Miscellaneous configuration."""

    time_system: str = Field(default="gpst")
    ionosphere_correction: bool = Field(default=True)
    troposphere_correction: bool = Field(default=True)
    time_interpolation: bool = Field(default=False)
    dgps_corrections: str = Field(default="off")
    sbas_sat_selection: int = Field(default=0)
    rinex_opt_rover: str = Field(default="")
    rinex_opt_base: str = Field(default="")


class Rnx2RtkpConfig(BaseModel):
    """Complete rnx2rtkp configuration."""

    setting1: Setting1Config = Field(default_factory=Setting1Config)
    setting2: Setting2Config = Field(default_factory=Setting2Config)
    output: OutputConfig = Field(default_factory=OutputConfig)
    stats: StatsConfig = Field(default_factory=StatsConfig)
    positions: PositionsConfig = Field(default_factory=PositionsConfig)
    base_position: BasePositionConfig = Field(default_factory=BasePositionConfig)
    files: FilesConfig = Field(default_factory=FilesConfig)
    misc: MiscConfig = Field(default_factory=MiscConfig)


class Rnx2RtkpInputFiles(BaseModel):
    """Input files for rnx2rtkp."""

    rover_obs_file: str
    nav_file: str
    base_obs_file: Optional[str] = None
    output_file: str


class Rnx2RtkpTimeRange(BaseModel):
    """Time range for processing."""

    start_time: Optional[str] = None
    end_time: Optional[str] = None
    interval: Optional[float] = None


class Rnx2RtkpJob(BaseModel):
    """Complete rnx2rtkp job specification."""

    input_files: Rnx2RtkpInputFiles
    config: Rnx2RtkpConfig
    time_range: Optional[Rnx2RtkpTimeRange] = None


class Rnx2RtkpService:
    """Service for running rnx2rtkp post-processing."""

    def __init__(self, rtklib_bin_path: str = "/usr/local/bin/rnx2rtkp"):
        """Initialize the service.

        Args:
            rtklib_bin_path: Path to the rnx2rtkp binary
        """
        self.rtklib_bin_path = rtklib_bin_path

    def generate_conf_file(self, config: Rnx2RtkpConfig) -> str:
        """Generate MRTKLIB TOML configuration file content.

        Args:
            config: Configuration object

        Returns:
            TOML configuration file content as string
        """
        lines = ["# MRTKLIB Configuration (TOML v1.0.0)", ""]

        # --- Value mapping tables (frontend values → MRTKLIB TOML values) ---
        pos_mode_map = {
            "single": "single", "dgps": "dgps", "kinematic": "kinematic",
            "static": "static", "moving-base": "movingbase", "fixed": "fixed",
            "ppp-kinematic": "ppp-kine", "ppp-static": "ppp-static",
        }
        freq_map = {
            "l1": "l1", "l1+l2": "l1+2", "l1+l2+l5": "l1+2+3",
            "l1+l2+l5+l6": "l1+2+3+4", "l1+l2+l5+l6+l7": "l1+2+3+4+5",
        }
        filter_type_map = {"forward": "forward", "backward": "backward", "combined": "combined"}
        iono_map = {
            "off": "off", "broadcast": "brdc", "sbas": "sbas", "dual-freq": "dual-freq",
            "est-stec": "est-stec", "ionex-tec": "ionex-tec", "qzs-brdc": "qzs-brdc",
        }
        tropo_map = {
            "off": "off", "saastamoinen": "saas", "sbas": "sbas",
            "est-ztd": "est-ztd", "est-ztdgrad": "est-ztdgrad",
        }
        ephem_map = {
            "broadcast": "brdc", "precise": "precise", "brdc+sbas": "brdc+sbas",
            "brdc+ssrapc": "brdc+ssrapc", "brdc+ssrcom": "brdc+ssrcom",
        }
        tides_map = {"off": "off", "on": "on", "otl": "otl"}
        ar_mode_map = {
            "off": "off", "continuous": "continuous",
            "instantaneous": "instantaneous", "fix-and-hold": "fix-and-hold",
        }
        glo_ar_map = {"off": "off", "on": "on", "autocal": "autocal", "fix-and-hold": "fix-and-hold"}
        bds_ar_map = {"off": "off", "on": "on"}
        sol_format_map = {"llh": "llh", "xyz": "xyz", "enu": "enu", "nmea": "nmea"}
        time_sys_map = {"gpst": "gpst", "gpst-hms": "gpst", "utc": "utc", "jst": "jst"}
        time_form_map = {"gpst": "tow", "gpst-hms": "hms", "utc": "hms", "jst": "hms"}
        coord_format_map = {"ddd.ddddddd": "deg", "ddd-mm-ss.ss": "dms"}
        height_map = {"ellipsoidal": "ellipsoidal", "geodetic": "geodetic"}
        geoid_map = {
            "internal": "internal", "egm96": "egm96", "egm08_2.5": "egm08_2.5",
            "egm08_1": "egm08_1", "gsi2000": "gsi2000",
        }
        sol_static_map = {"all": "all", "single": "single"}
        sol_status_map = {"off": "off", "level1": "state", "level2": "residual"}
        postype_map = {
            "llh": "llh", "xyz": "xyz", "single": "single",
            "posfile": "posfile", "rinex": "rinexhead", "rtcm": "rtcm",
        }

        def _str(v: str) -> str:
            return f'"{v}"'

        def _bool(v: bool) -> str:
            return "true" if v else "false"

        def _arr(vals: list) -> str:
            return "[" + ", ".join(str(int(v)) if v == int(v) else str(v) for v in vals) + "]"

        s1 = config.setting1

        # --- [positioning] ---
        lines.append("[positioning]")
        lines.append(f"mode                = {_str(pos_mode_map.get(s1.positioning_mode, 'kinematic'))}")
        lines.append(f"frequency           = {_str(freq_map.get(s1.frequency, 'l1+2'))}")
        lines.append(f"solution_type       = {_str(filter_type_map.get(s1.filter_type, 'forward'))}")
        lines.append(f"elevation_mask      = {s1.elevation_mask}")
        lines.append(f"dynamics            = {_bool(s1.receiver_dynamics == 'on')}")
        lines.append(f"satellite_ephemeris = {_str(ephem_map.get(s1.ephemeris_option, 'brdc'))}")
        lines.append(f"excluded_sats       = {_str(s1.excluded_satellites)}")
        # Navigation system bitmask: GPS=1, SBAS=2, GLO=4, GAL=8, QZS=16, BDS=32, NavIC=64
        navsys = 0
        c = s1.constellations
        if c.gps: navsys |= 1
        if c.sbas: navsys |= 2
        if c.glonass: navsys |= 4
        if c.galileo: navsys |= 8
        if c.qzss: navsys |= 16
        if c.beidou: navsys |= 32
        if c.irnss: navsys |= 64
        lines.append(f"constellations      = {navsys}")
        lines.append("")

        # --- [positioning.snr_mask] ---
        lines.append("[positioning.snr_mask]")
        lines.append(f"rover_enabled = {_bool(s1.snr_mask.enable_rover)}")
        lines.append(f"base_enabled  = {_bool(s1.snr_mask.enable_base)}")
        for i, label in enumerate(["L1", "L2", "L5"]):
            if i < len(s1.snr_mask.mask):
                lines.append(f"{label}            = {_arr(s1.snr_mask.mask[i])}")
        lines.append("")

        # --- [positioning.corrections] ---
        lines.append("[positioning.corrections]")
        lines.append(f"satellite_antenna = {_bool(s1.satellite_pcv)}")
        lines.append(f"receiver_antenna  = {_bool(s1.receiver_pcv)}")
        # phase_windup: bool in frontend → "on"/"off" string in TOML
        lines.append(f"phase_windup      = {_str('on' if s1.phase_windup else 'off')}")
        lines.append(f"raim_fde          = {_bool(s1.raim_fde)}")
        lines.append("")

        # --- [positioning.atmosphere] ---
        lines.append("[positioning.atmosphere]")
        lines.append(f"tidal_correction = {_str(tides_map.get(s1.earth_tides_correction, 'off'))}")
        lines.append(f"ionosphere       = {_str(iono_map.get(s1.ionosphere_correction, 'brdc'))}")
        lines.append(f"troposphere      = {_str(tropo_map.get(s1.troposphere_correction, 'saas'))}")
        lines.append("")

        # --- [ambiguity_resolution] ---
        s2 = config.setting2
        lines.append("[ambiguity_resolution]")
        lines.append(f"mode    = {_str(ar_mode_map.get(s2.gps_ar_mode, 'continuous'))}")
        lines.append("")

        # --- [ambiguity_resolution.thresholds] ---
        lines.append("[ambiguity_resolution.thresholds]")
        lines.append(f"ratio          = {s2.min_ratio_to_fix}")
        lines.append(f"elevation_mask = {s2.min_elevation_to_fix}")
        lines.append(f"hold_elevation = {s2.min_elevation_to_hold}")
        lines.append("")

        # --- [ambiguity_resolution.counters] ---
        lines.append("[ambiguity_resolution.counters]")
        lines.append(f"lock_count     = {s2.min_lock_to_fix}")
        lines.append(f"min_fix        = {s2.min_fix_to_hold}")
        lines.append(f"max_iterations = {s2.max_ar_iter}")
        lines.append(f"out_count      = {s2.outage_to_reset}")
        lines.append("")

        # --- [rejection] ---
        lines.append("[rejection]")
        lines.append(f"innovation = {s2.reject_threshold_innovation}")
        lines.append(f"gdop       = {s2.reject_threshold_gdop}")
        lines.append("")

        # --- [slip_detection] ---
        lines.append("[slip_detection]")
        lines.append(f"threshold = {s2.slip_threshold}")
        lines.append("")

        # --- [kalman_filter] ---
        lines.append("[kalman_filter]")
        lines.append(f"iterations    = {s2.num_filter_iterations}")
        lines.append(f"sync_solution = {_bool(s2.sync_solution)}")
        lines.append("")

        # --- [kalman_filter.measurement_error] ---
        st = config.stats
        lines.append("[kalman_filter.measurement_error]")
        lines.append(f"code_phase_ratio_L1 = {st.code_phase_ratio_l1}")
        lines.append(f"code_phase_ratio_L2 = {st.code_phase_ratio_l2}")
        lines.append(f"phase               = {st.phase_error_a}")
        lines.append(f"phase_elevation     = {st.phase_error_b}")
        lines.append(f"phase_baseline      = {st.phase_error_baseline}")
        lines.append(f"doppler             = {st.doppler_frequency}")
        lines.append("")

        # --- [kalman_filter.process_noise] ---
        lines.append("[kalman_filter.process_noise]")
        lines.append(f"bias        = {st.carrier_phase_bias:.2e}")
        lines.append(f"ionosphere  = {st.ionospheric_delay}")
        lines.append(f"troposphere = {st.tropospheric_delay:.2e}")
        lines.append(f"accel_h     = {st.receiver_accel_horiz}")
        lines.append(f"accel_v     = {st.receiver_accel_vert}")
        lines.append(f"clock_stability = {st.satellite_clock_stability:.2e}")
        lines.append("")

        # --- [receiver] ---
        lines.append("[receiver]")
        m = config.misc
        lines.append(f"iono_correction = {_bool(m.ionosphere_correction)}")
        lines.append("")

        # --- [antenna.rover] ---
        pos = config.positions
        lines.append("[antenna.rover]")
        lines.append(f"position_type = {_str(postype_map.get(pos.rover.mode, 'llh'))}")
        lines.append(f"position_1    = {pos.rover.values[0]}")
        lines.append(f"position_2    = {pos.rover.values[1]}")
        lines.append(f"position_3    = {pos.rover.values[2]}")
        ant_type = pos.rover.antenna_type if pos.rover.antenna_type_enabled and pos.rover.antenna_type else "*"
        lines.append(f"type          = {_str(ant_type)}")
        lines.append(f"delta_e       = {pos.rover.antenna_delta[0]}")
        lines.append(f"delta_n       = {pos.rover.antenna_delta[1]}")
        lines.append(f"delta_u       = {pos.rover.antenna_delta[2]}")
        lines.append("")

        # --- [antenna.base] ---
        lines.append("[antenna.base]")
        no_base_modes = {"single", "ppp-kinematic", "ppp-static"}
        if s1.positioning_mode in no_base_modes:
            lines.append(f"position_type      = {_str('llh')}")
            lines.append(f"position_1         = 90.0")
            lines.append(f"position_2         = 0.0")
            lines.append(f"position_3         = -6335367.6285")
        else:
            lines.append(f"position_type      = {_str(postype_map.get(pos.base.mode, 'llh'))}")
            lines.append(f"position_1         = {pos.base.values[0]}")
            lines.append(f"position_2         = {pos.base.values[1]}")
            lines.append(f"position_3         = {pos.base.values[2]}")
        base_ant = pos.base.antenna_type if pos.base.antenna_type_enabled and pos.base.antenna_type else ""
        lines.append(f"type               = {_str(base_ant)}")
        lines.append(f"delta_e            = {pos.base.antenna_delta[0]}")
        lines.append(f"delta_n            = {pos.base.antenna_delta[1]}")
        lines.append(f"delta_u            = {pos.base.antenna_delta[2]}")
        lines.append(f"max_average_epochs = 0")
        lines.append(f"init_reset         = false")
        lines.append("")

        # --- [output] ---
        out = config.output
        lines.append("[output]")
        lines.append(f"format            = {_str(sol_format_map.get(out.solution_format, 'llh'))}")
        lines.append(f"header            = {_bool(out.output_header)}")
        lines.append(f"options           = {_bool(out.output_processing_options)}")
        lines.append(f"velocity          = {_bool(out.output_velocity)}")
        lines.append(f"time_system       = {_str(time_sys_map.get(out.time_format, 'gpst'))}")
        lines.append(f"time_format       = {_str(time_form_map.get(out.time_format, 'hms'))}")
        lines.append(f"time_decimals     = {out.num_decimals}")
        lines.append(f"coordinate_format = {_str(coord_format_map.get(out.lat_lon_format, 'deg'))}")
        lines.append(f"field_separator   = {_str(out.field_separator)}")
        lines.append(f"single_output     = {_bool(out.output_single_on_outage)}")
        lines.append(f"max_solution_std  = 0.0")
        lines.append(f"height_type       = {_str(height_map.get(out.height, 'ellipsoidal'))}")
        lines.append(f"geoid_model       = {_str(geoid_map.get(out.geoid_model, 'internal'))}")
        lines.append(f"static_solution   = {_str(sol_static_map.get(out.static_solution_mode, 'all'))}")
        lines.append(f"nmea_interval_1   = {float(out.nmea_interval_rmc_gga)}")
        lines.append(f"nmea_interval_2   = {float(out.nmea_interval_gsa_gsv)}")
        lines.append(f"solution_status   = {_str(sol_status_map.get(out.output_solution_status, 'off'))}")
        lines.append("")

        # --- [files] ---
        f = config.files
        lines.append("[files]")
        lines.append(f"satellite_atx = {_str(f.antex1)}")
        lines.append(f"receiver_atx  = {_str(f.antex2)}")
        lines.append(f"station_pos   = {_str(pos.station_position_file)}")
        lines.append(f"geoid         = {_str(f.geoid)}")
        lines.append(f"ionosphere    = {_str(f.ionosphere)}")
        lines.append(f"dcb           = {_str(f.dcb)}")
        lines.append(f"eop           = {_str(f.eop)}")
        lines.append(f"ocean_loading = {_str(f.blq)}")
        lines.append(f"temp_dir      = \"\"")
        lines.append(f"geexe         = \"\"")
        lines.append(f"solution_stat = \"\"")
        lines.append(f"trace         = \"\"")
        lines.append("")

        # --- [server] ---
        lines.append("[server]")
        lines.append(f"time_interpolation = {_bool(m.time_interpolation)}")
        lines.append(f"sbas_satellite     = {_str(str(m.sbas_sat_selection))}")
        lines.append(f"rinex_option_1     = {_str(m.rinex_opt_rover)}")
        lines.append(f"rinex_option_2     = {_str(m.rinex_opt_base)}")
        lines.append(f"ppp_option         = \"\"")
        lines.append(f"rtcm_option        = \"\"")
        lines.append("")

        return "\n".join(lines)

    async def run_rnx2rtkp(
        self,
        job: Rnx2RtkpJob,
        log_callback: Optional[callable] = None,
        progress_callback: Optional[callable] = None,
    ) -> subprocess.CompletedProcess:
        """Run rnx2rtkp with the given job configuration.

        Args:
            job: Job specification
            log_callback: Optional callback for log messages
            progress_callback: Optional callback for progress updates (dict)

        Returns:
            CompletedProcess object

        Raises:
            FileNotFoundError: If input files don't exist
            subprocess.CalledProcessError: If rnx2rtkp fails
        """
        # Generate config file
        conf_content = self.generate_conf_file(job.config)

        # Create temporary config file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".toml", delete=False
        ) as conf_file:
            conf_file.write(conf_content)
            conf_path = conf_file.name

        try:
            # Build command: options first, then input files
            cmd = [
                self.rtklib_bin_path,
                "-k",
                conf_path,
                "-o",
                job.input_files.output_file,
            ]

            # Add trace level via -x flag (conf file alone doesn't enable trace)
            _trace_levels = {"level1": "1", "level2": "2", "level3": "3", "level4": "4", "level5": "5"}
            trace_level = _trace_levels.get(job.config.output.debug_trace)
            if trace_level:
                cmd.extend(["-x", trace_level])

            # Add time range flags
            if job.time_range:
                if job.time_range.start_time:
                    cmd.extend(["-ts", job.time_range.start_time])
                if job.time_range.end_time:
                    cmd.extend(["-te", job.time_range.end_time])
                if job.time_range.interval and job.time_range.interval > 0:
                    cmd.extend(["-ti", str(job.time_range.interval)])

            # Add input files (must come after options)
            cmd.append(job.input_files.rover_obs_file)

            # Add base observation file if provided
            if job.input_files.base_obs_file:
                cmd.append(job.input_files.base_obs_file)

            # Add navigation file
            cmd.append(job.input_files.nav_file)

            if log_callback:
                await log_callback(f"[CMD] {' '.join(cmd)}")
                await log_callback(f"[INFO] Configuration file: {conf_path}")
                # Log generated conf content for debugging
                for conf_line in conf_content.split("\n"):
                    await log_callback(f"[CONF] {conf_line}")

            # Run rnx2rtkp
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Stream stdout (normal \n-delimited output)
            async def read_stdout(stream, callback):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    if callback:
                        await callback(line.decode().strip())

            # Stream stderr with \r handling for rnx2rtkp progress
            async def read_stderr_with_progress(stream, log_cb, progress_cb):
                buf = b""
                last_progress_time = 0.0
                while True:
                    chunk = await stream.read(1024)
                    if not chunk:
                        break
                    buf += chunk
                    # Split on \r or \n
                    while b"\r" in buf or b"\n" in buf:
                        # Find earliest delimiter
                        r_pos = buf.find(b"\r")
                        n_pos = buf.find(b"\n")
                        if r_pos == -1:
                            pos = n_pos
                        elif n_pos == -1:
                            pos = r_pos
                        else:
                            pos = min(r_pos, n_pos)
                        line = buf[:pos].decode(errors="replace").strip()
                        # Skip \r\n combo
                        if pos + 1 < len(buf) and buf[pos:pos + 2] == b"\r\n":
                            buf = buf[pos + 2:]
                        else:
                            buf = buf[pos + 1:]
                        if not line:
                            continue
                        # Try parsing progress
                        progress = parse_progress(line)
                        if progress and progress_cb:
                            now = time.monotonic()
                            # Throttle progress updates to ~2/sec
                            if now - last_progress_time >= 0.5:
                                last_progress_time = now
                                await progress_cb(progress)
                        elif log_cb:
                            await log_cb(line)
                # Flush remaining buffer
                if buf.strip() and log_cb:
                    await log_cb(buf.decode(errors="replace").strip())

            if log_callback:
                await asyncio.gather(
                    read_stdout(process.stdout, log_callback),
                    read_stderr_with_progress(
                        process.stderr, log_callback, progress_callback
                    ),
                )

            await process.wait()

            if log_callback:
                await log_callback(f"[INFO] Process finished with code {process.returncode}")

            return subprocess.CompletedProcess(
                args=cmd,
                returncode=process.returncode,
                stdout=b"",
                stderr=b"",
            )

        finally:
            # Clean up temp config file
            try:
                Path(conf_path).unlink()
            except Exception as e:
                logger.warning(f"Failed to delete temp config file: {e}")
