# LumaX native preview

LumaX builds on the complete CleanYourTV Android launcher. Run it on a Streamer by itself or pair it with a Luma Home TV through Home Assistant.

- Open **Settings → LumaX settings**. Choose **Home Assistant address** to find Home Assistant on the LAN, or enter its address manually. Add an access token, then select an LG or **Streamer only**.
- Use a stable hostname for the Home Assistant address if your network provides one. If you paired with a numeric IP and it changed, run **Find Home Assistant** again and pair with the rediscovered address.
- Choose temperature, humidity, and CO₂ sensors. Paired TVs use their Luma Home sensor selections unless you set an override here.
- Hold OK on an LG app or HDMI tile to add it to the dock, rename it, or choose a picture. The HDMI tile also offers split Steam and Switch 2 artwork. The Streamer’s HDMI port is excluded from the LG input tiles.
- Pair an LG to show its apps and artwork on the Streamer. In Home Assistant, choose **LumaX Native Preview** as the **Streamer launcher** and set the HDMI port it uses.
- Enable **Home button shortcuts** for Room controls over playback. When paired, the active input decides which device shows Room controls, camera, and Assist overlays. Tap Home to open the Streamer launcher and hold it for Room controls. You can swap these actions in **LumaX settings**.
- To use the Google remote’s mic, open **Default assistant and mic button** and select LumaX in Android’s assistant settings. You can also start Assist and open camera snapshots from the launcher.
- In the room’s **Luma Home** Home Assistant card, choose an **Assist reply speaker** that can play Home Assistant audio. For a room paired with an LG, choose **Only when TV is off** or **Always**. Choose **Device audio** to switch back.

LumaX Native Preview installs as a separate Android app. Open it from Google TV’s apps and use **LumaX settings** to enable Home button shortcuts and choose the default assistant through Android’s prompts.

To remove it, turn off **Home button shortcuts** in LumaX. Use **Android Home app** and **Default assistant and mic button** to restore your previous defaults if you changed them. If you paired an LG, turn off **LumaX Home routing** in Home Assistant. You can then uninstall LumaX from Android’s app settings.

On a paired TV, the Google remote can control LG Room controls while the Streamer is awake. If your Streamer enters standby as soon as you change inputs, check its HDMI-CEC settings for standby when it stops being the active source. LumaX uses the existing power setting on the device.

Turn on **Google remote on other LG inputs** to use the remote’s arrows, OK, and Back in native LG screens while another input or an LG app is active. Tap Home to close Room controls. The Philips, Samsung, or standalone Streamer path continues to use Android’s own controls.

Use **Adjustable lights** to swap what tap and hold do on dimmable lights. A paired LG and Streamer share this setting. Both show power, brightness, and warmth where the light supports them.

## Credits

CleanYourTV is used under the repository’s MIT license. The Steam mark comes from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/steam.svg). The [Switch 2 mark](https://commons.wikimedia.org/wiki/File:Nintendo_Switch_2_logo_transparent_without_text.svg) is Nintendo’s.

## Build

Use JDK 17 or later with Android SDK platform 34 and build-tools 34.0.0. Set `ANDROID_HOME` to your SDK, then run `./gradlew testReleaseUnitTest lintRelease assembleRelease` from this folder. The APK is written to `app/build/outputs/apk/release/app-release.apk`. Published previews use a persistent signing key so updates preserve app settings.
