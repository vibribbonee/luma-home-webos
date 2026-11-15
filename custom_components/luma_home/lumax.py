"""Route overlays to a foreground LumaX launcher when its HDMI input is active."""
from __future__ import annotations

import asyncio
import re
from uuid import uuid4


def input_matches(source: str, name: str, port: int) -> bool:
    """Accept the HDMI source ID or an explicitly configured source label."""
    source = source.strip().casefold()
    if not source:
        return False
    hdmi = re.fullmatch(r"hdmi[ _-]?([1-4])", source)
    if hdmi:
        return int(hdmi[1]) == port
    return source == name.strip().casefold()


class StreamerOverlay:
    def __init__(self):
        self.listeners = {}
        self.pending = {}

    def subscribe(self, port, send):
        key = uuid4().hex
        self.listeners[key] = (port, send)
        return key

    def unsubscribe(self, key):
        self.listeners.pop(key, None)
        for (owner, _nonce), reply in tuple(self.pending.items()):
            if owner == key and not reply.done():
                reply.set_result(False)

    def acknowledge(self, owner, nonce):
        reply = self.pending.get((owner, nonce))
        if reply is None or reply.done():
            return False
        reply.set_result(True)
        return True

    async def show(self, source, settings, event):
        if not isinstance(source, str):
            return False
        for key, (port, send) in reversed(tuple(self.listeners.items())):
            name = settings[f"hdmi{port}"]
            other = settings[f"hdmi{3 - port}"]
            if not input_matches(source, name, port) or input_matches(source, other, 3 - port):
                continue
            nonce = uuid4().hex
            reply = asyncio.get_running_loop().create_future()
            self.pending[(key, nonce)] = reply
            try:
                send({**event, "nonce": nonce})
                return await asyncio.wait_for(reply, timeout=0.35)
            except (TimeoutError, ConnectionError):
                return False
            finally:
                self.pending.pop((key, nonce), None)
        return False
