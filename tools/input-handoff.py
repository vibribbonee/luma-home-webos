#!/usr/bin/python
"""Bounded native HDMI handoff; no UI capture, network access or credentials."""
from __future__ import print_function
import json,os,re,subprocess,sys,time
ROOT='/var/lib/webosbrew/lumahome'
def luna(method,body):
    p=subprocess.Popen(['/usr/bin/luna-send','-w','1200','-n','1','-f','luna://'+method,json.dumps(body)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    # luna-send exits on stdin EOF. Keep its input pipe open until the reply.
    out=p.stdout.read();p.wait();p.stdin.close()
    try:return json.loads(out)
    except ValueError:return {}
def save(target,phase,started,**details):
    data={'target':target,'phase':phase,'elapsedMs':int((time.time()-started)*1000)};data.update(details)
    tmp=ROOT+'/input-handoff-status.json.tmp'
    with open(tmp,'w') as f:json.dump(data,f)
    os.chmod(tmp,0o600);os.rename(tmp,ROOT+'/input-handoff-status.json')
def main(target):
    if target=='--current':
        target=luna('com.webos.applicationManager/getForegroundAppInfo',{}).get('appId','')
    if not re.match(r'^com\.webos\.app\.hdmi[12]$',target):return 2
    started=time.time();seen_hidden=False;stable=0
    time.sleep(.35)
    while time.time()-started<9:
        windows=luna('com.webos.surfacemanager/getForegroundWindowInfo',{}).get('windows',[])
        own_menu=any(w.get('appId')=='com.spinoff.lumahome' for w in windows)
        if own_menu:
            if seen_hidden:save(target,'cancelled-menu-opened',started);return 0
            time.sleep(.1);continue
        seen_hidden=True
        foreground=luna('com.webos.applicationManager/getForegroundAppInfo',{}).get('appId')
        if foreground!=target:save(target,'cancelled-other-app',started,foreground=foreground);return 0
        status=luna('com.webos.service.videooutput/getStatus',{})
        matches=[v for v in status.get('video',[]) if v.get('sink')=='MAIN' and v.get('connected') and v.get('appId')==target]
        if not matches:
            save(target,'waiting-for-native-pipeline',started);time.sleep(.2);continue
        video=matches[0]
        if video.get('opacity')==0:
            result=luna('com.webos.service.videooutput/display/setCompositing',{'composeOrder':[{'sink':'MAIN','opacity':255,'zOrder':video.get('zOrder',0),'context':video['context']}]})
            save(target,'restored' if result.get('returnValue') else 'repair-rejected',started)
            stable=0
        elif video.get('opacity')==255:
            stable+=1
            if stable>=3:save(target,'visible',started,opacity=255);return 0
        time.sleep(.2)
    save(target,'timeout',started);return 1
if __name__=='__main__':sys.exit(main(sys.argv[1] if len(sys.argv)>1 else ''))
