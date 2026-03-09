# Project: RTKLIB-Web-UI (Dockerized)

## Overview
This project aims to create a Web UI for RTKLIB's command-line tools (`consapp`), specifically targeting Linux and MacOS users via Docker. The goal is to provide a User Experience (UX) similar to the Windows GUI version of RTKLIB but accessible through a web browser.

## Architectural Constraints & Tech Stack

### 1. Architecture
- **Deployment:** Docker Container (Single container approach).
- **File Access:** The host's data directory will be bind-mounted to `/workspace` inside the container.
- **Network:** The Web UI and Backend run on the same origin (e.g., `http://localhost:8080`).

### 2. Backend (API & Process Management)
- **Language:** Python 3.11+
- **Framework:** FastAPI
- **Process Handling:** Python `subprocess` (or `asyncio.subprocess`) to spawn RTKLIB binaries (`rnx2rtkp`, `str2str`, `convbin`).
- **Real-time Communication:** `python-socketio` (WebSocket) for streaming process logs and status updates to the frontend.
- **RTKLIB Binaries:** Assume binaries are pre-installed at `/usr/local/bin/` inside the Docker image.

### 3. Frontend (UI)
- **Framework:** React (Vite) + TypeScript.
- **UI Library:** Mantine (Recommended for dense, dashboard-like scientific interfaces) or Chakra UI.
- **State Management:** React Context or Zustand.

## Core Functional Requirements

### 1. UX/UI Design Philosophy
- **Windows-Like Layout:** Mimic the layout of `rtkplot`, `rtkpost`, and `str2str` GUI (RTKNAVI-like dashboard) where appropriate.
- **Default Values:** The UI must load with sensible default settings for RTKLIB, just like the Windows GUI.

### 2. Configuration Management (Crucial)
- **Stateless Container:** Do not rely on saving config files inside the container's system areas.
- **Import/Export Flow:**
  - **Export:** Users configure settings in the Web UI -> Click "Export" -> Browser downloads a `.conf` file (RTKLIB standard format).
  - **Import:** Users upload a `.conf` file -> Web UI parses it and populates the form fields.
  - **Save to Workspace:** Optionally, allow saving the `.conf` file directly to the bind-mounted `/workspace`.

### 3. Feature: Post-Processing (`rnx2rtkp`)
- Form inputs for Observation files (Rover/Base), Nav files, and Output path.
- These paths should refer to files within `/workspace`.
- A file picker component that browses the `/workspace` directory is required.

### 4. Feature: Stream Server (`str2str`)
- **Hybrid Monitoring UI:**
  1.  **Console Output:** A scrollable text area showing the raw `stderr` output from `str2str`.
  2.  **Visual Indicators:** "LED-like" status lights (Green/Red/Blinking) indicating connection status and data traffic, similar to the Windows `strsvr` or `rtknavi`.
- **Implementation Detail:** The Python backend must parse the `str2str` log stream to derive "Heartbeat/Status" events and push them via WebSocket to drive the visual indicators.

## Development Guidelines for AI
1.  **Modularity:** Keep the frontend components (e.g., `ConfigForm`, `LogConsole`, `FileBrowser`) and backend logic (e.g., `RTKProcessManager`, `ConfigParser`) distinct and modular.
2.  **Type Safety:** Use strict TypeScript interfaces for all data exchanged between backend and frontend (especially the Configuration object structure).
3.  **Error Handling:** Ensure that if an RTKLIB process crashes, the Web UI reflects this state immediately.
4.  **Mocking:** If RTKLIB binaries are missing during the dev phase, implement a "Mock Mode" in the backend that simulates log output for UI testing.

## Directory Structure Plan (uv-based)

The project follows the standard `uv` project structure (src layout) for the Python backend, with the frontend residing in a dedicated subdirectory.

```text
rtklib-web-ui/                 # Root (generated via `uv init`)
├── pyproject.toml             # Backend dependencies & metadata
├── uv.lock                    # Lockfile for reproducible builds
├── .python-version
├── README.md
├── src/
│   └── rtklib_web_ui/         # Python Backend Package (snake_case)
│       ├── __init__.py
│       ├── main.py            # FastAPI Entry point
│       ├── api/               # API Routers
│       └── services/          # Business logic (RTKLIB wrapper, etc.)
├── frontend/                  # Frontend (React + Vite)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/                   # React components
├── docker/
│   └── Dockerfile             # Multi-stage build (Node build -> uv sync -> Runtime)
└── docker-compose.yml
```

## Development Notes for AI
- Backend Setup: Use uv sync to install dependencies.
- Docker Build Strategy:
    - Use ghcr.io/astral-sh/uv:python3.11-bookworm (or similar) as the base image, or copy the uv binary into a standard Python image.
    - Run uv sync --frozen --no-dev in the build stage to ensure deterministic builds.
- Naming Convention: The root folder is rtklib-web-ui (kebab-case), but the Python source package inside src/ must be rtklib_web_ui (snake_case) to comply with Python import rules.

---

## Implementation Status & Technical Patterns

### RTKLIB Version
- **Current Version:** 2.4.3 b34
- **Backend Endpoint:** `/api/rtklib/version` returns version string and available binaries
- **Version Detection:** Attempts to execute `str2str` binary and parse version from stderr, falls back to hardcoded default "RTKLIB ver.2.4.3 b34"

### Post-Processing Configuration (`rnx2rtkp`) UI

The `PostProcessingConfiguration` component implements a comprehensive UI for configuring RTKLIB's `rnx2rtkp` tool with the following tabbed interface:

#### Tabs Structure
1. **Setting 1** - Basic positioning parameters
2. **Setting 2** - Ambiguity resolution
3. **Output** - Solution format and output options
4. **Stats** - Error models and process noises
5. **Positions** - Rover and base station positions
6. **Files** - Auxiliary files
7. **Misc** - Miscellaneous options

### Conditional Logic Patterns

The UI implements sophisticated conditional enable/disable logic based on positioning mode and output format selections. This mimics the behavior of the Windows RTKLIB GUI.

#### Helper Boolean Pattern

For clean, maintainable conditional logic, the component uses helper boolean variables:

```typescript
// Positioning mode helpers
const isSingle = config.setting1.positioningMode === 'single';
const isDGPS = config.setting1.positioningMode === 'dgps';
const isPPP = ['ppp-kinematic', 'ppp-static'].includes(config.setting1.positioningMode);
const isKinematic = config.setting1.positioningMode === 'kinematic';
const isStatic = config.setting1.positioningMode === 'static';
const isStaticMode = ['static', 'ppp-static'].includes(config.setting1.positioningMode);
const isFixedMode = ['fixed', 'ppp-fixed'].includes(config.setting1.positioningMode);

// Output format helpers
const isSolLLH = config.output.solutionFormat === 'llh';
const isSolNMEA = config.output.solutionFormat === 'nmea';
```

#### Setting 1 Tab - Conditional Logic
- **Ionosphere Correction:** Disabled when Single or PPP modes
- **Troposphere Correction:** Disabled when Single mode
- **Satellite PCV:** Disabled when Single or DGPS modes
- **Receiver PCV:** Disabled when Single or DGPS modes
- **Reject Eclipse:** Disabled when Single or DGPS modes

#### Setting 2 Tab - Conditional Logic
- **All AR Settings:** Disabled when positioning mode is Single, DGPS, PPP-Kinematic, or PPP-Static
- **Baseline Length Constraint:** Enabled only when constraint checkbox is checked

#### Output Tab - Conditional Logic
- **Datum:** Disabled when Solution Format is NOT "Lat/Lon/Height"
- **Height Type:** Disabled when Solution Format is NOT "Lat/Lon/Height"
- **Geoid Model:** Disabled when Solution Format is NOT "Lat/Lon/Height"
- **Output Velocity:** Always enabled (including for NMEA0183 format)

#### Positions Tab - Conditional Logic (Phase 16)
- **Rover Station Coordinates:** Enabled ONLY in Fixed or PPP-Fixed modes
- **Rover Station Antenna Info:** Disabled ONLY in Single mode
- **Base Station (All Inputs):** Disabled in Single mode
- **Station Position File:** Disabled in Single mode

### Component Architecture Patterns

#### Prop Segregation for Granular Control

The `StationPositionInput` component uses segregated props for fine-grained control:

```typescript
interface StationPositionInputProps {
  label: string;
  value: StationPosition;
  onChange: (value: StationPosition) => void;
  disabled?: boolean;           // Disables entire component
  disableCoordinates?: boolean; // Only disables coordinate inputs
  disableAntenna?: boolean;     // Only disables antenna inputs
}
```

This pattern allows different disable rules for coordinates vs antenna settings within the same station input component.

#### Usage Example

```typescript
<StationPositionInput
  label="Rover Station"
  value={config.positions.rover}
  onChange={(newRover) => handleConfigChange({...})}
  disableCoordinates={!isFixedMode}  // Enable coords only in Fixed/PPP-Fixed
  disableAntenna={isSingle}           // Disable antenna only in Single mode
/>
```

### Type System

#### Frontend TypeScript Types

Key enumerations defined in [`frontend/src/types/rnx2rtkpConfig.ts`](frontend/src/types/rnx2rtkpConfig.ts):

```typescript
export type PositioningMode =
  | 'single' | 'dgps' | 'kinematic' | 'static'
  | 'moving-base' | 'fixed' | 'ppp-kinematic' | 'ppp-static';

export type Frequency = 'l1' | 'l1+l2' | 'l1+l2+l5' | 'l1+l2+l5+l6' | 'l1+l2+l5+l6+l7';

export type SolutionFormat = 'llh' | 'xyz' | 'enu' | 'nmea';

export type TimeFormat = 'gpst' | 'gpst-hms' | 'utc' | 'jst';
```

#### Backend Python Models

Corresponding Pydantic models in [`src/rtklib_web_ui/services/rnx2rtkp_service.py`](src/rtklib_web_ui/services/rnx2rtkp_service.py) use snake_case naming:

```python
class Setting1Config(BaseModel):
    positioning_mode: str = Field(default="kinematic")
    frequency: str = Field(default="l1+l2")
    # ...
```

#### Naming Convention Conversion

- **Frontend:** camelCase (e.g., `positioningMode`, `elevationMask`)
- **Backend:** snake_case (e.g., `positioning_mode`, `elevation_mask`)
- Conversion happens automatically via FastAPI's Pydantic model validation

### LocalStorage Persistence Strategy

#### Versioning Approach

The UI persists configuration to browser localStorage with versioned keys:

```typescript
const STORAGE_KEY = 'rnx2rtkp-config-v12';
```

When the configuration structure changes, increment the version number (e.g., `v12` → `v13`) to prevent schema conflicts. Old configurations are automatically discarded when the version key changes.

#### Save/Load Pattern

```typescript
// Save on every config change
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}, [config]);

// Load on component mount
useEffect(() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      setConfig(parsed);
    } catch (e) {
      console.error('Failed to parse saved config');
    }
  }
}, []);
```

### UI Component Library

- **Framework:** Mantine v7
- **Component Size:** Consistently using `size="xs"` for dense, dashboard-like layout
- **Layout:** Stack, Group, Grid components for responsive layouts
- **Form Controls:** Select, TextInput, NumberInput, Switch, Checkbox
- **Tabs:** Mantine Tabs with `variant="default"` and `keepMounted={false}` for performance

### Key Features Implemented

1. ✅ **Setting 1 Tab:** Basic positioning parameters with conditional logic
2. ✅ **Setting 2 Tab:** Ambiguity resolution with AR mode dependencies
3. ✅ **Output Tab:** Solution format, time format, datum settings with conditional enable/disable
4. ✅ **Stats Tab:** Error models and process noises configuration
5. ✅ **Positions Tab:** Rover/Base station configuration with mode-specific constraints
6. ✅ **Files Tab:** Auxiliary file selection (ANTEX, Geoid, DCB, etc.)
7. ✅ **Misc Tab:** Time system, corrections, and RINEX options
8. ✅ **SNR Mask Modal:** 3x9 matrix editor for L1/L2/L5 elevation-dependent SNR masks
9. ✅ **LocalStorage Persistence:** Auto-save/load with versioning
10. ✅ **RTKLIB Version Display:** Shows version 2.4.3 b34 in UI

### Phase Completion Status

- **Phase 14:** Setting 2 Tab conditional logic ✅
- **Phase 15:** Output Tab corrections (Datum, Time Format, Solution Format, Output Velocity) ✅
- **Phase 16:** Positions Tab conditional logic (Rover coordinates, Rover antenna, Base station) ✅

### Future Considerations

- **Config Import/Export:** Parse and generate `.conf` files compatible with RTKLIB Windows GUI
- **File Browser Integration:** Browse `/workspace` for RINEX and navigation files
- **Real-time Processing:** Connect to `rnx2rtkp` process via WebSocket for progress updates
- **Configuration Presets:** Save/load named configuration profiles
