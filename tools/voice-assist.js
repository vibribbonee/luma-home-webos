'use strict';
var fs=require('fs'),cp=require('child_process'),net=require('net');
var ROOT='/var/lib/webosbrew/lumahome',Assist=require('./assist-client'),WebSocket=require('./vendor/ws');
var client,stream,socket,done=false,capturing=false,sent=0,transcript='',answer='',audioUrl='',pipelineReady=false,micRestored=false,streamBusy=false,lastMicError='',gotRun=false;
var timers=[],intervals=[],phase='starting',lastError='',gate=null,started=false,startedAt=0,timing={};
function log(m){try{console.log(new Date().toISOString()+' '+m);}catch(_){}}
function status(){try{fs.writeFileSync(ROOT+'/voice-status.json',JSON.stringify({phase:phase,error:lastError,micError:lastMicError,bytesSent:sent,recognizedCharacters:transcript.length,responseCharacters:answer.length,ttsReady:!!audioUrl,micRestored:micRestored,timing:timing,time:Date.now()}),{mode:384});}catch(_){}}
function later(fn,ms){var t=setTimeout(fn,ms);timers.push(t);return t;}
function every(fn,ms){var t=setInterval(fn,ms);intervals.push(t);return t;}
function card(nextPhase,message){phase=nextPhase;log('phase '+nextPhase);status();var voice={phase:nextPhase,message:message||'',transcript:transcript};if(audioUrl)voice.audioUrl=audioUrl;var p=cp.spawn('/usr/bin/luna-send',['-n','1','-f','luna://com.webos.applicationManager/launch',JSON.stringify({id:'com.spinoff.lumahome.overlay',keepAlive:true,params:{voice:voice}})],{stdio:'ignore'});p.on('error',function(){});later(function(){p.kill();},2500);}
function restoreMic(){if(micRestored)return;micRestored=true;if(stream)stream.kill();if(socket)socket.destroy();cp.spawnSync('/bin/sh',[ROOT+'/voice-session.sh','restore'],{timeout:4000,stdio:'ignore'});status();}
function finishCapture(){if(!capturing)return;capturing=false;restoreMic();log('capture finished, audio bytes='+sent);if(sent>0){client.endAudio();card('thinking','Home Assistant is thinking…');}else fail('No audio captured. Hold the mic button while speaking.');}
function finish(error){if(done)return;done=true;timers.forEach(clearTimeout);intervals.forEach(clearInterval);restoreMic();if(client)client.close();if(error)card('error',error);if(gate)gate.complete(!error);later(function(){process.exit(error?1:0);},200);}
function fail(message){lastError=message;log('fail: '+message);finish(message);}
function stop(){if(started)finish();else process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('uncaughtException',function(){fail('Voice stopped safely. Try again.');});process.on('unhandledRejection',function(){fail('Voice stopped safely. Try again.');});
function connectBuffer(){return new Promise(function(resolve,reject){
 var header=Buffer.alloc(0),connected=false,attempts=0;
 function attempt(){if(done)return;var s=net.connect(ROOT+'/voice-buffer.sock');
  s.on('connect',function(){socket=s;capturing=true;connected=true;timing.bufferMs=Date.now()-startedAt;status();resolve();});
  s.on('error',function(){if(!connected&&++attempts<25)later(attempt,100);else if(!done)reject(Error('Microphone buffer unavailable.'));});
  s.on('data',function(chunk){if(!capturing||done)return;if(header!==null){header=Buffer.concat([header,chunk]);var at=header.indexOf(10);if(at<0)return;chunk=header.slice(at+1);header=null;}if(chunk.length){sent+=chunk.length;client.audio(chunk);}});
  s.on('end',function(){if(capturing)finishCapture();});
 }attempt();
});}
async function main(){
 started=true;startedAt=Date.now();timing.startedAt=startedAt;
 try{var cfg=JSON.parse(fs.readFileSync(ROOT+'/runtime.json','utf8'));}catch(_){var cfg={};}
 phase='connecting';status();
 var connection=await require('/media/developer/apps/usr/palm/applications/com.spinoff.lumahome/discover-ha.js').connection({fast:true,credentials:true});
 timing.discoveryMs=Date.now()-startedAt;client=new Assist(WebSocket,connection);client.on('disconnected',function(){if(!done)fail('Home Assistant disconnected.');});
 client.on('stage',function(event){if(done)return;var data=event.data||{};
  if(event.type==='run-start'){timing.pipelineMs=Date.now()-startedAt;gotRun=true;pipelineReady=true;connectBuffer().catch(function(e){fail(e.message);});}
  else if(event.type==='stt-vad-end')log('HA VAD event ignored; local capture controls duration.');
  else if(event.type==='stt-end'){transcript=data.stt_output&&data.stt_output.text||'';finishCapture();card('thinking','Home Assistant is thinking…');}
  else if(event.type==='intent-end'){var response=data.intent_output&&data.intent_output.response;answer=response&&response.speech&&response.speech.plain&&response.speech.plain.speech||'';}
  else if(event.type==='tts-end'){var output=data.tts_output||{},url=output.url||'';if(cfg.voice_reply!==false){if(url.charAt(0)==='/')audioUrl=connection.url+url;else if(url.indexOf(connection.url+'/')===0)audioUrl=url;}}
  else if(event.type==='error')fail(data.message||'Home Assistant could not process that request.');
  else if(event.type==='run-end'){later(function(){if(done)return;card('reply',answer||'Done.');finish();},250);}
 });
 await client.connect();timing.authMs=Date.now()-startedAt;var chosen=await client.call({type:'luma_home/voice/config',tv_id:connection.tv_id});cfg.voice_reply=chosen.voice_reply;
 // Honor the configured HA pipeline; never add an LG or other assistant fallback.
 if(!chosen||!chosen.stt_engine)throw Error('Choose a Home Assistant voice pipeline with speech recognition.');
 await client.run(chosen.pipeline,cfg.voice_reply===false?'intent':'tts',null,chosen.device_id);
 later(function(){if(capturing)finishCapture();},35000);
 later(function(){if(!done)fail('Home Assistant took too long to reply.');},55000);
}
function begin(){main().catch(function(e){fail(e.message||'Could not start Home Assistant voice.');});}
if(process.argv.indexOf('--standby')>=0){require('./voice-standby')({socketPath:ROOT+'/voice-worker.sock',pidPath:ROOT+'/voice-worker.pid',activePidPath:ROOT+'/voice.pid'}).then(function(control){gate=control;begin();}).catch(function(){process.exit(1);});}else begin();
