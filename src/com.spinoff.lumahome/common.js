(function(global){
 'use strict';
 var bridges=[],cachedConnection=null;
 function luna(uri,params){return new Promise(function(resolve,reject){
  if(typeof PalmServiceBridge==='undefined'){reject(new Error('TV API is unavailable in this browser.'));return;}
  var b=new PalmServiceBridge(),done=false;
  bridges.push(b);
  var timer=setTimeout(function(){finish(new Error('TV request timed out.'));},18000);
  function finish(err,value){if(done)return;done=true;clearTimeout(timer);bridges=bridges.filter(function(x){return x!==b;});try{b.cancel();}catch(_){}if(err)reject(err);else resolve(value);}
  b.onservicecallback=function(raw){try{var r=typeof raw==='string'?JSON.parse(raw):raw;if(r.returnValue===false)finish(new Error(r.errorText||'TV rejected the request.'));else finish(null,r);}catch(e){finish(e);}};
  try{b.call(uri,JSON.stringify(params||{}));}catch(e){finish(e);}
 });}
 function exec(command){return luna('luna://org.webosbrew.hbchannel.service/exec',{command:command}).then(function(r){return String(r.stdoutString||r.stdout||'');});}
 function getConnection(){
  if(cachedConnection)return Promise.resolve(cachedConnection);
  var command='/usr/bin/python /media/developer/apps/usr/palm/applications/com.spinoff.lumahome/runtime/discover-ha.py --connection';
  function discover(flag){return exec(command+flag).then(function(raw){var c=JSON.parse(raw.trim());if(c.error)throw Error(c.error);return c;});}
  return discover(' --fast').catch(function(){return discover(' --browse');});
 }
 function connectionAddress(){return getConnection().then(function(connection){return connection.url.replace(/\/$/,'');});}
 function HA(connection,changed,status){this.connection=connection;this.changed=changed;this.status=status;this.states={};this.pending={};this.events={};this.seq=0;this.epoch=0;this.ready=false;this.stopped=false;this.delay=2000;}
 HA.prototype.connect=function(){
  var self=this;if(self.ready||self.connecting)return;clearTimeout(self.retry);self.connecting=true;var epoch=++self.epoch;self.stopped=false;self.status('Finding Home Assistant…');
  var load=self.connection?Promise.resolve(self.connection):getConnection();
  load.then(function(c){
   if(self.stopped||epoch!==self.epoch)return;
   self.current=c;cachedConnection=c;
   var ws=new WebSocket(c.url.replace(/^http/,'ws')+'/api/websocket');self.ws=ws;
   var timeout=setTimeout(function(){ws.close();},15000);
   ws.onmessage=function(event){
    if(self.ws!==ws||epoch!==self.epoch)return;
    try{
     var m=JSON.parse(event.data);
     if(m.type==='auth_required'){ws.send(JSON.stringify({type:'auth',access_token:c.token}));}
     else if(m.type==='auth_invalid'){self.status('HA pairing was revoked. Pair again in Settings.');ws.close();}
     else if(m.type==='auth_ok'){
      clearTimeout(timeout);self.connecting=false;self.ready=true;self.delay=2000;
      self.loading=true;self.buffer=[];self.watchSig='';self.triggerSub=0;
      var identity=c.tv_id?{tv_id:c.tv_id}:{};
      self.call(Object.assign({type:'luma_home/config/get'},identity)).then(function(config){
       if(self.ws!==ws)return;self.entryId=config.entry_id;self.applyConfig(config);
       return self.subscribe({type:'luma_home/config/subscribe',entry_id:self.entryId},function(next){self.applyConfig(next);self.refreshScoped().catch(function(){});});
      }).then(function(){return self.refreshScoped();}).then(function(){
       if(self.ws!==ws)return;self.loading=false;self.status('Home Assistant connected');self.changed(self.states);
       self.report({setup_complete:true}).catch(function(){});
      }).catch(function(e){self.status(e.message||'Add the Luma Home integration in HA.');self.loading=false;self.changed(self.states);});
      self.heartbeat=setInterval(function(){self.call({type:'ping'}).catch(function(){ws.close();});if(!self.clockSyncAt||Date.now()-self.clockSyncAt>600000){self.clockSyncAt=Date.now();if(self.entryId)self.call({type:'luma_home/config/get',entry_id:self.entryId}).then(function(c){self.applyConfig(c);}).catch(function(){});}},30000);
     }else if(m.type==='result'||m.type==='pong'){
      var p=self.pending[m.id];if(p){clearTimeout(p.timer);delete self.pending[m.id];if(m.success===false){delete self.events[m.id];p.reject(Error(m.error&&m.error.message||'Home Assistant rejected the action.'));}else p.resolve(m.result);}
     }else if(m.type==='event'&&self.events[m.id])self.events[m.id](m.event);
    }catch(_){self.status('Could not read a Home Assistant response.');}
   };
   ws.onerror=function(){};
   ws.onclose=function(){clearTimeout(timeout);if(self.ws!==ws||epoch!==self.epoch)return;clearInterval(self.heartbeat);self.connecting=false;self.ready=false;cachedConnection=null;self.triggerSub=0;self.watchSig='';self.changed(self.states);self.events={};Object.keys(self.pending).forEach(function(id){var p=self.pending[id];clearTimeout(p.timer);p.reject(Error('Home Assistant disconnected.'));});self.pending={};if(!self.stopped){self.status('HA offline · reconnecting');self.retry=setTimeout(function(){self.connect();},self.delay);self.delay=Math.min(30000,self.delay*2);}};
  }).catch(function(){if(!self.stopped&&epoch===self.epoch){self.connecting=false;self.status('Looking for paired HA on the network…');self.retry=setTimeout(function(){self.connect();},10000);}});
 };
 HA.prototype.call=function(command,listener){
  var self=this;return new Promise(function(resolve,reject){if(!self.ready||!self.ws||self.ws.readyState!==1){reject(Error('Home Assistant is offline.'));return;}var id=++self.seq;command=Object.assign({},command,{id:id});if(listener)self.events[id]=listener;var timer=setTimeout(function(){delete self.pending[id];reject(Error('Home Assistant request timed out.'));},12000);self.pending[id]={resolve:resolve,reject:reject,timer:timer};self.ws.send(JSON.stringify(command));});
 };
 HA.prototype.subscribe=function(command,listener){return this.call(command,listener);};
 HA.prototype.applyConfig=function(config){
  this.config=config.settings||{};this.quickHoldConfirm=config.quick_hold_confirm===true;this.entryId=config.entry_id;this.tvId=config.tv_id;if(config.clock){this.clockOffset=Number(config.clock.utc_ms)-Date.now();this.timeZone=config.clock.time_zone;try{localStorage.setItem('luma-clock',JSON.stringify({offset:this.clockOffset,zone:this.timeZone}));}catch(_){}}this.catalog=config.catalog||[];
  var self=this,helpers=(window.LUMA_BOOTSTRAP&&window.LUMA_BOOTSTRAP.helpers)||{};
  Object.keys(self.config).forEach(function(k){if(!helpers[k])helpers[k]='luma_config.'+k;var v=self.config[k];self.states[helpers[k]]={entity_id:helpers[k],state:typeof v==='boolean'?(v?'on':'off'):typeof v==='object'?JSON.stringify(v):String(v),attributes:{}};});
  if(!self.loading)self.changed(self.states);
  if(global.LumaRuntime)global.LumaRuntime.configure(config).catch(function(){});
 };
 HA.prototype.setConfig=function(patch){var self=this;var next=(self.writeQueue||Promise.resolve()).catch(function(){}).then(function(){var checked=typeof patch==='function'?patch(self.config):patch;return self.call({type:'luma_home/config/set',entry_id:self.entryId,settings:checked});}).then(function(c){self.applyConfig(c);return c;});self.writeQueue=next;return next;};
 HA.prototype.report=function(data){return this.call({type:'luma_home/report',entry_id:this.entryId,status:data});};
 HA.prototype.refreshScoped=function(){var self=this;return self.resubscribe().then(function(){return self.call({type:'luma_home/states',entry_id:self.entryId,entity_ids:self.watchedIds()});}).then(function(a){a.forEach(function(x){self.states[x.entity_id]=x;});self.buffer.forEach(function(e){if(e[1])self.states[e[0]]=e[1];else delete self.states[e[0]];});self.buffer=[];if(!self.loading)self.changed(self.states);});};
 HA.prototype.watchedIds=function(){var seen={};return (this.watchFn?this.watchFn(this.states)||[]:[]).filter(function(id){if(typeof id!=='string'||!/^[a-z_]+\.[a-z0-9_]+$/.test(id)||seen[id])return false;seen[id]=1;return true;});};
 HA.prototype.resubscribe=function(){
  var self=this,ids=self.watchedIds(),sig=ids.slice().sort().join(',');if(!self.ready||!ids.length||(sig===self.watchSig&&self.triggerSub))return Promise.resolve();
  var previous=self.triggerSub,next=0,wsRef=self.ws;self.watchSig=sig;
  var request=self.call({type:'subscribe_trigger',trigger:{platform:'state',entity_id:ids}},function(event){var v=event&&event.variables&&event.variables.trigger;if(!v||!v.entity_id)return;if(v.to_state)self.states[v.entity_id]=v.to_state;else delete self.states[v.entity_id];if(self.loading)self.buffer.push([v.entity_id,v.to_state]);else self.notify();});next=self.seq;
  return request.then(function(){if(self.ws!==wsRef)return;self.triggerSub=next;if(previous){delete self.events[previous];self.call({type:'unsubscribe_events',subscription:previous}).catch(function(){});}});
 };
 HA.prototype.notify=function(){var self=this;if(self.notifyTimer)return;self.notifyTimer=setTimeout(function(){self.notifyTimer=0;if(self.stopped)return;self.changed(self.states);self.resubscribe().catch(function(){});},150);};
 HA.prototype.service=function(domain,service,entity,data){var body={type:'call_service',domain:domain,service:service,service_data:data||{}};if(entity)body.target={entity_id:entity};return this.call(body);};
 HA.prototype.stop=function(){this.stopped=true;this.connecting=false;this.ready=false;this.epoch++;clearTimeout(this.retry);clearTimeout(this.notifyTimer);this.notifyTimer=0;clearInterval(this.heartbeat);this.events={};var self=this;Object.keys(this.pending).forEach(function(id){var p=self.pending[id];clearTimeout(p.timer);p.reject(Error('Home Assistant connection stopped.'));});this.pending={};if(this.ws)this.ws.close();};
 function prepareInput(id){
  if(!/^com\.webos\.app\.hdmi[12]$/.test(id))return Promise.resolve();
  return exec("/usr/bin/luna-send -w 1500 -n 1 -f luna://com.webos.surfacemanager/closeByAppId '{\"id\":\""+id+"\"}'").then(function(raw){var r=JSON.parse(raw.trim());if(r.returnValue===false&&!/not running/i.test(r.errorText||''))throw Error(r.errorText||'Could not release the native input app.');});
 }
 // Arm before hiding: webOS may suspend this document once it is hidden.
 function restoreInputVideo(id){
  if(!/^com\.webos\.app\.hdmi[12]$/.test(id))return Promise.resolve();
  return exec("nohup /usr/bin/python /var/lib/webosbrew/lumahome/input-handoff.py '"+id+"' >/dev/null 2>&1 </dev/null &");
 }
 function list(value){try{var a=JSON.parse(value);return Array.isArray(a)?a.filter(function(x){return typeof x==='string';}):[];}catch(_){return [];}}
 function saveList(ha,entity,items){items=items.filter(function(x,i,a){return typeof x==='string'&&a.indexOf(x)===i;});var value=JSON.stringify(items);if(value.length>255)return Promise.reject(Error('This list is full. Remove a pin before adding another.'));return ha.service('input_text','set_value',entity,{value:value});}
 function nativeHide(){var system=global.PalmSystem||global.webOSSystem;try{if(system){if(typeof system.keepAlive==='function')system.keepAlive(true);else if(typeof system.keepAlive==='boolean')system.keepAlive=true;}}catch(_){}try{if(system&&typeof system.hide==='function'){system.hide();return;}}catch(_){}global.close();}
 function overlayOpen(){return global.lumaCameraOpen||global.lumaVoiceOpen||global.lumaQuickOpen||global.lumaNotificationOpen||global.lumaAnnouncementOpen;}
 function hide(repairVideo){if(overlayOpen())return Promise.resolve();if(repairVideo===false){nativeHide();return Promise.resolve();}return exec("nohup /usr/bin/python /var/lib/webosbrew/lumahome/input-handoff.py --current >/dev/null 2>&1 </dev/null &").catch(function(){}).then(function(){if(!overlayOpen())nativeHide();});}
 var HEIGHT={Small:138,Compact:70,Standard:106,Large:132},BUDGET=488,MAXTILES=12;
 function sizeFor(id,fallback,map){var s=map&&map[id];return HEIGHT[s]?s:(HEIGHT[fallback]?fallback:'Standard');}
 function layout(ids,fallback,map,columns){columns=Number(columns)===2?2:3;var y=0,rowH=0,col=0,out=[];
  ids.forEach(function(id){var size=sizeFor(id,fallback,map),small=size==='Small',span=small?6/columns:6,h=HEIGHT[size];if(col+span>6){y+=rowH+14;col=0;rowH=0;}if(out.length>=MAXTILES||y+h>BUDGET)return;out.push({id:id,size:size,x:col/6,y:y,width:span/6,height:h});col+=span;rowH=Math.max(rowH,h);if(col===6){y+=rowH+14;col=0;rowH=0;}});return out;
 }
 function fit(ids,fallback,map,columns){return layout(ids,fallback,map,columns).map(function(x){return x.id;});}
 function parseMap(v){try{var o=JSON.parse(v);return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}catch(_){return {};}}
 function formatText(root,value){root.textContent='';var text=String(value||''),pattern=/\*\*([^*]+)\*\*/g,last=0,m;while((m=pattern.exec(text))){root.appendChild(document.createTextNode(text.slice(last,m.index)));var strong=document.createElement('strong');strong.textContent=m[1];root.appendChild(strong);last=m.index+m[0].length;}root.appendChild(document.createTextNode(text.slice(last)));}
 global.Luma={connectionAddress:connectionAddress,formatText:formatText,prepareInput:prepareInput,restoreInputVideo:restoreInputVideo,layout:layout,sizeFor:sizeFor,fit:fit,parseMap:parseMap,luna:luna,exec:exec,HA:HA,list:list,saveList:saveList,hide:hide};
})(window);
