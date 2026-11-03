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
bunos-wayland-win --glass --backdrop acrylic --stats -- foot -o colors.alpha=0.6
bunos-wayland-win --desktop --host-arg --inflight --host-arg 3 -- weston --backend=wayland --renderer=pixman --width=2048 --height=1152
```

Chrome: `%LOCALAPPDATA%\BunOS\design\windows\bunos-win11-chrome.<mode>.json` (copy of the design artifact
`~/build/storage/artifacts/design/current/windows/`), or `BUNOS_CHROME=<file|artifact dir>`. `BUNOS_XKB_LAYOUT` and
`BUNOS_XKB_VARIANT` override the layout. Host: `--inflight N` (frames in flight, default 2), `--no-xwayland`, `--sink`
(benchmark with an in-process presenter), `--dmabuf` (advertise linux-dmabuf v4 for GBM clients; off by default, see
the WSL results), `--args-env NAME` (argv from a hex-encoded variable, used by `--wsl`), `BUNOS_WLHOST_SCALE`,
`BUNOS_WLHOST_DEBUG=1`. After `--`, one argument is a shell line (`"weston-terminal & xterm"`) and several are an argv.
Xwayland coexists with WSLg: our smithay fork serves the abstract X socket alone when `/tmp/.X11-unix` is read-only.
Benchmarks and checks live in `crates/bunos-wayland-win/bench/` (`wlbench.py`, `ptyrun.py`, `cuda_check.py`,
`cuda_vecadd.cu`).

## Verified (2026-11-03, workstation RTX 4070 + `vps`, Ubuntu 26.10, over `ssh vps`)

Every row below was run in this session. Screenshots were read back from the screen.

| What | Result |
| --- | --- |
| foot from `vps` as a native window | Win32 window "foot", D3D11 flip on the RTX 4070, design-spec dark caption, rounded corners, crisp at 125 % (fractional-scale 1.25, 873x613 px) |
| Keyboard | `echo azerty é@#~ $XDG_SESSION_TYPE; uname -n` typed into foot with the French AZERTY layout. It printed `azerty é@#~ wayland` and `vps-203bea89`. AltGr characters, Enter and injected text all arrive |
| Resize | GlazeWM tiling resized the window; foot reflowed through `Configure` |
| Mouse | clicks in a nested Weston desktop (its launcher started weston-terminal), pointer motion, buttons |
| Client-side decorations | weston-terminal ("Wayland Terminal") mapped frameless; its title bar drives the native move loop |
| X11 | xterm and glxgears through rootless Xwayland and the smithay X11 WM, each as its own Win32 window |
| Glass | `foot -o colors.alpha=0.6 -e htop` with `--glass --backdrop acrylic`: DWM Acrylic blur of the desktop behind the terminal text |
| Full-screen desktop | `weston --backend=wayland` nested, 2560x1440 borderless full screen (`--desktop`), its panel, clock and launcher usable |
| Nested sway | starts (`WLR_RENDERER=pixman`), frames flow |
| Nested Hyprland | fails on `vps`: needs EGL and a DRM render node, and the VPS has no GPU (as recorded in [WSLG.md](WSLG.md)) |

### Numbers

Compositor alone (`bunos-wlhost --sink`: the in-process presenter decodes lz4 and blits, with immediate acks, on `vps`,
12 vCPU, no GPU, software clients):

| Client | Frames/s | Render (pixman) | Raw / wire |
| --- | --- | --- | --- |
| weston-simple-shm | 1 287 | 0.32 ms | 240 MB/s / 34 MB/s |
| vkcube (lavapipe) | 543 | 0.74 ms | 543 MB/s / 22 MB/s |
| weston-simple-egl (llvmpipe) | 1 148 | 0.11 ms | 74 MB/s / 24 MB/s |
| glxgears (X11, Xwayland) | 1 062 | 0.28 ms | 382 MB/s / 13 MB/s |

Over the WAN (`ssh vps` from the workstation: echo RTT median 61 ms, min 43 ms; OpenSSH without a tty keeps Nagle on):

| Path | Frames/s | Ack RTT | Windows apply+present |
| --- | --- | --- | --- |
| vkcube, 1 frame in flight | 8-12 | 90 ms | 0.9-1.1 ms/frame (lz4 + UpdateSubresource + flip) |
| vkcube, 3 frames in flight | 21-30 | 91-138 ms | 1.2 ms/frame |
| nested Weston 2560x1440 full-screen damage | 1.6 | 740 ms | 12.7 ms/frame (14.7 MB raw per frame) |
| foot, typing | 0.8 frames/s idle, one damage rectangle per keystroke | 78-97 ms | 1.3 ms |

### Default backend: the `bunos` WSL distro (2026-11-03)

Setup: WSL 3.0.4, our 7.3.1 kernel, `/dev/dxg`, RTX 4070. Mesa is `bunos-mesa` 26.3.0-rc3 (d3d12 Gallium driver plus
`bunos-vulkan-dzn`), installed by the Mesa agent at 08:49. bunos-wlhost was built inside the distro
(`cargo build --release` against the checkout on `/mnt/c`) and installed as `/usr/local/bin/bunos-wlhost`. The run
command was `bunos-wayland-win --wsl bunos --host-bin /usr/local/bin/bunos-wlhost -- <app>`. The host argv crosses
`wsl.exe` hex-encoded in `BUNOS_WLHOST_ARGS` through `WSLENV`, because `wsl.exe --exec` re-splits arguments on spaces.
Under bunos-wlhost, `eglinfo` reports `D3D12 (NVIDIA GeForce RTX 4070)` for GL, GLES and core profiles, and
`vulkaninfo` reports `Microsoft Direct3D12 (NVIDIA GeForce RTX 4070)` with driver `Mesa 26.3.0-rc3-bunos.1`.

Client-side numbers come from `bench/wlbench.py`. It runs the client with `WAYLAND_DEBUG=client` and reports
`wl_surface.commit`/s, plus commit-to-`wl_callback.done` turnaround (the time until the compositor lets the client draw
again). Ours releases the callback when the frame is shown on Windows, so turnaround is the end-to-end display round
trip. glxgears prints its own FPS (`bench/ptyrun.py` keeps its stdout line-buffered). Presenter numbers come from
`--stats`.

| App (GPU) | Client frames/s | Turnaround median / p95 | Shown on Windows | Windows apply+present |
| --- | --- | --- | --- | --- |
| weston-simple-egl (GLES, d3d12) | 404 commits/s | 0.66 / 1.05 ms | 405 fps | 0.40 ms |
| vkcube (Vulkan, Dozen) | 323 commits/s | 2.97 / 3.84 ms | 331 fps | 0.84 ms |
| glxgears (GL via our Xwayland `:1`, `vblank_mode=0`) | 88-93 FPS | ack 1.8 ms | 88 fps | 1.25 ms |
| foot, `ls -la /usr/lib` in a loop | 82 fps (host) | ack 2.8-10 ms | 79-91 fps | 1.7 ms |
| nested cosmic-comp + foot (GLES on d3d12, winit backend) | 274-354 fps of compositor output | ack 1.9-3.4 ms | 309-453 fps | 1.3-3.9 ms |
| compositor only, `--sink` (no Windows): vkcube / weston-simple-egl / glmark2-es2 | 667 / 801 / 271 fps | 0.1-0.6 ms | - | - |

### WSLg (msrdc) against bunos-wayland-win (2026-11-03, 14:15-14:22)

Same harness, same apps, same distro, back to back on the shared workstation (other agents' builds running): WSLg
through `XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir WAYLAND_DISPLAY=wayland-0 DISPLAY=:0`, ours through
`bunos-wayland-win --wsl bunos --stats` (host binary built from the checkout). `wlbench.py 14 4 <app>`; glxgears with
`vblank_mode=0` through `ptyrun.py 16`; foot runs `ls -la /usr/lib` in a loop. Turnaround is commit to
`wl_callback.done`: how long the compositor makes the client wait before the next frame.

| App | WSLg: frames/s, turnaround median / p95 | bunos-wayland-win: frames/s, turnaround median / p95 | Ours, Windows side (`--stats`) |
| --- | --- | --- | --- |
| weston-simple-egl (GLES, d3d12) | 62.0, 14.72 / 15.02 ms | 439.9, 0.66 / 0.78 ms | 390-437 fps, ack 0.6-0.9 ms |
| vkcube (Vulkan, Dozen, `--wsi wayland`) | 61.7, 16.19 / 16.28 ms | 294.6, 3.35 / 3.71 ms | 227-294 fps, ack 3.4 ms |
| foot, output loop | 61.7, 14.12 / 15.76 ms | 90.5, 1.49 / 2.08 ms | 89-93 fps, ack 1.9-2.2 ms |
| glxgears (X11 through each side's Xwayland) | 121-138 FPS | 109-114 FPS | 86-115 fps, ack 1.6 ms |

WSLg paces every Wayland client to 60 Hz: Weston's RDP repaint loop releases frame callbacks once per 16.7 ms, so a
client always waits 14-16 ms, whatever it draws. Ours releases a callback when Windows has shown the frame (`Present(0)`;
`--vsync` paces to the display instead), so the wait is the round trip itself: 0.7 ms for GLES, 3.4 ms for Dozen Vulkan
(pixman composition of a 1 MB frame), 1.5 ms for foot. X11 is the one case where WSLg is ahead: its Xwayland is not
throttled to the RDP repaint, while ours composes each glxgears frame through pixman and the presenter's ack (about
110 FPS). Both stayed stable over the runs; WSLg no longer crashes since the session-0 fix ([WSL.md](WSL.md) section 8).

Nested compositors in the distro:

* **cosmic-comp 1.11** (Arch `cachyos-extra-v3` package) runs nested on its winit backend with hardware EGL on Mesa d3d12
  (`PLATFORM_WAYLAND_KHR`, `hardware_accelerated: true`). Its COSMIC session (gradient background, a COSMIC-decorated
  foot) appears in one native window. When resized it logs an `EGL_BAD_ALLOC` on surface re-creation and recovers.
* **Hyprland 0.57 and Omarchy** run nested since 2026-11-03, on the CPU. Started as
  `bunos-wayland-win --wsl bunos --host-arg --dmabuf -- env LIBGL_ALWAYS_SOFTWARE=1 Hyprland` (Omarchy: the same with
  Omarchy's `~/.config/hypr`, under `dbus-run-session`). Aquamarine's Wayland backend allocates its swapchain with GBM on
  the node the host's dmabuf feedback names. That node used to be vgem, which has no GBM/EGL driver (`DRI2: failed to
  create screen`). The host now names the kernel's vkms KMS node instead (`/dev/dri/card1`; order:
  `BUNOS_WLHOST_DMABUF_NODE`, a render node whose driver is not vgem, a KMS node; Aquamarine opens the primary node when
  the device has no render node). Mesa's kms_swrast allocates linear XR24 dumb buffers there, llvmpipe renders into
  them, and the host maps them through pixman's dmabuf import. Measured: Hyprland with its wallpaper and a foot client
  at 100-155 fps to the Windows window (ack 6-10 ms, host render 5-8 ms per 493x1350 frame); Omarchy with its
  Quickshell bar, dock and notifications (layers `omarchy-bar`, `omarchy-dock`, `omarchy-background`), about 8-30 fps
  when idle. `--dmabuf` stays opt-in: when it is advertised, Mesa's WSI prefers it and Dozen vkcube hangs.
  GPU rendering for Hyprland is not possible on WSL2 (next section).

## GPU: what is and is not zero-copy

* On the Windows side, copies are already minimal. Each damage rectangle is uploaded once (`UpdateSubresource`), then a
  GPU-to-GPU copy into the flip buffer. The DWM composes that buffer directly (flip model, no redirection bitmap), and
  in `--desktop` mode it can be promoted to independent flip. The presenter does no CPU compositing.
* On the Linux side, the current renderer is pixman (CPU). It works on any Linux, GPU or not, and accepts shm buffers.
  Linear dmabufs are mapped through `PixmanRenderer`'s dmabuf import when `--dmabuf` advertises `zwp_linux_dmabuf_v1`.
* WSL2 zero-copy is possible in principle. Inside WSL2, Mesa's d3d12 Gallium driver (and dozen for Vulkan) renders into
  D3D12 resources that dxgkrnl (`/dev/dxg`) allocates on the host GPU. Those allocations are host-GPU memory. The
  dxgkrnl ioctl set has shared-handle export (`D3DKMTShareObjects` / NT handles via `dxgk_share_objects`), but no
  public user-space path exposes a guest dmabuf as a Windows NT handle the presenter could
  `OpenSharedResource1`. WSLg does not do it either: Weston's RDP backend copies through pixman, and only the CPU
  bitmap goes over a shared-memory "VAIL" channel. True zero-copy needs (a) a d3d12-backed renderer in bunos-wlhost
  that keeps each toplevel in a D3D12 resource created shareable, (b) a host-side helper that turns the dxgkrnl share
  into an NT handle, and (c) `ID3D11Device1::OpenSharedResource1` in the presenter plus a keyed mutex or fence for
  synchronisation. This is not built. It is the largest open GPU item.
* Why GPU dmabufs (and so a GPU-rendered Hyprland) cannot exist on WSL2 today, from the sources we build:
  dxgkrnl (`factory/wsl/kernel/patches/0006-dxgkrnl.patch`, `drivers/hv/dxgkrnl/ioctl.c` `get_object_fd`) exports a
  shared resource as an `anon_inode_getfile("dxgresource")` file and a sync object as `"dxgsyncobj"` or a `sync_file`;
  it never calls `dma_buf_export`, so no `/dev/dxg` allocation is a dmabuf that DRM, GBM or another process's EGL can
  import. Mesa's d3d12 driver has no DRM device to sit on (WSL exposes no DRM node for the GPU, only vgem and vkms), so
  the GBM/DRI loader can never pick it, and the fd a d3d12 resource can be shared as is that dxgkrnl file, which only
  D3D12 (`OpenSharedHandle`) understands. Aquamarine and Hyprland 0.57 render with GLES only (no pixman or Vulkan
  renderer), so their only working path is the one above: llvmpipe into kms_swrast dumb buffers on vkms. Closing the gap
  needs either dma-buf export in dxgkrnl (a kernel change: `dma_buf_export` over the guest mapping of the allocation)
  plus a d3d12 GBM backend in Mesa, or a Hyprland renderer that draws through d3d12 and hands the host shared D3D12
  resources (the zero-copy item above).
* The fastest path available now in WSL2 is a GLES renderer on Mesa d3d12 (`/dev/dxg`) in the host for GPU clients,
  with readback into the same damage-rectangle stream. For a remote Linux, the stream is the only path.

## CUDA

The machine has an NVIDIA GeForce RTX 4070 (12 GB, compute capability 8.9, PCIe gen 4), driver 617.42 (WDDM),
`CUDA UMD Version: 13.4` (`nvidia-smi`, verified). The driver ships the WSL user-mode libraries that WSL mounts at
`/usr/lib/wsl/lib`: `C:\Windows\System32\lxss\lib` holds `libcuda.so.1.1`, `libcudadebugger.so.1`, `libnvcuvid.so`,
`libnvidia-encode.so`, `libnvidia-ml.so.1`, `libnvidia-opticalflow.so`, `libnvoptix.so.1`, `libnvdxdlkernels.so`,
`libnvwgf2umx.so` and `nvidia-smi`. WSL 3.0.4 ships `libd3d12.so`, `libd3d12core.so` and `libdxcore.so` in
`C:\Program Files\WSL\lib` (verified).

Verified inside `bunos` on 2026-11-03:

* `/usr/lib/wsl/lib/nvidia-smi`: `NVIDIA GeForce RTX 4070, 617.42, 12282 MiB, compute_cap 8.9`, with
  `NVIDIA-SMI 615.78.05 / KMD 617.42 / CUDA UMD 13.4`.
* `bench/cuda_check.py` (no toolkit; ctypes on `/usr/lib/wsl/lib/libcuda.so.1`, hand-written PTX JIT-compiled by the
  driver): driver CUDA 13.4, sm_89, 46 SMs, 12.0 GiB. saxpy over 64 Mi floats runs in 2.26 ms/launch, 356 GB/s
  effective. Pageable H2D 6.5 GB/s, D2H 9.0 GB/s. PASS.
* `pacman -S cuda` (13.4.3, Arch `extra`; `nvcc` V13.4.92 at `/opt/cuda/bin`), then
  `nvcc -O3 -arch=sm_89 bench/cuda_vecadd.cu`: vecadd over 64 Mi floats runs in 2.202 ms/launch, 366 GB/s (the 4070
  peak is 504 GB/s). Pinned H2D 20.7 GB/s, D2H 17.1 GB/s. PASS.

Other checks:

```
ls /usr/lib/wsl/lib/libcuda.so.1 && /usr/lib/wsl/lib/nvidia-smi          # driver libs mounted, GPU visible
pacman -S cuda                                                             # toolkit only; never install a Linux NVIDIA driver in WSL
git submodule update --init --depth 1 vendor/cuda-samples                  # NVIDIA/cuda-samples, not checked out by default
cmake -S vendor/cuda-samples -B /tmp/cs -DCMAKE_CUDA_ARCHITECTURES=89 && cmake --build /tmp/cs --target deviceQuery bandwidthTest -j
# llama.cpp with CUDA: vendor/bun-llama/native/build.ts builds the pinned llama.cpp; add -DGGML_CUDA=ON to its cmake step
```

`LD_LIBRARY_PATH` must contain `/usr/lib/wsl/lib` before any distro `libcuda`. Use `CUDA_ARCHITECTURES=89` (Ada) for
the 4070. CUDA-to-presenter interop (a CUDA-rendered frame shown without readback) would need the same shared-handle
path as Mesa d3d12 above, so it remains open.

## Not done yet

* No zero-copy GPU path (above). `zwp_linux_dmabuf_v1` (`--dmabuf`) carries CPU-rendered dmabufs only: Hyprland and
  Omarchy nest on llvmpipe through vkms dumb buffers; nothing GPU-rendered can feed it on WSL2.
* The WSLg crash loop (its Weston died with SIGSEGV every ~100 s) is fixed (msrdc ran in session 0 because the BunOSWsl service created the VM;
  [WSL.md](WSL.md) section 8). The WSLg comparison is above.
* bunos-wlhost is not packaged yet. In the distro it is built from the checkout and installed in
  `/usr/local/bin`. A PKGBUILD needs the crate and `vendor/smithay` from this repository as its source. That is for
  the desktop agent's `factory/desktop/pkgbuilds/` (`bunos-wayland-win`, makedepends `cargo`, depends
  `libxkbcommon pixman xorg-xwayland`).
* A CUDA build of llama.cpp (`vendor/bun-llama/native/build.ts` with `-DGGML_CUDA=ON`) was not run. The toolkit and
  the driver path are verified above.
* hvsocket transport: works today through `--command` with `socat VSOCK-CONNECT`. A native AF_HYPERV connector in the
  presenter (as in `crates/bunos-nt-bridge`) is not written.
* xdg popups are rendered inside their toplevel, so menus that extend past the window are clipped. X11
  override-redirect windows already get their own owned Win32 popup windows. Wayland popups should get the same.
* Not implemented: clipboard to and from Windows, text-input-v3 / Windows IME, primary selection, xdg-activation,
  window icons, multi-monitor output mapping (one output equals the primary monitor), KDE `org_kde_kwin_blur` (only
  `ext-background-effect-v1`), cursor bitmaps (named cursors only), touch and pen, audio.
* COSMIC and GNOME 51 from `[bunos-testing]` run nested under bunos-wlhost in the distro (COSMIC 0.87 s, GNOME devkit
  2.4 s to the window; [DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md), "Run on the workstation").
* Frame pacing uses acks only. There is no `wp_presentation` feedback from DWM (`DwmGetCompositionTimingInfo`) yet.
* The Windows binary is test-signed (`factory/windows/signing/test-signing.ps1 sign`: `CN=Bun OS Test Signing`, SHA-256,
  DigiCert RFC 3161 timestamp, `Get-AuthenticodeSignature` Valid). Packaging and an installer are still to do.
