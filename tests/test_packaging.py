"""Check installable package bytes and exclude local development artifacts."""
import contextlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('luma_build', Path(__file__).parents[1] / 'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def members(package):
    data = package.read_bytes()
    assert data[:8] == b'!<arch>\n'
    offset = 8
    result = {}
    while offset < len(data):
        header = data[offset:offset + 60]
        size = int(header[48:58])
        result[header[:16].decode().strip().rstrip('/')] = data[offset + 60:offset + 60 + size]
        offset += 60 + size + size % 2
    return result


class PackagingTest(unittest.TestCase):
    def test_packages_are_reproducible_and_exclude_development_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'src/test.app'
            source.mkdir(parents=True)
            (source / 'appinfo.json').write_text(json.dumps({'version': '1.0.0', 'title': 'Test'}))
            (source / 'index.html').write_text('launcher')
            for name in ['__pycache__/module.pyc', '.private/token', 'runtime/cache.pyc', 'runtime/save.bak']:
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('must not ship')
            (source / 'outside-link').symlink_to(root / 'private')
            with patch.object(builder, 'ROOT', root), patch.dict(os.environ, {'SOURCE_DATE_EPOCH': '1234'}), contextlib.redirect_stdout(io.StringIO()):
                output = builder.build('test.app')
                first = output.read_bytes()
                os.utime(source / 'index.html', (9999, 9999))
                with patch('time.time', return_value=999999):
                    builder.build('test.app')
                self.assertEqual(output.read_bytes(), first)
                with tarfile.open(fileobj=io.BytesIO(members(output)['data.tar.gz']), mode='r:gz') as archive:
                    names = archive.getnames()
                    self.assertTrue(any(name.endswith('/index.html') for name in names))
                    self.assertFalse(any('private' in name or 'cache' in name or name.endswith('.bak') or 'outside-link' in name for name in names))
                    self.assertTrue(all(item.mtime == 1234 for item in archive.getmembers()))
