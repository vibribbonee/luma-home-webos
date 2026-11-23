// Local TV navigation must remain usable without a Home Assistant connection.
const {launch}=require('./_launch.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),boot=JSON.parse(fs.readFileSync(root+'/ha/bootstrap.json'));
(async()=>{
 const browser=await launch();
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({boot})=>{
   window.localLaunches=[];
   localStorage.setItem('luma-settings',JSON.stringify({room:'Offline room',pins:JSON.stringify(['org.jellyfin.webos'])}));
   window.PalmServiceBridge=class{
    call(uri,raw){const params=JSON.parse(raw);let result={returnValue:true};
     if(uri.includes('hbchannel')){
      const command=params.command;
      result.stdoutString=JSON.stringify(command.includes('discover-ha')?{error:'HA offline'}:command.includes('list-apps.py')&&!command.includes('--artwork')?boot.catalog:{success:true});
     }else if(uri.includes('listApps'))result.apps=boot.catalog;
     else if(params.id)window.localLaunches.push(params.id);
     setTimeout(()=>this.onservicecallback(JSON.stringify(result)),0);
    }
    cancel(){}
   };
   window.WebSocket=class{constructor(){throw Error('Offline discovery must not create a socket');}};
  },{boot});
  await page.goto('file://'+root+'/src/com.spinoff.lumahome/index.html');
  const app=page.locator('#launcher [data-appid="org.jellyfin.webos"]').first();
  await app.waitFor();await app.focus();
  assert.equal(await page.locator('#launcherTitle').textContent(),'Jellyfin');
  await app.click();
  await page.waitForFunction(()=>window.localLaunches.includes('org.jellyfin.webos'),{},{timeout:5000});
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('webOSRelaunch',{detail:{luma:'input',input:'2',watch:true}})));
  await page.waitForFunction(()=>window.localLaunches.includes('com.webos.app.hdmi2'),{},{timeout:5000});
  assert.equal(await page.evaluate(()=>window.lumaStatus().haConnected),false);
  assert.deepEqual(errors,[]);
  console.log('Passed: cached local app dock, focused app title, direct LG app launch and HDMI switch remain usable while HA is offline.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
