"""Unloading an integration must retain its artwork as well as app names."""
import ast
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import unittest

root = Path(__file__).parents[1] / 'custom_components/luma_home'
coordinator = ast.parse((root / 'coordinator.py').read_text())
method = next(node for cls in coordinator.body if isinstance(cls, ast.ClassDef) for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == 'catalog_snapshot')
module = ast.parse((root / '__init__.py').read_text())
unload = next(node for node in module.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'async_unload_entry')
scope = {'deepcopy': deepcopy, 'DOMAIN': 'luma_home', 'platforms_for': lambda tv: []}
exec(compile(ast.Module(body=[method, unload], type_ignores=[]), str(root), 'exec'), scope)


class CatalogCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_unload_retains_artwork_and_names(self):
        store = SimpleNamespace(async_save=AsyncMock())
        tv = SimpleNamespace(catalog=[{'id': 'test.app'}], catalog_artwork={'test.app': 'image'}, artwork_version='revision', catalog_ready=True, catalog_store=store)
        tv.catalog_snapshot = lambda: scope['catalog_snapshot'](tv)
        entry = SimpleNamespace(runtime_data=tv, entry_id='test-entry')
        hass = SimpleNamespace(data={'luma_home': {'test-entry': tv}}, config_entries=SimpleNamespace(async_unload_platforms=AsyncMock(return_value=True)))
        self.assertTrue(await scope['async_unload_entry'](hass, entry))
        saved = store.async_save.call_args.args[0]
        self.assertEqual(saved['catalog_artwork'], tv.catalog_artwork)
        tv.catalog_artwork.clear()
        self.assertEqual(saved['catalog_artwork'], {'test.app': 'image'})

    async def test_failed_unload_keeps_entry_and_cache(self):
        tv = SimpleNamespace()
        entry = SimpleNamespace(runtime_data=tv, entry_id='test-entry')
        hass = SimpleNamespace(data={'luma_home': {'test-entry': tv}}, config_entries=SimpleNamespace(async_unload_platforms=AsyncMock(return_value=False)))
        self.assertFalse(await scope['async_unload_entry'](hass, entry))
        self.assertIs(hass.data['luma_home']['test-entry'], tv)
