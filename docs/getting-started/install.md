# Install

The UI runs from a pre-built image, or from an image you build yourself.

## Prerequisites

- Docker. The build-from-source flow also uses `docker compose`, which ships
  with Docker Desktop.
- GNSS data files to process, such as RINEX observation and navigation files.

## Pre-built image

Images are published for `linux/amd64` and `linux/arm64` (Apple Silicon
runs them natively).

1. **Pull the image.**

    ```bash
    # Docker Hub
    docker pull hatognss/mrtklib-docker-ui:0.4.9-alpha

    # or GitHub Container Registry
    docker pull ghcr.io/h-shiono/mrtklib-docker-ui:0.4.9-alpha
    ```

2. **Prepare the host directories.**

    ```bash
    mkdir -p ./workspace ./data
    # Put your GNSS data files under ./data (read-only in the container)
    ```

3. **Run the container.**

    ```bash
    docker run -d --name mrtklib-web-ui \
      -p 127.0.0.1:8080:8000 \
      -v "$(pwd)/workspace:/workspace:rw" \
      -v "$(pwd)/data:/data:ro" \
      -e PUID="$(id -u)" -e PGID="$(id -g)" \
      hatognss/mrtklib-docker-ui:0.4.9-alpha
    ```

4. **Open the UI** at <http://localhost:8080>.

The UI answers on this computer only. To use it from another machine, read
[Security and network access](../deployment/security.md) first.

| Registry | Repository |
|---|---|
| Docker Hub | [`hatognss/mrtklib-docker-ui`](https://hub.docker.com/r/hatognss/mrtklib-docker-ui) |
| GHCR | [`ghcr.io/h-shiono/mrtklib-docker-ui`](https://github.com/h-shiono/mrtklib-docker-ui/pkgs/container/mrtklib-docker-ui) |

Both repositories carry the same multi-arch manifest. Their pages list the
available tags.

## Build from source

Build the image yourself to change the MRTKLIB version, build against a local
MRTKLIB checkout, or work on the UI itself.

1. **Clone the repository.**

    ```bash
    git clone https://github.com/h-shiono/mrtklib-docker-ui.git
    cd mrtklib-docker-ui
    ```

2. **Configure the directories.**

    ```bash
    mkdir -p ./workspace ./data
    cp .env.example .env
    # Edit .env: set DATA_DIR to your GNSS data directory
    ```

3. **Build and run.**

    ```bash
    docker compose up --build
    ```

4. **Open the UI** at <http://localhost:8080>.

The MRTKLIB version the image builds is pinned in `.mrtklib-version`.

## Next

- [Data and volumes](data.md): where inputs and outputs live.
- [Serial devices](serial.md): connect a receiver.
- [Credentials](credentials.md): for the Data Downloader.
