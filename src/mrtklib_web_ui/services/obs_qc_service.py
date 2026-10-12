"""Observation data QC — response models only.

The cssrlib-based analysis was removed (too slow on real files, and it made
cssrlib/numba/numpy runtime dependencies). QC Preview will return on top of
MRTKLIB's own QC; these models are the contract the frontend Obs viewer
(components/obsViewer) already renders, kept for that integration.
"""

from pydantic import BaseModel


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
