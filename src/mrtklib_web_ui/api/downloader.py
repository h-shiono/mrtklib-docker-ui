"""Data downloader API for GNSS data files."""

import asyncio
import ftplib
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


def _part_path(dest: Path) -> Path:
    """Temp name a download is written to, renamed to dest on success."""
    return dest.with_name(dest.name + ".part")


def _looks_like_html(head: bytes, content_type: str) -> bool:
    """True for an HTML page (e.g. an Earthdata login page) instead of data."""
    if "text/html" in content_type.lower():
        return True
    start = head.lstrip()[:15].lower()
    return start.startswith((b"<!doctype html", b"<html"))


# NASA Earthdata Login. CDDIS redirects there to authenticate; httpx drops
# credentials on a cross-origin redirect, so they are re-attached for this
# host only (over https), never for any other redirect target.
EARTHDATA_LOGIN_HOST = "urs.earthdata.nasa.gov"


def _earthdata_auth_hook(auth: tuple[str, str]) -> Any:
    header = httpx.BasicAuth(*auth)

    async def hook(request: httpx.Request) -> None:
        if request.url.scheme == "https" and request.url.host == EARTHDATA_LOGIN_HOST:
            request.headers["Authorization"] = next(header.auth_flow(request)).headers["Authorization"]

    return hook


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
    # Stream to a .part file and rename on success, so a failed or partial
    # transfer never leaves a file that the "already exists" check would skip.
    part = _part_path(dest)
    try:
        hooks = {"request": [_earthdata_auth_hook(auth)]} if auth else {}
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, event_hooks=hooks) as client:
            kwargs: dict[str, Any] = {}
            if auth:
                kwargs["auth"] = auth
            async with client.stream("GET", url, **kwargs) as resp:
                resp.raise_for_status()
                size = 0
                with part.open("wb") as f:
                    async for chunk in resp.aiter_bytes():
                        if size == 0 and _looks_like_html(chunk, resp.headers.get("content-type", "")):
                            raise ValueError(
                                "Server returned an HTML page instead of the file "
                                "(login page or error page; check credentials)"
                            )
                        f.write(chunk)
                        size += len(chunk)
            part.replace(dest)
            entry["status"] = "completed"
            entry["size_bytes"] = size
    except Exception as e:
        part.unlink(missing_ok=True)
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
        # ftplib blocks: run it in a worker thread so the event loop (RT and
        # relay WebSockets included) keeps going during the transfer.
        entry["size_bytes"] = await asyncio.to_thread(
            _gsi_fetch_station_day, cred, body.year, body.doy, body.station, dest
        )
        entry["status"] = "completed"
    except Exception as e:
        entry["status"] = "failed"
        entry["error"] = str(e)
        logger.warning(f"GSI CORS download failed: {e}")

    return entry


GSI_FTP_HOST = "terras.gsi.go.jp"
GSI_FTP_TIMEOUT = 60.0  # seconds per blocking socket operation


def _gsi_fetch_station_day(cred: tuple[str, str], year: int, doy: int, station: str, dest: Path) -> int:
    """Fetch one station-day directory from GSI FTP into dest (blocking).

    Returns the total size of this station-day's files in dest (fetched now
    or already present), not of everything else in the directory.
    """
    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    with ftplib.FTP(GSI_FTP_HOST, timeout=GSI_FTP_TIMEOUT) as ftp:
        ftp.login(cred[0], cred[1])
        ftp.cwd(f"/data/GPS_1sec/{year}/{doy:03d}/{station}")
        for fname in ftp.nlst():
            # Names come from the remote server; never let them leave dest
            if "/" in fname or "\\" in fname or fname.startswith("."):
                continue
            local_path = dest / fname
            if not (local_path.exists() and local_path.stat().st_size > 0):
                part = _part_path(local_path)
                try:
                    with part.open("wb") as f:
                        ftp.retrbinary(f"RETR {fname}", f.write)
                    part.replace(local_path)
                except BaseException:
                    part.unlink(missing_ok=True)
                    raise
            total += local_path.stat().st_size
    return total


def _doy_to_gps_week(year: int, doy: int) -> int:
    """Convert year/doy to GPS week number."""
    from datetime import date
    d = date(year, 1, 1) + __import__('datetime').timedelta(days=doy - 1)
    gps_epoch = date(1980, 1, 6)
    return (d - gps_epoch).days // 7
