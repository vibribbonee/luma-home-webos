const fs=require('fs');
const host=process.env.LUMA_TV_HOST;
if (!host) throw new Error('Set LUMA_TV_HOST to the TV hostname or IP address.');
(async()=>{
 const targets=await(await fetch('http://'+host+':9998/json/list')).json();
 const target=targets.find(t=>t.url.includes('/com.spinoff.lumahome/'+(process.env.LUMA_OVERLAY?'../':''))||(!process.env.LUMA_OVERLAY&&t.url.includes('/com.spinoff.lumahome/index.html')));
 const selected=process.env.LUMA_OVERLAY?targets.find(t=>t.url.includes('/com.spinoff.lumahome.overlay/index.html')):target;
 if(!selected)throw Error('Luma app is not running.');
 const ws=new WebSocket(selected.webSocketDebuggerUrl.replace('127.0.0.1',host));let seq=0,pending={};
 const connect=new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(pending[m.id]){const p=pending[m.id];delete pending[m.id];if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}};
 function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending[id]={resolve,reject};ws.send(JSON.stringify({id,method,params}));});}
 await connect;
 try{
 const expression=process.env.LUMA_EXPRESSION||'JSON.stringify({status:window.lumaStatus&&window.lumaStatus(),message:document.getElementById("haStatus")&&document.getElementById("haStatus").textContent,dimensions:[innerWidth,innerHeight],bottom:document.querySelector("footer")&&document.querySelector("footer").getBoundingClientRect().bottom,userAgent:navigator.userAgent})';
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)console.log(JSON.stringify(r.exceptionDetails));else console.log(r.result.value);
 if(process.env.LUMA_SCREENSHOT){const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.LUMA_SCREENSHOT,Buffer.from(image.data,'base64'));console.log('Screenshot saved.');}
 }finally{ws.close();}
})();
