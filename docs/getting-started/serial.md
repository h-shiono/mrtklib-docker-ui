# Serial devices

Streams, the Monitor and CLAS to RTCM3 can read a receiver on a serial or USB
port. There are two ways to reach one: pass the device into the container, or
let the browser open it (**Browser serial**).

## Pass the device into the container (Linux)

Add the device to `docker-compose.yml`:

```yaml
services:
  mrtklib-web-ui:
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0
    volumes:
      # Optional: mount /dev/serial so the UI can list ports by descriptor
      # name (e.g. "usb-Septentrio_Mosaic-G5_..." instead of "ttyUSB0").
      - /dev/serial:/dev/serial:ro
```

With `docker run`, the same is `--device /dev/ttyUSB0` and
`-v /dev/serial:/dev/serial:ro`.

### CLAS to RTCM3

CLAS to RTCM3 uses **one** bidirectional serial device. The receiver streams
SBF (with the L6 frames) out of the port and takes the generated RTCM3 back on
the same port, so configure that receiver port to do both. Set
`CLAS_INPUT_DEVICE` in `.env` to the port, then uncomment the matching
`devices:` line in `docker-compose.yml`.

## Browser serial (macOS, Windows)

Docker Desktop on macOS runs the container in a hidden VM, so USB serial
devices on the Mac (`/dev/cu.usbmodem*`) are not visible to it. Windows needs
`usbipd` for the same reason.

In Streams or the Monitor, pick the input type **Browser serial**. Chrome or
Edge opens the port on the computer the browser runs on and sends the data to
the server; nothing needs to be installed or attached.

- The page must be on `localhost` or `https`, as Web Serial requires. An SSH
  tunnel keeps it on `localhost`
  (see [Security and network access](../deployment/security.md#a-remote-host-without-opening-a-port)).
- The stream lasts while the tab is open. Closing or reloading the tab, or
  unplugging the receiver, ends it, so it does not suit a long unattended
  `mrtk run` or logging session.
- The browser shows one port picker at a time: start two browser streams one
  after the other.

## Other options

- **Run on the receiver's computer itself**, such as an SBC next to the
  receiver. This is the recommended setup for production CLAS use.
- **Serve the port over TCP from the host**, and pick TCP Client in the UI:

    ```bash
    mrtk relay -in serial://cu.usbmodem…:115200 -b 1 -out tcpsvr://:9001
    ```

    Then use TCP Client `host.docker.internal:9001`. `-b 1` passes what the
    UI sends back to the receiver, so receiver configuration also works.
    `socat`, `ser2net` or USB/IP do the same job.
- **Use a Linux host or VM** with native USB access.
