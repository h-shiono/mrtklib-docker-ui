# Monitor

The Monitor decodes a receiver or a stream live, without positioning. It reads
through `mrtk relay`, so it can watch a receiver directly, or the NMEA output
of a running `mrtk run`.

## Inputs

- **Serial, TCP client / server, NTRIP client**, as elsewhere.
- **Browser serial**: the browser opens a USB / serial port on its own
  computer and sends the data to the server, so Docker needs no USB access
  (no `usbipd` on Windows; works on macOS). The port is chosen on Start.
  Closing or reloading the tab, or unplugging the receiver, ends the stream.
  See [Serial devices](../getting-started/serial.md).
- **Streams**: a running stream's `tcpsvr://:PORT` output, picked by relay
  name. To save a stream while watching it, relay it in [Streams](streams.md)
  to a file and to `tcpsvr://:PORT`.
- **File**: a recorded raw SBF / UBX / NMEA log or solution text, replayed all
  at once or paced by its epoch times (real time, 10×, 60×).

The Monitor only reads. Receivers are configured in
[Streams](streams.md#receiver-configuration), where the stream that owns the
receiver port runs.

## Decoded messages

One stream can mix all of these:

| Format | Messages |
|---|---|
| NMEA | GGA, RMC, ZDA, GST, GSA, GSV |
| Septentrio SBF | PVTGeodetic, MeasEpoch, ChannelStatus, SatVisibility |
| u-blox UBX | NAV-PVT, NAV-SAT |
| MRTKLIB | Solution text |

## Views

Arranged side by side as you choose:

- Position and quality.
- The Result Viewer's **2D**, **ENU** and **Map** views, live. Zoom and pan
  stay while epochs arrive.
- **Sky plot** and **SNR** per band (L1 / L2 / L5 / L6), with a toggle per
  constellation.
- The solution list and the relay log.
- **Message** tab: every message type with its count, rate, size and age,
  and the latest frames of the selected type as a hex dump or text.
- **Stream health**: data rate, message counts, undecoded bytes and bad
  frames.

For CLAS, the status footer shows the L6 source of the corrections (the **L6**
toggle beside the station id), read from the NMEA GGA station id.

## Two streams

The Monitor can run two streams at once and overlay them on 2D / ENU / Map
around one reference, to compare two receivers or two solutions. The overlay
is coloured by stream or by quality, and one selector switches the views that
show one stream at a time.

A Monitor session keeps running when the page reloads, and the page attaches
to it again (except Browser serial).
