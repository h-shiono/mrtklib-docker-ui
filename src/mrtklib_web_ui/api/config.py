"""Configuration file management API."""

import tomllib
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from mrtklib_web_ui.services import conf2toml
from mrtklib_web_ui.services.config_parser import ConfigParser

router = APIRouter()
config_parser = ConfigParser()


class ImportRequest(BaseModel):
    """Request to import a TOML configuration."""

    toml_content: str


@router.post("/import")
async def import_config(body: ImportRequest) -> dict[str, Any]:
    """Parse TOML configuration and return as JSON.

    Returns every key. The frontend keeps those no form field reads in
    ``extra_toml``, which ``generate_conf_file`` writes back (#230).
    """
    try:
        parsed = tomllib.loads(body.toml_content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid TOML: {e}")
    return {"config": parsed}


class ConfToTomlRequest(BaseModel):
    """Request to convert a legacy RTKLIB/MRTKLIB .conf into v0.7.6 TOML."""

    conf_content: str
    source_name: str = ""


@router.post("/conf2toml")
async def conf_to_toml(body: ConfToTomlRequest) -> dict[str, str]:
    """Convert a legacy .conf file to v0.7.6 TOML text.

    Mirrors MRTKLIB's `scripts/tools/conf2toml.py`. The returned `toml`
    can be fed straight back through `/import` for a lossless round-trip.
    """
    try:
        toml_text = conf2toml.convert_text(body.conf_content, source_name=body.source_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Conversion failed: {e}")
    return {"toml": toml_text}


class ConfigData(BaseModel):
    """Configuration data."""

    settings: dict[str, str | int | float | bool]


@router.post("/parse", response_model=ConfigData)
async def parse_config(file: UploadFile) -> ConfigData:
    """Parse an uploaded RTKLIB configuration file."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    content = await file.read()
    try:
        settings = config_parser.parse(content.decode("utf-8"))
        return ConfigData(settings=settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/export")
async def export_config(config: ConfigData) -> Response:
    """Export configuration to RTKLIB format."""
    content = config_parser.export(config.settings)
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=rtklib.conf"},
    )
