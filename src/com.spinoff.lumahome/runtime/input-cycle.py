#!/usr/bin/python
"""Cycle the two HDMI inputs without opening LG's source picker."""
from __future__ import print_function
import fcntl,json,os,signal,subprocess
try:
    from urllib.request import HTTPRedirectHandler,Request,build_opener
except ImportError:
    from urllib2 import HTTPRedirectHandler,Request,build_opener

ROOT='/var/lib/webosbrew/lumahome'

def target(app_id):
    return 2 if app_id=='com.webos.app.hdmi1' else 1

def luna(method,body):
    process=subprocess.Popen(['/usr/bin/luna-send','-w','1000','-n','1','-f',
                              'luna://'+method,json.dumps(body)],stdout=subprocess.PIPE)
    raw=process.communicate()[0]
    try:return json.loads(raw)
    except ValueError:return {}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def select_input(port):
    try:
        pairing=json.load(open(ROOT+'/connection.json'))
        address=pairing['last_url']
        try:
            endpoint=json.load(open(ROOT+'/ha-endpoint.json'))
            if endpoint['uuid']==pairing['uuid']:address=endpoint['url']
        except (IOError,ValueError,KeyError):pass
        data=json.dumps({'tv_id':pairing['tv_id'],'input':port}).encode('utf-8')
        request=Request(address+'/api/services/luma_home/select_input',data,
                        {'Authorization':'Bearer '+pairing['token'],'Content-Type':'application/json'})
        response=build_opener(NoRedirect()).open(request,timeout=2)
        try:
            if response.getcode()==200:return
        finally:response.close()
    except Exception:pass
    luna('com.webos.applicationManager/launch',{'id':'com.webos.app.hdmi'+str(port)})

def main():
    with open(ROOT+'/input-cycle.lock','a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except IOError:return
        # Dismiss the popup first so the foreground query sees the underlying source.
        luna('com.webos.surfacemanager/closeByAppId',{'id':'com.spinoff.lumahome.overlay'})
        current=luna('com.webos.applicationManager/getForegroundAppInfo',{}).get('appId','')
        select_input(target(current))

if __name__=='__main__':main()
