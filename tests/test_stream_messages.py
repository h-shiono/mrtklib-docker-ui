"""Message tab data (#136): keys, summaries and the bounded per-type log."""

import struct

import pytest

from mrtklib_web_ui.services.stream_decoders import StreamDecoder
from mrtklib_web_ui.services.stream_decoders.framer import Frame, Framer
from mrtklib_web_ui.services.stream_decoders.messages import (
    MAX_LABELS,
    MAX_ROWS_KEYED,
    MAX_ROWS_LATEST,
    MAX_TYPE_BYTES,
    OTHER,
    RATE_WINDOW_S,
    MessageLog,
    frame_key,
    preview,
    summary,
)
from stream_builders import nmea, rtcm3, sbf, sbf_tow, ubx


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _frame(raw: bytes) -> Frame:
    frames = Framer().feed(raw)
    assert len(frames) == 1
    return frames[0]


def _sbf_raw(block: int, svid: int, status: int, corrected: int = 0, words: int = 10) -> Frame:
    body = sbf_tow(543570000, 2409) + bytes((svid, status, corrected, 1, 0, 3))
    return _frame(sbf(block, body + b"".join(struct.pack("<I", 0x11110000 + i) for i in range(words))))


def _sfrbx(gnss: int, sv: int, sig: int = 0, freq: int = 0, chn: int = 5) -> Frame:
    words = [0x22C3593F, 0x195B0B73]
    head = struct.pack("<BBBBBBBB", gnss, sv, sig, freq, len(words), chn, 2, 0)
    return _frame(ubx(0x02, 0x13, head + struct.pack(f"<{len(words)}I", *words)))


def _qzssl6(sv: int, l6e: bool, err: int = 1, ch_b: bool = False) -> Frame:
    info = (int(l6e) << 10) | (err << 12) | (int(ch_b) << 14)
    head = struct.pack("<BBHIBBH", 1, sv, 41 * 256, 0, 0, 3, info) + b"\0\0"
    return _frame(ubx(0x02, 0x73, head + bytes([0x1A, 0xCF, 0xFC, 0x1D]) + bytes(246)))


# ── keys ────────────────────────────────────────────────────────────────────


def test_sbf_raw_nav_key_uses_the_satellite_numbering():
    assert frame_key(_sbf_raw(4017, 17, 1)) == "G17"
    assert frame_key(_sbf_raw(4023, 88, 1, words=8)) == "E18"
    assert frame_key(_sbf_raw(4270, 182, 1, words=63)) == "J02"


def test_sbf_block_without_a_satellite_has_no_key():
    assert frame_key(_frame(sbf(4007, sbf_tow(1000, 2409) + bytes(80)))) is None


@pytest.mark.parametrize(
    "frame_args, expected",
    [
        ((0, 7, 0), "G07 L1CA"),
        ((2, 12, 1), "E12 E1B"),
        ((5, 2, 0), "J02 L1CA"),
        ((1, 137, 0), "S37 L1CA"),
        ((0, 7, 99), "G07 sig99"),
    ],
)
def test_sfrbx_key_has_satellite_and_signal(frame_args, expected):
    assert frame_key(_sfrbx(*frame_args)) == expected


def test_sfrbx_glonass_with_unknown_slot_is_keyed_by_frequency():
    assert frame_key(_sfrbx(6, 255, 0, 2)) == "R?? k-5 L1OF"


def test_qzssl6_key_separates_l6d_and_l6e():
    assert frame_key(_qzssl6(2, False)) == "J02 L6D"
    assert frame_key(_qzssl6(2, True)) == "J02 L6E"


# ── summaries and previews ──────────────────────────────────────────────────


def test_sbf_summary_reports_crc():
    assert summary(_sbf_raw(4017, 17, 1)) == "TOW 543570.000  WNc 2409  CRC ok"
    assert summary(_sbf_raw(4017, 17, 0)).endswith("CRC failed")


def test_sbf_l6_summary_reports_reed_solomon():
    assert summary(_sbf_raw(4270, 182, 1, 4, words=63)).endswith("RS ok, 4 corrected")
    assert summary(_sbf_raw(4270, 182, 0, 0, words=63)).endswith("RS failed")


def test_sbf_do_not_use_time():
    f = _frame(sbf(4007, struct.pack("<IH", 0xFFFFFFFF, 0xFFFF) + bytes(80)))
    assert summary(f) == "TOW —  WNc —"


def test_sbf_raw_preview_is_words():
    assert preview(_sbf_raw(4017, 17, 1)).startswith("11110000 11110001")


def test_sfrbx_summary_and_preview():
    assert summary(_sfrbx(0, 7)) == "words 2  ch 5"
    assert summary(_sfrbx(6, 255, 0, 2)) == "words 2  ch 5  k-5"
    assert preview(_sfrbx(0, 7)) == "22C3593F 195B0B73"


def test_qzssl6_summary_and_preview_start_at_the_message():
    f = _qzssl6(2, False)
    assert summary(f) == "C/N0 41.0  RS corrected 3  error-free  ch A"
    assert preview(f).startswith("1ACFFC1D")


def test_rawx_summary():
    f = _frame(ubx(0x02, 0x15, struct.pack("<dHbBBB", 562769.028, 2443, 18, 65, 0, 1) + bytes(6)))
    assert summary(f) == "TOW 562769.028  week 2443  numMeas 65"


def test_nav_pvt_summary():
    p = bytearray(92)
    struct.pack_into("<I", p, 0, 123456)
    p[20], p[23] = 3, 24
    assert summary(_frame(ubx(0x01, 0x07, bytes(p)))) == "iTOW 123.456  fixType 3  numSV 24"


def test_rtcm_station_only_where_the_message_has_one():
    msm = _frame(rtcm3(1077, bytes((0x12, 0x34, 0, 0))))
    assert summary(msm) == "Station 18"  # DF003 = 0x012: the builder leaves the high nibble 0
    assert summary(_frame(rtcm3(1057))) is None


@pytest.mark.parametrize(
    "frame",
    [
        Frame("sbf", b"$@\0\0\xb1\x0f\x08\0", "SBF 4017 GPSRawCA"),
        Frame("ubx", b"\xb5\x62\x02\x13\0\0\0\0", "UBX RXM-SFRBX"),
        Frame("ubx", b"\xb5\x62\x02\x73\0\0\0\0", "UBX RXM-QZSSL6"),
        Frame("ubx", b"\xb5\x62\x01\x07\0\0\0\0", "UBX NAV-PVT"),
        Frame("rtcm3", b"\xd3\0\0\0\0\0", "RTCM3 0"),
    ],
)
def test_truncated_layouts_do_not_raise(frame):
    frame_key(frame)
    summary(frame)
    preview(frame)
    MessageLog().add(frame)


# ── MessageLog ──────────────────────────────────────────────────────────────


def test_keyed_type_updates_one_row_per_satellite():
    log = MessageLog(Clock())
    for sv in (7, 8, 7):
        log.add(_sfrbx(0, sv))
    rows, _ = log.rows("UBX RXM-SFRBX")
    assert [r["key"] for r in rows] == ["G08 L1CA", "G07 L1CA"]
    assert [r["seq"] for r in rows] == [2, 3]


def test_type_without_key_keeps_latest_frames():
    log = MessageLog(Clock())
    for i in range(MAX_ROWS_LATEST + 5):
        log.add(_frame(nmea(f"GNGGA,{i}")))
    rows, _ = log.rows("GNGGA")
    assert len(rows) == MAX_ROWS_LATEST
    assert rows[-1]["data"].startswith(f"$GNGGA,{MAX_ROWS_LATEST + 4}*")
    assert rows[-1]["key"] is None and rows[-1]["preview"] is None


def test_rows_since_returns_only_changes():
    log = MessageLog(Clock())
    log.add(_sfrbx(0, 7))
    log.add(_sfrbx(0, 8))
    rows, last = log.rows("UBX RXM-SFRBX")
    assert len(rows) == 2 and last == 2
    assert log.rows("UBX RXM-SFRBX", last) == ([], 2)
    log.add(_sfrbx(0, 7))
    rows, last = log.rows("UBX RXM-SFRBX", last)
    assert [r["key"] for r in rows] == ["G07 L1CA"] and last == 3


def test_rows_of_unknown_label():
    assert MessageLog(Clock()).rows("nope", 5) == ([], 5)


def test_keyed_rows_are_capped():
    log = MessageLog(Clock())
    for i in range(MAX_ROWS_KEYED + 10):
        log.add(_sfrbx(9, i % 256, 0))
    assert len(log.rows("UBX RXM-SFRBX")[0]) == MAX_ROWS_KEYED


def test_type_bytes_are_capped():
    log = MessageLog(Clock())
    big = Frame("ubx", b"\xb5\x62\x01\x99" + bytes(16000), "UBX 01-99")
    for _ in range(MAX_ROWS_LATEST):
        log.add(big)
    assert len(log.rows("UBX 01-99")[0]) == MAX_TYPE_BYTES // len(big.data)


def test_labels_are_capped():
    log = MessageLog(Clock())
    for i in range(MAX_LABELS + 3):
        log.add(Frame("nmea", b"$X*00", f"L{i}"))
    labels = [t["label"] for t in log.summary()]
    assert len(labels) == MAX_LABELS + 1 and labels[-1] == OTHER
    assert log.summary()[-1]["count"] == 3


def test_decoder_msg_counts_are_capped():
    dec = StreamDecoder()
    dec.feed(b"".join(nmea(f"X{i:04d},1") for i in range(MAX_LABELS + 2)))
    assert len(dec.msg_counts) == MAX_LABELS + 1 and dec.msg_counts[OTHER] == 2


def test_long_nmea_head_is_truncated_in_the_label():
    assert len(_frame(nmea("P" + "A" * 200)).label) == 16


def test_decoder_passes_frames_to_the_log():
    log = MessageLog(Clock())
    StreamDecoder(on_frame=log.add).feed(nmea("GNGGA,1") + _sfrbx(0, 7).data)
    assert sorted(t["label"] for t in log.summary()) == ["GNGGA", "UBX RXM-SFRBX"]


def test_rate_over_the_window_and_counters():
    clock = Clock()
    log = MessageLog(clock)
    for _ in range(int(RATE_WINDOW_S) + 5):
        clock.t += 1.0
        log.add(_frame(nmea("GNGGA,1")))
        log.add(_frame(nmea("GNGGA,1")))
        log.tick()
    entry = log.summary()[0]
    assert entry["rate"] == pytest.approx(2.0, abs=0.01)
    assert entry["count"] == 2 * (int(RATE_WINDOW_S) + 5)
    assert entry["length"] == entry["bytes"] / entry["count"]
    assert entry["last"] == clock.t


def test_rate_early_in_the_session_uses_the_elapsed_time():
    clock = Clock()
    log = MessageLog(clock)
    clock.t += 2.0
    log.add(_frame(nmea("GNGGA,1")))
    log.tick()
    assert log.summary()[0]["rate"] == 0.5


def test_rate_is_scaled_or_absent_for_files():
    clock = Clock()
    log = MessageLog(clock)
    clock.t += 1.0
    log.add(_frame(nmea("GNGGA,1")))
    assert log.summary(10.0)[0]["rate"] == 0.1
    assert log.summary(None)[0]["rate"] is None
