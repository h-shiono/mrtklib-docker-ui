# Real-time with open correction services

This guide runs real-time PPP or PPP-RTK on corrections that satellites or
the internet broadcast for free: QZSS CLAS, QZSS MADOCA-PPP, Galileo HAS,
BeiDou PPP-B2b, SouthPAN PVS and IGS-RTS. The steps are the same for every
service; what differs is the receiver output and the input streams, in the
[tabs below](#service-by-service).

You need:

- A receiver that tracks the service's signal and outputs its messages, on
  a serial port or the network. Which receivers the UI can configure, and what
  has been checked, is in
  [Supported hardware and services](../reference/hardware.md).
- To be inside the service's coverage area. MRTKLIB's
  [Correction Service Capability Matrix](https://h-shiono.github.io/MRTKLIB/reference/correction-services/)
  lists the areas, modes and constellations.

## 1. Make the receiver output what MRTKLIB reads

Open **Streams**, add a stream with the receiver as its input, and start it
with no outputs. In its **Receiver** tab, pick the receiver output preset for
the service, check the boxes it turned on, and **Apply**. **Save to boot**
keeps the settings over a power cycle.
[Configure a receiver and serve its stream](receiver-streams.md) walks through
this.

If the receiver is already set up, skip this step.

## 2. Load the preset

In **Real-time**, open **Presets** (in the Config toolbar) and load the
built-in preset for the service. It sets the positioning mode, the
**Correction** source and the options MRTKLIB's quick start for the service
uses; for CLAS and MADOCA it also points at the
[bundled correction files](../reference/corrections.md).

A preset does not change the input streams.

## 3. Set the input streams

In the **I/O Streams** section, set **Rover** (and **Correction**, if the
service needs one) as the tab for your service says:

- **Type**: Serial, TCP Client, TCP Server, NTRIP Client or File.
- **Path**: for example `ttyUSB0:115200` (serial), `192.168.1.100:2101`
  (TCP client), or `localhost:PORT` for a stream that
  [Streams](../screens/streams.md) serves on `tcpsvr://:PORT`.
- **Format**: the receiver's format, such as Septentrio SBF or u-blox.

A serial port can be open in only one program at a time. If Streams is still
reading the receiver, either stop that stream, or add a `tcpsvr://:PORT` output to it and point
the Rover at `localhost:PORT`, so that Streams keeps saving the raw data while
Real-time runs. On macOS and Windows see
[Serial devices](../getting-started/serial.md).

## 4. Start and watch it converge

Press **Start**. Then check, in this order:

1. **The footer** shows each input as *receiving*. *No decode* means bytes
   arrive but the format is wrong; an error names the cause.
2. **Satellites** rise and the quality badge leaves *Single*. PPP converges
   to *PPP* (float), PPP-AR and CLAS PPP-RTK to *Fix*. PPP-RTK typically
   converges much faster than float PPP, which can take tens of minutes.
3. **2D**, **Map** and the time series settle. The sky plot and SNR bars show
   which satellites are used.

When something does not converge, the **Trace** sub-tab shows MRTKLIB's debug
trace, with search.

The configuration is read-only while the run goes. **Stop** before you change
it.

## 5. Keep the results

- **Solution**: add an **Output Stream** of type File in **I/O Streams**.
- **Raw data**: switch on **Raw Log** for an input to record its bytes, with
  `::T` for a time tag, so the session can be replayed or post-processed
  later. See [Real-time](../screens/real-time.md#raw-logging).

## Service by service

=== "QZSS CLAS"

    PPP-RTK for Japan, from the QZSS L6D signal.

    - **Preset**: QZSS CLAS (PPP-RTK).
    - **Receiver**: a u-blox ZED-F9P for the observations and a NEO-D9C for
      L6. Receiver output presets: *raw observations* on the ZED-F9P, *CLAS
      L6D* on the NEO-D9C.
    - **Rover**: the ZED-F9P, format **u-blox**.
    - **Correction**: the NEO-D9C, format **u-blox** (UBX-RXM-QZSSL6). A raw
      L6 stream uses format **CLAS L6**.
    - Checked through the UI with real data.

    MRTKLIB: [Quick Start: CLAS PPP-RTK](https://h-shiono.github.io/MRTKLIB/guide/quickstart-clas/),
    [Real-Time CLAS](https://h-shiono.github.io/MRTKLIB/reference/rtkrcv-clas-realtime/).
    To have the receiver itself run VRS-RTK on CLAS instead, see
    [CLAS to RTCM3](../screens/streams.md#clas-to-rtcm3).

=== "QZSS MADOCA-PPP"

    PPP and PPP-AR for Asia–Oceania, from the QZSS L6E signal.

    - **Preset**: QZSS MADOCA (PPP-Kinematic).
    - **Septentrio**: one SBF stream carries observations, ephemeris and the
      L6E corrections. Receiver output preset: *MADOCA L6E*. **Rover**:
      format **Septentrio SBF**. **Correction**: off.
    - **u-blox**: a ZED-F9P for the observations and a NEO-D9C for L6E
      (receiver output preset *MADOCA L6E*). **Rover**: the ZED-F9P, format
      **u-blox**. **Correction**: the NEO-D9C, format **u-blox**.
    - Checked through the UI with real data.

    MRTKLIB: [Quick Start: MADOCA-PPP](https://h-shiono.github.io/MRTKLIB/guide/quickstart-madoca-ppp/).

=== "Galileo HAS"

    Global float PPP, from the Galileo E6-B signal.

    - **Preset**: Galileo HAS (PPP-Kinematic).
    - **Receiver**: Septentrio, with the receiver output preset *Galileo HAS
      E6*. One SBF stream carries observations, ephemeris and the HAS pages
      (GALRawCNAV).
    - **Rover**: format **Septentrio SBF**. **Correction**: off.
    - Checked through the UI with real data.

    MRTKLIB: [Quick Start: Galileo HAS PPP](https://h-shiono.github.io/MRTKLIB/guide/quickstart-gal-has/).

=== "BeiDou PPP-B2b"

    Float PPP for China and the Asia-Pacific region, from the B2b signal of
    the BeiDou-3 GEO satellites.

    - **Preset**: BeiDou PPP-B2b (PPP-Kinematic).
    - **Receiver**: Septentrio with B2b tracking, with the receiver output
      preset *BeiDou B2b*. The GEOs (C01–C04) must be tracked; the
      Monitor's sky plot shows them.
    - **Rover**: format **Septentrio SBF**. **Correction**: off.
    - Checked through the UI with real data.

    MRTKLIB: [Quick Start: BeiDou PPP-B2b](https://h-shiono.github.io/MRTKLIB/guide/quickstart-bds-b2b/),
    [BeiDou PRN reassignment](https://h-shiono.github.io/MRTKLIB/guide/beidou-prn-reassignment/).

=== "SouthPAN PVS"

    Float PPP for Australia and New Zealand, from the L5 signal of SBAS
    PRN 122.

    - **Preset**: SouthPAN PVS (PPP-Kinematic).
    - **Receiver**: Septentrio tracking GEO L5, with the receiver output
      preset *SouthPAN PVS*.
    - **Rover**: format **Septentrio SBF**. **Correction**: off.
    - **Not yet checked through the UI**: it has not been run inside the
      service area.

    MRTKLIB: [Quick Start: SouthPAN PVS](https://h-shiono.github.io/MRTKLIB/guide/quickstart-southpan-pvs/).

=== "IGS-RTS"

    Global float PPP, from an RTCM-SSR stream over NTRIP.

    - **Preset**: none. Start from your own configuration and set
      **Correction** to *IGS-RTS (RTCM-SSR)* in the Mode section; the MRTKLIB
      quick start lists the other options.
    - **Rover**: your receiver. It must also deliver broadcast ephemeris; if
      it does not, a broadcast ephemeris stream is needed as well.
    - **Correction**: **NTRIP Client**, format **RTCM3**, with an SSR
      mountpoint such as `SSRA02IGS0`.
    - Casters that serve NTRIP over TLS only (CDDIS, port 443) need a TLS
      tunnel such as stunnel outside the container; MRTKLIB has no TLS.
    - **Not yet checked through the UI.**

    MRTKLIB: [Quick Start: IGS-RTS PPP](https://h-shiono.github.io/MRTKLIB/guide/quickstart-igs-rts/),
    [NTRIP Streams](https://h-shiono.github.io/MRTKLIB/guide/ntrip/).
