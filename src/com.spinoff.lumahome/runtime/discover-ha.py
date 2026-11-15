#!/usr/bin/python
"""Resolve the paired HA through Bonjour without starting the TV's Node runtime.

Only --connection returns credentials, to the existing authorized app bridge.
No credentials are sent to the network during discovery.
"""
from __future__ import print_function
import json, os, re, select, subprocess, sys, time

ROOT = '/var/lib/webosbrew/lumahome'

def normalize(value):
    return str(value or '').replace('-', '').lower()

def ready(args, output):
    if args[0] == '-L':
        return bool(re.search(r'\buuid=[a-f0-9]{32}\b', output, re.I) and
                    re.search(r'can be reached at [^\s:]+:\d+', output))
    if args[0] == '-G':
        return bool(re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', output))
    return bool(re.search(r'Add.*_home-assistant\._tcp', output))

def query(args, timeout=2.2):
    output = ''
    null = open(os.devnull, 'wb')
    child = None
    try:
        child = subprocess.Popen(['/usr/bin/dns-sd'] + args,
                                 stdout=subprocess.PIPE, stderr=null)
        deadline = time.time() + timeout
        complete_at = None
        while time.time() < deadline:
            if complete_at is not None and time.time() >= complete_at:
                break
            readable, _, _ = select.select([child.stdout], [], [], .05)
            if not readable:
                continue
            chunk = os.read(child.stdout.fileno(), 8192)
            if not chunk:
                break
            output += chunk.decode('utf-8', 'replace')
            if complete_at is None and ready(args, output):
                complete_at = time.time() + .05
    except OSError:
        pass
    finally:
        if child is not None:
            if child.poll() is None:
                child.terminate()
            child.wait()
            child.stdout.close()
        null.close()
    return output

def discover(config, browse=False, lookup=None):
    lookup = lookup or query
    expected = normalize(config.get('uuid'))
    if not re.match(r'^[a-f0-9]{32}$', expected):
        raise ValueError('Home Assistant is not paired.')
    names = [config.get('service_name') or 'Home']
    if browse:
        for line in lookup(['-B', '_home-assistant._tcp', 'local']).splitlines():
            match = re.search(r'_home-assistant\._tcp\.?\s+(.+)$', line)
            if match and match.group(1).strip() not in names:
                names.append(match.group(1).strip())
    for name in names:
        info = lookup(['-L', name, '_home-assistant._tcp', 'local'])
        uuid = re.search(r'\buuid=([a-f0-9]{32})\b', info, re.I)
        endpoint = re.search(r'can be reached at ([^\s:]+):(\d+)', info)
        if not uuid or normalize(uuid.group(1)) != expected or not endpoint:
            continue
        port = int(endpoint.group(2))
        if not 0 < port < 65536:
            continue
        addresses = lookup(['-G', 'v4', endpoint.group(1)])
        for ip in re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', addresses):
            octets = [int(part) for part in ip.split('.')]
            if any(part > 255 for part in octets) or octets[0] in (0, 127) or octets[0] >= 224:
                continue
            result = {'url': 'http://%s:%s' % (ip, port),
                      'uuid': expected, 'service_name': name}
            if config.get('tv_id'):
                result['tv_id'] = config['tv_id']
            return result
    raise ValueError('The paired Home Assistant was not found through Bonjour. Check multicast or the saved service name.')

def main():
    try:
        with open(ROOT + '/connection.json') as source:
            config = json.load(source)
        result = discover(config, '--browse' in sys.argv)
        if '--connection' in sys.argv:
            if not config.get('token'):
                raise ValueError('Home Assistant is not paired.')
            result['token'] = config['token']
        print(json.dumps(result))
        return 0
    except (IOError, ValueError):
        # Do not include exception contents: configuration data stays private.
        print(json.dumps({'error': 'The paired Home Assistant could not be resolved. Check pairing and Bonjour.'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
