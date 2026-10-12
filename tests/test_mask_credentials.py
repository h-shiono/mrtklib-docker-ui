"""Credential masking for log lines."""

import pytest

from mrtklib_web_ui.services.mask_credentials import mask_log_line


@pytest.mark.parametrize(
    "line, expected",
    [
        # NTRIP / stream paths (previous behaviour)
        ("ntrip://user:pass@rtk2go.com:2101/MOUNT", "ntrip://user:***@rtk2go.com:2101/MOUNT"),
        ("-in ntrip://u:p@h:2101/M -out tcpsvr://:2102", "-in ntrip://u:***@h:2101/M -out tcpsvr://:2102"),
        ("path = \"user:secret@caster:2101/MNT\"", "path = \"user:***@caster:2101/MNT\""),
        # password containing '@' is masked whole
        ("user:p@ss@caster:2101/M", "user:***@caster:2101/M"),
        # ... or '/'
        ("user:pa/ss@caster:2101/MOUNT", "user:***@caster:2101/MOUNT"),
        ("ntrip://user:pa/ss@caster:2101/MOUNT", "ntrip://user:***@caster:2101/MOUNT"),
        # e-mail user names (rtk2go)
        ("ntrip://me@example.com:pass@rtk2go.com:2101/M", "ntrip://me@example.com:***@rtk2go.com:2101/M"),
        ('path = "me@example.com:pa/ss@rtk2go.com:2101/M"', 'path = "me@example.com:***@rtk2go.com:2101/M"'),
        ("-in ntrip://a.b@c.jp:x@y@h:2101/M", "-in ntrip://a.b@c.jp:***@h:2101/M"),
        ("me@example.com:pass@rtk2go.com:2101/M", "me@example.com:***@rtk2go.com:2101/M"),
        ('path = "u:a/b@c@caster:2101/M"', 'path = "u:***@caster:2101/M"'),
        # query-string secrets
        ("GET https://h/x?token=abc123&n=1", "GET https://h/x?token=***&n=1"),
        ("url?api_key=SECRET", "url?api_key=***"),
        ("a?x=1&Password=hunter2 next", "a?x=1&Password=*** next"),
        # assignments (TOML / env dumps)
        ('[CONF] passwd = "admin"', '[CONF] passwd = "***"'),
        ("api_key: 'sk-123'", "api_key: '***'"),
        ("GSI_PASSWORD=hunter2", "GSI_PASSWORD=***"),
        # auth headers
        ("Authorization: Bearer eyJhbGci.x.y", "Authorization: Bearer ***"),
        ("Authorization: Basic dXNlcjpwYXNz", "Authorization: Basic ***"),
        ("sent Bearer abcdefghijklmnop0123", "sent Bearer ***"),
        # untouched
        ("/dev/ttyUSB0:115200", "/dev/ttyUSB0:115200"),
        ("[INFO] Basic Strategy: single", "[INFO] Basic Strategy: single"),
        ("bearer of bad news", "bearer of bad news"),
        ('"max_tokens": 16', '"max_tokens": 16'),
        ("12:34:56.0 Q=1 ns=12", "12:34:56.0 Q=1 ns=12"),
        ("tcpcli://192.168.1.10:2101", "tcpcli://192.168.1.10:2101"),
    ],
)
def test_mask_log_line(line, expected):
    assert mask_log_line(line) == expected
