#!/bin/sh
set -eu
ROOT=/var/lib/webosbrew/lumahome
if [ -f "$ROOT/ambient-watch.pid" ]; then
 watcher=$(cat "$ROOT/ambient-watch.pid")
 case "$watcher" in ''|*[!0-9]*) ;; *)
 if [ -r "/proc/$watcher/cmdline" ] && tr '\000' ' ' < "/proc/$watcher/cmdline" | grep -q '/var/lib/webosbrew/lumahome/ambient-watch.py'; then
  if [ "${1:-start}" = stop ]; then kill "$watcher";fi
  exit 0
 fi ;;
 esac
fi
[ "${1:-start}" != stop ] || exit 0
nohup /usr/bin/python "$ROOT/ambient-watch.py" >/dev/null 2>&1 </dev/null &
echo "$!" > "$ROOT/ambient-watch.pid"
