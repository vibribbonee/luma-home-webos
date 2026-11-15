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
from .const import APP,OVERLAY,DOMAIN,settings,validate_patch
_LOGGER=logging.getLogger(__name__)
class LumaTV:
    def __init__(self,hass,entry):
        self.hass=hass;self.entry=entry;self.listeners=set();self.config_listeners=set();self.status={};self.catalog=[];self.last_seen=None;self.command_lock=asyncio.Lock();self.announcements={}
    @property
    def tv_id(self):return self.entry.unique_id
    @property
    def config(self):return settings(self.entry.options)
    @property
    def entity_id(self):
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
    def snapshot(self):
        return {'entry_id':self.entry.entry_id,'tv_id':self.tv_id,'name':self.entry.title,'settings':self.config,'catalog':deepcopy(self.catalog),'status':dict(self.status),'integration_version':'0.4.4','clock':{'utc_ms':int(datetime.now(timezone.utc).timestamp()*1000),'time_zone':self.hass.config.time_zone}}
    async def update(self,patch,*,push=True):
        checked=validate_patch(patch);self.hass.config_entries.async_update_entry(self.entry,options=self.config|checked);self.config_changed()
        if push and any(k.startswith('voice_') or k in ('home_button','home_swap','microphone','no_signal','screensaver') for k in checked):
            await self.configure_tv()
        return self.snapshot()
    async def command(self,params,*,overlay=False):
        state=self.hass.states.get(self.entity_id)
        if not state or state.state in ('off','unavailable','unknown'):raise HomeAssistantError('Turn on this TV before sending a Luma command.')
        await self.hass.services.async_call('webostv','command',{'entity_id':self.entity_id,'command':'system.launcher/launch','payload':{'id':OVERLAY if overlay else APP,'params':params}},blocking=True)
    async def configure_tv(self):
        cfg=self.config
        runtime={k:cfg[k] for k in cfg if k.startswith('voice_') or k in ('home_button','home_swap','microphone','no_signal','screensaver')}
        await self.command({'configure':{'tv_id':self.tv_id,'settings':runtime},'background':True},overlay=True)
    async def open(self,view='home',tab='pins'):
        if view=='quick':await self.command({'quick':True,'toggle':False},overlay=True)
        else:await self.command({'luma':view,'tab':tab})
    async def select_input(self,input_id,watch=True):await self.command({'luma':'input','input':str(input_id),'watch':watch})
    async def camera(self,camera,seconds=15,position='top-right',size=25,mode='mjpeg',title=''):
        if not camera.startswith('camera.') or not self.hass.states.get(camera):raise HomeAssistantError('Choose an existing camera entity.')
        await self.command({'camera':camera,'timeout':seconds,'position':position,'size':size,'mode':mode,'title':title},overlay=True)
    async def notify(self,message,title='',seconds=None,image=''):
        await self.command({'notification':{'message':message,'title':title,'seconds':seconds or self.config['notification_seconds'],'image':image}},overlay=True)
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
            await self.command({'announcement':{'id':run_id,'tv_id':self.tv_id,'message':announcement.message,'media':media(announcement.media_id,announcement.media_id_source=='tts'),'preannounce':media(announcement.preannounce_media_id)}},overlay=True)
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
        if isinstance(data.get('catalog'),list):self.catalog=[{k:x[k] for k in ('id','title','visible') if k in x} for x in data['catalog'][:200] if isinstance(x,dict) and isinstance(x.get('id'),str)]
        self.publish()
        if 'catalog' in data:self.config_changed()
    def start(self):
        @callback
        def changed(event):self.publish()
        return async_track_state_change_event(self.hass,[self.entity_id],changed)
