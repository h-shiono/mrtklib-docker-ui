"""Events emitted by the stream decoders.

The JSON shapes follow the frontend types so the Stream Monitor can feed the
existing views without a second adapter later (#96):

- `Epoch.to_json()` matches `PosEpoch` (viewer/types.ts): `Q`, `height`
  (ellipsoidal), `ns`, plus `time` / `time_sys`. Fields a format does not
  carry are `None`, never a made-up 0.
- `SatState.to_json()` matches `Satellite` (SkySnrPanel.tsx): RINEX-style
  `prn` (G01, R01, E01, C01, J01, S20, I01) and the system names of
  `mrtk_run_service._SAT_SYSTEM_MAP`.

Times are never shifted between time systems (no leap seconds applied):
NMEA and UBX NAV-PVT are UTC, SBF is GPST, RTKLIB solution text says which
in its header. `time` carries that system's clock with a `Z` suffix, as
`posParser.ts` does for .pos files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

# RINEX system letter → system name (same names as mrtk_run_service).
SYSTEM_NAMES = {
    "G": "GPS", "R": "GLONASS", "E": "Galileo",
    "J": "QZSS", "C": "BeiDou", "S": "SBAS", "I": "NavIC",
}

# Band whose SNR is shown as the satellite's `snr` (the L1-ish signal the
# RT view shows), in order of preference. Other bands stay in `snr_by_band`.
PRIMARY_BANDS = {
    "G": ("L1",), "R": ("G1",), "E": ("E1",), "C": ("B1I", "B1C"),
    "J": ("L1",), "S": ("L1",), "I": ("L5",),
}


def format_time(t: datetime) -> str:
    """ISO 8601 with millisecond precision and a `Z` suffix."""
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def prn_id(system: str, number: int) -> str:
    """RINEX satellite id, e.g. ('G', 5) → 'G05'."""
    return f"{system}{number:02d}"


@dataclass
class Epoch:
    """One position solution."""

    time: datetime
    time_sys: str  # "GPST" | "UTC" | "JST"
    lat: float  # deg
    lon: float  # deg
    height: float | None  # m, ellipsoidal; None when the format leaves it unknown
    q: int  # 1=Fix 2=Float 3=SBAS 4=DGPS 5=Single 6=PPP 7=DR (CLAUDE.md)
    ns: int | None
    source: str  # e.g. "nmea:gga", "sbf:pvtgeodetic", "ubx:nav-pvt", "pos:llh"
    sdn: float | None = None
    sde: float | None = None
    sdu: float | None = None
    age: float | None = None
    ratio: float | None = None

    def to_json(self) -> dict:
        return {
            "time": format_time(self.time),
            "time_sys": self.time_sys,
            "lat": self.lat,
            "lon": self.lon,
            "height": self.height,
            "Q": self.q,
            "ns": self.ns,
            "sdn": self.sdn,
            "sde": self.sde,
            "sdu": self.sdu,
            "age": self.age,
            "ratio": self.ratio,
        }


@dataclass
class SatState:
    """One satellite in a snapshot. `None` = the format did not say."""

    prn: str
    azimuth: float | None = None  # deg
    elevation: float | None = None  # deg
    used: bool | None = None
    snr_by_band: dict[str, float] = field(default_factory=dict)  # dB-Hz

    @property
    def system(self) -> str:
        return SYSTEM_NAMES.get(self.prn[:1], "Unknown")

    def set_snr(self, band: str, snr: float) -> None:
        """Keep the strongest signal per band (L1 C/A vs L1C, L2C vs L2P)."""
        if snr > self.snr_by_band.get(band, -1.0):
            self.snr_by_band[band] = snr

    @property
    def snr(self) -> float | None:
        for band in PRIMARY_BANDS.get(self.prn[:1], ()):
            if band in self.snr_by_band:
                return self.snr_by_band[band]
        return max(self.snr_by_band.values()) if self.snr_by_band else None

    def to_json(self) -> dict:
        return {
            "prn": self.prn,
            "system": self.system,
            "azimuth": self.azimuth,
            "elevation": self.elevation,
            "used": self.used,
            "snr": self.snr,
            "snr_by_band": dict(self.snr_by_band),
        }


@dataclass
class Satellites:
    """Satellite snapshot for one epoch."""

    time: datetime | None
    time_sys: str
    source: str  # e.g. "nmea:gsv", "sbf:measepoch", "ubx:nav-sat"
    sats: list[SatState]

    def to_json(self) -> dict:
        return {
            "time": format_time(self.time) if self.time else None,
            "time_sys": self.time_sys,
            "satellites": [s.to_json() for s in sorted(self.sats, key=lambda s: s.prn)],
        }


Event = Epoch | Satellites
