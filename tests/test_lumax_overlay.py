import asyncio
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
from unittest.mock import AsyncMock

module_path = Path(__file__).resolve().parents[1] / 'custom_components/luma_home/lumax.py'
spec = spec_from_file_location('lumax', module_path)
lumax = module_from_spec(spec)
spec.loader.exec_module(lumax)


class StreamerOverlayTest(unittest.IsolatedAsyncioTestCase):
    settings = {'hdmi1': 'Google TV', 'hdmi2': 'Console', 'lumax_input': 1}

    async def test_quick_keys_only_reach_the_current_webos_panel(self):
        panel = lumax.QuickPanel(asyncio.get_running_loop())
        presence, old, current = [], [], []
        stop_watching = panel.watch(presence.append)
        self.assertFalse(panel.send('ok'))
        old_disconnect = panel.open('first', old.append)
        panel.open('second', current.append)
        old_disconnect()
        self.assertFalse(panel.renew('first'))
        self.assertTrue(panel.renew('second'))
        self.assertTrue(panel.send('right'))
        self.assertTrue(panel.send('close'))
        self.assertFalse(panel.send('ok'))
        self.assertFalse(panel.renew('second'))
        stop_watching()
        self.assertEqual(old, [])
        self.assertEqual(current, [{'key': 'right'}, {'key': 'close'}])
        self.assertEqual(presence, [{'active': False}, {'active': True}, {'active': False}])

    async def test_quick_handoff_closes_lg_before_streamer_can_open(self):
        panel = lumax.QuickPanel(asyncio.get_running_loop())
        router = lumax.StreamerOverlay()
        events = []
        panel.open('lg', lambda event: events.append(('lg', event['key'])))

        def receive(event):
            if router.acknowledge(streamer, event['nonce']):
                events.append(('streamer', event['kind']))

        streamer = router.subscribe(1, receive)
        receiver = await router.deliver({'kind': 'quick'}, input_port=1,
                                        accept=lambda: panel.send('close', expected_owner='lg'))
        self.assertEqual(receiver, streamer)
        self.assertEqual(events, [('lg', 'close'), ('streamer', 'quick')])
        self.assertIsNone(panel.active_owner)

    async def test_quick_handoff_leaves_a_reopened_lg_panel_alone(self):
        panel = lumax.QuickPanel(asyncio.get_running_loop())
        router = lumax.StreamerOverlay()
        events = asyncio.Queue()
        first = panel.open('lg-first', lambda _: self.fail('The old panel is gone'))
        streamer = router.subscribe(1, events.put_nowait)
        handoff = asyncio.create_task(router.deliver({'kind': 'quick'}, input_port=1,
            accept=lambda: panel.send('close', expected_owner='lg-first')))
        request = await events.get()
        first()
        second = panel.open('lg-second', lambda _: self.fail('The new panel was not part of the handoff'))
        self.assertFalse(router.acknowledge(streamer, request['nonce']))
        self.assertIsNone(await handoff)
        self.assertEqual(panel.active_owner, 'lg-second')
        second()

    def test_catalog_cache_keeps_only_launcher_metadata(self):
        catalog = lumax.catalog_entries([
            {'id': 'tv.app', 'title': 'TV app', 'visible': False, 'extra': {'token': 'ignored'}},
            {'id': 'untyped', 'title': {'invalid': 'ignored'}, 'visible': 'yes'},
            {'id': None}, None,
        ])
        self.assertEqual(catalog, [
            {'id': 'tv.app', 'title': 'TV app', 'visible': False},
            {'id': 'untyped'},
        ])

    def test_unchanged_artwork_gets_the_same_revision_after_reordering(self):
        icons = {'one': 'art-1', 'two': 'art-2'}
        revision = lumax.artwork_revision(icons)
        self.assertEqual(revision, lumax.artwork_revision({'two': 'art-2', 'one': 'art-1'}))
        self.assertNotEqual(revision, lumax.artwork_revision({'two': 'art-3', 'one': 'art-1'}))

    def test_catalog_icons_keep_only_current_valid_artwork(self):
        icon = 'data:image/png;base64,cG5n'
        catalog = [{'id': 'keep'}, {'id': 'invalid'}, {'id': 'oversized'}]
        artwork = {'keep': icon, 'removed': icon, 'invalid': 'file:///local/icon.png', 'oversized': icon * 3000}
        self.assertEqual(lumax.catalog_icons(catalog, artwork), {'keep': icon})

    def test_home_handoff_recognizes_an_already_active_input(self):
        self.assertTrue(lumax.is_active_input('HDMI_1', self.settings, 1))
        self.assertTrue(lumax.is_active_input('Google TV', self.settings, 1))
        self.assertFalse(lumax.is_active_input('Console', self.settings, 1))
        self.assertFalse(lumax.is_active_input('Google TV', {'hdmi1': 'Google TV', 'hdmi2': 'Google TV'}, 1))

    def test_tv_source_uses_the_port_even_when_renamed(self):
        self.assertEqual(lumax.tv_source({'app_id': 'com.webos.app.hdmi2', 'source': 'Game console'}), 'HDMI 2')
        self.assertIsNone(lumax.tv_source({'app_id': 'com.webos.app.youtube', 'source': 'HDMI 1'}))
        self.assertEqual(lumax.tv_source({'source': 'Google TV'}), 'Google TV')

    def test_only_the_configured_streamer_input_is_eligible(self):
        active = lumax.active_streamer_input
        self.assertEqual(active('on', {'app_id': 'com.webos.app.hdmi1'}, self.settings), 1)
        self.assertIsNone(active('on', {'app_id': 'com.webos.app.hdmi2'}, self.settings))
        self.assertIsNone(active('on', {'app_id': 'com.webos.app.youtube'}, self.settings))
        self.assertIsNone(active('off', {'app_id': 'com.webos.app.hdmi1'}, self.settings))
        ambiguous = {**self.settings, 'hdmi2': 'Google TV'}
        self.assertIsNone(active('on', {'source': 'Google TV'}, ambiguous))

    def test_visual_routing_requires_a_reachable_powered_on_tv(self):
        for state in (None, 'off', 'unavailable', 'unknown'):
            with self.subTest(state=state):
                self.assertFalse(lumax.tv_can_render(state))
                self.assertIsNone(lumax.active_streamer_input(state, {'app_id': 'com.webos.app.hdmi1'}, self.settings))
        self.assertTrue(lumax.tv_can_render('on'))

    def test_assist_reply_speaker_respects_room_and_power_settings(self):
        speaker = 'media_player.room_speaker'
        settings = {'voice_reply': True, 'voice_reply_speaker': speaker, 'voice_reply_output': 'tv_off'}
        self.assertEqual(lumax.assist_reply_speaker(settings, 'off'), speaker)
        self.assertEqual(lumax.assist_reply_speaker(settings, 'unavailable'), speaker)
        self.assertEqual(lumax.assist_reply_speaker(settings, 'on'), '')
        self.assertEqual(lumax.assist_reply_speaker({**settings, 'voice_reply_output': 'always'}, 'on'), speaker)
        self.assertEqual(lumax.assist_reply_speaker(settings, 'on', streamer_only=True), speaker)
        self.assertEqual(lumax.assist_reply_speaker({**settings, 'voice_reply': False}, 'off'), '')
        self.assertEqual(lumax.assist_reply_speaker({**settings, 'voice_reply_speaker': ''}, 'off'), '')

    def test_native_remote_requires_a_known_view_other_than_the_streamer(self):
        target = lumax.native_remote_target
        self.assertTrue(target('on', {'app_id': 'com.webos.app.hdmi2'}, self.settings))
        self.assertTrue(target('playing', {'app_id': 'com.webos.app.youtube'}, self.settings))
        self.assertFalse(target('on', {'app_id': 'com.webos.app.hdmi1'}, self.settings))
        self.assertFalse(target('on', {'source': 'Console'}, self.settings))
        self.assertFalse(target('on', {'app_id': 'com.spinoff.lumahome.overlay'}, self.settings))
        self.assertFalse(target('off', {'app_id': 'com.webos.app.hdmi2'}, self.settings))

    async def test_an_overlay_waits_for_the_requested_hdmi(self):
        first, second = 'com.webos.app.hdmi1', 'com.webos.app.hdmi2'
        read = AsyncMock(side_effect=[first, second])
        deadline = asyncio.get_running_loop().time() + 0.8
        attributes = await lumax.overlay_tv_attributes(read, {'app_id': first}, lambda: (second, deadline))
        self.assertEqual(attributes['app_id'], second)
        self.assertEqual(read.await_count, 2)

    async def test_an_expired_switch_uses_the_actual_source(self):
        first, second = 'com.webos.app.hdmi1', 'com.webos.app.hdmi2'
        read = AsyncMock(return_value=first)
        deadline = asyncio.get_running_loop().time() + 0.03
        attributes = await lumax.overlay_tv_attributes(read, {'app_id': second}, lambda: (second, deadline))
        self.assertEqual(attributes['app_id'], first)

    async def test_unavailable_live_lookup_uses_the_cached_source(self):
        fallback = {'source': 'Google TV'}
        read = AsyncMock(return_value=None)
        self.assertEqual(await lumax.overlay_tv_attributes(read, fallback, lambda: (None, 0)), fallback)
        read.assert_awaited_once()

    async def test_routes_to_active_streamer_and_waits_for_ack(self):
        router = lumax.StreamerOverlay()
        received = []

        def send(event):
            received.append(event)
            self.assertFalse(router.acknowledge('other-renderer', event['nonce']))
            self.assertTrue(router.acknowledge(key, event['nonce']))

        key = router.subscribe(1, send)
        router.subscribe(2, lambda _: self.fail('A stale port must not receive overlays'))
        self.assertEqual(await router.deliver({'kind': 'quick'}, input_port=1), key)
        self.assertEqual(await router.deliver({'kind': 'notification'}, input_port=1), key)
        self.assertEqual(await router.deliver({'kind': 'camera', 'camera': 'camera.doorbell'}, input_port=1), key)
        self.assertEqual([event['kind'] for event in received], ['quick', 'notification', 'camera'])

    async def test_no_renderer_at_the_configured_port_falls_back_to_lg(self):
        router = lumax.StreamerOverlay()
        router.subscribe(2, lambda _: self.fail('Should not route to the wrong port'))
        self.assertIsNone(await router.deliver({'kind': 'quick'}, input_port=1))

    async def test_streamer_only_can_deliver_without_a_tv_source(self):
        router = lumax.StreamerOverlay()
        received = []

        def send(event):
            received.append(event['kind'])
            router.acknowledge(renderer, event['nonce'])

        renderer = router.subscribe(2, send)
        self.assertEqual(
            await router.deliver({'kind': 'quick'}),
            renderer,
        )
        self.assertEqual(received, ['quick'])

    async def test_voice_reply_stays_with_original_renderer(self):
        router = lumax.StreamerOverlay()
        received = []

        def send(event):
            received.append(event['phase'])
            router.acknowledge(original, event['nonce'])

        original = router.subscribe(1, send)
        owner = await router.deliver({'phase': 'starting'}, input_port=1)
        self.assertEqual(owner, original)
        router.subscribe(2, lambda _: self.fail('Voice must not move to a new renderer'))
        self.assertEqual(await router.deliver({'phase': 'reply'}, owner), original)
        router.unsubscribe(original)
        self.assertIsNone(await router.deliver({'phase': 'reply'}, owner))
        self.assertEqual(received, ['starting', 'reply'])

    async def test_timeout_and_unsubscribe_fall_back_to_lg(self):
        router = lumax.StreamerOverlay()
        events = asyncio.Queue()
        key = router.subscribe(2, events.put_nowait)
        self.assertIsNone(await router.deliver({'kind': 'quick'}, input_port=2))
        expired = events.get_nowait()
        self.assertFalse(router.acknowledge(key, expired['nonce']))
        request = asyncio.create_task(router.deliver({'kind': 'quick'}, input_port=2))
        await events.get()
        router.unsubscribe(key)
        self.assertIsNone(await request)
        self.assertFalse(router.pending)
