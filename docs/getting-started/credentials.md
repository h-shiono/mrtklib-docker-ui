# Credentials

The Data Downloader (in **Tools**) needs an account for two of its sources:

| Source | Account |
|---|---|
| IGS products | NASA Earthdata |
| GSI CORS data | GSI (FTP) |
| QZSS L6D / L6E, IGS antenna file | None |

It looks for credentials in three places, and the first one found wins:

1. **A `.netrc` file** mounted at `/home/mrtk/.netrc` (see
   `docker-compose.yml`). An existing `/root/.netrc` mount is copied there on
   start.
2. **Environment variables**, for example in `.env`:

    ```bash
    # .env
    EARTHDATA_USER=your_username    # NASA Earthdata (IGS products)
    EARTHDATA_PASSWORD=your_password
    GSI_USER=your_username          # GSI CORS FTP
    GSI_PASSWORD=your_password
    ```

3. **The UI**: credentials entered in the Data Downloader are stored in
   `/workspace/.credentials.toml`.

Stored credentials are not encrypted. Whoever can read `/workspace` on the
host can read them; see the
[threat model](../deployment/security.md#threat-model).
