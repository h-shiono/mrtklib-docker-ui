"""Stored credentials survive hostile values (#38 item 5)."""

import stat
import tomllib

import pytest

from mrtklib_web_ui.services import credentials
from mrtklib_web_ui.services.private_toml import toml_string


@pytest.fixture
def cred_file(tmp_path, monkeypatch):
    path = tmp_path / ".credentials.toml"
    monkeypatch.setattr(credentials, "CRED_FILE", path)
    monkeypatch.setattr(credentials, "_read_netrc", lambda service: None)
    for env in ("EARTHDATA_USER", "EARTHDATA_PASSWORD", "GSI_USER", "GSI_PASSWORD"):
        monkeypatch.delenv(env, raising=False)
    return path


@pytest.mark.parametrize("value", [
    'pa"ss', "back\\slash", "new\nline", "tab\tcr\r", "nul\x00del\x7f", "ünïcode",
    'x"\n[earthdata]\nusername = "evil"\npassword = "evil',
])
def test_toml_string_round_trips(value):
    assert tomllib.loads(f"v = {toml_string(value)}")["v"] == value


def test_injection_cannot_overwrite_other_service(cred_file):
    credentials.save_credential("earthdata", "alice", "secret")
    credentials.save_credential("gsi", "bob", 'x"\n[earthdata]\nusername = "evil"\npassword = "evil')

    assert credentials.get_credential("earthdata") == ("alice", "secret")
    assert credentials.get_credential("gsi") == ("bob", 'x"\n[earthdata]\nusername = "evil"\npassword = "evil')
    assert stat.S_IMODE(cred_file.stat().st_mode) == 0o600


def test_delete_keeps_other_services(cred_file):
    credentials.save_credential("earthdata", "alice", 'q"\\')
    credentials.save_credential("gsi", "bob", "pw")
    credentials.delete_credential("gsi")

    assert credentials.get_credential("gsi") is None
    assert credentials.get_credential("earthdata") == ("alice", 'q"\\')
