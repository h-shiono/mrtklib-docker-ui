# MRTKLIB Web UI — Project Constitution

## Project Overview

Web UI for [MRTKLIB](https://github.com/h-shiono/MRTKLIB) CLI tools,
running in a Docker container. Users access GNSS post-processing,
real-time positioning, stream relay (incl. the CLAS pipeline), RINEX
conversion, and data tools from a browser without compiling anything.

- **MRTKLIB version:** 0.7.11 (pinned in `.mrtklib-version`)
- **Unified binary:** `mrtk` with subcommands (`post`, `run`, `relay`,
  `convert`, `ssr2obs`, `ssr2osr`, `bias`, `dump`, `cssr2rtcm3`,
  `l6extract`)
- **UI version:** v0.4.0-alpha (next: v0.5.0 — drops the alpha suffix)

## Tech Stack

### Backend
- Python 3.11+, FastAPI, Pydantic v2
- `asyncio.subprocess` for spawning `mrtk` processes
- WebSocket for real-time log/status streaming
- `tomllib` (stdlib) for TOML parsing; `tomli_w` for writing
- `uv` for dependency management (src layout)

### Frontend
- React 19 + TypeScript (strict mode), Vite
- **Mantine v8** — UI library (no v6 patterns, no `sx` prop)
- Charts: uPlot (PP Result Viewer time series, obs QC SNR),
  Recharts (RT position scatter / time series), Chart.js (RT sky plot /
  SNR bars); Leaflet + react-leaflet for maps
- IBM Plex Sans + IBM Plex Mono (Google Fonts)
- No external state manager — React `useState` / `useRef`

### Deployment
- Multi-stage Docker build (CMake → Node → uv → runtime)
- Two volumes: `/workspace` (rw), `/data` (ro)
- Single container, same-origin (port 8080)

## Directory Structure
```
mrtklib-docker-ui/
├── CLAUDE.md
├── tasks/
│   ├── todo.md        # Active tasks (read before starting work)
│   └── lessons.md     # Accumulated patterns (read before coding)
├── src/mrtklib_web_ui/
│   ├── main.py        # FastAPI entry point
│   ├── paths.py       # ALLOWED_ROOTS / path checks
│   ├── api/           # Routers: mrtk_post, mrtk_run, mrtk_relay,
│   │                  #   clas_pipeline, convert, downloader, presets,
│   │                  #   files, config, ai, obs_qc
│   └── services/      # Business logic per feature
├── tests/             # pytest (backend)
├── frontend/src/
│   ├── App.tsx        # Shell, header mode switch, PP panel
│   ├── components/
│   │   ├── common/    # OptionLabel, MaskedPathInput
│   │   ├── tools/     # Time Converter, Data Downloader, AI Settings
│   │   ├── viewer/    # PP Result Viewer (Chart, 2D plot, Map)
│   │   ├── obsViewer/ # Observation QC charts
│   │   └── ...        # Feature components (flat)
│   ├── config/        # optionMeta.ts, sectionSearchIndex.ts
│   ├── hooks/         # useFollowScroll, useWebSocket, ...
│   ├── types/         # MrtkPostConfig etc.
│   ├── theme.ts       # Mantine theme + cssVariablesResolver
│   └── utils/         # gnssTime, configToBackend, tomlImport, ...
├── docker/Dockerfile
├── docker-compose.yml
└── .env.example
```

## Architecture Rules

### Navigation
The header has a mode switch for the two primary modes,
**Real-time | Post-processing**, and separate header buttons for
**Stream Server** (Multi-Stream Relay, CLAS Pipeline) | **Conversion** |
**Tools** (Time Converter, Data Downloader, AI Settings).

Real-time and Post-processing use `ConsoleFrame`: a collapsible
Config column (left) and a Workspace column (right: Chart / Solution /
Console / Trace sub-tabs). The config panels use a section rail + form
layout like VS Code Settings. Tools uses `ToolsSidebar` + panel.

### Form layout convention
All config panels use **label-left / input-right** (130px label width):
```tsx
<Group justify="space-between" align="center" mb={6}>
  <Text size="sm" c="dimmed" style={{ width: 130, flexShrink: 0 }}>
    Label
  </Text>
  <Box style={{ flex: 1 }}>
    <Select ... />
  </Box>
</Group>
```

### Section headers
Use the shared `SectionHeader` component with a `?` icon that
opens the MRTKLIB reference docs at the correct anchor:
```tsx
<SectionHeader title="Basic Strategy" anchor="basic-strategy" />
```

SECTION_ANCHORS map lives in `frontend/src/components/ProcessingConfigTabs.tsx`.

### TOML I/O — lossless round-trip
The full parsed TOML dict is stored in `rawConfig` state alongside
form state. On export, form values take precedence but keys with no
corresponding form field are preserved from `rawConfig`.
This ensures unknown/future keys survive import → export cycles.

### Preset storage
Presets saved to `/workspace/presets/{mode}/` as `.toml` files.
Backend endpoints: `GET/POST/PUT/DELETE /api/presets/{mode}/{id}`.
PP and RT presets are namespaced independently.

### Credential priority (Data Downloader)
1. `~/.netrc` mount — `/home/mrtk/.netrc` in the container (highest)
2. `EARTHDATA_USER` / `GSI_USER` env vars
3. `/workspace/.credentials.toml` stored via UI

### Path security
All file API endpoints enforce:
```python
ALLOWED_ROOTS = [
    Path("/workspace"),              # read-write
    Path("/data"),                   # read-only
    Path("/opt/mrtklib/corrections"),# read-only (bundled system files)
]
```
Reject any path outside these roots with 403.
Writes are restricted to `/workspace` only.

### Color semantics (quality badges / scatter)
```typescript
const QUALITY_COLOR = {
  1: '#22c55e',  // Fix
  2: '#f59e0b',  // Float
  3: '#a855f7',  // SBAS
  4: '#6b7280',  // DGPS
  5: '#ef4444',  // Single
  6: '#3b82f6',  // PPP
};
```

### Constellation colors (Sky Plot / SNR)
```typescript
const SYS_COLOR = {
  GPS:     '#3b82f6',
  GLONASS: '#a855f7',
  Galileo: '#f59e0b',
  QZSS:    '#22c55e',
  BeiDou:  '#ef4444',
  SBAS:    '#6b7280',
};
```

## Development Commands

### Backend
```bash
uv sync
uv run uvicorn mrtklib_web_ui.main:app --reload --host 0.0.0.0 --port 8000
uv run pytest      # backend tests (tests/)
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies to :8000)
npm run build
npm run lint
```

### Docker
```bash
docker compose up --build
# Access: http://localhost:8080
```

## Key Constraints for Claude Code

1. **Mantine v8 only.** Never use v6 patterns or the `sx` prop.
   Use `style` prop for inline overrides.

2. **Never change form field logic or validation** unless explicitly
   asked. UI restructuring tasks touch navigation/layout only.

3. **WebSocket pattern:** All streaming follows the existing
   post/run WebSocket implementation. New features (convert, tools)
   must replicate this pattern exactly.

4. **`minWidth: 0` in flex containers.** Always add this to flex
   children that should not overflow. Omitting it is the #1 cause
   of layout bugs in this project.

5. **IBM Plex Mono for all numeric/code output.** Coordinates,
   console text, TOML preview, RINEX preview, command preview.

6. **Read `tasks/lessons.md` before writing any code.**
   It contains patterns that prevent recurring mistakes.

7. **Read `tasks/todo.md` before starting any task.**
   Check for in-progress items or dependencies.
