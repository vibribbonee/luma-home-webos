const {spawn}=require('child_process');
const host=process.env.LUMA_TV_HOST,id=process.env.LUMA_BENCH_OVERLAY?'com.spinoff.lumahome.overlay':'com.spinoff.lumahome';
if (!host) throw new Error('Set LUMA_TV_HOST to the TV hostname or IP address.');
function quote(s){return "'"+s.replace(/'/g,"'\\''")+"'";}
function luna(method,body){return new Promise((resolve,reject)=>{const p=spawn('ssh',['-S','/tmp/luma-home-tv.sock','-tt','root@'+host,'luna-send -n 1 -f luna://com.webos.applicationManager/'+method+' '+quote(JSON.stringify(body))],{stdio:['ignore','pipe','pipe']});p.on('error',reject);p.on('close',resolve);});}
function pause(ms){return new Promise(r=>setTimeout(r,ms));}
async function check(){
 const list=await(await fetch('http://'+host+':9998/json/list')).json();const target=list.find(t=>t.url.includes('/'+id+'/index.html'));if(!target)return null;
 const ws=new WebSocket(target.webSocketDebuggerUrl.replace('127.0.0.1',host));
 return new Promise((resolve)=>{
  const timeout=setTimeout(()=>{ws.close();resolve(null);},1000);
  ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression:'JSON.stringify({visible:!document.hidden,ready:!!window.Luma&&document.readyState==="complete"&&!!document.querySelector("'+(process.env.LUMA_BENCH_OVERLAY?'#quickPanel':'#apps')+'"),scriptMs:performance.now(),ha:window.lumaStatus&&window.lumaStatus().haConnected})'}}));
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id===1){clearTimeout(timeout);ws.close();try{resolve(JSON.parse(r.result.result.value));}catch(_){resolve(null);}}};ws.onerror=()=>{clearTimeout(timeout);resolve(null);};
 });
}
async function measure(kind){const start=Date.now();await luna('launch',{id,keepAlive:true,params:process.env.LUMA_BENCH_OVERLAY?{quick:true}:{}});let result;while(Date.now()-start<15000){result=await check();if(result&&result.visible&&result.ready)return {kind,visibleMs:Date.now()-start,documentMs:Math.round(result.scriptMs),haConnected:result.ha};await pause(80);}return {kind,timeout:true,last:result};}
(async()=>{console.log(JSON.stringify(await measure('open')));})();
