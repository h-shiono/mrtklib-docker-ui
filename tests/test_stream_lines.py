"""Subprocess readers survive long lines; broadcasts survive disconnects (#39 item 6)."""

import asyncio

from mrtklib_web_ui.api import convert
from mrtklib_web_ui.services.stream_lines import iter_lines


def _lines(chunks, max_line=1024 * 1024):
    async def run():
        reader = asyncio.StreamReader()
        for c in chunks:
            reader.feed_data(c)
        reader.feed_eof()
        return [line async for line in iter_lines(reader, max_line)]

    return asyncio.run(run())


def test_lines_over_64k_do_not_stop_the_reader():
    long = b"x" * 200_000
    assert _lines([b"a\r\n", long + b"\n", b"tail"]) == ["a", long.decode(), "tail"]


def test_overlong_line_is_flushed_before_its_newline():
    async def run():
        reader = asyncio.StreamReader()
        reader.feed_data(b"y" * 100)  # no newline yet
        lines = iter_lines(reader, max_line=64)
        first = await asyncio.wait_for(anext(lines), timeout=1)
        reader.feed_data(b"\nnext\n")
        reader.feed_eof()
        return [first] + [line async for line in lines]

    assert asyncio.run(run()) == ["y" * 100, "", "next"]


def test_convert_broadcast_tolerates_disconnect_during_send(monkeypatch):
    class WS:
        def __init__(self, name):
            self.name, self.got = name, []

        async def send_text(self, text):
            self.got.append(text)
            convert._ws_clients.discard(b)  # another handler disconnects b mid-broadcast
            await asyncio.sleep(0)

    a, b, c = WS("a"), WS("b"), WS("c")
    monkeypatch.setattr(convert, "_ws_clients", {a, b, c})
    asyncio.run(convert._broadcast({"type": "log"}))
    assert a.got and c.got
