# Security and deployment

MRTKLIB Web UI is a single-user tool. Its API starts `mrtk` processes, reads
`/data`, writes `/workspace`, and stores NTRIP passwords, download
credentials and an API key there. Anyone who can use the API can do all of
that, so the question on every installation is: **who can reach the port?**

| You want to | Do this |
|---|---|
| Use it on the computer it runs on | Nothing. This is the default. |
| Use a remote host (a server, a Raspberry Pi) from your own computer | [SSH tunnel](#a-remote-host-without-opening-a-port), or a VPN address in `MRTK_BIND` |
| Open it to your local network | [`MRTK_BIND=0.0.0.0` and an access token](#opening-it-to-the-network) |
| Reach it over the internet | [A reverse proxy with HTTPS](#https-with-a-reverse-proxy), and an access token |

## The default: localhost only

`docker compose up` publishes the UI on `127.0.0.1:8080`. It answers on the
computer that runs Docker and nowhere else, and it does not ask for a sign-in.

With `docker run`, the address is part of `-p`. Write it out:

```bash
docker run -d --name mrtklib-web-ui \
  -p 127.0.0.1:8080:8000 \
  ...
```

`-p 8080:8000`, without an address, publishes on every network interface of
the host.

## Opening it to the network

Set both of these in `.env`, then `docker compose up -d`:

```bash
# .env
MRTK_BIND=0.0.0.0
MRTK_AUTH_TOKEN=<output of: openssl rand -hex 32>
```

`MRTK_BIND` is the host address the port is published on. `0.0.0.0` means
every interface. It can also be one address of the host, which is the better
choice when there is one that only you can reach, such as a VPN or Tailscale
address:

```bash
MRTK_BIND=100.101.102.103
```

With `docker run`, the same two settings are `-p 0.0.0.0:8080:8000` and
`-e MRTK_AUTH_TOKEN=...`.

On Linux, Docker publishes ports with its own firewall rules, ahead of `ufw`
and `firewalld`. A `ufw deny 8080` does not close a published port; the
address in `MRTK_BIND` (or `-p`) is what decides.

## The access token

When `MRTK_AUTH_TOKEN` is set, every API and WebSocket route needs it.

- **In the browser** the UI shows a sign-in screen and asks for the token
  once. The browser then keeps a session cookie for 30 days. **Sign out** is
  the button at the right end of the header.
- **In a script** send it as a bearer token:

  ```bash
  curl -H "Authorization: Bearer $MRTK_AUTH_TOKEN" \
    http://localhost:8080/api/mrtk-run/status
  ```

- **To change it**, set a new value and restart the container. Every browser
  is signed out, because the session cookie is derived from the token.

Three things answer without the token: `/api/health`, which the container's
health check calls and which returns only `{"status": "ok"}`; `/api/auth/*`,
the sign-in itself; and the static files of the UI, which hold no data.

Use a long random value. The server does not limit sign-in attempts, so the
length of the token is what keeps guessing out of reach; it warns at startup
when the token is shorter than 16 characters. The startup log also says
whether a token is in use (`Access token: on` / `off`).

The token is one shared secret with full access. It is not a user account:
there are no roles and no per-user data.

## A remote host without opening a port

Leave everything at its default on the remote host and forward the port over
SSH:

```bash
ssh -L 8080:127.0.0.1:8080 user@remote-host
```

Then open <http://localhost:8080> on your own computer. Nothing is published
on the remote host's network, and no token is needed. Because the page is on
`localhost`, the **Browser serial** input (Web Serial) also works, which it
does not on a plain `http://` address of another machine.

## HTTPS with a reverse proxy

Over plain HTTP the token, the session cookie and everything else travel
unencrypted. Outside a network you trust, put a reverse proxy with TLS in
front of the UI and keep the UI itself on localhost.

With [Caddy](https://caddyserver.com/) installed on the host, and a DNS name
that points to it:

```
# /etc/caddy/Caddyfile
gnss.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

```bash
# .env
MRTK_AUTH_TOKEN=<output of: openssl rand -hex 32>
# MRTK_BIND stays at its default, 127.0.0.1
```

Caddy obtains and renews the certificate, forwards WebSockets and tells the
UI that the request arrived over HTTPS. The proxy is then the only way in
from the network, and the UI asks for the token.

Any other proxy works if it does the same three things:

- **Serves the UI at the root of a host name**, not under a sub-path. The UI
  calls `/api/...` and `/ws/...` by absolute path.
- **Forwards WebSocket upgrades.** The live views use `/ws/logs` and
  `/api/.../ws`; without them the page loads but the consoles and charts stay
  empty.
- **Sends `X-Forwarded-Proto: https`**, so that the session cookie is marked
  `Secure`.

A proxy that signs users in itself (oauth2-proxy, Cloudflare Access,
Authelia and the like) can replace the token: leave `MRTK_AUTH_TOKEN` empty
and `MRTK_BIND` at `127.0.0.1`, so that the proxy is the only way in. Its
sign-in has to cover WebSocket handshakes as well, which cookie-based ones
do.

## Threat model

**Assumed.** One person operates the UI and is trusted with everything it
can do. The host and the people with an account on it are trusted too.

**Protected by the defaults.** Other machines cannot reach the UI.

**Protected by a token.** A machine that can reach the port cannot use the
API without the token. Pages of other web sites cannot use the signed-in
session: the cookie is `HttpOnly` and `SameSite=Strict`.

**Not protected.** Know these before relying on it:

- **Without a token, anything on the same computer can use the API.** That
  includes other users and programs, and also web pages open in a browser on
  that computer: the UI does not check which site a request comes from, so a
  page can open its WebSockets and send it simple requests at
  `localhost:8080`. Set a token if this matters to you, also on localhost.
- **No encryption without a proxy.** See
  [HTTPS with a reverse proxy](#https-with-a-reverse-proxy).
- **No sign-in attempt limit.** See [The access token](#the-access-token).
- **More than one user.** There is no isolation between people who share an
  installation. Everyone with the token has the same full access, including
  to the stored credentials.
- **Stored secrets are not encrypted.** NTRIP passwords in presets and
  stream paths, download credentials and the AI key are files under
  `/workspace`, readable by whoever can read that directory on the host.
- **Stream ports are separate.** A TCP Server stream (`tcpsvr://:PORT`)
  listens inside the container without the token. Other machines reach it
  only if you publish that port too; publish it on `127.0.0.1` unless its
  clients are remote.
- **Host networking bypasses all of this.** With `network_mode: host` the UI
  and every stream port listen on all interfaces, and `MRTK_BIND` has no
  effect.

## Upgrading from 0.4.x

v0.5.0 changed the defaults above. [Upgrading to v0.5.0](upgrade.md#the-ui-answers-on-this-computer-only)
says what that means for an existing installation.
