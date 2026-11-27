# Evaluate a post-processing result

This guide runs `mrtk post` on recorded data and reads the result: how often
it fixed, how it scatters, and how far it is from a known position.

## 1. Run

In **Post-processing**, the section rail starts at **Input Files**:

- **Rover OBS** and **Navigation** are required. **Base OBS** is for the
  relative modes (DGPS, Kinematic, Static).
- **Corrections** take the precise or correction files the method needs
  (CLK, SP3, FCB, IONEX, L6, HAS, B2b, SBS, …). Compressed and Hatanaka files
  can be used as they are.
- **Output** is the solution file.

Set the method in **Positioning**, or import a TOML or load a preset. For a
CLAS or MADOCA run, the profile buttons in **Data Files** set the
[bundled correction files](../reference/corrections.md). To process part of
the data only, set the time range.

Press **Execute**. The **Console** shows the progress; **Stop** ends a run
early and keeps what was written.

## 2. Read the result

When the run ends, the **Chart** sub-tab shows the output file. Its toolbar
switches the views on and off; they can be shown side by side.

- **2D**: east / north around the reference, coloured by quality, with range
  rings showing the distance from the reference.
- **ENU**: east, north and up over time, and the number of satellites.
- **Map**: the track on a basemap.

One badge per quality gives its share of the epochs and their count, for
example `Fix: 97.8% (3521)`. This is the fix rate.

## 3. Choose the reference

The reference is the origin of 2D and ENU. Pick it with **Ref:** above the
views:

| Reference | Use it for |
|---|---|
| **Mean** / **Median** | Precision: the scatter of the solution about itself. |
| **RINEX Header** | A quick check against the approximate position in the rover RINEX header. |
| **Manual (LLH)** / **Manual (XYZ)** | Accuracy: the error against a known position, such as a surveyed point or the published coordinates of a reference station. |

With a known position, the 2D rings read as the horizontal error, and the ENU
plots as the error per axis.

## 4. Statistics

Switch on **Show statistics** for a chip on each ENU plot with the mean and
the standard deviation (σ) of what is shown. Zoom in on a span of time, for
example after convergence, and the statistics follow the zoom; **Reset zoom**
goes back to the whole run.

- **Mean** against a known reference is the bias; **σ** is the precision.
- In PPP, leave out the convergence at the start before you read σ.
- The number of satellites shows mean and minimum.

## 5. Compare and dig deeper

- **Solution** shows the output file as text; **Trace** shows MRTKLIB's trace,
  with search, when the trace is switched on.
- For CLAS PPP-RTK with NMEA output, the ENU plots mark where the L6 source of
  the corrections changes, so a jump can be checked against a QZSS handover.
- To compare two configurations, run them to two output files and change the
  **Output** between them: the viewer follows the file named there. Use the
  same reference for both.

The Result Viewer reads LLH, XYZ-ECEF and NMEA-0183 solution files.
