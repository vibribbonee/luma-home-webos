(function(){
 'use strict';
 var root,timer,audio;
 function playback(state){window.lumaVoiceAudio=state;Luma.exec("printf '%s' '"+state+"' > /var/lib/webosbrew/lumahome/audio-state").catch(function(){});}
 function cancel(){Luma.exec('/var/lib/webosbrew/lumahome/voice-control.sh cancel').catch(function(){});dismiss();}
 function dismiss(){clearTimeout(timer);if(audio){audio.pause();audio.removeAttribute('src');}if(root)root.hidden=true;window.lumaVoiceOpen=false;if(window.lumaLayout)window.lumaLayout();LumaNav.resume();Luma.hide();}
 function el(tag,cls,text){var n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;}
 window.pauseLumaVoiceAudio=function(){if(audio)audio.pause();};
 window.suspendLumaVoice=function(){clearTimeout(timer);if(audio)audio.pause();if(root)root.hidden=true;window.lumaVoiceOpen=false;};
 window.startLumaVoice=function(data){var wasOpen=!!window.lumaVoiceOpen;
  if(!root){root=el('aside','voice-panel');root.id='voicePanel';var heading=el('div','voice-heading');heading.appendChild(LumaIcons.icon('circle-dot'));heading.appendChild(el('span','','Home Assistant'));var close=el('button','voice-close');close.appendChild(LumaIcons.icon('x'));close.setAttribute('aria-label','Close voice');close.onclick=cancel;heading.appendChild(close);root.appendChild(heading);root.appendChild(el('div','voice-message'));root.appendChild(el('div','voice-transcript'));audio=document.createElement('audio');audio.onplaying=function(){playback('playing');};audio.onerror=function(){playback('error-'+(audio.error&&audio.error.code||0));};audio.onended=function(){playback('ended');timer=setTimeout(dismiss,6000);};root.appendChild(audio);document.body.appendChild(root);}
  if(data.phase!=='reply'&&audio){audio.pause();audio.removeAttribute('src');}clearTimeout(timer);root.hidden=false;window.lumaVoiceOpen=true;root.dataset.phase=data.phase||'connecting';Luma.formatText(root.querySelector('.voice-message'),data.message||'');root.querySelector('.voice-transcript').textContent=data.transcript||'';if(window.lumaLayout)window.lumaLayout();if(!wasOpen||data.phase==='starting')root.querySelector('button').focus();
  if(data.phase==='reply'||data.phase==='error'){timer=setTimeout(dismiss,18000);if(data.audioUrl){if(window.cancelLumaAnnouncement)window.cancelLumaAnnouncement(true);audio.src=data.audioUrl;var p=audio.play();if(p&&p.catch)p.catch(function(){playback('autoplay-blocked');root.querySelector('.voice-transcript').textContent=(data.transcript||'')+' · Press OK to hear the response';});}}
 };
 document.addEventListener('keydown',function(e){if(!window.lumaVoiceOpen||!root.contains(document.activeElement))return;if([13,27,461].indexOf(e.keyCode)>=0)e.stopImmediatePropagation();if(e.keyCode===27||e.keyCode===461){e.preventDefault();cancel();}else if(e.keyCode===13){e.preventDefault();if(audio&&audio.src&&audio.paused){audio.play().catch(function(){});}else cancel();}});
})();
