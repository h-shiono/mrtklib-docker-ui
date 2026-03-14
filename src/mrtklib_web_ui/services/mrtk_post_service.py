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
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

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
    """Parse mrtk_post progress output line.

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
    mask: list[list[float]] = Field(
        default=[[0.0] * 9, [0.0] * 9, [0.0] * 9]
    )


class ClasConfig(BaseModel):
    """[positioning.clas] — CLAS PPP-RTK specific settings."""

    grid_selection_radius: float = Field(default=1000.0)
    receiver_type: str = Field(default="")
    position_uncertainty_x: float = Field(default=10.0)
    position_uncertainty_y: float = Field(default=10.0)
    position_uncertainty_z: float = Field(default=10.0)


class PositioningConfig(BaseModel):
    """[positioning] + [positioning.corrections] + [positioning.atmosphere] + [positioning.clas]."""

    positioning_mode: str = Field(default="kinematic")
    frequency: str = Field(default="l1+l2")
    signal_mode: str = Field(default="frequency")  # "frequency" or "signals"
    signals: str = Field(default="")  # e.g. "G1C,G2W,E1C,E5Q"
    filter_type: str = Field(default="forward")
    elevation_mask: float = Field(default=15.0)
    receiver_dynamics: str = Field(default="off")
    ephemeris_option: str = Field(default="broadcast")
    constellations: ConstellationSelection = Field(default_factory=ConstellationSelection)
    excluded_satellites: str = Field(default="")

    # [positioning.snr_mask]
    snr_mask: SnrMaskConfig = Field(default_factory=SnrMaskConfig)

    # [positioning.corrections]
    satellite_pcv: bool = Field(default=False)
    receiver_pcv: bool = Field(default=False)
    phase_windup: bool = Field(default=False)
    reject_eclipse: bool = Field(default=False)
    raim_fde: bool = Field(default=False)
    earth_tides_correction: str = Field(default="off")

    # [positioning.atmosphere]
    ionosphere_correction: str = Field(default="broadcast")
    troposphere_correction: str = Field(default="saastamoinen")

    # [positioning.clas]
    clas: ClasConfig = Field(default_factory=ClasConfig)


class AmbiguityResolutionConfig(BaseModel):
    """[ambiguity_resolution] + thresholds + counters."""

    mode: str = Field(default="continuous")
    glonass_ar: str = Field(default="on")
    bds_ar: str = Field(default="on")
    qzs_ar: str = Field(default="on")

    # [ambiguity_resolution.thresholds]
    ratio: float = Field(default=3.0)
    elevation_mask: float = Field(default=0.0)
    hold_elevation: float = Field(default=0.0)

    # [ambiguity_resolution.counters]
    lock_count: int = Field(default=0)
    min_fix: int = Field(default=10)
    max_iterations: int = Field(default=1)
    out_count: int = Field(default=5)


class RejectionConfig(BaseModel):
    """[rejection]."""

    innovation: float = Field(default=30.0)
    gdop: float = Field(default=30.0)


class SlipDetectionConfig(BaseModel):
    """[slip_detection]."""

    threshold: float = Field(default=0.05)


class MeasurementErrorConfig(BaseModel):
    """[kalman_filter.measurement_error]."""

    code_phase_ratio_l1: float = Field(default=100.0)
    code_phase_ratio_l2: float = Field(default=100.0)
    phase: float = Field(default=0.003)
    phase_elevation: float = Field(default=0.003)
    phase_baseline: float = Field(default=0.0)
    doppler: float = Field(default=1.0)


class ProcessNoiseConfig(BaseModel):
    """[kalman_filter.process_noise]."""

    bias: float = Field(default=0.0001)
    ionosphere: float = Field(default=0.001)
    troposphere: float = Field(default=0.0001)
    accel_h: float = Field(default=1.0)
    accel_v: float = Field(default=0.1)
    clock_stability: float = Field(default=5e-12)


class KalmanFilterConfig(BaseModel):
    """[kalman_filter]."""

    iterations: int = Field(default=1)
    sync_solution: bool = Field(default=False)
    measurement_error: MeasurementErrorConfig = Field(default_factory=MeasurementErrorConfig)
    process_noise: ProcessNoiseConfig = Field(default_factory=ProcessNoiseConfig)


class StationPosition(BaseModel):
    """Station position configuration."""

    mode: str = Field(default="llh")
    values: list[float] = Field(default=[0.0, 0.0, 0.0])
    antenna_type_enabled: bool = Field(default=False)
    antenna_type: str = Field(default="")
    antenna_delta: list[float] = Field(default=[0.0, 0.0, 0.0])


class AntennaConfig(BaseModel):
    """[antenna.rover] + [antenna.base]."""

    rover: StationPosition = Field(default_factory=StationPosition)
    base: StationPosition = Field(default_factory=StationPosition)


class OutputConfig(BaseModel):
    """[output]."""

    solution_format: str = Field(default="llh")
    output_header: bool = Field(default=True)
    output_processing_options: bool = Field(default=False)
    time_format: str = Field(default="gpst")
    num_decimals: int = Field(default=3)
    lat_lon_format: str = Field(default="ddd.ddddddd")
    field_separator: str = Field(default="")
    output_velocity: bool = Field(default=False)
    datum: str = Field(default="wgs84")
    height: str = Field(default="ellipsoidal")
    geoid_model: str = Field(default="internal")
    static_solution_mode: str = Field(default="all")
    output_single_on_outage: bool = Field(default=False)
    nmea_interval_rmc_gga: int = Field(default=0)
    nmea_interval_gsa_gsv: int = Field(default=0)
    output_solution_status: str = Field(default="off")
    debug_trace: str = Field(default="off")


class FilesConfig(BaseModel):
    """[files]."""

    satellite_atx: str = Field(default="")
    receiver_atx: str = Field(default="")
    station_pos: str = Field(default="")
    geoid: str = Field(default="")
    ionosphere: str = Field(default="")
    dcb: str = Field(default="")
    eop: str = Field(default="")
    ocean_loading: str = Field(default="")
    cssr_grid: str = Field(default="")


class ServerConfig(BaseModel):
    """[server]."""

    time_interpolation: bool = Field(default=False)
    sbas_satellite: int = Field(default=0)
    rinex_option_1: str = Field(default="")
    rinex_option_2: str = Field(default="")


class ReceiverConfig(BaseModel):
    """[receiver]."""

    iono_correction: bool = Field(default=True)


class MrtkPostConfig(BaseModel):
    """Complete MRTKLIB post-processing configuration, structured by TOML sections."""

    positioning: PositioningConfig = Field(default_factory=PositioningConfig)
    ambiguity_resolution: AmbiguityResolutionConfig = Field(default_factory=AmbiguityResolutionConfig)
    rejection: RejectionConfig = Field(default_factory=RejectionConfig)
    slip_detection: SlipDetectionConfig = Field(default_factory=SlipDetectionConfig)
    kalman_filter: KalmanFilterConfig = Field(default_factory=KalmanFilterConfig)
    antenna: AntennaConfig = Field(default_factory=AntennaConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    files: FilesConfig = Field(default_factory=FilesConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    receiver: ReceiverConfig = Field(default_factory=ReceiverConfig)


class MrtkPostInputFiles(BaseModel):
    """Input files for mrtk_post."""

    rover_obs_file: str
    nav_file: str
    base_obs_file: Optional[str] = None
    correction_files: list[str] = Field(default_factory=list)
    output_file: str


class MrtkPostTimeRange(BaseModel):
    """Time range for processing."""

    start_time: Optional[str] = None
    end_time: Optional[str] = None
    interval: Optional[float] = None


class MrtkPostJob(BaseModel):
    """Complete mrtk_post job specification."""

    input_files: MrtkPostInputFiles
    config: MrtkPostConfig
    time_range: Optional[MrtkPostTimeRange] = None


class MrtkPostService:
    """Service for running mrtk_post post-processing."""

    def __init__(self, mrtk_bin_path: str = "/usr/local/bin/mrtk"):
        """Initialize the service.

        Args:
            mrtk_bin_path: Path to the mrtk binary
        """
        self.mrtk_bin_path = mrtk_bin_path

    def generate_conf_file(self, config: MrtkPostConfig) -> str:
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
            "ppp-fixed": "ppp-fixed", "ppp-rtk": "ppp-rtk",
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

        p = config.positioning

        # --- [positioning] ---
        lines.append("[positioning]")
        lines.append(f"mode                = {_str(pos_mode_map.get(p.positioning_mode, 'kinematic'))}")
        # frequency vs signals: signals takes effect when signals is non-empty and not MADOCA-PPP
        is_madoca_ppp = p.positioning_mode in ("ppp-kinematic", "ppp-static", "ppp-fixed")
        use_signals = (p.signals.strip() != "" and not is_madoca_ppp)
        if use_signals:
            sig_list = [s.strip() for s in p.signals.replace(",", " ").split() if s.strip()]
            lines.append(f"signals             = [{', '.join(f'{_str(s)}' for s in sig_list)}]")
        else:
            lines.append(f"frequency           = {_str(freq_map.get(p.frequency, 'l1+2'))}")
        lines.append(f"solution_type       = {_str(filter_type_map.get(p.filter_type, 'forward'))}")
        lines.append(f"elevation_mask      = {p.elevation_mask}")
        lines.append(f"dynamics            = {_bool(p.receiver_dynamics == 'on')}")
        lines.append(f"satellite_ephemeris = {_str(ephem_map.get(p.ephemeris_option, 'brdc'))}")
        if p.excluded_satellites.strip():
            sats = [s.strip() for s in p.excluded_satellites.replace(",", " ").split() if s.strip()]
            sat_list = ", ".join(f'"{s}"' for s in sats)
            lines.append(f"excluded_sats       = [{sat_list}]")
        else:
            lines.append(f"excluded_sats       = []")
        c = p.constellations
        systems = []
        if c.gps: systems.append('"GPS"')
        if c.glonass: systems.append('"GLONASS"')
        if c.galileo: systems.append('"Galileo"')
        if c.qzss: systems.append('"QZSS"')
        if c.sbas: systems.append('"SBAS"')
        if c.beidou: systems.append('"BeiDou"')
        if c.irnss: systems.append('"NavIC"')
        lines.append(f"systems             = [{', '.join(systems)}]")
        lines.append("")

        # --- [positioning.snr_mask] ---
        lines.append("[positioning.snr_mask]")
        lines.append(f"rover_enabled = {_bool(p.snr_mask.enable_rover)}")
        lines.append(f"base_enabled  = {_bool(p.snr_mask.enable_base)}")
        for i, label in enumerate(["L1", "L2", "L5"]):
            if i < len(p.snr_mask.mask):
                lines.append(f"{label}            = {_arr(p.snr_mask.mask[i])}")
        lines.append("")

        # --- [positioning.corrections] ---
        lines.append("[positioning.corrections]")
        lines.append(f"satellite_antenna  = {_bool(p.satellite_pcv)}")
        lines.append(f"receiver_antenna   = {_bool(p.receiver_pcv)}")
        lines.append(f"phase_windup       = {_str('on' if p.phase_windup else 'off')}")
        lines.append(f"exclude_eclipse    = {_bool(p.reject_eclipse)}")
        lines.append(f"raim_fde           = {_bool(p.raim_fde)}")
        lines.append(f"tidal_correction   = {_str(tides_map.get(p.earth_tides_correction, 'off'))}")
        lines.append("")

        # --- [positioning.atmosphere] ---
        lines.append("[positioning.atmosphere]")
        lines.append(f"ionosphere       = {_str(iono_map.get(p.ionosphere_correction, 'brdc'))}")
        lines.append(f"troposphere      = {_str(tropo_map.get(p.troposphere_correction, 'saas'))}")
        lines.append("")

        # --- [positioning.clas] (only for ppp-rtk mode) ---
        if p.positioning_mode == "ppp-rtk":
            clas = p.clas
            lines.append("[positioning.clas]")
            lines.append(f"grid_selection_radius = {clas.grid_selection_radius}")
            lines.append(f"receiver_type         = {_str(clas.receiver_type)}")
            lines.append(f"position_uncertainty_x = {clas.position_uncertainty_x}")
            lines.append(f"position_uncertainty_y = {clas.position_uncertainty_y}")
            lines.append(f"position_uncertainty_z = {clas.position_uncertainty_z}")
            lines.append("")

        # --- [ambiguity_resolution] ---
        glo_ar_map = {"off": "off", "on": "on", "autocal": "autocal"}
        bds_ar_map = {"off": "off", "on": "on"}
        qzs_ar_map = {"off": "off", "on": "on"}
        ar = config.ambiguity_resolution
        lines.append("[ambiguity_resolution]")
        lines.append(f"mode       = {_str(ar_mode_map.get(ar.mode, 'continuous'))}")
        lines.append(f"glonass_ar = {_str(glo_ar_map.get(ar.glonass_ar, 'on'))}")
        lines.append(f"bds_ar     = {_str(bds_ar_map.get(ar.bds_ar, 'on'))}")
        lines.append(f"qzs_ar     = {_str(qzs_ar_map.get(ar.qzs_ar, 'on'))}")
        lines.append("")

        # --- [ambiguity_resolution.thresholds] ---
        lines.append("[ambiguity_resolution.thresholds]")
        lines.append(f"ratio          = {ar.ratio}")
        lines.append(f"elevation_mask = {ar.elevation_mask}")
        lines.append(f"hold_elevation = {ar.hold_elevation}")
        lines.append("")

        # --- [ambiguity_resolution.counters] ---
        lines.append("[ambiguity_resolution.counters]")
        lines.append(f"lock_count     = {ar.lock_count}")
        lines.append(f"min_fix        = {ar.min_fix}")
        lines.append(f"max_iterations = {ar.max_iterations}")
        lines.append(f"out_count      = {ar.out_count}")
        lines.append("")

        # --- [rejection] ---
        rej = config.rejection
        lines.append("[rejection]")
        lines.append(f"innovation = {rej.innovation}")
        lines.append(f"gdop       = {rej.gdop}")
        lines.append("")

        # --- [slip_detection] ---
        lines.append("[slip_detection]")
        lines.append(f"threshold = {config.slip_detection.threshold}")
        lines.append("")

        # --- [kalman_filter] ---
        kf = config.kalman_filter
        lines.append("[kalman_filter]")
        lines.append(f"iterations    = {kf.iterations}")
        lines.append(f"sync_solution = {_bool(kf.sync_solution)}")
        lines.append("")

        # --- [kalman_filter.measurement_error] ---
        me = kf.measurement_error
        lines.append("[kalman_filter.measurement_error]")
        lines.append(f"code_phase_ratio_L1 = {me.code_phase_ratio_l1}")
        lines.append(f"code_phase_ratio_L2 = {me.code_phase_ratio_l2}")
        lines.append(f"phase               = {me.phase}")
        lines.append(f"phase_elevation     = {me.phase_elevation}")
        lines.append(f"phase_baseline      = {me.phase_baseline}")
        lines.append(f"doppler             = {me.doppler}")
        lines.append("")

        # --- [kalman_filter.process_noise] ---
        pn = kf.process_noise
        lines.append("[kalman_filter.process_noise]")
        lines.append(f"bias        = {pn.bias:.2e}")
        lines.append(f"ionosphere  = {pn.ionosphere}")
        lines.append(f"troposphere = {pn.troposphere:.2e}")
        lines.append(f"accel_h     = {pn.accel_h}")
        lines.append(f"accel_v     = {pn.accel_v}")
        lines.append(f"clock_stability = {pn.clock_stability:.2e}")
        lines.append("")

        # --- [receiver] ---
        lines.append("[receiver]")
        lines.append(f"iono_correction = {_bool(config.receiver.iono_correction)}")
        lines.append("")

        # --- [antenna.rover] ---
        ant = config.antenna
        lines.append("[antenna.rover]")
        lines.append(f"position_type = {_str(postype_map.get(ant.rover.mode, 'llh'))}")
        lines.append(f"position_1    = {ant.rover.values[0]}")
        lines.append(f"position_2    = {ant.rover.values[1]}")
        lines.append(f"position_3    = {ant.rover.values[2]}")
        ant_type = ant.rover.antenna_type if ant.rover.antenna_type_enabled and ant.rover.antenna_type else "*"
        lines.append(f"type          = {_str(ant_type)}")
        lines.append(f"delta_e       = {ant.rover.antenna_delta[0]}")
        lines.append(f"delta_n       = {ant.rover.antenna_delta[1]}")
        lines.append(f"delta_u       = {ant.rover.antenna_delta[2]}")
        lines.append("")

        # --- [antenna.base] ---
        lines.append("[antenna.base]")
        no_base_modes = {"single", "ppp-kinematic", "ppp-static"}
        if p.positioning_mode in no_base_modes:
            lines.append(f"position_type      = {_str('llh')}")
            lines.append(f"position_1         = 90.0")
            lines.append(f"position_2         = 0.0")
            lines.append(f"position_3         = -6335367.6285")
        else:
            lines.append(f"position_type      = {_str(postype_map.get(ant.base.mode, 'llh'))}")
            lines.append(f"position_1         = {ant.base.values[0]}")
            lines.append(f"position_2         = {ant.base.values[1]}")
            lines.append(f"position_3         = {ant.base.values[2]}")
        base_ant = ant.base.antenna_type if ant.base.antenna_type_enabled and ant.base.antenna_type else ""
        lines.append(f"type               = {_str(base_ant)}")
        lines.append(f"delta_e            = {ant.base.antenna_delta[0]}")
        lines.append(f"delta_n            = {ant.base.antenna_delta[1]}")
        lines.append(f"delta_u            = {ant.base.antenna_delta[2]}")
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
        lines.append(f"satellite_atx = {_str(f.satellite_atx)}")
        lines.append(f"receiver_atx  = {_str(f.receiver_atx)}")
        lines.append(f"station_pos   = {_str(f.station_pos)}")
        lines.append(f"geoid         = {_str(f.geoid)}")
        lines.append(f"ionosphere    = {_str(f.ionosphere)}")
        lines.append(f"dcb           = {_str(f.dcb)}")
        lines.append(f"eop           = {_str(f.eop)}")
        lines.append(f"ocean_loading = {_str(f.ocean_loading)}")
        lines.append(f"cssr_grid     = {_str(f.cssr_grid)}")
        lines.append(f"temp_dir      = \"\"")
        lines.append(f"geexe         = \"\"")
        lines.append(f"solution_stat = \"\"")
        lines.append(f"trace         = \"\"")
        lines.append("")

        # --- [server] ---
        srv = config.server
        lines.append("[server]")
        lines.append(f"time_interpolation = {_bool(srv.time_interpolation)}")
        lines.append(f"sbas_satellite     = {_str(str(srv.sbas_satellite))}")
        lines.append(f"rinex_option_1     = {_str(srv.rinex_option_1)}")
        lines.append(f"rinex_option_2     = {_str(srv.rinex_option_2)}")
        lines.append(f"ppp_option         = \"\"")
        lines.append(f"rtcm_option        = \"\"")
        lines.append("")

        return "\n".join(lines)

    async def run_mrtk_post(
        self,
        job: MrtkPostJob,
        log_callback: Optional[callable] = None,
        progress_callback: Optional[callable] = None,
    ) -> subprocess.CompletedProcess:
        """Run mrtk_post with the given job configuration.

        Args:
            job: Job specification
            log_callback: Optional callback for log messages
            progress_callback: Optional callback for progress updates (dict)

        Returns:
            CompletedProcess object

        Raises:
            FileNotFoundError: If input files don't exist
            subprocess.CalledProcessError: If mrtk_post fails
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
            # Build command: mrtk post [options] input_files
            cmd = [
                self.mrtk_bin_path,
                "post",
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

            # Add correction files (SP3, CLK, FCB, IONEX, L6, etc.)
            for cf in job.input_files.correction_files:
                if cf.strip():
                    cmd.append(cf.strip())

            if log_callback:
                await log_callback(f"[CMD] {' '.join(cmd)}")
                await log_callback(f"[INFO] Configuration file: {conf_path}")
                # Log generated conf content for debugging
                for conf_line in conf_content.split("\n"):
                    await log_callback(f"[CONF] {conf_line}")

            # Run mrtk_post
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

            # Stream stderr with \r handling for mrtk_post progress
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
