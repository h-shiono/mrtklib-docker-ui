# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.2-alpha] - 2026-10-11

### Upgrade notes
- The container no longer runs as root. It runs as `PUID:PGID`
  (default `1000:1000`); set both to your host IDs (`id -u` / `id -g`)
  in `.env` or with `docker run -e`. On start, files under
  `/workspace` owned by another user (e.g. root, from earlier
  versions) are chowned to `PUID:PGID`. `PUID=0` restores the old
  run-as-root behaviour.
- Mount `~/.netrc` at `/home/mrtk/.netrc`. An existing
  `/root/.netrc` mount still works: it is copied there on start.
- Real-Time: rtkrcv's relative output files (trace, solution status,
  `rtkrcv.nav`) move to `/workspace/rtlog/rtkrcv/`, and relative paths
  in a Real-Time config resolve against that directory (see Changed).

### Added
- Real-Time: the Trace sub-tab follows the rtkrcv debug trace live
  when Debug Trace is set (last 1000 lines, replayed after a page
  reload), shows the trace file path and offers a download (#53).
  At high trace levels the view streams at most 64 KB/s and marks
  skipped output; the file itself is complete.
- Real-Time: a "Streaming status" footer shows the live state of the
  Rover / Base / Correction inputs (RECEIVING, CONNECTING, STALLED,
  NO DECODE, ERROR, OFF) with bps and a readable cause such as
  "mountpoint not found" or "authentication failed". State changes
  are logged to the Console.
- Real-Time: the UI reattaches to a run that outlived the browser
  session (reload, closed tab, dropped tunnel): position, satellites,
  the last 500 log lines and 600 positions come back, and Stop works.
  A second open tab follows Start/Stop too.
- Stream Server: running relays survive a page reload or reconnect.
  They come back with their name, streams and recent log, and can be
  stopped (#52). NTRIP passwords are never sent back to the browser;
  restarting an adopted relay asks for the password again.
- CI on pull requests: backend tests, frontend build, lint of changed
  files, and an amd64 Docker build.

### Changed
- Real-Time: `mrtk run` now runs in `/workspace/rtlog/rtkrcv/`. The
  files rtkrcv writes relative to its working directory — the debug
  trace (`rtkrcv_<GPST yyyymmddhhmm>.trace`), the solution status file
  and the navigation cache `rtkrcv.nav` — now land there instead of
  the container's `/app`, so they persist and show in the file browser.
  Relative paths in a Real-Time config are resolved against this
  directory.
- Docker: the app runs as `PUID:PGID` via `gosu` (see Upgrade notes).
  The user joins `dialout` and the group of each mapped serial device
  (`ttyUSB*`, `ttyACM*`, `ttyS*`, `serial/by-id/*`); a device owned by
  group root is skipped with a warning.
- Docker: a local `docker compose build` uses the MRTKLIB version
  pinned in `.mrtklib-version` unless `MRTKLIB_BRANCH` is set (it
  used to build `main`).
- The status bar shows the MRTKLIB version reported by
  `mrtk --version` (it showed "0.0.0").
- `data/` and `tmp/` are excluded from the Docker build context.

### Removed
- The legacy `/api/process` router.

### Fixed
- Post Processing: "Rover observation file not found" for wildcard
  inputs that exist. Compressed wildcard inputs on `/data` are staged
  file by file, rover and base get separate staging directories, and
  wildcards follow `mrtk`: `*` only, file name only, case-insensitive.
  Unsupported patterns get a clear error.
- Console output from `cssr2rtcm3` and other tools no longer stalls on
  `\r`-only progress lines (#32). Lines over 64 KiB no longer stop the
  log reader (and with it the process). Processes that exit on their
  own are recorded and released, which also makes the CLAS Pipeline
  watchdog notice a dead child process.
- Real-Time: the Console and Solution panels stay scrolled to the
  latest output, also after switching tabs; scrolling up pauses
  following until you scroll back down.
- Real-Time: a mountpoint whose name contains an error word (e.g.
  `ERROR_TEST`) is no longer flagged as a stream error.
- Conversion: the command preview shows `-tr` / `-tt` and the real
  station flag `-c` (it showed `-sta`).
- WebSocket: no zombie reconnect after a panel unmounts, and no page
  re-render per log message.

### Security
- The file API (`read` / `download` / `write` / `browse`) and the
  RINEX preview refuse dotfiles, also through symlinks, so stored
  credentials cannot be read over HTTP.
- The SPA fallback route serves only files inside the static
  directory (a percent-encoded `..` could read any file).
- Conversion: input must be in `/workspace` or `/data`, outputs inside
  `/workspace`; the station ID is limited to `[A-Za-z0-9_-]`.
- Data Downloader: the destination must be inside `/workspace`;
  station, session, PRN, analysis center, year and DOY are validated.
- Stream Server: file paths in `mrtk relay` arguments must be absolute,
  with reads inside an allowed root and writes inside `/workspace`.
- Stored credentials are escaped as TOML strings and written
  atomically with mode 0600.

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
