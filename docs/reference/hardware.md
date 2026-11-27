# Supported hardware and services

This page says what the UI supports for each receiver and correction service,
and how far each has been checked through the UI.

What MRTKLIB itself supports for each service (positioning modes,
constellations, inputs, regression tests) is in MRTKLIB's
[Correction Service Capability Matrix](https://h-shiono.github.io/MRTKLIB/reference/correction-services/).
The tables below cover what the UI adds on top: presets, receiver
configuration, decoding in the Monitor.

**Checked** means:

- **Real** — with a real receiver or real correction data, live or recorded
  from it.
- **Simulated** — with a simulated receiver that answers like the real one.
- **Untested** — built, but not checked yet.

Reports from other receivers and regions are very welcome on
[GitHub Issues](https://github.com/h-shiono/mrtklib-docker-ui/issues).

## Correction services

| Service | Real-time preset | Receiver output preset (Streams) | Checked in Real-time |
|---|---|---|---|
| QZSS CLAS | QZSS CLAS (PPP-RTK) | Septentrio: CLAS L6D. NEO-D9C: L6D | Real |
| QZSS MADOCA-PPP | QZSS MADOCA (PPP-Kinematic) | Septentrio: MADOCA L6E. NEO-D9C: L6E | Real |
| Galileo HAS | Galileo HAS (PPP-Kinematic) | Septentrio: Galileo HAS E6 | Real |
| BeiDou PPP-B2b | BeiDou PPP-B2b (PPP-Kinematic) | Septentrio: BeiDou B2b | Real |
| SouthPAN PVS | SouthPAN PVS (PPP-Kinematic) | Septentrio: SouthPAN PVS | Untested (outside the service area) |
| IGS-RTS | — (NTRIP input, set by hand) | — | Untested |
| NTRIP (RTK, DGPS) | — (set by hand) | — | Untested |

- **Real-time preset**: a built-in Real-time configuration for the service.
  It sets the method and the correction source, and for CLAS and MADOCA the
  [bundled files](corrections.md); the input streams are yours to set.
- **Receiver output preset**: in [Streams → Receiver](../screens/streams.md#receiver-configuration),
  it turns on the messages that MRTKLIB reads for the service, as MRTKLIB's
  quick-start guide for the service lists them.
- Post-processing runs `mrtk post` with every service MRTKLIB supports in
  post-processing, including IGS products; the MRTKLIB matrix lists the input
  files each needs.
- **CLAS to RTCM3** turns CLAS into RTCM3 for a receiver's own RTK engine; see
  the receivers below.

## Receivers

| Receiver | Monitor decode | Receiver configuration (Streams) | CLAS to RTCM3 |
|---|---|---|---|
| Septentrio mosaic-G5 | SBF: Real | Simulated | Real |
| Septentrio mosaic-X5 | SBF: Untested | Untested | No preset |
| Septentrio mosaic-CLAS | SBF: Untested | Untested | No preset |
| u-blox ZED-F9P | UBX RXM-RAWX / SFRBX, NMEA: Real. NAV-PVT / NAV-SAT: Untested | Read and apply: Real (see below) | — |
| u-blox NEO-D9C | — (L6 only) | Read and apply: Real (see below) | — |

- **Monitor decode**: the Monitor decodes NMEA, Septentrio SBF
  (PVTGeodetic, MeasEpoch, ChannelStatus, SatVisibility), u-blox UBX (NAV-PVT,
  NAV-SAT) and MRTKLIB solution text. A receiver the Monitor does not decode
  can still be relayed, saved and passed to `mrtk` in Streams.
- **Receiver configuration** on Septentrio was checked in Chrome against a
  simulated mosaic-G5 that answers the commands: read, preset into a new
  stream, edits, Apply, console, save to boot.
- **Receiver configuration** on u-blox: with a real ZED-F9P (HPG 1.51) and
  NEO-D9C (QZS 1.01) on USB, through the real `mrtk relay`, the read (model,
  connected port, every message rate) and a CFG-VALSET were acknowledged. The
  page itself was checked in Chrome against a simulated ZED-F9P (read, preset,
  apply and read back, save, and a receiver that refuses keys newer than its
  firmware).
- **CLAS to RTCM3** ships with a preset for the mosaic-G5, the only receiver
  it has been used with. It needs one serial port that carries SBF out and
  RTCM3 in.

## Connections

| Connection | Checked |
|---|---|
| Serial passed into the container (Linux) | Real (CLAS to RTCM3 with a mosaic-G5) |
| Browser serial (Web Serial), Monitor | Simulated port replaying a u-blox capture; with a real mosaic on macOS the connection only |
| Browser serial, Streams | Simulated mosaic-G5 port with the real `mrtk relay` |
| Streams Messages / Receiver / Console on a relay's serial port | Simulated receiver with the real `mrtk relay` |
| Monitor, two streams at once | Two relays through the API; the overlay not yet with live streams |

The UI is tested on Linux (Ubuntu 22.04) and macOS (Apple Silicon). Windows
(Docker Desktop) is untested.
