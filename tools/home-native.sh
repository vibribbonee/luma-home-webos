#!/bin/sh
# Home-only native key filter. The original input devices are never grabbed.
set -eu
ROOT=/var/lib/webosbrew/lumahome
TARGET=/usr/bin/com.webos.app.home
WRAPPER=$ROOT/home-launch.sh
restore_legacy(){
 if [ -f "$WRAPPER" ] && [ -f "$TARGET" ] && [ "$(stat -c '%d:%i' "$TARGET")" = "$(stat -c '%d:%i' "$WRAPPER")" ]; then umount "$TARGET";fi
 rm -f "$ROOT/home-bypass"
}
case "${1:-status}" in
 enable) /usr/bin/python "$ROOT/home-keyfilter.py" enable >/dev/null;restore_legacy ;;
 disable) /usr/bin/python "$ROOT/home-keyfilter.py" disable >/dev/null 2>&1 || true;restore_legacy ;;
 status) /usr/bin/python "$ROOT/home-keyfilter.py" status ;;
 stock) /usr/bin/luna-send -w 1500 -n 1 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' ;;
 *) exit 2 ;;
esac
