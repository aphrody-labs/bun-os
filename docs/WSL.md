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
no current tag. Refs `615.78.08` (branch and tag, commit `1a82fbfda8f321b056eb3568850f9316c5e465c5`, the highest 6xx tag, not verified newest by date,
2026-10-07) were created in the fork through the Git refs API (objects already in the shared network); its default branch is unchanged.

## 2. Bun OS Arch WSL image (`factory/wsl/`)

| File | Role |
| --- | --- |
| `build-rootfs.sh` | `pacstrap` base into a directory, install the pinned Bun, chroot-run `bunos-wsl.sh`, run the Learn checks (below), write `bunos-wsl.tar.gz`, the same bytes as `bunos-wsl.wsl`, and sha256. Runs only as root in `archlinux:base-devel --privileged` (workflow `wsl-rootfs.yml`). |
| `bunos-wsl.sh` | CachyOS key + keyring + mirrorlists + CachyOS `pacman` fork (same steps and URLs as `cachyos-repo-add-script` `cachyos-repo.sh` e2c90c6), then `factory/distro/cli.ts repo --tier <tier> --conf /etc/pacman.conf` for the v3/v4/znver4 layers (reuses `factory/distro/repos.ts`, nothing duplicated), package lists, Bun, buncc, user, sudo, locale. |
| `wsl-distribution.conf`, `bunos.ico` | `[oobe] defaultUid=1000 defaultName=bunos`, start-menu shortcut with `/usr/lib/wsl/bunos.ico`, Windows Terminal profile (no `oobe.command`: user `bun` already exists). |
| `wsl.conf` | `systemd=true`, `[user] default=bun`, interop on, `appendWindowsPath=false`, automount metadata options. |
| `packages.base`, `packages.cosmic`, `packages.hyprland` | base set (Mesa with the d3d12 gallium driver, `vulkan-dzn`, Wayland, XWayland, Rust, clang); COSMIC group; Hyprland subset of `factory/images/bunos-omarchy/candidate.packages`. |

Decisions:

- **Install paths** (all from Microsoft Learn, fetched 2026-10-29): `wsl --install --no-distribution` installs WSL itself without a distro (first on a machine without WSL); then either `wsl --install --from-file bunos-wsl.wsl [--name N]` or double-click the `.wsl` file (WSL >= 2.4.4; needs `oobe.defaultName`, present), or `wsl --import <name> <dir> bunos-wsl.tar.gz`; or `wsl --import-in-place <name> <ext4.vhdx>` for a ready ext4 VHDX (not produced yet, only the tarball is). gzip tar, because Learn says other compressions risk breaking compatibility with older WSL; `.tar.zst` is not used.
- **Learn "Configuration file recommendations", enforced in `build-rootfs.sh` before archiving:** no `/etc/resolv.conf` (also checked in the archive listing), no password hash in `/etc/shadow` (`root` and `bun` are `!`), root uid 0 in `/etc/passwd`, `bun` uid 1000 = `oobe.defaultUid`, `wsl.conf` and `wsl-distribution.conf` `0644 root:root`, empty `/boot`, no `/usr/lib/modules`, no `vmlinuz`/`initramfs`/`initrd` file.
- **Systemd units masked** (system and `--global` user): the Learn list (`systemd-resolved`, `systemd-networkd`, `NetworkManager`, `systemd-tmpfiles-setup/clean(.timer)/setup-dev(-early)`, `tmp.mount`) plus the rest of `DISCOURAGED_SYSTEM_UNITS` in `microsoft/WSL` `distributions/validate-modern.py` (`*-wait-online`, `networking`, `systemd-vconsole-setup`, `console-getty`, `hypervkvpd`). The earlier revision enabled `systemd-resolved`; that was wrong. `systemd-timesyncd` is no longer enabled either.
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
| Rust minimums for 7.3 | rustc >= 1.85.0, bindgen >= 0.71.1, Clang/LLVM >= 17.0.1 (for `LLVM=1` and libclang), GCC >= 8.1 | `scripts/min-tool-version.sh` @ v7.3 |
| Rust stable now | 1.99.1 (2026-10-13); bindgen-cli 0.73.2 on crates.io, the workflow pins 0.71.1 (the minimum) | static.rust-lang.org, crates.io |
| NVIDIA open modules | highest 6xx tag `615.78.08` (2026-10-07), not the newest by date (see section 6); Arch `nvidia-open`/`nvidia-utils` = 615.78.08 | `git ls-remote`, archlinux.org |
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

### Kernel modules for WSL: a VHD, not a tarball

`modules.tar.zst` cannot be used by WSL. `.wslconfig` `[wsl2]` takes `kernel=` (absolute Windows path to `bzImage`) and `kernelModules=` (absolute Windows path to a modules VHD), paths with escaped backslashes, e.g.
`kernel=C:\wsl\bzImage-7.3` and `kernelModules=C:\wsl\modules-7.3.vhdx` (Learn wsl-config). The VHD layout `<kernelrelease>/{modules,linux-headers,perf}` is produced by Microsoft's `Microsoft/scripts/gen_artifacts_vhdx.sh <modules dir> <headers dir> <perf dir> <kernelrelease> <out>` (read at `a989171`; needs `mke2fs` and `qemu-img`). `build-wsl-kernel.sh` now runs `modules_install`, `headers_install`, a best-effort `tools/perf` build and that script, and emits `modules.vhdx`; `report.json` has `perf_built`. If perf fails to build, `perf/` is empty. Not run yet.

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
- `wsl --install --from-file`, `wsl --import` or `--import-in-place` of the image, `systemd=true` boot, that the masked units leave a working boot, that WSL accepts the generated `modules.vhdx` as `kernelModules=`, WSLg sockets inside this distro, nested Hyprland/COSMIC.
- Any "optimized" claim for 7.3, Rust or NVIDIA. nova-core status is read from Kconfig text only.
- CachyOS `7.3.0-4` was read from `.SRCINFO`; no CachyOS kernel tag or patchset was fetched or compared.

## 6. Corrections of 2026-10-29 (Microsoft Learn audit)

Verified again on Learn pages build-custom-distro, wsl-config and basic-commands before applying: systemd unit list, configuration file recommendations, `kernelModules`, `--no-distribution`, `--from-file`, `--import-in-place`. CI failures on `0a52c6398`: the kernel job stopped on `# CONFIG_... is not set` lines that `olddefconfig` drops for invisible symbols (the check now fails only when such a symbol is `y`/`m`); the nvidia-open jobs lacked `pahole` and `Module.symvers` (`dwarves` installed, `IGNORE_MISSING_MODULE_SYMVERS=1`, compile check only); the rootfs job failed in `arch-chroot` with `/etc/pacman.conf not found` (cause not understood, a fallback copy of the host file plus a listing was added; unverified).
Not adopted: `[boot] command`, `[gpu]`, `[time] useWindowsTimezone`, `[automount] mountFsTab`, `.wslconfig` `systemDistro`; `wsl.conf` is unchanged.

nvidia-open result (CI run 40819800811, the one run that finished that job): **`615.78.08` does not compile unmodified on 7.2.11 or 7.3**: `kernel-open/common/inc/nv-timer.h:58` calls `del_timer_sync()`, which no longer exists (implicit declaration, `-Werror`). The workflow and the `linux-bun` PKGBUILD now rewrite it to `timer_delete_sync()`; whether anything else breaks after that is unknown until the next run. This also means the "nvidia-open for 7.3" claim is currently false without that patch.

Follow-up (Context7/GitHub audit, 2026-10-29). CachyOS keeps four 7.3 patches for NVIDIA in `CachyOS/kernel-patches` `7.3/misc/nvidia` (commit `89bb22dec944`, 2026-10-22). Tested with `git apply --check` on a checkout of `615.78.08` (`1a82fbfda8f3`): `0001` (DSC RC tables), `0002` (Bigscreen Beyond DP workaround) and `0004` (open sysfs config from the userspace root on 7.3+) apply and are vendored unchanged in `factory/kernel/linux-bun/nvidia/patches/`; `0003` (`dmem_cgroup_register_region` takes a struct) **does not apply because `615.78.08` already has that change** (`os-interface.c` line 3055 uses `&init`), so it is skipped. None of the four touches `nv-timer.h`, so the `del_timer_sync` rewrite stays. **Compatibility of nvidia-open with 7.2.11 and 7.3 is NOT VERIFIED** until CI compiles it with these patches.
Tag choice: GitHub release dates are not ordered by version: `595.112.07` 2026-10-22, `615.71.10` 2026-10-21, `615.78.08` 2026-10-07 (the highest 6xx version number, and what Arch `nvidia-open`/`nvidia-utils` ship). `615.78.08` is kept for userspace parity; it is **not verified to be the newest release by date**, and whether `615.71.10` is a later build of a different branch was not determined.
