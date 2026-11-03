# Native Wayland on Windows (`bunos-wayland-win`)

Status 2026-11-03. Owner: `crates/bunos-wayland-win`. This page covers Linux GUI apps and full Linux desktops shown as
native Windows windows without WSLg, RDP or msrdc. The WSL install belongs to [WSL.md](WSL.md) and `factory/wsl/`. WSLg's
fork and its limits are in [WSLG.md](WSLG.md). Session packages are in [DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md).

## Why not "smithay running as a Windows process"

The obvious design is a Wayland server that runs on Windows and lets Linux clients connect to it over AF_UNIX. Three
facts rule it out:

1. Wayland needs file-descriptor passing. `wl_shm` pools, keymaps, dmabufs and data-device pipes all travel as
   `SCM_RIGHTS` ancillary data. Windows AF_UNIX (afunix.sys, Windows 10 1803 and later) supports only `SOCK_STREAM`, with
   no ancillary data. A Linux client therefore cannot talk Wayland to a Windows process, even on WSL1.
2. WSL2 is a VM. Its AF_UNIX sockets never reach the Windows host. The only host-to-guest channels are hvsocket
   (AF_HYPERV / AF_VSOCK), 9p/virtiofs and TCP, and none of them carries file descriptors.
3. smithay, wayland-server (wayland-rs) and calloop are written against Unix (rustix, `memfd`, `SCM_RIGHTS`). They do
   not build for `x86_64-pc-windows-msvc`.

Every working system terminates the Wayland protocol on the Linux side and sends pixels across. WSLg does this with
Weston plus RDP. waypipe does it with its own protocol, between two Linux compositors. Bun OS does it with a small
protocol of its own.

## Design

```
 Linux (Bun OS WSL distro | VM | remote host over ssh)        Windows 11
 ┌───────────────────────────────────────────────┐            ┌─────────────────────────────────────────────┐
 │ foot, GTK, Qt, SDL, Xwayland (next) ...       │            │ bunos-wayland-win.exe                       │
 │        │ Wayland (unix socket + fds)          │            │  one Win32 window per toplevel              │
 │ bunos-wlhost (smithay, headless)              │  framed    │  DWM: Mica/Acrylic, rounded corners, shadow,│
 │  xdg-shell, xdg-decoration (SSD = Win32 frame)│  stream    │  snap layouts, Alt+Tab, taskbar             │
 │  fractional-scale + viewporter (Windows DPI)  │ ─────────► │  D3D11 + DirectComposition flip-model swap  │
 │  cursor-shape, ext-background-effect (blur)   │ ◄───────── │  chain per window (premultiplied alpha), or │
 │  pixman render per toplevel, damage only, lz4 │  input,    │  GDI SetDIBitsToDevice (--gdi)              │
 │  frame callbacks released on presenter ack    │  configure │  scan codes -> evdev, layout -> XKB         │
 └───────────────────────────────────────────────┘            └─────────────────────────────────────────────┘
       transport: stdio of `ssh HOST` | `wsl.exe -d bunos --exec` | any program (socat to vsock/TCP)
```

* Wire protocol (`src/wire.rs`): each message is `u32 length | u8 tag | payload`, little endian. Host to presenter:
  `Hello`, `ToplevelNew`, `ToplevelMeta` (title, app_id), `ToplevelRequest` (maximize, fullscreen, minimize,
  interactive move and resize from client-side decorations), `ToplevelEffect` (backdrop and translucency),
  `ToplevelClosed`, `Frame` (damage rectangles, BGRA premultiplied, raw or lz4), `Cursor` (cursor-shape name) and `Bye`.
  Presenter to host: `Hello` (XKB layout from the active Windows HKL, DPI scale, output size), `Configure`, pointer
  motion, button, axis and leave, `Key` (evdev code), `Focus`, `Close`, `FrameAck` and `Launch`. Unit tests cover the
  round trips and the lz4 rectangle path.
* Flow control: the host sends a frame, waits for `FrameAck`, then releases the client's `wl_surface.frame` callbacks.
  A client never draws faster than Windows shows its frames, and nothing queues on a slow link. A commit with no visible
  damage releases the callbacks at once.
* Window mapping: the Win32 client area is the xdg window geometry, so CSD shadows are cropped. Server-side decoration
  is the default (`xdg-decoration` answers ServerSide), and the Win32 caption is the title bar. Clients that insist on
  CSD (weston-terminal, GTK without SSD) get a frameless `WS_OVERLAPPEDWINDOW` (`WM_NCCALCSIZE` returns 0), which keeps
  the DWM shadow, snap and the minimize/maximize animations. `xdg_toplevel.move` and `resize` start the native modal
  loops (`WM_SYSCOMMAND SC_MOVE|HTCAPTION`, `SC_SIZE+WMSZ_*`), so Snap Layouts work from Linux title bars. Win32 swallows
  the button release during those loops, so the presenter sends a synthetic release afterwards.
* Input: `WM_KEYDOWN` scan codes plus the extended bit become evdev codes (`src/keys.rs`). The host compiles an XKB keymap
  for the Windows layout (fr AZERTY here), so dead keys and AltGr follow the user's layout. The fake left Ctrl that
  Windows injects before AltGr is dropped (same message time, next message is extended right Alt). Repeats are left to
  the client (`wl_keyboard.repeat_info` 30/s after 400 ms). On focus loss every held key is released. F11 toggles
  borderless full screen, and Alt+F4 becomes `xdg_toplevel.close`. Mouse: buttons (with capture), X1/X2, wheel and tilt
  in v120, and `WM_MOUSELEAVE`.
* DPI: the presenter is per-monitor DPI aware (v2), and the host advertises `wp_fractional_scale_v1` with the Windows
  scale (1.25 at 120 dpi). Fractional-scale clients (foot, GTK4, Qt6) render sharp at 125 %. Others get integer scale 2
  and are filtered down. Configure sizes and pointer positions cross the wire in physical pixels.
* Glass: every window gets `DWMWA_USE_IMMERSIVE_DARK_MODE` (follows `AppsUseLightTheme`), `DWMWCP_ROUND` and a system
  backdrop: Mica (`DWMSBT_MAINWINDOW`) by default, Acrylic (`DWMSBT_TRANSIENTWINDOW`) when the client sets an
  `ext-background-effect-v1` blur region. The frame is extended into the whole client area, and the DirectComposition
  swap chain is premultiplied-alpha, so translucent Wayland pixels (for example `foot -o colors.alpha=0.8`) show the
  backdrop. The host samples alpha on every frame and sends `ToplevelEffect` when translucency changes. Reduced
  transparency: when Windows "Transparency effects" is off (`EnableTransparency=0`), the presenter uses
  `DWMSBT_NONE` and an opaque frame. This follows [THEMES.md](THEMES.md): Mica for window bases, Acrylic for transient
  and blurred surfaces. `docs/DESIGN-M3-WINDOWS.md` (design agent) does not exist yet. When it lands, its chrome tokens
  map onto these attributes plus `DWMWA_CAPTION_COLOR` and `DWMWA_BORDER_COLOR`.
* GPU presentation: one D3D11 device on the default adapter, one `IDXGISwapChain1` per window created with
  `CreateSwapChainForComposition` (`FLIP_DISCARD`, BGRA8, 2 buffers) and bound through `IDCompositionTarget` on a
  `WS_EX_NOREDIRECTIONBITMAP` window. DWM composes the flip buffer directly, with no redirection bitmap and no GDI copy.
  Damage rectangles go up with `UpdateSubresource`, followed by one GPU `CopyResource` into the back buffer and
  `Present(0)` (`--vsync` uses `Present(1)`).

## Reused projects and prior art

| Project | What we take |
| --- | --- |
| smithay (`vendor/smithay`, aphrody-labs fork, f581531) | the whole Wayland server side: xdg-shell, decorations, seat/XKB, shm, fractional-scale, viewporter, cursor-shape, ext-background-effect, pixman renderer, damage tracker (`OutputDamageTracker`) |
| WSLg (`vendor/wslg`) | the RAIL idea (one host window per toplevel, title/icon/state sync, Alt+F4 policy); we replace RDP with a direct protocol and take back the input, DPI and backdrop paths |
| Weston RDP backend (`vendor/wayland/weston`, `vendor/wayland/freerdp`) | reference for damage-only updates and the RDP RAIL message set we mirror (window order, min/max, move/size loop) |
| waypipe | the model: terminate Wayland on the Linux side and send buffer contents; we do not copy its protocol (unstable, Linux-to-Linux, fd-replication oriented) |
| Cygwin/X XWin `-multiwindow`, VcXsrv | the Win32 side of "one native window per remote toplevel" (WM_NCHITTEST, modal move/size, AltGr fake-Ctrl filtering); X11-only, GDI-only |
| windows-rs 0.62 | Win32/DWM/DXGI/D3D11/DirectComposition bindings |
| lz4_flex | damage compression |

A web search for 2025-2026 native-Windows Wayland compositors was attempted and failed (search backend anti-bot page). No
project known to us at the 2026-06 knowledge cutoff runs a Wayland server natively on Windows, for reason 1 above.

## Run

```
# Linux side (VPS, any Linux with libxkbcommon and pixman):
scripts/aphrody/build/rust/cargo-serial.sh build --release --manifest-path crates/bunos-wayland-win/Cargo.toml
# Windows side (workstation, or cross from the VPS with cargo xwin --target x86_64-pc-windows-msvc):
cargo build --release --manifest-path crates/bunos-wayland-win/Cargo.toml

bunos-wayland-win --ssh vps --host-bin '~/build/storage/targets/bunos-wayland-win/release/bunos-wlhost' -- foot
bunos-wayland-win --wsl bunos -- foot          # default distro, host binary on PATH inside the distro
bunos-wayland-win --command "socat - VSOCK-CONNECT:<cid>:7000"   # any stream
bunos-wayland-win --backdrop acrylic --stats -- foot -o colors.alpha=0.75
```
