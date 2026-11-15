"""Standard HA spoken alerts, without changing the remote's capture path."""
from homeassistant.components.assist_satellite import (
    AssistSatelliteEntity, AssistSatelliteEntityFeature,
    AssistSatelliteConfiguration,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from .const import DOMAIN
from .entity import LumaEntity

async def async_setup_entry(hass,entry,async_add_entities):
    async_add_entities([LumaSatellite(entry.runtime_data,'assist','Assist')])

class LumaSatellite(LumaEntity,AssistSatelliteEntity):
    _attr_supported_features=AssistSatelliteEntityFeature.ANNOUNCE

    @property
    def pipeline_entity_id(self):
        return er.async_get(self.hass).async_get_entity_id('select',DOMAIN,self.tv.tv_id+'-pipeline')

    def async_get_configuration(self):
        return AssistSatelliteConfiguration(available_wake_words=[],active_wake_words=[],max_active_wake_words=0)

    async def async_set_configuration(self,config):
        if config.active_wake_words:raise HomeAssistantError('This TV uses the remote mic button, not wake words.')

    def on_pipeline_event(self,event):
        """PTT keeps using the existing client; only ANNOUNCE is advertised."""

    async def async_announce(self,announcement):
        await self.tv.announce(announcement)
