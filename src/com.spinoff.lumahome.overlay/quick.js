(function(){
 'use strict';
 var helpers=window.LUMA_BOOTSTRAP.helpers,ha,root,activity=Date.now(),closed=false;
 var relay=null,relayTimer=0,relayAttempt=null,lightPress=null,lightCard=null,lightPanel=null;
 var remoteKeyCodes={left:37,up:38,right:39,down:40,ok:13,back:461};
 function watchList(s){var x=s[helpers.controls];var ids=Luma.list(x&&x.state||'[]');
  ['temperature','humidity','co2'].forEach(function(key){var state=s[helpers[key]];if(state&&state.state)ids.push(state.state);});return ids;}
 function value(key,def){var s=ha&&ha.states[helpers[key]];return s?s.state:def;}
 function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function button(label,fn,icon){var b=el('button','quick-button');if(icon)b.appendChild(LumaIcons.icon(icon));b.appendChild(el('span','quick-button-label',label));b.onclick=fn;return b;}
 function suspend(){closed=true;lightPress=null;syncRelay();window.lumaQuickOpen=false;if(root)root.hidden=true;if(window.lumaLayout)window.lumaLayout();LumaNav.resume();}
 function close(){suspend();Luma.hide();}
 function syncRelay(){
  var socket=ha&&ha.ws,visible=root&&!root.hidden&&!document.hidden&&!closed;
  if(relay&&(!visible||!ha.ready||relay.socket!==socket||!ha.config.lumax_enabled)){
   clearInterval(relayTimer);
   if(relay.socket===socket&&ha.ready){delete ha.events[relay.id];ha.call({type:'unsubscribe_events',subscription:relay.id}).catch(function(){});}
   relay=null;
  }
  if(!visible){relayAttempt=null;return;}
  if(relay||!ha||!ha.ready||!ha.entryId||!ha.config.lumax_enabled||relayAttempt===socket)return;
  relayAttempt=socket;
  var request={type:'luma_home/quick/subscribe',role:'webos',entry_id:ha.entryId};
  if(ha.quickHoldConfirm)request.hold_confirm=true;
  var subscription=ha.subscribe(request,function(event){
   if(relay!==current||closed||document.hidden)return;
   if(event.key==='close'){close();return;}
   var key=event.key==='ok_hold'?13:remoteKeyCodes[event.key];
   if(!key)return;
   if(!root.contains(document.activeElement))root.querySelector('button').focus();
   if(key===13&&document.activeElement.dataset.dim){
    activity=Date.now();
    selectLight(document.activeElement,event.key==='ok_hold');
    return;
   }
   if(!handleKey({keyCode:key,preventDefault:function(){},stopImmediatePropagation:function(){}})&&key===13)document.activeElement.click();
  });
  var current={id:ha.seq,socket:socket};relay=current;
  subscription.then(function(){
   if(relay!==current){if(ha.ready&&ha.ws===socket)ha.call({type:'unsubscribe_events',subscription:current.id}).catch(function(){});return;}
   relayTimer=setInterval(function(){
    syncRelay();
    if(relay!==current)return;
    ha.call({type:'luma_home/quick/keepalive',entry_id:ha.entryId,subscription:current.id}).then(function(result){
     if(relay===current&&!result.active)close();
    }).catch(function(){});
   },12000);
  }).catch(function(){if(relay===current)relay=null;});
 }
 function launch(id){if(id==='com.webos.app.home'){Luma.exec('/var/lib/webosbrew/lumahome/home-hook.sh stock').then(close);return;}Luma.prepareInput(id).then(function(){return Luma.luna('luna://com.webos.applicationManager/launch',{id:id});}).then(function(){return Luma.restoreInputVideo(id);}).then(close).catch(function(e){root.querySelector('.quick-status').textContent=e.message;});}
 function level(s){return Math.max(0,Math.min(100,Math.round((Number(s.attributes.brightness)||0)/2.55)));}
 var dimHold={},dimTimers={};
 function dimBy(id,delta){var s=ha&&ha.states[id];if(!ha||!ha.ready||!s||s.state==='unavailable'||s.state==='unknown')return;var held=dimHold[id]&&Date.now()<dimHold[id].until,current=held?dimHold[id].pct:(s.state==='on'?level(s):0),next=Math.max(0,Math.min(100,Math.round((current+delta)/10)*10));dimHold[id]={pct:next,until:Date.now()+2500};update();clearTimeout(dimTimers[id]);dimTimers[id]=setTimeout(function(){(next>0?ha.service('light','turn_on',id,{brightness_pct:next}):ha.service('light','turn_off',id)).catch(function(e){root.querySelector('.quick-status').textContent=e.message;});},250);}
  function streamer(script){if(!ha||!ha.ready){root.querySelector('.quick-status').textContent='Home Assistant is offline.';return;}ha.service('luma_home','launch_app',null,{entry_id:ha.entryId,app:script}).catch(function(e){root.querySelector('.quick-status').textContent=e.message;});}
 function toggleControl(card){
  var id=card.dataset.entity,state=ha.states[id],domain=id.split('.')[0],service;
  if(!ha.ready||!state||['unavailable','unknown'].indexOf(state.state)>=0)return;
  if(['light','switch','input_boolean','fan'].indexOf(domain)>=0)service=state.state==='on'?'turn_off':'turn_on';
  else if(['scene','script'].indexOf(domain)>=0)service='turn_on';
  else if(['button','input_button'].indexOf(domain)>=0)service='press';
  if(service)ha.service(domain,service,id).catch(function(e){root.querySelector('.quick-status').textContent=e.message;});
 }
 function selectLight(card,held){
  var reverse=value('reverse_light_keys','off')==='on';
  if(held!==reverse){toggleControl(card);return;}
  lightCard=card;
  lightPanel=el('div','quick-light');
  LumaLights.attach(lightPanel,card.dataset.entity,function(){return ha;},function(e){root.querySelector('.quick-status').textContent=e.message;},true);
  lightPanel.appendChild(lightPanel.querySelector('.light-actions'));
  root.querySelector('.quick-controls').hidden=true;
  root.querySelector('.quick-label').hidden=true;
  root.querySelector('.quick-climate').hidden=true;
  root.querySelector('.quick-local-actions').hidden=true;
  root.appendChild(lightPanel);
  root.querySelector('.quick-title').textContent=ha.states[card.dataset.entity].attributes.friendly_name||card.dataset.entity;
  root.querySelector('.overlay-close').onclick=backToControls;
  LumaNav.focus(lightPanel.querySelector('input'));
 }
 function backToControls(){
  if(!lightPanel)return;
  var previous=lightCard;lightPanel.remove();lightPanel=null;lightCard=null;
  root.querySelector('.quick-controls').hidden=false;
  root.querySelector('.quick-label').hidden=false;
  root.querySelector('.overlay-close').onclick=close;
  update();if(previous&&document.contains(previous))LumaNav.focus(previous);

 }
 function update(){
  syncRelay();
  if(ha.config){
   var paired=!!ha.config.lumax_enabled;
   root.querySelector('.quick-local-actions').hidden=paired||!!lightPanel;
   try{localStorage.setItem('luma-quick-paired',String(paired));}catch(_){}
  }
  var ids=Luma.list(value('controls','[]')),container=root.querySelector('.quick-controls'),bookmark=LumaNav.bookmark(container);
  root.querySelector('.quick-empty').hidden=ids.length!==0||!ha.ready;
  var signature=JSON.stringify([ids,ids.map(function(i){var q=ha.states[i];return !!(i.indexOf('light.')===0&&q&&(q.attributes.supported_color_modes||[]).some(function(m){return m!=='onoff';}));})]);if(container.dataset.ids!==signature){container.innerHTML='';container.dataset.ids=signature;ids.forEach(function(id){var b=el('div','quick-button');b.tabIndex=0;b.setAttribute('role','button');b.dataset.navCard='';b.appendChild(el('span','quick-button-label'));b.onclick=function(e){if(e&&e.target.closest('input,label,.light-actions'))return;if(b.dataset.dim)selectLight(b,false);else toggleControl(b);};b.insertBefore(LumaIcons.icon(LumaIcons.control(id,ha.states[id])),b.firstChild);b.dataset.entity=id;var st=ha.states[id];if(id.indexOf('light.')===0&&st&&(st.attributes.supported_color_modes||[]).some(function(m){return m!=='onoff';})){b.dataset.dim='1';b.insertBefore(el('span','fill'),b.firstChild);b.addEventListener('wheel',function(e){e.preventDefault();dimBy(id,e.deltaY<0?10:-10);});}container.appendChild(b);});}
  container.querySelectorAll('[data-entity]').forEach(function(b){var s=ha.states[b.dataset.entity];var held=dimHold[b.dataset.entity]&&Date.now()<dimHold[b.dataset.entity].until,pct=held?dimHold[b.dataset.entity].pct:(ha.ready&&s&&s.state==='on'?level(s):0);if(b.dataset.dim){var fill=b.querySelector('.fill');fill.style.width=pct+'%';fill.style.opacity=pct>0?'1':'0';}b.querySelector('.quick-button-label').textContent=(s&&s.attributes.friendly_name||b.dataset.entity)+'  ·  '+(ha.ready&&s?(b.dataset.dim&&(s.state==='on'||(held&&pct>0))?pct+'%':s.state):'Unavailable');b.setAttribute('aria-pressed',String(ha.ready&&s&&s.state==='on'));});
  LumaLights.update(root,ha);LumaNav.restore(container,bookmark);
  root.querySelector('.quick-title').textContent=lightCard?(ha.states[lightCard.dataset.entity].attributes.friendly_name||lightCard.dataset.entity):value('room','Home');
  var climate=root.querySelector('.quick-climate'),readings=[];
  if(value('climate','on')!=='off'){
   [['temperature','Temperature','thermometer'],['humidity','Humidity','droplets'],['co2','Carbon dioxide','wind']].forEach(function(item){
    var sensor=ha.states[value(item[0],'')];
    if(ha.ready&&sensor&&['unknown','unavailable'].indexOf(sensor.state)<0){
     var raw=Number(sensor.state),places=item[0]==='temperature'?1:0;
     var text=(isFinite(raw)?raw.toLocaleString(undefined,{maximumFractionDigits:places}):sensor.state)+' '+(sensor.attributes.unit_of_measurement||'');
     readings.push({label:item[1],icon:item[2],value:text.trim()});
    }
   });
  }
  var climateSignature=JSON.stringify(readings);
  if(climate.dataset.values!==climateSignature){
   climate.dataset.values=climateSignature;
   climate.innerHTML='';
   readings.forEach(function(reading){
    var row=el('span','quick-reading');
    row.setAttribute('aria-label',reading.label+' '+reading.value);
    row.appendChild(LumaIcons.icon(reading.icon));
    row.appendChild(el('span','',reading.value));
    climate.appendChild(row);
   });
  }
  climate.hidden=!readings.length||!!lightPanel;
 }
 function buildQuick(){
  root=el('aside','quick-panel');root.id='quickPanel';
  var heading=el('div','quick-heading');
  heading.appendChild(el('h1','quick-title','Home'));
  var closeButton=el('button','overlay-close','×');
  closeButton.setAttribute('aria-label','Close Room controls');
  closeButton.dataset.navZone='quick-header';
  closeButton.onclick=close;
  heading.appendChild(closeButton);
  root.appendChild(heading);
  var climate=el('div','quick-climate');climate.hidden=true;root.appendChild(climate);
  root.appendChild(el('p','quick-label','Quick controls'));
  var empty=el('p','quick-empty','Choose room controls in Settings.');empty.hidden=true;root.appendChild(empty);
  var controls=el('div','quick-controls');controls.dataset.navZone='quick-controls';root.appendChild(controls);
  var local=el('div','quick-local-actions');
  local.hidden=true;
  try{local.hidden=localStorage.getItem('luma-quick-paired')!=='false';}catch(_){}
  var inputs=el('div','quick-inputs');inputs.dataset.navZone='quick-inputs';
  inputs.appendChild(button('HDMI 1',function(){launch('com.webos.app.hdmi1');},'monitor'));
  inputs.appendChild(button('HDMI 2',function(){launch('com.webos.app.hdmi2');},'monitor'));
  inputs.appendChild(button('SmartTube',function(){streamer('smarttube');},'play'));
  inputs.appendChild(button('Jellyfin',function(){streamer('jellyfin');},'play'));
  local.appendChild(inputs);
  var fullHome=button('Open full home',function(){launch('com.spinoff.lumahome');},'house');
  var stockHome=button('LG Home',function(){launch('com.webos.app.home');},'external-link');
  fullHome.dataset.navZone=stockHome.dataset.navZone='quick-action';
  local.appendChild(fullHome);local.appendChild(stockHome);root.appendChild(local);
  root.appendChild(el('p','quick-status','Connecting to Home Assistant…'));
  document.body.appendChild(root);
 }
 window.startLumaQuick=function(){
  if(!root)buildQuick();
  if(lightPanel)backToControls();
  root.hidden=false;closed=false;activity=Date.now();
  if(!ha){
   ha=new Luma.HA(null,update,function(status){
    var line=root.querySelector('.quick-status');
    line.textContent=status;
    line.hidden=status==='Home Assistant connected';
   });
   ha.watchFn=watchList;ha.connect();
  }else{update();if(!ha.ready)ha.connect();}
  root.querySelector('button').focus();
 };
 window.lumaOverlayStatus=function(){return {version:'0.4.27',quickOpen:!!window.lumaQuickOpen,visible:!document.hidden,haConnected:!!(ha&&ha.ready)};};window.closeLumaQuick=close;
 window.suspendLumaQuick=suspend;
 function handleKey(e){if(!root||root.hidden||!root.contains(document.activeElement))return false;activity=Date.now();if(lightPanel){
  if([27,461].indexOf(e.keyCode)>=0){e.preventDefault();e.stopImmediatePropagation();backToControls();return true;}
  var active=document.activeElement;
  if((e.keyCode===37||e.keyCode===39)&&active.type==='range'){LumaLights.adjust(lightPanel,e.keyCode===39?1:-1,active);e.preventDefault();e.stopImmediatePropagation();return true;}
  if(e.keyCode===38||e.keyCode===40){var fields=[root.querySelector('.overlay-close')].concat(Array.from(lightPanel.querySelectorAll('input,button'))),index=fields.indexOf(active);LumaNav.focus(fields[(index+(e.keyCode===40?1:-1)+fields.length)%fields.length]);e.preventDefault();e.stopImmediatePropagation();return true;}
 }if(LumaNav.handle(e,root))return true;if([27,461].indexOf(e.keyCode)>=0){e.preventDefault();e.stopImmediatePropagation();close();return true;}return false;}
 document.addEventListener('keydown',function(e){
  var active=document.activeElement;
  if(e.keyCode===13&&root&&!root.hidden&&root.contains(active)&&active.dataset.dim){
   if(!lightPress)lightPress={card:active,started:Date.now()};
   e.preventDefault();e.stopImmediatePropagation();activity=Date.now();return;
  }
  handleKey(e);
 });
 document.addEventListener('keyup',function(e){
  if(e.keyCode!==13||!lightPress)return;
  var press=lightPress;lightPress=null;
  if(!root||root.hidden||document.activeElement!==press.card)return;
  e.preventDefault();e.stopImmediatePropagation();
  selectLight(press.card,Date.now()-press.started>=650);
 });
 document.addEventListener('visibilitychange',function(){if(document.hidden){setTimeout(function(){if(document.hidden&&root&&!root.hidden)suspend();else syncRelay();},50);}else syncRelay();});
 window.addEventListener('blur',function(){
  if(!root||root.hidden)return;
  suspend();
  Luma.hide(false);
 });
 document.addEventListener('mousemove',function(){activity=Date.now();});
 setInterval(function(){if(root&&!root.hidden&&!closed&&Date.now()-activity>30000)close();},1000);
})();
