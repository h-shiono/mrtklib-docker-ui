# MRTKLIB Web UI — Project Constitution

## Project Overview

Web UI for [MRTKLIB](https://github.com/h-shiono/MRTKLIB) CLI tools,
running in a Docker container. Users access GNSS post-processing,
real-time positioning, stream relay, RINEX conversion, and receiver
monitoring from a browser without compiling anything.

- **MRTKLIB version:** 0.6.2
- **Unified binary:** `mrtk` with subcommands (`post`, `run`, `relay`,
  `convert`, `ssr2obs`, `ssr2osr`, `bias`, `dump`)
- **UI version:** v0.1.0-alpha

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
- Chart.js — scatter, bar charts
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
│   ├── api/           # Routers: post, run, relay, convert,
│   │                  #   monitor, downloader, presets, files
│   └── services/      # Business logic per feature
├── frontend/src/
│   ├── components/
│   │   ├── common/    # OptionLabel, shared helpers
│   │   ├── tools/     # Time Converter, Data Downloader
│   │   ├── viewer/    # Result Viewer, Chart, Map
│   │   ├── obsViewer/ # Observation QC charts
│   │   └── ...        # Feature components (flat)
│   ├── theme.ts       # Mantine theme + cssVariablesResolver
│   └── utils/
│       └── gnssTime.ts# GPS time conversion logic
├── docker/Dockerfile
├── docker-compose.yml
└── .env.example
```

## Architecture Rules

### Navigation
Six top-level tabs: Post Processing | Real-Time | Stream Server |
Conversion | Tools | Monitor

Each tab except Tools/Monitor uses a sidebar (160px fixed) +
form panel layout, identical to VS Code Settings.

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
1. `/root/.netrc` mount (highest)
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
   post/run WebSocket implementation. New features (convert, monitor)
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
