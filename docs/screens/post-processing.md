# Post-processing

Post-processing runs `mrtk post` (MRTKLIB's rnx2rtkp) on recorded files, then
opens the result in the Result Viewer.

## Configuration

The section rail covers every MRTKLIB option the UI writes:

- **Input / Output Files**: the rover, base, navigation and correction inputs,
  and the output file.
- **Positioning**: mode, method, PPP / MADOCA, CLAS PPP-RTK / VRS, ambiguity
  resolution, Kalman filter.
- **Station**: antenna.
- **Misc**: output format, input options, data files. (Real-time also has a
  Server section.)

Every positioning mode is available: Single, DGPS, Kinematic, Static,
PPP-Kinematic, PPP-Static, PPP-AR, CLAS PPP-RTK, MADOCA PPP and VRS-RTK. PPP
corrections can come from IGS, IGS-RTS, MADOCA, Galileo HAS, BeiDou PPP-B2b and
SouthPAN PVS.

[Config coverage](../reference/config-coverage.md) lists each TOML key the UI
writes, and whether the form has a control for it.

## Input files

Inputs come from `/data` or `/workspace`. Compressed files (`.gz`, `.Z`, a
single-file `.zip`, `.tar`) and Hatanaka-compressed RINEX (`.crx`, `.??d`, also
`.crx.gz`) can be used as they are: `mrtk` decompresses them, and the image
bundles `crx2rnx`.

The CLAS and MADOCA profile buttons in the Files section set the paths of the
[bundled correction files](../reference/corrections.md) at once.

## Running

**Execute** starts the run, and the Console shows its progress. **Stop** ends a
run that is still going; the solution written so far stays in the output file.
One run goes at a time. A run keeps going when the page reloads, and the page
attaches to it again.

The Trace view shows the end of the trace file, with search.

## Result Viewer

The Result Viewer reads LLH, XYZ-ECEF and NMEA-0183 solution files. It detects
the format itself.

- **Chart**: position (ENU) and quality over time.
- **2D**: the position scatter, with range rings around the reference.
- **Map**: the solution on a basemap (Leaflet).

For CLAS PPP-RTK with NMEA output, the ENU charts mark where the L6 source of
the corrections changes (the L6 PRN and facility, from the station id in the
GGA sentence), as at a QZSS handover. LLH and XYZ `.pos` files do not carry
this.
