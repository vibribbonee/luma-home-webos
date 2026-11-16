from homeassistant.components.select import SelectEntity
from homeassistant.components.assist_pipeline.const import OPTION_PREFERRED
from homeassistant.components.assist_pipeline.runtime import KEY_ASSIST_PIPELINE
from homeassistant.components.assist_pipeline.select import AssistPipelineSelect
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity import EntityCategory
from .const import DOMAIN,THEMES
from .entity import LumaEntity
SELECTS={'theme':('Wallpaper theme',THEMES),'tilesize':('Default tile size',['Small','Compact','Standard','Large']),'voice_mode':('Voice button mode',['hold','tap'])}
async def async_setup_entry(hass,entry,async_add_entities):
    tv=entry.runtime_data
    entities = [LumaVoiceAssistant(hass,tv)]
    if not tv.streamer_only:
        entities.extend(LumaSelect(tv,k,*v) for k,v in SELECTS.items())
    async_add_entities(entities)
class LumaSelect(LumaEntity,SelectEntity):
    _attr_entity_category=EntityCategory.CONFIG
    def __init__(self,tv,key,name,options):super().__init__(tv,key,name);self._attr_options=options
    @property
    def current_option(self):return self.tv.config[self.key]
    async def async_select_option(self,option):await self.tv.update({self.key:option})

class LumaVoiceAssistant(AssistPipelineSelect):
    """Standard HA Assist-device registration and per-TV assistant selection."""
    _attr_has_entity_name=True
    _attr_name='Voice assistant'
    _attr_icon='mdi:account-voice'

    def __init__(self,hass,tv):
        self.tv=tv
        super().__init__(hass,DOMAIN,tv.tv_id)
        self._attr_device_info=DeviceInfo(identifiers={(DOMAIN,tv.tv_id)})

    @property
    def available(self):return self.tv.available

    def _sync_selection(self):
        pipeline_id=self.tv.config['voice_pipeline']
        store=self.hass.data[KEY_ASSIST_PIPELINE].pipeline_store
        selected=next((p.name for p in store.async_items() if p.id==pipeline_id),OPTION_PREFERRED)
        if selected!=self._attr_current_option:
            self._attr_current_option=selected
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        # The base registers the real device in assist_pipeline/device/list.
        await super().async_added_to_hass()
        def updated(_payload):self._sync_selection()
        self.tv.config_listeners.add(updated)
        self.async_on_remove(lambda:self.tv.config_listeners.discard(updated))
        self._sync_selection()

    async def _pipelines_updated(self,change_set):
        await super()._pipelines_updated(change_set)
        self._sync_selection()

    async def async_select_option(self,option):
        store=self.hass.data[KEY_ASSIST_PIPELINE].pipeline_store
        pipeline_id='' if option==OPTION_PREFERRED else next((p.id for p in store.async_items() if p.name==option),None)
        if pipeline_id is None:raise HomeAssistantError('Choose an available voice assistant.')
        # Save even with the TV off. The voice client reads this live from HA.
        await self.tv.update({'voice_pipeline':pipeline_id},push=False)
        await super().async_select_option(option)
