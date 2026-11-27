# Tools

Tools holds one-shot jobs, in a sidebar:

| Group | Tool |
|---|---|
| Conversion | [RINEX Converter](#rinex-converter), [Hatanaka (CRX)](#hatanaka-crx) |
| Utilities | [Time Converter](#time-converter) |
| Data | [Downloader](#downloader) |
| AI | [AI Settings](#ai-settings) |

A conversion keeps running, with its log, while another tool is open.

## RINEX Converter

`mrtk convert` (MRTKLIB's convbin) writes RINEX from receiver logs.

- Every convbin input format: u-blox, Septentrio SBF, NovAtel, BINEX, Trimble
  RT17, RTCM 2 / 3, and RINEX itself (to re-process it).
- Collapsible option groups: Time Range, Signal Options, RINEX Header, Debug.
- A preview of the command before it runs.
- A preview of the RINEX file afterwards: the header and the first epochs.

## Hatanaka (CRX)

Compresses RINEX to CRX, or decompresses CRX to RINEX, with optional gzip
(`rnx2crx` / `crx2rnx`, bundled in the image). Inputs come from `/data` or
`/workspace`; outputs go to `/workspace`.

## Time Converter

Converts both ways between calendar date / UTC, GPS week and time of week, and
day of year / session.

## Downloader

Downloads data into `/workspace/downloads/`:

- QZSS L6D (CLAS) and L6E (MADOCA) files.
- The latest IGS antenna file (`igs20.atx`).
- IGS products (needs a NASA Earthdata account) and GSI CORS data (needs a GSI
  account). See [Credentials](../getting-started/credentials.md). These two
  have not been tested yet.

## AI Settings

The Anthropic API key and model for the **Config Assistant**, which writes a
Real-time or Post-processing configuration from a description. The key is
stored in `/workspace/.ai_settings.toml` and sent to `api.anthropic.com` only.
