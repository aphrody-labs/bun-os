# WSLg fork, Wayland, XWayland and Hyprland

Status 2026-10-29. Fork: `aphrody-labs/wslg` (from `microsoft/wslg` `main` at `6942bb534b53`), mounted at
`vendor/wslg` (shallow, `update = none`) and tracked as `submodule:vendor/wslg` in `factory/bunos/components.json`
(edges: depends on `submodule:vendor/omarchy`, consumed by `factory:wsl`). The fork's own patch queue, pins and CI live
in the fork (`docs/BUNOS-PATCHES.md`, `patches/`, `bunos/`, `.github/workflows/bunos-wslg.yml`); this page records the
decisions and the evidence that matter to Bun OS. No WSL instance was started for any of it.

## What this changes in earlier Bun OS notes

* `docs/WSL.md` and `factory/wsl/packages.hyprland` assume Hyprland nested under WSLg's Weston through Aquamarine's
  Wayland backend. Measured against source and CI: that cannot work on the stock WSLg Weston (it has no
  `zwp_linux_dmabuf_v1`, `xdg_wm_base` v1, `wl_compositor` v4, `wl_seat` v7; Aquamarine v0.15.1 binds 9, 6, 6 and dmabuf v4
  and needs a DRM render node). Nested Hyprland has not run anywhere yet. Headless Hyprland has, in CI (below).
* The `PLAN.md` blocker conditions for Omarchy Hyprland are unchanged; this adds evidence only.

## Decision

Primary: Hyprland nested in an upstream Weston 16 RDP-backend host (full desktop through `wslg_desktop.rdp`), with the
Aquamarine bind-version clamp patch. Stretch: Hyprland as the compositor on its headless backend with an RDP bridge
(compositor half runs in CI; bridge not written). Porting WSLg's RDP/RAIL layer to Weston 16 is a prerequisite only for
per-window (RAIL) mapping and is not started (8 to 12 weeks, see the measurements below). A sidecar proxy compositor
is rejected. Full table, evidence and estimates follow (generated in the fork).

## Patch queue

| Patch | What |
|---|---|
| WSLGd: `WSL2_COMPOSITOR` switch | `WSLGd/Compositor.h` (+ unit test, `meson test compositor`), `main.cpp`, `config/hyprland-*.lua`, two `COPY` lines in `Dockerfile`. `weston` (default, upstream behaviour), `hyprland-nested`, `hyprland-headless`; falls back to `weston` with a log line when Hyprland or a DRM render node is missing |
| bunos: source stack + probes | `bunos/`: Arch Dockerfile, pins, committed dependency lists, probes, evidence, aquamarine patch |
| build-and-export.sh | `BUILDER=docker` or `podman`; PulseAudio `.tarball-version` (the stock recipe fails without it, see the local build audit in bun-os) |
| ci | `.github/workflows/bunos-wslg.yml` |
| fix-ups | found by CI: package lists, hyprwire, udis86 submodule, hyprland-protocols is cmake, per-tag Xwayland options, probe honesty fixes |

The vendored Weston/FreeRDP/PulseAudio/Mesa trees are not patched here (cloned at build time from
Microsoft's `*-mirror` `working` branches), so the queue never conflicts with them.

Rebase: `git fetch upstream main && git rebase upstream/main && bunos/check-versions.sh &&
bunos/regen-patches.sh && git push origin main` (normal push, never force). `bunos/verify-patches.sh`
applies the series with `git am` onto current upstream main and fails when upstream moved.

## Pins (re-verified 2026-10-29; full SHAs and dates in `bunos/sources.json`, `bunos/versions.env`)

libwayland 1.26.0 (1.25.91 is a pre-release), wayland-protocols 1.49, Weston 16.0.2 (2026-10-26),
Xwayland: stable xwayland-24.1.14 and RC xwayland-26.0.99.903. Both compile in CI against the
source-built libwayland and wayland-protocols; the stack defaults to the RC because it is the
newest tag that compiles and passes the Xwayland probes (xdpyinfo, rootless, xwayland-shell).
Hyprland v0.57.0 (2026-10-28), aquamarine v0.15.1, hyprutils v0.14.3, hyprlang v0.6.8,
hyprcursor v0.1.13, hyprgraphics v0.5.1, hyprwayland-scanner v0.4.6, hyprland-protocols v0.8.0,
hyprwire v0.3.1 (required by Hyprland 0.57.0; found by the build). hyprland-qtutils v0.1.5 and
hyprland-guiutils v0.2.2 are the newest tags and are not built. Newer FreeRDP (3.32.2) and mesa
(26.2.6) exist; the stock image keeps FreeRDP-mirror and mesa-23.1.0.

## Protocol matrix, before / after

Globals a modern desktop expects, with the minimum version counted as covered. "WSLg Weston today"
is a static extraction from source (`bunos/evidence/weston-mirror-working-globals.json`, commit
`7fbf69314f8a`). The Weston 16.0.2 and Hyprland columns are live `wayland-info` from CI run
40824691248 (headless backends; headless Weston has no `wl_seat`, a real RDP session adds one).
Coverage of the 33 checked globals: WSLg Weston today 4/33, Weston 16.0.2 9/33, Hyprland 0.57.0 33/33.

| global | wanted | WSLg Weston today (static, mirror `working`) | Weston 16.0.2 (live, headless GL) | Hyprland 0.57.0 (live, headless) |
|---|---|---|---|---|
| `wl_compositor` | 6 | 4 | 5 | 6 |
| `wl_seat` | 9 | 7 | - | 9 |
| `wl_output` | 4 | 3 | 4 | 4 |
| `wl_data_device_manager` | 3 | 3 | 3 | 3 |
| `xdg_wm_base` | 6 | 1 | 5 | 7 |
| `zxdg_decoration_manager_v1` | 1 | - | - | 2 |
| `zwlr_layer_shell_v1` | 4 | - | - | 5 |
| `wp_fractional_scale_manager_v1` | 1 | - | - | 1 |
| `wp_viewporter` | 1 | 1 | 1 | 1 |
| `zwp_linux_dmabuf_v1` | 5 | 3 | 5 | 5 |
| `wp_presentation` | 2 | 1 | 2 | 2 |
| `zwp_text_input_manager_v3` | 1 | - | - | 1 |
| `zwp_input_method_manager_v2` | 1 | - | - | 1 |
| `zwp_pointer_constraints_v1` | 1 | 1 | 1 | 1 |
| `zwp_relative_pointer_manager_v1` | 1 | 1 | 1 | 1 |
| `zwp_idle_inhibit_manager_v1` | 1 | - | - | 1 |
| `zwp_primary_selection_device_manager_v1` | 1 | - | - | 1 |
| `ext_session_lock_manager_v1` | 1 | - | - | 1 |
| `xwayland_shell_v1` | 1 | - | - | 1 |
| `wp_cursor_shape_manager_v1` | 1 | - | - | 2 |
| `xdg_activation_v1` | 1 | - | - | 1 |
| `ext_foreign_toplevel_list_v1` | 1 | - | - | 1 |
| `zwlr_foreign_toplevel_manager_v1` | 3 | - | - | 3 |
| `zwlr_output_manager_v1` | 4 | - | - | 4 |
| `zwlr_screencopy_manager_v1` | 3 | - | - | 3 |
| `ext_idle_notifier_v1` | 1 | - | - | 2 |
| `wp_security_context_manager_v1` | 1 | - | - | 1 |
| `zwp_pointer_gestures_v1` | 3 | - | - | 3 |
| `zwp_tablet_manager_v2` | 1 | - | - | 1 |
| `wp_single_pixel_buffer_manager_v1` | 1 | - | 1 | 1 |
| `wp_content_type_manager_v1` | 1 | - | - | 1 |
| `wp_tearing_control_manager_v1` | 1 | - | 1 | 1 |
| `zxdg_output_manager_v1` | 3 | 2 | 2 | 3 |

Stock WSLg Weston also has `weston_rdprail_shell`, `weston_screenshooter`, `wl_shell` and
`zwp_fullscreen_shell_v1`, which Weston 16 dropped or never had. Stock WSLg Weston runs the pixman
renderer only and never calls `linux_dmabuf_setup` (`libweston/backend-rdp/rdp.c` initialises
`pixman_renderer_init`), so it offers no `zwp_linux_dmabuf_v1` at all (the table shows 3, the version
the code would export). Stock Xwayland is launched `-rootless -core -wm` (legacy `WL_SURFACE_ID`
association); Weston 16 offers `xwayland_shell_v1` (probe pass).

## Porting WSLg's RDP/RAIL patches from Weston 9 to Weston 16

Not ported. Measured instead (`bunos/evidence/rail-port-classification.tsv`, static, nothing compiled).
`weston-mirror working` is 217 commits over 9.0.0 (`04d3ae265d8d`): 63 files, +21838/-873 lines.
Each file diff (9.0.0 to mirror) was applied onto 16.0.2 with `git apply --reject`:

* Only in the mirror, to be ported to 16 APIs (19): SECURITY.md, azure-pipelines.yml, clients/rdprail-shell.c, compositor/rdpaudio.c, compositor/rdpaudio.h, compositor/rdpaudioin.c, compositor/rdpdisp.c, compositor/wslgd-notify.c, libweston/backend-rdp/hash.c, libweston/backend-rdp/hash.h, libweston/backend-rdp/rdprail.c, protocol/weston-rdprail-shell.xml, rdprail-shell/app-list.c, rdprail-shell/img-load.c, rdprail-shell/input-panel.c, rdprail-shell/meson.build, rdprail-shell/shell.c, rdprail-shell/shell.h, tests/rdp-teardown-test.c.
* Path exists in both but diverged (4): libweston/backend-rdp/rdp.h, libweston/backend-rdp/rdpclip.c, libweston/backend-rdp/rdpdisp.c, libweston/backend-rdp/rdputil.c. Upstream grew its own RDP clipboard, display-monitor and util code, so these must be merged, not copied.
* Modified file moved or gone in 16 (9): compositor/main.c, compositor/meson.build, compositor/rdpdisp.h, compositor/weston.h, compositor/xwayland.c, include/libweston-desktop/libweston-desktop.h, libweston-desktop/internal.h, libweston-desktop/libweston-desktop.c, libweston-desktop/xwayland.c (`compositor/` became `frontend/`, `libweston-desktop` became `libweston/desktop`).
* Hunks in files that still exist: 43 of 190 apply textually. Worst: libweston/backend-rdp/rdp.c (1/41), xwayland/window-manager.c (17/52), libweston/compositor.c (5/21), include/libweston/libweston.h (1/7), xwayland/selection.c (9/15), xwayland/launcher.c (2/6).
* Apply cleanly: clients/meson.build, libweston/pixman-renderer.c, tests/surface-screenshot-test.c.
* Already upstream in 16: the RDP backend, RDP clipboard (`rdpclip.c`), display monitor (`rdpdisp.c`), a GL renderer for the RDP backend, `xwayland_shell_v1`. Not upstream: the RAIL layer (`rdprail.c`, `rdprail-shell`), `rdpapplist` and `gfxredir` channels (FreeRDP-mirror; not checked against FreeRDP 3), `rdpaudio*`, `wslgd-notify`.
* Broken: all of `rdp.c` but one hunk (1/41), `window-manager.c` 17/52, `compositor.c` 5/21, renderer and shell hooks. A real port needs compile-fix iterations against Weston 16 internals; estimate 8 to 12 engineer-weeks. Not started.

## Options

| | Option | Measured facts | Work | Provable without a Linux host |
|---|---|---|---|---|
| A | Hyprland nested in Weston RDP | aquamarine 0.15.1 binds wl_seat 9, xdg_wm_base 6, wl_compositor 6, dmabuf 4 and needs a DRM node. Stock WSLg Weston: seat 7, xdg 1, compositor 4, no dmabuf. Weston 16.0.2: seat 7, xdg 5, compositor 5, dmabuf 5 (live, with render node). With the clamp patch applied the host still lacks `wl_seat` (headless has none); CI log: "Wayland backend cannot start: Missing protocols". Before the patch an earlier run failed with "invalid version for global zwp_linux_dmabuf_v1: expected at most 3" | 1-2 weeks on Weston 16 `rdp-backend` (a seat should appear on RDP peer activation; unproven) | Build and registry-level probes: done. A nested run needs an RDP client |
| B | Port RDP/RAIL to Weston 16 | see above | 8-12 weeks | compile only |
| C | Hyprland as the compositor, bridge to RDP | aquamarine has backends wayland, drm, headless, null; no RDP (grep). Hyprland 0.57.0 headless ran in CI: `hyprctl` answered, output Virtual-1 1024x768, 72 globals, 33/33 checklist, with a vgem render node and `LIBSEAT_BACKEND=noop`. The WSL2 kernel config of our fork has `CONFIG_DRM=y` and `CONFIG_DRM_VGEM=y` (a render node is plausible on WSL2; not run) | 4-6 weeks for a FreeRDP 3 server bridge (screencopy plus virtual-pointer/keyboard); audio sinks currently terminate in Weston's rdpaudio | Headless half: done in CI. Bridge: handshake testable with a FreeRDP client |
| D | Proxy compositor | cannot add compositor semantics (layer-shell, decorations, scale) | n/a | n/a |

Primary: A on upstream Weston 16 `rdp-backend` (full desktop through `wslg_desktop.rdp`). Every
protocol gate except the seat is measured and passes, and stock WSLg stays untouched. Stretch: C,
whose compositor half already runs; RAIL-style per-window mapping needs B first, or a per-toplevel
capture design. A is not working: no probe has run Hyprland nested on any host.

## CI evidence

Source stack, run `40824691248` (commit `8710f5e`, Linux 7.0.0-1017-azure runner):

| probe | status | detail |
|---|---|---|
| weston16-headless-pixman | pass | 22 globals (`wayland-info`) |
| xwayland-xdpyinfo | pass | Xwayland 26.0.99 (12600099), `xdpyinfo` answered |
| xwayland-rootless | pass | `/usr/local/bin/Xwayland :0 -rootless -listenfd .. -wm .. -terminate` |
| xwayland-shell-v1 | pass | `xwayland_shell_v1` offered once Xwayland started |
| weston-simple-shm | pass | client stayed connected 4 s |
| weston16-headless-gl | pass | `zwp_linux_dmabuf_v1` v5 (needs the render node) |
| weston16-rdp-backend | pass | listens on 127.0.0.1:33890, FreeRDP 3.32.2 (no RAIL) |
| hyprland-binary, hyprctl-binary | pass | Hyprland 0.57.0 at 0aa6745f705f |
| hyprland-headless | pass | `hyprctl` answered, `Virtual-1`, 72 globals |
| hyprland-nested-on-weston16 | fail | wayland backend refused the host: wl_seat missing, xdg_wm_base 5<6, wl_compositor 5<6 (the last two are what the applied clamp patch addresses) |
| weston-info | skipped | not installed by Weston 16.0.2 `-Dtools=info`; `wayland-info` is used |

`wlr-randr` ran before the display variable was set in that run (probe bug, fixed in the following commit).
System distro job (Azure Linux 3.0 recipe plus this queue, run `40817475261`, commit `92a4ffa`): green.
Artifact `wslg-system-distro` holds the tar, the VHD and `vendor-shas.txt`; the image contains
`weston 9.0.0`, `pulseaudio 17.0-25-gc3305`, `/usr/bin/WSLGd` built from the patched source and
`/etc/wslg/hyprland-*.lua`. The Xwayland matrix jobs compile both tags against libwayland 1.26.0 and
wayland-protocols 1.49.

## Not done / unverified

* Nothing ran on WSL; the system distro was never booted. `WSL2_COMPOSITOR` behaviour inside WSLg is
  unrun (only the parsing is unit-tested). In the stock image the Hyprland modes fall back to `weston`.
* `hyprland-nested` against the stock host cannot work (see options). No nested Hyprland run exists.
* No RAIL port, no RDP bridge, no `bunos` Arch system-distro variant (WSLGd needs the mirror's
  FreeRDP/winpr and the RAIL Weston, which an Arch rootfs would not carry).
* Hyprland is not packaged into the stock system-distro image.
* Weston 16 RDP with GL renderer, an RDP client connection, audio and input: not run.
