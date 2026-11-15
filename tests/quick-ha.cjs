// Quick panel against a mocked Home Assistant: brightness slider, scoped subscription, streamer-app buttons.
const {launch}=require('./_launch.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');const boot=JSON.parse(fs.readFileSync(root+'/ha/bootstrap.json'));
(async()=>{
 const browser=await launch();
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({boot})=>{
  const states={};for(const [key,id] of Object.entries(boot.helpers))states[id]={entity_id:id,state:key==='controls'?'["light.test","switch.example"]':key==='room'?'Test room':'',attributes:{}};
  states['light.test']={entity_id:'light.test',state:'on',attributes:{friendly_name:'Test light',supported_color_modes:['brightness'],brightness:204}};
  states['switch.example']={entity_id:'switch.example',state:'off',attributes:{friendly_name:'Test switch'}};
  window.mockLaunches=[];window.mockCalls=[];window.mockTriggers=[];window.mockHidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.mockHidden});
  window.webOSSystem={launchParams:'{"quick":true}',keepAlive:false,activate(){window.mockHidden=false;},hide(){window.mockHidden=true;document.dispatchEvent(new Event('visibilitychange'));}};
  window.PalmServiceBridge=class{call(uri,raw){setTimeout(()=>{const p=JSON.parse(raw);if(uri.includes('hbchannel'))this.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify({url:'http://ha.invalid',token:'test-only'})}));else{window.mockLaunches.push(p.id);this.onservicecallback('{"returnValue":true}');}},0);}cancel(){}};
  window.WebSocket=class{constructor(){this.readyState=1;window.mockSocket=this;setTimeout(()=>this.emit({type:'auth_required'}),0);}
   emit(m){if(this.onmessage)this.onmessage({data:JSON.stringify(m)});}
   send(raw){const m=JSON.parse(raw);setTimeout(()=>{
    if(m.type==='auth')return this.emit({type:'auth_ok'});
    if(m.type==='get_states')return this.emit({type:'result',id:m.id,success:true,result:Object.values(states)});
    if(m.type==='subscribe_trigger'){this.sub=m.id;window.mockTriggers.push(m.trigger.entity_id);return this.emit({type:'result',id:m.id,success:true,result:null});}
    if(m.type==='call_service'){window.mockCalls.push({domain:m.domain,service:m.service,entity:m.target.entity_id,data:m.service_data});return this.emit({type:'result',id:m.id,success:true,result:null});}
    if(m.type==='ping')this.emit({type:'pong',id:m.id});
   },0);}
   close(){this.readyState=3;if(this.onclose)this.onclose();}};
 },{boot});
 await page.goto('file://'+root+'/src/com.spinoff.lumahome.overlay/index.html');
 await page.locator('#quickPanel [data-dim]').waitFor({state:'attached'});
 assert.equal(await page.locator('[data-dim]').count(),1,'only the dimmable light has a fill');
 assert.equal(await page.locator('[data-dim] .fill').evaluate(el=>el.style.width),'80%');
 const watched=await page.evaluate(()=>window.mockTriggers[0]);
 assert(watched.includes('light.test')&&watched.includes('switch.example')&&watched.length<30,'scoped subscription');
 await page.locator('[data-dim]').focus();await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>window.mockCalls.some(c=>c.service==='turn_on'&&c.data.brightness_pct===90));
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.entity),'light.test','Left/Right dim instead of moving focus');
 await page.keyboard.press('ArrowDown');
 assert.notEqual(await page.evaluate(()=>document.activeElement.dataset.entity),'light.test');
 await page.getByRole('button',{name:'SmartTube'}).click();
 await page.waitForFunction(()=>window.mockCalls.some(c=>c.domain==='script'&&c.entity==='script.luma_launch_smarttube'));
 await page.waitForFunction(()=>window.mockLaunches.includes('com.webos.app.hdmi1'));
 assert.deepStrictEqual(errors,[]);
 console.log('Passed: quick-panel brightness tile and key handling, scoped HA subscription, SmartTube launch via HA script then HDMI 1.');
 }finally{await browser.close();}
})();
