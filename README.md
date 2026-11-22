<img src="custom_components/luma_home/brand/icon.png" alt="" width="64" height="64" align="right">

# Luma Home

Put your apps, HDMI inputs, and Home Assistant controls on one screen on a rooted LG webOS TV.

[![Add to Home Assistant Marketplace](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=vibribbonee&repository=luma-home-webos&category=integration)

## Features

- **Launcher and quick panel.** Pin TV apps and HDMI inputs. Open a compact panel over what you’re watching, or open the full launcher.
- **Home Assistant controls.** Scroll through up to 200 controls and readings. Adjust brightness and warmth, run scenes and scripts, and show temperature, humidity and CO₂.
- **Voice on the TV remote.** Use tap-to-speak or hold-to-speak with Home Assistant Assist and hear replies on the TV or an optional Home Assistant speaker.
- **Overlays.** Show a camera feed, a text notification, or a spoken announcement over the current picture.
- **Personalize the TV.** Set a backdrop, rename HDMI inputs, and display an idle clock.

![Luma Home launcher with an HDMI input, pinned apps, and sample Home Assistant controls](docs/launcher.jpg)

## Install

1. On the TV, open **Homebrew Channel → Settings → Add repository** and enter the [Homebrew catalog URL](https://raw.githubusercontent.com/vibribbonee/arcguard/main/repo.json). Install **Luma Home** and **Luma Camera Overlay**, or download both [IPKs from Releases](https://github.com/vibribbonee/luma-home-webos/releases/latest).
2. Add your TV to Home Assistant with the built-in **LG webOS TV** integration. Install Luma Home from Marketplace, restart Home Assistant, then add the **Luma Home** integration and select the TV.
3. In Home Assistant, add `/luma_home/luma-home-card.js` as a JavaScript module dashboard resource. Add a card with `type: custom:luma-home-settings`. With the TV on, open the card and select **Pair TV with this Home Assistant**.
4. On the TV, open **Luma Home → Settings → System & voice** and enable **Home button shortcut**. Tap Home for the full launcher or hold it for the quick panel. You can swap the two actions in the same menu.

Tested on LG UP78 (43UP78006LB), webOS 6.3.2-425.

## LumaX on a Streamer

The Streamer setup works with an Android TV or Google TV device connected to any HDMI display.

The current [LumaX preview release](https://github.com/vibribbonee/luma-home-webos/releases/tag/v0.4.29-preview) includes the Streamer APK, both webOS packages and the matching Home Assistant integration. See [Streamer setup and source](android-native/README.md).

1. Add the Streamer to Home Assistant using **Android TV Remote**.
2. In **Settings → Devices & services → Add integration → Luma Home**, choose **Android TV or Google TV Streamer**. Select its remote entity, then choose the Home Assistant area for Assist.
3. In **LumaX settings**, connect to Home Assistant and choose the room under **Luma Home room**. Enable **Home button shortcuts** to show Room controls while another Streamer app is playing.
4. Select **Default assistant and mic button** in LumaX settings to use the Google remote for Assist.

Choose an optional **Assist reply speaker** in LumaX settings or the HA settings card. With a paired LG, use it only while the TV is off or for every reply. Leave it on **Device audio** to keep the current behavior.

Camera previews and text notifications appear in the Streamer’s video output. HDMI switching for other inputs uses the display’s own controls.

The optional **Input button switches HDMI 1 / HDMI 2** setting replaces LG’s input picker. Turn it off to restore the picker.

### Pair the Streamer with an LG TV

1. Open **Luma Home → Configure** in Home Assistant for the LG. Select the Streamer’s remote and HDMI port, then enable **LumaX Home routing**.
2. In the Streamer’s **LumaX settings → Luma Home room**, choose the LG’s room. On the LG, enable **Home button shortcut** and **Home Assistant microphone** under **System & voice**.

Tap Home to open the Streamer. Hold Home for Room controls on the active input. Swap the shortcuts for both remotes in **LumaX settings**. Assist and HA camera alerts also follow the active input. Use **LumaX settings → LG idle and no signal** to manage the LG’s idle clock and no-signal options.

To hide a tile on the Streamer, hold OK and select **Hide app**. Restore it under **LumaX settings → Hidden apps**. On the LG, use **Settings → Apps**.

## Use it with Home Assistant

- **Reply speaker** — In the Luma Home settings card, choose an Assist reply speaker. Use it when the paired TV is off or for every reply. Choose Device audio to switch back.
- **Voice** — Turn on **Home Assistant microphone** in **System & voice** and choose an Assist pipeline on the Luma Home device page.
- **Notifications** — Use `luma_home.notify` for a text overlay or `assist_satellite.announce` for a spoken announcement with text.
- **Cameras** — Use `luma_home.show_camera` with a camera entity to show a timed overlay.

[Home Assistant actions](custom_components/luma_home/services.yaml) · [Wallpaper credits](src/com.spinoff.lumahome/licenses/wallpapers.txt) · [Icon and library credits](vendor/README.md)

## Contributing

Pull requests are welcome. Describe the change and how you tested it.

[MIT license](LICENSE). OpenAI Codex assisted with development, testing, and documentation.
