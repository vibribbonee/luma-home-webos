# Luma Home

A launcher and quick panel for rooted LG webOS TVs. Pin apps and HDMI inputs, control Home Assistant devices, and display camera feeds and notifications over what you’re watching.

[![Add to Home Assistant Marketplace](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=vibribbonee&repository=luma-home-webos&category=integration)

## Install

1. On the TV, open **Homebrew Channel → Settings → Add repository** and enter the [Homebrew catalog URL](https://raw.githubusercontent.com/vibribbonee/arcguard/main/repo.json). Install **Luma Home** and **Luma Camera Overlay**, or download both [IPKs from Releases](https://github.com/vibribbonee/luma-home-webos/releases/latest).
2. Install the Home Assistant integration using the button above. Restart Home Assistant, then open **Settings → Devices & services → Add integration → Luma Home** and pair your TV. Keep the existing entry when upgrading.
3. Turn on the **Home button** option under **Appearance** in Luma. Tap Home for the quick panel or hold it for the full launcher. Toggle the option off to restore the LG Home button.

Tested on LG UP78 (43UP78006LB), webOS 6.3.2-425.

## Use it with Home Assistant

- **Voice** — Choose an Assist pipeline on the Luma Home device page. Press the remote’s voice button to talk and hear the response on the TV.
- **Notifications** — Use `luma_home.notify` for a text overlay or `assist_satellite.announce` for a spoken announcement with text.
- **Cameras** — Use `luma_home.show_camera` with a camera entity to show a timed overlay.

Build both IPKs with `python3 build.py`. See [wallpaper credits](src/com.spinoff.lumahome/licenses/wallpapers.txt) and [icon and library credits](vendor/README.md).

## Contributing

Pull requests are welcome. Describe the change and how you tested it.

[MIT license](LICENSE). OpenAI Codex assisted with development, testing, and documentation.
