from homeassistant.components.number import NumberEntity,NumberMode
from homeassistant.helpers.entity import EntityCategory
from .entity import LumaEntity
NUMBERS={'columns':('Small tiles across',2,3,1,None),'voice_listen_seconds':('Maximum listening time',3,30,1,'s'),'voice_silence_seconds':('Tap mode silence cutoff',.5,5,.1,'s'),'voice_start_seconds':('Wait for speech',3,20,1,'s'),'idle':('Ambient clock delay',0,60,1,'min'),'notification_seconds':('Notification duration',3,120,1,'s')}
async def async_setup_entry(hass,entry,async_add_entities):async_add_entities([LumaNumber(entry.runtime_data,k,*v) for k,v in NUMBERS.items()])
class LumaNumber(LumaEntity,NumberEntity):
    _attr_entity_category=EntityCategory.CONFIG
    _attr_mode=NumberMode.BOX
    def __init__(self,tv,key,name,lo,hi,step,unit):super().__init__(tv,key,name);self._attr_native_min_value=lo;self._attr_native_max_value=hi;self._attr_native_step=step;self._attr_native_unit_of_measurement=unit
    @property
    def native_value(self):return self.tv.config[self.key]
    async def async_set_native_value(self,value):await self.tv.update({self.key:value})
