"""mrtk relay file streams/options stay inside allowed roots (#38 item 4)."""

import pytest

from mrtklib_web_ui.api.mrtk_relay import _stream_file_path, _validate_relay_args


def test_stream_file_path():
    assert _stream_file_path("serial://ttyUSB0:115200#ubx") is None
    assert _stream_file_path("ntrip://u:p@host:2101/MNT") is None
    assert _stream_file_path("file:///workspace/out_%Y%m%d.ubx::T::S=1#ubx") == "/workspace/out_%Y%m%d.ubx"
    assert _stream_file_path("/workspace/a.rtcm3#rtcm3") == "/workspace/a.rtcm3"
    # an unknown #suffix is part of the path, as in str2str decodefmt()
    assert _stream_file_path("/workspace/a#x") == "/workspace/a#x"


@pytest.mark.parametrize("args", [
    [],
    ["-in", "serial://ttyUSB0:115200#ubx", "-out", "file:///workspace/out_%Y%m%d.ubx", "-out", "tcpsvr://:5000"],
    ["--input", "file:///data/log.ubx::T", "--output", "file:///workspace/x.rtcm#rtcm3"],
    ["-in", "/opt/mrtklib/corrections/clas/a.l6", "-out", ""],
    ["-in", "tcpcli://h:1", "-c", "/data/cmd.txt", "-fl", "/workspace/relay.log", "-l", "/workspace"],
])
def test_allowed(args):
    assert _validate_relay_args(args) is None


@pytest.mark.parametrize("args", [
    ["-in", "file:///etc/shadow", "-out", "tcpsvr://:5000"],
    ["-in", "file:///workspace/.ai_settings.toml", "-out", "tcpsvr://:5000"],
    ["-in", "tcpcli://h:1", "-out", "file:///etc/cron.d/x"],
    ["-in", "tcpcli://h:1", "--output", "/data/x.ubx"],
    ["-in", "tcpcli://h:1", "-out", "file:///workspace/../root/x"],
    ["-in", "tcpcli://h:1", "-out", "file://relative.ubx"],
    ["-in", "tcpcli://h:1", "-c", "/workspace/.credentials.toml"],
    ["-in", "tcpcli://h:1", "-c1", "/root/.netrc"],
    ["-in", "tcpcli://h:1", "-fl", "/tmp/x.log"],
    ["-in", "tcpcli://h:1", "-l", "/"],
])
def test_rejected(args):
    assert _validate_relay_args(args) is not None
