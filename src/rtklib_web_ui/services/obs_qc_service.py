"""Observation data QC service — cssrlib at fixed 30-second interval.

Reads RINEX 3.x/4.x OBS files via cssrlib at 30s intervals for:
  - Satellite visibility (presence tracking)
  - SNR values
  - Az/El (when NAV file provided)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ──────────────────────────── Response Models ────────────────────────────


class ObsHeaderInfo(BaseModel):
    rinex_version: str = ""
    receiver: str = ""
    antenna: str = ""
    approx_position: list[float] = []
    interval: float = 0.0
    start_time: str = ""
    end_time: str = ""
    num_epochs: int = 0
    num_satellites: int = 0


class SatVisSegment(BaseModel):
    sat_id: str
    constellation: str
    start: float  # Unix timestamp
    end: float


class ObsQcResponse(BaseModel):
    header: ObsHeaderInfo
    visibility: list[SatVisSegment]
    snr: list[list[float]]  # [[time, sat_idx, snr, el, az], ...]
    satellites: list[str]  # Index→ID mapping
    signals: list[str]  # Available SNR signals
    decimation_factor: int
    has_elevation: bool


# ──────────────────────────── Constants ────────────────────────────

_CONSTELLATION_ORDER = {"G": 0, "R": 1, "E": 2, "C": 3, "J": 4, "S": 5, "I": 6}

QC_INTERVAL = 30.0  # Fixed 30-second sampling interval


# ──────────────────────────── Internal Helpers ────────────────────────────


def _constellation_sort_key(sat_id: str) -> tuple[int, int]:
    prefix = sat_id[0]
    try:
        prn = int(sat_id[1:])
    except ValueError:
        prn = 999
    return (_CONSTELLATION_ORDER.get(prefix, 99), prn)


def _gtime_to_unix(t) -> float:
    return float(t.time) + t.sec


def _unix_to_datetime_str(ts: float) -> str:
    import datetime

    dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


class _VisTracker:
    __slots__ = ("sat_id", "constellation", "segments", "_last_time")

    def __init__(self, sat_id: str, constellation: str) -> None:
        self.sat_id = sat_id
        self.constellation = constellation
        self.segments: list[tuple[float, float]] = []
        self._last_time = 0.0

    def update(self, t: float, gap_threshold: float) -> None:
        if self._last_time == 0.0:
            self.segments.append((t, t))
        elif t - self._last_time > gap_threshold:
            self.segments.append((t, t))
        else:
            start, _ = self.segments[-1]
            self.segments[-1] = (start, t)
        self._last_time = t


def _auto_configure_signals(dec, preferred_snr: str | None = None) -> None:
    """Register one signal per obs-type per constellation from sig_map.

    Must be called after decode_obsh() and before decode_obs().
    Uses exactly one signal per (sys, typ) pair to keep nsig consistent.
    When preferred_snr is specified (e.g., "S1C"), prefer that SNR signal.
    """
    from cssrlib.gnss import uTYP

    if not dec.sig_map:
        return

    # Group signals by (sys, typ)
    groups: dict[tuple, list] = {}
    for _sys, signals in dec.sig_map.items():
        for _idx, rnx_sig in signals.items():
            key = (rnx_sig.sys, rnx_sig.typ)
            groups.setdefault(key, []).append(rnx_sig)

    sig_list = []
    for (_sys_id, typ), candidates in groups.items():
        if typ == uTYP.S and preferred_snr:
            match = next((s for s in candidates if str(s) == preferred_snr), None)
            sig_list.append(match or candidates[0])
        else:
            sig_list.append(candidates[0])

    if sig_list:
        dec.setSignals(sig_list)


# ──────────────────────────── Main Service ────────────────────────────


def analyze_obs(
    obs_file: str,
    nav_file: str | None = None,
    signal: str | None = None,
    decimation: int = 0,
) -> ObsQcResponse:
    """Analyze a RINEX observation file for QC.

    All processing via cssrlib at QC_INTERVAL (30s) fixed interval.
    Only sampled epochs are fully decoded; intermediate epochs are
    read but skipped for satellite/SNR/Az-El extraction.
    """
    from cssrlib.rinex import rnxdec
    from cssrlib.gnss import Nav, sat2id, uTYP, ecef2pos, geodist, satazel

    obs_path = Path(obs_file)
    if not obs_path.exists():
        raise FileNotFoundError(f"OBS file not found: {obs_file}")

    # ── Decode OBS header ──
    dec = rnxdec()
    ret = dec.decode_obsh(str(obs_path))
    if ret != 0:
        raise ValueError(
            f"Failed to decode RINEX header (code={ret}). "
            "Only RINEX 3.x/4.x supported."
        )
    _auto_configure_signals(dec, preferred_snr=signal)

    header = ObsHeaderInfo(
        rinex_version=str(getattr(dec, "ver", "")),
    )
    if hasattr(dec, "rcv"):
        header.receiver = str(getattr(dec, "rcv", ""))
    if hasattr(dec, "ant"):
        header.antenna = str(getattr(dec, "ant", ""))

    pos_ecef = getattr(dec, "pos", None)
    if pos_ecef is not None and hasattr(pos_ecef, "__len__") and len(pos_ecef) >= 3:
        header.approx_position = [float(v) for v in pos_ecef[:3]]

    # Discover available SNR signals from header
    available_signals: list[str] = []
    for _sys, signals in dec.sig_map.items():
        for _idx, rnx_sig in signals.items():
            if rnx_sig.typ == uTYP.S:
                sig_str = str(rnx_sig)
                if sig_str not in available_signals:
                    available_signals.append(sig_str)
    if not available_signals:
        available_signals = ["S1C"]

    # ── Decode NAV file (optional, for Az/El) ──
    nav = None
    has_elevation = False
    receiver_pos = None
    rr = None

    if nav_file:
        nav_path = Path(nav_file)
        if nav_path.exists():
            try:
                nav = Nav()
                dec.decode_nav(str(nav_path), nav)
                if header.approx_position and len(header.approx_position) == 3:
                    rr = np.array(header.approx_position)
                    if np.linalg.norm(rr) > 1e6:
                        receiver_pos = ecef2pos(rr)
                        has_elevation = True
            except Exception as e:
                logger.warning("Failed to decode NAV file: %s", e)
                nav = None

    # ── Single pass at QC_INTERVAL ──
    sat_id_set: set[str] = set()
    vis_trackers: dict[str, _VisTracker] = {}
    snr_raw: list[tuple[float, str, float, float, float]] = []  # (t, sid, snr, el, az)

    epoch_count = 0
    sampled_count = 0
    first_time = 0.0
    last_time = 0.0
    prev_time = 0.0
    interval_sum = 0.0
    last_sampled_time = -999.0

    obs = dec.decode_obs()
    while obs.t.time > 0:
        t = _gtime_to_unix(obs.t)
        epoch_count += 1
        if epoch_count == 1:
            first_time = t
        if epoch_count > 1 and prev_time > 0:
            interval_sum += t - prev_time
        prev_time = t
        last_time = t

        # Only process at QC_INTERVAL spacing
        if t - last_sampled_time >= QC_INTERVAL:
            last_sampled_time = t
            sampled_count += 1

            # Compute satellite positions for Az/El
            sat_positions = None
            if has_elevation and nav:
                try:
                    from cssrlib.ephemeris import satposs

                    rs, _vs, _dts, _svh, _nsat = satposs(obs, nav)
                    sat_positions = rs
                except Exception:
                    sat_positions = None

            for i, sat in enumerate(obs.sat):
                if sat <= 0:
                    continue
                sid = sat2id(sat)
                sat_id_set.add(sid)

                # Visibility tracking
                if sid not in vis_trackers:
                    vis_trackers[sid] = _VisTracker(
                        sat_id=sid, constellation=sid[0]
                    )
                vis_trackers[sid].update(t, QC_INTERVAL * 2.5)

                # SNR extraction
                snr_val = 0.0
                if (
                    hasattr(obs, "S")
                    and obs.S is not None
                    and i < obs.S.shape[0]
                    and obs.S.shape[1] > 0
                ):
                    v = float(obs.S[i, 0])
                    if v > 0:
                        snr_val = v

                if snr_val <= 0:
                    continue

                el_deg = -1.0
                az_deg = -1.0

                if (
                    sat_positions is not None
                    and receiver_pos is not None
                    and rr is not None
                    and i < sat_positions.shape[0]
                ):
                    try:
                        rs_i = sat_positions[i, :]
                        if np.linalg.norm(rs_i) > 1e6:
                            _, e = geodist(rs_i, rr)
                            az, el = satazel(receiver_pos, e)
                            el_deg = float(np.degrees(el))
                            az_deg = float(np.degrees(az))
                    except Exception:
                        pass

                snr_raw.append((t, sid, snr_val, el_deg, az_deg))

        obs = dec.decode_obs()

    if epoch_count == 0:
        raise ValueError("No observation epochs found in file")

    # ── Build header ──
    avg_interval = interval_sum / max(epoch_count - 1, 1)
    header.interval = round(avg_interval, 3)
    header.start_time = _unix_to_datetime_str(first_time)
    header.end_time = _unix_to_datetime_str(last_time)
    header.num_epochs = epoch_count
    header.num_satellites = len(sat_id_set)

    # ── Build satellite index ──
    sorted_sats = sorted(sat_id_set, key=_constellation_sort_key)
    sat_index_map = {sid: idx for idx, sid in enumerate(sorted_sats)}

    # ── Build visibility segments ──
    visibility: list[SatVisSegment] = []
    for sid in sorted_sats:
        tracker = vis_trackers.get(sid)
        if tracker:
            for seg_start, seg_end in tracker.segments:
                visibility.append(
                    SatVisSegment(
                        sat_id=sid,
                        constellation=sid[0],
                        start=seg_start,
                        end=seg_end,
                    )
                )

    # ── Assign satellite indices to SNR data ──
    snr_data: list[list[float]] = [
        [t, float(sat_index_map[sid]), snr, el, az]
        for t, sid, snr, el, az in snr_raw
    ]

    return ObsQcResponse(
        header=header,
        visibility=visibility,
        snr=snr_data,
        satellites=sorted_sats,
        signals=available_signals,
        decimation_factor=max(1, int(QC_INTERVAL / avg_interval)) if avg_interval > 0 else 30,
        has_elevation=has_elevation,
    )
