#!/bin/sh
set -eu
ROOT=/var/lib/webosbrew/lumahome
case "${1:-status}" in
 start|start-observed)
  [ -f "$ROOT/voice.enabled" ] || exit 0
  [ ! -d "$ROOT/voice.lock" ] || exit 0
  [ "${1:-}" = start-observed ] || touch "$ROOT/voice-held"
  nohup "$ROOT/voice-session.sh" >/dev/null 2>&1 </dev/null &
  ;;
 release) rm -f "$ROOT/voice-held" ;;
 cancel)
  rm -f "$ROOT/voice-held"
  if [ -f "$ROOT/voice.pid" ]; then
   voice_pid=$(cat "$ROOT/voice.pid")
   case "$voice_pid" in ''|*[!0-9]*) ;; *)
    if [ -r "/proc/$voice_pid/cmdline" ] && tr '\000' ' ' < "/proc/$voice_pid/cmdline" | grep -q '/var/lib/webosbrew/lumahome/voice-assist.js'; then kill "$voice_pid" 2>/dev/null || true; fi ;;
   esac
  fi
  ;;
 status) if [ -f "$ROOT/voice.enabled" ]; then echo enabled; else echo disabled; fi ;;
 enable) touch "$ROOT/voice.enabled"; "$ROOT/voice-mic.sh" warm; /usr/bin/python "$ROOT/voice-worker.py" warm; "$ROOT/home-hook.sh" start ;;
 disable) rm -f "$ROOT/voice.enabled"; "$0" cancel; /usr/bin/python "$ROOT/voice-worker.py" stop; "$ROOT/voice-mic.sh" disable ;;
 *) exit 2 ;;
esac
