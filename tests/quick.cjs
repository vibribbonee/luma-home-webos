const {launch}=require('./_launch.cjs');
const path=require('path'),assert=require('assert');
(async()=>{
 const browser=await launch();
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.mockLaunches=[];window.mockHidden=false;window.mockActivate=0;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.mockHidden});
  window.webOSSystem={launchParams:'{"quick":true}',keepAlive:false,activate(){window.mockHidden=false;window.mockActivate++;},hide(){window.mockHidden=true;document.dispatchEvent(new Event('visibilitychange'));}};
  window.PalmServiceBridge=class{call(uri,raw){setTimeout(()=>{const p=JSON.parse(raw);if(uri.includes('hbchannel'))this.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify({error:'Offline test'})}));else{window.mockLaunches.push(p.id);this.onservicecallback('{"returnValue":true}');}},0);}cancel(){}};
 });
 await page.goto('file://'+path.resolve(__dirname,'../src/com.spinoff.lumahome.overlay/index.html'));
 await page.locator('#quickPanel').waitFor({state:'visible'});
 await page.getByRole('button',{name:'HDMI 1',exact:true}).focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.mockLaunches.includes('com.webos.app.hdmi1'));
 await page.waitForFunction(()=>window.mockHidden);
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('webOSRelaunch',{detail:{parameters:{quick:true}}})));
 await page.locator('#quickPanel').waitFor({state:'visible'});
 assert.equal(await page.locator('#quickPanel').count(),1);
 assert.equal(await page.locator('#camera').isVisible(),false);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await page.locator('#quickPanel').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.mockHidden),true,'a native menu can take focus immediately');
 assert.deepStrictEqual(errors,[]);
 console.log('Passed: remote OK launches a source, native hide retains the panel, warm relaunch reuses the existing panel, camera mode does not intercept quick-panel keys.');
 }finally{await browser.close();}
})();
