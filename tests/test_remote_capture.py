"""Read IR diagnostics without grabbing or changing any remote device."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).parents[1] / 'tools/observe-remote.py'
spec = importlib.util.spec_from_file_location('remote_capture', source)
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class RemoteCaptureTest(unittest.TestCase):
    def test_names_include_receivers_after_event_eleven(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'devices'
            path.write_text('N: Name="IR receiver"\nH: Handlers=kbd event17\n\nN: Name="Magic Remote"\nH: Handlers=event3\n')
            names = remote.device_names(path)
        self.assertEqual(names['/dev/input/event17'], 'IR receiver')
        self.assertEqual(names['/dev/input/event3'], 'Magic Remote')

    def test_partial_records_preserve_press_and_release(self):
        press = struct.pack(remote.FMT, 1, 0, 1, 241, 1)
        release = struct.pack(remote.FMT, 1, 200, 1, 241, 0)
        records, remainder = remote.decode((press + release)[:remote.SIZE + 3])
        self.assertEqual(records, [(1, 0, 1, 241, 1)])
        records, remainder = remote.decode(remainder + (press + release)[remote.SIZE + 3:])
        self.assertEqual(records, [(1, 200, 1, 241, 0)])
        self.assertEqual(remainder, b'')

    def test_capture_opens_all_discovered_devices_read_only_and_closes_them(self):
        output = []
        with patch.object(remote.glob, 'glob', return_value=['/dev/input/event17']), \
                patch.object(remote, 'device_names', return_value={'/dev/input/event17': 'IR receiver'}), \
                patch.object(remote.os, 'open', return_value=17) as opened, \
                patch.object(remote.os, 'close') as closed, \
                patch.object(remote.time, 'time', side_effect=[0, 21]), \
                patch.object(remote, 'emit', side_effect=output.append):
            remote.capture(20)
        opened.assert_called_once_with('/dev/input/event17', remote.os.O_RDONLY | remote.os.O_NONBLOCK)
        closed.assert_called_once_with(17)
        self.assertEqual(output[0]['devices'][0]['name'], 'IR receiver')
        self.assertEqual(output[-1], {'type': 'complete'})
