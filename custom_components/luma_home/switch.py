from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.entity import EntityCategory
from .entity import LumaEntity
SWITCHES={'home_swap':('Swap Home tap and hold','mdi:swap-vertical'),'home_button':('Home button shortcut','mdi:remote'),'microphone':('HA voice microphone','mdi:microphone'),'voice_reply':('Spoken replies','mdi:volume-high'),'climate':('Show room climate','mdi:thermometer'),'no_signal':('Home on no HDMI signal','mdi:monitor-off'),'screensaver':('Dashboard screensaver','mdi:clock')}
async def async_setup_entry(hass,entry,async_add_entities):async_add_entities([LumaSwitch(entry.runtime_data,k,*v) for k,v in SWITCHES.items()])
class LumaSwitch(LumaEntity,SwitchEntity):
    _attr_entity_category=EntityCategory.CONFIG
    def __init__(self,tv,key,name,icon):super().__init__(tv,key,name);self._attr_icon=icon
    @property
    def is_on(self):return self.tv.config[self.key]
    async def async_turn_on(self,**kwargs):await self.tv.update({self.key:True})
    async def async_turn_off(self,**kwargs):await self.tv.update({self.key:False})
