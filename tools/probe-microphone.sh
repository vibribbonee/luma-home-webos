#!/bin/sh
# Temporary metadata-only test. Never accepts EULAs or starts LG's assistant.
set -eu
ROOT=/var/lib/webosbrew/lumahome
STUB=/var/lib/webosbrew/lifesgoodwithoutspying.stub
RESTORED=""
STARTED=0
cleanup(){
 if [ "$STARTED" = 1 ]; then systemctl --no-block stop voiceinput.service >/dev/null 2>&1 || true; for mic_pid in $(pidof voiceinput 2>/dev/null || true); do kill "$mic_pid" 2>/dev/null || true; done; fi
 for target in $RESTORED; do
  # Reapply only the exact microphone mounts this probe unwound.
  if [ "$(stat -c '%d:%i' "$target")" != "$(stat -c '%d:%i' "$STUB")" ]; then mount --bind "$STUB" "$target"; fi
 done
 echo 'Microphone privacy blocks restored.'
}
trap cleanup EXIT INT TERM
test -f "$STUB"
for target in /usr/sbin/voiceinput /var/palm/jail/com.webos.service.voice.performer/usr/sbin/voiceinput; do
 [ -f "$target" ] || continue
 if [ "$(stat -c '%d:%i' "$target")" = "$(stat -c '%d:%i' "$STUB")" ]; then
  umount "$target"
  RESTORED="$RESTORED $target"
 fi
done
test -n "$RESTORED" || { echo 'Expected privacy stub was not found; stopping without changing service state.'; exit 1; }
# This is the raw microphone driver only. voiceconductor remains stubbed.
echo "Original driver size: $(stat -c '%s' /usr/sbin/voiceinput) bytes"
STARTED=1
systemctl --no-block start voiceinput.service
node -e 'var p=require("child_process").spawn("/usr/bin/luna-send",["-n","1","-f","luna://com.webos.service.voiceinput/getDevices","{}"]),out="";p.stdout.on("data",function(b){out+=b.toString();});var timer=setTimeout(function(){p.kill();console.log("Raw-driver query timed out; no audio was captured.");},7000);p.on("close",function(){clearTimeout(timer);if(out)console.log(out);});'
