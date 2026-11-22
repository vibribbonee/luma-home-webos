"""Native webOS transport; stable registry identities, never a fixed TV IP."""
from __future__ import annotations
import asyncio
from copy import deepcopy
from datetime import datetime,timezone
import logging
from urllib.parse import urlsplit
from uuid import uuid4
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store
from .const import APP,OVERLAY,DOMAIN,settings,validate_patch
from .lumax import QuickPanel, StreamerOverlay, active_streamer_input, artwork_revision, catalog_entries, catalog_icons, native_remote_target, overlay_tv_attributes, tv_can_render
_LOGGER=logging.getLogger(__name__)
NAVIGATION_KEYS = {'left': 'LEFT', 'right': 'RIGHT', 'up': 'UP', 'down': 'DOWN', 'ok': 'ENTER', 'back': 'BACK'}
TV_RUNTIME_SETTINGS = {
    'input_button_cycle',
    'lumax_enabled', 'lumax_input', 'home_button', 'home_swap', 'microphone', 'no_signal', 'screensaver',
    'voice_mode', 'voice_listen_seconds', 'voice_silence_seconds', 'voice_start_seconds', 'voice_reply', 'voice_pipeline',
}

def tv_catalog_store(hass, entry_id):
    return Store(hass, 1, f'{DOMAIN}.catalog.{entry_id}')


class LumaTV:
    def __init__(self,hass,entry):
        self.hass=hass;self.entry=entry;self.listeners=set();self.config_listeners=set();self.status={};self.catalog=[];self.last_seen=None;self.command_lock=asyncio.Lock();self.announcements={}
        self.streamer_overlay = StreamerOverlay()
        self.quick_panel = QuickPanel(hass.loop)
        self.quick_handoff = None
        self.quick_handoff_target = None
        self.remote_listeners = set()
        self.remote_target = False
        self.input_transition = (None, 0)
        self.catalog_artwork = {}
        self.artwork_version = ""
        self.catalog_ready = False
        self.catalog_store = None if self.streamer_only else tv_catalog_store(hass, entry.entry_id)

    async def load_catalog(self):
        if self.catalog_store is None:
            return
        try:
            saved = await self.catalog_store.async_load()
        except (HomeAssistantError, OSError, ValueError):
            _LOGGER.warning('Could not read the cached TV catalog. It will be refreshed when the TV reconnects.')
            return
        if isinstance(saved, dict) and isinstance(saved.get('catalog'), list):
            self.catalog = catalog_entries(saved['catalog'])
            self.catalog_ready = True
            if isinstance(saved.get('catalog_artwork'), dict):
                self.catalog_artwork = catalog_icons(self.catalog, saved['catalog_artwork'])
                self.artwork_version = artwork_revision(self.catalog_artwork)
    @property
    def tv_id(self):return self.entry.unique_id
    @property
    def config(self):return settings(self.entry.options)
    @property
    def streamer_only(self):
        return bool(self.entry.data.get('streamer_only'))
    @property
    def entity_id(self):
        if self.streamer_only:
            return er.async_get(self.hass).async_get_entity_id(
                'remote', 'androidtv_remote', self.entry.data['remote_unique_id'],
            ) or self.entry.data['remote_entity']
        return er.async_get(self.hass).async_get_entity_id('media_player','webostv',self.entry.data['webos_unique_id']) or self.entry.data['tv_entity']
    @property
    def available(self):
        state=self.hass.states.get(self.entity_id)
        return bool(state and state.state not in ('unavailable','unknown'))
    @callback
    def publish(self):
        for fn in tuple(self.listeners):fn()
    @callback
    def config_changed(self):
        payload=self.snapshot()
        for fn in tuple(self.config_listeners):fn(payload)
        self.publish()
        self.publish_remote_target()
    def snapshot(self):
        return {'entry_id':self.entry.entry_id,'tv_id':self.tv_id,'name':self.entry.title,'streamer_only':self.streamer_only,'settings':self.config,'catalog':deepcopy(self.catalog),'catalog_ready':self.catalog_ready,'artwork_version':self.artwork_version,'status':dict(self.status),'integration_version':'0.4.26','quick_hold_confirm':True,'clock':{'utc_ms':int(datetime.now(timezone.utc).timestamp()*1000),'time_zone':self.hass.config.time_zone}}
    async def update(self,patch,*,push=True):
        checked=validate_patch(patch);self.hass.config_entries.async_update_entry(self.entry,options=self.config|checked);self.config_changed()
        if push and TV_RUNTIME_SETTINGS.intersection(checked):
            await self.configure_tv()
        return self.snapshot()
    async def tv_request(self, command, payload, *, return_response=False):
        if self.streamer_only:
            raise HomeAssistantError('This action needs a connected LumaX overlay or an LG webOS TV.')
        state=self.hass.states.get(self.entity_id)
        if not state or state.state in ('off','unavailable','unknown'):raise HomeAssistantError('Turn on this TV before sending a Luma command.')
        return await self.hass.services.async_call('webostv', 'command', {
            'entity_id': self.entity_id, 'command': command, 'payload': payload,
        }, blocking=True, return_response=return_response)

    async def command(self,params,*,overlay=False,app=None):
        await self.tv_request('system.launcher/launch', {'id': app or (OVERLAY if overlay else APP), 'params': params})
    async def configure_tv(self):
        if self.streamer_only:
            return
        cfg=self.config
        runtime={key: cfg[key] for key in TV_RUNTIME_SETTINGS}
        await self.command({'configure':{'tv_id':self.tv_id,'settings':runtime},'background':True},overlay=True)
    async def open(self,view='home',tab='pins'):
        if view in ('home', 'quick') and self.quick_panel.send('close'):
            return
        if view=='quick':
            if not await self.show_streamer_overlay({'kind': 'quick'}):
                await self.command({'quick':True,'toggle':False},overlay=True)
        elif view != 'home' or not await self.open_streamer_home():
            await self.command({'luma':view,'tab':tab})
    async def open_streamer_home(self):
        cfg = self.config
        remote = self.entity_id if self.streamer_only else cfg['streamer_remote']
        if not remote or not (self.streamer_only or cfg['lumax_enabled']):
            return False
        state = self.hass.states.get(remote)
        if state is None or state.state in ('unavailable', 'unknown'):
            return False
        try:
            async with asyncio.timeout(0.9):
                await self.hass.services.async_call('remote', 'turn_on', {
                    'entity_id': remote, 'activity': cfg['lumax_activity'],
                }, blocking=True)
                if not self.streamer_only:
                    port = cfg['lumax_input']
                    tv = self.hass.states.get(self.entity_id)
                    if active_streamer_input(tv.state if tv else None, tv.attributes if tv else {}, cfg) is None:
                        await self.select_input(port)
            return True
        except (HomeAssistantError, TimeoutError):
            return False
    async def show_streamer_overlay(self, event):
        return bool(await self.route_streamer_overlay(event))

    def quick_streamer_port(self):
        config = self.config
        if self.streamer_only or not config['lumax_enabled']:
            return None
        state = self.hass.states.get(self.entity_id)
        return active_streamer_input(state.state, state.attributes, config) if state else None

    def current_remote_target(self):
        if self.streamer_only or not self.config['lumax_enabled']:
            return False
        state = self.hass.states.get(self.entity_id)
        if not state:
            return False
        target, deadline = self.input_transition
        if self.hass.loop.time() < deadline and target != state.attributes.get('app_id'):
            return False
        return native_remote_target(state.state, state.attributes, self.config)

    @callback
    def publish_remote_target(self):
        target = self.current_remote_target()
        if target != self.remote_target:
            self.remote_target = target
            for send in tuple(self.remote_listeners):
                send({'native_target': target})

    async def send_remote_key(self, key):
        if key not in NAVIGATION_KEYS or not self.current_remote_target():
            return False
        await self.hass.services.async_call('webostv', 'button', {
            'entity_id': self.entity_id, 'button': NAVIGATION_KEYS[key],
        }, blocking=True)
        return True

    @callback
    def reconcile_quick_panel(self):
        owner = self.quick_panel.active_owner
        port = self.quick_streamer_port() if owner is not None else None
        target = (owner, port)
        if self.quick_handoff and not self.quick_handoff.done():
            if self.quick_handoff_target == target:
                return
            self.quick_handoff.cancel()
        if port is None:
            return

        def accept():
            return self.quick_streamer_port() == port and self.quick_panel.send('close', expected_owner=owner)

        self.quick_handoff_target = target
        self.quick_handoff = self.entry.async_create_background_task(
            self.hass, self.streamer_overlay.deliver({'kind': 'quick'}, input_port=port, accept=accept),
            'Move Luma Home Room controls to the Streamer',
        )

    async def overlay_attributes(self, state):
        async def read_app_id():
            try:
                async with asyncio.timeout(0.3):
                    result = await self.hass.services.async_call(
                        'webostv', 'command',
                        {'entity_id': self.entity_id,
                         'command': 'com.webos.applicationManager/getForegroundAppInfo'},
                        blocking=True, return_response=True,
                    )
            except (HomeAssistantError, TimeoutError):
                return None
            payload = (result or {}).get(self.entity_id, {})
            app_id = payload.get('appId') if isinstance(payload, dict) else None
            return app_id if isinstance(app_id, str) else None

        return await overlay_tv_attributes(read_app_id, state.attributes, lambda: self.input_transition)

    async def route_streamer_overlay(self, event, renderer=None):
        config = self.config
        if self.streamer_only:
            return await self.streamer_overlay.deliver(event, renderer)
        if not config['lumax_enabled']:
            return None
        if renderer is not None:
            return await self.streamer_overlay.deliver(event, renderer)
        state = self.hass.states.get(self.entity_id)
        if state is None or state.state in ('off', 'unavailable', 'unknown'):
            return None
        port = active_streamer_input(state.state, await self.overlay_attributes(state), config)
        if port is None:
            return None
        return await self.streamer_overlay.deliver(event, input_port=port)

    async def route_voice_from_streamer(self, event, renderer):
        config = self.config
        if self.streamer_only or not config['lumax_enabled']:
            return None
        if renderer is None:
            state = self.hass.states.get(self.entity_id)
            if not tv_can_render(state.state if state else None):
                return 'audio_only'
            if active_streamer_input(state.state, await self.overlay_attributes(state), config) is not None:
                return None
        elif renderer != 'webos':
            return None
        await self.command({'voice': {
            'phase': event['phase'], 'message': event['message'], 'transcript': event['transcript'],
            'audioPath': event['audio_path'], 'forwarded': True,
        }}, overlay=True)
        return 'webos'
    async def select_input(self, input_id, watch=True):
        transition = (f'com.webos.app.hdmi{input_id}', self.hass.loop.time() + 1.8)
        if watch:
            self.input_transition = transition
            self.publish_remote_target()
            self.hass.loop.call_at(transition[1], self.publish_remote_target)
        try:
            if watch:
                result = await self.tv_request('tv/switchInput', {'inputId': f'HDMI_{input_id}'}, return_response=True)
                if (result or {}).get(self.entity_id, {}).get('returnValue') is not True:
                    raise HomeAssistantError('The LG did not confirm the requested HDMI input.')
            else:
                await self.command({'luma': 'input', 'input': str(input_id), 'watch': watch})
        except (HomeAssistantError, asyncio.CancelledError):
            if self.input_transition is transition:
                self.input_transition = (None, 0)
                self.publish_remote_target()
            raise
    async def camera(self,camera,seconds=15,position='top-right',size=25,mode='mjpeg',title=''):
        state = self.hass.states.get(camera)
        if not camera.startswith('camera.') or not state:raise HomeAssistantError('Choose an existing camera entity.')
        payload = {'camera': camera, 'timeout': seconds, 'position': position, 'size': size, 'mode': mode, 'title': title or state.name}
        if not await self.show_streamer_overlay({'kind': 'camera', **payload}):
            await self.command(payload, overlay=True)
    async def dismiss(self):
        if not await self.show_streamer_overlay({'kind': 'dismiss'}):
            await self.command({'close': True}, overlay=True)
    async def notify(self,message,title='',seconds=None,image=''):
        duration = seconds or self.config['notification_seconds']
        if not image and await self.show_streamer_overlay({'kind': 'notification', 'message': message, 'title': title, 'seconds': duration}):
            return
        await self.command({'notification':{'message':message,'title':title,'seconds':duration,'image':image}},overlay=True)
    async def announce(self,announcement):
        def media(url,local=False):
            if not url:return None
            if local or url.startswith('/') or urlsplit(url).path.startswith('/api/assist_satellite/static/'):
                parts=urlsplit(url)
                return {'url':parts.path+('?' + parts.query if parts.query else ''),'ha':True}
            if urlsplit(url).scheme not in ('http','https'):raise HomeAssistantError('Announcement media must be an HTTP(S) URL.')
            return {'url':url,'ha':False}
        run_id=uuid4().hex
        future=self.hass.loop.create_future();self.announcements[run_id]=future
        try:
            payload = {'id': run_id, 'tv_id': self.tv_id, 'message': announcement.message,
                       'media': media(announcement.media_id, announcement.media_id_source == 'tts'),
                       'preannounce': media(announcement.preannounce_media_id)}
            if not await self.show_streamer_overlay({'kind': 'announcement', **payload}):
                await self.command({'announcement': payload}, overlay=True)
            result=await asyncio.wait_for(future,150)
            if result!='done':raise HomeAssistantError('TV announcement '+result+'.')
        except TimeoutError as err:raise HomeAssistantError('The TV did not confirm announcement playback.') from err
        finally:self.announcements.pop(run_id,None)
    def announcement_result(self,run_id,state):
        pending=self.announcements.get(run_id)
        if not pending or pending.done():return False
        self.status['announcement_state']=state;self.publish()
        if state!='playing':pending.set_result(state)
        return True
    async def launch_app(self,app):
        if self.streamer_only:
            raise HomeAssistantError('Use Android TV Remote to launch Streamer apps from Home Assistant.')
        cfg=self.config
        if app in ('smarttube','jellyfin'):
            if app=='jellyfin':
                if not cfg['streamer_adb']:raise HomeAssistantError('Jellyfin requires Android Debug Bridge on this Streamer. Select its ADB media player in Luma Home settings.')
                await self.hass.services.async_call('androidtv','adb_command',{'entity_id':cfg['streamer_adb'],'command':'am start -n org.jellyfin.androidtv/.startup.StartupActivity'},blocking=True)
            else:
                if not cfg['streamer_remote']:raise HomeAssistantError('Choose the Google TV Streamer remote in Luma Home settings.')
                await self.hass.services.async_call('remote','turn_on',{'entity_id':cfg['streamer_remote'],'activity':'vnd.youtube.launch://'},blocking=True)
            await self.select_input(1,True)
        else:
            if not any(x.get('id')==app for x in self.catalog):raise HomeAssistantError('Choose an app installed on this TV.')
            await self.command({'luma':'app','app_id':app})
    def report(self,data):
        self.last_seen=datetime.now(timezone.utc)
        safe_keys=('version','home_button','microphone','voice_phase','voice_error','audio_state','setup_complete','capabilities')
        self.status.update({k:data[k] for k in safe_keys if k in data})
        changed = False
        if isinstance(data.get('catalog'), list):
            catalog = catalog_entries(data['catalog'])
            if not self.catalog_ready or catalog != self.catalog:
                self.catalog = catalog
                self.catalog_ready = True
                changed = True
        artwork = data.get('catalog_artwork')
        has_artwork = isinstance(artwork, dict)
        if changed or has_artwork:
            sanitized = catalog_icons(self.catalog, artwork if has_artwork else self.catalog_artwork)
            if sanitized != self.catalog_artwork or (has_artwork and not self.artwork_version):
                self.catalog_artwork = sanitized
                self.artwork_version = artwork_revision(sanitized)
                changed = True
        if changed:
            if self.catalog_store:
                self.catalog_store.async_delay_save(lambda: {
                    'catalog': self.catalog,
                    **({'catalog_artwork': self.catalog_artwork} if self.artwork_version else {}),
                }, 2)
            self.config_changed()
        else:
            self.publish()
    def start(self):
        @callback
        def changed(event):
            self.publish()
            self.publish_remote_target()
            self.reconcile_quick_panel()
        return async_track_state_change_event(self.hass,[self.entity_id],changed)
