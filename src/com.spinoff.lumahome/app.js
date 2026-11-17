(function(){
 'use strict';
 var BACKDROPS=['Twilight','Forest','Coast','Dunes','Alpine','Midnight','Aurora','Ember','Slate','Clear'];
 var $=function(id){return document.getElementById(id);};
 var boot=window.LUMA_BOOTSTRAP, catalog=boot.catalog.slice(),states={},selectedInput='1',settingsTab='pins',lastActivity=Date.now(),previewTimer=0,toastTimer=0,pending=false;
 var H=boot.helpers, controlsSignature='',launcherSignature='',catalogRevision=0,previewEnabled=true,previewActive=false,handoff=false;
 var catalogArtwork, reportedSocket, loadingCatalog=false;
 var autoDashboard=false,lastClockKey='';
 try{selectedInput=localStorage.getItem('luma-last-input')==='2'?'2':'1';}catch(_){}
 var cached={};try{cached=JSON.parse(localStorage.getItem('luma-settings')||'{}');}catch(_){}
 var ha=new Luma.HA(null,changed,function(message){$('haStatus').textContent=message;}),lastBackground=null,lastSaved='';
 ha.watchFn=function(s){var ids=[],x=function(k){var v=s[H[k]];return v&&v.state;};Luma.fit(Luma.list(x('controls')||'[]'),x('tilesize'),Luma.parseMap(x('tiles')),x('columns')).forEach(function(i){ids.push(i);});['temperature','humidity','co2'].forEach(function(k){var v=x(k);if(v)ids.push(v);});return ids;};
 function activate(){try{var system=window.PalmSystem||window.webOSSystem;if(system&&typeof system.activate==='function')system.activate();}catch(_){}}
 function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
 catalog.push({id:'luma:app/smarttube',title:'SmartTube',icon:'',visible:true,system:false},{id:'luma:app/jellyfin',title:'Jellyfin (Google TV)',icon:'',visible:true,system:false});
 function value(key,fallback){var s=states[H[key]],v=s&&s.state!=='unknown'&&s.state!=='unavailable'?s.state:(cached[key]!==undefined?cached[key]:fallback);return (key==='hdmi1'||key==='hdmi2')&&!String(v||'').trim()?fallback:v;}
 function items(key,fallback){var s=value(key,JSON.stringify(fallback||[]));return Luma.list(s);}
 function say(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').hidden=true;},4500);}
 function err(e){$('settingsError').textContent=e.message;say(e.message);}
 function node(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
 function name(entity){var s=states[entity];return s&&s.attributes.friendly_name||entity;}
 function app(id){return catalog.filter(function(a){return a.id===id;})[0]||{id:id,title:id};}
 function save(key,v){if(!ha.ready||!ha.entryId)return Promise.reject(Error('Pair this TV with the Luma Home integration first.'));var patch={};if(['pins','controls','tiles'].indexOf(key)>=0)v=typeof v==='string'?JSON.parse(v):v;else if(['idle','columns','voice_listen_seconds','voice_silence_seconds','voice_start_seconds'].indexOf(key)>=0)v=Number(v);patch[key]=v;return ha.setConfig(patch);}
 function saveItems(key,next){return save(key,next);}
 function pins(){return items('pins',boot.defaultPins);}
 function clock(){var saved={};try{saved=JSON.parse(localStorage.getItem('luma-clock')||'{}');}catch(_){}var zone=ha.timeZone||saved.zone,offset=ha.clockOffset===undefined?Number(saved.offset)||0:ha.clockOffset,now=new Date(Date.now()+offset),clockKey=Math.floor(now.getTime()/60000)+'|'+(zone||''),timeOptions={hour:'2-digit',minute:'2-digit'},dateOptions={weekday:'long',day:'numeric',month:'long'};if(clockKey===lastClockKey)return;lastClockKey=clockKey;if(zone){timeOptions.timeZone=zone;dateOptions.timeZone=zone;}var time=now.toLocaleTimeString('en-GB',timeOptions),date=now.toLocaleDateString('en-GB',dateOptions);$('clock').textContent=time;$('ambientClock').textContent=time;$('date').textContent=date;$('ambientDate').textContent=date;}

 function sensor(entity){var s=states[entity];if(!ha.ready||!s||s.state==='unavailable'||s.state==='unknown')return '—';var n=Number(s.state);return (isFinite(n)?String(Math.round(n*10)/10):s.state)+' '+(s.attributes.unit_of_measurement||'');}
 function loadArtwork(){
  return Luma.exec('/usr/bin/python /media/developer/apps/usr/palm/applications/com.spinoff.lumahome/runtime/list-apps.py --artwork').then(function(raw){
   var icons=JSON.parse(raw);
   if(!icons||typeof icons!=='object'||Array.isArray(icons)||icons.error)return null;
   LumaLauncher.setArtwork(icons);
   return icons;
  });
 }
 function publishCatalog(){
  var socket=ha.ws;
  if(!catalogArtwork||!ha.ready||!ha.entryId||socket===reportedSocket)return;
  reportedSocket=socket;
  ha.report({catalog:catalog,version:'0.4.26',setup_complete:true}).then(function(){return catalogArtwork;}).then(function(icons){
   if(ha.ws===socket&&ha.ready&&icons&&Object.keys(icons).length)return ha.report({catalog_artwork:icons});
  }).catch(function(){if(reportedSocket===socket)reportedSocket=null;});
 }
 function loadCatalog(){
  if(loadingCatalog||catalogArtwork)return;
  loadingCatalog=true;
  LumaRuntime.setup().then(function(){ha.connect();return LumaRuntime.catalog();}).then(function(apps){
   catalog=apps.concat(catalog.filter(function(a){return a.id.indexOf('luma:')===0;}));
   catalogRevision++;
   renderApps();
   catalogArtwork=loadArtwork().catch(function(){return null;});
   publishCatalog();
   loadingCatalog=false;
  }).catch(function(e){loadingCatalog=false;say(e.message);ha.connect();});
 }
 function roomClimate(){
  var visible=[];
  ['temperature','humidity','co2'].forEach(function(key){
   var display=$(key),reading=sensor(value(key,''));
   display.parentNode.hidden=reading==='—';
   if(reading!=='—'){display.textContent=reading;visible.push(reading);}
  });
  var show=value('climate','on')==='on';
  $('climate').hidden=!show||!visible.length;
  $('ambientClimate').textContent=show?visible.join('  ·  '):'';
 }
 function launch(id){cancelAuto();
  if(id==='com.webos.app.home')return Luma.exec('/var/lib/webosbrew/lumahome/home-hook.sh stock').then(function(){Luma.hide();});
  if(id.indexOf('luma:app/')===0)return ha.service('luma_home','launch_app',null,{entry_id:ha.entryId,app:id.slice(9)});
  var wait=Promise.resolve();if(/^com\.webos\.app\.hdmi[12]$/.test(id)){handoff=true;selectedInput=id.slice(-1);localStorage.setItem('luma-last-input',selectedInput);if(previewActive){stopPreview();wait=delay(350);}}
  return wait.then(function(){return Luma.prepareInput(id);}).then(function(){return Luma.luna('luna://com.webos.applicationManager/launch',{id:id});}).then(function(){return Luma.restoreInputVideo(id);}).then(function(){Luma.hide();}).catch(function(e){handoff=false;throw e;});
 }
 function preview(input){
  if(handoff)return;
  stopPreview();
  closeRoomPanel(false);
  selectedInput=input;
  localStorage.setItem('luma-last-input',input);
  $('inputName').textContent=value('hdmi'+input,'HDMI '+input);
  $('previewMessage').textContent=previewEnabled?'Opening HDMI '+input+' preview…':'Choose Watch to open this input';
  $('previewFallback').hidden=false;
  $('inputPreview').hidden=false;
  $('watchBtn').focus();
  if(document.hidden||!previewEnabled)return;
  var video=$('inputVideo'),source=document.createElement('source');
  source.type='service/webos-external';source.src='ext://hdmi:'+input;video.appendChild(source);
  video.load();previewActive=true;
  var playback=video.play();if(playback&&playback.catch)playback.catch(unavailable);
  previewTimer=setTimeout(unavailable,8000);
 }
 function unavailable(){if(!$('inputPreview').hidden&&!$('previewFallback').hidden)$('previewMessage').textContent='Preview unavailable · choose Watch to open this input';}
 $('inputVideo').addEventListener('playing',function(){if(!previewActive)return;clearTimeout(previewTimer);$('previewFallback').hidden=true;});
 $('inputVideo').addEventListener('error',unavailable);
 function stopPreview(){
  $('inputPreview').hidden=true;
  if(!previewActive)return;
  previewActive=false;clearTimeout(previewTimer);
  var video=$('inputVideo');video.pause();video.removeAttribute('src');video.innerHTML='';video.load();
 }
 function readHiddenApps() {
  try { return Luma.list(localStorage.getItem('luma-hidden-apps') || '[]'); }
  catch (_) { return []; }
 }
 var hiddenApps = readHiddenApps();
 function setAppHidden(id, hidden) {
  var next = hiddenApps.filter(function (appId) { return id !== appId; });
  if (hidden) next.push(id);
  try { localStorage.setItem('luma-hidden-apps', JSON.stringify(next)); }
  catch (_) { say('Could not save app visibility.'); return; }
  hiddenApps = next;
  renderApps();
  renderSettings();
 }
 function renderApps(){
  var key=JSON.stringify([catalogRevision,pins(),hiddenApps,value('hdmi1','HDMI 1'),value('hdmi2','HDMI 2')]);
  if(key===launcherSignature)return;
  launcherSignature=key;
  var entries=['1','2'].map(function(input){return {id:'com.webos.app.hdmi'+input,input:input,title:value('hdmi'+input,'HDMI '+input)};});
  var included={'com.webos.app.hdmi1':true,'com.webos.app.hdmi2':true,'com.spinoff.lumahome':true};
  catalog.forEach(function(item){
   if(item.visible===false||included[item.id]||hiddenApps.indexOf(item.id)>=0)return;
   included[item.id]=true;entries.push({id:item.id,title:item.title,icon:item.icon});
  });
  LumaLauncher.render(entries,pins(),function(id){launch(id).catch(err);});
 }
 function controlAction(id){var domain=id.split('.')[0],s=states[id];if(!ha.ready||!s||s.state==='unavailable'||s.state==='unknown'){say('This entity is unavailable.');return;}var service=['light','switch','input_boolean','fan'].indexOf(domain)>=0?(s.state==='on'?'turn_off':'turn_on'):domain==='scene'?'turn_on':domain==='script'?'turn_on':domain==='button'||domain==='input_button'?'press':null;if(service)ha.service(domain,service,id).catch(err);else say(name(id)+': '+sensor(id));}
 function dimmable(id){var s=states[id];return id.indexOf('light.')===0&&s&&(s.attributes.supported_color_modes||[]).some(function(m){return m!=='onoff';});}
 function level(s){return Math.max(0,Math.min(100,Math.round((Number(s.attributes.brightness)||0)/2.55)));}
 var dimHold={},dimTimers={};
 function dimBy(id,delta){var s=states[id];if(!ha.ready||!s||s.state==='unavailable'||s.state==='unknown')return;var held=dimHold[id]&&Date.now()<dimHold[id].until,current=held?dimHold[id].pct:(s.state==='on'?level(s):0),next=Math.max(0,Math.min(100,Math.round((current+delta)/10)*10));dimHold[id]={pct:next,until:Date.now()+2500};renderControls();clearTimeout(dimTimers[id]);dimTimers[id]=setTimeout(function(){(next>0?ha.service('light','turn_on',id,{brightness_pct:next}):ha.service('light','turn_off',id)).catch(err);},250);}
  function renderControls(){
  var focusMark=LumaNav.bookmark($('controls'));var size=value('tilesize','Standard'),map=Luma.parseMap(value('tiles','{}')),all=items('controls',[]),ids=Luma.fit(all,size,map,value('columns',3)),canAdd=ids.length===all.length&&Luma.fit(all.concat(['x.x']),size,map,value('columns',3)).length>all.length,signature=JSON.stringify([ids,ids.map(dimmable),size,map,value('columns',3),canAdd]);if(signature!==controlsSignature){controlsSignature=signature;$('controls').innerHTML='';ids.forEach(function(id){var b=node('div','control');b.tabIndex=0;b.dataset.navCard='';b.setAttribute('role','button');b.dataset.entity=id;b.dataset.size=Luma.sizeFor(id,size,map);b.appendChild(LumaIcons.icon(LumaIcons.control(id,states[id])));b.appendChild(node('span','name',name(id)));b.appendChild(node('span','state',''));b.onclick=function(e){if(e.target.closest('input,button,label'))return;controlAction(id);};if(dimmable(id)){b.setAttribute('role','group');b.dataset.dim='1';b.insertBefore(node('span','fill'),b.firstChild);LumaLights.attach(b,id,function(){return ha;},err);b.addEventListener('wheel',function(e){e.preventDefault();dimBy(id,e.deltaY<0?10:-10);});}$('controls').appendChild(b);});if(canAdd){var add=node('button','control');add.dataset.size=size;add.appendChild(LumaIcons.icon('plus'));add.appendChild(node('span','name','Add a favorite'));add.appendChild(node('span','state',''));add.onclick=function(){openSettings('widgets');};$('controls').appendChild(add);}}
  var layout=Luma.layout(ids.concat(canAdd?['x.x']:[]),size,map,value('columns',3));layout.forEach(function(item,i){var b=$('controls').children[i];if(!b)return;b.style.left=(item.x*100)+'%';b.style.top=item.y+'px';b.style.width='calc('+(item.width*100)+'% - '+(item.width<1?12:0)+'px)';b.style.height=item.height+'px';});LumaLights.update($('controls'),ha);var details=$('lightDetails');if(details)LumaLights.update(details,ha);
  document.querySelectorAll('#controls [data-entity]').forEach(function(b){var s=states[b.dataset.entity],live=ha.ready&&s&&s.state!=='unavailable'&&s.state!=='unknown';b.setAttribute('aria-pressed',String(!!live&&s.state==='on'));b.querySelector('.name').textContent=name(b.dataset.entity);var held=dimHold[b.dataset.entity]&&Date.now()<dimHold[b.dataset.entity].until,pct=held?dimHold[b.dataset.entity].pct:(live&&s.state==='on'?level(s):0);if(b.dataset.dim){b.querySelector('.fill').style.width=pct+'%';b.querySelector('.fill').style.opacity=pct>0?'1':'0';if(held)b.setAttribute('aria-pressed',String(pct>0));}b.querySelector('.state').textContent=live?(s.state==='on'||(held&&pct>0)?(b.dataset.dim?pct+'%':'On'):s.state==='off'?'Off':sensor(b.dataset.entity)):'Unavailable';});
  LumaNav.restore($('controls'),focusMark);
 }
 function changed(next){states=next;Object.keys(H).forEach(function(k){if(states[H[k]])cached[k]=states[H[k]].state;});var saved=JSON.stringify(cached);if(saved!==lastSaved){lastSaved=saved;try{localStorage.setItem('luma-settings',saved);}catch(_){}}$('roomName').textContent=value('room','Home');document.body.dataset.theme=value('theme','Twilight');var palette=value('palette','');document.documentElement.style.setProperty('--wallpaper-accent',/^[0-9, ]+$/.test(palette)?palette:'110,145,186');var bg=value('background','').trim();var imageUrl=bg.charAt(0)==='/'&&ha.current?ha.current.url+bg:/^https?:\/\//i.test(bg)?bg:'';if(imageUrl!==lastBackground){lastBackground=imageUrl;document.querySelector('.backdrop').style.backgroundImage=imageUrl?'url('+JSON.stringify(imageUrl)+')':'';document.body.classList.toggle('custom-background',!!imageUrl);}roomClimate();$('inputName').textContent=value('hdmi'+selectedInput,'HDMI '+selectedInput);renderApps();renderControls();publishCatalog();}
 function pin(id){var next=pins().slice(),at=next.indexOf(id);if(at<0)next.push(id);else next.splice(at,1);return saveItems('pins',next).then(function(){return refreshStates();});}
 function refreshStates(all){var request=all===true?ha.call({type:'get_states'}).then(function(a){a.forEach(function(s){ha.states[s.entity_id]=s;});ha.applyConfig({entry_id:ha.entryId,tv_id:ha.tvId,settings:ha.config,catalog:ha.catalog});}):ha.refreshScoped();return request.then(function(){if(!$('settings').hidden&&!(document.activeElement&&document.activeElement.dataset.edit==='1'))renderSettings();});}
 function row(label,field){var r=node('label','field');r.appendChild(node('span','',label));r.appendChild(field);return r;}
 function selection(key,options){var select=node('select');select.dataset.setting=key;options.forEach(function(o){var option=node('option','',o.label);option.value=o.value;select.appendChild(option);});select.value=value(key,'');select.onchange=function(){save(key,select.value).catch(err);};return select;}
 function entityOptions(filter){var ids=Object.keys(states).filter(function(id){return filter(id,states[id]);});ids.sort(function(a,b){return name(a).localeCompare(name(b));});return [{label:'None',value:''}].concat(ids.map(function(id){return {value:id,label:name(id)};}));}
 function textField(key,label){var input=node('input');input.dataset.setting=key;input.value=value(key,'');input.maxLength=key==='background'?2048:100;input.readOnly=true;input.onmousedown=function(){input.readOnly=false;input.dataset.edit='1';};input.onblur=function(){input.readOnly=true;delete input.dataset.edit;};input.onchange=function(){save(key,input.value).catch(err);};return row(label,input);}
 function renderSettings(){
  var root=$('settingsContent'),bookmark=LumaNav.bookmark(root);root.innerHTML='';$('settingsError').textContent='';document.querySelectorAll('[data-tab]').forEach(function(b){b.classList.toggle('active',b.dataset.tab===settingsTab);});
  if(settingsTab==='pins'){
   var rows=node('div','rows');var chosen=pins();var candidates=catalog.filter(function(item){return !/^com\.webos\.app\.hdmi[12]$/.test(item.id);}).concat(['1','2'].map(function(input){return {id:'com.webos.app.hdmi'+input,title:value('hdmi'+input,'HDMI '+input),visible:true};}));var ordered=candidates.filter(function(a){return a.visible&&a.id!=='com.spinoff.lumahome'&&a.id!=='amazon.alexa.view'&&a.id!=='google.assistant.promo';}).sort(function(a,b){var aa=chosen.indexOf(a.id),bb=chosen.indexOf(b.id);return aa>=0&&bb>=0?aa-bb:aa>=0?-1:bb>=0?1:a.title.localeCompare(b.title);});
   ordered.forEach(function (a) {
    var r = node('div', 'pin-row');
    var pinned = chosen.indexOf(a.id) >= 0;
    var hidden = hiddenApps.indexOf(a.id) >= 0;
    var input = /^com\.webos\.app\.hdmi[12]$/.test(a.id);
    var title = node(hidden ? 'span' : 'button', 'title', a.title);
    if (!hidden) title.onclick = function () { launch(a.id).catch(err); };
    r.appendChild(title);
    if (!hidden && pinned) {
     var left = node('button');
     left.appendChild(LumaIcons.icon('arrow-left'));
     left.setAttribute('aria-label', 'Move ' + a.title + ' earlier');
     left.disabled = chosen.indexOf(a.id) === 0;
     left.onclick = function () {
      var current = pins().slice(), i = current.indexOf(a.id);
      if (i <= 0) return;
      current.splice(i, 1);
      current.splice(i - 1, 0, a.id);
      saveItems('pins', current).then(refreshStates).catch(err);
     };
     r.appendChild(left);
    }
    if (!hidden) {
     var pinButton = node('button', 'pin', pinned ? 'Unpin' : 'Pin');
     pinButton.setAttribute('aria-pressed', String(pinned));
     pinButton.onclick = function () { pin(a.id).catch(err); };
     r.appendChild(pinButton);
    }
    if (!input) {
     var visibility = node('button', '', hidden ? 'Show' : 'Hide');
     visibility.setAttribute('aria-label', (hidden ? 'Show ' : 'Hide ') + a.title);
     visibility.onclick = function () { setAppHidden(a.id, !hidden); };
     r.appendChild(visibility);
    }
    rows.appendChild(r);
   });
   root.appendChild(rows);
  }else if(settingsTab==='widgets'){
   root.appendChild(textField('room','Room name'));
   root.appendChild(row('Temperature sensor',selection('temperature',entityOptions(function(id,s){return id.indexOf('sensor.')===0&&s.attributes.device_class==='temperature';}))));
   root.appendChild(row('Humidity sensor',selection('humidity',entityOptions(function(id,s){return id.indexOf('sensor.')===0&&s.attributes.device_class==='humidity';}))));
   root.appendChild(row('Carbon dioxide sensor',selection('co2',entityOptions(function(id,s){return id.indexOf('sensor.')===0&&s.attributes.device_class==='carbon_dioxide';}))));
   var ids=items('controls',[]);ids.forEach(function(id){var remove=node('button','','Remove');remove.onclick=function(){saveItems('controls',items('controls',[]).filter(function(x){return x!==id;})).then(refreshStates).catch(err);};
    var sizeSelect=node('select');[['','Default size'],['Small','Small'],['Compact','Compact'],['Standard','Standard'],['Large','Large']].forEach(function(o){var op=node('option','',o[1]);op.value=o[0];sizeSelect.appendChild(op);});sizeSelect.value=Luma.parseMap(value('tiles','{}'))[id]||'';
    sizeSelect.dataset.tileEntity=id;sizeSelect.onchange=function(){var size=sizeSelect.value;sizeSelect.disabled=true;ha.setConfig(function(config){var m=Object.assign({},config.tiles||{});if(size)m[id]=size;else delete m[id];return {tiles:m};}).then(function(){sizeSelect.disabled=false;say('Tile size saved');},function(e){sizeSelect.disabled=false;err(e);});};

    var pair=node('div','row-pair');pair.appendChild(sizeSelect);pair.appendChild(remove);root.appendChild(row(name(id),pair));});
   if(Luma.fit(ids.concat(['x.x']),value('tilesize','Standard'),Luma.parseMap(value('tiles','{}')),value('columns',3)).length>ids.length){var select=node('select');entityOptions(function(id){return ['light','switch','input_boolean','fan','scene','script','button','input_button','sensor','binary_sensor'].indexOf(id.split('.')[0])>=0&&id.indexOf('luma_home_')<0&&ids.indexOf(id)<0;}).forEach(function(o){var el=node('option','',o.label);el.value=o.value;select.appendChild(el);});select.onchange=function(){if(select.value)saveItems('controls',items('controls',[]).concat([select.value])).then(refreshStates).catch(err);};root.appendChild(row('Add a control',select));}
  }else if(settingsTab==='appearance'){
   root.appendChild(row('Backdrop',selection('theme',BACKDROPS.map(function(x){return {value:x,label:x};}))));root.appendChild(row('Favorite tile size',selection('tilesize',['Small','Compact','Standard','Large'].map(function(x){return {value:x,label:x};}))));
   root.appendChild(row('Small tiles across',selection('columns',[{value:'2',label:'2 across'},{value:'3',label:'3 across'}])));
   root.appendChild(textField('background','Background image URL'));root.appendChild(textField('hdmi1','HDMI 1 name'));root.appendChild(textField('hdmi2','HDMI 2 name'));
   var idle=node('select');[0,1,2,5,10,15,30].forEach(function(v){var o=node('option','',v?v+' minutes':'Off');o.value=v;idle.appendChild(o);});idle.value=value('idle','2');idle.onchange=function(){save('idle',idle.value).catch(err);};root.appendChild(row('Idle clock',idle));
   var climate=node('button','',value('climate','on')==='on'?'Shown':'Hidden');climate.onclick=function(){save('climate',value('climate','on')!=='on').then(refreshStates).catch(err);};root.appendChild(row('Room widgets',climate));
   var previewToggle=node('button','',previewEnabled?'Enabled':'Disabled');previewToggle.onclick=function(){previewEnabled=!previewEnabled;localStorage.setItem('luma-preview',previewEnabled?'on':'off');if(previewEnabled)preview(selectedInput);else{stopPreview();$('previewMessage').textContent='Preview is off · Watch to open HDMI '+selectedInput;}renderSettings();};root.appendChild(row('HDMI preview on this TV',previewToggle));
  }else if(settingsTab==='system'){
   root.appendChild(node('p','','Voice capture starts while Home Assistant connects. Hold mode stops on release; silence cutoff applies to Tap mode.'));
   var swap=node('button','',value('home_swap','on')==='on'?'Tap full Home · Hold quick panel':'Tap quick panel · Hold full Home');swap.onclick=function(){save('home_swap',value('home_swap','on')!=='on').then(renderSettings).catch(err);};root.appendChild(row('Swap Home tap and hold',swap));
   if(ha.quickHoldConfirm){
    var reverse=value('reverse_light_keys','off')==='on';
    var lightKeys=node('button','',reverse?'Tap toggles · Hold adjusts':'Tap adjusts · Hold toggles');
    lightKeys.onclick=function(){save('reverse_light_keys',!reverse).then(renderSettings).catch(err);};
    root.appendChild(row('Adjustable lights',lightKeys));
   }
   root.appendChild(row('Mic button',selection('voice_mode',[{value:'hold',label:'Hold to speak'},{value:'tap',label:'Tap to speak'}])));
   [['voice_listen_seconds','Maximum listening time',3,30,1],['voice_start_seconds','Wait for speech',3,20,1],['voice_silence_seconds','Tap mode silence cutoff',.5,5,.1]].forEach(function(spec){var input=node('input');input.type='range';input.min=spec[2];input.max=spec[3];input.step=spec[4];input.value=value(spec[0],spec[2]);var text=node('span','',input.value+' s');var group=node('div','timing');group.appendChild(input);group.appendChild(text);input.oninput=function(){text.textContent=input.value+' s';};input.onchange=function(){save(spec[0],Number(input.value)).catch(err);};root.appendChild(row(spec[1],group));});
   [['home_button','Home button shortcut'],['microphone','Home Assistant microphone'],['voice_reply','Spoken responses'],['no_signal','Show Home when HDMI has no signal'],['screensaver','Replace the idle screensaver with the clock']].forEach(function(spec){var toggle=node('button','',value(spec[0],'off')==='on'?'On':'Off');toggle.onclick=function(){save(spec[0],value(spec[0],'off')!=='on').then(function(){renderSettings();}).catch(err);};root.appendChild(row(spec[1],toggle));});
   var idleNow=node('button','','Show idle clock');idleNow.onclick=function(){$('settings').hidden=true;ambient();};root.appendChild(row('Idle screen',idleNow));
   var recovery=node('button','','Checking…');
   var suspendFile='/var/lib/webosbrew/lumahome/lumax.suspended';
   function showRecovery(state){var paused=state.trim()==='paused';recovery.textContent=paused?'Resume LumaX Home routing':'Use local LG launcher';recovery.onclick=function(){Luma.exec(paused?'rm -f '+suspendFile:'touch '+suspendFile).then(function(){showRecovery(paused?'enabled':'paused');}).catch(err);};}
   Luma.exec('if [ -f '+suspendFile+' ]; then echo paused; else echo enabled; fi').then(showRecovery).catch(function(){recovery.disabled=true;recovery.textContent='Unavailable';});
   root.appendChild(row('LumaX Home fallback',recovery));
   var stock=node('button','','Open LG Home');stock.onclick=function(){launch('com.webos.app.home').catch(err);};root.appendChild(row('LG Home',stock));
   var uninstall=node('button','','Uninstall Luma Home…');uninstall.onclick=function(){root.innerHTML='';root.appendChild(node('p','','Remove Luma from this TV, restore the Home button and remove this TV’s saved connection? Other TVs and LG privacy settings are kept. Remove this TV’s integration entry in HA separately.'));var keep=node('button','','Keep Luma');keep.onclick=renderSettings;root.appendChild(keep);var remove=node('button','','Uninstall from this TV');remove.onclick=function(){remove.disabled=true;stopPreview();Luma.exec('cp /var/lib/webosbrew/lumahome/uninstall.sh /tmp/luma-uninstall.sh && nohup /bin/sh /tmp/luma-uninstall.sh >/tmp/luma-uninstall.log 2>&1 </dev/null &').catch(err);};root.appendChild(remove);keep.focus();};root.appendChild(row('Remove this TV’s app and shortcuts',uninstall));

  }
  LumaNav.restore(root,bookmark);
 }
 function openRoomPanel(){
  stopPreview();
  $('roomPanel').hidden=false;
  document.body.classList.add('lumax-room-open');
  $('closeRoomPanel').focus();
 }
 function closeRoomPanel(restore){
  $('roomPanel').hidden=true;
  document.body.classList.remove('lumax-room-open');
  if(restore)$('lumaxControls').focus();
 }
 $('lumaxControls').onclick=openRoomPanel;
 $('closeRoomPanel').onclick=function(){closeRoomPanel(true);};
 function openSettings(tab){cancelAuto();closeRoomPanel(false);stopPreview();settingsTab=tab||'pins';refreshStates(settingsTab==='widgets').catch(function(){});$('settings').hidden=false;renderSettings();$('closeSettings').focus();}
 $('settingsBtn').onclick=function(){openSettings();};$('closeSettings').onclick=function(){$('settings').hidden=true;$('settingsBtn').focus();};document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){settingsTab=b.dataset.tab;renderSettings();b.focus();if(settingsTab==='widgets')refreshStates(true).catch(function(){});};});
 $('watchBtn').onclick=function(){launch('com.webos.app.hdmi'+selectedInput).catch(err);};
 function focusHome(){if(!LumaLauncher.focusDock())$('settingsBtn').focus();}
 function wake(){$('ambient').hidden=true;lastActivity=Date.now();focusHome();}
 function ambient(){closeRoomPanel(false);stopPreview();$('ambient').hidden=false;$('wakeBtn').focus();}
 $('closePreviewBtn').onclick=function(){stopPreview();focusHome();};$('wakeBtn').onclick=wake;
 function cancelAuto(){if(autoDashboard){autoDashboard=false;Luma.exec('rm -f /var/lib/webosbrew/lumahome/ambient-auto').catch(function(){});}}
 function activity(){lastActivity=Date.now();}
 ['pointermove','mousemove','mousedown','touchstart','keydown'].forEach(function(event){document.addEventListener(event,activity);});
 document.addEventListener('keydown',function(e){
  var key=e.keyCode;if(!$('ambient').hidden){if(key!==13){e.preventDefault();wake();}return;}
  var scope=$('lightDetails')||(!$('settings').hidden?$('settings'):!$('roomPanel').hidden?$('roomPanel'):!$('inputPreview').hidden?$('inputPreview'):$('home'));
  if(scope===$('home')&&LumaLauncher.handle(e))return;
  if(LumaNav.handle(e,scope))return;
  if(key===461||key===27){e.preventDefault();if(!$('settings').hidden){$('settings').hidden=true;$('settingsBtn').focus();}else if(!$('roomPanel').hidden)closeRoomPanel(true);else if(!$('inputPreview').hidden){stopPreview();focusHome();}else launch('com.webos.app.hdmi'+selectedInput).catch(err);}
 });
 document.addEventListener('visibilitychange',function(){if(document.hidden)stopPreview();else{lastActivity=Date.now();if(!ha.ready)ha.connect();}});
 setInterval(function(){var minutes=Number(value('idle','2'));if(!document.hidden&&$('settings').hidden&&$('ambient').hidden&&minutes>0&&Date.now()-lastActivity>minutes*60000)ambient();},1000);
 function resize(){var scale=Math.min(window.innerWidth/1920,window.innerHeight/1080);$('home').style.transform='scale('+scale+')';}
 function launchParams(event){try{if(event&&event.detail)return typeof event.detail==='string'?JSON.parse(event.detail):event.detail;var p=window.webOSSystem&&window.webOSSystem.launchParams||window.PalmSystem&&window.PalmSystem.launchParams||'{}';return typeof p==='string'?JSON.parse(p||'{}'):p;}catch(_){return {};}}
 // Home Assistant can drive the TV by launching this app with {"luma":...} (see ha/scripts.md).
 function runAction(params){
  var action=params&&params.luma;if(!action)return false;
  var tab=['pins','widgets','appearance','system'].indexOf(params.tab)>=0?params.tab:'pins',input=String(params.input)==='2'?'2':'1';
  if(action==='settings'){$('ambient').hidden=true;openSettings(tab);}
  else if(action==='no_signal'){$('settings').hidden=true;$('ambient').hidden=true;autoDashboard=true;selectedInput=input;stopPreview();say('HDMI '+input+' has no signal.');focusHome();}
  else if(action==='idle'){$('settings').hidden=true;ambient();}
  else if(action==='input'){$('settings').hidden=true;$('ambient').hidden=true;if(params.watch===true||String(params.watch).toLowerCase()==='true')launch('com.webos.app.hdmi'+input).catch(err);else{selectedInput=input;preview(input);}}
  else if(action==='app'){launch(params.app_id).catch(err);}
  else if(action==='hook'||action==='voice'){var script=action==='hook'?'home-hook.sh':'voice-control.sh',on=String(params.state).toLowerCase()==='on';Luma.exec('/var/lib/webosbrew/lumahome/'+script+' '+(action==='hook'?(on?'enable':'stop'):(on?'enable':'disable'))).then(function(){say((action==='hook'?'Home button handler ':'Remote microphone ')+(on?'enabled':'disabled'));}).catch(err);}
  else if(action==='home'){cancelAuto();$('settings').hidden=true;$('ambient').hidden=true;if(params.input)selectedInput=input;focusHome();}
  else return false;
  return true;
 }
 document.addEventListener('webOSRelaunch',function(event){
  handoff=false;closeRoomPanel(false);stopPreview();
  var params=launchParams(event);if(params&&params.parameters)params=params.parameters;
  $('settings').hidden=true;$('ambient').hidden=true;lastActivity=Date.now();clock();focusHome();activate();
  if(!ha.ready)ha.connect();loadCatalog();runAction(params);
 });
 window.addEventListener('resize',resize);resize();clock();setInterval(clock,1000);
 previewEnabled=localStorage.getItem('luma-preview')!=='off';changed(states);focusHome();
 loadCatalog();
 setTimeout(function(){runAction(launchParams());},0);
 // Read-only runtime status for on-device inspection; never exposes credentials.
 window.lumaStatus=function(){return {version:'0.4.26',haConnected:ha.ready,stateCount:Object.keys(states).length,pins:pins(),input:selectedInput,video:{readyState:$('inputVideo').readyState,width:$('inputVideo').videoWidth,height:$('inputVideo').videoHeight,error:$('inputVideo').error&&$('inputVideo').error.code}};};
})();
