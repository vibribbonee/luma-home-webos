# Luma Home

[![Add to Home Assistant Marketplace](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=vibribbonee&repository=luma-home-webos&category=integration)

Luma Home replaces the launcher on a compatible rooted LG webOS TV. It adds quick controls for Home Assistant and an Assist satellite for voice requests and announcements. Hardware tested on a rooted LG UP78 43-inch 4K Smart UHD TV (43UP78006LB) running webOS 6.3.2-425.

## Install or upgrade

For TV installation, open **Homebrew Channel → Settings → Add repository** and enter [the webOS catalog](https://raw.githubusercontent.com/vibribbonee/arcguard/main/repo.json). You can also download the IPKs from [GitHub Releases](https://github.com/vibribbonee/luma-home-webos/releases).

1. On a compatible rooted LG TV with Homebrew Channel, use its IPK installer to install the Luma Home and overlay packages. Build them with `python3 build.py` if you are using a source checkout.
2. Install the Home Assistant integration from `custom_components/luma_home`. Restart Home Assistant, open **Settings → Devices & services → Add integration → Luma Home**, and pair your TV.
3. In the TV app’s settings, enable the Home-button replacement when you’re ready to use it.

To upgrade the HA integration, retain the existing integration entry and pairing.

## Installed components

- `com.spinoff.lumahome`: full home screen, app pins, HDMI sources, clock, room sensors and four HA favorites.
- `com.spinoff.lumahome.overlay`: right-side quick panel and temporary camera and notification overlays.
- `/var/lib/webosbrew/lumahome/home-hook.py`: Magic Remote Home handler. Tap opens/toggles the panel; holding 650 ms opens full Home. All other input is forwarded to the matching idle Magic Remote device. A watchdog releases the exclusive input grab if the helper stalls or exits.
- `/var/lib/webosbrew/init.d/95-lumahome-remote`: starts only the Home handler at boot. It does not open a menu at startup.

## Home Assistant

Open the Luma Home device in **Settings → Devices & services → Luma Home** to configure the TV and its Assist satellite. The launcher shares its pins, controls, sensor selections, and appearance settings with the integration.

Background images accept a full HTTP(S) image URL or an HA `/local/...` path. Clear the value for the bundled fjord image. Cards use translucent surfaces over the image. Sensor selections start empty; no sensor readings are fabricated.

The TV initiates its connection to HA. Its built-in Bonjour client browses `_home-assistant._tcp.local`, requires the paired instance's UUID, then resolves its current address and advertised port. Discovery does not scan the LAN.

Pairing creates a dedicated per-TV access token. The TV stores it in `/var/lib/webosbrew/lumahome/connection.json`. Remove the pairing from Home Assistant to revoke its access.

## Input previews and launch behavior

Hover or remote focus selects one HDMI preview. Click/OK launches the source immediately. Only one input feed is used at once. The video viewport maintains 16:9. On-device inspection confirmed a 1920×1080 HDMI 1 stream and loaded app artwork in 0.2.0.

The full home runs as an overlay so the input manager's HDMI activation does not hide it. Experimental preview can be disabled in TV Settings → Appearance.

The menus activate immediately on relaunch. 0.2.2 hides rather than closes their windows so webOS can reuse the document and HA connection. The system may still discard a background app under memory pressure, requiring a cold start.

## Disable / restore stock Home

TV Settings → Appearance → **Home button: tap quick panel, hold full home** toggles the helper.

From the existing root SSH shell:

```sh
/var/lib/webosbrew/lumahome/home-hook.sh stop
```

To enable again:

```sh
/var/lib/webosbrew/lumahome/home-hook.sh enable
```

`stop` removes the enable marker, verifies the helper PID's executable path, and terminates only that process. The boot entry does nothing while the enable marker is absent. **LG Home** remains available from both Luma settings and the quick panel.

## Camera overlay

The installed companion accepts launch parameters:

```json
{"camera":"camera.front_door","timeout":15,"position":"top-right","size":25,"mode":"snapshot"}
```

`camera` must be an existing HA camera entity. The app obtains a short-lived signed image path over its authenticated HA WebSocket. Snapshot mode refreshes once per second and needs no second video decoder. Optional `mjpeg` uses the HA camera stream image endpoint. Back/OK and the timeout dismiss it. Choose the camera entity in the Home Assistant action or automation that launches the overlay.

## Voice status

Luma Home exposes the TV as a Home Assistant Assist satellite. Use the remote’s voice button for push-to-talk and choose an Assist pipeline on the TV’s device page in Home Assistant. The TV plays the response through its speakers. You can also use `assist_satellite.announce` to play a spoken notification and show its text as an overlay. Push-to-talk is confirmed working on the tested LG UP78. A webOS configuration that disables the microphone can prevent push-to-talk.

HA exposes existing local Assist pipelines, including faster-whisper / Ollama / Piper. No HA voice-pipeline settings were changed.

## Build and checks

```sh
python3 build.py
```

Creates versioned IPKs in `dist/`, with nonzero ar timestamps and USTAR payloads. No webOS SDK or npm build is required. `tests/browser.cjs` checks bidirectional pin updates, app/source launches, control actions, idle mode and unavailable-state handling with simulated TV/HA APIs. Real-device checks are recorded separately from those mocks.

`tools/benchmark-open.cjs` measures only the Luma app's own document visibility. `tools/tv-inspect.cjs` inspects only its page.

## Wallpaper

Generated with the built-in imagegen tool. Asset: `src/com.spinoff.lumahome/assets/fjord-dusk.png`. Prompt: `wallpaper-prompt.txt`. The generated original was retained; the project uses its own copy. The launcher reads installed app icons from the TV. See the bundled license and credits files for the wallpapers and included icon sets.

## 0.3.0 / 0.3.1 changes

- **Faster menu:** the TV remembers the last address that answered (`last_url` in `connection.json`, checked against the paired HA UUID) and only falls back to Bonjour if that fails. It fetches states once and then subscribes only to the helpers, favorites and climate sensors it shows instead of every HA state change.
- **HDMI preview / black input:** the preview video is released (and given 350 ms) before launching an input; it restarts every time the home screen is shown or relaunched. This is a fix for a suspected cause; verify on the TV.
- **Magic Remote pointing:** `home-hook.py` now survives the remote sleeping or re-pairing, retries busy writes, and logs which event types the remote emits and which the forwarding device cannot accept. Read `home-hook.log` (`tools/diagnose.sh`) if pointing still breaks: a WARNING line naming REL/ABS codes means the forwarding device drops pointer events and the hook needs a different forwarding approach.
- **Lights:** dimmable favorites show their brightness as a fill (HA-tile style). Left/Right on the remote change it in 10% steps, the Magic Remote wheel works too.
- **Favorite tile size** (Compact up to 6 / Standard 4 / Large 4), a new `input_select.luma_home_tile_size` helper.
- **Backdrops:** Twilight, Forest, Midnight (photo variants) plus Aurora, Ember, Slate, Clear (pure CSS). **Image upload:** the HA card resizes a chosen picture to 1920 px wide JPEG, uploads it with HA's `image_upload` API and stores `/api/image/serve/<id>/original` in the background helper.
- **SmartTube / Jellyfin on the Google TV Streamer:** pins `ha:script.luma_launch_smarttube` and `ha:script.luma_launch_jellyfin` run those HA scripts (`remote.turn_on` with a `market://launch?id=...` activity on `remote.google_tv_streamer_2`), then switch the TV to HDMI 1. The quick panel has matching buttons.
- **Voice:** `voice-assist.js` and `voice-session.sh` now write `voice.log` (phases and errors only, no audio or transcript text) and `voice-status.json` carries the last error. The mic itself is not confirmed fixed.
- `tools/deploy.sh` builds, installs both IPKs, updates the helper scripts and restarts the hook; `tools/diagnose.sh` prints everything needed to debug the mic/remote (never the token).
- **Per-favorite tile sizes (0.3.1):** `input_text.luma_home_tile_sizes` holds a JSON map such as `{"light.main_lights":"Large"}`; the global size is the default. Layout fits by height (Compact 70 px, Standard 106 px, Large 132 px, 488 px budget, at most 6) so tiles never run into the climate widgets or the app row. Set sizes in the HA card or in TV Settings → Widgets & controls.
- **Home Assistant drives the TV (0.3.1):** the apps accept launch parameters, and these scripts (created in HA) send them with `webostv.command` → `system.launcher/launch` on `media_player.lg_webos_smart_tv`:
  - `script.luma_tv_open` (`view`: home | quick | idle | settings, `tab`: pins | widgets | appearance)
  - `script.luma_tv_input` (`input`: 1 | 2, `watch`: true opens the input full screen, false only previews it)
  - `script.luma_tv_features` (`feature`: home_button | microphone, `state`: on | off)
  - `script.luma_launch_smarttube`, `script.luma_launch_jellyfin` (start the app on the Google TV Streamer)

  Raw parameters if you want your own automations: launcher `{"luma":"settings|idle|home|input|hook|voice", "tab":..., "input":"1|2", "watch":true, "state":"on|off"}`; overlay `{"quick":true}` (toggles the quick panel), `{"close":true}`, `{"camera":"camera.x","timeout":15}`.
- `tests/card.cjs` loads the HA card with a fake `hass` (size selects, backdrops, image upload).

## Contributing

Pull requests are welcome. Describe what changed and how you tested it.

## AI disclosure

OpenAI Codex assisted with development, testing, and documentation.
