# Screens

The header holds everything. The mode switch on the left picks the two
primary modes, **Real-time** and **Post-processing**. Buttons beside it open
**Streams**, **Monitor** and **Tools**.

| Screen | Runs | For |
|---|---|---|
| [Real-time](real-time.md) | `mrtk run` | Live positioning from receiver and correction streams |
| [Post-processing](post-processing.md) | `mrtk post` | Solutions from recorded RINEX and correction files, and the Result Viewer |
| [Streams](streams.md) | `mrtk relay`, `mrtk cssr2rtcm3` | Relaying and saving streams, receiver configuration, CLAS to RTCM3 |
| [Monitor](monitor.md) | `mrtk relay` | Watching a receiver or stream decoded live, without positioning |
| [Tools](tools.md) | `mrtk convert`, `rnx2crx` / `crx2rnx` | RINEX conversion, time conversion, downloads, AI settings |

A dot in the header beside a screen's name shows that something runs there
(starting, running, stopping). The **API** badge at the right reads `API: OK`
while the server answers and `API: LOST` when the browser has lost it.

## The positioning screens

Real-time and Post-processing share one layout:

- **Config** on the left, collapsible. A section rail lists the option
  groups, like the settings of a code editor; the form shows one group at a
  time. The filter above the rail finds a section by option name.
- **Workspace** on the right, with the sub-tabs Chart, Solution, Console and
  Trace.

The `?` icon beside a section title opens that section in the
[MRTKLIB configuration reference](https://h-shiono.github.io/MRTKLIB/reference/config-options/).
This site does not repeat what the options mean.

While Real-time runs, its configuration is read-only: it shows what the
running process uses. Stop the run to change it.

## Configurations, presets and TOML

The configuration is MRTKLIB's TOML file. The form writes it, and you can see
the result before a run in the TOML Preview.

- **Import / Export** reads and writes a TOML file. Keys the form has no field
  for are kept: an imported TOML exported again keeps them, and they reach
  `mrtk` as well. The TOML Preview lists them.
- **Presets** are named configurations saved on the server as TOML files, in
  `/workspace/presets/realtime/` and `/workspace/presets/post/`. Real-time and
  Post-processing keep separate lists. Real-time also has built-in presets
  for CLAS PPP-RTK, MADOCA PPP, Galileo HAS, BeiDou PPP-B2b and SouthPAN PVS.
- **Loading a TOML** (import, a preset or the Config Assistant) replaces what
  a TOML carries and keeps what it does not: the Post-processing time range
  and the trace level.
- The **Config Assistant** writes a configuration from a description in any
  language. It needs an Anthropic API key, set in
  [Tools → AI Settings](tools.md#ai-settings).

## Appearance

The header has a dark / light switch. The light theme is made for use
outdoors.
