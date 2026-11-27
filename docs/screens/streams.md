# Streams

Streams relays GNSS data with `mrtk relay`: from a receiver or a network
stream to files, TCP servers and other programs. It is also
where receivers are configured, and where CLAS to RTCM3 runs.

## Multi-Stream

- Up to 4 streams at once, each with up to 4 outputs, each started and
  stopped on its own.
- **Inputs**: serial, TCP client or server, NTRIP client, file, and
  **Browser serial**: the page opens a USB / serial port on its own computer
  (Web Serial, Chrome or Edge, page on `localhost` or `https`), and the server
  serves it to the relay. Such a stream can be saved, sent to `mrtk run` and
  configured like any receiver; it stops when the tab closes or reloads. See
  [Serial devices](../getting-started/serial.md).
- **Saving**: a file output (with the `::T` and `::S=` options) is
  restart-safe. If the file already exists, or another relay writes it, the
  relay writes to `_2`, `_3`, … instead of overwriting it.
- **No outputs**: the relay only receives. Use it to check that an input
  works and to see its messages; the data is not kept.
- **Watching while saving**: with a `tcpsvr://:PORT` output, the
  [Monitor](monitor.md) can watch the same stream (Monitor input type
  **Streams**).
- Running relays are restored after a page reload, and can still be stopped.

## The selected stream

Four tabs show the selected stream:

- **Messages**: every message type the stream carries, and the latest frames
  of one type.
- **Receiver**: the receiver's configuration (below).
- **Console**: any command, and the receiver's replies.
- **Log**: the relay's own output.

The server reads each relay through an extra output that it adds and hides,
and sends commands back through it. So a receiver on a relay's serial, TCP or
Browser serial input is configured where its data goes out, without stopping
the stream.

## Receiver configuration

The Receiver tab picks the receiver from what it reports about itself (the
Septentrio receiver name, or the u-blox UBX-MON-VER reply). Another model can
be picked by hand.

### Septentrio mosaic-X5 / mosaic-CLAS / mosaic-G5

- **SBF output** works like the SBF Output dialog of RxControl: one column per
  stream in use (port, interval), and a check box per group or block, read
  from the receiver.
- A **preset** (raw observations, CLAS L6D, MADOCA L6E, Galileo HAS E6,
  BeiDou B2b, SouthPAN PVS) checks the blocks that MRTKLIB's quick-start
  guide for that service lists, and adds the signal tracking it needs.
- Change any box, then **Apply** sends only what changed, showing the
  commands first.
- The tab also shows the ports' input and output and the tracked signals, and
  saves the settings to the boot configuration.

### u-blox ZED-F9P / NEO-D9C (generation 9)

- **Message output** works like the message view of u-center: one row per
  message, grouped by class, and one column per port, read with
  UBX-CFG-VALGET.
- A **preset** (raw observations on a ZED-F9P; CLAS L6D, MADOCA L6E or both on
  a NEO-D9C) checks what MRTKLIB reads on the chosen port. By default that is
  the port the stream is connected to, asked with UBX-MON-COMMS.
- **Apply** sends only what changed with UBX-CFG-VALSET (to RAM), and reads it
  back.
- The tab also shows each port's output protocols, the rates and the signals,
  and saves the settings to BBR and flash.
- On a NEO-D9C, each QZSS L6 channel (A, B) is set to a satellite (or
  automatic, or off) and to L6D or L6E, with the Reed-Solomon decoder mode.

## CLAS to RTCM3

CLAS to RTCM3 (`mrtk relay` and `mrtk cssr2rtcm3`) turns the QZSS CLAS
corrections that a receiver tracks into RTCM3, and feeds them back to the same
receiver, which then runs VRS-RTK on its own engine. MRTKLIB supports this
since v0.6.5; the image bundles the pinned version.

- One form sets up the computer, receiver and CLAS chain: Septentrio SBF (with
  the QZSS L6 CLAS frames) → `cssr2rtcm3` → RTCM3 → back to the receiver.
- **Input** as in Multi-Stream: serial (`ttyACM0:115200`) or TCP client
  (`host:port`). On macOS, serve the port from the host, as
  [Serial devices](../getting-started/serial.md#other-options) shows, and
  use TCP Client `host.docker.internal:9001`.
- **Outputs** as in Multi-Stream: the first is the bridge to `cssr2rtcm3`
  (`tcpsvr`, port editable). Add a file to record the raw SBF (restart-safe),
  or a TCP server to hand it to other programs.
- A **Messages** tab shows what the receiver sends through the bridge, with
  separate logs for both child processes. Watch the receiver's position in the
  [Monitor](monitor.md) (input type Streams → `CLAS to RTCM3 · :9870`).
- **Configure the receiver with the pipeline stopped.** While it runs, the
  receiver port takes RTCM3 and ignores commands.
- It ships with a preset for the mosaic-G5. Ask for other receivers with the
  GitHub issue template.
