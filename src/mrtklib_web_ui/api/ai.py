"""AI configuration and generation API."""

import os
import re
import tomllib
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

AI_SETTINGS_PATH = Path("/workspace/.ai_settings.toml")
DOCS_URL = "https://h-shiono.github.io/MRTKLIB/reference/config-options/"
REF_CACHE_PATH = Path("/tmp/mrtklib_ref_cache.txt")

SYSTEM_PROMPT = """
You are a GNSS configuration expert for MRTKLIB.
Generate a valid MRTKLIB TOML configuration based on the
user's description.

## Rules
- Output ONLY valid TOML. No explanation, no markdown fences.
- Use only keys documented in the reference below.
- Do NOT include a [streams] section. Stream configuration
  (NTRIP, serial, TCP) is environment-specific and must be
  configured manually by the user.
- When in doubt about a value, use the typical/recommended value
  from the reference description.
- Never invent keys that are not in the reference.

## Mode abbreviations
All    = all modes
SPP    = single
DGPS   = dgps
RTK    = kinematic / static / movingbase / fixed
PPP    = ppp-kine / ppp-static / ppp-fixed
PPP-RTK = ppp-rtk (CLAS)
VRS    = vrs-rtk

## Bundled correction files (available at these paths in the container)
CLAS PPP-RTK:
  satellite_atx  = "/opt/mrtklib/corrections/clas/igs14_L5copy.atx"
  receiver_atx   = "/opt/mrtklib/corrections/clas/igs14_L5copy.atx"
  eop            = "/opt/mrtklib/corrections/clas/igu00p01.erp"
  ocean_loading  = "/opt/mrtklib/corrections/clas/clas_grid.blq"
  cssr_grid      = "/opt/mrtklib/corrections/clas/clas_grid.def"
  isb_table      = "/opt/mrtklib/corrections/clas/isb.tbl"
  phase_cycle    = "/opt/mrtklib/corrections/clas/l2csft.tbl"

MADOCA PPP:
  satellite_atx  = "/opt/mrtklib/corrections/madoca/igs20.atx"

Use these paths automatically when the mode requires them.

## Configuration reference
{reference_text}
"""

# Minimal fallback when reference page cannot be fetched
FALLBACK_REFERENCE = """
[processing]
mode = "kinematic" | "static" | "single" | "dgps" | "ppp-kine" | "ppp-static" | "ppp-fixed" | "ppp-rtk" | "movingbase" | "fixed" | "vrs-rtk"
frequency = "l1" | "l1+l2" | "l1+l2+l5" | "l1+l2+l5+l6"
elevation_mask = 15.0  # degrees
snr_mask = 0
dynamics_mode = "off" | "on"

[processing.systems]
gps = true
glonass = true
galileo = true
qzss = true
beidou = true
sbas = false

[solution]
type = "forward" | "backward" | "combined"
output_format = "llh" | "xyz" | "enu" | "nmea" | "baseline"
time_format = "tow" | "hms"
latitude_longitude_format = "deg" | "dms"
field_separator = ""

[ambiguity]
gps = "fix-and-hold" | "continuous" | "instantaneous" | "off"
glonass = "fix-and-hold" | "continuous" | "instantaneous" | "off"
beidou = "fix-and-hold" | "continuous" | "instantaneous" | "off"

[satellite_ephemeris]
type = "brdc" | "precise" | "brdc+sbas" | "brdc+ssrapc" | "brdc+ssrcom"

[ionosphere]
correction = "off" | "brdc" | "sbas" | "dual-freq" | "est-stec" | "ionex-tec" | "est-adapt"

[troposphere]
correction = "off" | "saas" | "sbas" | "est-ztd" | "est-ztdgrad" | "ztd"

[files]
satellite_atx = ""
receiver_atx = ""
"""


def _load_settings() -> dict[str, Any] | None:
    """Load AI settings from TOML file."""
    if not AI_SETTINGS_PATH.exists():
        return None
    try:
        with open(AI_SETTINGS_PATH, "rb") as f:
            data = tomllib.load(f)
        section = data.get("anthropic", {})
        if not section.get("api_key"):
            return None
        return section
    except Exception:
        return None


def _escape_toml_string(value: str) -> str:
    """Escape a value for use inside a TOML double-quoted string."""
    return (
        value
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def _save_settings(api_key: str, model: str) -> None:
    """Save AI settings to TOML file with restricted permissions.

    Uses atomic write (temp + rename) and validates the result
    round-trips through tomllib before committing.
    """
    escaped_key = _escape_toml_string(api_key)
    escaped_model = _escape_toml_string(model)
    content = (
        "[anthropic]\n"
        f'api_key = "{escaped_key}"\n'
        f'model   = "{escaped_model}"\n'
    )
    # Validate round-trip before writing
    tomllib.loads(content)

    # Atomic write: write to temp file then rename
    tmp_path = AI_SETTINGS_PATH.with_suffix(".tmp")
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, content.encode())
    finally:
        os.close(fd)
    os.rename(str(tmp_path), str(AI_SETTINGS_PATH))


# --- Request / Response models ---

class AiSettingsRequest(BaseModel):
    api_key: str
    model: str = "claude-sonnet-4-5"


class AiSettingsResponse(BaseModel):
    configured: bool
    model: str = ""


class AiTestResponse(BaseModel):
    ok: bool
    error: str = ""


class GenerateConfigRequest(BaseModel):
    prompt: str
    mode: str  # "post" | "realtime"


class GenerateConfigResponse(BaseModel):
    toml: str


# --- Endpoints ---

@router.get("/settings", response_model=AiSettingsResponse)
async def get_settings() -> AiSettingsResponse:
    """Get AI settings (never returns API key)."""
    settings = _load_settings()
    if not settings:
        return AiSettingsResponse(configured=False)
    return AiSettingsResponse(
        configured=True,
        model=settings.get("model", "claude-sonnet-4-5"),
    )


@router.post("/settings", response_model=AiSettingsResponse)
async def save_settings(body: AiSettingsRequest) -> AiSettingsResponse:
    """Save AI settings."""
    _save_settings(body.api_key, body.model)
    return AiSettingsResponse(configured=True, model=body.model)


@router.post("/test", response_model=AiTestResponse)
async def test_connection() -> AiTestResponse:
    """Test the configured API key with a minimal API call."""
    settings = _load_settings()
    if not settings:
        return AiTestResponse(ok=False, error="AI not configured")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings["api_key"],
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.get("model", "claude-sonnet-4-5"),
                    "max_tokens": 16,
                    "messages": [{"role": "user", "content": "Hi"}],
                },
                timeout=15,
            )
        if resp.status_code == 200:
            return AiTestResponse(ok=True)
        body = resp.json()
        error_msg = body.get("error", {}).get("message", f"HTTP {resp.status_code}")
        return AiTestResponse(ok=False, error=error_msg)
    except httpx.TimeoutException:
        return AiTestResponse(ok=False, error="Connection timed out")
    except Exception as e:
        return AiTestResponse(ok=False, error=str(e))


async def _get_reference_text() -> str:
    """Fetch and cache the config-options reference page."""
    if REF_CACHE_PATH.exists():
        return REF_CACHE_PATH.read_text()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(DOCS_URL, timeout=10)
            resp.raise_for_status()
        # Strip HTML tags, keep text content
        text = re.sub(r"<[^>]+>", "", resp.text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        REF_CACHE_PATH.write_text(text)
        return text
    except Exception:
        return FALLBACK_REFERENCE


@router.post("/generate-config", response_model=GenerateConfigResponse)
async def generate_config(body: GenerateConfigRequest) -> GenerateConfigResponse:
    """Generate MRTKLIB TOML configuration from natural language."""
    settings = _load_settings()
    if not settings:
        raise HTTPException(400, "AI not configured")

    if body.mode not in ("post", "realtime"):
        raise HTTPException(400, "mode must be 'post' or 'realtime'")

    reference = await _get_reference_text()
    system = SYSTEM_PROMPT.format(reference_text=reference)

    user_message = (
        f"Mode: {'post-processing (mrtk post)' if body.mode == 'post' else 'real-time (mrtk run)'}\n\n"
        f"User description: {body.prompt}\n\n"
        "Generate the TOML configuration."
    )

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings["api_key"],
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.get("model", "claude-sonnet-4-5"),
                    "max_tokens": 4096,
                    "system": system,
                    "messages": [{"role": "user", "content": user_message}],
                },
                timeout=60,
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail = "API call failed"
        try:
            detail = e.response.json().get("error", {}).get("message", detail)
        except Exception:
            pass
        raise HTTPException(502, detail)
    except httpx.TimeoutException:
        raise HTTPException(504, "API call timed out")
    except Exception as e:
        raise HTTPException(502, str(e))

    # Safely extract text content from response
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Invalid JSON response from AI provider")

    content_blocks = data.get("content") if isinstance(data, dict) else None
    if not isinstance(content_blocks, list) or not content_blocks:
        raise HTTPException(502, "AI response missing content blocks")

    text_parts = [
        block["text"]
        for block in content_blocks
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
    ]
    if not text_parts:
        raise HTTPException(502, "AI response contained no text content")

    content = "\n".join(text_parts).strip()

    # Strip markdown fences if model adds them despite instructions
    content = re.sub(r"^```toml\n?", "", content)
    content = re.sub(r"\n?```$", "", content)

    # Validate it's parseable TOML
    try:
        tomllib.loads(content)
    except tomllib.TOMLDecodeError as e:
        raise HTTPException(500, f"Generated invalid TOML: {e}")

    return GenerateConfigResponse(toml=content)
