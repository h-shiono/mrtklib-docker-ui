# Bundled correction files

The image includes correction files from MRTKLIB, so that CLAS PPP-RTK and
MADOCA PPP work without downloading anything first. They are in
`/opt/mrtklib/corrections/` in the container (read-only), and the file
browsers in the UI list them.

## CLAS PPP-RTK

| File | Purpose |
|---|---|
| `clas_grid.def` | CLAS grid definition |
| `clas_grid.blq` | Ocean tide loading coefficients |
| `igu00p01.erp` | Earth rotation parameters |
| `igs14_L5copy.atx` | Satellite / receiver antenna PCV |
| `isb.tbl` | Inter-system bias table |
| `l2csft.tbl` | L2C signal phase correction |

## MADOCA PPP

| File | Purpose |
|---|---|
| `igs20.atx` | IGS antenna model (satellite and receiver PCO / PCV) |

## Using them

In the Files section of the configuration (Real-time and Post-processing), the
**Apply CLAS PPP-RTK profile** and **Apply MADOCA PPP profile** buttons set all
these paths at once. The built-in CLAS and MADOCA presets of Real-time point
at them too.

To use a newer version of a file, put it in your `/data` directory and pick it
in the file browser. [Tools → Downloader](../screens/tools.md#downloader)
fetches the latest `igs20.atx`.
