# LumaX for Google TV

LumaX (Lum-Across) is an optional Luma Home companion. The Streamer hosts the dock and app drawer. Home Assistant connects the Streamer to the paired LG for app launches, input switching, and room controls.

## Preview setup

1. Update Luma Home and its overlay on the LG and the Luma Home integration in Home Assistant to the matching preview build. Set up the existing LG webOS TV and Android TV Remote integrations.
2. Install the LumaX APK and open it from Google TV’s app list. In **Settings**, enter your Home Assistant base URL and an access token from the HA account you want to use. Prefer HTTPS or a trusted local network. The Streamer stores the token using Android Keystore. If Home Assistant changes IP, use a stable hostname in the URL.
3. Choose the paired LG and the HDMI port that the Streamer uses. If there is one LG, LumaX selects it after connecting.
4. To enable Home shortcuts from the LG, choose the Streamer’s **Android TV Remote** entity and its HDMI port in **Luma Home → Configure**, then enable **LumaX Home routing**. Confirm **Home button shortcut** is enabled on the LG.
5. To use LumaX as Google TV Home, open **Settings → Change default Home app** and choose it in the Android picker if the device offers it. LumaX also works as a regular app.

Android TV Remote launches LumaX over the LAN. Wireless debugging is useful for APK installation and is unnecessary for everyday use.

## Controls and overlays

- Press Down from the dock to reach the rest of the app drawer. The other HDMI input is a tile in that drawer. LumaX caches the LG app list for quick display.
- Select temperature, humidity and carbon dioxide sensors on the Luma Home dashboard card. The Streamer home and the lightweight LG quick panel show available readings.
- While LumaX is foregrounded and the Streamer’s input is active, Luma Home can open its room controls or show a text notification on the Streamer. Otherwise the LG handles them. Camera, image, and voice overlays use the LG.
- Settings include the four dock favorites and Black and Alpine appearances.

## Return to the previous setup

- On the Streamer, open **Change default Home app** in Settings and select the previous launcher. **Open Google TV Home** opens Google’s launcher directly. **Disconnect Home Assistant** removes the saved connection and LG catalog from this APK. You can also revoke its token in your Home Assistant profile.
- In Home Assistant, turn off **LumaX Home routing** in the Luma Home integration options. On the LG itself, **System & voice → LumaX Home fallback → Use local LG launcher** also stops local Home presses from going through LumaX. It works while Home Assistant is offline.

## Build and check

Use Android SDK platform 34, Build Tools 34.0.0, and JDK 11. Set `ANDROID_SDK_ROOT`, `LUMAX_KEYSTORE`, `LUMAX_KEY_ALIAS`, and `LUMAX_KEYSTORE_PASS`, then run `./android/build.sh` from the repository root. Keep the signing key outside the repository or in the ignored build directory.

Run `node tests/lumax.cjs` with Playwright and Chrome installed, and `python3 -m unittest discover -s tests -p 'test_lumax_overlay.py'` to check the overlay routing.

The black dock and focused-app shelf are inspired by [CleanYourTV](https://github.com/Gathin23/cleanyourtv#what-you-get). The Alpine appearance uses Luma Home’s [existing wallpaper credit](../src/com.spinoff.lumahome/licenses/wallpapers.txt).
