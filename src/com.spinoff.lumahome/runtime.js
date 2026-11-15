(function(){
 'use strict';var applied='',setupPromise;
 function encoded(x){return btoa(unescape(encodeURIComponent(JSON.stringify(x))));}
 function configure(config){var cfg=config.settings||config,keep={};Object.keys(cfg).forEach(function(k){if(k.indexOf('voice_')===0||['home_button','home_swap','microphone','no_signal','screensaver'].indexOf(k)>=0)keep[k]=cfg[k];});var data={tv_id:config.tv_id,settings:keep};if(config.pairing)data.pairing=config.pairing;var signature=JSON.stringify(data);if(signature===applied)return Promise.resolve();return Luma.exec('/usr/bin/python /var/lib/webosbrew/lumahome/runtime-config.py '+encoded(data)).then(function(raw){var r=JSON.parse(raw);if(!r.success)throw Error(r.error);applied=signature;return r;});}
 function setup(){if(!setupPromise)setupPromise=Luma.exec('if [ -f /var/lib/webosbrew/lumahome/.runtime-0.4.5 ]; then echo \'{"success":true}\'; else /bin/sh /media/developer/apps/usr/palm/applications/com.spinoff.lumahome/runtime/setup.sh; fi').then(function(raw){return JSON.parse(raw);});return setupPromise;}
 function catalog(){return Luma.luna('luna://com.webos.applicationManager/listApps',{}).then(function(r){return (r.apps||[]).filter(function(a){return a.id&&a.visible!==false;}).map(function(a){return {id:a.id,title:a.title||a.id,icon:a.icon||'',visible:true,system:!!a.systemApp};});}).catch(function(){return Luma.exec('/usr/bin/python /var/lib/webosbrew/lumahome/list-apps.py').then(function(raw){return JSON.parse(raw);});});}
 window.LumaRuntime={configure:configure,setup:setup,catalog:catalog};
})();
