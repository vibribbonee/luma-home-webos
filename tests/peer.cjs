const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process'),{once}=require('events');
const WebSocket=require('../src/com.spinoff.lumahome/runtime/vendor/ws');
const createServer=require('../peer/server'),p=require('../peer/protocol');
const loadIdentity=require('../peer/identity');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumax-peer-'));let server;
 const a='a'.repeat(32),b='b'.repeat(32);
 function cert(name){const base=path.join(dir,name);
  fs.writeFileSync(base+'.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',base+'.cnf','-keyout',base+'.key','-out',base+'.crt'],{stdio:'ignore'});
  const key=fs.readFileSync(base+'.key'),cert=fs.readFileSync(base+'.crt');return {key,cert,pin:p.fingerprint(new crypto.X509Certificate(cert).raw)};
 }
 try{
  const data=path.join(dir,'app-data');
  const first=loadIdentity(data,'webos');
  assert.deepEqual(loadIdentity(data,'webos'),first);
  assert.equal(fs.statSync(path.join(data,'device.json')).mode & 0o777,0o600);
  assert.throws(()=>loadIdentity(data,'android'));
  fs.writeFileSync(path.join(data,'device.json'),'broken');
  assert.throws(()=>loadIdentity(data,'webos'));
  const host=cert('host'),peer=cert('peer'),stranger=cert('stranger'),calls=[];
  server=createServer({identity:{id:a,platform:'webos'},key:host.key,cert:host.cert,peers:[{id:b,fingerprint:peer.pin}],handlers:{catalog:()=>{const value={};value.self=value;return value;},home:()=>{throw Error('Adapter failed');},state:()=>({input:2}),input:(args,auth)=>{calls.push({args,auth});return {ok:true};}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='wss://127.0.0.1:'+server.address().port+'/lumax/v1';
  async function reject(credentials,ca=host.cert){const ws=new WebSocket(url,{...credentials,ca});await new Promise((r,j)=>{ws.once('open',()=>{ws.terminate();j(Error('Unexpected access'));});ws.once('error',r);});}
  await reject(stranger);await reject({});await reject(peer,stranger.cert);
  const ws=new WebSocket(url,{key:peer.key,cert:peer.cert,ca:host.cert}),messages=[];ws.on('message',raw=>messages.push(JSON.parse(String(raw))));await once(ws,'open');
  async function reply(id,command,args){const start=messages.length;ws.send(JSON.stringify({id,command,args}));const until=Date.now()+1000;while(Date.now()<until){const value=messages.slice(start).find(m=>m.id===id);if(value)return value;await new Promise(r=>setTimeout(r,5));}throw Error('Missing reply');}
  assert.deepEqual((await reply(1,'state',{})).result,{input:2});
  assert.equal((await reply(2,'input',{port:1})).result.ok,true);
  assert.deepEqual(calls,[{args:{port:1},auth:{peer:b}}]);
  for(const [id,command,args] of [[3,'input',{port:3}],[4,'exec',{command:'anything'}],[5,'input',{port:1,extra:true}]])assert.equal((await reply(id,command,args)).error,'invalid_command');
  assert.equal((await reply(6,'catalog',{})).error,'unavailable');
  assert.equal((await reply(7,'home',{})).error,'unavailable');
  assert.deepEqual((await reply(8,'state',{})).result,{input:2});
  assert.equal((await reply(2,'input',{port:2})).error,'invalid_command');
  const binaryClient=new WebSocket(url,{key:peer.key,cert:peer.cert,ca:host.cert});
  binaryClient.on('error',()=>{});await once(binaryClient,'open');
  const binaryClosed=once(binaryClient,'close');
  binaryClient.send(Buffer.from(JSON.stringify({id:1,command:'input',args:{port:2}})));
  assert.equal((await binaryClosed)[0],1003);
  assert.equal(calls.length,1);assert.equal(messages.find(m=>m.type==='hello').device.id,a);
  const closed=once(ws,'close');server.replacePeers([]);await closed;await reject(peer);
  assert(p.candidate({id:a,platform:'webos',version:'1'},a));assert(!p.candidate({id:b,platform:'webos',version:'1'},a));assert(!p.candidate({id:a,platform:'webos',version:'2'},a));
  assert(p.validate('key',{key:'ok',session:b}));assert(!p.validate('key',{key:'ok',session:'stale-invalid'}));
  assert.deepEqual(Object.keys(p.advertisement({id:a,platform:'webos'})).sort(),['id','platform','version']);
  console.log('Passed: mutual TLS certificate pairing, wrong server/peer refusal, live revocation, command allowlist and identity-based discovery.');
 }finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
