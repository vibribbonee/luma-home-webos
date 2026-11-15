'use strict';
// A local start gate: no microphone or network is opened while waiting.
var fs=require('fs'),net=require('net');
module.exports=function(options){
 var server,control,active=false,owned=false;
 function ownsPid(){try{return Number(fs.readFileSync(options.pidPath,'utf8'))===process.pid;}catch(_){return false;}}
 function unlink(path){try{fs.unlinkSync(path);}catch(_){}}
 function cleanup(){if(!owned||!ownsPid())return;unlink(options.pidPath);unlink(options.socketPath);owned=false;}
 function complete(success){cleanup();if(control){control.end(JSON.stringify({done:true,success:success!==false})+'\n');control=null;}}
 process.on('exit',cleanup);
 return new Promise(function(resolve,reject){
  // The launcher serializes startup and verifies any existing process first.
  unlink(options.socketPath);
  server=net.createServer(function(socket){
   var data='';socket.setTimeout(2000,function(){if(socket!==control)socket.destroy();});
   socket.on('error',function(){});
   socket.on('data',function(chunk){
    data+=chunk.toString();if(data.length>128){socket.destroy();return;}if(data.indexOf('\n')<0)return;
    var command=data.trim();data='';
    if(command==='ping'){socket.end('ready\n');return;}
    if(command!=='start'||active){socket.end('busy\n');return;}
    active=true;control=socket;socket.setTimeout(0);server.close();unlink(options.socketPath);
    fs.writeFileSync(options.activePidPath,String(process.pid),{mode:384});
    socket.write('started\n');resolve({complete:complete});
   });
  });
  server.on('error',function(error){cleanup();reject(error);});
  server.listen(options.socketPath,function(){
   fs.chmodSync(options.socketPath,384);fs.writeFileSync(options.pidPath,String(process.pid),{mode:384});owned=true;
  });
 });
};
