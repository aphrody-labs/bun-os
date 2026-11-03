# Bun OS Windows desktop

How Bun OS turns a stock Windows 11 into the product: debloated and de-Microsoft-ed like tiny11 but reversible,
tuned with the rigour and modularity of archinstall, and dressed with a Rust desktop (tiling WM, macOS-style chrome,
wallpaper engine) with Android apps as native windows. One capability, one pick, one owner. Verified November 2026.

All picks are built from source as pinned `aphrody-labs` forks under `vendor/`; nothing is installed as a vendor
binary. The owner has pre-accepted every toolchain and SDK licence; the only hard constraint is that code we **ship**
must be OSI/GPL/MIT-compatible — a source-available-but-non-OSI project may be a reference or an optional local tool,
never a dependency we redistribute.

## Decisions

| Capability | Pick | Licence | Why |
| --- | --- | --- | --- |
| ISO debloat reference | **ntdevlabs/tiny11builder** (`vendor/tiny11builder`) | no licence file (reference only) | The canonical Windows 11 debloat script. We reimplement its behaviour in Rust via the DISM API; we keep its credits and ship none of its code. |
| Debloat engine | **bun-windows-winclean `tweaks`** (ours) | Apache-2.0 | One declarative catalog drives both live and ISO. Reuses the existing WinClean primitives (registry, services, tasks, power, appx, perf) instead of a parallel stack. |
| Installer model | **archinstall** (design reference) | GPL-3.0 (not copied) | Guided TUI + non-interactive profile JSON/TOML + modular sections, each with detect/plan/apply/verify/undo. |
| Tiling WM (shipped) | **GlazeWM** (`vendor/glazewm`, branch `bunos`) | GPL-3.0 | Best OSI/GPL Rust tiling WM for Windows; actively released (v3.x, 2026). We ship it with glzr-io/glazewm#1392 merged (Hyprland-style window and workspace animations). |
| Window borders | **tacky-borders** (`vendor/tacky-borders`) | MIT | Rust Direct2D/DirectComposition overlay borders: Hyprland's gradient active border, rotating-angle animation and glow, which the 1 px `DWMWA_BORDER_COLOR` cannot draw. |
| Launcher | **Flow Launcher** (`vendor/flow-launcher`) | MIT | The most complete OSI launcher on Windows (plugins, Everything, Acrylic/Mica backdrop); `Super+Space`. |
| Super-drag move/resize | **AltSnap** (`vendor/altsnap`) | GPL-3.0 | Hyprland's mouse move/resize (`bindm`) on the Windows key; small C program, own low-level hooks only. |
| Tiling WM (reference) | komorebi | Komorebi Licence 2.0.0 (PolyForm-style, **non-OSI**, commercial restriction) | Technically excellent and Rust, but source-available with a commercial-use restriction, so it is a design reference only — never shipped. |
| Bar / widgets | **Zebar** (GlazeWM's companion) | GPL-3.0 | Same org as GlazeWM, GPL-3.0, integrates with its IPC. |
| Full DE alternative | Seelen UI (reference) | AGPL-3.0 | A complete Rust/Tauri DE with dock/bar/wallpaper. AGPL is shippable but heavy for our needs; we take its WorkerW wallpaper technique as a reference and build our own lighter engine. |
| macOS-style chrome | **bunos-win11-chrome** (ours, `DwmSetWindowAttribute`) | Apache-2.0 | Rounded corners, Mica backdrop, immersive dark caption, coloured borders, traffic-light caption buttons and a dock — the documented DWM attributes, no shell patching. Windhawk (GPL-3.0) mods are a behaviour reference. |
| Wallpaper engine | **bunos-win11-wallpaper** (ours, WorkerW + wgpu) | Apache-2.0 | The Progman `0x052C` WorkerW technique with a wgpu-rendered animated layer behind the icons. Pure Rust, shares the Bun OS wgpu stack; nothing comparable OSI exists in Rust. |
| Computer-use | **bun-windows-winclean** (ours) + `uiautomation`, `windows-capture`, `xcap`, `enigo` | Apache-2.0 / Apache-2.0 / MIT / Apache-2.0 / MIT | We already own the computer-use surface (SendInput, WGC capture, OCR, UIA) in WinClean; the crates fill gaps (UIA tree, frame capture) and are all permissively licensed. |
| GNOME-Tweaks equivalent | **Bun OS Tweaks** = `bunos-win11` + the WinClean `tweak_*` tools | Apache-2.0 | A libcosmic/CLI front over the same catalog with dry-run, apply and an undo journal. Winaero/Windhawk/WinUtil/Win11Debloat/privacy.sexy were mined for the catalog, not vendored. |
| Android apps | **Waydroid on the Bun OS WSL bundle via WSLg** | GPL-3.0 (Waydroid) | WSA ended 5 March 2025 (sources below). Waydroid in our WSL distro gives Android activities as native Windows windows through WSLg. WSABuilds (AGPL-3.0, community WSA) over ADB is the fallback; Google Play Games' developer emulator is a non-free alternative we do not ship. |

## tiny11 / ISO

`bunos-win11 iso --source <win11.iso> --output <tiny-bunos.iso> [--config profile.toml]` reimplements tiny11builder
in Rust:

1. mounts the source ISO (`Mount-DiskImage`) and copies the media,
2. selects the `sources\install.wim` edition index,
3. DISM-mounts it read-write through the **DISM API** (`dismapi.dll`: `DismMountImage`, `DismOpenSession`,
   `DismRemoveProvisionedAppxPackage`, `DismUnmountImage`) — not the `dism.exe` CLI,
4. applies the offline profile: appx deprovisioning via DISM, policy/registry on the offline hives via **offreg.dll**
   (`OROpenHive`/`ORSetValue`/`ORSaveHive`, so the live registry is never touched), services via the SYSTEM hive
   `Start` value, scheduled-task XML and file removals under the mount,
5. DISM-commits and unmounts,
6. writes a bootable ISO with `oscdimg` (Windows ADK) — the one step with no documented in-process API.

The removal/tweak profile is the same `catalog/tweaks.toml` the live installer uses (`target = "offline"`). tiny11's
credits are kept in `vendor/tiny11builder` and this table.

## Live installer (archinstall-style)

`bunos-win11` optimises the **running** Windows the way archinstall installs Arch:

- **Guided** (`bunos-win11 guided`): a ratatui TUI to pick target, level and modules, preview the plan and apply.
- **Profile** (`bunos-win11 plan|apply --config profile.toml`): non-interactive, reproducible.
- **Modules** mirror archinstall's sections — privacy/telemetry, ads/suggestions, Copilot/Recall AI, consumer appx
  bloat, Edge/OneDrive, services/tasks, performance/power, shell/desktop, dev tools, Android, WSL/Bun OS — each with
  its own detect, plan, apply, verify and undo.
- The **plan is shown and saved as JSON** before anything changes.
- **Safety**: a System Restore point, a `.reg` export of every touched key, and a journal under
  `%LOCALAPPDATA%\bunos\win11\journal` so `bunos-win11 undo` reverts registry values, service start types, scheduled
  tasks, power scheme and re-registers removed per-user appx packages.

### Guardrails (never crossed, live or offline)

The engine refuses, at plan time *and* again at apply time (a hand-edited plan cannot smuggle them through):

- Windows Defender, Windows Update, Windows Firewall, BITS/crypto/TrustedInstaller
- WSL, Hyper-V, Virtual Machine Platform, Containers (may be **enabled**, never disabled/removed)
- Microsoft Store, App Installer (winget), Edge **WebView2**, .NET/VC runtimes, the shell/Explorer experience hosts
- networking (Tcpip, DHCP, DNS, WLAN, NLA, firewall), remote access (`sshd`, RDP)
- aphrody / bunos / claude / WireGuard / cloudflared / tailscale services and processes

Only a conservative profile is applied live by default (telemetry/ads/suggestions/Copilot/Recall policies, consumer
appx, Start/taskbar declutter, performance/power). Nothing reboots.

## Bun OS Tweaks (GNOME Tweaks equivalent)

The same engine, exposed two ways over one catalog:

- **CLI/app**: `bunos-win11` (TUI + commands), on top of `bun-windows-winclean`.
- **MCP / `aphrody` CLI**: `tweak_catalog`, `tweak_plan`, `tweak_apply` (needs `confirm`), `tweak_verify`,
  `tweak_undo`, added to the WinClean `tools.json` so they appear as aphrody tools.

## Desktop profiles

`bunos-win11 desktop <name>` emits a launch plan for each (nothing is registered as the live shell):

| Profile | Runtime | Notes |
| --- | --- | --- |
| `cosmic` | Bun OS WSL bundle via WSLg | Full COSMIC DE (`vendor/cosmic-epoch`, `vendor/pop-os`). |
| `cosmic-comp` | WSLg | The cosmic-comp compositor alone. |
| `hyprland` | WSLg | Hyprland (`vendor/hyprland`). |
| `omarchy` | WSLg | Hyprland + Omarchy (`vendor/omarchy-windows` = our try-omarchy-windows fork, `vendor/omarchy`). |
| `gnome` | WSLg | GNOME 51 (Mutter Wayland). |
| `windows-mac` | native Windows | `bunos-win11-chrome` + `bunos-win11-wallpaper` + GlazeWM. |
| `windows-hyprland` | native Windows | Animated GlazeWM + tacky-borders + Zebar + Flow Launcher + AltSnap + chrome + wallpaper, configured as Hyprland/Omarchy (below). |

The Linux desktops run from the **Bun OS WSL bundle** (owned by another member — this crate wires the profile and the
per-desktop pacman package lists only) and WSLg projects each Wayland surface as a native Windows window. The package
lists and launch commands are in `crates/bunos-win11/src/desktop.rs`.

## Hyprland-style Windows (`windows-hyprland`)

The owner asked for the best Rust, C# or C++ compositor, window manager and customiser pieces to redesign Windows 11
as Hyprland. Windows has no replaceable compositor: DWM is the compositor and stays. Everything below works with it
through documented APIs (`DwmSetWindowAttribute`, out-of-context `SetWinEventHook`, DWM thumbnails, Direct2D and
DirectComposition overlays, low-level keyboard/mouse hooks); nothing replaces `explorer.exe` or patches system files.

### Evaluation (GitHub API, 3 November 2026)

| Project | Lang | Licence | Stars | Last push | Verdict |
| --- | --- | --- | --- | --- | --- |
| glzr-io/glazewm | Rust | GPL-3.0 | 13.0k | 2026-06 (v3.10.1) | **Pick: tiling.** Animations from open PR #1392 (move/resize through DWM thumbnail surrogates, open/close zoom-fade, workspace slide/fade/zoom/iris, cubic-bezier and spring easing) merged in our fork. |
| LGUG2Z/komorebi | Rust | Komorebi Licence 2.0.0 (non-OSI) | 15.3k | 2026-11 | Reference only (likewise `whkd`, `masir`: same licence). |
| eythaann/Seelen-UI | Rust/Tauri | AGPL-3.0 | 18.3k | 2026-10 | Reference: a full DE, heavier than the pieces we need. |
| dalyIsaac/Whim | C# | MIT | 0.5k | 2026-03 | Runner-up tiling (good plugin model, small community, no animations). |
| workspacer/workspacer | C# | MIT | 1.8k | 2025-06 | Stale. |
| FancyWM/fancywm | C# | PolyForm Perimeter 1.0.1 (non-OSI) | 1.2k | 2026-09 | Not shippable. |
| AdEx-Partners-DE/OpenNiri-Windows | Rust | GPL-3.0 | 51 | 2026-10 | Watch: niri-style scrolling tiling, too young. |
| ponslookspain/tile-rs | Rust | MIT | 19 | 2026-11 | Watch: Hyprland dwindle layout, too young. |
| luke-you/tacky-borders | Rust | MIT | 0.6k | 2026-08 (v1.6.0) | **Pick: borders** (gradient, animation, glow). |
| glzr-io/zebar | Rust/Tauri | GPL-3.0 | 3.1k | 2026-09 (v3.3.1) | **Pick: bar** (GlazeWM IPC; HTML widgets themed from our tokens). |
| amnweb/yasb | Python | MIT | 5.7k | 2026-11 | Runner-up bar; needs a Python runtime. |
| codyduong/hitokage | Rust | MIT | 42 | 2026-08 | Watch: Rust bar, early. |
| Flow-Launcher/Flow.Launcher | C# | MIT | 15.9k | 2026-11 (v2.1.4) | **Pick: launcher.** |
| microsoft/PowerToys (Run, Command Palette, FancyZones, Workspaces) | C#/C++ | MIT | 140k | 2026-11 (v0.102) | Optional: one very large solution; Command Palette is the alternative launcher, FancyZones overlaps GlazeWM. |
| Wox-launcher/Wox, kunkka19xx/look, ghost-him/ZeroLaunch-rs | Go / Rust / Rust | GPL-3.0 | 27.6k / 1.3k / 0.6k | 2026-11 | Alternatives; `look` is the Rust one to watch. |
| RamonUnch/AltSnap | C | GPL-3.0 | 5.4k | 2026-11 (1.68) | **Pick: Super-drag move/resize.** |
| ramensoftware/windhawk (+ windhawk-mods) | C++ | GPL-3.0 (mods: per file) | 9.7k | 2026-11 | Optional: the strongest taskbar/Start restyler (Taskbar Styler, Start Menu Styler mods), but it injects into Explorer; not run by default. |
| valinet/ExplorerPatcher | C | GPL-2.0 | 34.2k | 2026-10 | No: patches Explorer and breaks on Insider builds (this host runs 28120). |
| MicaForEveryone/MicaForEveryone | C# | MIT | 5.3k | 2026-05 | Reference: `bunos-win11-chrome watch` sets the same `DWMWA_SYSTEMBACKDROP_TYPE` per window, in Rust. |
| Maplespe/DWMBlurGlass, ExplorerBlurMica | C++ | LGPL-3.0 | 4.7k / 4.3k | 2026 | Optional: real blur behind title bars, but injects into `dwm.exe` (symbols per build); not run. |
| TranslucentTB/TranslucentTB | C++ | GPL-3.0 | 20.7k | 2026-11 (2026.2) | Optional: acrylic/clear taskbar; the profile leaves the taskbar alone and draws Zebar. |
| rainmeter/rainmeter | C++ | GPL-2.0 | 6.1k | 2026-10 | No: skin engine, superseded by Zebar widgets. |
| Rectify11/Installer | JS/C++ | GPL-3.0 | 3.5k | 2026-01 | No: replaces system resource files (forbidden here). |
| namazso/SecureUxTheme | C++ | LGPL-2.1 | 3.1k | 2025-06 | No: msstyles signature bypass in winlogon; theming goes through DWM attributes and app backdrops instead. |
| Open-Shell/Open-Shell-Menu, moudey/Shell (Nilesoft) | C++ | MIT | 9.5k / 6.9k | 2026 | Optional Start and context-menu replacements; not Hyprland-like. |
| AutoDarkMode/Windows-Auto-Night-Mode | C# | GPL-3.0 | 9.8k | 2026-10 | Optional: scheduled light/dark. |

### Picks per capability

| Capability | Pick | Licence |
| --- | --- | --- |
| Tiling, gaps, workspaces, animations | GlazeWM `bunos` (upstream + #1392) | GPL-3.0 |
| Active/inactive borders (gradient, animated, glow) | tacky-borders | MIT |
| Bar | Zebar (starter `with-glazewm` + Bun OS theme CSS) | GPL-3.0 |
| Launcher | Flow Launcher | MIT |
| Mouse move/resize | AltSnap | GPL-3.0 |
| Backdrops, dark caption, corners | `bunos-win11-chrome watch` (ours, `DWMWA_SYSTEMBACKDROP_TYPE`) | Apache-2.0 |
| Wallpaper | `bunos-win11-wallpaper` (ours) | Apache-2.0 |
| Taskbar / Start | unchanged by default; Windhawk or TranslucentTB optional | GPL-3.0 |
| Theme | M3 roles from `aphrody-m3-tokens` (`--seed`, or the design agent's `bunos-design theme` export with `--theme`) | Apache-2.0 |

### Profile

`bunos-win11 desktop windows-hyprland --render <dir>` (crates/bunos-win11/src/hyprwin.rs) writes every config from
one look (M3 dark roles, glass, motion):

- **Keys** (Omarchy where Windows allows, `Super` = `lwin`): `Super+Enter` terminal (Rio, else Windows Terminal),
  `Super+Space` Flow Launcher, `Super+W` close, `Super+F` fullscreen, `Super+T` float, `Super+J` split direction,
  `Super+arrows` focus, `Super+Shift+arrows` move, `Super+1..9` and `Super+Shift+1..9` workspaces, `Super+Tab` next
  workspace, `Super+-`/`Super+=` resize, `Super+R` resize mode, `Super+Shift+R` reload, `Super+Shift+E` exit.
  `Super` with left/right drag moves/resizes (AltSnap). `Win+L` stays the system lock.
- **Gaps**: 10 px inner, 20 px outer, 52 px at the top for the bar.
- **Animations**: Hyprland's `myBezier` (0.05, 0.9, 0.1, 1.05) for move/resize (280 ms), zoom-fade open (260 ms) and
  close (180 ms), horizontal workspace slide (380 ms), a 4 s border-angle loop and fades. All off when the user turned
  Animation effects off (`MinAnimate` = 0) or with `--motion off`.
- **Glass**: `max` (default) = focused windows 96 % and others 86 % opacity, Acrylic Flow Launcher, translucent blurred
  bar, border glow. `reduced` = everything opaque, no glow, no launcher backdrop; chosen automatically when
  Transparency effects are off (`EnableTransparency` = 0 under `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`,
  the value behind `UISettings.AdvancedEffectsEnabled`), or with `--glass reduced`.
- **Colours**: active border `primary` to `tertiary` at 45 degrees, inactive `outlineVariant` to
  `surfaceContainerHighest`, bar `surfaceContainer`/`onSurface`/`primary`.

A Win32 window shows a system backdrop only where it does not paint its client area, so Mica/Acrylic shows on
captions, Windows Terminal, Rio, WinUI 3 apps and Explorer; classic GDI apps keep an opaque client area (the
documented behaviour of `DWMSBT_*`). Layered opacity (GlazeWM `transparency`) is what makes every window see-through
at max.

### Run and undo (this host)

```sh
bun factory/windows/desktop/hyprland.ts build   # everything from source; AltSnap is cross-built on vps (mingw-w64)
bun factory/windows/desktop/hyprland.ts stage   # %LOCALAPPDATA%\bunos\desktop\hyprland, test-signed
bun factory/windows/desktop/hyprland.ts up      # render + start (per-user, no autostart, no registry writes)
bun factory/windows/desktop/hyprland.ts down    # GlazeWM wm-exit (shows every window), then stop the rest
bun factory/windows/desktop/hyprland.ts undo    # down + delete the staged tree; nothing else to revert
```

Fork patches: `aphrody-labs/glazewm` `bunos` (PR #1392), `aphrody-labs/AltSnap` `bunos` (`-lshell32` for current
mingw-w64), `aphrody-labs/Flow.Launcher` `bunos` (`global.json` roll-forward so the .NET 10 SDK builds net9.0). Zebar
builds its frontend with `bun install --linker hoisted` (its Tailwind preset requires an unhoisted peer).

## Android APKs

`bunos apk install <file.apk>` (front door → `packages/bunos-run/src/apk.ts`): installs and launches through Waydroid
in the Bun OS WSL distro, so the app appears as a native Windows window via WSLg; WSABuilds over ADB is the fallback.
On a host with no reachable Android target it prints the plan as a dry run and never starts WSL. The Rust Waydroid
control plane is `crates/bun-waydroid` (ported from `vendor/waydroid`).

## Sources

- WSA retirement (5 March 2025): [The Register](https://www.theregister.com/2024/03/05/windows_subsystem_android/),
  [Thurrott](https://www.thurrott.com/windows/298807/microsoft-killing-windows-subsystem-for-android-amazon-appstore-windows-11-march-2025)
- DISM API: [DismRemoveProvisionedAppxPackage / DISM API reference, Microsoft Learn](https://learn.microsoft.com/windows-hardware/manufacture/desktop/dism/dismremovepackage-function)
- Offline Registry library (`offreg.dll`): Microsoft Learn, Offline Registry Library Functions
- DWM window attributes (Mica, rounded corners, dark caption): Microsoft Learn, `DwmSetWindowAttribute` / `DWMWINDOWATTRIBUTE`
- GlazeWM GPL-3.0, Zebar GPL-3.0, komorebi "Komorebi License 2.0.0" (non-OSI), Seelen UI AGPL-3.0 — repository licence files, GitHub
- GlazeWM animations: [glzr-io/glazewm#1392](https://github.com/glzr-io/glazewm/pull/1392) (builds on #1199)
- tacky-borders MIT, Flow Launcher MIT, AltSnap GPL-3.0, Whim MIT, FancyWM PolyForm Perimeter 1.0.1, YASB MIT,
  Windhawk GPL-3.0, TranslucentTB GPL-3.0, MicaForEveryone MIT, DWMBlurGlass LGPL-3.0 — repository licence files, GitHub
- [DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)
  (Mica = `DWMSBT_MAINWINDOW`, Desktop Acrylic = `DWMSBT_TRANSIENTWINDOW`, Mica Alt = `DWMSBT_TABBEDWINDOW`; build
  22621+) and [DWMWINDOWATTRIBUTE](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)
  (`DWMWA_BORDER_COLOR`, `DWMWA_COLOR_NONE`, `DWMWA_WINDOW_CORNER_PREFERENCE`), Microsoft Learn
- [SetWinEventHook](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwineventhook) (out-of-context
  hooks need a message loop and inject no DLL) and
  [IVirtualDesktopManager](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager)
  (documented per-window queries only; GlazeWM workspaces cloak windows instead), Microsoft Learn
- [Transparency effects and UISettings.AdvancedEffectsEnabled](https://learn.microsoft.com/windows/apps/develop/composition/composition-tailoring#user-effects-settings)
  and [Materials](https://learn.microsoft.com/windows/apps/develop/ui/materials), Microsoft Learn
- GlazeWM configuration (`gaps`, `window_effects`, keybindings): Context7 `/glzr-io/glazewm`
