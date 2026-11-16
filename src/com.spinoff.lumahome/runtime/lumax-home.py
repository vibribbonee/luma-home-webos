#!/usr/bin/python
"""Ask the paired HA instance to route Home, then fall back to the TV."""
from __future__ import print_function

import json
import signal
import subprocess
import sys
try:
    from urllib.request import HTTPRedirectHandler, Request, build_opener
except ImportError:
    from urllib2 import HTTPRedirectHandler, Request, build_opener

ROOT = '/var/lib/webosbrew/lumahome'
APP = 'com.spinoff.lumahome'


def timed_out(_signal, _frame):
    raise IOError('LumaX route timed out')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def home_assistant(view):
    with open(ROOT + '/connection.json') as source:
        pairing = json.load(source)
    url = pairing['last_url']
    if url.startswith('http://'):
        try:
            with open(ROOT + '/ha-endpoint.json') as source:
                endpoint = json.load(source)
            if endpoint['uuid'] == pairing['uuid']:
                url = endpoint['url']
        except (IOError, ValueError, KeyError):
            pass
    # Prevent following service redirects with the TV's access token.
    request = Request(url + '/api/services/luma_home/open',
                      json.dumps({'tv_id': pairing['tv_id'], 'view': view}).encode('utf-8'),
                      {'Authorization': 'Bearer ' + pairing['token'], 'Content-Type': 'application/json'})
    if not pairing['tv_id']:
        raise ValueError('The TV has no paired identity')
    # Quick Menu routing can wait for a just-requested HDMI switch to settle.
    timeout = 3.2 if view == 'quick' else 1.2
    response = build_opener(NoRedirect()).open(request, timeout=timeout)
    try:
        return response.getcode() == 200
    finally:
        response.close()


def local(view):
    overlay = view == 'quick'
    payload = {'id': APP + '.overlay' if overlay else APP, 'keepAlive': True,
               'params': {'quick': True, 'toggle': False} if overlay else {'luma': 'home'}}
    subprocess.call(['/usr/bin/luna-send', '-n', '1', '-f',
                     'luna://com.webos.applicationManager/launch', json.dumps(payload)])


if __name__ == '__main__':
    view = sys.argv[1]
    if view not in ('home', 'quick'):
        sys.exit(1)
    signal.signal(signal.SIGALRM, timed_out)
    signal.alarm(4 if view == 'quick' else 2)
    try:
        routed = home_assistant(view)
    except Exception:
        routed = False
    finally:
        signal.alarm(0)
    if not routed:
        local(view)
