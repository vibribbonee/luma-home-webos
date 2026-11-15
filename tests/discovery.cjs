const {execFileSync}=require('child_process'),assert=require('assert'),path=require('path');
const file=path.resolve(__dirname,'../tools/discover-ha.py');
const result=execFileSync('python3',['-c',`
import importlib.util,json
s=importlib.util.spec_from_file_location('discovery',${JSON.stringify(file)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
uuid='0123456789abcdef0123456789abcdef'; calls=[]
def query(args):
 calls.append(args)
 if args[0]=='-B': return 'Add 2 3 local. _home-assistant._tcp New server name'
 if args[0]=='-L':
  if args[1]=='Old name': return 'Home can be reached at wrong.local.:8123 uuid=ffffffffffffffffffffffffffffffff'
  return 'Home can be reached at ha.local.:8123 uuid='+uuid
 return '0.0.0.0 127.0.0.1 999.1.1.1 224.0.0.1 192.0.2.191'
a=m.discover({'uuid':uuid,'tv_id':'tv'},lookup=query)
assert a['url']=='http://192.0.2.191:8123' and a['tv_id']=='tv' and 'token' not in a
calls[:]=[]
b=m.discover({'uuid':uuid,'service_name':'Old name'},browse=True,lookup=query)
assert b['service_name']=='New server name'
assert ['-G','v4','wrong.local.'] not in calls
try: m.discover({'uuid':'ffffffffffffffffffffffffffffffff'},lookup=query)
except ValueError: pass
else: raise AssertionError('wrong UUID accepted')
try: m.discover({},lookup=query)
except ValueError: pass
else: raise AssertionError('unpaired discovery accepted')
assert m.ready(['-L'],'can be reached at ha.local.:8123 uuid='+uuid)
assert not m.ready(['-L'],'can be reached at ha.local.:8123 uuid=0123')
print(json.dumps({'success':True}))
`],{encoding:'utf8'});assert(JSON.parse(result).success);console.log('Passed: paired UUID validation, changed IP, renamed Bonjour service fallback, invalid address rejection, no credentials in discovery results.');
