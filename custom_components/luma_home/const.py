"""Luma Home's versioned, per-TV configuration contract."""
from copy import deepcopy
import json
import re
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
DOMAIN='luma_home'
APP='com.spinoff.lumahome'
OVERLAY=APP+'.overlay'
PLATFORMS=['button','switch','select','number','sensor','binary_sensor','notify','assist_satellite']
THEMES=['Twilight','Forest','Coast','Dunes','Alpine','Midnight','Aurora','Ember','Slate','Clear']
DEFAULTS={'room':'Home','pins':[],'controls':[],'temperature':'','humidity':'','hdmi1':'HDMI 1','hdmi2':'HDMI 2','theme':'Twilight','background':'','palette':'','idle':2,'climate':True,'tilesize':'Standard','tiles':{},'columns':3,'home_button':False,'home_swap':False,'microphone':False,'voice_mode':'hold','voice_listen_seconds':15,'voice_silence_seconds':1.5,'voice_start_seconds':8,'voice_reply':True,'voice_pipeline':'','streamer_remote':'','streamer_adb':'','notification_seconds':15,'no_signal':False,'screensaver':False}
LEGACY={'room':'input_text.luma_home_room_name','pins':'input_text.luma_home_pinned_apps','controls':'input_text.luma_home_controls','temperature':'input_text.luma_home_temperature_entity','humidity':'input_text.luma_home_humidity_entity','hdmi1':'input_text.luma_home_hdmi_1_name','hdmi2':'input_text.luma_home_hdmi_2_name','theme':'input_select.luma_home_backdrop','background':'input_text.luma_home_background_image','idle':'input_number.luma_home_idle_minutes','climate':'input_boolean.luma_home_show_climate','tilesize':'input_select.luma_home_tile_size','tiles':'input_text.luma_home_tile_sizes'}
PIN_MIGRATION={'ha:script.luma_launch_smarttube':'luma:app/smarttube','ha:script.luma_launch_jellyfin':'luma:app/jellyfin'}
ENTITY_RE=re.compile(r'^[a-z_]+\.[a-z0-9_]+$')
def settings(options):return deepcopy(DEFAULTS)|dict(options)
def validate_patch(patch):
    out={}
    if not isinstance(patch,dict):raise HomeAssistantError('Settings must be an object.')
    for key,value in patch.items():
        if key not in DEFAULTS:raise HomeAssistantError(f'Unknown Luma setting: {key}')
        if key in ('pins','controls'):
            if not isinstance(value,list) or len(value)>24:raise HomeAssistantError('Choose no more than 24 items.')
            if not all(isinstance(x,str) and len(x)<160 for x in value):raise HomeAssistantError('Invalid item list.')
            value=list(dict.fromkeys(PIN_MIGRATION.get(x,x) for x in value))
            if key=='controls' and not all(ENTITY_RE.fullmatch(x) for x in value):raise HomeAssistantError('Choose valid Home Assistant entities.')
        elif key=='tiles':
            if not isinstance(value,dict) or not all(ENTITY_RE.fullmatch(k) and v in ('Small','Compact','Standard','Large') for k,v in value.items()):raise HomeAssistantError('Invalid tile sizes.')
        elif key in ('climate','home_swap','home_button','microphone','voice_reply','no_signal','screensaver'):
            if not isinstance(value,bool):raise HomeAssistantError(f'{key} must be on or off.')
        elif key in ('idle','columns','voice_listen_seconds','voice_silence_seconds','voice_start_seconds','notification_seconds'):
            lo,hi={'idle':(0,60),'columns':(2,3),'voice_listen_seconds':(3,30),'voice_silence_seconds':(.5,5),'voice_start_seconds':(3,20),'notification_seconds':(3,120)}[key]
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not lo<=value<=hi:raise HomeAssistantError(f'{key} must be between {lo} and {hi}.')
            value=float(value) if key=='voice_silence_seconds' else int(value)
        else:
            if not isinstance(value,str) or len(value)>2048:raise HomeAssistantError(f'Invalid value for {key}.')
            if key=='theme' and value not in THEMES:raise HomeAssistantError('Choose an available theme.')
            if key=='tilesize' and value not in ('Small','Compact','Standard','Large'):raise HomeAssistantError('Choose an available tile size.')
            if key=='voice_mode' and value not in ('hold','tap'):raise HomeAssistantError('Choose Hold or Tap to speak.')
            if key in ('temperature','humidity','streamer_remote','streamer_adb') and value and not ENTITY_RE.fullmatch(value):raise HomeAssistantError('Choose a valid entity.')
            if key=='background' and value and not (value.startswith('/') or re.match(r'^https?://',value)):raise HomeAssistantError('Use an HTTP(S) image URL or Home Assistant image path.')
            if key=='palette' and value and not re.fullmatch(r'\d{1,3},\s*\d{1,3},\s*\d{1,3}',value):raise HomeAssistantError('Invalid image palette.')
        out[key]=value
    return out

def import_legacy(hass:HomeAssistant):
    out=deepcopy(DEFAULTS)
    for key,entity in LEGACY.items():
        state=hass.states.get(entity)
        if not state or state.state in ('unknown','unavailable'):continue
        try:
            value=state.state
            if key in ('pins','controls','tiles'):value=json.loads(value)
            elif key=='idle':value=int(float(value))
            elif key=='climate':value=value=='on'
            out.update(validate_patch({key:value}))
        except (ValueError,TypeError,HomeAssistantError):continue
    out.update(home_button=True,microphone=True)
    return out
