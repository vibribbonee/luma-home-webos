from __future__ import print_function
import os, select, struct, sys, time, json
fmt='llHHi';size=struct.calcsize(fmt);fds={}
for path in ['/dev/input/event'+str(i) for i in range(12)]:
    try:fds[os.open(path,os.O_RDONLY|os.O_NONBLOCK)]=path
    except OSError:pass
end=time.time()+50
print('Watching Home/microphone key events for 50 seconds.');sys.stdout.flush()
while fds and time.time()<end:
    ready,_,_=select.select(list(fds),[],[],.2)
    for fd in ready:
        try:data=os.read(fd,size*32)
        except OSError:continue
        if not data:os.close(fd);del fds[fd];continue
        for i in range(0,len(data)-size+1,size):
            sec,usec,kind,code,value=struct.unpack(fmt,data[i:i+size])
            if kind==1:
                print(json.dumps(dict(device=fds[fd],key=code,value=value,time=sec+usec/1000000.0)));sys.stdout.flush()
for fd in fds:os.close(fd)
