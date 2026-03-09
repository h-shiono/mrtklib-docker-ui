# Release Note - v0.1.0

**Release Date:** 2026-03-09

## Overview

RTKLIB Docker UI v0.1.0 is the initial public release. This project provides a modern web-based user interface for RTKLIB command-line tools, running entirely in a Docker container. No compilation or platform-specific setup is required — just `docker compose up` and access the UI from your browser.

## Highlights

### Post-Processing (rnx2rtkp)

- Full 7-tabbed configuration UI covering all rnx2rtkp parameters
  - Setting 1 / Setting 2 / Output / Stats / Positions / Files / Misc
- Intelligent conditional logic that mirrors the Windows RTKLIB GUI behavior (fields auto-enable/disable based on positioning mode and output format)
- SNR Mask editor (3x9 matrix for L1/L2/L5)
- Configuration export as `.conf` file compatible with RTKLIB
- File browser for `/workspace` directory
- Result viewer with map, 2D plot, and time-series charts (ENU/XYZ)
- Real-time progress tracking via WebSocket

### Stream Server (str2str)

- Input/output stream configuration (TCP, UDP, serial, NTRIP, file)
- LED-like status indicators for connection and data traffic
- Real-time console output streaming via WebSocket
- Process start/stop/monitor

### Observation Data Viewer

- RINEX observation file analysis
- Satellite visibility chart with signal strength (SNR) visualization
- Multi-signal selection and comparison

### Docker

- Single-container deployment with pre-compiled RTKLIB 2.4.3 b34
- Multi-stage Docker build (RTKLIB build -> frontend build -> backend build -> slim runtime)
- Host workspace bind-mounted to `/workspace` for data access
- Works on Linux and macOS without any build tools on the host

## Known Limitations

- Configuration import (`.conf` file loading into UI) is not yet implemented
- Plot tools are basic; enhanced plotting is planned for a future release
- RINEX converter (rtkconv) UI is not yet available (planned for v0.1.1)

## System Requirements

- Docker and Docker Compose
- A modern web browser

## Quick Start

```bash
git clone https://github.com/h-shiono/rtklib-docker-ui.git
cd rtklib-docker-ui
mkdir -p workspace
docker compose up --build
# Open http://localhost:8080
```
