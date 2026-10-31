<!-- SPDX-License-Identifier: Apache-2.0 -->
# Tauri 3 plugins and capabilities

This page holds the plugin selection rules.

## Rules

- A plugin earns its place only if it does something only the shell can do: windows, tray,
  menus, OS notifications, global shortcuts, clipboard, native dialogs, single instance, deep
  links, autostart, window state, updater, log bridge.
- Anything the Rust side already does (filesystem work, processes, HTTP, SQL, system info) stays
  a typed `#[tauri::command]` or a kernel/Drive RPC. Do not add `shell`, `http`, `sql`, `upload`
  or `websocket` plugins to the webview.
- Plugins are declared once in the root `[workspace.dependencies]` (`tauri-plugin-* = "=3.0.0-alpha.2"`).
  Do not reintroduce a vendored tree.
- Mobile-only plugins (biometric, haptics, NFC, barcode, geolocation) are out of scope.
  `window-vibrancy` has no effect on Linux; gate it behind `cfg(any(windows, target_os = "macos"))`
  if it is ever used.

## Capabilities

- Tauri 3 is default-deny: a command is unreachable until a capability grants it.
- `capabilities/main.json` grants the main window shell-level permissions only. The `fs` grant is
  read-only (`read_text_file`, `stat`, `exists`) and scoped to `$APPDATA` plus files the OS hands
  to Aphrody at runtime.
- Secondary windows get their own capability files (`desktop-surfaces.json`, `quickbar.json`);
  their native actions go through label-checked commands.
- Everything is bound to the local origin. Remote Wry previews get no capability and the app
  loads only first-party assets.
- If a scoped plugin (`fs`, `opener`) is widened, it keeps explicit path/URL scopes; never a
  blanket `allow-*`.
