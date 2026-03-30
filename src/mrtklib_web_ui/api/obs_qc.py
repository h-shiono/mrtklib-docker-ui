"""API endpoints for observation data QC analysis."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mrtklib_web_ui.paths import resolve_path, is_allowed_path
from mrtklib_web_ui.services.obs_qc_service import ObsQcResponse, analyze_obs

router = APIRouter()


class ObsQcRequest(BaseModel):
    """Request to analyze a RINEX observation file."""

    obs_file: str
    nav_file: str | None = None
    signal: str | None = None
    decimation: int = 0


@router.post("/analyze", response_model=ObsQcResponse)
async def analyze_observation(request: ObsQcRequest) -> ObsQcResponse:
    """Analyze a RINEX observation file for QC.

    Parses the OBS file to extract satellite visibility segments and SNR data.
    Optionally computes azimuth/elevation if a NAV file is provided.
    """
    obs_resolved = resolve_path(request.obs_file)
    if not is_allowed_path(obs_resolved):
        raise HTTPException(status_code=403, detail=f"Access denied: {request.obs_file}")
    if not obs_resolved.exists():
        raise HTTPException(
            status_code=400,
            detail=f"OBS file not found: {request.obs_file}",
        )

    nav_resolved = None
    if request.nav_file:
        nav_path = resolve_path(request.nav_file)
        if not is_allowed_path(nav_path):
            raise HTTPException(status_code=403, detail=f"Access denied: {request.nav_file}")
        nav_resolved = str(nav_path)

    try:
        result = analyze_obs(
            obs_file=str(obs_resolved),
            nav_file=nav_resolved,
            signal=request.signal,
            decimation=request.decimation,
        )
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {e}",
        )
