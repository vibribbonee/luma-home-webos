const {execFileSync}=require('child_process'),assert=require('assert'),path=require('path');
const file=path.resolve(__dirname,'../tools/voice-worker.py');
const result=execFileSync('python3',['-c',`
import importlib.util,json,os,socket,tempfile,threading
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('worker',${JSON.stringify(file)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='luma-worker-client-') as root:
 m.ROOT=root;m.warm=lambda:True
 assert m.start() is False, 'disabled mic cannot start a session'
 open(root+'/voice.enabled','w').close()
 server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(root+'/voice-worker.sock');server.listen(1)
 def serve():
  client,_=server.accept();assert client.recv(128)==b'start\\n';client.sendall(b'started\\n');client.sendall(b'{"done":true,"success":true}\\n');client.close()
 t=threading.Thread(target=serve);t.start();assert m.start() is True;t.join();server.close()
 with patch.object(m,'stop') as stop,patch.object(m,'worker_pid',side_effect=[91,None]),patch.object(m,'warm',return_value=True) as warm:
  os.mkdir(root+'/voice.lock')
  assert not m.reload_worker(),'keep the current voice session during an update'
  stop.assert_not_called()
  os.rmdir(root+'/voice.lock')
  assert m.reload_worker()
  stop.assert_called_once()
  warm.assert_called_once()
print(json.dumps({'success':True}))
`],{encoding:'utf8'});assert(JSON.parse(result).success);console.log('Passed: disabled microphone cannot start a worker session; Python start client handles real Unix-socket acknowledgement and completion.');
