# Bun OS on Windows 11: architecture

Status 2026-11-03 (workstation: Windows 11 Pro Insider 10.0.28120, i7-13700F, RTX 4070, 32 GB). This page is the
target architecture of everything Bun OS puts on a Windows machine, one owner per layer, what was kept, replaced or
removed, and the ordered plan. The layer pages stay the detail: [WSL.md](WSL.md), [WSL-SERVICE.md](WSL-SERVICE.md),
[WSLG.md](WSLG.md), [WAYLAND-WINDOWS.md](WAYLAND-WINDOWS.md), [NTCORE.md](NTCORE.md),
[WINDOWS-DESKTOP.md](WINDOWS-DESKTOP.md), [WINDOWS-SHELL.md](WINDOWS-SHELL.md),
[WINDOWS-USERLAND.md](WINDOWS-USERLAND.md), [DOTNET-WINDOWS.md](DOTNET-WINDOWS.md),
[DESIGN-M3-WINDOWS.md](DESIGN-M3-WINDOWS.md), [DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md).

## Principle (owner, 2026-11-03)

> Remove from our stack everything that consumes resources. We were supposed to patch Windows and use its low-level
> features, not rebuild Windows on top of it.

So:

1. **Nothing of Bun OS is resident on Windows by default.** No logon autostart, no background watcher, no overlay, no
   bar, no wallpaper renderer. What must run (the WSL service, the NT bridge) is demand-started, has a written reason
   and a budget, and exits or idles at near zero.
2. **Windows renders the desktop.** The look (accent on title bars and borders, dark mode, Mica/Acrylic, rounded
   corners, wallpaper), window management (Snap layouts, Snap groups, virtual desktops) and the taskbar/Start come from
   Windows' own settings, written once by `bunos-win11 apply` from the tweak catalog, journaled and undoable.
3. **Deeper change goes through Windows' supported mechanisms:** policies and registry values, the OS theme engine
   (`.theme` files), Windows features, Win32/WinRT settings APIs, service trigger start, and the kernel driver only for
   what user mode cannot do. Never a parallel shell, never DLL injection into Explorer or DWM, never a patched system
   file.
4. **Anything Windows cannot do natively stays out** rather than becoming a resident process.

## Inventory (2026-11-03, after the reboot at 18:59)

Read-only queries on the workstation (services from the registry and SCM, `tasklist`, HKCU/HKLM `Run`, scheduled
tasks, `%SystemRoot%\BunOS`, PE resources through `bunos windows identity`).

| Component | Kind | Stack | Owner | State now | Flags |
| --- | --- | --- | --- | --- | --- |
| `BunOSWsl` (`bunos-wsl-service.exe instance`) | service, LocalSystem | Rust, windows-service | `crates/bunos-wsl-service` | demand start, stopped (was AUTO_START) | stop hung (fixed below); no icon/VERSIONINFO (fixed below); no manifest file |
| `BunOSWsl.docker.service`, `.containerd.service`, `.dm-event.service` | services | same binary | same | demand, stopped | `Stop-Service` hung (fixed below) |
| `BunOSWinBridge` (`bunos-winbridge.exe service`) | service, LocalSystem | Rust | `crates/bunos-nt-bridge` | demand, stopped | 15 MB binary; no icon/VERSIONINFO |
| `BunOS` (bunos.sys) | kernel driver | Rust/C, WDK | `crates/bunos-nt-driver` | not installed (Secure Boot blocks test signing) | needs attestation signing |
| GlazeWM + watcher, tacky-borders, AltSnap, Flow Launcher, `bunos-win11-chrome watch`, `bunos-win11-wallpaper` | per-user processes from `HKCU\...\Run\BunOS.Desktop` = `bun C:\src\bun-os\factory\windows\desktop\hyprland.ts up` | Rust, C, C#, wgpu | `factory/windows/desktop` | **removed** (Run value deleted by the coordinator, backup `%TEMP%\claude\run-before.reg`) | autostart ran a script from the dev checkout; wallpaper 16 % of a core and 188 MB, tacky-borders 10 % of a core over 5 s idle; overlay windows |
| Zebar (Tauri WebView2 bar), waku (Qt bar) | bar | HTML/JS in WebView2; C++/Qt | `vendor/zebar`, `vendor/waku` | **removed** | WebView in a shell part (rejected); dangling `vendor/zebar` gitlink |
| Explorer pane "Bun OS (Linux)" (`HKCU\Software\Classes\CLSID\{b05e05de-...-1102}` → `\\wsl.localhost\bunos`) | shell namespace | registry only | `factory/windows/shell` (`navpane`) | disabled by the coordinator | **woke the WSL VM at every logon** (Explorer enumerates the pane; the P9 redirector starts the distro), and `instanceIdleTimeout=-1` then kept the 1.6 GB VM up until shutdown |
| `.wslconfig` (`[general] instanceIdleTimeout=-1`) | WSL config | INI | `factory/wsl/windows` | still on the host | made every accidental wake permanent (fixed in the template and merge below) |
| `%SystemRoot%\BunOS\bin` (bunos, nu, rio, cosmic-files, win, nu_plugin_windows, docker, bunos-nt, bunos-winbridge) | files | Rust/Go | shell, wsl, nt installers | installed | 7 of 9 lack icon and VERSIONINFO; only bunos.exe has an application manifest |
| `%SystemRoot%\BunOS\userland` (uutils, brush, helix; 1037 files) | files + **links in System32** | Rust | `factory/windows/userland` | installed | `linkDir = C:\WINDOWS\System32`: commands are linked into System32 (should be a PATH entry; see plan) |
| `%SystemRoot%\BunOS\dotnet-windows` (538 files) | files | .NET 10 / C++ | `packages/bun-dotnet-windows` | installed | — |
| `%SystemRoot%\BunOS\wsl` (bzImage, modules.vhdx, bunos-wsl.wsl, templates) | files | — | `factory/wsl/windows` | installed | — |
| `%SystemRoot%\BunOS\icons\bunos-icons.dll`, `share\*`, `bridge.token`, `userland\*.ps1` | files | — | design, shell, nt | installed | in no manifest (7 orphans) |
| Manifests `manifests\{wsl,nt,shell,bun-dotnet-windows}.json`, `userland\install-record.json` | records | JSON | five installers | 4 different schema-1 shapes | no shared schema, no single uninstall, no record for wsl-service or icons |
| Shell integration: WT fragment + `defaultProfile` nushell, `.nu`/`.sh` classes, "Open in Rio/COSMIC Files" verbs, Material icons (HKCU and `HKLM\...\Shell Icons`) | registry | — | `factory/windows/shell` | enabled | journaled, reversible |
| `BunOS-Sync` scheduled task | task | Bun | `factory/sync` | ready | conhost --headless; OK (ops) |
| Agent tooling: 50 `bun.exe` MCP servers (6 kinds x ~8 sessions), 7 `cua-driver.exe mcp`, 6-10 `aphrody.exe mcp` | per-session children of Claude/Codex | Bun, Rust | agent harness, not Bun OS | running | duplicated per agent session; not Bun OS product, but the largest resident cost on the host (see "Agent processes") |

WebView/HTML in shell parts: Zebar only (removed). Polling: `BunOSWsl` checked for `msrdc.exe` in session 0 every 5 s
(stays, cheap, but see the WSLg plan); the unit proxies poll the registry every 1 s (cheap). Without uninstall path:
`bunos-wsl-service` had one (`uninstall`) but no manifest; the icons DLL and `share\` files had none. Duplicates:
`nu.exe` in both `bin\` and `userland\`; four manifest shapes.

### What started the `bunos` distro after the reboot

`BunOSWsl` was demand/stopped and no task or Run value starts WSL. The VM came up at 18:59:41, 12 s after boot and
before the agent sessions, with `wslhost.exe` in session 1. The only logon-time consumer of the distro was Explorer's
pinned "Bun OS (Linux)" pane entry targeting `\\wsl.localhost\bunos`: enumerating the navigation pane resolves the
folder, and the WSL P9 redirector starts the distro to serve it. `instanceIdleTimeout=-1` then kept it. Later wakes
come from the owner's Codex session running `bun test` through `wsl.exe` (left alone). Fixes: `navpane` is opt-in in
`bunos-shell.ts` (default components no longer include it), the template has no `-1`, and the installer drops a
`-1` it wrote earlier.

## Target architecture, one owner per layer

| Layer | Owner | Keep | Replace / remove |
| --- | --- | --- | --- |
| WSL lifecycle | WSL itself (`WslService`, `.wslconfig`, `wsl --manage`) + `crates/bunos-wsl-service` for SCM integration | WSL 2, our kernel via `kernel=`, the `.wsl` distribution file, `BunOSWsl` as an **on-demand** owner of keep-alive | `instanceIdleTimeout=-1` (removed); AUTO_START default (now `--boot` opt-in); session-0 starts (the service prefers the interactive token; never start the VM from session 0 when a desktop exists) |
| Linux GUI | WSLg (stock) now; `crates/bunos-wayland-win` (DirectComposition flip-model presenter) as the native path | WSLg until the presenter is qualified; the presenter configures on every Windows resize and is not capped at 60 Hz | the WSLg system-distro override (back to stock); RAIL resize helper not written (the presenter solves it) |
| Look and window management | Windows (DWM, Explorer) configured by `bunos-win11` from `packages/bun-windows-winclean/catalog/tweaks.toml` | Snap layouts/groups, virtual desktops, accent, dark mode, Mica/Acrylic, rounded corners, transparency, static wallpaper | GlazeWM, tacky-borders, AltSnap, Flow Launcher, Zebar, waku, `bunos-win11-chrome watch`, the traffic-light overlay, `bunos-win11-wallpaper` (all retired) |
| Window chrome of our own windows | the app (libcosmic/iced; `bunos-wayland-win` uses `bunos-win11-chrome` as a library) | DWM attributes on windows we own (`DWMWA_SYSTEMBACKDROP_TYPE`, `DWMWA_WINDOW_CORNER_PREFERENCE`, `DWMWA_CAPTION_COLOR`, `DWMWA_BORDER_COLOR`); custom caption buttons drawn **inside our own windows** with `WM_NCHITTEST` returning `HTCLOSE`/`HTMAXBUTTON` so Snap layouts still work | caption buttons on other apps' windows (impossible without injection or overlays; dropped) |
| Shell | Explorer, taskbar, Start, Windows Terminal | WT fragment profile (nushell), file associations and verbs, Material icons through `Shell Icons` and `DefaultIcon` | any replacement shell, bar or dock; Explorer is never replaced |
| Services | SCM | trigger/demand start, short checkpointed pending states, bounded stops, recovery actions, preshutdown | AUTO_START by default; one long frozen wait hint |
| Installers and manifests | `bunos windows` (`packages/bunos-run/src/windows.ts`) over the per-component installers | one manifest schema (version 2, below), one `status`, one `uninstall` | four ad-hoc schema-1 shapes (read by the normaliser until each writer moves to v2) |
| Identity | `crates/bunos-winres` (Rust `build.rs`), the C#/C++ equivalents per member | icon, VERSIONINFO (company Aphrody), application manifest (per-monitor-v2, long paths, UTF-8, segment heap, supportedOS Windows 10/11) on every binary; `bunos windows identity` gate | binaries without resources (7 of 9 in `bin\`) |
| Kernel driver | `crates/bunos-nt-driver` | only for what user mode cannot do | test signing (blocked by Secure Boot); path is attestation signing |
| CLI userland | `factory/windows/userland` | uutils, brush, nushell, `nu_plugin_windows` | links into `System32` (move to a PATH directory) |

## Stability fixes made in this change (repo)

- **No hanging stops.** `bunos-wsl-service` unit services used one `STOP_PENDING` with a 100 s wait hint and a frozen
  checkpoint while a blocking `systemctl stop` ran through `wsl.exe`; a stuck stop job, or a wsl.exe relay that kept the
  pipes open after exit (the reader threads were joined unbounded), left `Stop-Service` waiting forever. Now:
  `src/pending.rs` reports `*_PENDING` with a 5 s hint and bumps the checkpoint every second for as long as the work
  runs (start and stop, unit and instance services); the unit stop is `systemctl stop --no-block` followed by a wait
  for the published unit state, bounded by `Parameters\StopTimeoutS` (default 90 s, systemd's `DefaultTimeoutStopSec`),
  after which the service reports STOPPED with service-specific code 4 and systemd finishes the stop; `wsl.exe` output
  readers get a 2 s grace after the process exits and are then abandoned. Microsoft's rule: a pending state must keep
  its checkpoint moving within the wait hint
  ([Service status transitions](https://learn.microsoft.com/windows/win32/services/service-status-transitions)).
- **On demand, not at boot.** `bunos-wsl-service install` registers `BunOSWsl` as demand start; `--boot` restores
  AUTO_START for a host that wants the distro before logon. The next step is a trigger start (below).
- **No permanent VM after an accidental wake.** `.wslconfig` template without `instanceIdleTimeout=-1`;
  `install.ts` `mergeIni` drops the `-1` an earlier bundle wrote (a user's own value is kept; tested).
- **No orphan processes.** The resident desktop stack and its autostart are gone from the repository
  (`factory/windows/desktop/hyprland.ts` deleted, `bunos-shell.ts` `wm` retired to an undo-only component,
  `bunos-win11-chrome watch` and the overlay removed). `bunos windows status` exits 1 and names any retired process
  still running.
- **One view, one uninstall.** `bunos windows status [--json] [--deep]` reads every manifest (normalising the four
  schema-1 shapes), checks each file, lists Bun OS services with their start type, Bun OS autostarts, retired
  processes, budgeted residents and files in no manifest. `bunos windows uninstall <component>..|--all [--yes]` prints
  (or runs, through `sudo.exe`) each component's own uninstaller in reverse dependency order: wsl-service, bunos-shell,
  bun-dotnet-windows, userland, nt, wsl.

## Manifest schema 2

Every installer writes `%SystemRoot%\BunOS\manifests\<component>.json`:

```json
{
  "schema": 2,
  "component": "bunos-shell",
  "installedAt": "2026-11-03T07:47:15Z",
  "revision": "<git sha>",
  "root": "C:\\Windows\\BunOS",
  "files": [{ "path": "...", "sha256": "...", "size": 0, "sourceSha256": "...", "spdx": "Apache-2.0", "signer": "<thumbprint>" }],
  "services": ["BunOSWsl"],
  "uninstall": ["{root}\\wsl-service\\bunos-wsl-service.exe", "uninstall"]
}
```

The TypeScript type and the schema-1 normaliser are `Manifest` / `normalize` in `packages/bunos-run/src/windows.ts`.
Writers move to v2 one by one (`setup-elevated.ps1` x2, `bunos-shell.ts`, `install.ts` of bun-dotnet-windows,
`install-system.ps1`, and a new record for `bunos-wsl-service install` and the icons DLL); until then the normaliser
reads them. Packaging decision: **no MSIX for the system part.** MSIX cannot install kernel drivers, cannot put files
under `%SystemRoot%`, and its service support (`desktop6:Service`) runs services from the package's own directory
with package identity, which conflicts with a LocalSystem service that must not run from a user-writable path and
with a WSL kernel referenced by `.wslconfig`. A winget manifest (one `InstallerType: exe` pointing at a signed
self-extracting `bunos-setup.exe` that runs the component installers and writes the v2 manifests) is the distribution
form, with `bunos windows uninstall --all --yes` as its uninstall command and an `HKLM\...\Uninstall\BunOS` entry
(`DisplayIcon`, `Publisher` Aphrody, `DisplayVersion`). Apps of our own with a UI that need package identity
(notifications, share target) get a sparse package (identity for an unpackaged exe) rather than full MSIX.

## Identity

`crates/bunos-winres` is a `build.rs` helper (its own workspace, so non-member crates use it without touching the root
lock): `bunos_winres::Identity::from_env("<product>").icon_role("<role>").embed(extra_rc)`. It writes one resource
script with `ICON 1` (design artifact `icons/windows/ico/<theme>/app-<role>.ico` under `BUNOS_DESIGN_DIR`, else the
repository's `factory/wsl/bunos.ico`), `VERSIONINFO` from Cargo (version, description, licence; company Aphrody) and
the application manifest (PerMonitorV2, `longPathAware`, `activeCodePage` UTF-8, `heapType` SegmentHeap,
`supportedOS` Windows 10/11, Common Controls v6 for GUI binaries, `asInvoker`). `BUNOS_REQUIRE_WINRES=1` (release
lanes) turns a missing icon or resource compiler into a build error. `bunos-wsl-service` uses it now (its message
table goes into the same script). The check is `bunos windows identity <exe>..` (exit 1 when icon or VERSIONINFO is
missing); state on the workstation:

| Binary | Icon | VERSIONINFO | Manifest |
| --- | --- | --- | --- |
| bunos.exe | yes | yes | yes |
| nu.exe, rio.exe | yes | yes | no |
| bunos-nt.exe, bunos-winbridge.exe, cosmic-files.exe, docker.exe, nu_plugin_windows.exe, win.exe, bunos-wsl-service.exe (installed build), userland coreutils.exe | no | no | no |

Next members to adopt it: `crates/bunos-nt-bridge` (bunos-winbridge), `crates/bunos-nt-client` (bunos-nt),
`crates/nu_plugin_windows` (both bins), the COSMIC Files fork (through its own `build.rs`), the userland build
(`factory/windows/userland/build.ts` passes `BUNOS_DESIGN_DIR`). C#/.NET members set `ApplicationIcon`,
`Version`/`Company`/`Product` and `app.manifest` in `Directory.Build.props`; C++ members include the same generated
`.rc`. Start menu shortcuts carry `System.AppUserModel.ID = Aphrody.BunOS.<app>` and the same icon.

## Resource budgets

| Kind | Idle CPU | Private memory | Wakeups | Start |
| --- | --- | --- | --- | --- |
| Background service (BunOSWsl, unit proxies, winbridge) | < 0.1 % of one core | < 10 MB (winbridge < 30 MB) | event-driven; at most one 1 s timer | demand or trigger |
| One-shot tool (bunos-win11, bunos windows, installers) | 0 after exit | — | — | user |
| Interactive app of ours (COSMIC Files, Rio, nu) | < 0.5 % when idle | < 80 MB idle | no polling | user |
| WSL VM | 0 when nothing uses it | `memory=` cap; returns cache (`autoMemoryReclaim`) | — | on use, idles out (15 s / 60 s defaults) |

Measured (2026-11-03): `bunos-wsl-service.exe` 6-7 MB working set, 1.1-1.3 MB private per process; keeper `wsl.exe`
1.4 MB private; `vmmemWSL` 1.6-1.8 GB with Docker and Waydroid up. Retired for breaking the budget: the wallpaper
(about 16 % of one core, 188 MB: a vsync render loop with no pause when occluded, no message pump), tacky-borders
(about 10 % of one core: a continuous border-angle animation). Measurements of idle CPU, handles and wakeups per
component before and after the native settings wait for the workstation to be running (see "Workstation steps").

### Agent processes (not product, largest cost)

Each agent session starts its own MCP servers: about 6 `bun.exe` servers (rea, blender, chrome-devtools, playwright,
openpets, ai-hist), one `cua-driver.exe mcp` and one `aphrody.exe mcp` per session, so 8 sessions mean 50 `bun.exe`,
7 `cua-driver.exe` and 6-10 `aphrody.exe`. They are children of the agent hosts and end with them; nothing in Bun OS
spawns `cua-driver` overlays. The fix belongs to the harness configuration: one shared MCP endpoint per host
(`aphrody mcp` already serves HTTP through the "Aphrody MCP HTTP" task) instead of one stdio server per session.

## Replacement path

Bun OS apps replace a Windows default only behind a gate, and only through defaults Windows itself exposes (file
associations, shell verbs, the Windows Terminal default profile); no Windows file is deleted, renamed or patched, and
every switch is off until its gate passes. The catalog is `factory/windows/replace/apps.json`; the switch is
`bunos windows replace [<app> [status|on|off|record k=v..]] [--force]`, evidence lives in
`%LOCALAPPDATA%\bunos\replace\gates.json`.

| App | Windows counterpart | Switch | Gate (default unless noted) |
| --- | --- | --- | --- |
| files: COSMIC Files | Explorer folder windows | `bunos-shell.ts files-default` (folder `open` verb) | 14 crash-free days, startup <= 1.5 s, idle CPU <= 0.5 %, <= 80 MB private, parity list (IFileOperation, Recycle Bin, Explorer menu, properties, thumbnails, network/WSL locations, drag and drop, UIA) |
| terminal: nushell | cmd/PowerShell as WT default profile | `bunos-shell.ts terminal` | as above, startup <= 0.5 s, <= 60 MB |
| rio: Rio | Windows Terminal/conhost as console host | none until Rio implements `ITerminalHandoff` | — |
| userland | System32 tools | none: PATH order only, never shadowing System32 | — |
| window management, bar, launcher | Snap/virtual desktops, taskbar, Start search | none: Windows' own is the pick | — |
| tweaks: bunos-win11 | Settings | none: complement | — |

`record` takes `since=`, `crash=now`, `startupMs=`, `idleCpuPct=`, `privateMB=`, `parity="<item>"`; `on` refuses
while any condition fails (exit 3) unless `--force`.

## Native settings that replace the resident stack

Catalog module `look` (all HKCU, journaled, `bunos-win11 undo` restores each value; the live apply broadcasts
`WM_SETTINGCHANGE` `ImmersiveColorSet`/`WindowsThemeElement` and calls `SPI_SETDESKWALLPAPER`, so no logoff):

| Tweak | Values | Replaces |
| --- | --- | --- |
| `look.accent` | `DWM\AccentColor` 0xFF7A3444 (the menu colour Windows converges to), AutoColorization 0 so it is not re-derived from the wallpaper, `ColorizationColor`/`ColorizationAfterglow` 0xC444347A, `DWM\ColorPrevalence` 1 (accent on title bars and window borders), `Explorer\Accent\AccentColorMenu`/`StartColorMenu`/`AccentPalette` (8-tone palette from the seed #5b45a2), `Personalize\ColorPrevalence` 0 | tacky-borders, chrome watcher |
| `look.transparency` | `Personalize\EnableTransparency` 1 | the glass profile |
| `look.wallpaper` | `Control Panel\Desktop\Wallpaper` = `%SystemRoot%\BunOS\share\wallpaper\bunos-dusk-3840x2160.png` (REG_EXPAND_SZ), `WallpaperStyle` 10 (fill), `TileWallpaper` 0 | bunos-win11-wallpaper |
| `look.snap` | `WindowArrangementActive` 1, `SnapAssist`, `EnableSnapAssistFlyout`, `EnableSnapBar`, `EnableTaskGroups` 1 | GlazeWM, AltSnap |
| `look.virtual-desktops` | `VirtualDesktopTaskbarFilter`, `VirtualDesktopAltTabFilter` 1 | GlazeWM workspaces |
| `look.animations` (opt-in, excluded: animations are off on this latency-tuned host) | `WindowMetrics\MinAnimate`, `TaskbarAnimations`, `EnableAeroPeek` | GlazeWM animations |
| `performance.game-mode`, `performance.hags`, `performance.mmcss` | Game Mode on, `HwSchMode` 2, MMCSS 10 % and Games High | latency tuning |
| existing `shell.*` | dark mode, taskbar declutter (Widgets, Task View, Chat, search icon), Start declutter, Explorer defaults, taskbar left (standard) | waku/Zebar, Flow Launcher (Start search stays) |

Rounded corners and Mica are Windows 11 defaults for every app that opts in; nothing to set. Deeper theming, when
wanted, is a `.theme` file applied through the OS theme engine (`%LOCALAPPDATA%\Microsoft\Windows\Themes`), never a
patched `.msstyles`. Profile: `bunos-win11 desktop windows-native`.

## Research notes (what the native path is, with sources)

- **Service trigger start** instead of autostart: a service registers `SERVICE_CONFIG_TRIGGER_INFO`; triggers include
  a named-pipe open (`NAMED_PIPE_EVENT_GUID`, start only), an RPC endpoint request, device arrival, IP availability,
  group policy and custom ETW events ([Service Trigger Events](https://learn.microsoft.com/windows/win32/services/service-trigger-events),
  [SERVICE_TRIGGER](https://learn.microsoft.com/windows/win32/api/winsvc/ns-winsvc-service_trigger)). Plan: `BunOSWsl`
  and `BunOSWinBridge` get a named-pipe trigger (`\\.\pipe\bunos-wsl`, `\\.\pipe\bunos-winbridge`) that `bunos` opens
  when it needs them, and stop themselves after an idle period.
- **WSL plugins** (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss\Plugins`): a DLL loaded into WslService that is
  called when the VM and each distro start and can run processes in the VM root namespace over hvsocket; it must be
  signed (test signing needs Secure Boot off), runs in WslService's address space (a crash takes WSL down) and its
  hooks are synchronous ([WSL Plugins](https://learn.microsoft.com/windows/wsl/wsl-plugins)). It is the supported
  place for "do X when the Bun OS VM starts" without a resident keeper, once we have a production signature.
- **Driver signing with Secure Boot on:** Windows loads new kernel drivers only when signed through the Hardware Dev
  Center; attestation signing (no HLK) needs a Partner Center account with an **EV code-signing certificate**, works on
  Windows 10/11 desktop, and is not distributed by Windows Update to retail
  ([Driver signing policy](https://learn.microsoft.com/windows-hardware/drivers/install/kernel-mode-code-signing-policy--windows-vista-and-later-),
  [Attestation signing](https://learn.microsoft.com/windows-hardware/drivers/dashboard/code-signing-attestation),
  [EV requirement](https://learn.microsoft.com/windows-hardware/drivers/dashboard/code-signing-reqs)). Test signing
  requires Secure Boot off ([preproduction drivers](https://learn.microsoft.com/windows-hardware/drivers/install/preproduction-driver-signing-and-install)).
  Until there is an EV certificate (a purchase, owner action), the driver stays staged and unloaded and every feature
  that has a user-mode route uses it.
- **Window chrome without injection:** `DwmSetWindowAttribute` covers backdrop, corners, caption/border/text colour for
  windows a process owns ([DWMWINDOWATTRIBUTE](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute));
  other processes' windows can only be changed by a resident hook or injection, which this architecture excludes. The
  global accent on all title bars and borders is the user setting `DWM\ColorPrevalence`.
- **Linux GUI presentation:** DXGI flip model with a composition swap chain and DirectComposition is the low-latency,
  any-refresh path ([flip model](https://learn.microsoft.com/windows/win32/direct3ddxgi/dxgi-flip-model)), which is what
  `bunos-wayland-win` uses; WSLg presents through RDP RAIL, whose client does not forward Windows-side resizes
  ([WSLG.md](WSLG.md)).

## Native Windows mechanisms (deep research, 2026-11-03)

For every layer the retired stack used to cover: the Windows mechanism, the exact keys or APIs, what it cannot do,
and the source (Microsoft Learn unless noted). "Applied" names the catalog tweak that sets it; "not applied" says why.

### Accent colour, window borders, title bars

- Two user settings, both documented: `HKCU\Software\Microsoft\Windows\DWM\ColorPrevalence` ("show accent colour on title bars and
  window borders") and `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\ColorPrevalence` ("on Start and taskbar");
  `Control Panel\Desktop\AutoColorization` chooses wallpaper-derived or manual colour
  ([Settings reference](https://learn.microsoft.com/windows/apps/develop/settings/settings-common#personalization---colors)).
  The accent itself lives in `DWM\AccentColor`, `ColorizationColor`, `Explorer\Accent\AccentPalette` (8 tones). Applied: `look.accent`.
- Since the July 2025 servicing update Windows only offers the Start/taskbar accent in dark mode
  ([Q&A](https://learn.microsoft.com/answers/a/8262376)); the profile keeps dark mode on and the taskbar accent off.
- Fleet enforcement without a script: the ADMX policy "Force a specific background and accent color"
  (`CPL_Personalization_PersonalColors`, Computer Configuration, needs 2:1 contrast with white text)
  ([ADMX_ControlPanelDisplay](https://learn.microsoft.com/windows/client-management/mdm/policy-csp-admx-controlpaneldisplay)).
  Not applied: it locks the user out of changing the colour.
- Per-window colours (`DWMWA_BORDER_COLOR`, `DWMWA_CAPTION_COLOR`, `DWMWA_TEXT_COLOR`, Windows 11 build 22000+) exist but a process
  can only set them on windows it owns ([DWMWINDOWATTRIBUTE](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)).
  That is why a global per-window theme needed a resident hook, and why it is gone.

### Transparency, Mica and Acrylic

- `Personalize\EnableTransparency` is the single switch (Settings > Personalization > Colors); apps read it as
  `UISettings.AdvancedEffectsEnabled` ([tailoring effects](https://learn.microsoft.com/windows/apps/develop/composition/composition-tailoring)).
  Applied: `look.transparency`.
- Mica and Acrylic are opt-in per app: `DWMWA_SYSTEMBACKDROP_TYPE` (build 22621+: `DWMSBT_MAINWINDOW` = Mica,
  `TRANSIENTWINDOW` = Acrylic, `TABBEDWINDOW` = Mica Alt) or `Window.SystemBackdrop` in WinUI
  ([DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type),
  [system backdrops](https://learn.microsoft.com/windows/apps/develop/ui/system-backdrops)). Mica samples the wallpaper once, so it is
  the cheap material; Acrylic is for transient surfaces. There is no policy that forces a backdrop onto apps that did not
  opt in, so Win32 apps with an opaque client area stay opaque (documented behaviour). Our own windows
  (`bunos-wayland-win`, `bunos-win11-chrome` as a library) opt in.

### Animations

- `SPI_SETCLIENTAREAANIMATION` (client-area animations), `SPI_SETANIMATION` / `ANIMATIONINFO.iMinAnimate`
  (minimise/restore, persisted as `Control Panel\Desktop\WindowMetrics\MinAnimate`), UWP/WinUI read `UISettings.AnimationsEnabled`
  (Settings > Accessibility > Visual effects) ([client area animation](https://learn.microsoft.com/windows/win32/winauto/client-area-animation),
  [SystemParametersInfo](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-systemparametersinfow)).
  `UISettingsController.SetAnimationsEnabled` is IoT-only (needs the `systemManagement` capability).
  This host has them **off** (`MinAnimate=0`, `TaskbarAnimations=0`), a latency choice; `look.animations` exists but is excluded from the profile.
  Windows has no way to restyle the animations themselves; Hyprland-style curves were only possible with a resident compositor hook.

### Snap layouts, snap groups, virtual desktops

- Settings > System > Multitasking: snap windows, layouts on maximise hover (`Win+Z`), layouts by dragging to the top (22H2+),
  snap groups in the taskbar and Alt+Tab, "suggest what to snap next"; separate switches for desktops (taskbar and Alt+Tab show
  all or only the current desktop) ([Windows 11 overview](https://learn.microsoft.com/windows/whats-new/windows-11-overview#customize-the-desktop-experience),
  [settings catalog](https://learn.microsoft.com/windows/configuration/windows-backup/catalog#system)). Apps with a custom title bar must answer
  `WM_NCHITTEST` with `HTMAXBUTTON` and support a minimum width of at most 500 epx to snap properly
  ([snap layout support](https://learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)). Applied: `look.snap`, `look.virtual-desktops`.
- Programmatic placement is `SPI_SETDOCKMOVING`, `SPI_SETDRAGFROMMAXIMIZE` (need `SPI_GETWINARRANGING`); the only documented
  virtual-desktop API is the read-only `IVirtualDesktopManager` per-window query, so Bun OS does not move windows between desktops.

### Wallpaper and themes

- Registry plus `SPI_SETDESKWALLPAPER` (what `look.wallpaper` does) or, better for multi-monitor, `IDesktopWallpaper`
  (Windows 8+: per-monitor `SetWallpaper`, `SetPosition` fill/fit/span, background colour, slideshow)
  ([IDesktopWallpaper](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper)). Follow-up: a WinClean
  `desktop_wallpaper` tool over that interface so each monitor can have its own image.
- `.theme` files are the supported way to ship a complete look (colours, wallpaper, sounds, cursors, visual style):
  an INI with `[MasterThemeSelector] MTSM=DABJDKT`, installed under `%LOCALAPPDATA%\Microsoft\Windows\Themes`; `ShellExecute` on it opens
  Personalization on that theme. It cannot be the OS default, remote resources are blocked unless `EnableThemeFileRemoteResource`, and
  the policy "Load a specific theme" applies one at first logon only
  ([theme file format](https://learn.microsoft.com/windows/win32/controls/themesfileformat-overview),
  [CPL_Personalization_SetTheme](https://learn.microsoft.com/windows/client-management/mdm/policy-csp-admx-controlpaneldisplay)). For images and ISOs the
  unattend `Themes` block (`DesktopBackground`, `ThemeName`, `WindowColor`, `UWPAppsUseLightTheme`) sets the default theme
  ([Themes](https://learn.microsoft.com/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-themes)).

### Power, GPU scheduling, Game Mode, scheduler

- **Power plan:** `powercfg /setactive`, `/duplicatescheme`, `/setacvalueindex`; overlay schemes may only change the processor
  (`SUB_PROCESSOR`) and graphics (`SUB_GRAPHICS`) subgroups; `PERFBOOSTMODE` (hidden, GUID be337238-0d82-4146-a960-4f3749d470c7)
  selects disabled/enabled/aggressive boost ([powercfg](https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options),
  [PERFBOOSTMODE](https://learn.microsoft.com/windows-hardware/customize/power-settings/options-for-perf-state-engine-perfboostmode)).
  High performance (8c5e7fda-...) is already the active plan on this host (applied by an earlier run), so `performance.power-plan` is a no-op here.
  An Ultimate Performance clone needs `powercfg /duplicatescheme` first, which the journal engine has no operation for; not applied.
- **Hardware-accelerated GPU scheduling:** `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode` (2 = on); the key is the DxgKrnl
  override location ([DxgKrnl configuration](https://learn.microsoft.com/windows-hardware/drivers/display/dxgkrnl-configuration)); the value semantics come from the
  Settings UI (Graphics > Default graphics settings), not from a Learn page. Read live: already 2. Catalog: `performance.hags` (idempotent; reboot to change).
- **Game Mode:** `HKCU\Software\Microsoft\GameBar\AutoGameModeEnabled` is documented
  ([Settings reference](https://learn.microsoft.com/windows/apps/develop/settings/settings-windows-11#gaming-game-bar,-game-mode,-gaming-shortcuts));
  already 1. Catalog: `performance.game-mode`; `performance.game-dvr` (existing) keeps background recording off.
- **Timer resolution:** since Windows 10 2004 `timeBeginPeriod` is per process, and on Windows 11 a fully occluded, minimised or silent
  process loses the request; `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION` opts a process out explicitly. A machine-wide tick therefore
  buys nothing and costs idle power. Not applied; apps that need 1 ms ask for it ([timeBeginPeriod](https://learn.microsoft.com/windows/win32/api/timeapi/nf-timeapi-timebeginperiod),
  [SetProcessInformation](https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)). Audit with
  `pwrtest /timer` ([PwrTest](https://learn.microsoft.com/windows-hardware/drivers/devtest/pwrtest-timer-scenario)) and `powercfg /energy`.
- **QoS / EcoQoS:** Windows classifies processes by focus, visibility and audibility (in focus High, visible Medium, minimised or fully occluded Low) and
  `PROCESS_POWER_THROTTLING_EXECUTION_SPEED` marks background work as EcoQoS (efficiency cores, lower clocks)
  ([Quality of Service](https://learn.microsoft.com/windows/win32/procthread/quality-of-service)). Rule for Bun OS binaries: background services call
  `SetProcessInformation(ProcessPowerThrottling)` at start; the Rust helper is a follow-up in `bunos-winres`-style shared code.
- **MMCSS:** `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile` `SystemResponsiveness` is the percentage kept for
  low-priority work (default 20; rounded down to a multiple of 10; below 10 or above 100 is read as 20; 100 disables MMCSS) and `Tasks\Games`
  holds `Scheduling Category`, `Priority`, `SFIO Priority`, `GPU Priority`; High-category threads run at priority 23-26
  ([MMCSS](https://learn.microsoft.com/windows/win32/procthread/multimedia-class-scheduler-service)). Catalog: `performance.mmcss` (10 %, Games High / 6 / High).
- **Processor scheduling (`Win32PrioritySeparation`):** Learn describes the model (client quantum is short, the foreground thread gets a longer one;
  priority boosts for foreground and input, [scheduling](https://learn.microsoft.com/windows/win32/procthread/scheduling)) but documents no client
  values for the registry value. Not applied; unverified claims in tuning guides are not a basis for a journaled change.

### Startup apps and Task Scheduler

- Startup apps are the `Run`/`RunOnce` keys (HKLM, HKCU, WOW64) and the Startup folders; Task Manager's Startup tab and
  `ms-settings:startupapps` let the user disable them and rate impact (high: more than 1 s CPU or 3 MB disk I/O); Windows may delay Run entries
  ([startup apps](https://learn.microsoft.com/windows/win32/w8cookbook/startup-apps), [Run keys](https://learn.microsoft.com/windows/win32/setupapi/run-and-runonce-registry-keys)).
  Packaged apps declare `uap5:StartupTask` with `UserConfigurable`. Anything needing elevation can only start from a Task Scheduler logon trigger.
  Rule: **Bun OS registers no startup entry**; the only owner-visible entries left are the owner's (LGHUB, Steam, Google, Gemini, Realtek, Edge update),
  which the profile never touches. Policy `LetAppsRunInBackground` (AppPrivacy, 2 = deny) only governs UWP apps and breaks notifications; not applied.
- Task Scheduler idle detection (CPU and disk below 80-90 % for a window) is what to use for any future maintenance job
  ([idle conditions](https://learn.microsoft.com/windows/win32/taskschd/task-idle-conditions), [trigger types](https://learn.microsoft.com/windows/win32/taskschd/trigger-types)).
  The only Bun OS task is `BunOS-Sync` (headless, on a schedule).

### Measuring (ETW and WPR)

- `wpr.exe` ships with Windows 8.1+; profiles are ETW provider sets ([WPR](https://learn.microsoft.com/windows-hardware/test/wpt/introduction-to-wpr)).
  Protocol for the budgets: `wpr -start CPU -filemode`, 60 s idle, `wpr -stop idle.etl`, open in WPA (CPU Usage Sampled by process, Timers, Context
  Switches by process); `powercfg /energy` for wake sources; `pwrtest /timer` for timer requests. Quick numbers without WPA:
  `Win32_PerfFormattedData_PerfProc_Process` over 10 s (used in this report).

### What stays impossible without a resident process (and is therefore dropped)

Per-window border gradients and animated borders, custom easing for window open/close, tiling layouts beyond Snap, a status bar with
workspaces, a launcher that is not Start search, caption buttons on other apps' windows, an animated wallpaper. Each needed a hook, an overlay or a
render loop; the measured cost was 10-16 % of a core and 188 MB at idle.

## Prioritised plan

Stability first:

1. Done here: checkpointed, bounded service stops; demand start; no `-1` idle timeout; resident stack and its autostart
   removed; navpane opt-in; `bunos windows status|uninstall`; manifest v2 type and normaliser.
2. Trigger-start `BunOSWsl` and `BunOSWinBridge` on a named pipe, idle self-stop after 10 minutes without clients
   (`crates/bunos-wsl-service`, `crates/bunos-nt-bridge`).
3. Writers emit manifest v2; `bunos-wsl-service install` and the icons step write theirs; an
   `HKLM\...\Uninstall\BunOS` entry calls `bunos windows uninstall --all --yes`.
4. Userland: stop linking into `System32`; add `%SystemRoot%\BunOS\userland\bin` to the machine PATH after System32.
5. Health check in `bunos windows status`: services stopped when idle, no retired process, no orphan file, VM not up
   without a client, every binary passes `identity`; wire it into the automation loop.

Nativeness:

6. Identity on every binary (`bunos-winres` in the members listed above; `BUNOS_REQUIRE_WINRES=1` in the Windows
   release lane; `bunos windows identity` over `%SystemRoot%\BunOS\bin` as a qualification step).
7. A `.theme` file generated from the same seed for users who want one switchable theme in Settings > Personalization.
8. WSL plugin (production-signed) for VM-start hooks; attestation-signed bunos.sys once an EV certificate exists.

Modernity:

9. Qualify `bunos-wayland-win` against WSLg (resize, refresh above 60 Hz, HiDPI) and make it the default Linux GUI path
   once it passes the replace-style gate.
10. Winget manifest for the signed `bunos-setup.exe`.

## Workstation steps (wait for the owner to lift the rest, or for the authorised apply)

- Install the rebuilt `bunos-wsl-service.exe` (`sudo bunos-wsl-service install`; demand start), then
  `sc start BunOSWsl.dm-event.service` / `Stop-Service BunOSWsl.dm-event.service`, `Stop-Service BunOSWsl -Force`
  with a unit that ignores SIGTERM to see the bounded stop and the code-4 exit.
- Re-run `factory/wsl/windows/install.ts` (or edit `.wslconfig`) to drop `instanceIdleTimeout=-1` on the host, then
  confirm the VM stops 60 s after the last client.
- `bun factory/windows/shell/bunos-shell.ts disable wm navpane` to clear the journal entries of the retired parts.
- `bunos-win11 plan --module look --module shell --level standard`, then `apply`, screenshot, `verify`, `undo` check;
  idle CPU/RAM before and after; copy the wallpaper PNG from the design artifact to `%SystemRoot%\BunOS\share\wallpaper`
  first (`look.wallpaper` otherwise points at a missing file).
- `bunos windows status --deep` and `bunos windows identity %SystemRoot%\BunOS\bin\*.exe` after the next install.
