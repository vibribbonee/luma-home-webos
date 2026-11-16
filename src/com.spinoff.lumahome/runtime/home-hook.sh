#!/bin/sh
set -eu
ROOT=/var/lib/webosbrew/lumahome
running(){
 [ -f "$ROOT/home-hook.pid" ] || return 1
 hook_pid=$(cat "$ROOT/home-hook.pid")
 case "$hook_pid" in ''|*[!0-9]*) return 1 ;; esac
 [ -r "/proc/$hook_pid/cmdline" ] && tr '\000' ' ' < "/proc/$hook_pid/cmdline" | grep -q '/var/lib/webosbrew/lumahome/home-hook.py'
}
stop_process(){
 if running; then
  kill "$hook_pid" 2>/dev/null || true
  count=0
  while running && [ "$count" -lt 2 ]; do sleep 1; count=$((count+1)); done
 fi
}
case "${1:-start}" in
 status) if [ -f "$ROOT/home-hook.enabled" ] && running; then echo enabled; else echo disabled; fi ;;
 stop)
  rm -f "$ROOT/home-hook.enabled"
  "$ROOT/home-native.sh" disable
  if [ -f "$ROOT/voice.enabled" ]; then "$0" start; else stop_process; fi
  ;;
 enable) touch "$ROOT/home-hook.enabled"; "$0" start ;;
 restart)
  stop_process
  "$0" start
  ;;
 start)
  if [ ! -f "$ROOT/home-hook.enabled" ] && [ ! -f "$ROOT/voice.enabled" ]; then exit 0; fi
  if running; then exit 0; fi
  nohup /usr/bin/python "$ROOT/home-hook.py" > "$ROOT/home-hook.log" 2>&1 </dev/null &
  echo "$!" > "$ROOT/home-hook.pid"
  ;;
 stock) "$ROOT/home-native.sh" stock ;;
 *) echo 'Usage: home-hook.sh start|enable|stop|restart|stock|status' >&2; exit 2 ;;
esac
