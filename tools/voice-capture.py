#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Start PCM capture before Node/HA connects. Audio stays in a bounded RAM queue."""
from __future__ import print_function
import errno,json,os,select,socket,struct,subprocess,time
ROOT='/var/lib/webosbrew/lumahome'
PATH=ROOT+'/voice-buffer.sock'
def configuration():
    try:return json.load(open(ROOT+'/runtime.json'))
    except (IOError,ValueError):return {}
def main():
    cfg=configuration();mode=cfg.get('voice_mode','hold');maximum=max(3,min(30,float(cfg.get('voice_listen_seconds',15))));silence=max(.5,min(5,float(cfg.get('voice_silence_seconds',1.5))));start_timeout=max(3,min(20,float(cfg.get('voice_start_seconds',8))))
    pending=[];client=None;mic=None;stream=None;started=time.time();recorded=None;last_speech=None;total=0;finished=False;reason='';retry=0;first_audio=None;connected_at=None;mic_ready=False;reply=b''
    try:os.unlink(PATH)
    except OSError:pass
    server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(PATH);os.chmod(PATH,384);server.listen(1);server.setblocking(False)
    def status(phase):
        with open(ROOT+'/capture-status.json','w') as f:json.dump({'phase':phase,'bytes':total,'reason':reason,'elapsedMs':int((time.time()-started)*1000),'socketMs':None if connected_at is None else int((connected_at-started)*1000),'firstAudioMs':None if first_audio is None else int((first_audio-started)*1000)},f)
    status('starting')
    try:
        while time.time()-started<45:
            now=time.time()
            if not finished:
                if mode=='hold' and not os.path.exists(ROOT+'/voice-held'):
                    reason='released';finished=True
                elif recorded is not None and now-recorded>=maximum:reason='maximum';finished=True
                elif mode=='tap' and recorded is not None and last_speech is None and now-recorded>=start_timeout:reason='no_speech';finished=True
                elif mode=='tap' and last_speech is not None and now-last_speech>=silence:reason='silence';finished=True
                elif recorded is None and now-started>start_timeout:reason='microphone_timeout';finished=True
                if finished:
                    status('finished')
                    if stream:stream.terminate()
                    if mic:mic.close();mic=None
                    subprocess.Popen(['/bin/sh',ROOT+'/voice-session.sh','restore'],stdout=open(os.devnull,'wb'),stderr=subprocess.STDOUT)
            if client is None:
                try:
                    client,_=server.accept();client.setblocking(False)
                    pending.insert(0,(json.dumps({'sample_rate':16000,'mode':mode})+'\n').encode('ascii'))
                except socket.error as e:
                    if e.errno not in (errno.EAGAIN,errno.EWOULDBLOCK):raise
            if stream and stream.stdout in select.select([stream.stdout],[],[],0)[0]:
                reply+=os.read(stream.stdout.fileno(),8192)
                try:
                    response=json.loads(reply)
                    mic_ready=response.get('returnValue') is True
                    if not mic_ready and stream.poll() is None:stream.terminate()
                except ValueError:pass
            if not finished and mic is None and now>=retry:
                retry=now+.25
                if not stream or stream.poll() is not None:
                    reply=b'';stream=subprocess.Popen(['/usr/bin/luna-send','-i','-f','luna://com.webos.service.voiceinput/startStreaming','{"deviceType":"remote","keyType":"thinQtv","subscribe":true}'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(os.devnull,'wb'))
                if not mic_ready:continue
                try:
                    candidate=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);candidate.connect('/tmp/voiceinput_remote1.soc');candidate.setblocking(False);mic=candidate;recorded=now;connected_at=now;status('waiting_for_audio')
                except socket.error:candidate.close()
            readers=[mic] if mic else []
            ready,writable,_=select.select(readers,[client] if client and pending else [],[],.02)
            if mic and mic in ready:
                try:data=mic.recv(8192)
                except socket.error:data=None
                if data:
                    # 30 seconds / 960 kB maximum, even when HA is offline.
                    room=960000-total;data=data[:room];total+=len(data);pending.append(data)
                    if first_audio is None:first_audio=now;status('listening')
                    samples=struct.unpack('<%dh'%(len(data)//2),data[:len(data)//2*2]);energy=sum(x*x for x in samples)/max(1,len(samples))
                    if energy>450*450:last_speech=now
                elif data==b'':reason='microphone_closed';finished=True;status('finished')
            if client and client in writable and pending:
                try:
                    count=client.send(pending[0]);pending[0]=pending[0][count:]
                    if not pending[0]:pending.pop(0)
                except socket.error:break
            if finished and client and not pending:break
        status('finished')
    finally:
        if stream and stream.poll() is None:stream.terminate()
        for s in (mic,client,server):
            if s:s.close()
        try:os.unlink(PATH)
        except OSError:pass
if __name__=='__main__':main()
