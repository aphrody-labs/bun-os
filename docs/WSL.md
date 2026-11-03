# Bun OS on WSL: forks, distro image, kernel port

Recorded 2026-10-29. Rule for this page: a line says "verified" only when a command was run in this session and its
output read; everything else is listed under "Not verified". Sections 1-6 date from before WSL ran on the workstation;
since 2026-11-03 the workstation runs the Bun OS bundle and section 8 records what was installed and measured there.

## 1. Forks and divergence from upstream

| Fork (aphrody-labs) | Upstream | Branch | Our commits | Upstream commits we lacked | Action | Head after (verified on origin) |
| --- | --- | --- | --- | --- | --- | --- |
| `WSL` | `microsoft/WSL` | `master` | 0 | 119 | fast-forward (`merge-upstream` API) | `afa988cfb498fb9794718683823fb38dbc96673d` (equals upstream) |
| `WSL2-Linux-Kernel` | `microsoft/WSL2-Linux-Kernel` | `linux-msft-wsl-6.18.y` | 0 | 1496 | fast-forward | `a989171929bed4ea681be8d77333845ce1c1732a` (equals upstream and tag `linux-msft-wsl-6.18.58.1`) |
| `weston-mirror` (WSLg compositor) | `microsoft/weston-mirror` | `working` | 0 | 0 | none | identical |
| WSLg (`microsoft/wslg`) | `microsoft/wslg` | `main` | 0 at creation, now a patch queue | 0 | fork exists (`aphrody-labs/wslg`, mounted at `vendor/wslg`); see `docs/WSLG.md` | `6942bb534b53` base (equals upstream when forked) |

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
allocator work on the vgem render node and Mesa d3d12. That is the only feasible shape, and it is **not tested**.
**Correction 2026-10-29 (`docs/WSLG.md`):** that shape cannot work against the stock WSLg Weston (no `zwp_linux_dmabuf_v1`, `wl_compositor` v4, `xdg_wm_base` v1, `wl_seat` v7 versus Aquamarine's 6, 6, 9 and dmabuf v4). It needs an upstream Weston 16 host and the Aquamarine clamp patch, and still has not run. `PLAN.md` already says
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

Since verified on 2026-11-03 (section 8): dxgkrnl and the Hyper-V series compile on 7.3.1 and work (`/dev/dxg`, D3D12
on the GPU), the kernel boots under WSL, `--from-file` install, `systemd=true` boot with the masked units, the
generated `modules.vhdx` as `kernelModules=`, WSLg sockets in this distro. The rest of this list still stands.

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

## 7. Bun OS for Windows bundle (2026-11-03)

Goal: Linux, systemd, Wayland and GLib apps running on Windows 11 like Win32 apps, with no sandbox between Bun OS and
Windows: our WSL2 kernel, the `bunos-wsl` distro, WSLg tuned for native-looking windows, and the `bunos.sys` kernel
driver (docs/NTCORE.md section 8). Built on the build host; installed on the workstation in section 8.

| Piece | Path | Role |
|---|---|---|
| Kernel build | `factory/wsl/kernel/build-wsl-kernel.sh` | Linux 7.3.1 + the six WSL patches, Rust on, `DXGKRNL=y`; emits `bzImage`, `modules.vhdx`, `config`, `report.json` |
| Distro build | `factory/wsl/build-rootfs.sh` | `bunos-wsl.tar.gz` and the same bytes as `bunos-wsl.wsl` |
| `.wslconfig` template | `factory/wsl/windows/wslconfig.template` | `kernel=`, `kernelModules=`, `guiApplications=true`, `networkingMode=mirrored`, `dnsTunneling`, `autoProxy`, `nestedVirtualization`; `[experimental] autoMemoryReclaim=gradual`, `sparseVhd`, `hostAddressLoopback` |
| `.wslgconfig` template | `factory/wsl/windows/wslgconfig.template` | WSLg native-window settings (docs/WSLG.md) |
| Installer | `factory/wsl/windows/install.ts` (Bun; no PowerShell needed) | verifies `SHA256SUMS`, copies to `%LOCALAPPDATA%\BunOS\wsl`, merges `.wslconfig`/`.wslgconfig` (backups `*.bunos-backup`), `wsl --shutdown`, `wsl --install --from-file bunos-wsl.wsl --name bunos --location ... --no-launch` (fallback `wsl --import`), checks `uname -r` and the WSLg socket + `/dev/dxg`; `--driver` adds `pnputil /add-driver` + `sc start BunOS` (test VM only); `--dry-run` prints everything and writes nothing |
| Bundle | `factory/wsl/windows/bundle.sh` | `bunos-windows/` + `bunos-windows.zip` with `SHA256SUMS` and `manifest.json` |

Verified on 2026-11-03:

- Kernel build fix: the first 7.3.1 run stopped with `fragment line dropped: CONFIG_RUST=y`. Cause: the build host had no
  `rust-src` component, so `RUST_IS_AVAILABLE` was false and `CONFIG_RUST` invisible. `rustup component add rust-src`
  on the host, and the script now runs `make rustavailable` before the config merge (fails with the real reason). The
  second run printed `Rust is available!` (rustc 1.99.1, bindgen 0.73.2, clang 22.1.8). The host also lacked `qemu-img`
  (needed by Microsoft's `gen_artifacts_vhdx.sh`); `qemu-utils` was installed.
- Distro: `build-rootfs.sh` in `archlinux:base-devel --privileged` finished `exit=0` with all Learn checks passing:
  `bunos-wsl.tar.gz` = `bunos-wsl.wsl` = 853,552,383 bytes, sha256
  `7e64f85dd984b93b636e3aa1f17b8ff45f945629e6582a9b24e229a75b824ff6`
  (`~/build/storage/artifacts/wsl/bunos-wsl/` on the build host). Contains `/usr/bin/bun`, `rustc`, `clang`, `Xwayland`,
  `glxinfo`, Mesa `d3d12_dri.so`, `libvulkan_dzn.so`, `/etc/wsl.conf`, `/etc/wsl-distribution.conf`, `/usr/lib/wsl/bunos.ico`.
  Some CachyOS v3 mirror files returned 404 (`cdn77.cachyos.org`) and pacman fell back to other mirrors.
- Microsoft's validator `distributions/validate-modern.py --tar bunos-wsl.tar.gz` (microsoft/WSL master, 2026-11-03):
  exit 0, all keys of both config files valid; two warnings, both deliberate: `user.default=bun` in `wsl.conf` is
  discouraged, and `/etc/passwd` already has uid 1000 (the user is created at build time, see section 2).
- Installer: `bun test factory/wsl/windows/install.test.ts` (INI merge keeps user keys/sections and comments, overrides
  ours, escapes paths) 3 pass; `install.ts --dry-run` prints the merged files and the `wsl.exe` command lines and
  writes nothing.

## 8. Workstation setup: native WSL, Docker, Waydroid (2026-11-03)

Owner request: the workstation runs our WSL (patched kernel, tuned WSLg) with Docker and Waydroid native inside it,
installed into the Windows directory like `cmd.exe`, tuned for the lowest latency. Machine: i7-13700F (16 cores, 24
threads), 31.8 GiB, RTX 4070, Windows 11 Pro 10.0.28120, WSL 3.0.4, WSLg 1.0.79. Everything below was run and read.

### Windows side

| Item | State |
|---|---|
| Optional features (`Win32_OptionalFeature`) | `Microsoft-Windows-Subsystem-Linux`, `VirtualMachinePlatform`, `Microsoft-Hyper-V-All` (+ Hypervisor, Services, Management-PowerShell), `HypervisorPlatform`, `Containers`: all enabled already; nothing to enable, no reboot |
| Hypervisor / VBS | hypervisor present, VBS running, HVCI off, Secure Boot on, test signing off (boot configuration untouched) |
| Power plan | Ultimate Performance already active |
| Docker Desktop | not installed; only a leftover `desktop-linux` context in `%USERPROFILE%\.docker` (left alone) |

### Install layout

`factory/wsl/windows/setup-elevated.ps1`, run through Windows Sudo (`C:\Windows\System32\sudo.exe`, inline mode):

| Path | Content |
|---|---|
| `%SystemRoot%\BunOS\wsl\` | `bzImage`, `modules.vhdx`, `bunos-wsl.wsl`, `waydroid-src.tar.gz` (git archive of `vendor/waydroid`), `bunos-wsl-native.sh`, `install.ts`, `latency.ts`, both templates |
| `%SystemRoot%\BunOS\bin\` | `docker.exe` (aphrody-labs/docker-cli `v29.9.2` = `a82e528`, cross-built by `factory/wsl/windows/docker-cli.sh`), `bunos.exe` (`bun build --compile --target=bun-windows-x64 packages/bunos-run/src/bunos.ts`) |
| `%SystemRoot%\System32\docker.exe`, `bunos.exe` | hard links to `bin\` (no launcher process; names checked against System32, SysWOW64, `%SystemRoot%`, Wbem, WindowsPowerShell, OpenSSH with every PATHEXT extension) |
| `%SystemRoot%\BunOS\manifests\wsl.json` | every file and link: path, bundle sha256, installed sha256, size, signer thumbprint |
| `%LOCALAPPDATA%\BunOS\wsl\bunos\ext4.vhdx` | the distro disk (per-user data, sparse) |

Both executables are signed with the Bun OS test certificate (`factory/windows/signing`, thumbprint
`1E67DBDB0D46A61CF57D286A5562DD76675D4E87`; `Get-AuthenticodeSignature`: `Valid`). The script verifies every bundle file
against `SHA256SUMS`, plans before writing, never replaces a file it cannot prove it installed (manifest hash, or after
an interrupted run: same bytes as the bundle or signed by our certificate), and is idempotent; a second run reports
every file as `same`. It then runs `install.ts --dest %SystemRoot%\BunOS\wsl --no-copy --native` as the same user.

```sh
# on the build host: kernel, docker.exe, bundle
KVER=7.3.1 bash factory/wsl/kernel/build-wsl-kernel.sh <repo> <work> <out>
bash factory/wsl/windows/docker-cli.sh <work> <out>
DOCKER_CLI_DIR=<out> bash factory/wsl/windows/bundle.sh <repo> <kernel-out> <distro-out> - <bundle-out>
# on Windows (bundle copied to %LOCALAPPDATA%\BunOS\bundle\bunos-windows)
pwsh -NoProfile -File factory/wsl/windows/setup-elevated.ps1 -Bundle <bundle> -Plan           # dry run
C:\Windows\System32\sudo.exe pwsh -NoProfile -File factory/wsl/windows/setup-elevated.ps1 -Bundle <bundle> -Native
```

Bundle of this install: built from `b2f4ba4dc5`, `bunos-windows.zip` sha256 `b60a5d36...c88fc`; `bzImage` `880be2ae...e89e1`
(16,876,544 bytes), `modules.vhdx` `2e6e0091...e6ea9a` (167,772,160), `bunos-wsl.wsl` `7e64f85d...824ff6`, `docker.exe`
`68d0fe10...b3d54d9` before signing. The dry runs (`setup-elevated.ps1 -Plan`, `install.ts --dry-run`) were saved before the
real run.

### Kernel 7.3.1 for this setup

`build-wsl-kernel.sh` merges four fragments over Microsoft's `config-wsl` and fails if any line is dropped:
`wsl-rust.config` (Rust, dxgkrnl, identity), `wsl-android.config` (binder + binderfs; it had never been merged before),
`wsl-docker.config`, `wsl-latency.config`. Compared with `config-wsl` (6.18.58) and Azure Linux 3.0 `SPECS/kernel/config`
(6.6.159.1) and `SPECS/kernel-hwe/config` (6.18.57.1):

| Option | config-wsl | Azure Linux 6.6 / HWE 6.18 | Bun OS |
|---|---|---|---|
| Preemption | `PREEMPT_NONE` + dynamic | `PREEMPT_NONE` + dynamic | `PREEMPT` + dynamic (`PREEMPT_NONE` needs `ARCH_NO_PREEMPT` in 7.3); boot shows `(full)` |
| Tick | 250 Hz | 250 / **1000 Hz** | 1000 Hz |
| MGLRU | off | on / on | on (`/sys/kernel/mm/lru_gen/enabled` = `0x0007`) |
| zswap | off | off / on | on by default, shrinker on |
| sched_ext | off | - / on | on (BTF already on) |
| TCP / qdisc | cubic, pfifo_fast/fq_codel | cubic | BBR + fq built in; `/etc/sysctl.d/90-bunos-latency.conf` pins fq over systemd's fq_codel |
| Docker | bridge, br_netfilter, nft compat, tun as modules | modules | built in (no modprobe at dockerd/container start); legacy `ip_tables` stay modules (Arch uses iptables-nft) |
| Waydroid | no binder | no binder | `ANDROID_BINDER_IPC`, `ANDROID_BINDERFS`, `UDMABUF`, `DMABUF_HEAPS_SYSTEM` |
| Already in config-wsl, kept | `DXGKRNL`, `HYPERV_VSOCKETS`, `VIRTIO_FS`, `OVERLAY_FS`, cgroup v2 controllers, `SECCOMP_FILTER`, `NO_HZ_IDLE`, `HYPERV_TIMER`, `PARAVIRT_SPINLOCKS` | | |

Not taken: `NO_HZ_FULL` (syscall entry cost), cpufreq governors (a Hyper-V guest has no cpufreq driver), `PREEMPT_RT`.
**dxgkrnl compiles against 7.3.1**: the build (12 jobs in `build.slice`, about 6 min prepare + 19 min compile) finished
with no error; `report.json`: Rust on, 22 Rust objects, `DXGKRNL=y`, `ANDROID_BINDERFS=y`, `HZ=1000`, perf built. The
first attempt of the day died in the 03:00 build-host OOM, the second stopped at `gen_artifacts_vhdx.sh` because the
service PATH lacked `/usr/sbin` (`mke2fs`); the script now appends it.

### `.wslconfig` (merged; the user's file is kept as `.wslconfig.bunos-backup`, no `.wslgconfig` existed: `.wslgconfig.bunos-absent`)

`kernel=` and `kernelModules=` under `%SystemRoot%\BunOS\wsl`, `processors=24`, `memory=16GB`, `swap=8GB` (all CPUs,
half the RAM, a quarter as swap: `install.ts` computes them), `networkingMode=mirrored`, `dnsTunneling`, `autoProxy`,
`firewall=true` (kept from the user's file), `nestedVirtualization`, `guiApplications`; WSL's default idle timeouts
(the 2026-11-03 `instanceIdleTimeout=-1` is dropped by the installer: it kept the VM resident after any accidental
wake; keep-alive is the on-demand BunOSWsl service, docs/WINDOWS-ARCHITECTURE.md); `[experimental] autoMemoryReclaim=gradual`,
`sparseVhd`, `hostAddressLoopback`, `ignoredPorts=53,67`. The last one is needed: in mirrored mode Linux cannot bind a
port Windows already holds, and Windows' DHCP on 67 made Waydroid's dnsmasq fail (`failed to bind DHCP server socket`).
GPU-PV and hvsocket need no key (on by default; WSL's own channels are hvsocket).

### Verified in the distro

`uname -r` = `7.3.1-microsoft-standard-WSL2`; `/dev/dxg` present; WSLg `wayland-0` socket and `/run/user/1000/wayland-0`
link, `wayland-info` lists `wl_compositor` 4, `xdg_wm_base` 1, `wl_seat` 7; `glxinfo -B`: `D3D12 (NVIDIA GeForce RTX 4070)`;
24 CPUs, 15 GiB; binderfs mounted on `/dev/binderfs`; `systemctl is-active docker containerd waydroid-container` all active.

### Docker

Docker Engine 29.9.2 + buildx + compose from pacman (`bunos-wsl-native.sh docker`): `docker.service` enabled, overlayfs,
cgroup v2 / systemd driver, API on the unix socket and on `tcp://127.0.0.1:2375` (`--tls=false`; mirrored mode shares
that loopback with Windows only; whoever reaches it is root in the distro, which the Windows user already is through
`wsl -u root`). Windows: `docker.exe` with context `bunos` (current). From a Windows shell: `docker version` shows
client and server 29.9.2 on kernel 7.3.1, `docker run --rm hello-world` prints its greeting, and GPU-PV inside a
container works without the NVIDIA toolkit:

```sh
docker run --rm --device /dev/dxg -v /usr/lib/wsl:/usr/lib/wsl:ro -e LD_LIBRARY_PATH=/usr/lib/wsl/lib \
  debian:stable-slim /usr/lib/wsl/lib/nvidia-smi -L     # GPU 0: NVIDIA GeForce RTX 4070
```

### Waydroid and `bunos apk`

Waydroid 1.6.3 from `vendor/waydroid` (`cdc6437`, installed with `make install USE_NFTABLES=1`), dependencies from pacman,
LineageOS 20 VANILLA system + MAINLINE vendor images (`waydroid init`), `persist.waydroid.multi_windows=true`,
`ro.hardware.gralloc=default`; Waydroid picks ANGLE on a software Vulkan device itself (`ro.hardware.egl=angle`).
`bunos apk install <file.apk>` (`packages/bunos-run/src/apk.ts`, also `C:\Windows\System32\bunos.exe apk ...`) reads the
package name with the bun-loaders AXML decoder, starts the session as a transient user unit on WSLg's Wayland socket,
waits for `sys.boot_completed`, installs, waits until PackageManager resolves the package, launches. Test: F-Droid
`F-Droid.apk` from f-droid.org (12,569,951 bytes, sha256 `19d51fad...c3327b52`, PGP signature good from F-Droid
`37D2 C987 89D8 3119 4839 4E3E 41E7 044E 1DBA 2E89`, checked on the build host) in its own directory:
`org.fdroid.fdroid` 2.0.2 installed (`pm list packages`), `topResumedActivity` = `org.fdroid.fdroid/org.fdroid.IconActivity`,
and a Win32 window "F-Droid (bunos)" owned by `msrdc` (WSLg RAIL). Three fixes came out of the run: `wsl.exe` re-parses its
command line and broke the quoted guest script (now shipped as one base64 token); `waydroid prop get` as root looks for a
root session (now `waydroid shell -- getprop`); `waydroid app install` returns before dexopt ends (launch waits for `pm path`).

### Latency

Probe: `factory/wsl/windows/latency.ts` (raw JSON in `%LOCALAPPDATA%\BunOS\measure\`). The workstation is shared with
other agents (rustc builds held 37-94% of the 24 threads during the after-runs), so absolute numbers drift by 2-5x between
runs; the fair comparison is the interleaved A/B, which alternates the original setup and ours under the same load.

| Metric (median) | Before: stock 6.18.54.1, NAT, 12 vCPU, quiet host (05:16) | Interleaved A/B, original / ours, run 1 | run 2 |
|---|---|---|---|
| `wsl -d bunos -- true`, VM warm | 75 ms | 350 / 439 ms | 625 / 456 ms |
| `\\wsl.localhost` stat + 4 KiB read | 1.62 ms | 7.27 / 5.83 ms | 5.50 / 4.76 ms |
| `\\wsl.localhost` list `/usr/bin` (1.6k entries) | 4.9 ms | 13.2 / 11.3 ms | 10.6 / 10.3 ms |
| TCP 1-byte RTT Windows <-> distro on 127.0.0.1 | 98 µs (p99 171) | 308 / 201 µs | 331 / 220 µs |

Ours is faster on file access and loopback TCP (about a third less RTT) under identical load; `wsl.exe` start time is
noise-dominated. Other numbers:

| Metric | Value |
|---|---|
| Cold start (`wsl --shutdown`, then `wsl -d bunos -- true`) | 3.49 s before; 7.85 s after (systemd now starts dockerd, containerd and the Waydroid container); paid once per use session (the VM idles out 60 s after the last client) |
| dockerd from Windows: TCP connect / `GET /_ping` on 127.0.0.1:2375 | 0.8 ms / 0.6 ms |
| `docker.exe --version` / `docker.exe version` (process start + API) | 192-235 ms / 310-490 ms on a quiet moment; 1.3-3 s under full host load |
| `docker run --rm hello-world` via `wsl.exe` | 399 ms before (stock kernel); 650-810 ms after under load |
| Waydroid: launch call to Win32 window | 0.56-0.80 s with the app process warm, 1.93 s with a process start (Android `Displayed +815ms`) |
| `bunos apk install F-Droid.apk` with Android already booted | 15.5 s (install, dexopt, launch) |
| Android boot (session start to launcher displayed) | about 24 s |

### DirectX 12: Mesa d3d12, Dozen, VA-API, OpenCL

The GPU path is DirectX 12 over `/dev/dxg`: Mesa's `d3d12` gallium driver loads Microsoft's `libd3d12.so`/`libdxcore.so`
from `/usr/lib/wsl/lib`. The packages are built from our forks, not taken from Arch or CachyOS:

| Package (bunos-testing) | Content |
|---|---|
| `bunos-mesa` | `aphrody-labs/mesa` branch `bunos/26.3` (= `mesa-26.3.0-rc3`, `90a959e`) with `aphrody-labs/DirectX-Headers` `v1.721.2` as the meson fallback; gallium `d3d12,llvmpipe,softpipe,zink,virgl`, VA-API through d3d12 video (`-Dvideo-codecs=all`), GBM, EGL, GLX. Provides and conflicts with `mesa` |
| `bunos-vulkan-dzn` | Dozen (`microsoft-experimental`): Vulkan 1.2 over D3D12, plus `spirv2dxil` |
| `bunos-vulkan-swrast` | lavapipe, the CPU Vulkan fallback |
| `bunos-opencl-mesa` | rusticl, with `RUSTICL_ENABLE=d3d12,llvmpipe` in `profile.d` and `environment.d` |
| `bunos-virglrenderer` | `aphrody-labs/virglrenderer` 1.3.0 with `bunos-vtest@<user>.service` (the Waydroid bridge, below) |

`aphrody-labs/mesa` mirrors `gitlab.freedesktop.org/mesa/mesa` (`main`, `26.2`, `26.3` and 713 release tags); the former
OpenGamingCollective patch fork under that name is now `aphrody-labs/mesa-ogc-patches`. The `vendor/wayland/mesa` and both
DirectX-Headers submodules point at the forks. The VPS builds the packages with `factory/wsl/build-gpu.sh`: a clean
`archlinux:base-devel` container in `build.slice`. `GPU_LOCK`/`GPU_JOBS` run it as a second lane beside the heavy queue,
and the container is frozen with `docker pause` when the host has under 6 GiB available.
`bun factory/wsl/gpu-check.ts` checks a distro without any display: GLES 3 on a surfaceless EGL context through `bun:ffi`,
drawing a 64-iteration fragment shader into a 1920x1080 offscreen framebuffer (d3d12, then `LIBGL_ALWAYS_SOFTWARE=1`),
plus `vulkaninfo`, `vkmark --winsys headless`, `clinfo` and `vainfo`. The output is one JSON report.

RTX 4070 measurements, taken on 2026-11-03 on the shared workstation while other agents' builds were running:

| | Before: CachyOS `mesa`/`vulkan-dzn` 26.2.5 | After: `bunos-mesa` 26.3.0-rc3 |
|---|---|---|
| GL renderer | `D3D12 (NVIDIA GeForce RTX 4070)`, OpenGL ES 3.1 | same, `Mesa 26.3.0-rc3-bunos.1` |
| GLES fill benchmark, d3d12 | 2510-2630 fps (5.2-5.5 Gpixel/s) | 3492-3856 fps (7.2-8.0 Gpixel/s) |
| same, llvmpipe (CPU) | 15.9-19.9 fps | 26.0-26.4 fps |
| vkmark headless (Dozen, `Microsoft Direct3D12 (NVIDIA GeForce RTX 4070)`, Vulkan 1.2) | 1355-1785 | 1785-1912 |
| VA-API (`vainfo`, d3d12) | 15 profile/entrypoint pairs incl. AV1/VP9/HEVC decode and encode | same 15, `Mesa Gallium driver 26.3.0-rc3-bunos.1 for D3D12` |
| OpenCL | no Mesa platform | rusticl: `llvmpipe` only |

d3d12 GL is about 1.4x faster with 26.3; the Dozen gain is within noise. OpenCL on the GPU is not available through Mesa:
rusticl does not expose `d3d12`, and `RUSTICL_ENABLE=zink` over Dozen fails with `ZINK: failed to choose pdev`.
GPU compute on WSL stays with CUDA (`libcuda.so` from `/usr/lib/wsl/lib`). `glxinfo`/`eglinfo` on WSLg's X11 and Wayland
sockets hung during the whole run (WSLg's compositor and the system distro stopped answering). That is why the check
never needs a display. A WSL restart, which would end other agents' sessions, was not done.

### Waydroid on the GPU

Android cannot use Mesa d3d12 directly. The Waydroid vendor image's Mesa 26.0.8 (`libgallium_dri.so`) has no `d3d12`
driver: it references neither `libd3d12.so` nor `D3D12CreateDevice`. Android (bionic) also cannot load Microsoft's glibc
`libd3d12`/`libdxcore`, and WSL's only DRM node is `vgem`. The image does carry virgl's `virpipe` and Venus with the
vtest transport. Mesa on Android reads its options from properties (`GALLIUM_DRIVER` becomes `mesa.gallium.driver`), so
API forwarding needs no Android rebuild. `bunos-vtest@bun.service` runs `virgl_test_server --use-egl-surfaceless
--use-gles` on the host Mesa d3d12, with its socket inside the Waydroid `/data` mount
(`~/.local/share/waydroid/data/vtest/virgl.sock`). The Waydroid properties for the test were
`ro.hardware.egl=mesa`, `mesa.libgl.always.software=true`, `mesa.gallium.driver=virpipe` and
`mesa.vtest.socket.name=/data/vtest/virgl.sock`.

Result: Android GLES runs on the RTX 4070. SurfaceFlinger's RenderEngine reports
`renderer: virgl (D3D12 (NVIDIA GeForce RTX 4070))`, `OpenGL ES 3.1 Mesa 26.0.8`. Android does not boot on it, though.
SurfaceFlinger aborts at its first composition with `Unable to generate SkSurface. isTextureValid:0`, both in
`primeShaderCache` and at runtime once `service.sf.prime_shader_cache=0` is set. Android's EGL on a software-winsys
driver (virpipe) cannot import gralloc buffers as GL textures or render targets (EGLImage from `AHardwareBuffer`),
and composition needs that. The run used a private headless Weston because WSLg was not answering; with
`multi_windows=true` the Waydroid hwcomposer also stalled in `window::create` against it.
The Waydroid configuration was restored to the software path, the unit is shipped disabled, and Android still renders on
the CPU. Closing the gap means changing the Android side of Mesa in the Waydroid vendor image: virgl with a
host-visible gralloc (minigbm on vtest resources) or Venus with `AHardwareBuffer` import. Both are listed under Open.

### WSLg crash loop with the BunOSWsl service (fixed 2026-11-03)

Symptom after the `BunOSWsl` service (docs/WSL-SERVICE.md) took over the instance at 07:30: Weston restarted every
~100 s (68 SIGSEGV in `/mnt/wslg/stderr.log` by 09:30), X apps on `:0` never drew, Wayland clients connected but got no
reply. Each cycle: `msrdc.exe` connects (`Accepted client` in `wlog.log`), nothing for 100 s, `peer_recv_pdu() fail`,
`unable to checkDescriptor` in `weston.log`, SIGSEGV, WSLGd restarts Weston and msrdc. Cause, from the Windows side:
`msrdc.exe` ran in **session 0** under a session-0 `wslhost.exe` of the service's keeper `wsl.exe`. WSLGd launches
msrdc through the session that created the VM, and session 0 has no desktop. Ruled out by that evidence: the
`.wslgconfig` keys, mirrored networking, the kernel's hv_sock/vsock (the RDP channel connected every time), the
Waydroid desktop icon. Fix in `crates/bunos-wsl-service`: the owner's interactive token when they are logged on, and a
one-time VM restart from their session when msrdc is found in session 0. Verified: msrdc in session 1, a single Weston
start and no crash over 5 min, `xeyes`, `weston-terminal` and `glxgears` drawing as Win32 windows. The restart killed
one Docker build of another agent (announced over `aphrody a2a`; it retried automatically).

### Desktop sessions and `[bunos-testing]` (2026-11-03)

- Repository: `factory/wsl/publish-testing.sh` (build host) publishes the `[bunos-testing]` packages that
  `factory/desktop/build.sh` builds at `https://aphrody.com/repo/bunos-testing/x86_64/` (nginx `/repo/` of the Store),
  every package and the database signed with the Store key `aphrody-store` (`A4B3EFE520B09C8184ACF571BFCB340002617BD7`,
  public half `https://aphrody.com/repo/os/aphrody.gpg`); clients use `SigLevel = Required`. Only the files the
  database names are published (81 packages). A URL fetched before it exists can stay 404 for up to 120 s
  (`open_file_cache_errors on`, `open_file_cache_valid 120s`).
- Distro: `bunos-wsl-native.sh repo|desktop`, `factory/wsl/packages.desktop`, `install.ts --desktop`, image profile
  `desktop`; the bundle and `setup-elevated.ps1` ship the list. Installed live: bunos-cli, bunos-desktop 4,
  bunos-design-m3, bunos-mesa, bunos-omarchy 2, cosmic-session, gnome-shell, mutter-devkit, wayvnc, wlvncc, aquamarine 2
  (our fork) and the GStreamer elements; about 3 GB.
- Kernel: `wsl-desktop.config` adds `CONFIG_DRM_VKMS=y` (Hyprland needs a KMS device). Rebuilt incrementally in the
  7.3.1 tree (242 s), bundle rebuilt (`bzImage` `1f1c9791...`, `modules.vhdx` `5999da0c...`, zip `b2f119c5...`) and
  installed with `setup-elevated.ps1` (upgrade of `bzImage`, `modules.vhdx`, scripts, `bunos.exe`; new
  `packages.desktop`). The one VM restart this needed was announced on `aphrody a2a` (help-wanted, native-apps) 13 min
  before and run with no container running. Since then `wsl.exe` warns that mirrored networking uses a smaller
  ephemeral port range (2048 ports instead of 4096); nothing failed from it.
- Sessions, times and screenshots: [DESKTOP-SESSIONS.md](DESKTOP-SESSIONS.md), "Run on the workstation".

### Undo

```sh
C:\Windows\System32\sudo.exe pwsh -NoProfile -File factory/wsl/windows/setup-elevated.ps1 -Uninstall
wsl --unregister bunos          # only the Bun OS distro: deletes its ext4.vhdx
```

The first command removes exactly what `manifests\wsl.json` lists (links first, files only if unchanged), restores
`.wslconfig` from `.wslconfig.bunos-backup`, deletes `.wslgconfig` (it did not exist before) and shuts WSL down. The
`bunos` docker context stays in `%USERPROFILE%\.docker` (`docker context rm bunos`). Nothing else on Windows was changed:
no optional feature, boot setting, driver or other distro.

### Open

- The distro image does not carry Docker/Waydroid yet; `--native` provisions them on first install (needs network).
- Android renders in software. The vtest bridge puts Android GLES on the GPU (`virgl (D3D12 ...)`), but SurfaceFlinger
  cannot texture gralloc buffers through virpipe ("Waydroid on the GPU"). The next step is a Waydroid vendor image whose
  Mesa imports gralloc buffers on vtest (minigbm on vtest resources, or Venus with `AHardwareBuffer`).
- GPU OpenCL through Mesa: rusticl has no d3d12 device and zink does not start on Dozen.
- The distro image still installs CachyOS `mesa`/`vulkan-dzn` (`packages.base`); switch it to `bunos-mesa` once
  bunos-testing is in the image's pacman.conf.
- `bunos.sys` is not loaded on this workstation (Secure Boot locks test signing; factory/windows/signing/README.md).
- Quiet-host after-numbers for `wsl.exe` start and Docker runs: rerun `latency.ts --docker` when no build is running.
