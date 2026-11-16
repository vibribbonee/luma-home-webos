#!/usr/bin/python
"""Passive no-signal/screensaver handoff with a durable, input-specific return."""
from __future__ import print_function
import json,os,re,subprocess,time
ROOT='/var/lib/webosbrew/lumahome';AUTO=ROOT+'/ambient-auto'
def luna(method,body):
    p=subprocess.Popen(['/usr/bin/luna-send','-w','1000','-n','1','-f','luna://'+method,json.dumps(body)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    out=p.stdout.read();p.wait();p.stdin.close()
    try:return json.loads(out)
    except ValueError:return {}
def launch(params):return luna('com.webos.applicationManager/launch',{'id':'com.spinoff.lumahome','params':params})
def status(value):
    value['time']=time.time()
    with open(ROOT+'/ambient-status.json','w') as f:json.dump(value,f)
class Handoff:
    def __init__(self):
        self.active=None;self.bad_since=None;self.bad_target=None;self.good=0
        try:
            saved=json.load(open(AUTO))
            if re.match(r'^com\.webos\.app\.hdmi[12]$',saved.get('target','')):self.active=saved
        except (IOError,ValueError):pass
    def cancel(self):
        self.active=None;self.bad_since=None;self.good=0
        try:os.unlink(AUTO)
        except OSError:pass
    def persist(self):
        tmp=AUTO+'.tmp'
        with open(tmp,'w') as f:json.dump(self.active,f)
        os.chmod(tmp,384);os.rename(tmp,AUTO)
    def tick(self,apps,video_status,now):
        videos=video_status.get('video',[])
        if self.active:
            target=self.active['target']
            if not os.path.exists(AUTO) or not any(a in (target,'com.spinoff.lumahome') for a in apps):self.cancel();return
            contexts=[v.get('context') for v in videos if v.get('appId')==target and v.get('sink')=='MAIN' and v.get('context')]
            if not contexts:contexts=[c.get('clientId') for c in video_status.get('clients',[]) if c.get('appId')==target and c.get('clientId')]
            if contexts and contexts[0]!=self.active.get('context'):self.active['context']=contexts[0];self.persist()
            result=luna('com.webos.service.extinputs.hdmi/getSignalState',{'pipelineId':self.active['context']})
            signal=result.get('signalState',{}).get('videoSignalState') if result.get('returnValue') else None
            self.good=self.good+1 if signal=='good' else 0
            status({'phase':'waiting-for-signal' if signal else 'waiting-for-pipeline','input':target[-1],'signal':signal})
            if self.good>=2:
                result=launch({'luma':'input','input':target[-1],'watch':True})
                if result.get('returnValue'):self.cancel();status({'phase':'signal-returned','input':target[-1]})
            return
        if 'com.spinoff.lumahome' in apps:self.bad_since=None;return
        target=next((a for a in apps if a and re.match(r'^com\.webos\.app\.hdmi[12]$',a)),None)
        video=next((v for v in videos if v.get('sink')=='MAIN' and v.get('appId')==target and v.get('context')),None)
        if not target or not video:self.bad_since=None;return
        result=luna('com.webos.service.extinputs.hdmi/getSignalState',{'pipelineId':video['context']});signal=result.get('signalState',{}).get('videoSignalState')
        if not result.get('returnValue') or not signal:return
        status({'phase':'watching','input':target[-1],'signal':signal})
        if signal=='good':self.bad_since=None;return
        if self.bad_since is None or self.bad_target!=target:self.bad_since=now;self.bad_target=target;return
        if now-self.bad_since<4:return
        self.active={'target':target,'context':video['context']};self.persist()
        if launch({'luma':'no_signal','input':target[-1]}).get('returnValue'):status({'phase':'no-signal-dashboard','input':target[-1]})
        else:self.cancel()
def protected_hdmi(apps,cfg):
    """Leave the other HDMI input to its own device while LumaX is paired."""
    if not cfg.get('lumax_enabled') or os.path.exists(ROOT+'/lumax.suspended'):
        return None
    streamer='com.webos.app.hdmi'+str(cfg.get('lumax_input',1))
    return next((app for app in apps if app in ('com.webos.app.hdmi1','com.webos.app.hdmi2') and app!=streamer),None)

def main():
    handoff=Handoff();last_saver=0;last_protected=None
    while True:
        time.sleep(2)
        try:
            cfg=json.load(open(ROOT+'/runtime.json'))
            if not cfg.get('no_signal') and not cfg.get('screensaver'):
                if handoff.active:handoff.cancel()
                last_protected=None
                continue
            apps=[w.get('appId') for w in luna('com.webos.surfacemanager/getForegroundWindowInfo',{}).get('windows',[])]
            protected=protected_hdmi(apps,cfg)
            if protected or 'com.webos.app.screensaver' not in apps:
                last_protected=protected
            if protected or (last_protected and 'com.webos.app.screensaver' in apps):
                if handoff.active or handoff.bad_since is not None:handoff.cancel()
                continue
            if cfg.get('screensaver') and 'com.webos.app.screensaver' in apps and time.time()-last_saver>30:
                last_saver=time.time();luna('com.webos.surfacemanager/closeByAppId',{'id':'com.webos.app.screensaver'});launch({'luma':'idle'});status({'phase':'screensaver-dashboard'});continue
            if cfg.get('no_signal'):handoff.tick(apps,luna('com.webos.service.videooutput/getStatus',{}),time.time())
            else:handoff.cancel()
        except (IOError,ValueError,KeyError):continue
if __name__=='__main__':main()
