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
        """Generate RTKLIB .conf file content from configuration.

        Args:
            config: Configuration object

        Returns:
            Configuration file content as string
        """
        lines = []

        # --- Mapping tables ---
        pos_mode_map = {
            "single": "0", "dgps": "1", "kinematic": "2", "static": "3",
            "moving-base": "4", "fixed": "5", "ppp-kinematic": "6", "ppp-static": "7",
        }
        freq_map = {
            "l1": "1", "l1+l2": "2", "l1+l2+l5": "3",
            "l1+l2+l5+l6": "4", "l1+l2+l5+l6+l7": "5",
        }
        filter_type_map = {"forward": "0", "backward": "1", "combined": "2"}
        iono_map = {
            "off": "0", "broadcast": "1", "sbas": "2", "dual-freq": "3",
            "est-stec": "4", "ionex-tec": "5", "qzs-brdc": "6",
        }
        tropo_map = {
            "off": "0", "saastamoinen": "1", "sbas": "2",
            "est-ztd": "3", "est-ztdgrad": "4",
        }
        ephem_map = {
            "broadcast": "0", "precise": "1", "brdc+sbas": "2",
            "brdc+ssrapc": "3", "brdc+ssrcom": "4",
        }
        tides_map = {"off": "0", "on": "1", "otl": "2"}
        dynamics_map = {"off": "0", "on": "1"}
        ar_mode_map = {"off": "0", "continuous": "1", "instantaneous": "2", "fix-and-hold": "3"}
        glo_ar_map = {"off": "0", "on": "1", "autocal": "2", "fix-and-hold": "3"}
        bds_ar_map = {"off": "0", "on": "1"}
        sol_format_map = {"llh": "0", "xyz": "1", "enu": "2", "nmea": "3"}
        time_format_map = {"gpst": "0", "utc": "1", "jst": "2"}
        time_form_map = {"gpst": "1", "gpst-hms": "1", "utc": "1", "jst": "1"}  # tow=0, hms=1
        lat_lon_map = {"ddd.ddddddd": "0", "ddd-mm-ss.ss": "1"}
        height_map = {"ellipsoidal": "0", "geodetic": "1"}
        geoid_map = {"internal": "0", "egm96": "1", "egm08_2.5": "2", "egm08_1": "3", "gsi2000": "4"}
        sol_static_map = {"all": "0", "single": "1"}
        sol_status_map = {"off": "0", "level1": "1", "level2": "2"}
        trace_map = {"off": "0", "level1": "1", "level2": "2", "level3": "3", "level4": "4", "level5": "5"}

        def _bool(v: bool) -> str:
            return "1" if v else "0"

        def _onoff(v: bool) -> str:
            return "on" if v else "off"

        # --- pos1: Setting 1 ---
        s1 = config.setting1
        lines.append(f"pos1-posmode={pos_mode_map.get(s1.positioning_mode, '2')}")
        lines.append(f"pos1-frequency={freq_map.get(s1.frequency, '2')}")
        lines.append(f"pos1-soltype={filter_type_map.get(s1.filter_type, '0')}")
        lines.append(f"pos1-elmask={s1.elevation_mask}")
        lines.append(f"pos1-snrmask_r={'1' if s1.snr_mask.enable_rover else '0'}")
        lines.append(f"pos1-snrmask_b={'1' if s1.snr_mask.enable_base else '0'}")
        # SNR mask values per frequency (comma-separated, 9 elevation bins)
        for i, label in enumerate(["L1", "L2", "L5"]):
            if i < len(s1.snr_mask.mask):
                vals = ",".join(str(v) for v in s1.snr_mask.mask[i])
                lines.append(f"pos1-snrmask_{label}={vals}")
        lines.append(f"pos1-dynamics={dynamics_map.get(s1.receiver_dynamics, '0')}")
        lines.append(f"pos1-tidecorr={tides_map.get(s1.earth_tides_correction, '0')}")
        lines.append(f"pos1-ionoopt={iono_map.get(s1.ionosphere_correction, '1')}")
        lines.append(f"pos1-tropopt={tropo_map.get(s1.troposphere_correction, '1')}")
        lines.append(f"pos1-sateph={ephem_map.get(s1.ephemeris_option, '0')}")
        lines.append(f"pos1-posopt1={_bool(s1.satellite_pcv)}")
        lines.append(f"pos1-posopt2={_bool(s1.receiver_pcv)}")
        lines.append(f"pos1-posopt3={_bool(s1.phase_windup)}")
        lines.append(f"pos1-posopt4={_bool(s1.reject_eclipse)}")
        lines.append(f"pos1-posopt5={_bool(s1.raim_fde)}")
        lines.append(f"pos1-posopt6={_bool(s1.db_corr)}")
        if s1.excluded_satellites:
            lines.append(f"pos1-exclsats={s1.excluded_satellites}")
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
        lines.append(f"pos1-navsys={navsys}")

        # --- pos2: Setting 2 ---
        s2 = config.setting2
        lines.append(f"pos2-armode={ar_mode_map.get(s2.gps_ar_mode, '1')}")
        lines.append(f"pos2-gloarmode={glo_ar_map.get(s2.glo_ar_mode, '1')}")
        lines.append(f"pos2-bdsarmode={bds_ar_map.get(s2.bds_ar_mode, '1')}")
        lines.append(f"pos2-arthres={s2.min_ratio_to_fix}")
        lines.append(f"pos2-arlockcnt={s2.min_lock_to_fix}")
        lines.append(f"pos2-arelmask={s2.min_elevation_to_fix}")
        lines.append(f"pos2-arminfix={s2.min_fix_to_hold}")
        lines.append(f"pos2-elmaskhold={s2.min_elevation_to_hold}")
        lines.append(f"pos2-aroutcnt={s2.outage_to_reset}")
        lines.append(f"pos2-slipthres={s2.slip_threshold}")
        lines.append(f"pos2-maxage={s2.max_age_diff}")
        lines.append(f"pos2-syncsol={'on' if s2.sync_solution else 'off'}")
        lines.append(f"pos2-rejionno={s2.reject_threshold_innovation}")
        lines.append(f"pos2-niter={s2.num_filter_iterations}")
        if s2.baseline_length_constraint.enabled:
            lines.append(f"pos2-baselen={s2.baseline_length_constraint.length}")
            lines.append(f"pos2-basesig={s2.baseline_length_constraint.sigma}")

        # --- out: Output ---
        out = config.output
        lines.append(f"out-solformat={sol_format_map.get(out.solution_format, '0')}")
        lines.append(f"out-outhead={_onoff(out.output_header)}")
        lines.append(f"out-outopt={_onoff(out.output_processing_options)}")
        lines.append(f"out-outvel={_onoff(out.output_velocity)}")
        # Time format: gpst/utc/jst → timesys; hms vs tow → timeform
        lines.append(f"out-timesys={time_format_map.get(out.time_format, '0')}")
        lines.append(f"out-timeform={time_form_map.get(out.time_format, '1')}")
        lines.append(f"out-timendec={out.num_decimals}")
        lines.append(f"out-degform={lat_lon_map.get(out.lat_lon_format, '0')}")
        if out.field_separator:
            lines.append(f"out-fieldsep={out.field_separator}")
        lines.append(f"out-height={height_map.get(out.height, '0')}")
        lines.append(f"out-geoid={geoid_map.get(out.geoid_model, '0')}")
        lines.append(f"out-solstatic={sol_static_map.get(out.static_solution_mode, '0')}")
        lines.append(f"out-outsingle={_onoff(out.output_single_on_outage)}")
        lines.append(f"out-nmeaintv1={out.nmea_interval_rmc_gga}")
        lines.append(f"out-nmeaintv2={out.nmea_interval_gsa_gsv}")
        lines.append(f"out-outstat={sol_status_map.get(out.output_solution_status, '0')}")
        lines.append(f"out-trace={trace_map.get(out.debug_trace, '0')}")

        # --- stats: Statistics ---
        st = config.stats
        lines.append(f"stats-eratio1={st.code_phase_ratio_l1}")
        lines.append(f"stats-eratio2={st.code_phase_ratio_l2}")
        lines.append(f"stats-errphase={st.phase_error_a}")
        lines.append(f"stats-errphaseel={st.phase_error_b}")
        lines.append(f"stats-errphasebl={st.phase_error_baseline}")
        lines.append(f"stats-errdoppler={st.doppler_frequency}")
        lines.append(f"stats-prnaccelh={st.receiver_accel_horiz}")
        lines.append(f"stats-prnaccelv={st.receiver_accel_vert}")
        lines.append(f"stats-prnbias={st.carrier_phase_bias}")
        lines.append(f"stats-prniono={st.ionospheric_delay}")
        lines.append(f"stats-prntrop={st.tropospheric_delay}")
        lines.append(f"stats-clkstab={st.satellite_clock_stability}")

        # --- ant1/ant2: Positions ---
        pos = config.positions
        # Rover position type
        rover_postype_map = {"llh": "0", "xyz": "1", "single": "2", "posfile": "3", "rinex": "4", "rtcm": "5"}
        lines.append(f"ant1-postype={rover_postype_map.get(pos.rover.mode, '0')}")
        lines.append(f"ant1-pos1={pos.rover.values[0]}")
        lines.append(f"ant1-pos2={pos.rover.values[1]}")
        lines.append(f"ant1-pos3={pos.rover.values[2]}")
        if pos.rover.antenna_type_enabled and pos.rover.antenna_type:
            lines.append(f"ant1-anttype={pos.rover.antenna_type}")
        lines.append(f"ant1-antdele={pos.rover.antenna_delta[0]}")
        lines.append(f"ant1-antdeln={pos.rover.antenna_delta[1]}")
        lines.append(f"ant1-antdelu={pos.rover.antenna_delta[2]}")

        # Base position
        # postype: 0=llh, 1=xyz, 2=single, 3=posfile, 4=rinexhead, 5=rtcm
        # Modes that don't use a base station: single, ppp-kinematic, ppp-static
        no_base_modes = {"single", "ppp-kinematic", "ppp-static"}
        base_postype_map = {"llh": "0", "xyz": "1", "single": "2", "posfile": "3", "rinex": "4", "rtcm": "5"}
        if s1.positioning_mode in no_base_modes:
            # No base station needed — use safe default (llh with zeros)
            lines.append("ant2-postype=0")
            lines.append("ant2-pos1=0")
            lines.append("ant2-pos2=0")
            lines.append("ant2-pos3=0")
        else:
            lines.append(f"ant2-postype={base_postype_map.get(pos.base.mode, '0')}")
            lines.append(f"ant2-pos1={pos.base.values[0]}")
            lines.append(f"ant2-pos2={pos.base.values[1]}")
            lines.append(f"ant2-pos3={pos.base.values[2]}")
        if pos.base.antenna_type_enabled and pos.base.antenna_type:
            lines.append(f"ant2-anttype={pos.base.antenna_type}")
        lines.append(f"ant2-antdele={pos.base.antenna_delta[0]}")
        lines.append(f"ant2-antdeln={pos.base.antenna_delta[1]}")
        lines.append(f"ant2-antdelu={pos.base.antenna_delta[2]}")

        # --- file: Auxiliary files (always output, empty string = not used) ---
        f = config.files
        lines.append(f"file-satantfile={f.antex1}")
        lines.append(f"file-rcvantfile={f.antex2}")
        lines.append(f"file-geoidfile={f.geoid}")
        lines.append(f"file-dcbfile={f.dcb}")
        lines.append(f"file-eopfile={f.eop}")
        lines.append(f"file-blqfile={f.blq}")
        lines.append(f"file-ionofile={f.ionosphere}")
        lines.append(f"file-staposfile={pos.station_position_file}")

        # --- misc ---
        m = config.misc
        lines.append(f"misc-timeinterp={_onoff(m.time_interpolation)}")
        lines.append(f"misc-sbasatsel={m.sbas_sat_selection}")
        if m.rinex_opt_rover:
            lines.append(f"misc-rnxopt1={m.rinex_opt_rover}")
        if m.rinex_opt_base:
            lines.append(f"misc-rnxopt2={m.rinex_opt_base}")

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
            mode="w", suffix=".conf", delete=False
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
