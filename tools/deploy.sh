#!/bin/sh
# Run on your Mac from the luma-home folder:  tools/deploy.sh <tv-host>
# Builds the IPKs, installs them, updates the helper scripts on the TV, restarts the Home hook if it was on.
# Uses plain ssh (your ~/.ssh config / existing ControlMaster apply). Set SSH_OPTS to add options.
set -eu
TV=${1:-${LUMA_TV_HOST:-}}
: "${TV:?Pass the TV host as the first argument or set LUMA_TV_HOST}"
ROOT=/var/lib/webosbrew/lumahome
cd "$(dirname "$0")/.."
SSH="ssh ${SSH_OPTS:-} root@$TV"
python3 build.py
$SSH "if [ -d $ROOT/voice.lock ]; then echo 'Finish the active voice request before deploying.' >&2; exit 1; fi; if [ -f $ROOT/voice-worker.py ]; then /usr/bin/python $ROOT/voice-worker.py stop; fi"
put() { $SSH "cat > '$2'" < "$1"; }
VERSION=$(python3 -c "import json;print(json.load(open('src/com.spinoff.lumahome/appinfo.json'))['version'])")
for id in com.spinoff.lumahome com.spinoff.lumahome.overlay; do put "dist/${id}_${VERSION}_all.ipk" "/tmp/${id}_${VERSION}_all.ipk"; done
put tools/install-ipk.js /tmp/luma-install-ipk.js
for id in com.spinoff.lumahome com.spinoff.lumahome.overlay; do $SSH "node /tmp/luma-install-ipk.js $id $VERSION"; done
$SSH "mkdir -p $ROOT/vendor"
for f in list-apps.py input-handoff.py home-native.sh home-keyfilter.py home-keyfilter.js home-launch.sh home-hook.py home-hook.sh voice-control.sh voice-mic.sh voice-session.sh voice-assist.js voice-standby.js voice-worker.py voice-capture.py assist-client.js diagnose.sh; do put "tools/$f" "$ROOT/$f"; done
COPYFILE_DISABLE=1 tar --format=ustar -C vendor -cf - ws | $SSH "tar -C $ROOT/vendor -xf -"
$SSH "chmod 755 $ROOT/home-native.sh $ROOT/home-launch.sh $ROOT/home-hook.py $ROOT/home-hook.sh $ROOT/voice-control.sh $ROOT/voice-session.sh $ROOT/diagnose.sh"
$SSH "$ROOT/home-hook.sh restart"
$SSH "/usr/bin/python $ROOT/voice-worker.py warm >/dev/null 2>&1 || true"
echo "Done. To collect diagnostics: ssh root@$TV $ROOT/diagnose.sh"
