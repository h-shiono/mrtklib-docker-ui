# Real-time

Real-time runs `mrtk run` (MRTKLIB's rtkrcv) on receiver and correction
streams, and shows the solution live.

## Inputs

There are three inputs: **Rover**, **Base** and **Correction**. Each can be a
serial port, a TCP client or server, an NTRIP client or a file. The footer
shows the state of each stream: receiving, connecting, stalled, no decode, or
an error with a readable cause, such as an unknown NTRIP mountpoint.

For a receiver on a Mac or Windows PC, see
[Serial devices](../getting-started/serial.md). A stream that
[Streams](streams.md) serves on `tcpsvr://:PORT` can be an input too, as a TCP
client of `localhost:PORT`.

## Views

- **Position**: latitude, longitude, height, AR ratio, satellites, age of
  corrections and GPS time, with the fix quality as a coloured badge
  (Fix / Float / Single and the others).
- **2D**: an east / north scatter at a 1:1 scale, coloured by quality.
- **Map**: the solution on a basemap (Leaflet). 2D and Map can be shown alone
  or side by side.
- **Time series** of the position.
- **Sky plot** and **SNR** bars, coloured by constellation, with used and
  unused satellites marked and details on hover.
- **Solution** and **Trace**: the solution text and the debug trace as they
  are written, with search in the Trace (highlight, step through matches, or
  matching lines only). Trace files are in `/workspace/rtlog/rtkrcv/`.

## Raw logging

Each input has a **Raw Log** switch and path. It records the received bytes
before they are decoded, by default in hourly files under
`/workspace/rtlog/%Y/%n/` (for example `rovr_%n%H.sbf::S=1`). Add `::T` to the
path to write a time tag (`.tag`) as well, for replay in real time.

Solution and raw-log files are restart-safe: when a file already exists, the
run writes to `_2`, `_3`, … instead of overwriting it.

## Reloads

A running `mrtk run` keeps running when the page reloads or the tab closes.
The page attaches to it again when it opens.
