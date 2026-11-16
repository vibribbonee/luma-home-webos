(function () {
 'use strict';
 var root, timer, audio, forwarded = false, revision = 0;

 function playback(state) {
  window.lumaVoiceAudio = state;
  Luma.exec("printf '%s' '" + state + "' > /var/lib/webosbrew/lumahome/audio-state").catch(function () {});
 }

 function dismiss() {
  revision++;
  clearTimeout(timer);
  if (audio) {
   audio.pause();
   audio.removeAttribute('src');
  }
  if (root) root.hidden = true;
  window.lumaVoiceOpen = false;
  if (window.lumaLayout) window.lumaLayout();
  LumaNav.resume();
  Luma.hide();
 }

 function cancel() {
  if (!forwarded) Luma.exec('/var/lib/webosbrew/lumahome/voice-control.sh cancel').catch(function () {});
  dismiss();
 }

 function el(tag, cls, text) {
  var node = document.createElement(tag);
  node.className = cls || '';
  if (text !== undefined) node.textContent = text;
  return node;
 }

 function resetTimer(delay) {
  clearTimeout(timer);
  timer = setTimeout(dismiss, delay);
 }

 function buildPanel() {
  root = el('aside', 'voice-panel');
  root.id = 'voicePanel';
  var heading = el('div', 'voice-heading');
  heading.appendChild(el('span', '', 'Home Assistant'));
  var close = el('button', 'overlay-close', '×');
  close.setAttribute('aria-label', 'Close voice');
  close.onclick = cancel;
  heading.appendChild(close);
  root.appendChild(heading);
  root.appendChild(el('div', 'voice-message'));
  root.appendChild(el('div', 'voice-transcript'));
  audio = document.createElement('audio');
  audio.onplaying = function () { playback('playing'); };
  audio.onerror = function () {
   playback('error-' + (audio.error && audio.error.code || 0));
   resetTimer(6000);
  };
  audio.onended = function () {
   playback('ended');
   resetTimer(6000);
  };
  root.appendChild(audio);
  document.body.appendChild(root);
 }

 function playReply(data, url) {
  if (window.cancelLumaAnnouncement) window.cancelLumaAnnouncement(true);
  audio.src = url;
  var play = audio.play();
  if (play && play.catch) play.catch(function () {
   playback('autoplay-blocked');
   root.querySelector('.voice-transcript').textContent =
    (data.transcript ? data.transcript + ' · ' : '') + 'Press OK to hear the response';
   resetTimer(18000);
  });
 }

 window.pauseLumaVoiceAudio = function () { if (audio) audio.pause(); };
 window.suspendLumaVoice = function () {
  revision++;
  clearTimeout(timer);
  if (audio) audio.pause();
  if (root) root.hidden = true;
  window.lumaVoiceOpen = false;
 };

 window.startLumaVoice = function (data) {
  var wasOpen = !!window.lumaVoiceOpen;
  var starting = data.phase === 'starting';
  if (data.forwarded && !starting && (!wasOpen || !forwarded)) return false;
  var render = ++revision;
  forwarded = !!data.forwarded;
  if (!root) buildPanel();
  if (data.phase !== 'reply') {
   audio.pause();
   audio.removeAttribute('src');
  }
  root.hidden = false;
  window.lumaVoiceOpen = true;
  root.dataset.phase = data.phase || 'connecting';
  Luma.formatText(root.querySelector('.voice-message'), data.message || '');
  root.querySelector('.voice-transcript').textContent = data.transcript || '';
  if (window.lumaLayout) window.lumaLayout();
  if (!wasOpen || starting) root.querySelector('button').focus();

  if (data.phase === 'reply' && data.audioUrl) {
   resetTimer(60000);
   playReply(data, data.audioUrl);
  } else if (data.phase === 'reply' && /^\/api\/tts_proxy\//.test(data.audioPath || '')) {
   resetTimer(60000);
   Luma.connectionAddress().then(function (address) {
    if (revision === render) playReply(data, address + data.audioPath);
   }).catch(function () {
    if (revision === render) resetTimer(6000);
   });
  } else {
   resetTimer(data.phase === 'reply' || data.phase === 'error' ? 6000 : 60000);
  }
  return true;
 };

 document.addEventListener('keydown', function (event) {
  if (!window.lumaVoiceOpen || !root.contains(document.activeElement)) return;
  if ([13, 27, 461].indexOf(event.keyCode) < 0) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  if (event.keyCode === 13 && audio.src && audio.paused) audio.play().catch(function () {});
  else cancel();
 });
})();
