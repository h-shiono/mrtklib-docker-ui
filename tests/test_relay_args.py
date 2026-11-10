"""mrtk relay file streams/options stay inside allowed roots (#38 item 4)."""

import pytest

from mrtklib_web_ui.api.mrtk_relay import (
    DISCARD_OUTPUT,
    _stream_file_path,
    _validate_relay_args,
    _with_discard_output,
    _without_discard_output,
)


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


@pytest.mark.parametrize("args, expected", [
    # an input with no output only receives: the data is discarded
    (["-in", "tcpcli://h:1"], ["-in", "tcpcli://h:1", "-out", DISCARD_OUTPUT]),
    (["--input", "tcpcli://h:1"], ["--input", "tcpcli://h:1", "-out", DISCARD_OUTPUT]),
    (["-in", "tcpcli://h:1", "-out", "tcpsvr://:5000"], ["-in", "tcpcli://h:1", "-out", "tcpsvr://:5000"]),
    (["-in", "tcpcli://h:1", "--output", "tcpsvr://:5000"], ["-in", "tcpcli://h:1", "--output", "tcpsvr://:5000"]),
    ([], []),  # no input: mrtk relay prints its help
])
def test_with_discard_output(args, expected):
    assert _with_discard_output(args) == expected
    assert _without_discard_output(_with_discard_output(args)) == args


def test_discard_output_is_not_a_user_output():
    # users cannot ask for it: file outputs must be inside /workspace
    assert _validate_relay_args(["-in", "tcpcli://h:1", "-out", DISCARD_OUTPUT]) is not None
