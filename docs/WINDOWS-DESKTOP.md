# Bun OS Windows desktop

How Bun OS turns a stock Windows 11 into the product: debloated and de-Microsoft-ed like tiny11 but reversible,
tuned with the rigour and modularity of archinstall, themed through Windows' own settings (no resident
desktop process), with Android apps as native windows. One capability, one pick, one owner. Verified November 2026.

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
| Tiling WM | **Windows Snap layouts + virtual desktops** (retired: GlazeWM) | — | Resident WM removed 2026-11-03; Windows' own tiling, turned on and themed by the catalog `look` module. |
| Window borders | **DWM accent borders** (`DWM\ColorPrevalence`; retired: tacky-borders) | — | One registry value instead of a resident Direct2D overlay (10 % of a core at idle). |
| Launcher | **Start search** (retired: Flow Launcher) | — | Start stays; web results and suggestions off by policy. |
| Super-drag move/resize | none (retired: AltSnap) | — | A global low-level hook is a resident process; Snap covers placement. |
| Tiling WM (reference) | komorebi | Komorebi Licence 2.0.0 (PolyForm-style, **non-OSI**, commercial restriction) | Technically excellent and Rust, but source-available with a commercial-use restriction, so it is a design reference only — never shipped. |
| Bar / widgets | **the Windows taskbar** (retired: Zebar, waku) | — | No bar of ours: a WebView bar was rejected, and any bar is a resident process. |
| Full DE alternative | Seelen UI (reference) | AGPL-3.0 | A complete Rust/Tauri DE with dock/bar/wallpaper. AGPL is shippable but heavy for our needs; we take its WorkerW wallpaper technique as a reference and build our own lighter engine. |
| Window chrome | **Windows accent, dark mode, Mica** (`bunos-win11-chrome` kept as a library for windows Bun OS owns) | Apache-2.0 | No watcher or caption overlay on other apps' windows (retired). |
| Wallpaper | **static wallpaper via `SPI_SETDESKWALLPAPER`** (retired: `bunos-win11-wallpaper`) | — | The wgpu loop used 16 % of a core and 188 MB at idle. |
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
| `windows-native` | native Windows | One-shot apply of the catalog `look` and `shell` modules; nothing resident (below). |

The Linux desktops run from the **Bun OS WSL bundle** (owned by another member — this crate wires the profile and the
per-desktop pacman package lists only) and WSLg projects each Wayland surface as a native Windows window. The package
lists and launch commands are in `crates/bunos-win11/src/desktop.rs`.

## Native look (`windows-native`)

The resident Hyprland-style and macOS-style stacks (GlazeWM with animations, tacky-borders, AltSnap, Flow Launcher, the
Zebar and waku bars, `bunos-win11-chrome watch` with the traffic-light overlay, the wgpu wallpaper engine, and the
`HKCU\...\Run\BunOS.Desktop` autostart that started them) were **removed on 2026-11-03**: owner directive, "patch Windows
and use its low-level features, do not rebuild Windows on top of it". Measured before removal: the wallpaper used about
16 % of one core and 188 MB, tacky-borders about 10 % of one core, at idle.

Windows now draws everything itself from settings `bunos-win11` writes once:

```sh
bunos-win11 plan  --module look --module shell --level standard   # every value, read-only
bunos-win11 apply --module look --module shell --level standard   # restore point, .reg export, journal
bunos-win11 undo                                                  # every value back
```

- accent colour from the M3 seed on title bars and window borders (`DWM\ColorPrevalence`), Start/taskbar accent palette,
  dark mode, transparency effects (Mica and Acrylic wherever apps and the shell offer them; rounded corners are the
  Windows 11 default);
- a static wallpaper (`Control Panel\Desktop\Wallpaper`, made current with `SPI_SETDESKWALLPAPER`);
- Snap layouts, Snap assist and snap groups; virtual desktops as workspaces (taskbar and Alt+Tab filtered to the
  current desktop; Win+Ctrl+arrows, Win+Tab);
- taskbar and Start declutter by policy (no Widgets, Task View, Chat; search as an icon; no recommendations).

Values, sources and the retirement record: [WINDOWS-ARCHITECTURE.md](WINDOWS-ARCHITECTURE.md). The forks stay in
`vendor/` as references only (`retired` in `vendor/sources.json`); `vendor/zebar` was removed.

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
