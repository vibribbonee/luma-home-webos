#!/bin/sh
# Invoked only after the user chooses Uninstall and confirms on the TV.
set -eu
ROOT=/var/lib/webosbrew/lumahome
[ "$ROOT" = /var/lib/webosbrew/lumahome ]
"$ROOT/ambient-watch.sh" stop
"$ROOT/voice-control.sh" disable
"$ROOT/home-hook.sh" stop
"$ROOT/home-native.sh" disable
"$ROOT/voice-session.sh" restore
rm -f /var/lib/webosbrew/init.d/95-lumahome-remote
# Remove overlay first. stdin stays open so luna-send receives the reply.
/usr/bin/luna-send -w 5000 -n 1 luna://com.webos.appInstallService/remove '{"id":"com.spinoff.lumahome.overlay","subscribe":false}' >/dev/null 2>&1 || true
rm -rf "$ROOT"
/usr/bin/luna-send -w 5000 -n 1 luna://com.webos.appInstallService/remove '{"id":"com.spinoff.lumahome","subscribe":false}' >/dev/null 2>&1 || true
