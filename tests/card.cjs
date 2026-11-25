// Exercise the settings card against the current per-room API and a large registry.
const {launch}=require('./_launch.cjs');
const path=require('path'),assert=require('assert');
(async()=>{
 const browser=await launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body></body>');
  await page.addScriptTag({path:path.resolve(__dirname,'../custom_components/luma_home/frontend/luma-home-card.js')});
  await page.evaluate(()=>{
   const states={};
   for(let i=0;i<600;i++)states['switch.test_'+i]={state:'off',attributes:{friendly_name:'Test switch '+i}};
   states['light.lamp']={state:'on',attributes:{friendly_name:'Reading lamp'}};
   window.snapshot={settings:{room:'Living room',controls:['light.lamp'],pins:[],tiles:{'light.lamp':'Large'},theme:'Aurora'}};
   const card=document.createElement('luma-home-settings');card.setConfig({entry_id:'test-room'});document.body.append(card);
   card.hass={states,connection:{subscribeMessage:async()=>()=>{}},callService:async()=>{},callWS:async m=>{
    if(m.type==='luma_home/list')return [{entry_id:'test-room',name:'Living room'}];
    if(m.type==='luma_home/config/set')Object.assign(window.snapshot.settings,m.settings);
    return structuredClone(window.snapshot);
   }};window.card=card;
  });
  await page.waitForFunction(()=>window.card.shadowRoot.querySelector('input[type=search]'));
  assert.equal(await page.evaluate(()=>window.card.shadowRoot.querySelector('a').getAttribute('href')),'/config/integrations/integration/luma_home');
  assert.equal(await page.evaluate(()=>window.card.shadowRoot.querySelector('input[type=search]').nextElementSibling.options.length),41);
  await page.evaluate(()=>{const s=window.card.shadowRoot.querySelector('input[type=search]');s.value='test_599';s.dispatchEvent(new Event('input'));});
  assert.equal(await page.evaluate(()=>window.card.shadowRoot.querySelector('input[type=search]').nextElementSibling.options.length),2);
  await page.evaluate(()=>{const s=window.card.shadowRoot.querySelector('input[type=search]').nextElementSibling;s.value='switch.test_599';s.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.snapshot.settings.controls.includes('switch.test_599'));
  assert.deepEqual(await page.evaluate(()=>window.snapshot.settings.controls),['light.lamp','switch.test_599']);
  await page.evaluate(()=>[...window.card.shadowRoot.querySelectorAll('.item')].find(r=>r.textContent.includes('Test switch 599')).querySelector('button').click());
  await page.waitForFunction(()=>!window.snapshot.settings.controls.includes('switch.test_599'));
  await page.evaluate(()=>{const s=window.card.shadowRoot.querySelector('.item select');s.value='Compact';s.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.snapshot.settings.tiles['light.lamp']==='Compact');
  assert.deepEqual(errors,[]);
  console.log('Passed: searchable 40-choice limit, late-registry selection, add/remove, per-control tile size and native HA management link.');
 }finally{await browser.close();}
})();
