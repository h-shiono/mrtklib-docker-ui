# Known issues and test status

Many features have been built but not yet tested much in real-world
conditions. This page lists what has been checked, and how. Bug reports are
very welcome on
[GitHub Issues](https://github.com/h-shiono/mrtklib-docker-ui/issues),
including partial or unclear ones.

## Untested or partly tested

- **Real-time positioning** (`mrtk run`): basic operation confirmed. Edge
  cases (stream reconnection, dual-channel CLAS, long runs) not yet
  validated.
- **Monitor**: checked with u-blox F9 (RXM-RAWX + SFRBX + NMEA) and
  Septentrio mosaic-G5 (SBF) streams and files. UBX NAV-PVT / NAV-SAT and
  other receivers not yet tested with real data.
- **Monitor, Browser serial**: checked in Chrome with a simulated port
  replaying a u-blox F9 capture (receive, Stop, unplug, tab closed). With a
  real receiver only the connection (macOS, Chrome, mosaic), not yet the
  decoded messages. Windows and u-blox receivers untested.
- **Receiver configuration**:
    - Septentrio: checked in Chrome against a simulated mosaic-G5 that
      answers the commands (read, preset into a new stream, edits, apply,
      console, save). Not yet against a real receiver.
    - u-blox: checked in Chrome against a simulated ZED-F9P (read, preset,
      apply and read back, save; also one that refuses keys newer than its
      firmware) through Streams Browser serial. With a real ZED-F9P (HPG 1.51)
      and NEO-D9C (QZS 1.01) on USB, through the real `mrtk relay`: the read
      (model, connected port, every message rate) and a CFG-VALSET
      acknowledged. The page itself only against the simulated receiver.
- **Streams, Browser serial**: checked in Chrome with a simulated mosaic-G5
  port and the real `mrtk relay` (messages, receiver read, console, stop, tab
  closed). Not yet with a real receiver.
- **Streams, Messages / Receiver / Console**: the message tap and the command
  path checked with the real `mrtk relay` and a simulated receiver; the page
  in Chrome against a simulated receiver. Not yet with a real receiver on a
  relay's serial port.
- **Monitor, two streams**: two relays checked together through the API. The
  page and the overlay not yet against live streams.
- **CLAS L6 source**: checked with MRTKLIB's handover test output (`mrtk post`
  NMEA). Not yet with a live `mrtk run` NMEA stream.
- **Data Downloader**: QZSS L6D / L6E endpoints implemented. IGS products
  (NASA Earthdata) and GSI CORS (FTP) untested.
- **TOML import round trip**: basic cases work. Complex configurations with
  every option may have edge cases.
- **Configuration option coverage**: the UI covers the options of the
  reference, but default values and conditional logic have not been checked
  one by one. See [Config coverage](config-coverage.md).
- **RINEX preview**: not tested across all receiver formats.
- **CLAS to RTCM3**: uses a single bidirectional serial port. Hardware
  passthrough validated only with the mosaic-G5 preset.

## Platforms

- Tested on Linux (Ubuntu 22.04) and macOS (Apple Silicon).
- Windows (Docker Desktop): untested.
