import asyncio
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

module_path = Path(__file__).resolve().parents[1] / 'custom_components/luma_home/lumax.py'
spec = spec_from_file_location('lumax', module_path)
lumax = module_from_spec(spec)
spec.loader.exec_module(lumax)


class StreamerOverlayTest(unittest.IsolatedAsyncioTestCase):
    settings = {'hdmi1': 'Google TV', 'hdmi2': 'Console'}

    async def test_routes_to_active_streamer_and_waits_for_ack(self):
        router = lumax.StreamerOverlay()
        received = []

        def send(event):
            received.append(event)
            self.assertFalse(router.acknowledge('other-renderer', event['nonce']))
            self.assertTrue(router.acknowledge(key, event['nonce']))

        key = router.subscribe(1, send)
        self.assertTrue(await router.show('HDMI 1', self.settings, {'kind': 'quick'}))
        self.assertTrue(await router.show('Google TV', self.settings, {'kind': 'notification'}))
        self.assertEqual([event['kind'] for event in received], ['quick', 'notification'])
        self.assertFalse(await router.show('Console', self.settings, {'kind': 'quick'}))
        self.assertFalse(await router.show(None, self.settings, {'kind': 'quick'}))

    async def test_ambiguous_labels_stay_on_lg(self):
        router = lumax.StreamerOverlay()
        router.subscribe(2, lambda _: self.fail('Should not route an ambiguous source'))
        self.assertFalse(await router.show('TV box', {'hdmi1': 'TV box', 'hdmi2': 'TV box'}, {}))

    async def test_timeout_and_unsubscribe_fall_back_to_lg(self):
        router = lumax.StreamerOverlay()
        events = asyncio.Queue()
        key = router.subscribe(2, events.put_nowait)
        self.assertFalse(await router.show('HDMI 2', self.settings, {'kind': 'quick'}))
        expired = events.get_nowait()
        self.assertFalse(router.acknowledge(key, expired['nonce']))
        request = asyncio.create_task(router.show('HDMI 2', self.settings, {'kind': 'quick'}))
        await events.get()
        router.unsubscribe(key)
        self.assertFalse(await request)
        self.assertFalse(router.pending)
