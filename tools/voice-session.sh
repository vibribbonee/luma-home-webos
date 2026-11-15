#!/bin/sh
# HA-only PCM session; assistant blocks and privacy settings stay in place.
set -eu
ROOT=/var/lib/webosbrew/lumahome
if [ "${1:-}" = restore ]; then "$ROOT/voice-mic.sh" block;exit;fi
mkdir "$ROOT/voice.lock" 2>/dev/null || exit 0
child='';capture=''
cleanup(){
 trap - EXIT INT TERM
 [ -z "$child" ] || kill "$child" 2>/dev/null || true
 [ -z "$capture" ] || kill "$capture" 2>/dev/null || true
 "$ROOT/voice-control.sh" cancel
 "$ROOT/voice-mic.sh" block
 rm -f "$ROOT/voice-held" "$ROOT/voice.pid"
 rmdir "$ROOT/voice.lock" 2>/dev/null || true
 /usr/bin/python "$ROOT/voice-worker.py" warm >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
umask 077
"$ROOT/voice-mic.sh" warm
: > "$ROOT/capture.log"
/usr/bin/python "$ROOT/voice-capture.py" >> "$ROOT/capture.log" 2>&1 &
capture=$!
/usr/bin/python "$ROOT/voice-worker.py" start >> "$ROOT/voice-worker.log" 2>&1 &
child=$!
wait "$child"
