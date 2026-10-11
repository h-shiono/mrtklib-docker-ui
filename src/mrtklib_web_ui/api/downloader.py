"""Data downloader API for GNSS data files."""

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mrtklib_web_ui.paths import WORKSPACE_ROOT, has_hidden_component, is_within, resolve_path
from mrtklib_web_ui.services.credentials import (
    get_credential,
    get_credential_source,
    save_credential,
    delete_credential,
)

logger = logging.getLogger(__name__)
router = APIRouter()

DOWNLOADS_DIR = WORKSPACE_ROOT / "downloads"

# In-memory download history (last 50)
_download_history: list[dict[str, Any]] = []
MAX_HISTORY = 50


# Request fields that end up in file names or remote paths
Year = Annotated[int, Field(ge=1980, le=2100)]
Doy = Annotated[int, Field(ge=1, le=366)]
Session = Annotated[str, Field(pattern=r"^([a-x]|\*)$")]


def _dest_dir(value: str) -> Path:
    """Resolve a download directory; it must be inside /workspace."""
    path = resolve_path(value)
    inside = path == WORKSPACE_ROOT.resolve() or is_within(path, WORKSPACE_ROOT)
    if not inside or has_hidden_component(path):
        raise HTTPException(403, f"Destination must be within /workspace: {value}")
    return path


def _add_history(entry: dict[str, Any]) -> None:
    _download_history.insert(0, entry)
    while len(_download_history) > MAX_HISTORY:
        _download_history.pop()


async def _download_file(url: str, dest: Path, auth: tuple[str, str] | None = None) -> dict[str, Any]:
    """Download a single file. Returns history entry."""
    entry = {
        "id": str(uuid.uuid4()),
        "filename": dest.name,
        "url": url,
        "dest": str(dest),
        "status": "downloading",
        "size_bytes": 0,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "error": None,
    }
    _add_history(entry)

    # Skip if already exists
    if dest.exists() and dest.stat().st_size > 0:
        entry["status"] = "skipped"
        entry["size_bytes"] = dest.stat().st_size
        return entry

    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            kwargs: dict[str, Any] = {}
            if auth:
                kwargs["auth"] = auth
            resp = await client.get(url, **kwargs)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            entry["status"] = "completed"
            entry["size_bytes"] = len(resp.content)
    except Exception as e:
        entry["status"] = "failed"
        entry["error"] = str(e)
        logger.warning(f"Download failed {url}: {e}")

    return entry


# ── Credential endpoints ──────────────────────────────────────────────────

@router.get("/credentials")
async def get_credentials() -> dict[str, dict[str, Any]]:
    """Get credential status for all services (never returns passwords)."""
    services = ["earthdata", "gsi"]
    result = {}
    for svc in services:
        source = get_credential_source(svc)
        result[svc] = {
            "configured": source is not None,
            "source": source,
        }
    return result


class CredentialSaveRequest(BaseModel):
    username: str
    password: str


@router.post("/credentials/{service}")
async def save_cred(service: str, body: CredentialSaveRequest) -> dict[str, bool]:
    """Save credentials for a service."""
    if service not in ("earthdata", "gsi"):
        raise HTTPException(400, "Unknown service")
    save_credential(service, body.username, body.password)
    return {"ok": True}


@router.delete("/credentials/{service}")
async def delete_cred(service: str) -> dict[str, str]:
    """Delete stored credentials for a service."""
    delete_credential(service)
    return {"status": "deleted"}


# ── Download status ─────────────────────────────────────────────────────

@router.get("/status")
async def download_status() -> list[dict[str, Any]]:
    """Get recent download history."""
    return _download_history


# ── QZSS downloads ──────────────────────────────────────────────────────

class QzssClasRequest(BaseModel):
    year: Year
    doy: Doy
    session: Session = "a"
    dest_dir: str = "/workspace/downloads/clas"


@router.post("/qzss/clas")
async def download_qzss_clas(body: QzssClasRequest) -> list[dict[str, Any]]:
    """Download QZSS CLAS L6 files."""
    dest_dir = _dest_dir(body.dest_dir)
    sessions = list("abcdefghijklmnopqrstuvwx") if body.session == "*" else [body.session]
    results = []
    for ses in sessions:
        filename = f"{body.year:04d}{body.doy:03d}{ses}.l6"
        url = f"https://sys.qzss.go.jp/archives/l6/{body.year:04d}/{filename}"
        dest = dest_dir / filename
        result = await _download_file(url, dest)
        results.append(result)
    return results


class QzssMadocaRequest(BaseModel):
    year: Year
    doy: Doy
    session: Session = "a"
    prn: str = Field(default="Q01", pattern=r"^(Q0[1-7]|all)$")
    dest_dir: str = "/workspace/downloads/madoca"


@router.post("/qzss/madoca")
async def download_qzss_madoca(body: QzssMadocaRequest) -> list[dict[str, Any]]:
    """Download QZSS MADOCA L6 files."""
    dest_dir = _dest_dir(body.dest_dir)
    sessions = list("abcdefghijklmnopqrstuvwx") if body.session == "*" else [body.session]
    prns = [f"Q{i:02d}" for i in range(1, 8)] if body.prn == "all" else [body.prn]
    results = []
    for ses in sessions:
        for prn in prns:
            filename = f"{body.year:04d}{body.doy:03d}{ses}.{prn}.l6"
            url = f"https://l6msg.go.gnss.go.jp/archives/{body.year:04d}/{body.doy:03d}/{filename}"
            dest = dest_dir / filename
            result = await _download_file(url, dest)
            results.append(result)
    return results


# ── IGS downloads ───────────────────────────────────────────────────────

@router.post("/igs/atx")
async def download_igs_atx() -> dict[str, Any]:
    """Download latest igs20.atx file."""
    url = "https://files.igs.org/pub/station/general/igs20.atx"
    dest = DOWNLOADS_DIR / "atx" / "igs20.atx"
    return await _download_file(url, dest)


class IgsProductRequest(BaseModel):
    year: Year
    doy: Doy
    product_type: str = "brdc"
    analysis_center: str = Field(default="IGS", pattern=r"^[A-Za-z0-9]{3}$")
    dest_dir: str = "/workspace/downloads/igs"


@router.post("/igs/products")
async def download_igs_products(body: IgsProductRequest) -> dict[str, Any]:
    """Download IGS products (requires NASA Earthdata credentials)."""
    dest_dir = _dest_dir(body.dest_dir)
    cred = get_credential("earthdata")
    if not cred:
        raise HTTPException(401, "NASA Earthdata credentials required")

    # Build URL based on product type
    gps_week = _doy_to_gps_week(body.year, body.doy)
    base_url = "https://cddis.nasa.gov/archive/gnss/products"

    if body.product_type == "brdc":
        filename = f"BRDC00IGS_R_{body.year:04d}{body.doy:03d}0000_01D_MN.rnx.gz"
        url = f"{base_url}/{gps_week}/{filename}"
    elif body.product_type == "sp3":
        ac = body.analysis_center.upper()[:3]
        filename = f"{ac}0OPSFIN_{body.year:04d}{body.doy:03d}0000_01D_15M_ORB.SP3.gz"
        url = f"{base_url}/{gps_week}/{filename}"
    elif body.product_type == "clk":
        ac = body.analysis_center.upper()[:3]
        filename = f"{ac}0OPSFIN_{body.year:04d}{body.doy:03d}0000_01D_30S_CLK.CLK.gz"
        url = f"{base_url}/{gps_week}/{filename}"
    elif body.product_type == "erp":
        filename = f"igs{body.year % 100:02d}P{gps_week}.erp.Z"
        url = f"{base_url}/{gps_week}/{filename}"
    else:
        raise HTTPException(400, f"Unknown product type: {body.product_type}")

    dest = dest_dir / filename
    return await _download_file(url, dest, auth=cred)


# ── GSI CORS ────────────────────────────────────────────────────────────

class GsiCorsRequest(BaseModel):
    station: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    year: Year
    doy: Doy
    dest_dir: str = "/workspace/downloads/gsi"


@router.post("/gsi/cors")
async def download_gsi_cors(body: GsiCorsRequest) -> dict[str, Any]:
    """Download GSI CORS data (requires GSI credentials)."""
    dest = _dest_dir(body.dest_dir)
    cred = get_credential("gsi")
    if not cred:
        raise HTTPException(401, "GSI FTP credentials required")

    entry = {
        "id": str(uuid.uuid4()),
        "filename": f"{body.station}_{body.year:04d}{body.doy:03d}.obs",
        "url": f"ftp://terras.gsi.go.jp/data/GPS_1sec/{body.year}/{body.doy:03d}/{body.station}/",
        "dest": str(dest / f"{body.station}_{body.year:04d}{body.doy:03d}.obs"),
        "status": "downloading",
        "size_bytes": 0,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "error": None,
    }
    _add_history(entry)

    try:
        import ftplib
        dest.mkdir(parents=True, exist_ok=True)

        ftp = ftplib.FTP("terras.gsi.go.jp")
        ftp.login(cred[0], cred[1])
        ftp.cwd(f"/data/GPS_1sec/{body.year}/{body.doy:03d}/{body.station}")

        files = ftp.nlst()
        downloaded = 0
        for fname in files:
            # Names come from the remote server; never let them leave dest
            if "/" in fname or "\\" in fname or fname.startswith("."):
                continue
            local_path = dest / fname
            if local_path.exists() and local_path.stat().st_size > 0:
                continue
            with open(local_path, "wb") as f:
                ftp.retrbinary(f"RETR {fname}", f.write)
            downloaded += 1

        ftp.quit()
        entry["status"] = "completed"
        entry["size_bytes"] = sum(
            f.stat().st_size for f in dest.iterdir() if f.is_file()
        )
    except Exception as e:
        entry["status"] = "failed"
        entry["error"] = str(e)
        logger.warning(f"GSI CORS download failed: {e}")

    return entry


def _doy_to_gps_week(year: int, doy: int) -> int:
    """Convert year/doy to GPS week number."""
    from datetime import date
    d = date(year, 1, 1) + __import__('datetime').timedelta(days=doy - 1)
    gps_epoch = date(1980, 1, 6)
    return (d - gps_epoch).days // 7
