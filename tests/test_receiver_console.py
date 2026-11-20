"""Receiver console: passwords masked in what is kept and shown (#136)."""

import pytest

from mrtklib_web_ui.services.receiver_console import FrameLog, encode_command, mask_receiver_text


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "setNtripSettings, NTR1, Client, caster.example, 2101, user, s3cret, MOUNT, v2, auto",
            "setNtripSettings, NTR1, Client, caster.example, 2101, user, ***, MOUNT, v2, auto",
        ),
        ("snts,NTR1,Client,host,2101,u,p@ss/w,MP", "snts,NTR1,Client,host,2101,u,***,MP"),
        ("$R: efup, myftp.com, /tst.suf, user, password", "$R: efup, myftp.com, /tst.suf, user, ***"),
        ("login, admin, adminpw, RxAdmin, S3pt3ntr10", "login, admin, ***, RxAdmin, ***"),
        ("sual, User1, john, abc123, User", "sual, User1, john, ***, User"),
        ("SETNTRIPCASTERUSERS, User1, u1, p1, MP1, 2", "SETNTRIPCASTERUSERS, User1, u1, ***, MP1, 2"),
        # Fewer arguments than the password's position: nothing to mask.
        ("setNtripSettings, NTR1, off", "setNtripSettings, NTR1, off"),
        ("getNtripSettings", "getNtripSettings"),
        # Other commands keep their arguments; a URL's password is masked.
        ("setSBFOutput, Stream1, USB1, MeasEpoch, sec1", "setSBFOutput, Stream1, USB1, MeasEpoch, sec1"),
        ("setDataInOut, IPS1, ntrip://u:pw@host/MP", "setDataInOut, IPS1, ntrip://u:***@host/MP"),
    ],
)
def test_mask_receiver_text(text, expected):
    assert mask_receiver_text(text) == expected


def test_reply_echo_masked_in_console_and_messages():
    log = FrameLog()
    reply = (
        b"$R: setNtripSettings, NTR1, Client, host, 2101, user, s3cret, MP\r\n"
        b"  NtripSettings, NTR1, Client, host, 2101, user, s3cret, MP, v2, auto\r\n"
        b"USB1>"
    )
    log.decoder.feed(reply)
    entries = log.take_replies()
    assert len(entries) == 1
    assert "s3cret" not in entries[0]["text"]
    assert entries[0]["text"].count("***") == 2
    rows = [r for t in log.messages._types.values() for r in t.rows.values()]
    assert rows and all(b"s3cret" not in r.frame.data for r in rows)


def test_sent_command_masked_but_bytes_unchanged():
    data, shown = encode_command("snts, NTR1, Client, host, 2101, user, s3cret, MP", None)
    assert b"s3cret" in data  # the receiver gets the password
    entry = FrameLog().sent(shown)
    assert "s3cret" not in entry["text"]
