---
name: MRTKLIB Web UI
description: A browser console for GNSS post-processing, real-time positioning and stream tools
colors:
  primary-on-dark: "#4C8DFF"
  primary-on-light: "#2563EB"
  primary-tint-text-on-light: "#1D4ED8"
  graphite-body: "#0F1217"
  graphite-surface: "#13161A"
  graphite-input: "#1B1F24"
  graphite-console: "#0C0E12"
  ink-on-dark: "#ECEEF1"
  console-ink-on-dark: "#C7CCD2"
  dimmed-on-dark: "#9CA3AB"
  placeholder-on-dark: "#7A838E"
  disabled-ink-on-dark: "#5F6873"
  disabled-fill-on-dark: "#1F242B"
  input-border-on-dark: "#4A525C"
  daylight-body: "#F4F6F8"
  daylight-surface: "#FFFFFF"
  daylight-console: "#F7F8FA"
  console-ink-on-light: "#25292E"
  dimmed-on-light: "#5C6670"
  placeholder-on-light: "#6B7480"
  input-border-on-light: "#8A939E"
  quality-fix: "#22c55e"
  quality-float: "#f59e0b"
  quality-sbas: "#a855f7"
  quality-dgps: "#6b7280"
  quality-single: "#ef4444"
  quality-ppp: "#3b82f6"
  quality-dr: "#06b6d4"
  quality-fix-text-light: "#15803d"
  quality-float-text-light: "#b45309"
  quality-sbas-text-light: "#7e22ce"
  quality-dgps-text-light: "#4b5563"
  quality-single-text-light: "#dc2626"
  quality-ppp-text-light: "#2563eb"
  quality-dr-text-light: "#0e7490"
  status-off-on-dark: "#9CA3AB"
  status-off-on-light: "#5C6670"
typography:
  caption:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.08em"
  label:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  log:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  value:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
  title:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  data:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "16px"
    fontWeight: 500
  metric:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "24px"
    fontWeight: 500
rounded:
  md: "8px"
spacing:
  label-gap: "8px"
  xs: "10px"
  sm: "12px"
  md: "16px"
components:
  input:
    backgroundColor: "{colors.graphite-input}"
    textColor: "{colors.ink-on-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
  button-primary:
    backgroundColor: "{colors.primary-on-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
  button-utility:
    backgroundColor: "{colors.graphite-input}"
    textColor: "{colors.dimmed-on-dark}"
    rounded: "{rounded.md}"
    size: "30px"
  form-label:
    textColor: "{colors.dimmed-on-dark}"
    typography: "{typography.label}"
    width: "130px"
  console-dark:
    backgroundColor: "{colors.graphite-console}"
    textColor: "{colors.console-ink-on-dark}"
    typography: "{typography.log}"
  console-light:
    backgroundColor: "{colors.daylight-console}"
    textColor: "{colors.console-ink-on-light}"
    typography: "{typography.log}"
---

# Design System: MRTKLIB Web UI

> **Status.** Adopted 2026-11-09 as the target for the interface. The code is
> being migrated in stages; where it differs from this file, this file wins.
> Not yet in code: `LogView`, the workspace's compact summary strip and status
> footer, the Run Ending behaviour, and `<label>` association on the Processing Configuration rows,
> which match `FormRow` visually but do not use it yet.

## Overview

**Creative North Star: "The Instrument Panel"**

The screen is an instrument panel for a positioning engine. Numbers and states
are the subject, and the chrome stays out of their way. An expert should be able
to read the state of a run in one glance, from any of the screens, because the
same gauge always has the same shape and sits in the same place.

The panel is dense on purpose: many parameters and series stay visible at once.
Colour is rationed so that when something is coloured, it is reporting state.
It comes in two equally maintained forms: graphite for the desk, and daylight
for a laptop in bright surroundings.

**Key Characteristics:**
- High density with one strict grid for form rows.
- Colour reports state; everything else is neutral.
- One component per concept across Real-time, Post-processing and Stream Monitor.
- IBM Plex Mono for every number, path, log and code value.
- Flat, separated by tone and hairlines.

## Colors

A neutral graphite and daylight pair with a single azure accent, and status
colours that carry all the meaning.

### Primary
- **Azure** (`primary-on-dark`, `primary-on-light`): controls and selection only: the active tab, the selected rail item, focus, the primary action when it is not a run action. On a light tint, its text is one step darker (`primary-tint-text-on-light`) to hold 4.5:1.

### Neutral
- **Graphite** (`graphite-body`, `graphite-surface`, `graphite-input`): the dark theme's page, cards and fields, stepped by tone.
- **Console Graphite** (`graphite-console`): the sunken surface of logs in the dark theme.
- **Daylight** (`daylight-body`, `daylight-surface`, `daylight-console`): the light theme's page, cards and logs.
- **Ink and Dimmed** (`ink-on-dark`, `dimmed-on-dark`, `dimmed-on-light`): primary text, then field labels and secondary text.
- **Placeholder, Disabled and Border** (`placeholder-*`, `disabled-*`, `input-border-*`): field hints, unavailable controls and field outlines.

### Tertiary
- **Quality** (`quality-*`): the MRTKLIB Q values, from `utils/quality.ts`. These hex values are for dots, scatter and canvas marks.
- **Quality Text for Daylight** (`quality-*-text-light`): the same values darkened for text on light surfaces. In the dark theme DGPS text uses `dimmed-on-dark`, because its mark colour is too faint to read as text.
- **Lifecycle:** process and stream state, from one map in `utils/status.ts`: grey for off, idle and stopped (`status-off-*`); blue for starting and connecting; green for running, receiving and complete; amber for stalled, no decode and warning; red for error and abnormal exit. These reuse the quality hues, with the same daylight text values.
- **Constellation:** GPS, GLONASS, Galileo, QZSS, BeiDou and SBAS keep the hues listed in CLAUDE.md, and always appear with their letter or name.

### Named Rules
**The Colour Means State Rule.** Colour outside azure controls reports a quality or a lifecycle state. A value that is not a state, such as Ratio, stays neutral.

**The Two Layers Rule.** Quality describes the solution and lifecycle describes the process. They are defined in one file each and never share a token. A grey "stopped" is not a Single solution.

**The Daylight Rule.** The light theme is the outdoor theme, not a derivative. Text holds 4.5:1 and field outlines 3:1 on their surfaces, and every colour decision is checked in it.

**The Word Beside the Dot Rule.** A state is always a dot and a word. An error also carries an icon, so it never reads as a Single dot.

## Typography

**Display Font:** IBM Plex Sans (with sans-serif)
**Label/Mono Font:** IBM Plex Mono (with monospace)

**Character:** Plex Sans labels the instrument and Plex Mono reports its readings; the split shows at a glance what is a name and what is a value.

### Hierarchy
- **Caption** (500, uppercase mono, tracked): metric and rail group captions only.
- **Label** (400): field labels, tabs, status bar text.
- **Log** (400, mono, 1.5): every console, solution and trace view.
- **Body** and **Value** (400): input contents and status values. Value is the mono form for paths, hosts and numbers.
- **Title** (500): section headers and panel titles.
- **Data** (500, mono): latitude, longitude, height and the timestamp.
- **Metric** (500, mono): Quality, Ratio, Age and Satellites.

Weights are 400, 500 and 600, with 700 reserved for state words.

### Named Rules
**The Six Sizes Rule.** Only these sizes exist: 10, 11, 12, 14, 16, 24. Fractional sizes and 9px are gone, and Mantine's 9px extra-small Badge counts.

**The Caption Floor Rule.** 10px is for uppercase captions and chart tick labels, and nothing else. Anything a person reads as a sentence or a field name is at least 11px.

**The Readout Rule.** Every number, path, log line and code value is IBM Plex Mono, referenced through `var(--mantine-font-family-monospace)`.

## Layout

No screen scrolls as a page. On every screen, including Stream Relay,
Conversion and Tools, the columns take `calc(100dvh - 114px)` and scroll inside
themselves, so touching a setting never moves the workspace.

The config column is a section rail and a form. Form rows use a 130px label, an
8px gap and a control that fills the rest, at a 30px row height and 36px pitch.

On Real-time, Post-processing and Stream Monitor, the workspace runs, top to
bottom: the summary strip (auto height, no wrapping reflow), the tab bar, the
panel (fills the remaining height) and the status footer (pinned, one compact
row; Post-processing has no live stream and omits it). Tabs are ordered Chart,
Solution, Console, then Trace or Message. Stream
Relay, Conversion and Tools have no positioning summary, so they take neither
the summary strip nor the status footer.

The column split collapses below Mantine's `sm` breakpoint. Tablets and phones
are not a priority, and 1366x768 is the smallest size that must show the status
footer without scrolling.

### Named Rules
**The Fixed Frame Rule.** Panel height comes from the viewport, never from a numeric constant or from a neighbouring column.

## Elevation & Depth

The system is flat at rest. Depth comes from tonal steps (body, surface, input,
console) and hairline borders. Shadows exist only on elements that genuinely
float above the page: popovers and tooltips.

### Named Rules
**The Flat-by-Default Rule.** If an element is attached to the page, it has no shadow.

## Shapes

One gentle corner (8px) is used for cards, inputs and buttons. Pills are for
chips and status badges only. Checkboxes keep a tighter corner so that they do
not read as radio buttons.

## Components

### Buttons
Precise and restrained.
- **Primary:** the single filled control in a toolbar, at the far right with a fixed minimum width so that Start and Stop do not move. Run actions are green and stop actions are red. Text colour comes from Mantine `autoContrast` with `luminanceThreshold: 0.18`, which holds at least 5:1 on the filled colours in use.
- **Utility:** 30px, neutral, icon only, always with an `aria-label` and a tooltip. Browse buttons are utility buttons and are never filled.
- **Verbs:** Start and Stop for continuous work; the job's own verb for batch work (Execute, Convert).
- **Starting:** while a run starts, the button is disabled and shows a loader. It does not become Stop until the run is confirmed.

### Inputs / Fields
- **Size:** 30px (`xs`) everywhere including Tools, set in theme `defaultProps`.
- **Label:** left, 130px, a real `<label>` tied to its control.
- **Value:** Body, or Value for paths, hosts and numbers. No per-field font size overrides.
- **Trailing slot:** a fixed 30px slot for browse and `?` controls.

### Navigation
- **Tabs:** one style, text only, 32px. The tab bar's right slot belongs to the active tab, so chart view selectors appear only on Chart and use the same chip multi-select on every screen.
- **Section headers:** the shared `SectionHeader` everywhere: Title, a hairline, and `?` at the right.
- **Config header:** one row: collapse, title, `?`, then the state badge (always shown, including idle), utility icons and, at the far right, the primary action.

### Console (`LogView`)
The one log view, generalised from `common/TraceLogView.tsx`, used for Console, Solution and Trace on every screen and in Relay, Conversion and the CLAS pipeline.
- **Surface:** `console-dark` and `console-light` by theme. It fills its panel.
- **Toolbar:** in the tab bar's right slot: search with count and previous/next, matching-only, copy, download when a file exists, clear.
- **Follow:** `useFollowScroll` everywhere, with "Paused · Jump to latest".
- **Wrap:** Console wraps, Solution never wraps, Trace has a toggle.
- **Severity:** `[ERROR]` is red with a 2px left rule, `[WARN]` is amber. A count dot on the tab reports errors arriving while another tab is open.
- **Masking:** credential masking happens inside the component, so no caller can forget it.
- **Buffer:** when lines are trimmed, it says so.

### Status Footer
Stream health for the run: Input, Received, Decoded from, Messages, Undecoded. It uses the shared status light, is always on screen, and is the only place the detail of a dead input needs to appear.

### Run Ending
A run that ends stays on the panel. The badge reports `EXITED (code n)` on an abnormal exit and `STOPPED` otherwise; the last session stays dimmed with "Last session · hh:mm:ss" until the next Start, so a dead solution never reads as live and never disappears.

### Empty States
One component with two messages: idle ("No output yet. Press Start.") and running ("Waiting for output…"). Label size, dimmed, not italic.

## Do's and Don'ts

### Do:
- **Do** build a concept once and reuse it on every screen.
- **Do** show only values that are true. If a figure is not known, leave it out rather than printing a placeholder such as `Fix: ---`.
- **Do** keep the running state visible from anywhere: a dot on the header item for any screen with an active process.
- **Do** check every colour change in the light theme as well.
- **Do** add `minWidth: 0` to flex children that should truncate.

### Don't:
- **Don't** set input sizes, font sizes or colours per call site; use the theme and tokens.
- **Don't** give a log view a numeric height.
- **Don't** fill more than one control in a toolbar.
- **Don't** use azure for a value that is not a control or a selection.
- **Don't** redefine a `dark` ramp index without checking what Mantine maps to it: placeholder and disabled text follow `dark[3]`.
- **Don't** convey state by colour alone.
