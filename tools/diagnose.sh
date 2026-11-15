#!/bin/sh
# Run ON THE TV (see tools/deploy.sh). Prints state for debugging; never prints the HA token or any audio/transcripts.
ROOT=/var/lib/webosbrew/lumahome
STUB=/var/lib/webosbrew/lifesgoodwithoutspying.stub
APP=/media/developer/apps/usr/palm/applications/com.spinoff.lumahome
echo "== time: $(date)"
echo "== installed Luma apps"
for id in com.spinoff.lumahome com.spinoff.lumahome.overlay; do
 node -e 'var fs=require("fs"),p="/media/developer/apps/usr/palm/applications/"+process.argv[1]+"/appinfo.json",a=JSON.parse(fs.readFileSync(p,"utf8"));console.log(a.id+" "+a.version);' "$id"
done
echo "== Home hook: $("$ROOT/home-hook.sh" status 2>&1)"
echo "-- last hook log lines"; tail -n 40 "$ROOT/home-hook.log" 2>/dev/null
echo "== Voice: $("$ROOT/voice-control.sh" status 2>&1)"
echo "-- voice-status.json"; cat "$ROOT/voice-status.json" 2>/dev/null; echo
echo "-- voice worker: $(/usr/bin/python "$ROOT/voice-worker.py" status 2>/dev/null)"
echo "-- last voice session log"; tail -n 40 "$ROOT/voice-worker.log" 2>/dev/null
echo "== Microphone privacy stub (same inode = still blocked)"
for t in /usr/sbin/voiceinput /usr/sbin/voiceconductor; do
 if [ -e "$STUB" ] && [ -e "$t" ]; then
  [ "$(stat -c '%d:%i' "$t")" = "$(stat -c '%d:%i' "$STUB")" ] && echo "$t: blocked by stub" || echo "$t: REAL binary"
 else echo "$t: missing or no stub"; fi
done
echo "voiceinput.service: $(systemctl is-active voiceinput.service 2>&1)"
echo "== Magic Remote input devices"
grep -A7 'LGE' /proc/bus/input/devices
echo "== Home Assistant (token not shown)"
node "$APP/discover-ha.js" --fast 2>&1
echo "== Node/Python"; node --version; /usr/bin/python --version 2>&1
