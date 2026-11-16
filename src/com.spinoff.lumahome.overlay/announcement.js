(function(){
 'use strict';
 var root,audio,ha,data,queue=[],generation=0,timer=0,pendingState=null;
 function report(state){if(!data)return;pendingState=state;if(!ha||!ha.ready)return;var id=data.id;pendingState=null;ha.call({type:'luma_home/announcement/result',tv_id:data.tv_id||ha.current.tv_id,run_id:id,state:state}).catch(function(){});}
 function layout(){if(window.lumaLayout)window.lumaLayout();}
 function end(state,keepWindow){if(!window.lumaAnnouncementOpen)return;generation++;clearTimeout(timer);LumaSpokenAudio.stop();report(state);root.hidden=true;window.lumaAnnouncementOpen=false;layout();LumaNav.resume();if(!keepWindow)Luma.hide();}
 function error(){if(!window.lumaAnnouncementOpen)return;report('error');root.querySelector('.announcement-message').textContent='Could not play this announcement.';timer=setTimeout(function(){end('error');},5000);}
 function play(run){if(run!==generation)return;var media=queue.shift();if(!media){end('done');return;}var load=media.ha?ha.call({type:'auth/sign_path',path:media.url,expires:150}).then(function(signed){return ha.current.url+signed.path;}):Promise.resolve(media.url);
  load.then(function(url){if(run!==generation)return;if(!/^https?:\/\//i.test(url))throw Error('Invalid audio URL');LumaSpokenAudio.play(url,{playing:function(){if(run===generation){report('playing');root.querySelector('.announcement-status').textContent='';}},ended:function(){if(run===generation)play(run);},error:function(){if(run===generation)error();},blocked:function(){if(run===generation){root.querySelector('.announcement-status').textContent='Press OK to play';root.querySelector('button').focus();}}});}).catch(function(){if(run===generation)error();});
 }
 window.startLumaAnnouncement=function(next){
  var voice=document.getElementById('voicePanel');if(voice&&!voice.hidden&&['starting','listening','connecting'].indexOf(voice.dataset.phase)>=0){data=next;report('cancelled');return;}
  if(window.lumaAnnouncementOpen)end('cancelled',true);data=next;var run=++generation;queue=[data.preannounce,data.media].filter(function(m){return m&&m.url;});
  if(!root){root=document.createElement('aside');root.id='announcementPanel';root.className='announcement-panel';root.innerHTML='<div class="announcement-heading">Home Assistant <button class="overlay-close" aria-label="Dismiss announcement">×</button></div><div class="announcement-message"></div><div class="announcement-status"></div>';document.body.appendChild(root);root.querySelector('button').onclick=function(){end('cancelled');};}

  if(window.pauseLumaVoiceAudio)window.pauseLumaVoiceAudio();window.lumaAnnouncementOpen=true;root.hidden=false;Luma.formatText(root.querySelector('.announcement-message'),data.message||'Announcement');root.querySelector('.announcement-status').textContent='Connecting…';layout();
  if(!document.activeElement||document.activeElement===document.body||document.activeElement.offsetParent===null)root.querySelector('button').focus();
  clearTimeout(timer);timer=setTimeout(function(){if(run===generation)end('error');},140000);
  function ready(){if(run!==generation)return;if(ha.ready){if(pendingState)report(pendingState);play(run);}else setTimeout(ready,50);}
  if(!ha)ha=new Luma.HA(null,function(){},function(){});ha.connect();ready();
 };
 window.cancelLumaAnnouncement=function(keepWindow){end('cancelled',keepWindow);};
 window.lumaAnnouncementStatus=function(){return {open:!!window.lumaAnnouncementOpen,audio:LumaSpokenAudio.status()};};
 document.addEventListener('keydown',function(e){if(!root||root.hidden||!root.contains(document.activeElement))return;if([13,27,461].indexOf(e.keyCode)<0)return;e.preventDefault();e.stopImmediatePropagation();if(e.keyCode===13&&LumaSpokenAudio.status().state!=='playing')LumaSpokenAudio.resume();else end('cancelled');});
})();
