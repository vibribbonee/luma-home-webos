#!/bin/sh
# Keep only the raw PCM driver ready; its executable is re-blocked after start.
# startStreaming is called solely during an explicit HA mic-button session.
set -eu
ROOT=/var/lib/webosbrew/lumahome
STUB=/var/lib/webosbrew/lifesgoodwithoutspying.stub
restore_assistant_block(){
 for target in /usr/sbin/voiceconductor /var/palm/jail/com.webos.service.voice.performer/usr/sbin/voiceconductor; do
  [ -f "$target" ] || continue
  grep -Fxq "voice.stop $target" /var/lib/webosbrew/lifesgoodwithoutspying.stubbed || continue
  if [ "$(stat -c '%d:%i' "$target")" != "$(stat -c '%d:%i' "$STUB")" ]; then
   mount --bind "$STUB" "$target"
  fi
 done
 test "$(stat -c '%d:%i' /usr/sbin/voiceconductor)" = "$(stat -c '%d:%i' "$STUB")"
 for assistant_pid in $(pidof voiceconductor 2>/dev/null || true); do
  case "$(readlink "/proc/$assistant_pid/exe" 2>/dev/null || true)" in
   /usr/sbin/voiceconductor|/var/palm/jail/com.webos.service.voice.performer/usr/sbin/voiceconductor)
    kill "$assistant_pid" 2>/dev/null || true ;;
  esac
 done
}
block(){
 [ -f "$ROOT/voice-restore" ] || return 0
 while read -r target; do
  case "$target" in /usr/sbin/voiceinput|/var/palm/jail/com.webos.service.voice.performer/usr/sbin/voiceinput)
   if [ "$(stat -c '%d:%i' "$target")" != "$(stat -c '%d:%i' "$STUB")" ]; then mount --bind "$STUB" "$target"; fi ;;
  esac
 done < "$ROOT/voice-restore"
}
case "${1:-warm}" in
 block) block ;;
 disable)
  systemctl --no-block stop voiceinput.service >/dev/null 2>&1 || true
  for mic_pid in $(pidof voiceinput 2>/dev/null || true); do kill "$mic_pid" 2>/dev/null || true; done
  block;rm -f "$ROOT/mic-ready"
  ;;
 warm)
  [ -f "$ROOT/voice.enabled" ] || exit 0
  restore_assistant_block
  if pidof voiceinput >/dev/null 2>&1; then block;touch "$ROOT/mic-ready";exit 0;fi
  : > "$ROOT/voice-restore"
  trap block EXIT INT TERM
  for target in /usr/sbin/voiceinput /var/palm/jail/com.webos.service.voice.performer/usr/sbin/voiceinput; do
   [ -f "$target" ] || continue
   if [ "$(stat -c '%d:%i' "$target")" = "$(stat -c '%d:%i' "$STUB")" ]; then echo "$target" >> "$ROOT/voice-restore";umount "$target";fi
  done
  systemctl --no-block start voiceinput.service
  /usr/bin/python -c 'import os,time
for n in range(50):
 if os.system("pidof voiceinput >/dev/null 2>&1")==0:break
 time.sleep(.04)'
  block
  pidof voiceinput >/dev/null
  touch "$ROOT/mic-ready"
  ;;
 *) exit 2 ;;
esac
