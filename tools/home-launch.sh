#!/bin/sh
ROOT=/var/lib/webosbrew/lumahome
if [ -f "$ROOT/home-bypass" ]; then
 rm -f "$ROOT/home-bypass"
 exec "$ROOT/stock-home" "$@"
fi
# The passive remote observer handles Home tap/hold, without grabbing input.
exit 0
