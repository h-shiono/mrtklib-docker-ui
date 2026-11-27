# .pos / NMEA fixtures

Output of `mrtk post` (MRTKLIB 0.7.18 dev build; the solution format is
unchanged since 0.7.17) on MRTKLIB's `tests/data/rtklib/rinex/07590920.05o`
and `07590920.05n`, single point, every 900 s. Used by
`frontend/src/components/viewer/posParser.test.ts`.

| File | Options |
|---|---|
| `llh_gpst_ymd.pos` | `-p 0 -ti 900 -t` |
| `llh_utc_ymd.pos` | `-p 0 -ti 900 -t -u` |
| `llh_gpst_tow.pos` | `-p 0 -ti 900` |
| `xyz_gpst_ymd.pos` | `-p 0 -ti 900 -t -e` |
| `nmea_utc.nmea` | `-p 0 -ti 900 -n` |

All five hold the same four epochs, 2005/04/02 00:00:00 to 00:45:00 GPST.
The UTC files start at 2005/04/01 23:59:47 (GPST - 13 s), so they cross a
UTC midnight.
