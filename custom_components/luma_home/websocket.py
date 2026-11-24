"""Per-TV settings and reports; no helper entities or wrapper scripts."""
from __future__ import annotations
import asyncio
import probatio as vol
from homeassistant.core import callback
from homeassistant.components import websocket_api
from homeassistant.exceptions import HomeAssistantError
from .const import DOMAIN
from .lumax import assist_reply_speaker

def resolve(hass,msg):
    entries=hass.data.get(DOMAIN,{})
    if msg.get('entry_id') in entries:return entries[msg['entry_id']]
    if msg.get('tv_id'):
        for tv in entries.values():
            if tv.tv_id==msg['tv_id']:return tv
        raise HomeAssistantError('This TV is not paired with the Luma Home integration.')
    if len(entries)==1:return next(iter(entries.values()))
    raise HomeAssistantError('Select a Luma Home TV or add it in Devices & services.')
def authorized(hass,connection,msg):
    from homeassistant.auth.permissions.const import POLICY_CONTROL
    tv=resolve(hass,msg)
    if not connection.user.permissions.check_entity(tv.entity_id,POLICY_CONTROL):raise HomeAssistantError('You cannot control this TV.')
    return tv
COMMON={vol.Optional('entry_id'):str,vol.Optional('tv_id'):str}
@websocket_api.websocket_command({vol.Required('type'):'luma_home/config/get',**COMMON})
@websocket_api.async_response
async def get_config(hass,connection,msg):
    try:connection.send_result(msg['id'],authorized(hass,connection,msg).snapshot())
    except HomeAssistantError as err:connection.send_error(msg['id'],'not_paired',str(err))
@websocket_api.websocket_command({vol.Required('type'):'luma_home/catalog/artwork',**COMMON})
@websocket_api.async_response
async def get_catalog_artwork(hass,connection,msg):
    try:
        tv = authorized(hass, connection, msg)
        connection.send_result(msg['id'], {'version': tv.artwork_version, 'icons': tv.catalog_artwork})
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'not_paired', str(err))
@websocket_api.websocket_command({vol.Required('type'):'luma_home/config/set',vol.Required('settings'):dict,**COMMON})
@websocket_api.async_response
async def set_config(hass,connection,msg):
    try:connection.send_result(msg['id'],await authorized(hass,connection,msg).update(msg['settings']))
    except HomeAssistantError as err:connection.send_error(msg['id'],'invalid_settings',str(err))
@websocket_api.websocket_command({vol.Required('type'):'luma_home/config/subscribe',**COMMON})
@websocket_api.async_response
async def subscribe(hass,connection,msg):
    try:tv=authorized(hass,connection,msg)
    except HomeAssistantError as err:connection.send_error(msg['id'],'not_paired',str(err));return
    @callback
    def changed(value):connection.send_event(msg['id'],value)
    tv.config_listeners.add(changed)
    connection.subscriptions[msg['id']]=lambda:tv.config_listeners.discard(changed)
    connection.send_result(msg['id']);changed(tv.snapshot())
@websocket_api.websocket_command({vol.Required('type'):'luma_home/report',vol.Required('status'):dict,**COMMON})
@websocket_api.async_response
async def report(hass,connection,msg):
    try:tv=authorized(hass,connection,msg);tv.report(msg['status']);connection.send_result(msg['id'],{})
    except HomeAssistantError as err:connection.send_error(msg['id'],'not_paired',str(err))
@websocket_api.websocket_command({vol.Required('type'):'luma_home/states',vol.Required('entity_ids'):[str],**COMMON})
@websocket_api.async_response
async def states(hass,connection,msg):
    from homeassistant.auth.permissions.const import POLICY_READ
    try:resolve(hass,msg)
    except HomeAssistantError as err:connection.send_error(msg['id'],'not_paired',str(err));return
    result=[]
    for entity_id in msg['entity_ids'][:256]:
        state=hass.states.get(entity_id)
        if state and connection.user.permissions.check_entity(entity_id,POLICY_READ):result.append(state.as_dict())
    connection.send_result(msg['id'],result)
@websocket_api.websocket_command({vol.Required('type'):'luma_home/list'})
@websocket_api.async_response
async def list_tvs(hass,connection,msg):
    from homeassistant.auth.permissions.const import POLICY_CONTROL
    connection.send_result(msg['id'],[{'entry_id':tv.entry.entry_id,'tv_id':tv.tv_id,'name':tv.entry.title,'streamer_only':tv.streamer_only} for tv in hass.data.get(DOMAIN,{}).values() if connection.user.permissions.check_entity(tv.entity_id,POLICY_CONTROL)])
@websocket_api.websocket_command({vol.Required('type'):'luma_home/voice/config',
                                  vol.Optional('microphone', default='lg'):vol.In(['lg','streamer']),**COMMON})
@websocket_api.async_response
async def voice_config(hass,connection,msg):
    """Use HA's current per-device selector, including the preferred assistant."""
    from homeassistant.components.assist_pipeline.pipeline import async_get_pipeline
    from homeassistant.components.assist_pipeline.select import get_chosen_pipeline
    try:
        tv=authorized(hass,connection,msg)
        if msg['microphone']=='lg' and not tv.config['microphone']:raise HomeAssistantError('The HA microphone is disabled for this TV.')
        pipeline=async_get_pipeline(hass,get_chosen_pipeline(hass,DOMAIN,tv.tv_id))
        device=tv.own_device()
        connection.send_result(msg['id'],{'pipeline':pipeline.id,'name':pipeline.name,'stt_engine':pipeline.stt_engine,'device_id':device.id if device else None,'voice_reply':tv.config['voice_reply'],'speaker_configured':bool(tv.config['voice_reply_speaker'])})
    except HomeAssistantError as err:connection.send_error(msg['id'],'voice_unavailable',str(err))


@websocket_api.websocket_command({
    vol.Required('type'): 'luma_home/voice/reply',
    vol.Required('media_id'): vol.Match(r'^media-source://tts/-stream-/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$'),
    **COMMON,
})
@websocket_api.async_response
async def voice_reply(hass, connection, msg):
    """Send this pipeline's generated reply to the configured room speaker."""
    from homeassistant.auth.permissions.const import POLICY_CONTROL
    from homeassistant.components.media_player import MediaPlayerEntityFeature
    from homeassistant.core import Context

    try:
        tv = authorized(hass, connection, msg)
        state = hass.states.get(tv.entity_id)
        speaker_id = assist_reply_speaker(tv.config, state.state if state else None, streamer_only=tv.streamer_only)
        speaker = hass.states.get(speaker_id) if speaker_id and speaker_id != tv.entity_id else None
        if (speaker is None or speaker.state in ('unavailable', 'unknown')
                or speaker.attributes.get('device_class') == 'tv'
                or not speaker.attributes.get('supported_features', 0) & MediaPlayerEntityFeature.PLAY_MEDIA
                or not connection.user.permissions.check_entity(speaker_id, POLICY_CONTROL)):
            connection.send_result(msg['id'], {'played': False})
            return
        async with asyncio.timeout(4):
            await hass.services.async_call('media_player', 'play_media', {
                'entity_id': speaker_id, 'media_content_id': msg['media_id'],
                'media_content_type': 'music', 'announce': True,
            }, blocking=True, context=Context(user_id=connection.user.id))
        connection.send_result(msg['id'], {'played': True})
    except (HomeAssistantError, TimeoutError):
        connection.send_result(msg['id'], {'played': False})

@websocket_api.websocket_command({vol.Required('type'):'luma_home/pair',vol.Required('url'):str,vol.Required('confirm'):bool,**COMMON})
@websocket_api.async_response
async def pair(hass,connection,msg):
    from datetime import timedelta
    from urllib.parse import urlparse
    from homeassistant.auth.const import TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
    from homeassistant.helpers import instance_id
    if not connection.user.is_admin or not msg['confirm']:
        connection.send_error(msg['id'],'unauthorized','An administrator must explicitly pair this TV.');return
    refresh=None
    try:
        tv=authorized(hass,connection,msg)
        if tv.streamer_only:
            connection.send_error(msg['id'],'unsupported','Connect to Home Assistant and select this room in LumaX.')
            return
        url=msg['url'].rstrip('/');parsed=urlparse(url)
        if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.hostname in ('localhost','127.0.0.1','::1') or parsed.path or parsed.query or parsed.username:raise HomeAssistantError('Use a Home Assistant LAN address that the TV can reach.')
        refresh=await hass.auth.async_create_refresh_token(connection.user,client_name='Luma Home '+tv.entry.title+' '+__import__('uuid').uuid4().hex[:6],token_type=TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN,access_token_expiration=timedelta(days=3650))
        token=hass.auth.async_create_access_token(refresh)
        await tv.command({'configure':{'tv_id':tv.tv_id,'settings':tv.config,'pairing':{'url':url,'uuid':await instance_id.async_get(hass),'service_name':hass.config.location_name,'token':token}},'background':True},overlay=True)
        previous=tv.entry.data.get('refresh_token_id')
        hass.config_entries.async_update_entry(tv.entry,data=dict(tv.entry.data)|{'refresh_token_id':refresh.id})
        if previous:
            old=hass.auth.async_get_refresh_token(previous)
            if old:hass.auth.async_remove_refresh_token(old)
        connection.send_result(msg['id'],{'paired':True})
    except Exception:
        if refresh:hass.auth.async_remove_refresh_token(refresh)
        connection.send_error(msg['id'],'pairing_failed','Could not pair this TV. Check that Luma is installed and the TV is on.')
@websocket_api.websocket_command({vol.Required('type'):'luma_home/announcement/result',vol.Required('run_id'):str,vol.Required('state'):vol.In(['playing','done','error','cancelled']),**COMMON})
@websocket_api.async_response
async def announcement_result(hass,connection,msg):
    try:
        tv=authorized(hass,connection,msg)
        connection.send_result(msg['id'],{'accepted':tv.announcement_result(msg['run_id'],msg['state'])})
    except HomeAssistantError as err:connection.send_error(msg['id'],'unauthorized',str(err))

@websocket_api.websocket_command({vol.Required('type'): 'luma_home/lumax/subscribe',
                                  vol.Required('streamer_input'): vol.In([1, 2]),
                                  vol.Optional('background', default=False): bool, **COMMON})
@websocket_api.async_response
async def lumax_subscribe(hass, connection, msg):
    try:
        tv = authorized(hass, connection, msg)
        router = tv.streamer_overlay
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unauthorized', str(err))
        return

    @callback
    def send(event):
        connection.send_event(msg['id'], event)

    key = router.subscribe(msg['streamer_input'], send, background=msg['background'])
    connection.subscriptions[msg['id']] = lambda: router.unsubscribe(key)
    connection.send_result(msg['id'], {'renderer': key})
    tv.reconcile_quick_panel()

@websocket_api.websocket_command({vol.Required('type'): 'luma_home/lumax/keepalive',
                                  vol.Required('renderer'): str, **COMMON})
@websocket_api.async_response
async def lumax_keepalive(hass, connection, msg):
    try:
        router = authorized(hass, connection, msg).streamer_overlay
        connection.send_result(msg['id'], {'active': msg['renderer'] in router.listeners})
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unauthorized', str(err))

@websocket_api.websocket_command({vol.Required('type'): 'luma_home/lumax/ack',
                                  vol.Required('renderer'): str, vol.Required('nonce'): str, **COMMON})
@websocket_api.async_response
async def lumax_ack(hass, connection, msg):
    try:
        router = authorized(hass, connection, msg).streamer_overlay
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unauthorized', str(err))
        return
    connection.send_result(msg['id'], {'accepted': router.acknowledge(msg['renderer'], msg['nonce'])})


def paired_quick_panel(hass, connection, msg):
    tv = authorized(hass, connection, msg)
    if tv.streamer_only or not tv.config['lumax_enabled']:
        raise HomeAssistantError('The Streamer is not paired with an LG TV.')
    return tv


@websocket_api.websocket_command({vol.Required('type'): 'luma_home/quick/subscribe',
                                  vol.Required('role'): vol.In(['webos', 'streamer']),
                                  vol.Optional('hold_confirm', default=False): bool, **COMMON})
@websocket_api.async_response
async def quick_subscribe(hass, connection, msg):
    try:
        tv = paired_quick_panel(hass, connection, msg)
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unavailable', str(err))
        return

    @callback
    def send(event):
        connection.send_event(msg['id'], event)

    connection.send_result(msg['id'])
    if msg['role'] == 'webos':
        unsubscribe = tv.quick_panel.open((connection, msg['id']), send, hold_confirm=msg['hold_confirm'])
        tv.reconcile_quick_panel()
    else:
        stop_overlay = tv.quick_panel.watch(send)
        tv.publish_remote_target()
        tv.remote_listeners.add(send)
        send({'native_target': tv.remote_target})

        def unsubscribe():
            stop_overlay()
            tv.remote_listeners.discard(send)
    connection.subscriptions[msg['id']] = unsubscribe


@websocket_api.websocket_command({vol.Required('type'): 'luma_home/quick/keepalive',
                                  vol.Required('subscription'): int, **COMMON})
@websocket_api.async_response
async def quick_keepalive(hass, connection, msg):
    try:
        panel = paired_quick_panel(hass, connection, msg).quick_panel
        connection.send_result(msg['id'], {'active': panel.renew((connection, msg['subscription']))})
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unavailable', str(err))


@websocket_api.websocket_command({vol.Required('type'): 'luma_home/quick/key',
                                  vol.Required('key'): vol.In(['left', 'right', 'up', 'down', 'ok', 'ok_hold', 'back', 'close']),
                                  vol.Optional('native', default=False): bool, **COMMON})
@websocket_api.async_response
async def quick_key(hass, connection, msg):
    try:
        tv = paired_quick_panel(hass, connection, msg)
        accepted = tv.quick_panel.send(msg['key'])
        if not accepted and msg['native']:
            accepted = await tv.send_remote_key(msg['key'])
        connection.send_result(msg['id'], {'accepted': accepted})
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'unavailable', str(err))


@websocket_api.websocket_command({
    vol.Required('type'): 'luma_home/voice/display',
    vol.Required('phase'): vol.In(['starting', 'listening', 'thinking', 'reply', 'error']),
    vol.Required('message'): vol.All(str, vol.Length(max=4096)),
    vol.Optional('transcript', default=''): vol.All(str, vol.Length(max=4096)),
    vol.Optional('audio_path', default=''): vol.All(str, vol.Length(max=2048)),
    vol.Optional('renderer'): vol.Match(r'^(?:webos|[a-f0-9]{32})$'),
    vol.Optional('origin', default='lg'): vol.In(['lg', 'streamer']),
    **COMMON,
})
@websocket_api.async_response
async def voice_display(hass, connection, msg):
    try:
        tv = authorized(hass, connection, msg)
        audio_path = msg['audio_path']
        if audio_path and not audio_path.startswith('/api/tts_proxy/'):
            raise HomeAssistantError('Expected a Home Assistant speech reply.')
        event = {key: msg[key] for key in ('phase', 'message', 'transcript', 'audio_path')}
        renderer = msg.get('renderer')
        if msg['phase'] != 'starting' and not renderer:
            raise HomeAssistantError('The Assist display session has not started.')
        owner = None
        if msg['origin'] == 'streamer':
            owner = await tv.route_voice_from_streamer(event, renderer)
        elif tv.config['microphone'] and renderer != 'webos':
            owner = await tv.route_streamer_overlay({'kind': 'voice', **event}, renderer)
        connection.send_result(msg['id'], {'renderer': owner})
    except HomeAssistantError as err:
        connection.send_error(msg['id'], 'voice_unavailable', str(err))


@callback
def async_register(hass):
    for fn in (get_config,get_catalog_artwork,set_config,subscribe,report,states,list_tvs,voice_config,voice_display,voice_reply,pair,announcement_result,lumax_subscribe,lumax_keepalive,lumax_ack,quick_subscribe,quick_keepalive,quick_key):websocket_api.async_register_command(hass,fn)
