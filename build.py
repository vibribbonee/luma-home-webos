#!/usr/bin/env python3
"""Package local sources as webOS IPKs without CLI/npm dependencies."""
import gzip,io,json,tarfile,shutil,os
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def build_epoch():
    return int(os.environ.get('SOURCE_DATE_EPOCH', '0'))

def packaged_file(path, source):
    parts = path.relative_to(source).parts
    return (path.is_file() and not path.is_symlink()
            and not any(part.startswith('.') or part == '__pycache__' for part in parts)
            and path.suffix not in ('.pyc', '.pyo', '.bak', '.tmp'))
def archive(files):
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w',format=tarfile.USTAR_FORMAT) as tar:
        for name,body,mode in files:
            item=tarfile.TarInfo(name);item.size=len(body);item.mode=mode;item.mtime=build_epoch();item.uid=item.gid=0
            tar.addfile(item,io.BytesIO(body))
    return gzip.compress(data.getvalue(),mtime=0)

def build(app_id):
    src=ROOT/'src'/app_id;info=json.loads((src/'appinfo.json').read_text());version=info['version']
    app_files=[]
    for path in sorted(src.rglob('*')):
        if packaged_file(path, src):
            app_files.append((f'./usr/palm/applications/{app_id}/{path.relative_to(src)}',path.read_bytes(),0o644))
    if app_id.endswith('.overlay'):
        main = ROOT / 'src/com.spinoff.lumahome'
        for relative in ('assets/outfit.ttf', 'licenses/outfit.txt'):
            app_files.append((f'./usr/palm/applications/{app_id}/{relative}', (main / relative).read_bytes(), 0o644))
    package={'app':app_id,'id':app_id,'loc_name':info['title'],'package_format_version':2,'vendor':'Spinoff','version':version,'services':[]}
    app_files.append((f'./usr/palm/packages/{app_id}/packageinfo.json',json.dumps(package).encode(),0o644))
    control=f'Package: {app_id}\nVersion: {version}\nArchitecture: all\nSection: webosbrew\nPriority: optional\nMaintainer: Spinoff\nDescription: Luma Home launcher and Home Assistant controls\n'.encode()
    members=[('debian-binary',b'2.0\n'),('control.tar.gz',archive([('control',control,0o644)])),('data.tar.gz',archive(app_files))]
    output=bytearray(b'!<arch>\n')
    for name,body in members:
        header=f'{name+"/":<16}{build_epoch():<12}{0:<6}{1001:<6}{"100644":<8}{len(body):<10}`\n'.encode()
        assert len(header)==60
        output.extend(header);output.extend(body)
        if len(body)%2:output.extend(b'\n')
    out=ROOT/'dist'/f'{app_id}_{version}_all.ipk';out.parent.mkdir(exist_ok=True);out.write_bytes(output);print(out);return out
if __name__=='__main__':
    runtime=ROOT/'src/com.spinoff.lumahome/runtime';runtime.mkdir(exist_ok=True)
    for path in (ROOT/'tools').glob('*'):
        if path.suffix in ('.sh','.py','.js'):shutil.copy2(path,runtime/path.name)
    shutil.copytree(ROOT/'vendor/ws',runtime/'vendor/ws',dirs_exist_ok=True)
    for name in ('runtime.js','lights.js','lights.css','navigation.js','navigation.css'):
        shutil.copy2(ROOT/'src/com.spinoff.lumahome'/name,ROOT/'src/com.spinoff.lumahome.overlay'/name)
    (ROOT/'src/com.spinoff.lumahome.overlay/common.js').write_bytes((ROOT/'src/com.spinoff.lumahome/common.js').read_bytes())
    for app in ('com.spinoff.lumahome','com.spinoff.lumahome.overlay'):build(app)
