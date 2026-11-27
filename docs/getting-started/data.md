# Data and volumes

The container has two volumes.

| Mount | Default on the host | Holds | Access |
|---|---|---|---|
| `/workspace` | `./workspace` | Outputs, presets, logs, stored settings | Read-write |
| `/data` | `./data` | Input GNSS data | Read-only |

With Docker Compose, set the data directory in `.env`:

```bash
# .env
DATA_DIR=/path/to/your/gnss-data
```

The file browsers in the UI show `/workspace`, `/data` and the correction
files bundled in the image (`/opt/mrtklib/corrections`, read-only; see
[Bundled correction files](../reference/corrections.md)). Nothing outside
these is reachable, and the UI writes to `/workspace` only.

## File ownership

The app runs as `PUID:PGID` (default `1000:1000`), not as root, so the files
it writes to `/workspace` belong to that host user. Set them to your own IDs
(`id -u` / `id -g`) in `.env`, or with `-e PUID=... -e PGID=...` on
`docker run`.

On start, files under `/workspace` owned by another user (for example root,
from versions that ran as root) are changed to `PUID:PGID`. `PUID=0` runs as
root, as older versions did.
