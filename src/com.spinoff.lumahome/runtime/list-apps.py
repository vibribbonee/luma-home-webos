#!/usr/bin/python
"""Return installed app metadata only, through the authorized root bridge."""
from __future__ import print_function
import json,subprocess
p=subprocess.Popen(['/usr/bin/luna-send','-w','2000','-n','1','-f','luna://com.webos.applicationManager/listApps','{}'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
raw=p.stdout.read();p.wait();p.stdin.close()
try:
 result=json.loads(raw);apps=[]
 for item in result.get('apps',[]):
  if not item.get('id') or item.get('visible') is False:continue
  icon=item.get('icon','')
  if icon and not icon.startswith('/') and item.get('folderPath'):icon=item['folderPath']+'/'+icon
  apps.append({'id':item['id'],'title':item.get('title',item['id']),'icon':icon,'visible':True,'system':bool(item.get('systemApp'))})
 print(json.dumps(apps))
except ValueError:print('[]')
