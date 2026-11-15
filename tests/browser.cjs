const {launch}=require('./_launch.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');const boot=JSON.parse(fs.readFileSync(root+'/ha/bootstrap.json'));
(async()=>{
 const browser=await launch();
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({boot})=>{
  const states={};for(const [key,id]of Object.entries(boot.helpers)){let state='';if(key==='pins')state=JSON.stringify(boot.defaultPins);if(key==='controls')state='["switch.example","light.test"]';if(key==='room')state='Test room';if(key==='idle')state='2';if(key==='theme')state='Twilight';if(key==='climate')state='on';states[id]={entity_id:id,state,attributes:{}};}
  states['switch.example']={entity_id:'switch.example',state:'off',attributes:{friendly_name:'Test switch'}};
  states['light.test']={entity_id:'light.test',state:'on',attributes:{friendly_name:'Test light',supported_color_modes:['brightness'],brightness:128}};
  window.mockStates=states;window.mockLaunches=[];window.mockLaunchLog=[];window.mockCalls=[];window.mockTriggers=[];window.mockGetStates=0;
  window.PalmServiceBridge=class{call(uri,params){const p=JSON.parse(params);setTimeout(()=>{if(uri.includes('hbchannel')){(window.mockExec=window.mockExec||[]).push(p.command);}if(uri.includes('hbchannel'))this.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify({url:'http://ha.invalid',token:'test-only'})}));else{window.mockLaunches.push(p.id);window.mockLaunchLog.push({id:p.id,sources:document.querySelectorAll('#inputVideo source').length});this.onservicecallback('{"returnValue":true}');}},0);}cancel(){}};
  window.WebSocket=class {
   constructor(){this.readyState=1;window.mockSocket=this;setTimeout(()=>this.emit({type:'auth_required'}),0);}
   emit(message){if(this.onmessage)this.onmessage({data:JSON.stringify(message)});}
   send(raw){const m=JSON.parse(raw);setTimeout(()=>{
    if(m.type==='auth')return this.emit({type:'auth_ok'});
    if(m.type==='subscribe_trigger'){this.subscription=m.id;window.mockTriggers.push(m.trigger.entity_id);return this.emit({type:'result',id:m.id,success:true,result:null});}
    if(m.type==='unsubscribe_events')return this.emit({type:'result',id:m.id,success:true,result:null});
    if(m.type==='get_states'){window.mockGetStates++;return this.emit({type:'result',id:m.id,success:true,result:Object.values(states)});}
    if(m.type==='call_service'){
     window.mockCalls.push({domain:m.domain,service:m.service,entity:m.target.entity_id,data:m.service_data});
     const id=m.target.entity_id,old=states[id];const state=m.service==='set_value'?m.service_data.value:m.service==='select_option'?m.service_data.option:m.service==='turn_on'?'on':'off';
     states[id]={...old,state:String(state)};this.emit({type:'event',id:this.subscription,event:{variables:{trigger:{entity_id:id,to_state:states[id]}}}});return this.emit({type:'result',id:m.id,success:true,result:null});
    }
    if(m.type==='ping')this.emit({type:'pong',id:m.id});
   },0);}
   close(){this.readyState=3;if(this.onclose)this.onclose();}
  };
  window.externalHelper=(key,value)=>{const id=boot.helpers[key];states[id]={...states[id],state:value};window.mockSocket.emit({type:'event',id:window.mockSocket.subscription,event:{variables:{trigger:{entity_id:id,to_state:states[id]}}}});};
  window.externalPinUpdate=(pins)=>{const id=boot.helpers.pins;states[id]={...states[id],state:JSON.stringify(pins)};window.mockSocket.emit({type:'event',id:window.mockSocket.subscription,event:{variables:{trigger:{entity_id:id,to_state:states[id]}}}});};
 },{boot});
 await page.goto('file://'+root+'/src/com.spinoff.lumahome/index.html');
 await page.waitForFunction(()=>window.lumaStatus().haConnected&&window.lumaStatus().stateCount>0);
 assert.equal(await page.evaluate(()=>window.mockGetStates),1,'one full snapshot per connection');
 assert.equal(await page.locator('[data-input="1"] .label').textContent(),'HDMI 1');
 assert.equal(await page.locator('[data-input="2"] .label').textContent(),'HDMI 2');
 await page.locator('#editPinsBtn').click();
 const jelly=page.locator('.pin-row').filter({has:page.locator('button.title',{hasText:'Jellyfin'})});
 await jelly.getByRole('button',{name:'Unpin',exact:true}).click();
 await page.waitForFunction(()=>!window.lumaStatus().pins.includes('org.jellyfin.webos'));
 await page.locator('#closeSettings').click();
 await page.evaluate(()=>window.externalPinUpdate(['org.jellyfin.webos','youtube.leanback.v4']));
 await page.waitForFunction(()=>document.querySelector('[data-appid]').dataset.appid==='org.jellyfin.webos');
 await page.locator('[data-appid="org.jellyfin.webos"]').focus();
 await page.locator('#appHero').waitFor({state:'visible'});
 assert.equal(await page.locator('#inputName').textContent(),'Jellyfin');
 assert.equal(await page.locator('#watchLabel').textContent(),'Open');
 await page.screenshot({path:root+'/tests/app-preview.png'});
 await page.locator('#watchBtn').click();
 await page.waitForFunction(()=>window.mockLaunches.includes('org.jellyfin.webos'));
 await page.locator('[data-entity="switch.example"]').click();
 await page.waitForFunction(()=>window.mockStates['switch.example'].state==='on');
 await page.locator('[data-input="2"]').click();
 await page.locator('#watchBtn').click();
 await page.waitForFunction(()=>window.mockLaunches.includes('com.webos.app.hdmi2'));
 // 0.3.0 behavior
 const triggers=await page.evaluate(()=>window.mockTriggers);
 assert(triggers.length>=1,'a trigger subscription was made');
 assert(triggers[0].length<30,'subscribes to the few entities the screen needs, not all of HA ('+triggers[0].length+')');
 assert(triggers[0].includes('light.test')&&triggers[0].includes('switch.example'),'favorites are watched');
 // dimmable light gets a fill tile (50%), plain switch does not; Left/Right dim in 10% steps
 assert.equal(await page.locator('[data-dim]').count(),1);
 assert.equal(await page.locator('[data-dim]').getAttribute('data-entity'),'light.test');
 assert.equal(await page.locator('[data-dim] .fill').evaluate(el=>el.style.width),'50%');
 await page.locator('[data-dim]').focus();await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>window.mockCalls.some(c=>c.domain==='light'&&c.service==='turn_on'&&c.data.brightness_pct===60));
 assert.equal(await page.locator('[data-dim] .fill').evaluate(el=>el.style.width),'60%');
 await page.locator('[data-dim]').dispatchEvent('wheel',{deltaY:100});
 await page.waitForFunction(()=>window.mockCalls.some(c=>c.domain==='light'&&c.service==='turn_on'&&c.data.brightness_pct===50));
 // tile size and extra backdrops come from HA helpers
 await page.evaluate(()=>window.externalHelper('tilesize','Compact'));
 await page.waitForFunction(()=>document.querySelector('[data-entity="light.test"]').dataset.size==='Compact');
 await page.evaluate(()=>window.externalHelper('theme','Aurora'));
 await page.waitForFunction(()=>document.body.dataset.theme==='Aurora');
 assert.notEqual(await page.evaluate(()=>getComputedStyle(document.querySelector('.backdrop')).backgroundImage.indexOf('fjord')>=0),true,'Aurora drops the photo');
 await page.evaluate(()=>window.externalHelper('tilesize','Standard'));
 await page.waitForFunction(()=>document.querySelector('[data-entity="light.test"]').dataset.size==='Standard');
 // per-favorite override wins over the default; layout is height based (3 Large tiles fit, a 4th does not)
 await page.evaluate(()=>window.externalHelper('tiles','{"light.test":"Large"}'));
 await page.waitForFunction(()=>document.querySelector('[data-entity="light.test"]').dataset.size==='Large'&&document.querySelector('[data-entity="switch.example"]').dataset.size==='Standard');
 assert.deepStrictEqual(await page.evaluate(()=>Luma.fit(['a.a','b.b','c.c','d.d'],'Large',{})),['a.a','b.b','c.c']);
 assert.equal(await page.evaluate(()=>Luma.fit(['a.a','b.b','c.c','d.d','e.e','f.f','g.g'],'Compact',{}).length),6);
 assert.equal(await page.evaluate(()=>Luma.fit(['a.a','b.b','c.c','d.d','e.e'],'Standard',{}).length),4);
 await page.evaluate(()=>window.externalHelper('tiles','{}'));
 // Home Assistant -> TV actions arrive as launch parameters
 const relaunch=(detail)=>page.evaluate(d=>document.dispatchEvent(new CustomEvent('webOSRelaunch',{detail:d})),detail);
 await relaunch({luma:'settings',tab:'appearance'});
 await page.locator('#settings').waitFor({state:'visible'});
 assert.equal(await page.locator('[data-tab="appearance"]').getAttribute('class'),'active');
 await relaunch({luma:'idle'});await page.locator('#ambient').waitFor({state:'visible'});
 await relaunch({luma:'home'});await page.locator('#ambient').waitFor({state:'hidden'});
 await relaunch({luma:'hook',state:'off'});
 await page.waitForFunction(()=>(window.mockExec||[]).some(c=>/home-hook\.sh stop$/.test(c)));
 await relaunch({luma:'voice',state:'on'});
 await page.waitForFunction(()=>(window.mockExec||[]).some(c=>/voice-control\.sh enable$/.test(c)));
 await relaunch({luma:'input',input:'2',watch:true});
 await page.waitForFunction(()=>window.mockLaunches.includes('com.webos.app.hdmi2'));
 await relaunch({luma:'home'});
 // HDMI launches release the preview first
 await page.locator('#watchBtn').click();
 await page.waitForFunction(()=>window.mockLaunchLog.filter(l=>l.id==='com.webos.app.hdmi2').length>=2);
 const hdmiLaunches=await page.evaluate(()=>window.mockLaunchLog.filter(l=>l.id.indexOf('com.webos.app.hdmi')===0));
 hdmiLaunches.forEach(l=>assert.equal(l.sources,0,'preview source released before launching '+l.id));
 // preview starts when the screen is shown again, without focusing a tile
 await page.evaluate(()=>{document.getElementById('inputVideo').innerHTML='';});
 await page.evaluate(()=>document.dispatchEvent(new Event('webOSRelaunch')));
 await page.waitForFunction(()=>!!document.querySelector('#inputVideo source[src="ext://hdmi:2"]')||!!document.querySelector('#inputVideo source[src="ext://hdmi:1"]'));
 // a pin that starts an app on the Google TV Streamer calls the HA script, then switches to HDMI 1
 await page.evaluate(()=>window.externalPinUpdate(['ha:script.luma_launch_smarttube']));
 await page.waitForFunction(()=>document.querySelector('[data-appid]')&&document.querySelector('[data-appid]').dataset.appid==='ha:script.luma_launch_smarttube');
 await page.evaluate(()=>{window.mockLaunchLog.length=0;});
 await page.locator('[data-appid="ha:script.luma_launch_smarttube"]').click();
 await page.waitForFunction(()=>window.mockCalls.some(c=>c.domain==='script'&&c.service==='turn_on'&&c.entity==='script.luma_launch_smarttube'));
 await page.waitForFunction(()=>window.mockLaunchLog.some(l=>l.id==='com.webos.app.hdmi1'));
 await page.locator('#idleBtn').click();await page.locator('#ambient').waitFor({state:'visible'});
 await page.locator('#wakeBtn').click();
 await page.screenshot({path:root+'/tests/launcher-preview.png'});
 await page.evaluate(()=>window.mockSocket.close());
 await page.waitForFunction(()=>document.querySelector('[data-entity] .state').textContent==='Unavailable');
 assert.deepStrictEqual(errors,[]);
 console.log('Passed: pin sync both ways, app and HDMI launch, entity controls, brightness tile (keys + wheel), scoped HA subscription, per-favorite tile sizes, height-based layout, HA-driven launch actions, preview released before input switch, preview on show, streamer-app pins, idle screen, stale-state handling.');
 }finally{await browser.close();}
})();
