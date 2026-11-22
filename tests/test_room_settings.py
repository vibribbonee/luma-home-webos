"""Validate the shared settings contract without needing a running HA instance."""
import ast
import json
from pathlib import Path
import re
import unittest

source=Path(__file__).resolve().parents[1]/'custom_components/luma_home/const.py'
tree=ast.parse(source.read_text())
nodes=[node for node in tree.body if isinstance(node,ast.Assign)
       or isinstance(node,ast.FunctionDef) and node.name=='validate_patch']
scope={'re':re,'json':json,'HomeAssistantError':ValueError}
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),scope)
validate=scope['validate_patch']

class RoomSettingsTest(unittest.TestCase):
    def test_two_hundred_controls_preserve_order(self):
        controls=['switch.control_'+str(i) for i in range(200)]
        self.assertEqual(validate({'controls':controls})['controls'],controls)

    def test_control_bound_does_not_raise_app_pin_limit(self):
        with self.assertRaises(ValueError):validate({'controls':['switch.x']*201})
        with self.assertRaises(ValueError):validate({'pins':['app']*25})

    def test_optional_speaker_and_reversible_input_setting(self):
        self.assertEqual(validate({'voice_reply_speaker':''}),{'voice_reply_speaker':''})
        for on in (False,True):
            self.assertEqual(validate({'input_button_cycle':on}),{'input_button_cycle':on})
        with self.assertRaises(ValueError):validate({'input_button_cycle':'on'})
