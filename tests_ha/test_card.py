"""The integration serves and auto-loads its dashboard card."""
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.setup import async_setup_component

from custom_components.luma_home import CARD_URL


async def test_card_is_served_and_auto_loaded(hass, hass_client):
    # Voice dependencies expect the core integration, as in a real install.
    assert await async_setup_component(hass, "homeassistant", {})
    assert await async_setup_component(hass, "luma_home", {})
    await hass.async_block_till_done()
    urls = hass.data[DATA_EXTRA_MODULE_URL].urls
    assert any(u.startswith(f"{CARD_URL}?v=0.4.") for u in urls), urls
    client = await hass_client()
    response = await client.get(CARD_URL)
    assert response.status == 200
    assert "luma-home-settings" in await response.text()
