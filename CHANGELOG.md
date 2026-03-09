# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-03-09

Initial public release.

### Added

#### Post-Processing (rnx2rtkp)
- 7-tabbed configuration UI (Setting 1, Setting 2, Output, Stats, Positions, Files, Misc)
- Conditional enable/disable logic mirroring the Windows RTKLIB GUI
- SNR Mask modal editor (3x9 matrix for L1/L2/L5 frequencies)
- File browser for `/workspace` directory
- Configuration export as `.conf` file
- Time range configuration (start/end time)
- Result viewer with map view, 2D plot, and time-series charts (ENU/XYZ)
- Cursor synchronization across charts
- Result file download
- Real-time progress tracking and log streaming via WebSocket

#### Stream Server (str2str)
- Input/output stream configuration (TCP client/server, UDP, serial, NTRIP, file)
- LED-like status indicators for connection and data traffic
- Real-time console output via WebSocket
- Process start/stop management
- File naming helper with swap interval and timetag options

#### Observation Data Viewer
- RINEX observation file parsing and analysis
- Satellite visibility chart with time-series visualization
- Signal strength (SNR) color-coded display
- Multi-signal selection and comparison

#### Infrastructure
- Single-container Docker deployment
- Multi-stage Dockerfile (RTKLIB 2.4.3 b34 compiled from source)
- Host workspace bind-mount (`/workspace`)
- FastAPI backend with WebSocket support
- React + TypeScript + Mantine v7 frontend
- Auto-save configuration to browser localStorage with versioned keys
