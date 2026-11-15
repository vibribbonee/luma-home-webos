from homeassistant.components.binary_sensor import BinarySensorEntity,BinarySensorDeviceClass
from homeassistant.helpers.entity import EntityCategory
from .entity import LumaEntity
async def async_setup_entry(hass,entry,async_add_entities):async_add_entities([LumaReady(entry.runtime_data,'setup_complete','TV setup complete')])
class LumaReady(LumaEntity,BinarySensorEntity):
    _attr_entity_category=EntityCategory.DIAGNOSTIC
    @property
    def is_on(self):return bool(self.tv.status.get('setup_complete'))
