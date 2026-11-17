#!/usr/bin/python
"""Return installed app metadata or small PNG app icons from the authorized TV bridge."""
from __future__ import print_function
import base64
import json
import os
import struct
import subprocess
import sys

MAX_ICON_BYTES = 40000
MAX_ARTWORK_BYTES = 700000
APP_ROOTS = ('/usr/palm/applications/', '/media/developer/apps/usr/palm/applications/',
             '/media/cryptofs/apps/usr/palm/applications/', '/mnt/lg/cmn_data/wam/apps/')


def png_icon(item):
    folder = item.get('folderPath')
    filename = item.get('icon') or item.get('largeIcon')
    if not folder or not filename:
        return None
    folder = os.path.realpath(folder).rstrip('/') + '/'
    filename = os.path.realpath(os.path.join(folder, filename))
    if not folder.startswith(APP_ROOTS) or not filename.startswith(folder):
        return None
    if not filename.lower().endswith('.png') or not os.path.isfile(filename):
        return None
    try:
        with open(filename, 'rb') as source:
            png = source.read(MAX_ICON_BYTES + 1)
    except IOError:
        return None
    if len(png) < 24 or len(png) > MAX_ICON_BYTES or png[:16] != b'\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR':
        return None
    width, height = struct.unpack('>II', png[16:24])
    if not 0 < width <= 512 or not 0 < height <= 512:
        return None
    return 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')


def main():
    child = subprocess.Popen(['/usr/bin/luna-send', '-w', '2000', '-n', '1', '-f',
                              'luna://com.webos.applicationManager/listApps', '{}'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw = child.stdout.read()
    child.wait()
    child.stdin.close()
    artwork = '--artwork' in sys.argv
    result = {} if artwork else []
    total = 0
    try:
        response = json.loads(raw)
    except ValueError:
        response = None
    if not isinstance(response, dict) or response.get('returnValue') is False or not isinstance(response.get('apps'), list):
        print(json.dumps({'error': 'Could not read installed LG apps.'}))
        return
    for item in response['apps']:
        if not item.get('id') or item.get('visible') is False:
            continue
        if artwork:
            data = png_icon(item)
            if data and total + len(data) <= MAX_ARTWORK_BYTES:
                result[item['id']] = data
                total += len(data)
        else:
            icon = item.get('icon', '')
            if icon and not icon.startswith('/') and item.get('folderPath'):
                icon = item['folderPath'] + '/' + icon
            result.append({'id': item['id'], 'title': item.get('title', item['id']), 'icon': icon,
                           'visible': True, 'system': bool(item.get('systemApp'))})
    print(json.dumps(result))


if __name__ == '__main__':
    main()
