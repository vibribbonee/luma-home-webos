// Quick panel against a mocked Home Assistant: brightness slider, scoped subscription, streamer-app buttons.
const {launch}=require('./_launch.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');const boot=JSON.parse(fs.readFileSync(root+'/ha/bootstrap.json'));
(async()=>{
 const browser=await launch();
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(require('./_ha-mock.cjs').setup,{boot});
 await page.addInitScript(()=>{
  window.mockHidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.mockHidden});
  window.webOSSystem={launchParams:'{"quick":true}',keepAlive:false,activate(){window.mockHidden=false;},hide(){window.mockHidden=true;document.dispatchEvent(new Event('visibilitychange'));}};
 });
 await page.goto('file://'+root+'/src/com.spinoff.lumahome.overlay/index.html');
 await page.locator('#quickPanel [data-dim]').waitFor({state:'attached'});
 assert.equal(await page.locator('[data-dim]').count(),1,'only the dimmable light has a fill');
 assert.equal(await page.locator('[data-dim] .fill').evaluate(el=>el.style.width),'50%');
 const watched=await page.evaluate(()=>window.calls.find(c=>c.type==='subscribe_trigger').trigger.entity_id);
 assert(watched.includes('light.test')&&watched.includes('switch.test')&&watched.length<30,'scoped subscription');
 await page.locator('[data-dim]').focus();
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('.quick-title').innerText(),'Test light','adjustments use the light name on both platforms');
 assert.equal(await page.locator('.quick-light input').count(),2,'brightness and supported warmth share one detail panel');
 assert.equal(await page.locator('.quick-controls').isVisible(),false,'the overview does not stack behind the light panel');
 await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>window.calls.some(c=>c.service==='turn_on'&&c.service_data.brightness_pct===60));
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.light),'light.test','Left/Right adjusts the focused slider');
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.property),'color_temp_kelvin');
 await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>window.calls.some(c=>c.service==='turn_on'&&c.service_data.color_temp_kelvin===3100));
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.entity),'light.test','Back returns focus to the light tile');
 await page.keyboard.press('ArrowDown');
 assert.notEqual(await page.evaluate(()=>document.activeElement.dataset.entity),'light.test');
 await page.getByRole('button',{name:'SmartTube'}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.domain==='luma_home'&&c.service==='launch_app'&&c.service_data.app==='smarttube'));
 await page.evaluate(()=>window.configChange({lumax_enabled:true}));
 await page.waitForFunction(()=>window.sockets.some(s=>s.quickSub));
 assert.equal(await page.getByRole('button',{name:'SmartTube'}).isVisible(),false,'paired Room controls only displays the shared room content');
 const remoteKey=key=>page.evaluate(key=>{const s=window.sockets.find(s=>s.quickSub);s.emit({type:'event',id:s.quickSub,event:{key}});},key);
 await page.locator('[data-entity="light.test"]').focus();
 await remoteKey('ok_hold');
 await page.waitForFunction(()=>window.calls.some(c=>c.domain==='light'&&c.service==='turn_off'&&c.target.entity_id==='light.test'));
 await page.locator('[data-entity="switch.test"]').focus();
 await remoteKey('ok');
 await page.waitForFunction(()=>window.calls.some(c=>c.domain==='switch'&&c.service==='turn_on'&&c.target.entity_id==='switch.test'));
 await remoteKey('close');
 await page.locator('#quickPanel').waitFor({state:'hidden'});
 await page.waitForFunction(()=>window.calls.some(c=>c.type==='unsubscribe_events'&&c.subscription===window.sockets.find(s=>s.quickSub).quickSub));
 await page.evaluate(()=>{
  const controls=Array.from({length:200},(_,i)=>'switch.large_'+i);
  controls.forEach((entity_id,i)=>window.mockStates[entity_id]={entity_id,state:'off',attributes:{friendly_name:'Control '+i}});
  window.configChange({controls});
  document.dispatchEvent(new CustomEvent('webOSRelaunch',{detail:{quick:true,toggle:false}}));
 });
 await page.waitForFunction(()=>document.querySelectorAll('.quick-controls [data-entity]').length===200);
 await page.evaluate(()=>LumaNav.focus(document.querySelector('[data-entity="switch.large_199"]')));
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.entity),'switch.large_199');
 assert(await page.locator('.quick-controls').evaluate(node=>node.scrollTop)>0,'the last of 200 controls remains reachable by remote navigation');
 assert.deepStrictEqual(errors,[]);
 console.log('Passed: quick-panel brightness tile and key handling, scoped HA subscription, SmartTube launch delegated to Luma Home.');
 }finally{await browser.close();}
})();
