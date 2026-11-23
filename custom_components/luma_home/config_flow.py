"""Native UI setup for each TV, with legacy migration for the first TV."""
from __future__ import annotations
import probatio as vol
from homeassistant import config_entries
from homeassistant.helpers import entity_registry as er,selector
from .const import DOMAIN,DEFAULTS,THEMES,import_legacy,validate_patch


def streamer_launcher_selector():
    return selector.SelectSelector(selector.SelectSelectorConfig(options=[
        {'value': 'lumax://home', 'label': 'LumaX'},
        {'value': 'lumax-preview://home', 'label': 'LumaX Native Preview'},
    ]))


def room_controls_selector():
    return selector.EntitySelector(selector.EntitySelectorConfig(
        multiple=True, filter=selector.EntityFilterSelectorConfig(domain=[
            'light', 'switch', 'input_boolean', 'fan', 'scene', 'script',
            'button', 'input_button', 'sensor', 'binary_sensor',
        ]),
    ))


class LumaHomeConfigFlow(config_entries.ConfigFlow,domain=DOMAIN):
    VERSION=1
    async def async_step_user(self,user_input=None):
        return self.async_show_menu(step_id='user', menu_options=['webos', 'streamer'])

    async def async_step_webos(self,user_input=None):
        errors={}
        if user_input:
            registered=er.async_get(self.hass).async_get(user_input['tv_entity'])
            if not registered or registered.platform!='webostv':errors['tv_entity']='not_webostv'
            else:
                await self.async_set_unique_id(registered.unique_id);self._abort_if_unique_id_configured()
                opts=import_legacy(self.hass) if user_input.get('import_existing',True) else dict(DEFAULTS)
                opts['room']=user_input.get('name') or 'Home'
                return self.async_create_entry(title=user_input.get('name') or 'Luma Home TV',data={'tv_entity':registered.entity_id,'webos_unique_id':registered.unique_id,'webos_entry_id':registered.config_entry_id},options=opts)
        schema=vol.Schema({vol.Required('tv_entity'):selector.EntitySelector(selector.EntitySelectorConfig(domain='media_player',integration='webostv')),vol.Optional('name',default='Home'):str,vol.Optional('import_existing',default=not self._async_current_entries()):bool})
        return self.async_show_form(step_id='webos',data_schema=schema,errors=errors)

    async def async_step_streamer(self, user_input=None):
        errors = {}
        if user_input:
            remote = er.async_get(self.hass).async_get(user_input['streamer_remote'])
            if remote is None or remote.platform != 'androidtv_remote' or remote.domain != 'remote':
                errors['streamer_remote'] = 'not_android_tv_remote'
            else:
                await self.async_set_unique_id(f'streamer:{remote.unique_id}')
                self._abort_if_unique_id_configured()
                room = user_input.get('name') or 'Streamer'
                return self.async_create_entry(
                    title=room,
                    data={
                        'streamer_only': True,
                        'remote_entity': remote.entity_id,
                        'remote_unique_id': remote.unique_id,
                        'area_id': user_input.get('area_id'),
                    },
                    options={
                        'room': room,
                        'streamer_remote': remote.entity_id,
                        'lumax_activity': user_input.get('lumax_activity', DEFAULTS['lumax_activity']),
                    },
                )
        schema = vol.Schema({
            vol.Required('streamer_remote'): selector.EntitySelector(
                selector.EntitySelectorConfig(domain='remote', integration='androidtv_remote'),
            ),
            vol.Optional('name', default='Streamer'): str,
            vol.Optional('area_id'): selector.AreaSelector(),
            vol.Optional('lumax_activity', default=DEFAULTS['lumax_activity']): streamer_launcher_selector(),
        })
        return self.async_show_form(step_id='streamer', data_schema=schema, errors=errors)
    @staticmethod
    def async_get_options_flow(config_entry):return LumaOptionsFlow()
class LumaOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self,user_input=None):
        if self.config_entry.data.get('streamer_only'):
            return await self.async_step_streamer_options(user_input)
        sensors = {'temperature': 'temperature', 'humidity': 'humidity', 'co2': 'carbon_dioxide'}
        if user_input:
            user_input['columns']=int(user_input.get('columns', self.config_entry.options.get('columns', 3)))
            user_input['lumax_input']=int(user_input.get('lumax_input', self.config_entry.options.get('lumax_input', 1)))
            user_input.setdefault('voice_reply_speaker', '')
            for key in sensors:
                user_input.setdefault(key, '')
            return self.async_create_entry(title='',data=dict(self.config_entry.options)|validate_patch(user_input))
        cfg=dict(DEFAULTS)|dict(self.config_entry.options)
        schema=vol.Schema({vol.Optional('room',default=cfg['room']):str,vol.Optional('theme',default=cfg['theme']):selector.SelectSelector(selector.SelectSelectorConfig(options=THEMES)),vol.Optional('columns',default=str(cfg['columns'])):selector.SelectSelector(selector.SelectSelectorConfig(options=[{'value':'2','label':'2 small tiles across'},{'value':'3','label':'3 small tiles across'}])),vol.Optional('voice_mode',default=cfg['voice_mode']):selector.SelectSelector(selector.SelectSelectorConfig(options=[{'value':'hold','label':'Hold to speak'},{'value':'tap','label':'Tap to speak'}])),vol.Optional('voice_listen_seconds',default=cfg['voice_listen_seconds']):selector.NumberSelector(selector.NumberSelectorConfig(min=3,max=30,step=1,unit_of_measurement='s')),vol.Optional('voice_silence_seconds',default=cfg['voice_silence_seconds']):selector.NumberSelector(selector.NumberSelectorConfig(min=.5,max=5,step=.1,unit_of_measurement='s')),vol.Optional('voice_reply',default=cfg['voice_reply']):bool,vol.Optional('lumax_enabled',default=cfg['lumax_enabled']):bool,vol.Optional('lumax_input',default=str(cfg['lumax_input'])):vol.In(['1','2']),vol.Optional('streamer_remote',**({'default':cfg['streamer_remote']} if cfg['streamer_remote'] else {})):selector.EntitySelector(selector.EntitySelectorConfig(domain='remote',integration='androidtv_remote')),vol.Optional('streamer_adb',**({'default':cfg['streamer_adb']} if cfg['streamer_adb'] else {})):selector.EntitySelector(selector.EntitySelectorConfig(domain='media_player',integration='androidtv'))})
        schema = schema.extend({
            vol.Optional('controls', default=cfg['controls']): room_controls_selector(),
            vol.Optional('voice_reply_speaker', description={'suggested_value': cfg['voice_reply_speaker']} if cfg['voice_reply_speaker'] else {}):
                selector.EntitySelector(selector.EntitySelectorConfig(domain='media_player')),
            vol.Optional('voice_reply_output', default=cfg['voice_reply_output']):
                selector.SelectSelector(selector.SelectSelectorConfig(options=[
                    {'value': 'tv_off', 'label': 'Only when TV is off'},
                    {'value': 'always', 'label': 'Always'},
                ])),
            vol.Optional('input_button_cycle', default=cfg['input_button_cycle']): bool,
        })
        schema = schema.extend({
            vol.Optional('lumax_activity', default=cfg['lumax_activity']): streamer_launcher_selector(),
        })
        schema = schema.extend({
            vol.Optional(key, description={'suggested_value': cfg[key]} if cfg[key] else {}):
                selector.EntitySelector(selector.EntitySelectorConfig(
                    filter=selector.EntityFilterSelectorConfig(domain='sensor', device_class=device_class),
                ))
            for key, device_class in sensors.items()
        })
        return self.async_show_form(step_id='init',data_schema=schema)

    async def async_step_streamer_options(self, user_input=None):
        if user_input is not None:
            user_input.setdefault('voice_reply_speaker', '')
            return self.async_create_entry(title='', data=dict(self.config_entry.options) | validate_patch(user_input))
        cfg = dict(DEFAULTS) | dict(self.config_entry.options)
        schema = vol.Schema({
            vol.Optional('room', default=cfg['room']): str,
            vol.Optional('voice_reply', default=cfg['voice_reply']): bool,
            vol.Optional('controls', default=cfg['controls']): room_controls_selector(),
            vol.Optional('voice_reply_speaker', description={'suggested_value': cfg['voice_reply_speaker']} if cfg['voice_reply_speaker'] else {}):
                selector.EntitySelector(selector.EntitySelectorConfig(domain='media_player')),
            vol.Optional('lumax_activity', default=cfg['lumax_activity']): streamer_launcher_selector(),
        })
        return self.async_show_form(step_id='streamer_options', data_schema=schema)
