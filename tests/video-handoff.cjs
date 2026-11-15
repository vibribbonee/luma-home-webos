const {spawnSync}=require('child_process'),assert=require('assert'),path=require('path');
const py=String.raw`
import sys
source=open(sys.argv[1]).read(); ns={'__name__':'handoff_test'};exec(compile(source,sys.argv[1],'exec'),ns)
def check(foreground='com.webos.app.hdmi1',menu=False,opacity=0):
 state={'now':0.,'opacity':opacity,'writes':[],'phases':[]}
 class Clock:
  def time(self):return state['now']
  def sleep(self,n):state['now']+=n
 def luna(method,body):
  if method.endswith('getForegroundWindowInfo'):return {'windows':[{'appId':'com.spinoff.lumahome'}] if menu else [{'appId':foreground}]}
  if method.endswith('getForegroundAppInfo'):return {'appId':foreground}
  if method.endswith('getStatus'):return {'video':[{'sink':'MAIN','connected':True,'appId':'com.webos.app.hdmi1','opacity':state['opacity'],'zOrder':0,'context':'native-context'}]}
  if method.endswith('setCompositing'):state['writes'].append(body);state['opacity']=255;return {'returnValue':True}
 def save(target,phase,started,**details):state['phases'].append(phase)
 ns['time']=Clock();ns['luna']=luna;ns['save']=save;result=ns['main']('com.webos.app.hdmi1');return result,state
r,s=check();assert r==0 and s['opacity']==255 and len(s['writes'])==1 and s['phases'][-1]=='visible'
assert s['writes'][0]['composeOrder'][0]['context']=='native-context'
r,s=check(foreground='com.webos.app.browser');assert not s['writes'] and s['phases'][-1]=='cancelled-other-app'
r,s=check(menu=True);assert not s['writes'] and s['phases'][-1]=='timeout' and s['now']<10
r,s=check(opacity=255);assert r==0 and not s['writes']
print('Passed: bounded native HDMI repair restores its current context, preserves visible video, waits for a hidden menu and stops for another foreground app.')
`;
const r=spawnSync(process.env.PYTHON_PATH||'python3',['-c',py,path.join(__dirname,'../tools/input-handoff.py')],{encoding:'utf8'});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.equal(r.status,0);
