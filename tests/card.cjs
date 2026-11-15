// Loads the HA settings card with a fake `hass` and checks upload + tile-size controls render and save.
const {launch}=require('./_launch.cjs');const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');const boot=JSON.parse(fs.readFileSync(root+'/ha/bootstrap.json'));
(async()=>{
 const browser=await launch();
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body></body>');await page.addScriptTag({path:root+'/ha/luma-home-card.js'});
  await page.evaluate(({boot})=>{
   const states={};for(const [k,id] of Object.entries(boot.helpers))states[id]={entity_id:id,state:k==='controls'?'["light.a","switch.b"]':k==='tiles'?'{"light.a":"Large"}':k==='tilesize'?'Standard':k==='background'?'':k==='idle'?'2':'x',attributes:{}};
   states['light.a']={entity_id:'light.a',state:'on',attributes:{friendly_name:'Lamp'}};states['switch.b']={entity_id:'switch.b',state:'off',attributes:{friendly_name:'Plug'}};
   window.calls=[];window.uploads=[];
   const card=document.createElement('luma-home-settings');document.body.append(card);card.setConfig({helpers:boot.helpers,catalog:boot.catalog});
   card.hass={states,callService:async(d,s,data)=>{window.calls.push({d,s,data});},fetchWithAuth:async(url,opt)=>{window.uploads.push(url);return {ok:true,json:async()=>({id:'abc123'})};}};
   window.card=card;
  },{boot});
  const shadow=()=>page.evaluate(()=>window.card.shadowRoot.querySelectorAll('.row select').length);
  assert.equal(await shadow(),2,'one size select per favorite');
  assert.equal(await page.evaluate(()=>window.card.shadowRoot.querySelector('.row select').value),'Large');
  await page.evaluate(()=>{const s=window.card.shadowRoot.querySelectorAll('.row select')[1];s.value='Compact';s.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.calls.some(c=>c.d==='input_text'&&c.s==='set_value'&&c.data.entity_id==='input_text.luma_home_tile_sizes'&&JSON.parse(c.data.value)['switch.b']==='Compact'));
  assert.equal(await page.evaluate(()=>window.card.shadowRoot.textContent.includes('Upload a background image')),true);
  assert.equal(await page.evaluate(()=>['Aurora','Ember','Slate','Clear'].every(x=>window.card.shadowRoot.innerHTML.includes('>'+x+'<'))),true);
  // upload: a real PNG goes through resize -> fetchWithAuth -> background helper
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  await page.evaluate(()=>window.card.shadowRoot.querySelector('.upload input[type=file]').setAttribute('data-test','1'));
  const handle=await page.evaluateHandle(()=>window.card.shadowRoot.querySelector('.upload input[type=file]'));
  await handle.asElement().setInputFiles({name:'bg.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>window.uploads.length===1&&window.calls.some(c=>c.data&&c.data.entity_id==='input_text.luma_home_background_image'&&c.data.value==='/api/image/serve/abc123/original'));
  assert.deepStrictEqual(errors,[]);
  console.log('Passed: HA card renders per-favorite size selects and saves them, lists new backdrops, uploads a resized image and stores its served path.');
 }finally{await browser.close();}
})();
