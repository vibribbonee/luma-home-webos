const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process');
const context={Qt:{Key_Super_L:1,Key_Menu:2},WebOS:{Key_webOS_Recent:3,Key_webOS_InputSource:4},KeyPolicy:{Accepted:1,NextPolicy:0}};
vm.createContext(context);vm.runInContext(fs.readFileSync('tools/home-keyfilter.js','utf8'),context);
assert.equal(context.handleLumaHome(4,true,false),0,'stock Input remains available until opted in');
context.lumaCycleInputs=true;
assert.equal(context.handleLumaHome(4,true,false),1);
assert.equal(context.handleLumaHome(4,false,false),1);
assert.equal(context.handleLumaHome(99,true,false),0,'unrelated remote keys are preserved');
cp.execFileSync('python3',['-c',String.raw`
import importlib.util,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cycle','tools/input-cycle.py')
cycle=importlib.util.module_from_spec(spec);spec.loader.exec_module(cycle)
for current,expected in [('com.webos.app.hdmi1',2),('com.webos.app.hdmi2',1),('youtube.leanback.v4',1)]:
 with tempfile.TemporaryDirectory() as root:
  cycle.ROOT=root;calls=[];ports=[]
  def luna(method,body):
   calls.append((method,body));return {'appId':current}
  with patch.object(cycle,'luna',side_effect=luna),patch.object(cycle,'select_input',side_effect=ports.append):cycle.main()
  assert ports==[expected],(ports,expected)
  assert calls[0][0]=='com.webos.surfacemanager/closeByAppId'
  assert calls[1][0]=='com.webos.applicationManager/getForegroundAppInfo'
`],{stdio:'inherit'});
console.log('Passed: optional Input interception, preserved remote keys, and deterministic HDMI cycling.');
