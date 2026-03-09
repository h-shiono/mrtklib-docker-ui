"""Configuration file management API."""

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from rtklib_web_ui.services.config_parser import ConfigParser

router = APIRouter()
config_parser = ConfigParser()


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
