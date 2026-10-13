# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.2-alpha] - 2026-10-13

No action is needed to upgrade from 0.4.1-alpha.

### Added
- Trace search in Real-Time and Post Processing: highlight matches,
  step through every occurrence (Enter / Shift+Enter), and show only
  the matching lines. Search covers the loaded lines (#79).
- Conversion → **Hatanaka (CRX)**: compress RINEX → CRX or decompress
  CRX → RINEX with `rnx2crx` / `crx2rnx`. Options: gzip output, `-s`,
  `-e N`, overwrite. Inputs come from /workspace or /data, outputs go to
  /workspace; `.gz` inputs are decompressed on the fly (#81).
- Real-Time sky plot: hovering a satellite shows PRN, system,
  azimuth / elevation, SNR and whether it is used (#77).

### Changed
- Post Processing ENU charts: panels separated by bands and rules,
  axis lines and labels (E / N / U / ns), time labels on the bottom
  chart only, zoom-aware time ticks (seconds, dates at day changes, laid
  out in UTC), fixed decimals on the value axis, IBM Plex Mono, mean / σ
  of the visible data per panel, and a "Symmetric about 0" option for
  the auto Y range (#78).
- Real-Time sky plot: larger satellite markers and PRN labels; the plot
  grows with the panel (up to 440 px) (#127).

### Fixed
- Real-Time: the satellites counted as "used" (metrics row and sky
  plot) now match the solution's satellite count shown in the chart. It
  is the L1 count while the RTK / PPP filter produced the solution and
  the single-point count otherwise (#120).

## [0.4.1-alpha] - 2026-10-13

No action is needed to upgrade from 0.4.0-alpha.

### Added
- Docker image: `crx2rnx` / `rnx2crx` (RNXCMP 4.2.0, Geospatial
  Information Authority of Japan), so Hatanaka-compressed RINEX inputs
  (`.crx`, `.??d`, `.crx.gz`) work in Post Processing. License and
  citation in README → License (#71).
- `/api/mrtklib/version` lists the `l6extract` subcommand (#75).
- `/api/files/read?from_end=true` returns the last lines of a file (#73).

### Changed
- Correction provider "Galileo HAS (reserved)" is now "Galileo HAS (E6B
  SSR)": MRTKLIB 0.7.11 implements it. Its help text notes that
  igs-rts / gal-has need `satellite_ephemeris = brdc+ssrapc | brdc+ssrcom`
  (#75).
- Data Downloader: default dates are in the past (UTC): today−1 for QZSS
  L6 and GSI CORS, today−14 for IGS products (#74).
- CLAS Pipeline docs (README, `.env.example`, `docker-compose.yml`)
  describe the single bidirectional serial port it uses: SBF/L6 out of
  the receiver and RTCM3 back in on the same port. `CLAS_INPUT_DEVICE` is
  the only variable; `CLAS_OUTPUT_DEVICE` is gone (#37).

### Fixed
- Real-Time Trace / Console / Solution: the view no longer moves while
  you scroll up to read; a "Jump to latest" button returns to the live
  end (#72).
- Post Processing Trace shows the end of the trace file instead of its
  first 5000 lines, with a "last N of M lines" note and a Download link
  for long files (#73).
- Data Downloader (#74):
  - IGS products (CDDIS) could never download: Earthdata credentials
    were dropped on the redirect to `urs.earthdata.nasa.gov`, which then
    returned its login page. Credentials are now sent to that host.
  - An HTML page is no longer saved as a data file (`.gz`).
  - GSI CORS downloads no longer freeze the server (Real-Time and Stream
    Server sessions included) while they run, and report only the
    station-day's size.
  - Downloads stream to disk and a failed transfer leaves no partial file.

## [0.4.0-alpha] - 2026-10-12

### Upgrade notes
- Upgrading from 0.3.1 or earlier: also read the 0.3.2-alpha upgrade notes
  below (non-root container with `PUID:PGID`, `.netrc` location, rtkrcv
  working directory).
- QC Preview is paused (see Changed); the button is greyed out.
- Week/TOW `.pos` files display 18 s later than before (see Changed).
- `uv.lock` is now tracked; Docker builds with `uv sync --frozen` and CI
  with `uv sync --locked`. After changing dependencies in
  `pyproject.toml`, run `uv lock` and commit `uv.lock`.
- The `INSTALL_QC` build argument and the `qc` extra are gone (see
  Removed). An existing `INSTALL_QC` in `.env` is ignored.

### Added
- Post Processing: **PPP-AR Systems** control
  (`[ambiguity_resolution].systems`: GPS / Galileo / QZSS / BeiDou) and
  **Max Sol Std** control (`[output].max_solution_std`).
- Result Viewer: notice when the chart shows only the head of a file,
  or when an NMEA log carries no date.

### Changed
- QC Preview is disabled (greyed out; `/api/obs-qc/analyze` returns
  503) until it is rebuilt on MRTKLIB QC.
- Result Viewer: solution times stay in the file's time system (GPST /
  UTC / JST from the header; UTC for NMEA) and the map tooltip shows
  it. Week/TOW files are no longer shifted by a fixed 18 s, so they
  display 18 s later than before (now matching calendar output).
- Result Viewer: ENU charts resize and take new data in place; the
  shared zoom survives resizes and reference changes.
- Post Processing: only the 20 most recently finished jobs are kept for
  `/status`; the status poll stops with a warning on 404.

### Removed
- cssrlib / numba / numpy and python-socketio dependencies (~375 MB of
  QC stack in the image).

### Fixed
- TOML import keeps `max_solution_std`, `ura_ratio` and
  `slip_detection.doppler` (they were reset on import).
- `[ambiguity_resolution].systems` is written to the generated TOML
  (Post Processing and Real-Time); it was dropped, so MRTKLIB always
  used its default (GPS only) for PPP-AR.
- File previews read at most 16 MB, off the event loop (large files no
  longer stall the server or exhaust memory).
- NMEA logs without RMC (GGA only, or GGA before the first RMC) show
  positions; dates come from RMC / ZDA, the file name, or 1970-01-01.
- `mrtk post` output is always drained, so a run without log callbacks
  cannot hang.
- Real-Time: the console is no longer sent a guessed `admin` password.
- Map (Real-Time and Result Viewer): the dark-mode basemap showed "API KEY
  REQUIRED" tiles, because CARTO's `dark_all` now needs an API key. Dark
  mode now uses OpenStreetMap tiles darkened with a CSS filter.
- Healthcheck start period aligned to 10 s (Dockerfile and compose).

### Security
- Log masking also covers passwords containing `@` or `/`, e-mail user
  names (rtk2go), secret query parameters, secret-looking assignments
  and `Authorization` headers; the stream path input mask follows the
  same rules.

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

## [0.3.0-alpha] - 2026-07-15

### Changed
- MRTKLIB pinned to v0.7.6 (unified `mrtk` binary). Full TOML schema
  migration (types, backend `generate_conf_file`, `configToBackend`,
  `tomlImport`, preview) with lossless round-trip.
- Positioning settings restructured into the v0.7.6 sections; dead
  v0.6.5 fields removed.
- CLAS pipeline uses a single bidirectional serial port.
- Real-Time: the former scatter view is named **2D**.
- Unified dark terminal look across all consoles; collapsible
  Config | Workspace console frame.
- RINEX Converter: `DateTimePicker` for time fields; multi-column field
  layout.

### Added
- New v0.7.6 controls (robust estimation, TDCP, SNR, PPP clock jump,
  CLAS resilience, …), GPS AR toggle, legacy `.conf` → TOML converter.
- Real-Time: real-basemap **Map** view (Leaflet) for the live track.
- Result Viewer: 2D / Map for XYZ-ECEF and NMEA-0183 outputs, not only
  LLH.
- Bundled read-only QZSS CLAS / MADOCA real-time presets.

### Fixed
- Post Processing: compressed inputs on the read-only `/data` mount are
  staged into a writable temp dir before running `mrtk`.
- Real-Time: the Stop button stays while the process is alive.
- Conversion: no duplicated output after clear + re-convert.

### Security
- Preset ids are validated to prevent path traversal.

## [0.2.1-alpha] - 2026-05-10

### Fixed
- Subprocess log reader no longer stops on lines longer than 64 KiB
  (seen with cssr2rtcm3's dump blocks): chunk-based reader, lines
  capped at 8 KiB with a `…[truncated]` marker.

## [0.2.0-alpha] - 2026-05-10

### Added
- Stream Server → **CLAS Pipeline** sub-tab: `mrtk relay` +
  `mrtk cssr2rtcm3` orchestration for SBF receivers + CLAS, with serial
  `/dev/serial/by-id` enumeration, watchdog teardown, live SBF
  PVTGeodetic position view and throughput meter.
- Bundled per-receiver cssr2rtcm3 configs; Septentrio mosaic-G5 /
  mosaic-CLAS preset; receiver-request issue template.
- Optional raw SBF recording; stream URL input (`tcpcli://`,
  `ntripcli://`) for bench testing.
- Issue / PR templates and label sync; Docker Hub description sync.

### Changed
- MRTKLIB pinned to v0.6.5.

### Fixed
- `crypto.randomUUID` polyfill so the UI works over plain HTTP (LAN,
  Tailscale).

## [0.1.3-alpha] - 2026-03-30

### Fixed
- Input file paths resolve from `/data` and `/opt/mrtklib/corrections`;
  shared path helpers and output path validation for Obs QC and
  Conversion.

## [0.1.2-alpha] - 2026-03-30

### Added
- Config Assistant: natural language → TOML generation.

### Fixed
- Defensive API response parsing.

## [0.1.1-alpha] - 2026-03-30

### Changed
- Documentation, accessibility and TOML handling improvements.

## [0.1.0-alpha] - 2026-03-28

Initial public release, built on MRTKLIB (v0.6.x).

Note: the `v0.1.0-alpha` git tag and GitHub pre-release (2026-04-20)
point to a later commit than 0.1.1–0.1.3 that adds Docker image
publishing (GHCR / Docker Hub), the `.mrtklib-version` pin (v0.6.4) and
build-time MRTKLIB branch selection.

### Added
- Post Processing (`mrtk post`): sidebar covering all MRTKLIB options,
  TOML import / export with lossless round-trip, server-side presets,
  all positioning modes (Single … PPP-AR, CLAS PPP-RTK, MADOCA, VRS-RTK).
- Real-Time (`mrtk run`): live position, fix-quality badges, position
  scatter, time series, sky plot + SNR chart, solution / trace output.
- Stream Relay (`mrtk relay`): up to 4 streams with per-stream control
  and console.
- RINEX Conversion (`mrtk convert`): convbin formats, option groups,
  command preview, RINEX preview.
- Receiver Monitor (NMEA / UBX / SBF) and Tools (GNSS Time Converter,
  Data Downloader).
- Single-container Docker deployment with `/workspace` (rw) and `/data`
  (ro) volumes; FastAPI + WebSocket backend; React 19 + TypeScript +
  Mantine v8 frontend.
