"""Framer: mixed NMEA / UBX / SBF / RTCM3 / text streams (#96)."""

import struct

from mrtklib_web_ui.services.stream_decoders.framer import MAX_FRAME, Framer
from stream_builders import nmea, rtcm3, sbf, sbf_tow, ubx

GGA = nmea("GNGGA,121911.00,3500.00000,N,13900.00000,E,1,12,0.50,20.9,M,39.4,M,,")


def _frames(data: bytes, chunk: int | None = None):
    f = Framer()
    out = []
    step = chunk or len(data) or 1
    for i in range(0, len(data), step):
        out += f.feed(data[i : i + step])
    return f, out


def _mixed() -> bytes:
    return (
        GGA
        + ubx(0x02, 0x15, bytes(range(40)))
        + sbf(4007, sbf_tow(1000, 2400) + b"\x00" * 90)
        + rtcm3(1077)
        + b"2026/11/07 12:19:11.000   35.000000000  139.000000000    60.3000   5  12\n"
        + nmea("GPGSV,1,1,01,01,79,004,47,1")
    )


def test_mixed_stream_splits_into_every_kind():
    f, frames = _frames(_mixed())
    assert [(fr.kind, fr.label) for fr in frames] == [
        ("nmea", "GNGGA"),
        ("ubx", "UBX RXM-RAWX"),
        ("sbf", "SBF 4007 PVTGeodetic"),
        ("rtcm3", "RTCM3 1077"),
        ("text", "text"),
        ("nmea", "GPGSV"),
    ]
    assert f.unknown_bytes == 0 and f.bad_frames == 0


def test_byte_by_byte_feed_gives_the_same_frames():
    _, whole = _frames(_mixed())
    f, single = _frames(_mixed(), chunk=1)
    assert [fr.data for fr in single] == [fr.data for fr in whole]
    assert f.unknown_bytes == 0


def test_nmea_line_without_cr_and_split_crlf():
    _, frames = _frames(nmea("GNRMC,1,A", eol=b"\n") + nmea("GNRMC,2,A"), chunk=5)
    assert [fr.data for fr in frames] == [nmea("GNRMC,1,A", eol=b""), nmea("GNRMC,2,A", eol=b"")]


def test_bad_checksums_are_rejected_and_counted():
    good = ubx(0x01, 0x07, b"\x00" * 92)
    broken_ubx = good[:-1] + bytes([good[-1] ^ 0xFF])
    block = sbf(4027, sbf_tow(0, 1) + b"\x00" * 20)
    broken_sbf = block[:2] + bytes([block[2] ^ 0xFF]) + block[3:]
    star = GGA.rindex(b"*")
    wrong = f"{int(GGA[star + 1 : star + 3], 16) ^ 0x01:02X}".encode()
    broken_nmea = GGA[: star + 1] + wrong + b"\r\n"
    f, frames = _frames(broken_ubx + broken_sbf + broken_nmea + GGA)
    assert [fr.label for fr in frames] == ["GNGGA"]
    assert f.bad_frames >= 3


def test_bad_nmea_line_is_not_rescanned_as_solution_rows():
    line = b"$GNGGA,121911.00,3500.00000,N,13900.00000,E,1,12*00\r\n"
    _, frames = _frames(line)
    assert frames == []  # its digits must not come back as "text" rows


def test_dollar_inside_a_line_starts_the_next_sentence():
    _, frames = _frames(b"2026/11/07 garbage" + GGA)
    assert [fr.kind for fr in frames] == ["text", "nmea"]


def test_noise_between_frames_is_skipped():
    noise = bytes([0x00, 0xFF, 0x13, 0x80, 0xB5, 0x00, 0xD3, 0xFF])
    f, frames = _frames(noise + GGA + noise + rtcm3(1005))
    assert [fr.label for fr in frames] == ["GNGGA", "RTCM3 1005"]
    assert f.unknown_bytes == 2 * len(noise)


def test_oversized_length_is_a_false_sync_not_a_stall():
    # UBX sync with a declared length above MAX_FRAME, then a real sentence.
    fake = b"\xb5\x62\x02\x15" + struct.pack("<H", MAX_FRAME)
    _, frames = _frames(fake + GGA)
    assert [fr.label for fr in frames] == ["GNGGA"]


def test_incomplete_frame_waits_for_more_data():
    block = sbf(4013, sbf_tow(0, 1) + b"\x00" * 30)
    f = Framer()
    assert f.feed(block[:-5]) == []
    assert [fr.label for fr in f.feed(block[-5:])] == ["SBF 4013 ChannelStatus"]


def test_flush_ends_the_last_line():
    f = Framer()
    assert f.feed(GGA[:-2] + b"\r") == []  # lone CR: waits for a possible LF
    assert [fr.label for fr in f.flush()] == ["GNGGA"]
    f.feed(b"2026/11/07 12:19:11.000 35.0 139.0 60.3 5 12")  # row without LF
    assert [fr.kind for fr in f.flush()] == ["text"]
    assert f.unknown_bytes == 0


def test_flush_drops_an_incomplete_binary_frame():
    f = Framer()
    block = sbf(4013, sbf_tow(0, 1) + b"\x00" * 30)
    assert f.feed(block[:-4]) == []
    assert f.flush() == [] and f.unknown_bytes == len(block) - 4


# ── Septentrio ASCII replies (#136) ─────────────────────────────────────────

ACK = b"$R: setNMEAOutput, stream1, com1, GGA, sec1\r\n  NMEAOutput, Stream1, COM1, GGA, sec1\r\nCOM1>"


def _reply_frames(data: bytes, step: int = 0):
    f = Framer()
    out = []
    if step:
        for i in range(0, len(data), step):
            out += f.feed(data[i : i + step])
    else:
        out = f.feed(data)
    return f, out + f.flush()


def test_septentrio_replies_run_to_their_prompt():
    data = (
        ACK
        + b"$R? setFoo: Invalid command!\r\nUSB1>"
        + b"$R; lstConfigFile, Current\r\n---->"
        + b"$-- BLOCK 1 / 1\r\nsetSBFOutput, Stream1, USB1, Support, sec1\r\nIP10>"
        + b"$TE ResetReceiver\r\nSTOP>"
    )
    for step in (0, 1, 7):
        f, frames = _reply_frames(data, step)
        assert [(x.kind, x.label) for x in frames] == [
            ("reply", "Septentrio reply"),
            ("reply", "Septentrio error"),
            ("reply", "Septentrio reply"),
            ("reply", "Septentrio block"),
            ("reply", "Septentrio $TE"),
        ]
        assert frames[0].data == ACK and f.unknown_bytes == 0 and f.bad_frames == 0


def test_reply_between_binary_frames():
    block = sbf(4007, sbf_tow(1000, 2409) + bytes(80))
    f, frames = _reply_frames(block + ACK + nmea("GNGGA,1") + block, step=5)
    assert [x.kind for x in frames] == ["sbf", "reply", "nmea", "sbf"]


def test_reply_bytes_inside_an_sbf_block_stay_in_the_block():
    block = sbf(4007, sbf_tow(1000, 2409) + b"$R: x\r\nUSB1>" + bytes(68))
    f, frames = _reply_frames(block)
    assert [x.kind for x in frames] == ["sbf"]


def test_binary_inside_a_would_be_reply_rejects_it():
    f, frames = _reply_frames(b"$R: abc\x00\xff\r\nUSB1>" + nmea("GNGGA,1"))
    assert [x.kind for x in frames] == ["text", "nmea"]  # the prompt line is text
    assert f.unknown_bytes > 0


def test_a_false_reply_does_not_hold_back_the_next_sentence():
    f = Framer()
    frames = f.feed(b"$R: not a reply\r\n" + nmea("GNGGA,1"))
    assert [x.kind for x in frames if x.kind == "nmea"] == ["nmea"]


def test_reply_waits_for_its_prompt_and_is_dropped_at_eof():
    f = Framer()
    assert f.feed(b"$R: setFoo\r\n  Foo, 1\r\n") == []
    assert all(x.kind != "reply" for x in f.flush())  # no prompt: never a reply

