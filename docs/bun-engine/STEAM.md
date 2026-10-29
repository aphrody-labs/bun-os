# Bun Engine and Bun OS on Steam

Owners:

| Piece | Path |
| --- | --- |
| Steamworks SDK in the engine (feature `steam`) | `crates/bun-engine-core/src/steam/` |
| Bevy plugin (`bun_engine::steam::SteamPlugin`) | `crates/bun-engine-core/src/steam/plugin.rs` |
| Runtime glue (pause, pads, screenshots, Deck window) | `crates/bun-engine-core/src/runtime/steam.rs` |
| Steam sign-in for web apps | `packages/bun-steam/src/signin.ts` (`@aphrody/bun-steam/signin`) |
| Non-Steam shortcuts and real artwork | `packages/bun-engine/src/steam/{shortcuts,thumbnails}.ts` |
| Steam client configuration, VDF, Proton, steamcmd | `packages/bun-steam` (see `STEAM-PLATFORM.md`) |

Nothing here handles Steam credentials: the engine talks to the running Steam client through
`steam_api`, and web sign-in goes through Steam's own OpenID page.

## Steamworks in Bun Engine

Build: `bun scripts/cargo.ts exec -- build -p bun-engine --features steam`.
The SDK comes from steamworks-rs 0.13 (`steamworks`, `steamworks-sys`, MIT/Apache-2.0), which
bundles Valve's redistributable `steam_api64.dll` / `libsteam_api.so`. Ship that library next to
`bun-engine`. On Windows it is delay-loaded (`build.rs`), so a build with `steam` still starts
without it and the Steam commands report it missing.

### AppID

| AppID | Use |
| --- | --- |
| `480` (Spacewar) | Development default. Every account owns it; init, overlay, Rich Presence `status`, screenshots, Steam Input and Remote Storage work. Steam shows the user as playing "Spacewar". Cloud quota: **4096 bytes** in total. |
| Our own AppID | Required to ship: our store name, localized Rich Presence (`steam_display`), achievements, a real Steam Cloud quota and the Steam Input configuration published on the app. |

Select it with `--steam-appid N`, `--appid N` (subcommands) or `BUN_ENGINE_STEAM_APPID`. With AppID
480 (or `BUN_ENGINE_STEAM_DEV=1`) the engine writes `steam_appid.txt` next to the binary and never
asks Steam to relaunch it. With any other AppID it calls `SteamAPI_RestartAppIfNecessary` so a
copy started outside Steam relaunches through Steam.

Switching to a real AppID (Steamworks partner site):

1. Create the app; put its id in `BUN_ENGINE_STEAM_APPID` for builds and depots.
2. Steam Cloud: enable it, set the quota (bytes per user and file count) to cover battery saves and
   states (for example 256 MiB, 2000 files). The engine checks the quota before every write.
3. Rich Presence: upload a localization file with the token `#Status_Playing` (for example
   `"#Status_Playing" "Playing {%game%} on {%system%}"`); the engine already sets `steam_display`,
   `system` and `game` for every AppID other than 480.
4. Steam Input: upload `steam_input/bun_engine_actions.vdf` (generated) as the Input Action
   Manifest, or publish the generated per-controller configurations as official configurations.
5. Achievements and stats: define them in Steamworks; `bun-engine steam stats` lists them (stub,
   read-only).
6. Ship `steam_api64.dll` / `libsteam_api.so` in the depot next to `bun-engine`; do not ship
   `steam_appid.txt`.

### What the engine does under Steam

`bun-engine run <system> <image> --steam` builds the runtime's machine app and adds
`steam::SteamPlugin::new(steam::RunOptions, system, rom)`; any Bevy host can add the same plugin
(`SteamPlugin::bare` without a machine). The plugin only uses `crate::bevy::{app, ecs}`
(bevy-steamworks 0.17 targets Bevy 0.19); with `render`, `runtime::steam::SteamRuntimePlugin`
binds it to the runtime: `SteamPaused` -> `MachineStatus::paused`, `SteamKeys` ->
`ExternalPads["steam"]`, screenshot requests -> `view::capture_rgb(MachineSlot, MachineScreen)`,
`SteamLayout` -> the primary window.

| Feature | Implementation |
| --- | --- |
| Init | `SteamAPI_Init` before the window and GPU device exist, so the overlay can hook the swap chain. `ENABLE_VK_LAYER_VALVE_steam_overlay_1=1` is set for Vulkan; D3D12 is hooked by `gameoverlayrenderer64`. |
| Overlay-safe present | `GameOverlayActivated` sets `SteamPaused` (machine paused, Steam Input cleared) while Bevy keeps presenting every frame, so the overlay keeps drawing. Callbacks are pumped in `First` every frame. |
| Steam Input | Two action sets: `emulator` (A, B, X, Y, L, R, Start, Select, D-pad: one action per `machine::keys` bit) and `menu` (navigation, select, back) for the controller-first UI. `input::write_manifest` generates the Input Action Manifest, `game_actions_<appid>.vdf` (In-Game Actions) and one default configuration per controller family (Xbox One/360, PS4/PS5, Switch Pro, Steam Controller, Steam Deck, generic); the engine passes the manifest to `SetInputActionManifestFilePath`. With AppID 480 Steam keeps Spacewar's published manifest, so only the `menu_*` actions (which Spacewar also defines) resolve and they drive the machine (D-pad, A, B); the full `emulator` set needs our own AppID (or, for local development only, the generated `game_actions_<appid>.vdf` in Steam's `controller_config/`). Digital actions become `SteamPads` (XInput layout), `SteamKeys` (machine bits, OR-ed into `EngineInput` through `ExternalPads["steam"]`) and `SteamKeyEvent` messages. |
| Rich Presence | `system`, `game` and `status` ("Playing <game> on <SYSTEM>"); `steam_display = #Status_Playing` for real AppIDs. Cleared on exit. |
| Screenshots | `HookScreenshots(true)`: F12 (or `TriggerScreenshot`) sets `SteamScreenshotPending`; the host fills `SteamFrame` with the machine's own picture (RGB) in `SteamSystems::Capture`, and the plugin writes it through `WriteScreenshot` and tags it with `SetLocation` ("<game> (<SYSTEM>)"). |
| Steam Cloud | `ISteamRemoteStorage`. Saves live in `%LOCALAPPDATA%\Aphrody\bun-engine\saves\<rom-sha256>\` (`$XDG_DATA_HOME/aphrody/...` on Linux, `BUN_ENGINE_SAVES` overrides). The cloud mirrors them as `bun-engine/<rom-sha256>/<file>` with `bun-engine/manifest.json` (per ROM: title, system; per file: SHA-256, size, mtime, upload time). Equal hashes do nothing; otherwise the newer mtime wins. Every upload is read back and hash-checked; every write checks the 100 MiB file limit and the remaining quota. Sync runs before the machine boots and on `AppExit`; Bevy hosts can queue more work in `SteamCloudSync` (background thread, `SteamCloudSynced` messages). |
| Achievements/stats | Stub: `stats::achievements` lists what Steam declares for the AppID. Nothing is unlocked. |

### Commands

| Command | Does |
| --- | --- |
| `bun-engine steam status [--appid N]` | Init and report SteamID, login, overlay, Deck/Big Picture/gamescope, cloud quota. |
| `bun-engine steam presence <system> <game> [--hold S]` | Set Rich Presence and read it back from Steam. |
| `bun-engine steam cloud quota\|list\|roundtrip [--bytes N]` / `delete <file>...` | Quota, files, write/read/hash/delete round trip, delete cloud files. |
| `bun-engine steam cloud sync\|push\|pull <rom> [--system S] [--title T] [--dir D]` | Reconcile one ROM's saves. |
| `bun-engine steam input-manifest [--out DIR]` | Write the Steam Input manifest and configurations (no Steam needed). |
| `bun-engine steam input [--seconds S]` | Load the manifest, report handles and controllers, print held keys. |
| `bun-engine steam stats` | List achievements of the AppID. |
| `bun-engine steam install-shortcut [options]` / `uninstall-shortcut` | Non-Steam shortcuts (below). |
| `bun-engine run <system> <image> --steam [--steam-appid N] [--steam-title T] [--steam-no-cloud] [--steam-no-input] [--steam-overlay DIALOG --steam-overlay-after S] [--steam-screenshot-after S] [--steam-quit-after S]` | Play under Steam; the scripted flags drive unattended qualification. |

## Non-Steam shortcuts

`bun-engine steam install-shortcut` runs `packages/bun-engine/src/steam/shortcuts.ts install`
(found from the checkout or `BUN_OS_ROOT`) with `--engine` set to the running binary:

- a **Bun Engine** entry that opens the frontend (`bun packages/bun-engine/src/cli.ts frontend`);
- per-game entries from the bep library (`--game <id>`, `--system <id> [--limit N]`,
  `--favorites`) that run the native machine with `--steam --steam-title <title>` (BIOS arguments
  come from the frontend's own route resolution);
- tag `Bun Engine` on every entry; re-running replaces our entries and keeps everything else;
- real artwork only, copied unmodified into `userdata/<account>/config/grid/`: portrait
  `<id>p.png` = libretro `Named_Boxarts`, wide `<id>.png` = `Named_Titles`, hero `<id>_hero.png` =
  `Named_Snaps`, logo `<id>_logo.png` = `Named_Logos`, matched to the game's libretro-database
  title (exact name, else the same base title ranked by shared No-Intro tags). Thumbnails come from
  `thumbnails.libretro.com` (cached in `usr/var/cache/bep/thumbnails`) or a local
  libretro-thumbnails tree (`--thumbnails DIR`). The Bun Engine entry uses Bun's own logo
  (`assets/logo-square.png` of the abandoned fork (legacy `toolchains/bun`) icon, `logo@4x.png` logo). Nothing is generated: a slot
  without real art keeps Steam's default.

Shortcut ids follow Steam: `crc32(quoted exe + name) | 0x80000000`; `steam://rungameid/` takes
`(id << 32) | 0x02000000`.

The file is binary KeyValues written with `@aphrody/bun-steam` (`parseShortcuts`/`writeShortcuts`).
Steam rewrites `shortcuts.vdf` on exit, so the installer only writes while the client is closed:
`--close-steam` sends `steam -shutdown` (refused while Steam reports a running AppID) and
`--restart-steam` starts it again with `-silent`. The current file must round-trip byte for byte
through the writer, is backed up next to itself, replaced atomically (temporary file + rename),
re-read and compared (bytes, entry count, every foreign entry unchanged); the backup is deleted
once verified and restored if verification fails. `--dry-run` prints the plan.

## Steam Deck, SteamOS and gamescope

- Detection: `ISteamUtils::IsSteamRunningOnSteamDeck`, Big Picture, `GAMESCOPE_WAYLAND_DISPLAY`,
  `SteamDeck=1`, `SteamGamepadUI`, `XDG_CURRENT_DESKTOP=gamescope`.
- Layout: 1280x800 request, borderless fullscreen, FIFO present first (gamescope paces), hidden
  cursor; the `menu` action set is the controller-first path for frontends.
- On SteamOS run the Linux build (`libsteam_api.so` next to it) or the Windows build under Proton.

## Proton

The Windows build runs under Proton: `steam_api64.dll` talks to the Linux client through Proton's
`lsteamclient` bridge, D3D12 goes through vkd3d-proton and Vulkan is native, and the overlay is
Steam's Linux overlay (gamescope draws it in game mode). Add the Windows `bun-engine.exe` as a
non-Steam shortcut and force a Proton version in its compatibility settings (or set it with
`bun-steam`'s `setCompatTool`). XInput pads and Steam Input both work; the native Linux build is
preferred when available.

## Steam sign-in for web apps

Steam gives third parties OpenID 2.0; OAuth needs Valve partner approval.
`createSteamSignIn({ publicOrigin })` from `@aphrody/bun-steam/signin` returns Bun.serve routes:

| Route | Behaviour |
| --- | --- |
| `GET /auth/steam` | Redirect to `steamcommunity.com/openid/login`; a signed, 10-minute state cookie binds the attempt to the browser. |
| `GET /auth/steam/callback` | State cookie, exact `return_to`, `op_endpoint`, `claimed_id == identity`, signed field list, nonce freshness (5 min) and replay, then `check_authentication` server-side; the session cookie `__Host-steam` (HMAC-SHA256, HttpOnly, Secure, SameSite=Lax). |
| `GET /auth/steam/session` | SteamID64 and a session-bound CSRF token (`Bun.CSRF`). |
| `GET /auth/steam/profile` | `ISteamUser/GetPlayerSummaries`, `IPlayerService/GetOwnedGames`, `GetRecentlyPlayedGames` with a Web API key; without one, the public community profile XML (`source: "community-xml"`, `degraded: true`, no owned-games list). |
| `POST /auth/steam/logout` | Requires `x-csrf-token`. |

Secrets: the session key and the Web API key come from the OS credential store (`Bun.secrets`,
service `aphrody.steam`, names `session-key` and `web-api-key`; the session key is created on
first use), then `STEAM_SIGNIN_SESSION_KEY` / `STEAM_WEB_API_KEY`, or explicit options. Neither is
logged or returned. Options: `allow(steamId)` allow list, `afterLogin`, `sessionTtlSeconds`,
`nonces` (shared replay store for several processes), `onSignIn`.
