"""API endpoints for observation data QC analysis."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mrtklib_web_ui.services.obs_qc_service import ObsQcResponse

router = APIRouter()

# Temporarily disabled until QC moves to MRTKLIB's own QC tooling. The previous
# cssrlib analysis was too slow for real files and, run on the event loop, froze
# the whole server (RT/relay WebSockets included); it and its dependencies were
# removed. Request/response models stay as the contract for the Obs viewer.
QC_DISABLED_DETAIL = (
    "QC Preview is temporarily disabled until it is integrated with MRTKLIB QC."
)


class ObsQcRequest(BaseModel):
    """Request to analyze a RINEX observation file."""

    obs_file: str
    nav_file: str | None = None
    signal: str | None = None
    decimation: int = 0


@router.post("/analyze", response_model=ObsQcResponse)
async def analyze_observation(request: ObsQcRequest) -> ObsQcResponse:
    """Analyze a RINEX observation file for QC (satellite visibility, SNR, az/el).

    Disabled until QC is rebuilt on MRTKLIB QC; always returns 503.
    """
    raise HTTPException(status_code=503, detail=QC_DISABLED_DETAIL)
