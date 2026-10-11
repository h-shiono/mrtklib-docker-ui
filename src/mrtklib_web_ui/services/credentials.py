"""Credential management for data download services."""

import os
from pathlib import Path

from mrtklib_web_ui.services.private_toml import dumps_tables, write_private_toml

CRED_FILE = Path("/workspace/.credentials.toml")


def _netrc_path() -> Path:
    """The running user's .netrc (the container no longer runs as root)."""
    return Path.home() / ".netrc"

NETRC_HOSTS = {
    "earthdata": "urs.earthdata.nasa.gov",
    "gsi": "terras.gsi.go.jp",
}

ENV_MAP = {
    "earthdata": ("EARTHDATA_USER", "EARTHDATA_PASSWORD"),
    "gsi": ("GSI_USER", "GSI_PASSWORD"),
}


def get_credential(service: str) -> tuple[str, str] | None:
    """Get credentials for a service. Priority: .netrc > env > stored."""
    # 1. Check .netrc
    netrc_cred = _read_netrc(service)
    if netrc_cred:
        return netrc_cred

    # 2. Check env vars
    if service in ENV_MAP:
        u = os.getenv(ENV_MAP[service][0])
        p = os.getenv(ENV_MAP[service][1])
        if u and p:
            return (u, p)

    # 3. Check stored credentials
    if CRED_FILE.exists():
        import tomllib
        try:
            with open(CRED_FILE, "rb") as f:
                stored = tomllib.load(f)
            svc = stored.get(service, {})
            if svc.get("username") and svc.get("password"):
                return (svc["username"], svc["password"])
        except Exception:
            pass

    return None


def get_credential_source(service: str) -> str | None:
    """Get the source of credentials without returning actual values."""
    if _read_netrc(service):
        return "netrc"
    if service in ENV_MAP:
        u = os.getenv(ENV_MAP[service][0])
        p = os.getenv(ENV_MAP[service][1])
        if u and p:
            return "env"
    if CRED_FILE.exists():
        import tomllib
        try:
            with open(CRED_FILE, "rb") as f:
                stored = tomllib.load(f)
            svc = stored.get(service, {})
            if svc.get("username") and svc.get("password"):
                return "stored"
        except Exception:
            pass
    return None


def save_credential(service: str, username: str, password: str) -> None:
    """Save credentials to /workspace/.credentials.toml."""
    existing: dict = {}
    if CRED_FILE.exists():
        import tomllib
        try:
            with open(CRED_FILE, "rb") as f:
                existing = tomllib.load(f)
        except Exception:
            pass

    existing[service] = {"username": username, "password": password}
    _write_cred_file(existing)


def delete_credential(service: str) -> None:
    """Remove credentials for a service."""
    if not CRED_FILE.exists():
        return
    import tomllib
    try:
        with open(CRED_FILE, "rb") as f:
            existing = tomllib.load(f)
    except Exception:
        return
    existing.pop(service, None)
    _write_cred_file(existing)


def _write_cred_file(existing: dict) -> None:
    """Rewrite the credentials file with every value properly escaped."""
    tables = {
        svc: {"username": str(v.get("username", "")), "password": str(v.get("password", ""))}
        for svc, v in existing.items()
        if isinstance(v, dict)
    }
    write_private_toml(CRED_FILE, dumps_tables(tables))


def setup_netrc_from_env() -> None:
    """Generate ~/.netrc entries from environment variables."""
    entries = []
    for service, (env_u, env_p) in ENV_MAP.items():
        u = os.getenv(env_u)
        p = os.getenv(env_p)
        host = NETRC_HOSTS.get(service)
        if u and p and host:
            entries.append(f"machine {host} login {u} password {p}")

    if entries:
        netrc_path = _netrc_path()
        if not netrc_path.exists() or netrc_path.stat().st_size == 0:
            netrc_path.write_text("\n".join(entries) + "\n")
            netrc_path.chmod(0o600)


def _read_netrc(service: str) -> tuple[str, str] | None:
    host = NETRC_HOSTS.get(service)
    if not host:
        return None
    netrc_path = _netrc_path()
    if not netrc_path.exists():
        return None
    try:
        import netrc as netrc_lib
        n = netrc_lib.netrc(str(netrc_path))
        auth = n.authenticators(host)
        if auth:
            return (auth[0], auth[2])
    except Exception:
        pass
    return None
