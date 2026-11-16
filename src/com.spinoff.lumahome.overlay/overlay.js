(function(){
 'use strict';
 var $=function(id){return document.getElementById(id);},ha=null,params={},generation=0,timer=0,refresh=0,countdown=0,waiting=0,framePoll=0,deadline=0,phase='closed',frames=0,openedAt=0,notificationTimer=0;
 function cleanup(){clearTimeout(timer);clearTimeout(refresh);clearInterval(countdown);clearInterval(waiting);clearInterval(framePoll);generation++;$('picture').onload=null;$('picture').onerror=null;$('picture').removeAttribute('src');phase='closed';window.lumaCameraOpen=false;if(window.lumaLayout)window.lumaLayout();}
 function close(){cleanup();$('camera').hidden=true;LumaNav.resume();Luma.hide();}
 function launchParameters(event){if(event&&event.detail)return typeof event.detail==='string'?JSON.parse(event.detail):event.detail;try{var p=window.webOSSystem&&window.webOSSystem.launchParams||window.PalmSystem&&window.PalmSystem.launchParams||'{}';return typeof p==='string'?JSON.parse(p):p;}catch(_){return {};}}
 function activate(){try{var system=window.PalmSystem||window.webOSSystem;if(system&&typeof system.activate==='function')system.activate();}catch(_){}}
 function closeAll(){if(window.cancelLumaAnnouncement)window.cancelLumaAnnouncement(true);cleanup();$('camera').hidden=true;if(window.suspendLumaQuick)window.suspendLumaQuick();if(window.suspendLumaVoice)window.suspendLumaVoice();var note=document.getElementById('lumaNotification');if(note)note.remove();clearTimeout(notificationTimer);window.lumaNotificationOpen=false;Luma.exec('/var/lib/webosbrew/lumahome/voice-control.sh cancel').catch(function(){});Luma.hide();}
 function open(event){
  var incoming=launchParameters(event);if(incoming.parameters)incoming=incoming.parameters;
  if(incoming.configure){var config=incoming.configure;LumaRuntime.setup().then(function(){return LumaRuntime.configure(config);}).then(function(){Luma.hide();}).catch(function(){});return;}
  if(incoming.announcement){window.startLumaAnnouncement(incoming.announcement);activate();return;}
  if(incoming.notification){notification(incoming.notification);return;}
  if(incoming.voice){if(incoming.voice.phase==='starting'&&window.cancelLumaAnnouncement)window.cancelLumaAnnouncement(true);if(!window.lumaCameraOpen)$('camera').hidden=true;if(window.startLumaVoice(incoming.voice)!==false)activate();return;}
  if(incoming.quick){if(!window.lumaCameraOpen)$('camera').hidden=true;if(window.lumaQuickOpen&&incoming.toggle!==false){window.closeLumaQuick();return;}window.lumaQuickOpen=true;window.startLumaQuick();if(window.lumaLayout)window.lumaLayout();activate();return;}
  if(incoming.close){closeAll();return;}
  if(!incoming.camera){Luma.hide();return;}
  params=incoming;
  cleanup();window.lumaCameraOpen=true;$('camera').hidden=false;activate();var run=generation;frames=0;openedAt=Date.now();phase='connecting';
  var duration=Math.max(3,Math.min(120,Number(params.timeout)||15)),width=Math.max(15,Math.min(45,Number(params.size)||25));deadline=0;
  $('camera').style.width=width+'%';$('picture').style.height=Math.round(1920*width/100*9/16)+'px';
  var position=params.position||'top-right';$('camera').style.top=position.indexOf('bottom')===0?'auto':'38px';$('camera').style.bottom=position.indexOf('bottom')===0?'38px':'auto';$('camera').style.left=position.indexOf('left')>=0?'38px':'auto';$('camera').style.right=position.indexOf('left')>=0?'auto':'38px';
  $('camera').dataset.position=position;$('camera').dataset.size=width;if(window.lumaLayout)window.lumaLayout();
  $('title').textContent=params.title||'Camera';$('message').hidden=false;$('picture').hidden=true;$('message').textContent='Connecting to camera…';$('status').textContent='Back to dismiss';
  if(!/^camera\.[a-z0-9_]+$/.test(params.camera||'')){$('message').textContent='Choose a Home Assistant camera entity.';return;}
  timer=setTimeout(function(){if(run===generation&&!frames){phase='error';$('message').textContent='Camera did not respond. Check its feed in Home Assistant.';timer=setTimeout(close,6000);}},15000);
  if(!ha)ha=new Luma.HA(null,function(){},function(){});
  ha.changed=function(states){if(run!==generation)return;var s=states[params.camera];if(s&&!params.title)$('title').textContent=s.attributes.friendly_name||'Camera';};
  ha.status=function(status){if(run===generation&&!ha.ready)$('message').textContent=status;};ha.watchFn=function(){return [params.camera];};
  if(ha.ready)start(run,duration);else{ha.connect();waiting=setInterval(function(){if(run!==generation){clearInterval(waiting);return;}if(ha.ready){clearInterval(waiting);start(run,duration);}},50);}$('close').focus();
 }
 function decoded(run,duration){if(run!==generation)return;frames++;$('picture').hidden=false;$('message').hidden=true;phase='showing';if(!deadline){clearTimeout(timer);deadline=Date.now()+duration*1000;timer=setTimeout(close,duration*1000);countdown=setInterval(function(){$('status').textContent='Closes in '+Math.max(0,Math.ceil((deadline-Date.now())/1000))+'s · Back to dismiss';},500);}}
 function start(run,duration){
  var mode=params.mode==='mjpeg'?'mjpeg':'snapshot';
  function load(nextMode){var path=(nextMode==='mjpeg'?'/api/camera_proxy_stream/':'/api/camera_proxy/')+params.camera;
   ha.call({type:'auth/sign_path',path:path,expires:duration+60}).then(function(result){
    if(run!==generation)return;var url=ha.current.url+result.path,image=$('picture');phase='loading';
    if(nextMode==='mjpeg'){
     image.onerror=function(){if(run!==generation)return;clearInterval(framePoll);phase='fallback';load('snapshot');};image.onload=function(){decoded(run,duration);};image.src=url;
     framePoll=setInterval(function(){if(run!==generation){clearInterval(framePoll);return;}if(image.naturalWidth>0&&!frames)decoded(run,duration);},100);return;
    }
    function snapshot(){if(run!==generation||(deadline&&Date.now()>deadline))return;image.onload=function(){if(run!==generation)return;decoded(run,duration);refresh=setTimeout(snapshot,1000);};image.onerror=function(){if(run!==generation)return;phase='retrying';$('message').textContent='Camera unavailable · retrying';$('message').hidden=false;refresh=setTimeout(snapshot,1500);};ha.call({type:'auth/sign_path',path:path+'?_='+Date.now(),expires:20}).then(function(signed){if(run===generation)image.src=ha.current.url+signed.path;}).catch(function(){if(run===generation)refresh=setTimeout(snapshot,1500);});}
    snapshot();
   }).catch(function(){if(run===generation){phase='error';$('message').textContent='Could not request this camera from Home Assistant.';$('message').hidden=false;}});
  }load(mode);
 }
 function notification(data){clearTimeout(notificationTimer);var note=document.getElementById('lumaNotification');if(note)note.remove();note=document.createElement('aside');note.id='lumaNotification';note.style.cssText='position:absolute;left:38px;top:38px;max-width:620px;padding:24px;border-radius:22px;background:#17263bf5;color:white;border:1px solid #7587a0;font-size:24px;z-index:10';var title=document.createElement('strong');title.textContent=data.title||'Home Assistant';note.appendChild(title);var message=document.createElement('div');Luma.formatText(message,data.message||'');note.appendChild(message);var dismiss=document.createElement('button');dismiss.textContent='Dismiss';function end(){note.remove();window.lumaNotificationOpen=false;Luma.hide();}dismiss.onclick=end;note.appendChild(dismiss);document.body.appendChild(note);window.lumaNotificationOpen=true;if(window.lumaLayout)window.lumaLayout();activate();notificationTimer=setTimeout(end,Math.max(3,Math.min(120,Number(data.seconds)||15))*1000);}
 window.lumaCameraStatus=function(){return {phase:phase,visible:!document.hidden&&!$('camera').hidden,frames:frames,width:$('picture').naturalWidth,height:$('picture').naturalHeight,haConnected:!!(ha&&ha.ready),elapsedMs:openedAt?Date.now()-openedAt:0};};
 $('close').onclick=close;document.addEventListener('keydown',function(e){if(!window.lumaCameraOpen||!$('camera').contains(document.activeElement))return;if([13,27,461].indexOf(e.keyCode)>=0){e.preventDefault();close();}});document.addEventListener('webOSRelaunch',open);$('camera').hidden=true;open();
})();
