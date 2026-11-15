'use strict';
// Metadata-only audio-path probe: discards each chunk after counting it.
var cp=require('child_process'),net=require('net');
var stream=cp.spawn('/usr/bin/luna-send',['-i','-f','luna://com.webos.service.voiceinput/startStreaming','{"deviceType":"remote","keyType":"thinQtv","subscribe":true}']);
var reply='',socket=null,bytes=0,peak=0,done=false,connected=false,tries=0;
stream.stdout.on('data',function(b){reply+=b.toString();});
stream.on('error',function(){finish('Driver request could not start.');});
function finish(error){
 if(done)return;done=true;clearInterval(retry);clearTimeout(limit);if(socket)socket.destroy();stream.kill();
 var response;try{response=JSON.parse(reply);}catch(_){}
 console.log(JSON.stringify({socketConnected:connected,bytesReceived:bytes,peakSample:peak,driverAccepted:response&&response.returnValue,error:error||(response&&response.errorText)||null,audioSaved:false,audioTransmitted:false}));
}
function connect(){
 if(socket||done)return;tries++;
 var s=net.connect('/tmp/voiceinput_remote1.soc');
 s.on('connect',function(){socket=s;connected=true;});
 s.on('error',function(){});
 s.on('close',function(){if(socket===s)socket=null;});
 s.on('data',function(chunk){bytes+=chunk.length;for(var i=0;i+1<chunk.length;i+=2)peak=Math.max(peak,Math.abs(chunk.readInt16LE(i)));if(bytes>=16000*2*3)finish();});
}
var retry=setInterval(connect,200),limit=setTimeout(function(){finish(bytes?null:'No remote audio arrived within the test window.');},18000);
