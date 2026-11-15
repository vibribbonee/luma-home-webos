"""Luma Home: native integration, configuration and TV overlay actions."""
from __future__ import annotations
import probatio as vol
from homeassistant.core import HomeAssistant,ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv,device_registry as dr
from homeassistant.components.http import StaticPathConfig
from .const import DOMAIN,PLATFORMS
from .coordinator import LumaTV
async def async_setup(hass:HomeAssistant,config):
    hass.data.setdefault(DOMAIN,{})
    from .websocket import async_register
    async_register(hass)
    await hass.http.async_register_static_paths([StaticPathConfig('/luma_home/luma-home-card.js',hass.config.path('custom_components',DOMAIN,'frontend','luma-home-card.js'),False)])
    common={vol.Optional('device_id'):cv.string,vol.Optional('entry_id'):cv.string,vol.Optional('tv_id'):cv.string}
    def resolve(data):
        entries=hass.data[DOMAIN]
        if data.get('entry_id') in entries:return entries[data['entry_id']]
        if data.get('tv_id'):
            for tv in entries.values():
                if tv.tv_id == data['tv_id']:
                    return tv
            raise HomeAssistantError('Choose a Luma Home TV device.')
        if data.get('device_id'):
            device=dr.async_get(hass).async_get(data['device_id'])
            if device:
                for entry_id in device.config_entries:
                    if entry_id in entries:return entries[entry_id]
            raise HomeAssistantError('Choose a Luma Home TV device.')
        if len(entries)==1:return next(iter(entries.values()))
        raise HomeAssistantError('Choose which Luma Home TV to control.')
    async def handle(call:ServiceCall):
        tv=resolve(call.data);d=call.data;name=call.service
        if name=='open':await tv.open(d.get('view','home'),d.get('tab','pins'))
        elif name=='select_input':await tv.select_input(d['input'],d.get('watch',True))
        elif name=='show_camera':await tv.camera(d['camera'],d.get('seconds',15),d.get('position','top-right'),d.get('size',25),d.get('mode','mjpeg'),d.get('title',''))
        elif name=='notify':await tv.notify(d['message'],d.get('title',''),d.get('seconds'),d.get('image',''))
        elif name=='dismiss':await tv.command({'close':True},overlay=True)
        elif name=='launch_app':await tv.launch_app(d['app'])
        elif name=='set_settings':await tv.update(d['settings'])
    schemas={
      'open':{vol.Optional('view',default='home'):vol.In(['home','quick','idle','settings']),vol.Optional('tab',default='pins'):vol.In(['pins','widgets','appearance','system'])},
      'select_input':{vol.Required('input'):vol.All(vol.Coerce(int),vol.Range(min=1,max=2)),vol.Optional('watch',default=True):cv.boolean},
      'show_camera':{vol.Required('camera'):cv.entity_id,vol.Optional('seconds',default=15):vol.All(vol.Coerce(int),vol.Range(min=3,max=120)),vol.Optional('position',default='top-right'):vol.In(['top-right','top-left','bottom-right','bottom-left']),vol.Optional('size',default=25):vol.All(vol.Coerce(int),vol.Range(min=15,max=45)),vol.Optional('mode',default='mjpeg'):vol.In(['snapshot','mjpeg']),vol.Optional('title',default=''):cv.string},
      'notify':{vol.Required('message'):cv.string,vol.Optional('title',default=''):cv.string,vol.Optional('seconds'):vol.All(vol.Coerce(int),vol.Range(min=3,max=120)),vol.Optional('image',default=''):cv.string},
      'dismiss':{},'launch_app':{vol.Required('app'):cv.string},'set_settings':{vol.Required('settings'):dict}}
    for name,schema in schemas.items():hass.services.async_register(DOMAIN,name,handle,schema=vol.Schema(common|schema))
    return True
async def async_setup_entry(hass,entry):
    tv=entry.runtime_data=LumaTV(hass,entry);hass.data[DOMAIN][entry.entry_id]=tv
    dr.async_get(hass).async_get_or_create(config_entry_id=entry.entry_id,identifiers={(DOMAIN,entry.unique_id)},name=entry.title,manufacturer='Luma Home',model='webOS Home and Home Assistant overlays')
    entry.async_on_unload(tv.start())
    await hass.config_entries.async_forward_entry_setups(entry,PLATFORMS)
    hybrid = tv.config['lumax_enabled']
    async def options_changed(hass,entry):
        nonlocal hybrid
        tv.config_changed()
        enabled = tv.config['lumax_enabled']
        if enabled != hybrid:
            hybrid = enabled
            try:
                await tv.configure_tv()
            except HomeAssistantError:
                # The LG reconnects with the saved options when its launcher opens.
                pass
    entry.async_on_unload(entry.add_update_listener(options_changed))
    return True
async def async_unload_entry(hass,entry):
    ok=await hass.config_entries.async_unload_platforms(entry,PLATFORMS)
    if ok:hass.data[DOMAIN].pop(entry.entry_id,None)
    return ok

async def async_remove_entry(hass,entry):
    token_id=entry.data.get('refresh_token_id')
    if token_id:
        refresh=hass.auth.async_get_refresh_token(token_id)
        if refresh:hass.auth.async_remove_refresh_token(refresh)
