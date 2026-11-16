// Exercise the actual passive observer against a simulated event device.
const cp=require('child_process'),path=require('path');
const script=String.raw`
import importlib.util,io,json,os,struct,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hook','tools/home-hook.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
for swap in (None,False,True):
 for duration in (.2,1.2):
  with tempfile.TemporaryDirectory() as root:
   h.ROOT=root;h.ENABLED=root+'/home-hook.enabled';open(h.ENABLED,'w').close()
   h.ACTIVE=root+'/home-hook.active';open(h.ACTIVE,'w').close()
   with open(root+'/runtime.json','w') as f:json.dump({} if swap is None else {'home_swap':swap},f)
   clock=[0.0];events=[(0,1),(.1,2)]+([(.3,1),(.6,2)] if duration>1 else [])+[(duration,0),(duration+.05,1,h.INPUT),(duration+.10,2,h.INPUT),(duration+.15,0,h.INPUT)];calls=[]
   class Process:
    def __init__(self,args,**kw):self.args=args;calls.append(args);self.stdout=io.BytesIO(b'{"appId":"com.webos.app.hdmi2"}');self.stdin=io.BytesIO()
    def poll(self):return 0
    def wait(self):return 0
   def select(read,write,error,timeout):
    clock[0]+=timeout
    return ([42] if events and events[0][0]<=clock[0] else [],[],[])
   def read(fd,count):
    when,value,*key=events.pop(0)
    return struct.pack(h.FMT,0,0,1,key[0] if key else h.HOME,value)
   with patch.object(h,'device',return_value='/fake'),patch.object(h,'enabled',side_effect=lambda:clock[0]<duration+.2),patch.object(h.time,'time',side_effect=lambda:clock[0]),patch.object(h.select,'select',side_effect=select),patch.object(h.os,'open',return_value=42),patch.object(h.os,'read',side_effect=read),patch.object(h.os,'close'),patch.object(h.subprocess,'Popen',Process),patch.object(h.signal,'alarm'):
    h.session(lambda healthy:None)
   launches=[json.loads(c[-1]) for c in calls if 'luna://com.webos.applicationManager/launch' in c]
   assert len(launches)==1,(swap,duration,launches)
   dismissals=[json.loads(c[-1]) for c in calls if 'luna://com.webos.surfacemanager/closeByAppId' in c]
   assert dismissals==[{'id':'com.spinoff.lumahome.overlay'}],dismissals
   full=(duration>.65)!=(True if swap is None else swap)
   assert launches[0]['id']==('com.spinoff.lumahome' if full else 'com.spinoff.lumahome.overlay')
   if full:assert launches[0]['params']=={'luma':'home','input':'2'}
   else:assert launches[0]['params']['toggle'] is False
with tempfile.TemporaryDirectory() as root:
 h.ENABLED=root+'/home-hook.enabled';open(h.ENABLED,'w').close()
 actions=[]
 health=iter([(([42],[],[]),b'1')]*1000+[ (([],[],[]),b'0'), (([42],[],[]),b'1'), (([42],[],[]),b'') ])
 statuses=[]
 def poll(*args):
  ready,status=next(health)
  if ready[0]:statuses.append(status)
  return ready
 with patch.object(h,'enabled',return_value=True),patch.object(h.select,'select',side_effect=poll),patch.object(h.os,'read',side_effect=lambda *args:statuses.pop(0)),patch.object(h,'native_filter',side_effect=lambda on:actions.append(on) or True):
  h.supervise(42)
 assert actions==[True,False,True,False],actions
 with patch.object(h.os,'statvfs',return_value=type('Disk',(),{'f_bavail':1024,'f_frsize':4096})()):
  assert not h.filter_enabled(),'Low temporary storage keeps the native Home behavior'
print('Passed: healthy input needs one filter install; timeout and worker exit restore the native Home button.')
print('Passed: Home tap/hold swap, repeated key-down suppression, one action per gesture and preservation of HDMI 2.')
`;
cp.execFileSync('python3',['-c',script],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
