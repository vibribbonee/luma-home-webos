(function(){
 'use strict';var applied='',setupPromise;
 function encoded(x){return btoa(unescape(encodeURIComponent(JSON.stringify(x))));}
 function configure(config){return setup().then(function(){var cfg=config.settings||config,keep={};Object.keys(cfg).forEach(function(k){if(k.indexOf('voice_')===0||['lumax_enabled','lumax_input','home_button','input_button_cycle','home_swap','microphone','no_signal','screensaver'].indexOf(k)>=0)keep[k]=cfg[k];});var data={tv_id:config.tv_id,settings:keep};if(config.pairing)data.pairing=config.pairing;var signature=JSON.stringify(data);if(signature===applied)return Promise.resolve();return Luma.exec('/usr/bin/python /var/lib/webosbrew/lumahome/runtime-config.py '+encoded(data)).then(function(raw){var r=JSON.parse(raw);if(!r.success)throw Error(r.error);applied=signature;return r;});});}
 function setup(){if(!setupPromise)setupPromise=Luma.exec('if [ -f /var/lib/webosbrew/lumahome/.runtime-0.4.29 ]; then echo \'{"success":true}\'; else /bin/sh /media/developer/apps/usr/palm/applications/com.spinoff.lumahome/runtime/setup.sh; fi').then(function(raw){var result=JSON.parse(raw);if(!result.success)throw Error(result.error);return result;}).catch(function(error){setupPromise=null;throw error;});return setupPromise;}
 function catalog(){
  return Luma.luna('luna://com.webos.applicationManager/listApps',{}).then(function(r){
   if(!Array.isArray(r.apps))throw Error('Could not read installed LG apps.');
   return r.apps.filter(function(a){return a.id&&a.visible!==false;}).map(function(a){
    return {id:a.id,title:a.title||a.id,icon:a.icon||'',visible:true,system:!!a.systemApp};
   });
  }).catch(function(){
   return Luma.exec('/usr/bin/python /var/lib/webosbrew/lumahome/list-apps.py').then(function(raw){
    var apps=JSON.parse(raw);
    if(!Array.isArray(apps))throw Error('Could not read installed LG apps.');
    return apps;
   });
  });
 }
 window.LumaRuntime={configure:configure,setup:setup,catalog:catalog};
})();
