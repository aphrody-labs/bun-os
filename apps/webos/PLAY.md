# Play in Bun OS

Play's public browser gaming entry point belongs to the same WebOS build,
M3 application store, qualified Bun Engine packages and offline package manager.
The retired `play.aphrody.app` host is no longer routed.

`GET /api/emulation` and `/emulation/index.json` enumerate only the games in
the qualified product registry. Existing `/emulation/<core>/<file>` URLs read
the corresponding package's payload. They do not expose the raw build output
or unpublished core directories. Browser packages and their bundled open-source
fixtures are public and do not require a session or a private network address.
Local ROM uploads remain separate from publication. Owner-authorized proprietary
games use the separate rights catalog, pinned preparation and GPU qualification
gates before shared R2 publication; they are never described as open-source ROMs.

The native Gamescope owner remains
`infra/config/host/apps/vps/gaming/stream`. Run its `webos-gamescope.sh --check`
on the gaming host, then run it without arguments to launch Chromium in
Gamescope with the canonical Dust package. `BUN_OS_GAMING_URL` selects another
published package or a local development origin. This launcher uses the same
browser implementation as the public site; it does not create a second emulator.
It requires an installed Gamescope, Chromium and an existing graphical session.
The existing `entrypoint.sh` and `GAMESTREAM_APP` continue to own headless
Gamescope streaming. Actual compositor, WebGPU and remote-stream qualification
must be performed on the VPS; source integration is not a streaming receipt.

Play's Steam launch, owned-library upload, NGINX reload and desktop capture
remain operations of the existing backend. Public browser gaming does not
grant anonymous visitors access to those host-control operations.
