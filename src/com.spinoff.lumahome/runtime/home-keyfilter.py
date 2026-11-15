#!/usr/bin/python
"""Own one native Home-only filter; preserve every other configd filter."""
from __future__ import print_function
import json,os,signal,subprocess,sys,time
ROOT='/var/lib/webosbrew/lumahome'
KEY='com.webos.surfacemanager.keyFilters';LEASE='com.webos.surfacemanager.lumaHomeLease'
FILE=ROOT+'/home-keyfilter.js';OWN_FILES=(FILE,ROOT+'/home-keyfilter-trial.js');ITEM={'file':FILE,'handler':'handleLumaHome'}
def luna(method,body):
    p=subprocess.Popen(['/usr/bin/luna-send','-w','1200','-n','1','-f','luna://com.webos.service.config/'+method,json.dumps(body)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    raw=p.stdout.read();p.wait();p.stdin.close()
    try:return json.loads(raw)
    except ValueError:return {}
def current():
    result=luna('getConfigs',{'configNames':[KEY]});items=result.get('configs',{}).get(KEY)
    if not result.get('returnValue') or not isinstance(items,list) or not items:raise RuntimeError('Native Home filter is unsupported on this firmware')
    return items
def enabled():return any(x.get('file')==FILE for x in current())
def heartbeat():
    if not luna('setConfigs',{'configs':{LEASE:int(time.time()*1000)}}).get('returnValue'):raise RuntimeError('Home lease was rejected')
def set_enabled(on):
    items=current();rest=[x for x in items if x.get('file') not in OWN_FILES]
    if on and any(x.get('file')==FILE for x in items) and not any(x.get('file')==OWN_FILES[1] for x in items):heartbeat();return
    if on:
        if not os.path.isfile(FILE):raise RuntimeError('Home filter is missing')
        if not os.path.exists(ROOT+'/key-filter-original.json'):
            with open(ROOT+'/key-filter-original.json','w') as f:json.dump(items,f)
            os.chmod(ROOT+'/key-filter-original.json',384)
        heartbeat();rest.insert(0,ITEM)
    result=luna('setConfigs',{'configs':{KEY:rest,LEASE:int(time.time()*1000) if on else 0}})
    if not result.get('returnValue'):raise RuntimeError('Native key filter update was rejected')
def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'status'
    if action=='status':print('filtered' if enabled() else 'stock')
    elif action=='enable':set_enabled(True);print('filtered')
    elif action=='disable':set_enabled(False);print('stock')
    elif action=='lease':heartbeat()
    elif action=='trial':
        def stop(*args):raise SystemExit(0)
        signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
        try:
            set_enabled(True);started=time.time()
            while time.time()-started<90:heartbeat();time.sleep(5)
        finally:set_enabled(False)
if __name__=='__main__':
    try:main()
    except Exception as exc:print(str(exc));sys.exit(1)
