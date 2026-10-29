# Bun OS on WSL: forks, distro image, kernel port

Recorded 2026-10-29. Rule for this page: a line says "verified" only when a command was run in this session and its
output read; everything else is listed under "Not verified". WSL was never started on the workstation, no remote host was
used, no Linux build ran locally. Build checks are GitHub Actions workflows (`.github/workflows/wsl-*.yml`), not yet run.

## 1. Forks and divergence from upstream

| Fork (aphrody-labs) | Upstream | Branch | Our commits | Upstream commits we lacked | Action | Head after (verified on origin) |
| --- | --- | --- | --- | --- | --- | --- |
| `WSL` | `microsoft/WSL` | `master` | 0 | 119 | fast-forward (`merge-upstream` API) | `afa988cfb498fb9794718683823fb38dbc96673d` (equals upstream) |
| `WSL2-Linux-Kernel` | `microsoft/WSL2-Linux-Kernel` | `linux-msft-wsl-6.18.y` | 0 | 1496 | fast-forward | `a989171929bed4ea681be8d77333845ce1c1732a` (equals upstream and tag `linux-msft-wsl-6.18.58.1`) |
| `weston-mirror` (WSLg compositor) | `microsoft/weston-mirror` | `working` | 0 | 0 | none | identical |
| WSLg (`microsoft/wslg`) | - | - | - | - | **no fork exists** (`gh repo list aphrody-labs` has no `wslg`); nothing created | upstream `main`, release branch `release/1.0.73` |

Both merges were pure fast-forwards: the forks carried no custom commits, so there was nothing to conflict.

Upstream releases seen (GitHub API, 2026-10-29): WSL `3.0.4` (2026-10-20, pre-release; `3.0.3` is the latest non-pre-release);
WSLg latest release `v1.0.71` (pre-release, dated 2025-10-06; `v1.0.66` is the latest stable); WSL2 kernel tag
`linux-msft-wsl-6.18.58.1` (2026-10-27). Microsoft kernel branches: `linux-msft-wsl-{4.19,5.4,5.10,5.15,6.1,6.6,6.18}.y` and
`master`; nothing newer than 6.18 exists upstream.

Related forks (not modified, listed for the owner; `ahead` = upstream commits we lack, `ours` = commits only we have):

| Fork | Upstream:branch | ahead | ours |
| --- | --- | --- | --- |
| `linux` | `gregkh/linux:master` | 3407 | 0 |
| `linux-cachyos` | `CachyOS/linux-cachyos:master` | 7 | 0 |
| `cachyos-pkgbuilds` | `CachyOS/CachyOS-PKGBUILDS:master` | 64 | 0 |
| `omarchy` | `omacom/omarchy:quattro` | 383 | 0 |
| `omarchy-pkgs` | `omacom/omarchy-pkgs:master` | 886 | 0 |
| `hyprland-preview-share-picker` | `WhySoBad/...:master` | 8 | 0 |
| `uutils-util-linux` | `uutils/util-linux:main` | 22 | 0 |
| `ogc-gamescope` | `OpenGamingCollective/gamescope:ogc` | 38 | 22 (diverged) |
| `try-omarchy-windows` | `omacom/try-omarchy-windows:master` | 37 | 1 (diverged) |
| `cachyos-linux`, `kernel-packages`, `ogc-kernel-packages`, `ogc-linux`, `ogc-arch-packaging`, `nvidia-kernels`, `open-gpu-kernel-modules`, `omarchy-task-manager`, `steamos-nvidia-installer` | various | 0 | 0 |

`open-gpu-kernel-modules` forks `CachyOS/open-gpu-kernel-modules` (default `560-cachyos`), not NVIDIA's repository, so it had
no current tag. Refs `615.78.08` (branch and tag, commit `1a82fbfda8f321b056eb3568850f9316c5e465c5`, the newest NVIDIA tag,
2026-10-07) were created in the fork through the Git refs API (objects already in the shared network); its default branch is unchanged.

## 2. Bun OS Arch WSL image (`factory/wsl/`)

| File | Role |
| --- | --- |
| `build-rootfs.sh` | `pacstrap` base into a directory, install the pinned Bun, chroot-run `bunos-wsl.sh`, write `bunos-wsl.tar.gz` + sha256. Runs only as root in `archlinux:base-devel --privileged` (workflow `wsl-rootfs.yml`). |
| `bunos-wsl.sh` | CachyOS key + keyring + mirrorlists + CachyOS `pacman` fork (same steps and URLs as `cachyos-repo-add-script` `cachyos-repo.sh` e2c90c6), then `factory/distro/cli.ts repo --tier <tier> --conf /etc/pacman.conf` for the v3/v4/znver4 layers (reuses `factory/distro/repos.ts`, nothing duplicated), package lists, Bun, buncc, user, sudo, locale. |
| `wsl.conf` | `systemd=true`, `[user] default=bun`, interop on, `appendWindowsPath=false`, automount metadata options. |
| `packages.base`, `packages.cosmic`, `packages.hyprland` | base set (Mesa with the d3d12 gallium driver, `vulkan-dzn`, Wayland, XWayland, Rust, clang); COSMIC group; Hyprland subset of `factory/images/bunos-omarchy/candidate.packages`. |

Decisions:

- **Import with `wsl --import <name> <dir> bunos-wsl.tar.gz`.** gzip tar, because `.tar.zst` support in `wsl --import` was not confirmed.
- **No kernel, firmware or NVIDIA package in the guest.** WSL supplies the kernel (`.wslconfig` `kernel=` selects ours) and the GPU path.
- **Bun** is the unmodified official npm canary `1.4.4-canary.20261028.1` (`@oven/bun-linux-x64`), sha256 `a9b0e5d2...f6796c` as pinned in `factory/usr/pkgs/bun-canary/PKGBUILD`.
- **buncc** is not published to npm (docs/BUNCC.md), so the workspace sources ship in `/opt/bunos/buncc` with `/usr/local/bin/buncc`.
- **Default user `bun`, password locked, passwordless `wheel`**: a WSL distro has no first-run prompt on `--import`; the Windows user already owns the VM. Change this if the image is shared.
- **Tier default `x86-64-v3`.** CachyOS's v3/v4 repositories need CachyOS's `pacman` fork (`Architecture = auto`); stock Arch pacman is not enough. `BUNOS_TIER=x86-64` skips CachyOS entirely (stock Arch only).

### WSLg and Hyprland

Verified from the `microsoft/wslg` README and `WSLGd/main.cpp`: WSLg runs Weston with an extended **RDP backend (RAIL/VAIL)**,
XWayland and PulseAudio in a separate system distro; sockets live in `/mnt/wslg` (`runtime-dir/wayland-0`, `.X11-unix`, `PulseServer`)
and WSLGd sets `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`, `PULSE_SERVER` in the user distro. OpenGL goes through Mesa's `d3d12` gallium driver
over `/dev/dxg`; frames reach Weston through system memory. `config-wsl` of the WSL kernel has `CONFIG_DRM_VGEM=y` and `CONFIG_DXGKRNL=y`.

Consequence for Hyprland: WSLg gives **no DRM/KMS output, no seat and no wlroots-class backend**. Hyprland (Aquamarine) can only run
as a **nested Wayland client inside a Weston window** (`start-hyprland` style nested session), if Aquamarine's Wayland backend and its GBM
allocator work on the vgem render node and Mesa d3d12. That is the only feasible shape, and it is **not tested**. `PLAN.md` already says
Omarchy Hyprland is blocked; this does not unblock it. The `hyprland` profile exists so CI/Linux can try it; COSMIC (`cosmic-comp`
has a winit/Wayland backend) is the same kind of experiment. For a full desktop the existing alternatives stay valid:
the `try-omarchy-windows` QEMU guest path in `factory/images/bunos-omarchy`, or VNC (`wayvnc` is in the Hyprland list).

## 3. Kernel: facts

| Item | Value | Source (2026-10-29) |
| --- | --- | --- |
| Mainline | **7.3**, released 2026-10-18, not EOL | `kernel.org/releases.json` |
| Stable | 7.2.13 (2026-10-26) | same |
| Longterm | 6.18.59 (2026-10-26), 6.12.114, 6.6.160, 6.1.190, 5.15.223, 5.10.272 | same |
| Microsoft WSL2 | 6.18.y only: tag `linux-msft-wsl-6.18.58.1` = `v6.18.58` + WSL patches | GitHub API; diff `v6.18.58..a989171` |
| CachyOS | `linux-cachyos` PKGBUILD `pkgver = 7.3.0`, `pkgrel = 4` (default branch commit 2026-10-23); `cachyos-linux` fork (`7.0/cachy`) is stale | `.SRCINFO` raw |
| Rust minimums for 7.3 | rustc >= 1.85.0, bindgen >= 0.71.1, Clang/LLVM >= 17.0.1 (for `LLVM=1` and libclang), GCC >= 8.1 | `scripts/min-tool-versions.sh` @ v7.3 |
| Rust stable now | 1.99.1 (2026-10-13); bindgen-cli 0.73.2 on crates.io, the workflow pins 0.71.1 (the minimum) | static.rust-lang.org, crates.io |
| NVIDIA open modules | newest tag `615.78.08` (2026-10-07); Arch `nvidia-open`/`nvidia-utils` = 615.78.08 | `git ls-remote`, archlinux.org |
| In-tree Rust NVIDIA | `nova-core` exists in v7.3, "work in progress and may not be functional" | `drivers/gpu/nova-core/Kconfig` |

"7.3 optimized for Rust and NVIDIA" is **not claimed**: nothing is built, so nothing is measured.

## 4. WSL2 patch series ported to v7.3

`git diff v6.18.58 a989171` is 52 files (+35,784 / -92): the entire Microsoft delta. Per-file 3-way merge (`git merge-file`, base `v6.18.58`,
ours `v7.3`, theirs Microsoft), with the tree-level result turned into `factory/wsl/kernel/patches/` (they apply with `git apply --check` to
the unmodified `v7.3` files they touch):

| Patch | Content | Result against v7.3 |
| --- | --- | --- |
| `0001-hyperv-core` | `mshyperv`, `hyperv_timer`, vmbus channel/connection, `hyperv.h`, arm64 hyperv | merged clean |
| `0002-hv-netvsc` | netvsc rescind-aware NVSP wait, rndis_filter | **1 textual conflict** in `netvsc.c`: upstream added `netvsc_wq` next to Microsoft's new helper; resolved by keeping both (`merge-file --union`) |
| `0003-hv-pci` | `pci-hyperv.c` (+178) | merged clean |
| `0004-swiotlb` | `kernel/dma/swiotlb.c`, `swiotlb.h` | merged clean |
| `0005-virtiofs` | `fs/fuse/virtio_fs.c` | merged clean; `fs/fuse/file.c` change (6 lines) is **already in v7.3** (no diff left) |
| `0006-dxgkrnl` | `drivers/hv/dxgkrnl/*` (18.5k lines, new), `d3dkmthk.h`, Kconfig, Makefile | added clean; `drivers/hv/Kconfig` and `drivers/hv/Makefile` conflicted only because upstream added `MSHV_VTL` entries at the same spot: resolved by keeping both |

Not in the series on purpose: `Makefile` (version/EXTRAVERSION conflict, trivial), `MAINTAINERS`, `README*`, `SECURITY.md`, `MSFT-Merge/log`,
`Microsoft/scripts` and the two `config-wsl` files (regenerated by the build script with `olddefconfig` + the fragment).
Totals: 4 files conflicted textually (all four resolved above), 17 merged, 27 added, 4 upstream-unchanged. **Merge is textual only: whether `dxgkrnl` still
compiles against v7.3 internal APIs (6.18 -> 7.3) is unknown** and is exactly what the `wsl-kernel.yml` build checks. No Microsoft commit history was
replayed (a depth-1500 blobless fetch of the history stalled on GitHub), so this is a squashed per-area series, not Microsoft's individual commits.

### Config fragment (`factory/wsl/kernel/wsl-rust.config`)

Merged over Microsoft's `config-wsl` (6.18.52.3) after `olddefconfig`. Verified in the real files: `config-wsl` has `CONFIG_MODVERSIONS=y`, which
**blocks `CONFIG_RUST`** (needs `!MODVERSIONS` or `GENDWARFKSYMS`), so the fragment disables it; `RUST_DEBUG_ASSERTIONS`, `RUST_OVERFLOW_CHECKS`, `RUST_BUILD_ASSERT_ALLOW`, `RUST_KERNEL_DOCTESTS`,
`RUST_INLINE_HELPERS` and `SAMPLES_RUST` are off; `DXGKRNL=y`; `NOVA_CORE` and `DRM_NOUVEAU` off; `LOCALVERSION="-microsoft-standard-WSL2"`. All symbol names exist in the v7.3 Kconfig.
`build-wsl-kernel.sh` fails if a fragment line does not survive `olddefconfig`.

### NVIDIA on WSL: no in-guest module

WSL reaches the Windows driver through `/dev/dxg` and the libraries WSL mounts at `/usr/lib/wsl/lib` (`libcuda.so`, `libd3d12.so`, `libdxcore.so`). `nvidia-open` is not built for WSL.
`nvidia-open` applies to the **bare-metal `linux-bun` kernel**: `factory/kernel/linux-bun/nvidia/` holds the config fragment (`nvidia-open.config`: DRM KMS helpers + fbdev emulation, HMM/`DEVICE_PRIVATE`, PAT, nouveau and nova-core off)
and a prebuilt-module `PKGBUILD` pinned to commit `1a82fbfda8f3` of our fork. `linux-bun` itself is still pinned to Arch's 7.2.11 (Arch has no 7.3); the same CI job compiles the modules against both 7.2.11 and 7.3 headers.

## 5. Not verified (needs CI or a Linux host)

- Any workflow run: `wsl-kernel.yml` (kernel build, `make rustavailable`, size/time report in the job summary and `report.json`, nvidia-open compile on 7.2.11 and 7.3) and `wsl-rootfs.yml` (rootfs build). Both are unbuilt.
- That `dxgkrnl` and the Hyper-V patches compile and work on 7.3; that the kernel boots under WSL; that Rust objects build with rustc 1.99.1 + bindgen 0.71.1 on the runner.
- Whether CachyOS v3/v4 repos install cleanly in the chroot (mirror still serving the pinned `cachyos-keyring-20240331-1`, `cachyos-mirrorlist-27-1`, `pacman-7.1.0.r9.g54d9411-5` files; they may have been superseded).
- `wsl --import` of the tarball, `systemd=true` boot, `.tar.zst` import support, WSLg sockets inside this distro, nested Hyprland/COSMIC.
- Any "optimized" claim for 7.3, Rust or NVIDIA. nova-core status is read from Kconfig text only.
- CachyOS `7.3.0-4` was read from `.SRCINFO`; no CachyOS kernel tag or patchset was fetched or compared.
