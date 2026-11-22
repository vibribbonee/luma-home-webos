#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Observe Home, Input and the mic without grabbing the remote.

An independent supervisor enables the native Home filter while the observer
can read the remote. The observer never grabs or replaces an input device.
"""
from __future__ import print_function
import errno,fcntl,json,os,select,signal,struct,subprocess,sys,time
ROOT='/var/lib/webosbrew/lumahome'
HOME=773
MIC=428
INPUT=241  # Magic Remote source button on webOS 6.
FMT='llHHi'
SIZE=struct.calcsize(FMT)
HOLD=.65
HEALTH_INTERVAL=2
HEALTH_TIMEOUT=6
MIN_TEMP_BYTES=16*1024*1024
TRIAL='--trial' in sys.argv
SRC_NAME='LGE M-RCU - Builtin [0]'
ENABLED=ROOT+'/home-hook.enabled'
ACTIVE=ROOT+'/home-hook.active'
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
def session(report):
    src=os.open(device(),os.O_RDONLY|os.O_NONBLOCK)
    null=open(os.devnull,'wb');children=[];pressed=None;held=False;started=time.time();last_health=None
    def run(args):children.append(subprocess.Popen(args,stdout=null,stderr=null))
    def launch(app,params=None):
        body={'id':app,'keepAlive':True}
        if params:body['params']=params
        run(['/usr/bin/luna-send','-n','1','-f','luna://com.webos.applicationManager/launch',json.dumps(body)])
        log('Voice overlay' if params and params.get('voice') else 'Home '+('quick' if app.endswith('.overlay') else 'full'))
    def home_action(long_press):
        try:settings=json.load(open(ROOT+'/runtime.json'))
        except (IOError,ValueError):settings={}
        swap=bool(settings.get('home_swap',True))
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
            now=time.time()
            if last_health is None or now<last_health or now-last_health>=HEALTH_INTERVAL:
                report(True);last_health=now
            if TRIAL and time.time()-started>90:return
            home_ready=os.path.exists(ENABLED) and os.path.exists(ACTIVE)
            if not home_ready:pressed=None
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
                if code==INPUT and value==1:
                    try:input_settings=json.load(open(ROOT+'/runtime.json'))
                    except (IOError,ValueError):input_settings={}
                    if home_ready and input_settings.get('input_button_cycle',False):
                        run(['/usr/bin/python',ROOT+'/input-cycle.py'])
                    else:
                        # Stock Input mode retains LG's picker and its navigation.
                        run(['/usr/bin/luna-send','-w','800','-n','1','-f',
                             'luna://com.webos.surfacemanager/closeByAppId',
                             '{"id":"com.spinoff.lumahome.overlay"}'])
                if code==MIC and os.path.exists(ROOT+'/voice.enabled'):
                    if value==1:
                        open(ROOT+'/voice-held','w').close()
                        log('Mic pressed');run([ROOT+'/voice-control.sh','start-observed'])
                    elif value==0:
                        try:os.unlink(ROOT+'/voice-held')
                        except OSError:pass
                if code==HOME and home_ready:
                    if value==1 and pressed is None:pressed=time.time();held=False
                    elif value==0:
                        if pressed is not None and not held:home_action(False)
                        pressed=None;held=False
    finally:
        signal.alarm(0);os.close(src);null.close();report(False)
def stop(signum,frame):raise SystemExit(0)

class SupervisorStopped(Exception):
    pass

def native_filter(on):
    return subprocess.call([ROOT+'/home-native.sh','enable' if on else 'disable'])==0

def filter_enabled():
    if not os.path.exists(ENABLED):return False
    disk=os.statvfs('/tmp')
    return disk.f_bavail*disk.f_frsize>=MIN_TEMP_BYTES

def observe(writer):
    def report(healthy):
        try:os.write(writer,b'1' if healthy else b'0')
        except OSError as exc:
            if exc.errno==errno.EPIPE:raise SupervisorStopped()
            raise
    try:
        while enabled() or TRIAL:
            try:session(report)
            except SupervisorStopped:raise
            except Exception as exc:
                report(False)
                log('Observer paused: '+str(exc))
            if TRIAL:break
            time.sleep(1)
    except SupervisorStopped:
        native_filter(False)

def supervise(reader):
    requested=False
    try:
        while enabled() or TRIAL:
            ready,_,_=select.select([reader],[],[],HEALTH_TIMEOUT)
            status=os.read(reader,128) if ready else b'0'
            if not status:return
            healthy=status.endswith(b'1') and filter_enabled()
            if healthy==requested:continue
            requested=healthy
            if not native_filter(healthy):log('Native Home filter update failed')
    finally:
        if requested:native_filter(False)

def main():
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGALRM,stop)
    native_filter(False)
    reader,writer=os.pipe()
    for fd in (reader,writer):fcntl.fcntl(fd,fcntl.F_SETFD,fcntl.FD_CLOEXEC)
    worker=os.fork()
    if worker==0:
        os.close(reader)
        try:observe(writer)
        finally:os.close(writer)
        return
    os.close(writer)
    try:supervise(reader)
    finally:
        try:os.kill(worker,signal.SIGTERM)
        except OSError as exc:
            if exc.errno!=errno.ESRCH:raise
        os.waitpid(worker,0)
        os.close(reader)
        if TRIAL:
            try:os.unlink(ENABLED)
            except OSError:pass
        log('Observer stopped; native input was never grabbed.')
if __name__=='__main__':main()
