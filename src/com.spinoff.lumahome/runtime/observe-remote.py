#!/usr/bin/python
"""Short, read-only remote capture. Never grabs devices or changes key policies."""
from __future__ import print_function
import argparse
import errno
import glob
import json
import os
import select
import struct
import sys
import time

FMT = 'llHHi'
SIZE = struct.calcsize(FMT)


def device_names(path='/proc/bus/input/devices'):
    names = {}
    try:
        with open(path) as source:
            blocks = source.read().split('\n\n')
    except IOError:
        return names
    for block in blocks:
        name = 'Unknown input device'
        for line in block.splitlines():
            if line.startswith('N: Name='):
                name = line.split('=', 1)[1].strip('"')
        for line in block.splitlines():
            if line.startswith('H: Handlers='):
                for handler in line.split('=', 1)[1].split():
                    if handler.startswith('event') and handler[5:].isdigit():
                        names['/dev/input/' + handler] = name
    return names


def decode(data):
    """Retain incomplete records; Linux event layouts follow the host ABI."""
    length = len(data) - len(data) % SIZE
    return [struct.unpack(FMT, data[offset:offset + SIZE])
            for offset in range(0, length, SIZE)], data[length:]


def emit(value):
    print(json.dumps(value))
    sys.stdout.flush()


def capture(seconds=20):
    descriptors, buffers = {}, {}
    names = device_names()
    try:
        for path in sorted(glob.glob('/dev/input/event*')):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                continue
            descriptors[fd], buffers[fd] = path, b''
        emit({'type': 'capture', 'seconds': seconds, 'devices': [
            {'path': path, 'name': names.get(path, 'Unknown input device')}
            for path in descriptors.values()]})
        deadline = time.time() + seconds
        while descriptors and time.time() < deadline:
            ready, _, _ = select.select(list(descriptors), [], [], .2)
            for fd in ready:
                try:
                    data = os.read(fd, SIZE * 32)
                except OSError as error:
                    if error.errno in (errno.EAGAIN, errno.EINTR):
                        continue
                    data = b''
                if not data:
                    os.close(fd)
                    del descriptors[fd]
                    del buffers[fd]
                    continue
                events, buffers[fd] = decode(buffers[fd] + data)
                for sec, usec, kind, code, value in events:
                    if kind == 1:
                        path = descriptors[fd]
                        emit({'type': 'key', 'device': path, 'name': names.get(path, 'Unknown input device'),
                              'key': code, 'value': value, 'time': sec + usec / 1000000.0})
    finally:
        for fd in descriptors:
            os.close(fd)
    emit({'type': 'complete'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 60:
        parser.error('Capture duration must be between 1 and 60 seconds.')
    capture(args.seconds)
