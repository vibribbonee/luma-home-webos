# Maintenance audit — 23 November 2026

This is a development checkpoint, not a release or a claim of complete hardware verification.

## Fixed

- Retain catalog artwork when the HA integration unloads, using the same cache snapshot for delayed saves and unloading. A reload no longer drops icons until the TV reports again.
- Refresh the Streamer’s receiver/key-relay registrations when pairing mode changes, even when the HDMI port stays the same.
- Build repeatable webOS package bytes with controlled timestamps. Exclude hidden directories, Python bytecode, backups, temporary files and symlinks.
- Reject binary commands in the direct-peer prototype. Recover from unserializable adapter replies and skip a queued handler if its peer has disconnected or been revoked.
- Replace the obsolete helper/script browser test with offline local-app/HDMI navigation coverage. Update the companion test for current full-width quick-menu rows while retaining signed-camera, visibility, timeout and voice-stacking checks.
- Document source/generated-file boundaries, verification commands and preview signing expectations in CONTRIBUTING.md.

## Validation

- 28 Python tests passed, including cache retention and package contents/reproducibility.
- All 23 JavaScript regression scripts passed. The two initially failing legacy tests were corrected and rerun.
- 320 Android release unit tests passed; release lint and APK assembly succeeded.
- Tracked-source scan found no private-key files or references to the development network/account paths searched. This does not certify image privacy, old Git history or dependencies.

## Remaining priorities

1. Finish the direct-pairing platform adapters, discovery/reconnect, pairing UI and offline hardware checks. The peer transport remains an uninstalled prototype.
2. Test physical Home/mic gestures and navigation with both remotes on both HDMI inputs, including changing input while a panel is open and sleep/wake. Injected commands are not proof of these gestures.
3. Package matching versions and verify a hardware update/rollback before releasing these maintenance changes.
4. Replace the index-based Android settings action dispatch with stable action identifiers as that screen changes; extract connection and preference responsibilities incrementally rather than rewriting the launcher.
5. Establish production signing and migration before a stable Android release. Preserve the existing preview signing identity during preview updates.

No live device settings or installed packages were changed during this audit.
