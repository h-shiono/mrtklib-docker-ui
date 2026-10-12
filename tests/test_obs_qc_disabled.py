"""QC Preview is disabled until it moves to MRTKLIB QC."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mrtklib_web_ui.api import obs_qc


def test_analyze_returns_503():
    app = FastAPI()
    app.include_router(obs_qc.router, prefix="/api/obs-qc")
    r = TestClient(app).post("/api/obs-qc/analyze", json={"obs_file": "/workspace/x.obs"})
    assert r.status_code == 503
    assert "temporarily disabled" in r.json()["detail"]
