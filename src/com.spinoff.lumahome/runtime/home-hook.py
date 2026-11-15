#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Observe Home/mic only. Pointer, wheel and keys remain on LG's original device.

LG Home's unique executable is reversibly redirected by home-native.sh. There
is no EVIOCGRAB, uinput clone, or forwarding into another Magic Remote slot.
"""
from __future__ import print_function
import errno,json,os,select,signal,struct,subprocess,sys,time
ROOT='/var/lib/webosbrew/lumahome'
HOME=773
MIC=428
FMT='llHHi'
SIZE=struct.calcsize(FMT)
HOLD=.65
TRIAL='--trial' in sys.argv
SRC_NAME='LGE M-RCU - Builtin [0]'
ENABLED=ROOT+'/home-hook.enabled'
def log(message):
    print(time.strftime('%H:%M:%S')+' '+message);sys.stdout.flush()
def device():
    for block in open('/proc/bus/input/devices').read().split('\n\n'):
        if 'N: Name="'+SRC_NAME+'"' not in block:continue
        for line in block.splitlines():
            if line.startswith('H: Handlers='):
                for token in line.split():
                    if token.startswith('event'):return '/dev/input/'+token
    raise RuntimeError('Magic Remote is asleep or re-pairing')
def enabled():return os.path.exists(ENABLED) or os.path.exists(ROOT+'/voice.enabled')
def session():
    src=os.open(device(),os.O_RDONLY|os.O_NONBLOCK)
    null=open(os.devnull,'wb');children=[];pressed=None;held=False;started=time.time();last_lease=0
    def run(args):children.append(subprocess.Popen(args,stdout=null,stderr=null))
    def launch(app,params=None):
        body={'id':app,'keepAlive':True}
        if params:body['params']=params
        run(['/usr/bin/luna-send','-n','1','-f','luna://com.webos.applicationManager/launch',json.dumps(body)])
        log('Voice overlay' if params and params.get('voice') else 'Home '+('quick' if app.endswith('.overlay') else 'full'))
    def home_action(long_press):
        try:settings=json.load(open(ROOT+'/runtime.json'))
        except (IOError,ValueError):settings={}
        swap=bool(settings.get('home_swap',False))
        if settings.get('lumax_enabled') and not os.path.exists(ROOT+'/lumax.suspended'):
            run(['/usr/bin/python',ROOT+'/lumax-home.py','home' if long_press != swap else 'quick'])
            return
        if long_press != swap:
            params={'luma':'home'}
            try:
                p=subprocess.Popen(['/usr/bin/luna-send','-w','800','-n','1','-f','luna://com.webos.applicationManager/getForegroundAppInfo','{}'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=null)
                response=p.stdout.read();p.wait();p.stdin.close();current=json.loads(response).get('appId','')
                if current in ('com.webos.app.hdmi1','com.webos.app.hdmi2'):params['input']=current[-1]
            except (ValueError,IOError):pass
            launch('com.spinoff.lumahome',params)
        else:launch('com.spinoff.lumahome.overlay',{'quick':True,'toggle':False})
    log('Passive Home/mic observer active; native pointer and keys are untouched.')
    try:
        while enabled() or TRIAL:
            signal.alarm(5)
            if os.path.exists(ENABLED) and time.time()-last_lease>=5:
                last_lease=time.time();run(['/usr/bin/python',ROOT+'/home-keyfilter.py','lease'])
            if TRIAL and time.time()-started>90:return
            if pressed is not None and not held and time.time()-pressed>=HOLD:
                held=True;home_action(True)
            children[:]=[p for p in children if p.poll() is None]
            ready,_,_=select.select([src],[],[],.04)
            if not ready:continue
            try:data=os.read(src,SIZE*64)
            except OSError as e:
                if e.errno in (errno.EAGAIN,errno.EINTR):continue
                raise
            if not data:raise RuntimeError('Remote disconnected')
            for i in range(0,len(data)-SIZE+1,SIZE):
                sec,usec,kind,code,value=struct.unpack(FMT,data[i:i+SIZE])
                if kind!=1:continue
                if code==MIC and os.path.exists(ROOT+'/voice.enabled'):
                    if value==1:
                        open(ROOT+'/voice-held','w').close();launch('com.spinoff.lumahome.overlay',{'voice':{'phase':'starting','message':'Starting microphone...'}});log('Mic pressed');run([ROOT+'/voice-control.sh','start-observed'])
                    elif value==0:
                        try:os.unlink(ROOT+'/voice-held')
                        except OSError:pass
                if code==HOME and os.path.exists(ENABLED):
                    if value==1 and pressed is None:pressed=time.time();held=False
                    elif value==0:
                        if pressed is not None and not held:home_action(False)
                        pressed=None;held=False
    finally:
        signal.alarm(0);os.close(src);null.close()
def stop(signum,frame):raise SystemExit(0)
def main():
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGALRM,stop)
    try:
        while enabled() or TRIAL:
            try:session()
            except Exception as exc:log('Observer paused: '+str(exc))
            if TRIAL:break
            time.sleep(1)
    finally:
        if TRIAL:
            try:os.unlink(ENABLED)
            except OSError:pass
        subprocess.call([ROOT+'/home-native.sh','disable'])
        log('Observer stopped; native input was never grabbed.')
if __name__=='__main__':main()
