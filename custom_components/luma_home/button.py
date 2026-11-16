from homeassistant.components.button import ButtonEntity
from .entity import LumaEntity
BUTTONS={'home':('Open Home','mdi:home',{'view':'home'}),'quick':('Open quick panel','mdi:view-dashboard',{'view':'quick'}),'settings':('Open settings','mdi:cog',{'view':'settings'}),'idle':('Open ambient clock','mdi:clock',{'view':'idle'}),'dismiss':('Dismiss overlay','mdi:close',None)}
async def async_setup_entry(hass,entry,async_add_entities):
    tv = entry.runtime_data
    async_add_entities([LumaButton(tv,k,*v) for k,v in BUTTONS.items()
                        if not tv.streamer_only or k in ('home', 'quick', 'dismiss')])
class LumaButton(LumaEntity,ButtonEntity):
    def __init__(self,tv,key,name,icon,params):super().__init__(tv,key,name);self._attr_icon=icon;self.params=params
    async def async_press(self):
        if self.params is None:await self.tv.dismiss()
        else:await self.tv.open(**self.params)
