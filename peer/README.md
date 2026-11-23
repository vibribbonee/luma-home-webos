# Direct Luma pairing — prototype

This directory is a development prototype. It is not packaged, started or connected to the TV/Streamer controls in the current release.

The paired TV and Streamer should exchange Home, HDMI, app catalog/launch, overlay ownership, remote navigation and shared launcher preferences directly. Home Assistant remains the provider for its entities, cameras and Assist. Losing HA must not break basic paired operation; losing the peer must leave the local launcher usable.

## Implemented foundation

- Persistent random installation ID, independent of MAC/IP and retained on ordinary updates. A corrupt identity fails explicitly rather than silently replacing the pair.
- Public versioned DNS-SD service metadata (`_lumax._tcp`): ID, platform and protocol version. Metadata is only a discovery hint, never authentication.
- TLS WebSocket server with both devices identified by explicitly saved certificate fingerprints. The Android client must also pin the TV certificate. Discovery can change the address but cannot change the trusted identity/key.
- Immediate revocation of active and subsequent connections when a peer is removed.
- Explicit command allowlist and bounded messages, connections, requests and response times. No shell command, arbitrary Luna service or replay queue.

`server.js` exports a factory and never starts itself. Its platform handlers are injected; there are no native TV side effects in these modules. The server accepts commands only after checking the saved client certificate pin and certificate validity. Self-signed client certificates are deliberately checked against pins instead of a public CA chain.

## Still required before installation

1. Platform certificate storage and a visible, revocable first-pairing flow. Existing HA pairing may bootstrap a trusted pair, but standalone pairing must also be available without HA. No custom PIN encryption scheme.
2. Android continuous DNS-SD discovery/re-resolution and pinned TLS client; restart discovery after network changes and retry with bounded backoff. A temporary disconnect must preserve the saved pair.
3. LG service advertisement and lifecycle. Start only when pairing is enabled; unpair/disable must stop the service and advertisement.
4. Native platform adapters for input state, HDMI switching and allowlisted installed-app launching. Home/mic/idle must not cause unintended input changes or TV wake.
5. Overlay session ownership tied to the native LG input. The platform key handler must check the current session ID before dispatch. Stale keys must not affect a replacement panel.
6. Bidirectional events and cached, versioned preferences/catalog/artwork, with deterministic reconciliation on reconnect.
7. HA-offline, DHCP changes, restart/standby, unpair, invalid certificate, remote gesture and input-change hardware checks.

## Tests

Run `node tests/peer.cjs` from the repository root with Node 16+ and OpenSSL available. Tests create temporary certificates and a loopback listener, then clean them up. They cover paired access, missing/unknown peer refusal, client refusal of a wrong server, live revocation, command validation, persistent identity and identity-based discovery matching. They do not prove Android or LG hardware compatibility yet.
