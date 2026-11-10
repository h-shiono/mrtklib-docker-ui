# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

All four groups below are in scope. When their needs conflict, the expert's
need for density wins; newcomers are served through presets, help links and
tooltips rather than through a sparser interface.

- **GNSS researchers and developers** evaluate positioning methods and
  corrections (CLAS, MADOCA, HAS and others). They tune many parameters and
  compare and analyse results.
- **Receiver and system evaluation engineers** check receivers and streams, and
  watch field tests and solution quality.
- **Surveying and operations practitioners** run known configurations and need
  to read state at a glance and operate without mistakes.
- **Learners and RTKLIB migrants** want to try the tools without a CLI or a
  build, and lean on presets and explanations.

## Product Purpose

MRTKLIB Web UI puts the MRTKLIB CLI tools in a browser, running in one Docker
container: post-processing, real-time positioning, stream relay (including the
CLAS to RTCM3), stream monitoring, RINEX conversion and data tools. Nothing has
to be compiled.

Success means the people above can do in the browser what they would otherwise
do with the RTKLIB GUI applications or the `mrtk` command line.

## Positioning

The modern successor to the RTKLIB GUI applications (RTKNAVI, RTKPOST and
friends): the same jobs, delivered through a browser with no build step, on top
of MRTKLIB's corrections and pipelines.

## Operating Context

- **Desk PC or large monitor**, running Docker on a workstation: post-processing
  and long analysis sessions.
- **Laptop in the field**, outdoors or in a vehicle: small screen, bright
  surroundings, real-time monitoring.
- **Remote access to a single-board computer** attached to a receiver, for
  example over an SSH tunnel. A run keeps going in the backend when the browser
  closes, and the page must reattach to it.

Tablets and phones are not a priority.

## Capabilities and Constraints

- Primary modes are Real-time (`mrtk run`) and Post-processing (`mrtk post`).
  Stream Relay, Stream Monitor, Conversion and Tools are separate screens.
- RT and PP configurations are deliberately separate: their own state, storage
  keys and preset namespaces. Only their appearance is shared.
- TOML import and export is a lossless round-trip. Keys with no form field must
  survive.
- Configuration sections, their fields and their reference-doc links are
  preserved through UI restructuring. Layout work does not change form logic or
  validation.
- A PP run state machine (idle, running, done screens) was considered and
  declined.
- NTRIP credentials are masked in fields and console output.
- Terminology: "Stream Relay" and "Stream Monitor" are the current names (not
  "Stream Server" or "Stream Viewer"). Positioning quality uses the MRTKLIB Q
  values: Fix, Float, SBAS, DGPS, Single, PPP, DR.

## Evidence on Hand

- `docs/screenshot.png`: a screenshot of the running UI.
- Local-only captures for verification, manifest in the repository
  (`tests/localdata/`).
- No user research, usage analytics or testimonials exist. Do not invent them.

## Product Principles

1. **Experts set the density.** Many parameters and data series stay visible at
   once. Guidance is added around that, not in place of it.
2. **What the screen says is what the process is doing.** Status reflects the
   real state of the `mrtk` process and its streams, including failure.
3. **One tool, not a set of tools.** A concept looks and behaves the same in
   Real-time, Post-processing and Stream Monitor.
4. **Nothing in the configuration gets lost.** Every option stays reachable, and
   a configuration that goes in comes back out intact.

## Undecided

- No accessibility standard has been set. Requirements such as colour-vision
  support for the quality and constellation colours are open.
