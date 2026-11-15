const cp=require('child_process'),path=require('path');
cp.execFileSync('python3',['-c',String.raw`
import importlib.util,tempfile,os,json
spec=importlib.util.spec_from_file_location('ambient','tools/ambient-watch.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
with tempfile.TemporaryDirectory() as root:
 a.ROOT=root;a.AUTO=root+'/ambient-auto';signals={'old':'bad','new':'good'};calls=[]
 a.status=lambda value:None
 def luna(method,body):return {'returnValue':True,'signalState':{'videoSignalState':signals.get(body['pipelineId'],'bad')}}
 def launch(params):calls.append(params);return {'returnValue':True}
 a.luna=luna;a.launch=launch
 h=a.Handoff();video={'video':[{'sink':'MAIN','appId':'com.webos.app.hdmi2','context':'old'}]}
 h.tick(['com.spinoff.lumahome','com.webos.app.hdmi2'],video,0);h.tick(['com.spinoff.lumahome','com.webos.app.hdmi2'],video,8);assert not calls,'do not replace an open menu'
 h.tick(['com.webos.app.hdmi2'],video,10);h.tick(['com.webos.app.hdmi2'],video,12);assert not calls
 h.tick(['com.webos.app.hdmi2'],video,14);assert calls[-1]=={'luma':'no_signal','input':'2'};assert os.path.exists(a.AUTO)
 # Daemon restart resumes the pending source rather than losing return-on-signal.
 h=a.Handoff();assert h.active['target']=='com.webos.app.hdmi2'
 # Native pipeline context changes while the dashboard is visible.
 video={'video':[{'sink':'MAIN','appId':'com.webos.app.hdmi2','context':'new'}]}
 h.tick(['com.spinoff.lumahome','com.webos.app.hdmi2'],video,16);assert len(calls)==1,'require stable recovery'
 h.tick(['com.spinoff.lumahome','com.webos.app.hdmi2'],video,18);assert calls[-1]=={'luma':'input','input':'2','watch':True};assert h.active is None and not os.path.exists(a.AUTO)
 # Explicit dismissal/another app cancels an outstanding automatic return.
 h.active={'target':'com.webos.app.hdmi2','context':'new'};h.persist();h.tick(['org.jellyfin.webos'],video,20);assert h.active is None
print('Passed: no-signal dashboard, no interruption of an open menu, durable return state, changed pipeline contexts, stable recovery and explicit cancellation.')
`],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
