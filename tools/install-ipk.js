'use strict';
var cp=require('child_process'),id=process.argv[2],version=process.argv[3];
if(!/^com\.spinoff\.lumahome(?:\.overlay)?$/.test(id)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid package');
var p=cp.spawn('/usr/bin/luna-send',['-i','-f','luna://com.webos.appInstallService/dev/install',JSON.stringify({id:id,ipkUrl:'/tmp/'+id+'_'+version+'_all.ipk',subscribe:true})]),out='',last='',done=false;
var timer=setTimeout(function(){end(false,'Install timed out; check installed version before retrying.');},45000);
function end(ok,message){if(done)return;done=true;clearTimeout(timer);p.kill();console.log(message);process.exitCode=ok?0:1;}
p.stdout.on('data',function(b){out+=b;var matches=out.match(/"state"\s*:\s*"[^"]+"/g)||[];var state=matches.length?matches[matches.length-1].split('"')[3]:'';if(state!==last){last=state;console.log(id+': '+state);}if(state==='installed')end(true,'Installed '+id+' '+version);else if(/"returnValue"\s*:\s*false/.test(out))end(false,'Installation rejected.');});p.on('error',function(){end(false,'Installer did not start.');});
