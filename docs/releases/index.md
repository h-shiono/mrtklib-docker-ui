# Releases

Each release is a git tag and a Docker image with the same version on
[Docker Hub](https://hub.docker.com/r/hatognss/mrtklib-docker-ui) and
[GHCR](https://github.com/h-shiono/mrtklib-docker-ui/pkgs/container/mrtklib-docker-ui).
Minor releases (v0.4.0, v0.5.0, …) are also published as
[GitHub Releases](https://github.com/h-shiono/mrtklib-docker-ui/releases).
A change that needs something from you when you upgrade comes in a minor
release, with an upgrade note.

From v0.5.0 on, every release, patches included, has release notes on this
site. For earlier versions, see the
[Changelog](changelog.md).

## Versions

| Version | Description |
|---|---|
| **v0.1.x-alpha** | Core UI for all `mrtk` subcommands, presets, TOML I/O, Monitor tab |
| **v0.2.x-alpha** | Template presets, GNSS time converter, Monitor sky plot and SNR, IGS / GSI downloader, images on GHCR and Docker Hub |
| **v0.3.0-alpha** | MRTKLIB 0.7.6 config migration, console redesign, CLAS pipeline, RINEX Converter overhaul, unified dark consoles, XYZ-ECEF / NMEA-0183 result views, live basemap map |
| **v0.3.1-alpha** | MRTKLIB 0.7.11, Real-time raw input logging, restart-safe file outputs |
| **v0.3.2-alpha** | Security hardening, non-root container (`PUID:PGID`), Real-time input stream status and live trace, reload-safe Real-time / Stream Server sessions, PR CI |
| **v0.4.0-alpha** | Audit follow-ups: PPP-AR systems / max solution std controls, broader log masking, bounded file previews, NMEA and time-system fixes in the Result Viewer, slimmer image (QC Preview paused), reproducible builds (`uv.lock`) |
| **v0.4.1-alpha** | Bug fixes: Hatanaka (`crx2rnx`) inputs in the image, Real-time log views hold while scrolled up, Post-processing Trace shows the file's end, Data Downloader (Earthdata login, non-blocking GSI, past default dates), Galileo HAS label, CLAS single-port docs |
| **v0.4.2-alpha** | Trace search (Real-time / Post-processing), Hatanaka compress / decompress in Conversion, readable ENU chart axes, sky plot hover details and larger markers, Real-time satellite count matches the solution |
| **v0.4.3-alpha** | Config form fix: a cleared number field keeps its value instead of becoming 0, and re-clicking a dropdown option no longer clears it |
| **v0.4.4-alpha** | MRTKLIB 0.7.17: SouthPAN PVS and BeiDou PPP-B2b correction sources, BeiDou PRN options (BDS-2 / GEO / IGSO), CLAS NMEA source id, Real-time presets for PPP-B2b / Galileo HAS / SouthPAN PVS |
| **v0.4.5-alpha** | Stream Monitor: live decode of a receiver or stream (NMEA, SBF, UBX, solution text) with the Real-time views; Stream Server renamed Stream Relay |
| **v0.4.6-alpha** | Stream Monitor: Result Viewer views (2D / ENU / Map) live, per-band SNR, constellation toggles, file playback; one quality colour table; CLAS L6 source (PRN / facility) marked in the Result Viewer and Stream Monitor |
| **v0.4.7-alpha** | Stream Monitor: two streams with overlaid 2D / ENU / Map, Message tab, Real-time style layout; 2D plot with range rings around the reference; ENU chart options |
| **v0.4.8-alpha** | One design system across the app: colours, type scale, 30 px form rows, shared log view and toolbars; raw streams saved in Stream Relay (restart-safe files, receive-only streams), Stream Monitor reads a running relay; CLAS Pipeline renamed CLAS to RTCM3; Conversion moved into Tools |
| **v0.4.9-alpha** (current) | Receiver configuration on the Streams page (Septentrio mosaic-X5 / CLAS / G5, u-blox ZED-F9P / NEO-D9C): output grids with presets, settings read back, save to boot; Messages / Console tabs per stream; Browser serial input (Web Serial); Stream Relay renamed Streams, Stream Monitor renamed Monitor |
