# Upgrading

## How to upgrade

Your data stays where it is: outputs, presets, logs and stored credentials are
in `/workspace` on the host, and a new image reads them as they are.

=== "Docker Compose (build from source)"

    ```bash
    git fetch --tags
    git checkout v<version>
    # set APP_VERSION=<version> in .env, if you use it
    docker compose up -d --build
    ```

=== "docker run"

    ```bash
    docker pull hatognss/mrtklib-docker-ui:<version>
    docker rm -f mrtklib-web-ui
    docker run -d --name mrtklib-web-ui ... hatognss/mrtklib-docker-ui:<version>
    ```

    Use the same options as before; [Install](../getting-started/install.md)
    shows them.

The container restart stops anything that runs in it: a Real-time run, the
Streams relays, a Monitor session. Start them again afterwards.

Read the upgrade notes of every minor version between yours and the new one.
A change that needs something from you only comes in a minor release
(v0.4.0, v0.5.0, …), and its notes say what to do. A patch release
(v0.5.1, …) never needs anything.

## MRTKLIB versions

Each release of the UI is built with one MRTKLIB release, pinned in
`.mrtklib-version`. The configuration the UI writes is MRTKLIB's TOML, so it
follows that version.

| UI | MRTKLIB |
|---|---|
| v0.5.0 | 0.7.18 |
| v0.4.4 – v0.4.9 | 0.7.17 |
| v0.3.1 – v0.4.3 | 0.7.11 |
| v0.3.0 | 0.7.6 |
| v0.2.x | 0.6.5 |
| v0.1.0 | 0.6.4 |

- MRTKLIB is updated together with a UI release, never on its own.
- When an MRTKLIB update changes the TOML or a result in a way you have to act
  on, the UI release that brings it is a minor one, and its upgrade notes
  carry MRTKLIB's. Otherwise it can come in a patch release.
- The `MRTKLIB_BRANCH` build argument builds the image with another MRTKLIB
  branch or tag. That works for trying a version out, but it is not
  supported: the form follows the pinned version.

Older configurations:

- **TOML from MRTKLIB 0.5.0 – 0.7.5.** MRTKLIB 0.7.6 renamed sections and
  keys, and still reads the old names. The UI imports them too; export or save
  the configuration to write it with the current names.
- **`.conf` from RTKLIB or MRTKLIB before 0.5.0.** The UI imports TOML only.
  Convert the file with MRTKLIB's
  [`conf2toml.py`](https://github.com/h-shiono/MRTKLIB/blob/main/scripts/tools/conf2toml.py)
  first.

## Upgrading to v0.5.0

v0.5.0 is the first release without the `-alpha` suffix. Coming from any
v0.4.x, check these.

### The UI answers on this computer only

**Docker Compose** now publishes the UI on `127.0.0.1` only. If you open it
from another machine, it stops answering there after the upgrade. Choose a
row of the table in
[Security and network access](security.md); the shortest way back to the old
behaviour is `MRTK_BIND=0.0.0.0` in `.env`, with an access token.

**`docker run -p 8080:8000`** is not changed: the port is still open on every
interface. Change it to `-p 127.0.0.1:8080:8000` unless that is what you
want.

`MRTK_AUTH_TOKEN` is new and optional. Left unset, the UI asks for no sign-in,
as before.

### Presets

- **Your own presets now load.** A preset you saved in v0.4.x held the form's
  internal state, and loading it gave the default settings instead of yours.
  v0.5.0 reads those files correctly. Load each one, check it, and save it
  again: it is then written as MRTKLIB TOML, like an exported configuration.
- Presets are in `/workspace/presets/realtime/` and
  `/workspace/presets/post/`. A preset saved by v0.5.0 is a TOML file that
  `mrtk` reads as it is.

### Imported TOML keeps every key

A TOML you import may hold keys the form has no field for. v0.4.x dropped
them; v0.5.0 keeps them, and they now reach `mrtk` too, in a run, an export
and a preset. The TOML Preview lists them in a block of their own. If an old
configuration of yours carries keys you no longer want, remove them from the
file and import it again.

Two things are never kept: the `[streams]` table (Real-time writes it from the
form), and, in Real-time, `[console] passwd`.

### Results that can change

These were bugs, so a result can differ from what v0.4.x gave for the same
configuration:

- **Time range in Post-processing and the RINEX Converter.** In v0.4.x the
  start time of day and the end of Time Start / Time End were ignored, so the
  whole file was processed. v0.5.0 applies them. A start or end set but
  forgotten in a saved configuration now limits the run.
- **Real-time base position averaging.** The base station's **Max Avg
  Epochs** and **Init Reset** never reached `mrtk run`, which always averaged
  without limit. v0.5.0 passes them, so check them before a run.

### MRTKLIB 0.7.18

The image moves from MRTKLIB 0.7.17 to 0.7.18. Its
[upgrade notes](https://h-shiono.github.io/MRTKLIB/releases/release-notes-v0.7.18/)
list what changes; for the UI, these matter:

- **CLAS VRS-RTK frequencies** (GPS frequency / QZS frequency in the CLAS
  PPP-RTK/VRS section): the GPS setting no longer applies to QZS; set QZS
  frequency for it. `l1+l2+l5` now uses the third frequency, and `l1+l5` runs
  a satellite without L5 on L1 alone (`l1+l5(l2)` keeps the L2 fallback).
- **SNR mask on CLAS:** on the CLAS PPP-RTK and VRS paths the mask now rejects
  satellites, so a configuration that sets one there sees fewer of them.
- **CLAS L6D files in Post-processing:** with more than two files, two files
  of one pattern, or `l6_merge = 0` with two or more, the channels are built
  from the file contents. Files that were ignored before are now used.
- **CLAS to RTCM3:** the observations `cssr2rtcm3` builds now include GPS
  and QZS L5 where the corrections carry them, so the RTCM3 sent to the
  receiver has more signals than before. Check the receiver's RTK solution
  after the upgrade.
- **RINEX from RTCM3 MSM** (RINEX Converter): the half-cycle indicator is
  written as LLI 2 / 3 instead of 3 / 4.

### What else is new

- The configuration is read-only while its run is going, in Real-time and
  Post-processing; loading a preset, importing and the Config Assistant are
  unavailable until it ends. In Streams, a running stream's input and outputs are locked.
- **Stop** in Post-processing now ends `mrtk post`; the output written so far
  stays and is incomplete. Only one Post-processing run goes at a time.
- The header shows what runs on each screen, and `API: LOST` when the browser
  has lost the server.
- Options that only `mrtk post` or only `mrtk run` reads are disabled in the
  other mode.

The [Changelog](../releases/changelog.md) has the full list.
