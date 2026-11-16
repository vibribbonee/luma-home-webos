#!/usr/bin/python
"""Warm a local voice process; start opens HA only for an explicit mic request."""
from __future__ import print_function
import errno, json, os, signal, socket, subprocess, sys, time

ROOT='/var/lib/webosbrew/lumahome'
NODE='/usr/bin/node'

def script():
    return ROOT+'/voice-assist.js'

def worker_pid():
    try:
        pid=int(open(ROOT+'/voice-worker.pid').read())
        args=open('/proc/%d/cmdline'%pid,'rb').read().split(b'\0')
        if script().encode('utf-8') in args and b'--standby' in args:
            return pid
    except (IOError, ValueError):
        pass
    return None

def unlink(path):
    try:os.unlink(path)
    except OSError:pass

def ping():
    client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    try:
        client.settimeout(.3);client.connect(ROOT+'/voice-worker.sock');client.sendall(b'ping\n')
        return client.recv(64)==b'ready\n'
    except socket.error:return False
    finally:client.close()

def warm():
    if not os.path.exists(ROOT+'/voice.enabled'):return False
    if worker_pid():return True
    lock=ROOT+'/voice-worker.starting'
    try:os.mkdir(lock,448)
    except OSError as error:
        if error.errno!=errno.EEXIST:raise
        if time.time()-os.stat(lock).st_mtime<10:return True
        try:os.rmdir(lock)
        except OSError:return False
        return warm()
    try:
        # Recheck after the lock. Only this helper launches standby processes.
        if worker_pid():return True
        unlink(ROOT+'/voice-worker.sock')
        with open(ROOT+'/voice-worker.log','ab') as output:
            child=subprocess.Popen([NODE,script(),'--standby'],stdin=open(os.devnull,'rb'),stdout=output,stderr=subprocess.STDOUT,close_fds=True)
        with open(ROOT+'/voice-worker.pid','w') as output:output.write(str(child.pid))
        os.chmod(ROOT+'/voice-worker.pid',384)
        return True
    finally:
        try:os.rmdir(lock)
        except OSError:pass

def start():
    if not os.path.exists(ROOT+'/voice.enabled'):return False
    warm();deadline=time.time()+7
    client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    while True:
        try:client.connect(ROOT+'/voice-worker.sock');break
        except socket.error:
            if time.time()>=deadline:client.close();return False
            time.sleep(.05)
    try:
        client.settimeout(65);client.sendall(b'start\n');reply=b''
        while True:
            chunk=client.recv(1024)
            if not chunk:break
            reply+=chunk
            if len(reply)>4096:return False
        for line in reply.splitlines():
            if line.startswith(b'{'):
                value=json.loads(line.decode('ascii'))
                if value.get('done'):return value.get('success') is True
        return False
    except (socket.error, ValueError):return False
    finally:client.close()

def stop():
    pid=worker_pid()
    if pid:
        try:os.kill(pid,signal.SIGTERM)
        except OSError:pass

def reload_worker():
    """Refresh the warm process after an IPK replaces its source on disk."""
    if os.path.isdir(ROOT+'/voice.lock'):
        return False
    stop()
    deadline=time.time()+2
    while worker_pid():
        if time.time()>=deadline:return False
        time.sleep(.05)
    return not os.path.exists(ROOT+'/voice.enabled') or warm()

def main():
    os.umask(63)
    command=sys.argv[1] if len(sys.argv)>1 else 'status'
    if command=='warm':return 0 if warm() else 1
    if command=='start':return 0 if start() else 1
    if command=='stop':stop();return 0
    if command=='reload':return 0 if reload_worker() else 1
    if command=='status':print('ready' if ping() else 'busy' if worker_pid() else 'stopped');return 0
    return 2

if __name__=='__main__':sys.exit(main())
