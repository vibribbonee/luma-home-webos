"""Per-TV entity identity and push updates."""
from homeassistant.helpers.entity import Entity,DeviceInfo
from .const import DOMAIN
class LumaEntity(Entity):
    _attr_has_entity_name=True
    _attr_should_poll=False
    def __init__(self,tv,key,name):
        self.tv=tv;self.key=key;self._attr_unique_id=f'{tv.tv_id}_{key}';self._attr_name=name
        self._attr_device_info=DeviceInfo(identifiers={(DOMAIN,tv.tv_id)})
    @property
    def available(self):return self.tv.available
    async def async_added_to_hass(self):
        self.tv.listeners.add(self.async_write_ha_state)
        self.async_on_remove(lambda:self.tv.listeners.discard(self.async_write_ha_state))
