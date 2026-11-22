exports.setup=({boot,catalogDelayMs=0,discoveryDelayMs=0,climate=false,catalogArtwork={},catalogUnavailable=false})=>{
  const settings={room:'Test room',pins:['org.jellyfin.webos','luma:app/smarttube'],controls:['light.test','switch.test','switch.two'],temperature:'',humidity:'',hdmi1:'HDMI 1',hdmi2:'HDMI 2',theme:'Forest',background:'',palette:'',climate:true,idle:2,tilesize:'Standard',tiles:{},columns:3,home_button:true,microphone:true,voice_reply:true,voice_mode:'hold',voice_listen_seconds:15,voice_start_seconds:8,voice_silence_seconds:1.5,no_signal:false,screensaver:false};
  const states={'light.test':{entity_id:'light.test',state:'on',attributes:{friendly_name:'Test light',brightness:128,supported_color_modes:['color_temp'],color_temp_kelvin:3000,min_color_temp_kelvin:2000,max_color_temp_kelvin:6500}},'switch.test':{entity_id:'switch.test',state:'off',attributes:{friendly_name:'Test switch'}},'switch.two':{entity_id:'switch.two',state:'on',attributes:{friendly_name:'Second switch'}}};
  if(climate) {
    for(const [key,device_class,state,unit] of [['temperature','temperature','21.4','°C'],['humidity','humidity','55','%'],['co2','carbon_dioxide','864','ppm']]) {
      const entity_id='sensor.test_'+key;
      settings[key]=entity_id;
      states[entity_id]={entity_id,state,attributes:{device_class,unit_of_measurement:unit}};
    }
    settings.theme='Twilight';
  }
  for(const [key,id] of Object.entries(boot.helpers))states[id]={entity_id:id,state:key==='tiles'?'{}':key==='tilesize'?'Standard':'legacy',attributes:{}};
  const config=()=>({clock:{utc_ms:Date.UTC(2026,9,30,12,34,0),time_zone:'Europe/Amsterdam'},entry_id:'bedroom',tv_id:'tv-stable-id',settings:{...settings},catalog:boot.catalog});
  window.mockStates=states;window.calls=[];window.commands=[];window.fullSnapshots=0;window.sockets=[];
  window.catalogUnavailable=catalogUnavailable;
  window.PalmServiceBridge=class{call(uri,raw){
   const p=JSON.parse(raw),r={returnValue:true};
   if(uri.includes('listApps')){
    if(!window.catalogUnavailable)r.apps=boot.catalog;
   }else if(uri.includes('hbchannel')){
    window.commands.push(p.command);
    let result={success:true,returnValue:true};
    if(p.command.includes('discover-ha'))result={url:'http://ha.invalid',token:'test-only',tv_id:'tv-stable-id'};
    else if(p.command.includes('--artwork'))result=catalogArtwork;
    else if(p.command.includes('list-apps.py'))result=window.catalogUnavailable?{error:'Catalog unavailable'}:boot.catalog;
    r.stdoutString=JSON.stringify(result);
   }
   const delay=uri.includes('listApps')?catalogDelayMs:p.command&&p.command.includes('discover-ha')?discoveryDelayMs:0;
   setTimeout(()=>{if(uri.includes('listApps'))window.catalogReady=true;this.onservicecallback(JSON.stringify(r));},delay);
  }cancel(){}};
  window.WebSocket=class{constructor(){this.readyState=1;window.sockets.push(this);setTimeout(()=>this.emit({type:'auth_required'}),0);}emit(m){this.onmessage?.({data:JSON.stringify(m)});}send(raw){const m=JSON.parse(raw);window.calls.push(m);setTimeout(()=>{
   const result=x=>this.emit({type:'result',id:m.id,success:true,result:x});
   if(m.type==='auth')return this.emit({type:'auth_ok'});
   if(m.type==='luma_home/config/get')return result(config());
   if(m.type==='luma_home/config/subscribe'){this.configSub=m.id;return result(null);}
   if(m.type==='luma_home/config/set'){Object.assign(settings,m.settings);result(config());window.sockets.forEach(s=>s.emit({type:'event',id:s.configSub,event:config()}));return;}
   if(m.type==='luma_home/states')return result(m.entity_ids.map(id=>states[id]).filter(Boolean));
   if(m.type==='auth/sign_path')return result({path:m.path+(m.path.includes('?')?'&':'?')+'authSig='+encodeURIComponent(btoa(m.path))});
   if(m.type==='luma_home/announcement/result')return result({accepted:true});
   if(m.type==='luma_home/quick/subscribe'){this.quickSub=m.id;return result(null);}
   if(m.type==='luma_home/report'||m.type==='unsubscribe_events')return result(null);
   if(m.type==='subscribe_trigger'){this.stateSub=m.id;return result(null);}
   if(m.type==='get_states'){window.fullSnapshots++;return result(Object.values(states));}
   if(m.type==='call_service')return result(null);
   if(m.type==='ping')return this.emit({type:'pong',id:m.id});
  },0);}close(){this.readyState=3;this.onclose?.();}};
  window.configChange=patch=>{Object.assign(settings,patch);window.sockets.forEach(s=>s.emit({type:'event',id:s.configSub,event:config()}));};
 };
