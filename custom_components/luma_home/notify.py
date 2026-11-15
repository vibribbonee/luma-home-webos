from homeassistant.components.notify import NotifyEntity,NotifyEntityFeature
from .entity import LumaEntity
async def async_setup_entry(hass,entry,async_add_entities):async_add_entities([LumaNotify(entry.runtime_data,'notification','On-screen notification')])
class LumaNotify(LumaEntity,NotifyEntity):
    _attr_supported_features=NotifyEntityFeature.TITLE
    async def async_send_message(self,message,title=None,**kwargs):await self.tv.notify(message,title or '')
