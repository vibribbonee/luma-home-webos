from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import EntityCategory
from .entity import LumaEntity
async def async_setup_entry(hass,entry,async_add_entities):async_add_entities([LumaStatus(entry.runtime_data,k,n) for k,n in [('version','TV app version'),('voice_phase','Voice status'),('audio_state','Reply audio')]])
class LumaStatus(LumaEntity,SensorEntity):
    _attr_entity_category=EntityCategory.DIAGNOSTIC
    @property
    def native_value(self):return self.tv.status.get(self.key)
