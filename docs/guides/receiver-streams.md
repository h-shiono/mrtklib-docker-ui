# Configure a receiver and serve its stream

This guide connects a receiver in **Streams**, sets its output for a
positioning task, saves the raw data, and serves the stream to Real-time and
the Monitor at the same time.

It works with the receivers the UI configures: Septentrio mosaic-X5 /
mosaic-CLAS / mosaic-G5 and u-blox ZED-F9P / NEO-D9C. What has been checked on
each is in [Supported hardware and services](../reference/hardware.md).

## 1. Connect the receiver

In **Streams**, press **Add Stream**, and set its **Input**:

- **Serial**, for a receiver passed into the container, such as
  `ttyACM0:115200`.
- **TCP Client**, for a receiver on the network, or a port that the host
  serves (on macOS, see [Serial devices](../getting-started/serial.md#other-options)).
- **Browser serial**, for a receiver on the computer the browser runs on
  (Chrome or Edge). The port is picked when the stream starts, and the stream
  stops when the tab closes.

Leave the outputs empty for now and start the stream. With no outputs the
relay only receives: the **Messages** tab shows what the receiver sends, which
tells you that the input works.

## 2. Read the receiver

Open the **Receiver** tab. The UI asks the receiver what it is and reads its
current settings. If it reports another model than the one selected, a line
under **Receiver** offers to switch.

The tab has two parts:

- **SBF output** (Septentrio) or **Message output** (u-blox): what the
  receiver sends, per port. One column per stream (Septentrio) or per port
  (u-blox), one row per message group or message.
- **Ports & tracking** (Septentrio) or **Ports & signals** (u-blox): the
  ports' input and output and the tracked signals.

## 3. Pick a preset and apply

Choose a **Preset** for the task:

| Task | Septentrio | u-blox |
|---|---|---|
| Observations for RTK or post-processing | Raw observations | Raw observations (ZED-F9P) |
| QZSS CLAS | CLAS L6D | CLAS L6D (NEO-D9C) |
| QZSS MADOCA-PPP | MADOCA L6E | MADOCA L6E (NEO-D9C) |
| Galileo HAS | Galileo HAS E6 | — |
| BeiDou PPP-B2b | BeiDou B2b | — |
| SouthPAN PVS | SouthPAN PVS | — |

The preset checks the messages that MRTKLIB reads for the task and, on
Septentrio, adds the signal tracking it needs. On u-blox it applies to the port
the stream is connected to, unless you pick another one. On Septentrio, **Load
into** puts it in a stream column of its own.

Change any box if you need to. **Apply** shows the commands, then sends only
what changed. u-blox settings go to RAM and are read back.

On a NEO-D9C, also set each L6 channel (A, B) to a QZSS satellite, or
automatic, and to L6D or L6E.

The **Console** tab takes any command and shows the receiver's replies.

## 4. Save to boot

**Save to boot** makes the current settings the receiver's boot settings
(Septentrio: the boot configuration; u-blox: BBR and flash), so that they
survive a power cycle.

## 5. Save the raw data and serve the stream

Stop the stream, then add outputs:

- **File**, for the raw data, with a path such as
  `/workspace/rover_%Y%m%d%h.sbf::S=1` for hourly files. Add `::T` for a
  time tag, so the file can be replayed in real time. An existing file is
  never overwritten: the relay writes to `_2`, `_3`, … instead.
- **TCP Server**, with a path such as `:9001`, to hand the stream to other
  programs.

Start the stream again. The receiver stays configurable while it runs: the
**Receiver** and **Console** tabs talk to it through the same connection.

## 6. Use the stream elsewhere

With the TCP Server output running:

- **Real-time**: set **Rover** to TCP Client `localhost:9001`, with the
  receiver's format. See
  [Real-time with open correction services](realtime-services.md).
- **Monitor**: pick the input type **Streams** and the stream by its name, to
  watch the receiver's own position, sky plot and SNR.

The raw file keeps growing while both run, and can be post-processed later.

## When something does not work

- **The Receiver tab says to start the stream first.** It talks to the
  receiver through the running relay.
- **Nothing arrives in Messages.** Check the port and the baud rate; on
  Septentrio, check the port settings in **Ports & tracking**.
- **Apply is refused.** The **Console** shows the receiver's reply. A u-blox
  receiver refuses keys its firmware does not know.
- **CLAS to RTCM3** runs its own relay. Configure the receiver in Streams with
  CLAS to RTCM3 stopped; while it runs, the receiver port takes RTCM3 and
  ignores commands.
