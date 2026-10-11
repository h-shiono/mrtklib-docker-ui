# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.1-alpha] - 2026-10-11

### Added
- Real-Time: per-input "Save Raw" switch (Rover / Base / Correction)
  that records each input stream's raw bytes before decoding
  (`streams.log.stream1/2/3`). Hourly files, default
  `/workspace/rtlog/%Y/%n/{rovr|base|corr}_%n%H.<ext>` (GPST),
  optional time tag (`::T`) for real-time replay.
- Tests for file-stream numbering and write-path validation (`tests/`).

### Changed
- MRTKLIB pinned to v0.7.11 (no TOML schema changes since v0.7.6).
- Real-Time: the generic Log 1–3 slots are replaced by the per-input
  switches; the output list now holds Output 1/2 only.
- Real-Time: file outputs and raw logs never overwrite an existing
  file. If the target (or its `.tag`) exists, or another stream of the
  same run uses it, the run writes to `_2`, `_3`, … instead. Start is
  refused if `_2`–`_999` are all taken.

### Fixed
- Real-Time: a configured Output 2 no longer stays active but hidden
  after a page reload.
- Real-Time: raw logs saved by the old Log 1–3 editor with a non-file
  transport are sent as file logs, matching what the Save Raw switch
  shows.

### Security
- Real-Time: file-type outputs and raw logs must be absolute paths
  inside `/workspace`, checked both as written and with time keywords
  expanded (a keyword directory symlinked out of `/workspace` is
  rejected); an empty raw-log path is rejected. An empty output path
  still writes solutions to stdout (console).

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
