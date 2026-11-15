#!/usr/bin/python
"""RAM-only media fetch for webOS app origins that cannot use HA's CORS path.

Stdout is consumed only by the app bridge; never invoke this in diagnostics.
No HA bearer token is read or sent, and audio is not written to disk.
"""
from __future__ import print_function
import base64,json,sys
try:
    from urllib2 import urlopen
    from urlparse import urlsplit
except ImportError:
    from urllib.request import urlopen
    from urllib.parse import urlsplit

def main():
    try:
        data=json.loads(base64.b64decode(sys.argv[1]))
        url=data['url'];parsed=urlsplit(url)
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password:raise ValueError('Invalid media URL')
        response=urlopen(url,timeout=15)
        try:audio=response.read(2*1024*1024+1)
        finally:response.close()
        if not audio or len(audio)>2*1024*1024:raise ValueError('Invalid audio size')
        print(json.dumps({'audio':base64.b64encode(audio).decode('ascii')}))
    except Exception:
        print('{"error":"Could not fetch announcement audio."}')
        return 1
    return 0

if __name__=='__main__':sys.exit(main())
