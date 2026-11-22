#!/usr/bin/python
"""Own one native Home-only filter; preserve every other configd filter."""
from __future__ import print_function
import fcntl,json,os,subprocess,sys
ROOT='/var/lib/webosbrew/lumahome'
KEY='com.webos.surfacemanager.keyFilters'
FILE=ROOT+'/home-keyfilter.js';CYCLE=ROOT+'/home-keyfilter-cycle.js';OWN_FILES=(FILE,CYCLE,ROOT+'/home-keyfilter-trial.js');ITEM={'file':FILE,'handler':'handleLumaHome'}
def luna(method,body):
    p=subprocess.Popen(['/usr/bin/luna-send','-w','1200','-n','1','-f','luna://com.webos.service.config/'+method,json.dumps(body)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    raw=p.stdout.read();p.wait();p.stdin.close()
    try:return json.loads(raw)
    except ValueError:return {}
def current():
    result=luna('getConfigs',{'configNames':[KEY]});items=result.get('configs',{}).get(KEY)
    if not result.get('returnValue') or not isinstance(items,list) or not items:raise RuntimeError('Native Home filter is unsupported on this firmware')
    return items
def enabled():return any(x.get('file') in (FILE,CYCLE) for x in current())
def update_filters(on):
    items=current();rest=[x for x in items if x.get('file') not in OWN_FILES]
    if on:
        if not os.path.isfile(FILE):raise RuntimeError('Home filter is missing')
        item=ITEM
        try:cycle=bool(json.load(open(ROOT+'/runtime.json')).get('input_button_cycle',False))
        except (IOError,ValueError):cycle=False
        if cycle:
            with open(FILE) as source:script=source.read().replace('var lumaCycleInputs = false;', 'var lumaCycleInputs = true;')
            with open(CYCLE+'.tmp','w') as output:output.write(script)
            os.rename(CYCLE+'.tmp',CYCLE)
            item={'file':CYCLE,'handler':'handleLumaHome'}
        rest.insert(0,item)
    if rest==items:return
    if on:
        if not os.path.exists(ROOT+'/key-filter-original.json'):
            with open(ROOT+'/key-filter-original.json','w') as f:json.dump(items,f)
            os.chmod(ROOT+'/key-filter-original.json',384)
    result=luna('setConfigs',{'configs':{KEY:rest}})
    if not result.get('returnValue'):raise RuntimeError('Native key filter update was rejected')
def set_enabled(on):
    with open(ROOT+'/key-filter.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        update_filters(on)
def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'status'
    if action=='status':print('filtered' if enabled() else 'stock')
    elif action=='enable':set_enabled(True);print('filtered')
    elif action=='disable':set_enabled(False);print('stock')
    else:raise ValueError('Expected status, enable or disable')
if __name__=='__main__':
    try:main()
    except Exception as exc:print(str(exc));sys.exit(1)
