"""CLAS pipeline SBF sniffer keeps its behaviour after sharing the PVTGeodetic
decode with the Stream Monitor (#96)."""

import hashlib
import json
import math
import struct

import pytest

from mrtklib_web_ui.services.sbf_pvt_sniffer import SbfStreamParser
from stream_builders import sbf


def _pvt(mode=4, age_raw=150) -> bytes:
    b = bytearray(84)
    struct.pack_into("<IHBB", b, 0, 389951000, 2410, mode, 0)
    struct.pack_into("<ddd", b, 8, math.radians(35.5), math.radians(139.25), 60.0)
    b[66] = 21
    struct.pack_into("<H", b, 70, age_raw)
    return sbf(4007, bytes(b))


def test_pvt_fix_json_shape():
    p = SbfStreamParser()
    (fix,) = p.feed(_pvt())
    j = fix.to_json()
    assert j == {
        "time_gpst": "2026-03-19T12:19:11+00:00",
        "lat": pytest.approx(35.5), "lon": pytest.approx(139.25), "hgt": 60.0,
        "quality": 1, "ns": 21, "age": 1.5,
    }
    (no_age,) = p.feed(_pvt(age_raw=0xFFFF))
    assert no_age.age_s == -1.0  # the CLAS panel's "not available"
    assert p.feed(_pvt(mode=0)) == []
    assert p.stats.blocks_total == 3


@pytest.mark.localdata
def test_g5_file_output_is_unchanged(localdata):
    data = localdata("G5P3073h.sbf").read_bytes()
    p = SbfStreamParser()
    fixes = []
    for i in range(0, len(data), 4096):
        fixes += [f.to_json() for f in p.feed(data[i : i + 4096])]
    # Recorded with the parser before the refactor (develop @ 919459a).
    digest = hashlib.sha256(json.dumps(fixes, sort_keys=True).encode()).hexdigest()
    assert (len(fixes), p.stats.blocks_total) == (3660, 398272)
    assert digest == "425c205d70f9638c5200bbb5fdfda2a673f675051e111e232e57384ac392ef4e"
