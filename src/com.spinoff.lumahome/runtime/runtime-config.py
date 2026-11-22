#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Validated runtime settings and pairing. Never prints credentials."""
from __future__ import print_function
import base64,json,os,re,subprocess,sys
ROOT='/var/lib/webosbrew/lumahome'
def write(name,value):
    path=ROOT+'/'+name+'.json';tmp=path+'.tmp'
    with open(tmp,'w') as f:json.dump(value,f)
    os.chmod(tmp,384);os.rename(tmp,path)
def main():
    data=json.loads(base64.b64decode(sys.argv[1]));cfg=data.get('settings',{})
    allowed={'voice_mode':('hold','tap'),'voice_listen_seconds':(3,30),'voice_silence_seconds':(.5,5),'voice_start_seconds':(3,20),'voice_reply':bool,'voice_pipeline':str,'lumax_enabled':bool,'lumax_input':(1,2),'input_button_cycle':bool,'home_button':bool,'home_swap':bool,'microphone':bool,'no_signal':bool,'screensaver':bool}
    current={}
    try:current=json.load(open(ROOT+'/runtime.json'))
    except (IOError,ValueError):pass
    for key,value in cfg.items():
        if key not in allowed:continue
        rule=allowed[key]
        if rule is bool:
            if not isinstance(value,bool):raise ValueError('Invalid switch')
        elif rule is str:
            if not isinstance(value,(str,unicode)) or len(value)>100:raise ValueError('Invalid pipeline')
        elif key=='voice_mode':
            if value not in rule:raise ValueError('Invalid voice mode')
        elif key=='lumax_input':
            if isinstance(value,bool) or value not in rule:raise ValueError('Invalid HDMI port')
            value=int(value)
        elif not isinstance(value,(int,float)) or not rule[0]<=value<=rule[1]:raise ValueError('Invalid timing')
        current[key]=value
    write('runtime',current)
    if data.get('tv_id'):
        try:conn=json.load(open(ROOT+'/connection.json'))
        except (IOError,ValueError):conn={}
        conn['tv_id']=str(data['tv_id'])[:100];write('connection',conn)
    if data.get('pairing'):
        pair=data['pairing'];url=pair.get('url','');uuid=pair.get('uuid','');token=pair.get('token','')
        if not re.match(r'^https?://[^/]+(?::\d+)?/?$',url) or not re.match(r'^[a-f0-9]{32}$',uuid) or len(token)<40:raise ValueError('Invalid pairing')
        write('connection',{'uuid':uuid,'last_url':url.rstrip('/'),'service_name':pair.get('service_name','Home'),'tv_id':data.get('tv_id',''),'token':token})
    null=open(os.devnull,'wb')
    if 'home_button' in cfg:subprocess.check_call([ROOT+'/home-hook.sh','enable' if cfg['home_button'] else 'stop'],stdout=null,stderr=null)
    if 'microphone' in cfg:subprocess.check_call([ROOT+'/voice-control.sh','enable' if cfg['microphone'] else 'disable'],stdout=null,stderr=null)
    if 'input_button_cycle' in cfg and os.path.exists(ROOT+'/home-hook.enabled'):subprocess.check_call([ROOT+'/home-native.sh','enable'],stdout=null,stderr=null)
    print(json.dumps({'success':True,'home_button':os.path.exists(ROOT+'/home-hook.enabled'),'microphone':os.path.exists(ROOT+'/voice.enabled')}))
if __name__=='__main__':
    try:main()
    except Exception:print('{"success":false,"error":"Could not apply TV settings. Check model capabilities."}');sys.exit(1)
