const assert=require('assert');
const WS=require('../vendor/ws');
const Assist=require('../tools/assist-client');
(async()=>{
 const server=new WS.Server({port:0,host:'127.0.0.1'});await new Promise(r=>server.on('listening',r));
 let audioBytes=0,ended=false,runId;
 server.on('connection',socket=>{
  socket.send(JSON.stringify({type:'auth_required'}));
  socket.on('message',data=>{
   if(Buffer.isBuffer(data)&&data[0]===7){assert.equal(data[0],7);if(data.length===1){ended=true;socket.send(JSON.stringify({id:runId,type:'event',event:{type:'stt-end',data:{stt_output:{text:'what time is it'}}}}));socket.send(JSON.stringify({id:runId,type:'event',event:{type:'run-end',data:{}}}));}else audioBytes+=data.length-1;return;}
   const m=JSON.parse(data);if(m.type==='auth'){assert.equal(m.access_token,'test-only');socket.send(JSON.stringify({type:'auth_ok'}));}
   if(m.type==='assist_pipeline/pipeline/list')socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:{preferred_pipeline:'local',pipelines:[{id:'local',stt_engine:'stt.local'}]}}));
   if(m.type==='luma_home/voice/config'){assert.equal(m.tv_id,'tv-stable-id');socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:{pipeline:'local',stt_engine:'stt.local',device_id:'luma-device',voice_reply:false}}));}
   if(m.type==='assist_pipeline/run'){assert.equal(m.device_id,'luma-device');assert.equal(m.end_stage,'intent');runId=m.id;assert.equal(m.start_stage,'stt');assert.equal(m.input.sample_rate,16000);socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:null}));socket.send(JSON.stringify({id:m.id,type:'event',event:{type:'run-start',data:{runner_data:{stt_binary_handler_id:7}}}}));}
  });
 });
 const client=new Assist(WS,{url:'http://127.0.0.1:'+server.address().port,token:'test-only'});
 try{
 await client.connect();const pipelines=await client.call({type:'assist_pipeline/pipeline/list'});assert.equal(pipelines.preferred_pipeline,'local');
 const finished=new Promise((resolve,reject)=>{client.on('stage',e=>{try{if(e.type==='run-start'){client.audio(Buffer.alloc(3200));client.audio(Buffer.alloc(6400));client.endAudio();}if(e.type==='run-end')resolve();}catch(err){reject(err);}});});
 const voice=await client.call({type:'luma_home/voice/config',tv_id:'tv-stable-id'});assert(voice.stt_engine);await client.run(voice.pipeline,voice.voice_reply===false?'intent':'tts',null,voice.device_id);await finished;assert.equal(audioBytes,9600);assert(ended);console.log('Passed: HA authentication, live per-TV assistant selection, device context and disabled-TTS routing, correctly prefixed binary PCM frames, explicit end of audio, and pipeline completion.');
 }finally{client.close();for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
