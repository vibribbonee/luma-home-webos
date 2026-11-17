#!/bin/sh
# First launch/upgrade. Only Luma's own files; no credentials or privacy edits.
set -eu
ROOT=/var/lib/webosbrew/lumahome
APP=/media/developer/apps/usr/palm/applications/com.spinoff.lumahome
umask 077
busy(){ printf '{"success":false,"error":"Luma Home is busy. Open it again to finish updating."}\n'; exit 1; }
install_lock=/tmp/lumahome-runtime-updating
mkdir "$install_lock" 2>/dev/null || busy
trap 'rmdir "$install_lock" 2>/dev/null || true' EXIT
[ ! -d "$ROOT/voice.lock" ] || busy
mkdir -p "$ROOT/vendor"
chmod 700 "$ROOT"
for source in "$APP"/runtime/*; do
 [ -f "$source" ] || continue
 cp "$source" "$ROOT/$(basename "$source")"
done
cp -R "$APP/runtime/vendor/ws" "$ROOT/vendor/"
chmod 700 "$ROOT"/*.sh "$ROOT"/*.py
mkdir -p /var/lib/webosbrew/init.d
cat > /var/lib/webosbrew/init.d/95-lumahome-remote <<'BOOT'
#!/bin/sh
[ ! -f /var/lib/webosbrew/lumahome/voice.enabled ] || /var/lib/webosbrew/lumahome/voice-mic.sh warm
/usr/bin/python /var/lib/webosbrew/lumahome/voice-worker.py warm >/dev/null 2>&1 || true
/var/lib/webosbrew/lumahome/home-hook.sh start
/var/lib/webosbrew/lumahome/ambient-watch.sh start
BOOT
chmod 755 /var/lib/webosbrew/init.d/95-lumahome-remote
[ ! -f "$ROOT/voice.enabled" ] || "$ROOT/voice-mic.sh" warm >/dev/null 2>&1 || true
/usr/bin/python "$ROOT/voice-worker.py" reload >/dev/null 2>&1 || busy
"$ROOT/home-hook.sh" restart >/dev/null 2>&1 || true
"$ROOT/ambient-watch.sh" stop
"$ROOT/ambient-watch.sh" start
printf '{"installed":true,"version":"0.4.27"}\n' > "$ROOT/install.json"
touch "$ROOT/.runtime-0.4.27"
printf '{"success":true,"version":"0.4.27"}\n'
