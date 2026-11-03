# Bun OS shell on Windows

How Bun OS puts nushell, bash, Rio, GlazeWM and COSMIC Files in place of cmd, PowerShell, the stock
window behaviour and the Explorer window, with the same Windows APIs, while Windows itself stays intact:
`cmd.exe`, `powershell.exe` and `explorer.exe` are never removed, renamed or replaced as the shell, and no
Windows file is overwritten. Everything per-user is reversible from a journal; the one elevated step only
copies signed binaries into `%SystemRoot%\BunOS\`.

Owners reused here: WinClean (`packages/bun-windows-winclean`, the canonical Windows API owner), the
userland bundle (`factory/windows/userland`, nu/brush/coreutils, [WINDOWS-USERLAND.md](WINDOWS-USERLAND.md)),
the Windows desktop picks (GlazeWM + `bunos-win11-chrome` + `bunos-win11-wallpaper`,
[WINDOWS-DESKTOP.md](WINDOWS-DESKTOP.md)), the WSL desktop sessions ([DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md)),
the NT bridge ([NTCORE.md](NTCORE.md)) and test signing (`factory/windows/signing`).

## What replaces what

| Windows | Bun OS | How |
| --- | --- | --- |
| cmd / PowerShell as the interactive shell | **nushell** (fork `vendor/nushell`), default profile of Windows Terminal; **brush** (bash-compatible, userland bundle) for `.sh` | WT fragment + `defaultProfile`; `.nu`/`.sh` associations |
| PowerShell cmdlets over Windows APIs | **`nu_plugin_windows`** (`win <tool>` in nushell) and the **`win`** CLI (bash/brush, JSON out) | `crates/nu_plugin_windows`, generated from the WinClean catalog (204 tools) |
| conhost / Windows Terminal window | **Rio** (fork `vendor/rio`) running nushell; Windows Terminal stays the *console host* | see "Terminal" |
| Stock window management | the `windows-hyprland` session: **GlazeWM** (fork `vendor/glazewm`), tacky-borders, the waku bar, Flow Launcher, AltSnap, `bunos-win11-chrome watch`, `bunos-win11-wallpaper` (owner: `factory/windows/desktop/hyprland.ts`, [WINDOWS-DESKTOP.md](WINDOWS-DESKTOP.md)) | `enable wm` adds the HKCU `Run` autostart; `disable wm` removes it |
| Explorer windows | **COSMIC Files** (fork `vendor/cosmic-epoch/cosmic-files`), native `x86_64-pc-windows-msvc` | "Open in COSMIC Files" verbs, Open-with app, optional default folder handler |
| — | Explorer shows the Bun OS Linux filesystem | pinned "Bun OS (Linux)" navigation-pane entry → `\\wsl.localhost\bunos` |

### Equivalent API access from the shells

Every WinClean tool is a nushell command `win <tool-name>` and a `win <tool-name>` subcommand of the CLI.
Required schema properties are positional, optional ones are `--kebab-case` flags, booleans are switches
(`--wait=false`), a pipeline record or `--with {...}` (nu) / `--json '{...}'` (CLI) passes any JSON, and
envelopes like `{count, rows: [...]}` are unwrapped to a table (`--raw` keeps them). `win` alone lists
everything; `win call <tool> {...}` reaches any tool by name.

Added to WinClean for this (all in-process, no `reg.exe`/`powershell.exe`):

| Tool | Equivalent of | API |
| --- | --- | --- |
| `wmi_query` | `Get-CimInstance`, `wmic` (any namespace) | `IWbemServices::ExecQuery` |
| `com_invoke` | `New-Object -ComObject`, `CreateObject`, `GetObject` (running instances) | late-bound `IDispatch` chains, `_NewEnum`, objects addressed by index (`on`, `{"$step": n}`) |
| `shell_known_folders` | `[Environment]::GetFolderPath`, `shell:` folders | `IKnownFolderManager` |
| `shell_drives` | "This PC" | `GetLogicalDriveStrings`, `GetVolumeInformation`, `GetDiskFreeSpaceEx` |
| `shell_file_operation` | Explorer copy/move/rename/delete/recycle/new folder (undo, copy hooks, conflict UI with `--ui`) | `IFileOperation` |
| `shell_recycle_bin` | Recycle Bin list / restore / empty | `FOLDERID_RecycleBinFolder` enumeration, `undelete` verb, `SHEmptyRecycleBin` |
| `shell_context_menu` | right-click menu: list, invoke by verb/id, or show Explorer's popup | `IContextMenu`/`IContextMenu3` (shell extensions included), `TrackPopupMenuEx` |
| `shell_properties` | Details pane / Properties sheet | `IPropertyStore`, `SHObjectProperties` |
| `shell_thumbnail` | Explorer thumbnails | `IShellItemImageFactory` (registered `IThumbnailProvider`s) |
| `shell_open_with` | "Open with" list / invoke / current default | `SHAssocEnumHandlers`, `IAssocHandler`, `IApplicationAssociationRegistration` |
| `shell_reveal` | `explorer /select,` | `SHOpenFolderAndSelectItems` |

Already in WinClean and exposed the same way: registry (`list_registry_key`, `get/set_registry_value`,
`delete_registry_entry`), services, processes, scheduled tasks, event log (`query_event_log`), power plans,
WSL, windows/UI automation, OCR, the NT tools, and `power_shell` (runs a pwsh script; the .NET agent's
in-process pwsh/winget library replaces it when it lands, [DOTNET-WINDOWS.md](DOTNET-WINDOWS.md)).
WinRT: typed WinRT calls live in the WinClean modules that need them (OCR, speech, capture, package
deployment); there is no dynamic WinRT invocation without metadata, so new WinRT surface is added as a
WinClean tool.

`factory/windows/shell/nu/bunos-windows.nu` (autoloaded) maps PowerShell/cmd habits onto the plugin:
`win svc`, `win procs`, `win kill`, `win reg`, `win reg set`, `win tasks`, `win events`, `win cim`,
`win com`, `win reveal`, `win trash`, `win menu`, `win props`, `win open-with`, `win thumb`, `win pwsh`.

```nu
win svc | where Status == Running | sort-by Name
win cim Win32_Processor | select Name NumberOfCores
win com Shell.Application {name: NameSpace, args: [17]} {name: Items}   # This PC
win menu C:\Users\me\Pictures\a.png                                    # Explorer's own menu
```

```sh
win list-services | jq -r '.[] | select(.Status=="Running") | .Name'
win wmi-query 'SELECT Caption, Version FROM Win32_OperatingSystem'
win shell-file-operation recycle --items 'C:\tmp\a.txt' --items 'C:\tmp\b.txt'
```

## Terminal

Windows "default terminal application" delegation (`HKCU\Console\%%Startup` `DelegationConsole` /
`DelegationTerminal`) requires the terminal to implement the console handoff COM interfaces
(`IConsoleHandoff`/`ITerminalHandoff`, the OpenConsole protocol). **Rio does not** (no handoff server in
`vendor/rio`), so Windows Terminal stays the console host every console app opens in, and Bun OS makes it
open **nushell** by default (fragment profile "Bun OS nushell", `{7b0f5a3e-4b1d-4c2e-9a10-b05e05de1101}`,
set as `defaultProfile` in each installed WT's `settings.json`, previous value journaled). Explorer's own
"Open in Terminal" therefore opens nushell too. Rio is the Bun OS terminal everywhere we launch one:
"Open in Rio (nushell)" on folders/drives/backgrounds, GlazeWM `Alt+Enter`, COSMIC Files "Open in
terminal"; its config (`%LOCALAPPDATA%\rio\config.toml`, only written when absent) starts nushell.
Implementing the handoff server in our Rio fork is the path to making Rio the delegated console host.

## Files and Explorer

COSMIC Files builds natively for `x86_64-pc-windows-msvc` (`--no-default-features --features wgpu`: no
Wayland, GVFS, D-Bus or io_uring on Windows). The fork's Windows patches:

- `src/mime_app.rs`: `OsStr::as_encoded_bytes` instead of the Unix-only `OsStrExt`; `src/mime_icon.rs`:
  a `is_mime_subclass_of` without shared-mime-info.
- `src/windows_shell.rs` over the WinClean shell surface: context-menu entries **Show more options**
  (Explorer's own popup for the selection: shell extensions, Send to, Open with, New), **Show in Explorer**,
  **Properties** (Explorer's sheet); **Open with...** uses the Windows Open-with dialog; **Open in
  terminal** opens Rio (or WT); the sidebar lists every drive and **Bun OS (Linux)**
  (`\\wsl.localhost\<distro>`, detected from the per-user Lxss registry so the WSL VM is not started).
- Trash already goes through the Windows Recycle Bin (`trash` crate → `IFileOperation`); thumbnails for
  types COSMIC Files does not render itself can use `windows_shell::thumbnail_png`
  (`IShellItemImageFactory`).
- `rust-toolchain.toml` pinned to the monorepo toolchain (the Windows build links WinClean).

Explorer → Bun OS (per user): "Open in COSMIC Files" on folders, drives and folder backgrounds;
`Applications\cosmic-files.exe` registered as an Open-with target; a Start menu shortcut; opt-in
`files-default` makes COSMIC Files the folder `open` verb (Explorer, Win+E and the taskbar stay Explorer);
the "Bun OS (Linux)" navigation-pane entry is a per-user shell folder (`CLSID_FolderShortcut` instance of the
system file-system folder, no DLL of ours).

**Nautilus**: evaluated under WSLg only. GNOME Files needs GTK4/libadwaita, GVFS and a D-Bus session; the
Bun OS WSL distro provides them with the GNOME 51 session ([DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md)),
and WSLg projects its window onto the Windows desktop with `/mnt/c` and `\\wsl.localhost` access. It
cannot reach the Windows Shell namespace (no Recycle Bin, shell extensions or known folders), so it is a
Linux-side file manager, not an Explorer replacement; COSMIC Files is the native pick.

## Window manager

The per-user window-manager session is owned by `factory/windows/desktop/hyprland.ts` (`windows-hyprland`:
the GlazeWM fork with its watcher, tacky-borders, the waku bar, Flow Launcher, AltSnap, `bunos-win11-chrome watch`
and `bunos-win11-wallpaper`; Explorer stays the shell), which deliberately registers nothing. `enable wm`
only adds the logon autostart (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\BunOS.Desktop` = `bun hyprland.ts up`) and starts the
session if it was not running; `disable wm` removes the Run value and stops the session only if `enable`
started it. GlazeWM itself is never killed by image name: its IPC port (6123) is fixed, and a GlazeWM killed
while its watcher lives leaves the listening socket in the stuck watcher, so the next GlazeWM fails with
`os error 10048` until that watcher is terminated (`Win32_Process.Terminate`, elevated).
`bunos-win11-chrome watch` (added here, used by that session) applies the DWM chrome to captioned top-level
windows as they appear (an out-of-context `EVENT_OBJECT_SHOW` hook: no injection, nothing persists after the
windows close).

## Install, enable, undo

Build (workstation; `CARGO_TARGET_DIR` defaults to `%LOCALAPPDATA%\Aphrody\cache\cargo-target`):

```sh
(cd crates/nu_plugin_windows && CARGO_TARGET_DIR=$T/nu-plugin-windows cargo build --release)
(cd vendor/nushell && CARGO_TARGET_DIR=$T/nushell-fork cargo build --release --locked -p nu)
(cd vendor/rio && CARGO_TARGET_DIR=$T/shell-forks cargo build --release --locked -p rioterm)
(cd vendor/glazewm && CARGO_TARGET_DIR=$T/shell-forks cargo build --release --locked -p wm -p wm-cli -p wm-watcher)
(cd vendor/cosmic-epoch/cosmic-files && CARGO_TARGET_DIR=$T/shell-forks cargo build --release --no-default-features --features wgpu)
cargo build --release --locked -p bunos-win11-chrome -p bunos-win11-wallpaper
```

Elevated, idempotent (the owner runs it; Windows Sudo inline):

```powershell
sudo.exe pwsh -NoProfile -Command "Set-Location C:\src\bun-os; bun factory/windows/shell/bunos-shell.ts install"
```

It signs every binary with the Bun OS test certificate (`factory/windows/signing/test-signing.ps1 sign`),
copies them to `%SystemRoot%\BunOS\bin\` only (unchanged files are skipped; `nu.exe` from the userland
bundle is never replaced), copies licences to `%SystemRoot%\BunOS\licenses\` and writes
`%SystemRoot%\BunOS\manifests\shell.json` (file, sha256, size, SPDX, source, signer thumbprint).
`sudo.exe bun ...\bunos-shell.ts uninstall` disables everything and removes exactly the manifest's
unchanged files.

Per user (no elevation):

```sh
bun factory/windows/shell/bunos-shell.ts enable            # nu-plugin terminal assoc verbs files navpane icons wm
bun factory/windows/shell/bunos-shell.ts enable files-default
bun factory/windows/shell/bunos-shell.ts disable wm        # toggle the window manager off
bun factory/windows/shell/bunos-shell.ts undo              # everything per-user back
bun factory/windows/shell/bunos-shell.ts status
```

Every registry value is written through `win set-registry-value` after its previous value (or absence) is
journaled in `%LOCALAPPDATA%\bunos\shell\journal.json`; files we write are tracked in `files.json` with
any previous content. `disable`/`undo` restore in reverse order.

### Icons (Bun OS Material, design agent)

`%SystemRoot%\BunOS\icons\bunos-icons.dll` and its `icon-theme.json` ([DESIGN-M3-WINDOWS.md](DESIGN-M3-WINDOWS.md))
are applied in the light or dark set following `AppsUseLightTheme`:

- `icons` (per user): each known folder's `desktop.ini` gets `IconResource=<dll>,-<ordinal>` (the original
  file, its UTF-16 encoding and the folder's read-only bit are kept and restored byte for byte); This PC and
  the Recycle Bin (empty/full) through `HKCU\...\Explorer\CLSID\{...}\DefaultIcon`; our own ProgIDs
  (`BunOS.*`, the verbs, the pane entry) use the dll. Another application's ProgID is never re-iconed.
- `icons-system` (elevated, `sudo.exe pwsh -NoProfile -Command "bun ...\bunos-shell.ts enable icons-system"`, same
  for `disable`): `HKLM\...\Explorer\Shell Icons` (folder, open folder, generic file, Recycle Bin, drives,
  This PC) and `HKLM\...\Explorer\DriveIcons\<letter>\DefaultIcon` for the drives present.

No code here draws window frames or caption buttons (the chrome sets DWM attributes only; COSMIC Files' header
bar comes from libcosmic), so the UIA names Close / Minimise / Zoom belong to those drawers.

## Verified on the workstation (2026-11-03, Windows 11 Pro 10.0.28120)

- **Builds** (`x86_64-pc-windows-msvc`): `nu_plugin_windows` + `win` (tests pass), nu 0.116.2 from the fork,
  Rio, GlazeWM, COSMIC Files (native, toolchain 1.97.1), `bunos-win11-chrome` (with `watch`),
  `bunos-win11-wallpaper`.
- **Install**: `sudo.exe pwsh -NoProfile -Command "bun factory/windows/shell/bunos-shell.ts install"` installed
  and signed every binary (Authenticode `Valid`, thumbprint `1E67DBDB0D46A61CF57D286A5562DD76675D4E87`); a
  second run reported every file `unchanged` (idempotent on the unsigned source hash). Windows Sudo inline
  does not forward stdout to a non-console parent, so run it from a console or through `pwsh -Command ... *> log`.
- **Plugin in nu**: `plugin add` + `plugin use windows`: 204 `win` commands; services, WMI
  (`Win32_Processor`), COM (`WScript.Shell`, `Shell.Application` This PC enumeration), known folders,
  drives and the registry return structured tables.
- **Shell namespace** (`win` CLI): IFileOperation recycle of a scratch file, listed in the Recycle Bin with
  original folder and date, restored by the `undelete` verb; Explorer's context menu for a PNG listed 42
  verbs including 7-Zip and Rizin shell extensions; 128 px thumbnail through `IShellItemImageFactory`;
  Open-with handlers and the effective default ProgID; 49 property-system values.
- **Per user**: `factory/windows/shell/verify.ts` enabled every component (`.nu` → `BunOS.NuScript` as
  the effective default, `.sh` class, "Open in Rio (nushell)" and "Open in COSMIC Files" in Explorer's own
  folder menu, COSMIC Files Open-with app and Start menu shortcut, the "Bun OS (Linux)" namespace entry
  resolving to `\\wsl.localhost\bunos`, WT fragment + `defaultProfile`, Rio config, plugin registered and
  callable, autostart), then `undo` returned every check to its previous state (WT `defaultProfile` restored,
  the WT fragment stub removed, JSON still valid). Left enabled afterwards: everything except `files-default`, plus `icons-system`. `icons` and `icons-system` were each enabled, disabled (Documents `desktop.ini` byte-identical, HKCU/HKLM values back to their originals, including type) and enabled again; Explorer shows the Material icons and the pinned "Bun OS (Linux)" entry. `shell_context_menu --action popup` showed Explorer's full menu (Open with, Send to, 7-Zip, Rizin, Properties) and returned `chosen: null` when dismissed.
- **COSMIC Files**: runs natively; the sidebar lists `OS (C:)`, `BunShare (V:)` and `Bun OS (Linux)`; Trash
  is the Windows Recycle Bin. Screenshots: `.tmp-shell/shots` on the workstation (not committed).
- `.sh`: Windows keeps an Open-with list for `.sh` and honours only a hash-protected `UserChoice` there, so
  the per-user class is not the *effective* default until the user picks "Shell script" once in the Open-with
  prompt; `.sh` runs brush when the userland bundle is installed (else `bash` from PATH through nu).

Pending: Rio as the delegated console host (needs `ITerminalHandoff` in the fork); in-process pwsh/winget
pipelines from the .NET agent's library (`power_shell` runs pwsh meanwhile); brush builtins (the `win` CLI
is the bash-side surface); thumbnails from `windows_shell::thumbnail_png` wired into COSMIC Files' own
thumbnailer for types it does not render.
