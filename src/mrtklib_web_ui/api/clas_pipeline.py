"""API endpoints for the CLAS pipeline (mrtk relay + mrtk cssr2rtcm3)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mrtklib_web_ui.api.mrtk_relay import (
    _number_file_outputs,
    _running_relay_files,
    _validate_relay_args,
)
from mrtklib_web_ui.services.mrtk_run_service import gpst_now
from mrtklib_web_ui.services import (
    PipelineConfig,
    PipelineState,
    clas_pipeline_service,
)
from mrtklib_web_ui.services.clas_pipeline_service import (
    DEFAULT_BRIDGE_PORT,
    list_serial_ports,
)
from mrtklib_web_ui.services.receiver_presets import list_presets

router = APIRouter()


class PipelineStartRequest(BaseModel):
    receiver_id: str = Field(examples=["septentrio-mosaic-g5"])
    input_device: str = Field(examples=["/dev/ttyUSB0"])
    input_baud: int = Field(default=115200, gt=0)
    bridge_port: int = Field(default=DEFAULT_BRIDGE_PORT, gt=1024, lt=65536)
    outputs: list[str] = Field(
        default_factory=list,
        max_length=4,
        description=(
            "Further relay outputs after the bridge, as mrtk relay stream "
            "arguments: a file under /workspace records the raw SBF (time "
            "keywords and ::T / ::S= allowed; an existing file gets _2, _3, ...), "
            "a TCP server hands it to other apps. No relay-back on these."
        ),
        examples=[["file:///workspace/clas/sbf_%Y%m%d_%h%M%S.sbf", "tcpsvr://:9871"]],
    )


class PipelineStatusResponse(BaseModel):
    state: str
    relay_state: str
    cssr_state: str
    started_at: str | None = None
    error_message: str | None = None
    bridge_port: int | None = None
    outputs: list[str] = Field(default_factory=list, description="Further outputs, as written")


def _to_status_response(status) -> PipelineStatusResponse:
    return PipelineStatusResponse(
        state=status.state.value,
        relay_state=status.relay_state,
        cssr_state=status.cssr_state,
        started_at=status.started_at.isoformat() if status.started_at else None,
        error_message=status.error_message,
        bridge_port=status.bridge_port,
        outputs=status.outputs,
    )


def _check_outputs(req: PipelineStartRequest) -> list[str]:
    """Validate the further outputs as Stream Relay does, and number file outputs."""
    args = [a for out in req.outputs for a in ("-out", out)]
    if err := _validate_relay_args(args):
        raise HTTPException(status_code=403, detail=err)
    for out in req.outputs:
        if out.startswith("tcpsvr://") and out.split("#")[0].rsplit(":", 1)[-1] == str(req.bridge_port):
            raise HTTPException(
                status_code=400,
                detail=f"Output {out} uses the bridge port {req.bridge_port}",
            )
    now = gpst_now()
    try:
        return _number_file_outputs(args, _running_relay_files(now), now)[1::2]
    except (RuntimeError, OSError) as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/receivers")
async def get_receivers() -> list[dict]:
    """List supported receiver presets."""
    return list_presets()


@router.get("/serial-ports")
async def get_serial_ports() -> list[dict]:
    """Enumerate serial devices visible to the container."""
    return [{"path": p.path, "label": p.label} for p in list_serial_ports()]


@router.post("/start", response_model=PipelineStatusResponse)
async def start_pipeline(req: PipelineStartRequest) -> PipelineStatusResponse:
    """Start CLAS to RTCM3 (relay + cssr2rtcm3 + SBF sniffer)."""
    config = PipelineConfig(
        receiver_id=req.receiver_id,
        input_device=req.input_device,
        input_baud=req.input_baud,
        bridge_port=req.bridge_port,
        outputs=_check_outputs(req),
    )
    try:
        status = await clas_pipeline_service.start(config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if status.state == PipelineState.ERROR:
        # Surface device-not-found / device-busy errors with 422 so the UI
        # can show them without treating them as a server bug.
        raise HTTPException(status_code=422, detail=status.error_message or "Failed to start pipeline")
    return _to_status_response(status)


@router.post("/stop", response_model=PipelineStatusResponse)
async def stop_pipeline() -> PipelineStatusResponse:
    """Stop the CLAS pipeline."""
    status = await clas_pipeline_service.stop()
    return _to_status_response(status)


@router.get("/status", response_model=PipelineStatusResponse)
async def get_pipeline_status() -> PipelineStatusResponse:
    """Get current pipeline status."""
    return _to_status_response(clas_pipeline_service.status)
