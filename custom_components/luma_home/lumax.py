"""Route overlays to a foreground LumaX launcher when its HDMI input is active."""
from __future__ import annotations

import asyncio
from hashlib import sha256
import json
import re
from uuid import uuid4


def catalog_entries(entries):
    """Keep only the display metadata used by the launcher and app allowlist."""
    result = []
    for item in entries[:200]:
        if not isinstance(item, dict):
            continue
        app_id = item.get('id')
        if not isinstance(app_id, str) or not 0 < len(app_id) <= 200:
            continue
        entry = {'id': app_id}
        if isinstance(title := item.get('title'), str):
            entry['title'] = title[:200]
        if isinstance(visible := item.get('visible'), bool):
            entry['visible'] = visible
        result.append(entry)
    return result


def artwork_revision(icons):
    return sha256(json.dumps(icons, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def tv_source(attributes):
    """Use the active webOS app ID when the media player provides it."""
    app_id = attributes.get("app_id")
    if isinstance(app_id, str) and app_id:
        hdmi = re.fullmatch(r"com\.webos\.app\.hdmi([1-4])", app_id)
        return f"HDMI {hdmi[1]}" if hdmi else None
    return attributes.get("source")


def input_matches(source: str, name: str, port: int) -> bool:
    """Accept the HDMI source ID or an explicitly configured source label."""
    source = source.strip().casefold()
    if not source:
        return False
    hdmi = re.fullmatch(r"hdmi[ _-]?([1-4])", source)
    if hdmi:
        return int(hdmi[1]) == port
    return source == name.strip().casefold()


def is_active_input(source, settings, port):
    """Check the active HDMI input without guessing from ambiguous labels."""
    return (
        isinstance(source, str)
        and input_matches(source, settings[f"hdmi{port}"], port)
        and not input_matches(source, settings[f"hdmi{3 - port}"], 3 - port)
    )


def active_streamer_input(state, attributes, settings):
    """Return the configured Streamer port only while it is the visible source."""
    if state in (None, 'off', 'unavailable', 'unknown'):
        return None
    port = settings['lumax_input']
    if is_active_input(tv_source(attributes), settings, port):
        return port
    return None


def native_remote_target(state, attributes, settings):
    """Only forward to the TV when webOS positively identifies a different view."""
    app = attributes.get('app_id')
    if state in (None, 'off', 'unavailable', 'unknown') or not isinstance(app, str) or not app:
        return False
    if app == 'com.spinoff.lumahome.overlay':
        return False
    return active_streamer_input(state, attributes, settings) is None


async def overlay_tv_attributes(read_app_id, fallback, current_transition):
    """Prefer the TV's live foreground app, waiting briefly for a requested input."""
    loop = asyncio.get_running_loop()
    attributes = fallback
    while True:
        app_id = await read_app_id()
        if app_id:
            attributes = {**fallback, "app_id": app_id}
        target, deadline = current_transition()
        remaining = deadline - loop.time()
        if remaining <= 0 or attributes.get("app_id") == target:
            return attributes
        await asyncio.sleep(min(0.1, remaining))


class QuickPanel:
    """Relay remote keys only while the webOS Room controls panel is open."""

    def __init__(self, loop):
        self.loop = loop
        self.listeners = set()
        self.owner = None
        self.expiry = None
        self.hold_confirm = False

    def watch(self, send):
        self.listeners.add(send)
        send(self.presence())
        return lambda: self.listeners.discard(send)

    @property
    def active_owner(self):
        return self.owner[0] if self.owner is not None else None

    def open(self, owner, send, *, hold_confirm=False):
        was_open = self.owner is not None
        changed_capability = self.hold_confirm != hold_confirm
        self.owner = owner, send
        self.hold_confirm = hold_confirm
        self.renew(owner)
        if not was_open or changed_capability:
            self.changed()
        return lambda: self.close(owner)

    def renew(self, owner):
        if self.owner is None or self.owner[0] != owner:
            return False
        if self.expiry:
            self.expiry.cancel()
        self.expiry = self.loop.call_later(35, self.close, owner)
        return True

    def close(self, owner):
        if self.owner is None or self.owner[0] != owner:
            return
        self.owner = None
        self.hold_confirm = False
        self.expiry.cancel()
        self.expiry = None
        self.changed()

    def send(self, key, *, expected_owner=None):
        if self.owner is None or (expected_owner is not None and self.active_owner != expected_owner):
            return False
        owner, send = self.owner
        send({'key': key})
        if key == 'close':
            self.close(owner)
        return True

    def presence(self):
        result = {'active': self.owner is not None}
        if self.hold_confirm:
            result['hold_confirm'] = True
        return result

    def changed(self):
        event = self.presence()
        for send in tuple(self.listeners):
            send(event)


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
        for (owner, _nonce), (reply, _) in tuple(self.pending.items()):
            if owner == key and not reply.done():
                reply.set_result(False)

    def acknowledge(self, owner, nonce):
        pending = self.pending.get((owner, nonce))
        if pending is None or pending[0].done():
            return False
        reply, accept = pending
        accepted = accept is None or accept()
        reply.set_result(accepted)
        return accepted

    async def deliver(self, event, renderer=None, *, input_port=None, accept=None):
        for key, (port, send) in reversed(tuple(self.listeners.items())):
            if renderer is not None and key != renderer:
                continue
            if input_port is not None and port != input_port:
                continue
            nonce = uuid4().hex
            reply = asyncio.get_running_loop().create_future()
            self.pending[(key, nonce)] = reply, accept
            try:
                send({**event, "nonce": nonce})
                if await asyncio.wait_for(reply, timeout=0.35):
                    return key
            except (TimeoutError, ConnectionError):
                continue
            finally:
                self.pending.pop((key, nonce), None)
        return None
