'use strict';
// HA Assist WebSocket protocol. No transcript/audio logging or disk storage.
var EventEmitter=require('events');
function Assist(WebSocket,connection){EventEmitter.call(this);this.WebSocket=WebSocket;this.connection=connection;this.seq=0;this.pending={};this.runId=null;this.handler=null;}
Assist.prototype=Object.create(EventEmitter.prototype);Assist.prototype.constructor=Assist;
Assist.prototype.connect=function(){var self=this;return new Promise(function(resolve,reject){
 var ws=self.ws=new self.WebSocket(self.connection.url.replace(/^http/,'ws')+'/api/websocket',{perMessageDeflate:false,maxPayload:2*1024*1024,handshakeTimeout:8000});
 var timer=setTimeout(function(){reject(Error('HA connection timed out.'));self.close();},10000);
 ws.on('error',function(){clearTimeout(timer);reject(Error('Could not connect to Home Assistant.'));});
 ws.on('close',function(){clearTimeout(timer);self.emit('disconnected');});
 ws.on('message',function(raw){var m;try{m=JSON.parse(raw.toString());}catch(_){return;}
  if(m.type==='auth_required')ws.send(JSON.stringify({type:'auth',access_token:self.connection.token}));
  else if(m.type==='auth_invalid'){clearTimeout(timer);reject(Error('HA pairing was revoked.'));self.close();}
  else if(m.type==='auth_ok'){clearTimeout(timer);resolve();}
  else if(m.type==='result'&&self.pending[m.id]){var p=self.pending[m.id];delete self.pending[m.id];clearTimeout(p.timer);if(m.success===false)p.reject(Error(m.error&&m.error.message||'HA rejected the request.'));else p.resolve(m.result);}
  else if(m.type==='event'&&m.id===self.runId){var e=m.event||{};if(e.type==='run-start')self.handler=e.data.runner_data.stt_binary_handler_id;self.emit('stage',e);}
 });
 });};
Assist.prototype.call=function(body){var self=this;return new Promise(function(resolve,reject){var id=++self.seq;var timer=setTimeout(function(){delete self.pending[id];reject(Error('HA request timed out.'));},10000);self.pending[id]={resolve:resolve,reject:reject,timer:timer};self.ws.send(JSON.stringify(Object.assign({},body,{id:id})));});};
Assist.prototype.run=function(pipeline,endStage,input,deviceId){this.runId=this.seq+1;var body={type:'assist_pipeline/run',pipeline:pipeline,start_stage:'stt',end_stage:endStage||'tts',input:Object.assign({sample_rate:16000,no_vad:true},input||{}),timeout:45};if(deviceId)body.device_id=deviceId;return this.call(body);};
Assist.prototype.audio=function(chunk){if(this.handler===null)throw Error('HA has not opened its audio handler.');this.ws.send(Buffer.concat([Buffer.from([this.handler]),chunk]),{binary:true});};
Assist.prototype.endAudio=function(){if(this.handler!==null)this.ws.send(Buffer.from([this.handler]),{binary:true});};
Assist.prototype.close=function(){Object.keys(this.pending).forEach(function(id){clearTimeout(this.pending[id].timer);this.pending[id].reject(Error('Voice session closed.'));},this);this.pending={};if(this.ws)this.ws.close();};
module.exports=Assist;
