# Bun OS Rust base

Bun, COSMIC, Redox, uutils, the Rust compositors, crosvm (ChromiumOS) and the Android binder crates all build on one
Rust base. Each project is an aphrody-labs fork, pinned as a gitlink submodule. Its branch `aphrody` is the upstream
point plus any Bun OS patches. Shared crates are redirected to those forks through the root Cargo `[patch.crates-io]`
table, and the packages are built once on the VPS and installed by default.

- Source of truth: [`factory/rustbase/forks.json`](../factory/rustbase/forks.json), with fork, pin, consumers and build
  recipe per component. Tool selection data (which Rust tool wins each domain) stays in [RUSTBASE.md](RUSTBASE.md).
- Factory: `bun run factory:rust-base <status|build|debs|publish|qualify|all>`, which runs
  [`factory/rustbase/rust-base.ts`](../factory/rustbase/rust-base.ts). It is VPS only and goes through `cargo-serial`
  with 4 jobs. Outputs go to `~/build/rust-base/{src,target,out}`, each with a `receipt.json`.
- COSMIC/Redox git-URL patches are a separate table, `factory/os/rust-desktop/cargo-patch.toml`. It is passed with
  `cargo --config` and owned by the Redox/COSMIC lane. The two tables do not overlap.

## Components

| Component | Fork and pin | Consumers | Replaces |
|---|---|---|---|
| uutils coreutils | `vendor/uutils/coreutils`, aphrody-labs/uutils-coreutils (`aphrody`) | `crates/bunos-utils` multicall; pacman `bunos-utils`; deb `rust-coreutils` | GNU coreutils |
| uutils findutils | `vendor/uutils/findutils`, aphrody-labs/uutils-findutils | bunos-utils; deb `rust-findutils` | GNU findutils |
| uutils diffutils | `vendor/uutils/diffutils`, aphrody-labs/uutils-diffutils | bunos-utils; deb `rust-diffutils` | GNU diffutils (diff, cmp) |
| uutils util-linux | `vendor/uutils/util-linux`, aphrody-labs/uutils-util-linux | bunos-utils feature `util-linux` | util-linux (non-mount applets) |
| uutils procps | `vendor/uutils/procps`, aphrody-labs/uutils-procps | bunos-utils feature `procps` | procps-ng |
| uutils sed / grep | `vendor/uutils/{sed,grep}`, aphrody-labs/uutils-{sed,grep} @ 42bffb9d / 0be8c54f | pinned only | GNU sed / grep |
| sudo-rs | `vendor/sudo-rs`, aphrody-labs/sudo-rs @ baa7fcea (0.2.15+) | pacman `bunos-sudo-rs`; deb `sudo-rs` | sudo |
| ntpd-rs | `vendor/ntpd-rs`, aphrody-labs/ntpd-rs @ v1.9.0 (46ec9bb4) | pacman `bunos-ntpd-rs`; deb `ntpd-rs` | chrony, systemd-timesyncd |
| crosvm | `vendor/crosvm`, aphrody-labs/crosvm @ 4ef33798 | pacman/deb `bunos-crosvm`; VM sessions | QEMU (KVM Linux guests) |
| minijail | `vendor/minijail`, aphrody-labs/minijail @ 8787d1a4 | crosvm sandbox (`minijail`, `minijail-sys`) | none |
| rustls | `vendor/rustls`, aphrody-labs/rustls @ v/0.23.46 (f04804fa) | root `[patch]`; aphrody-gateway, aphrody-inventory, tokio-rustls users, ntpd-rs NTS | OpenSSL TLS |
| rustls-ffi | `vendor/rustls-ffi` @ v0.15.7 | pinned (curl `--with-rustls`) | OpenSSL for C clients |
| rustls-openssl-compat | `vendor/rustls-openssl-compat` @ v/0.2.2 | pinned (nginx libssl) | libssl |
| zlib-rs | `vendor/zlib-rs`, aphrody-labs/zlib-rs @ v0.6.8 (0254e072) | root `[patch]`; flate2 `zlib-rs` backend | zlib |
| rav1e / rav1d | `vendor/rav1e` @ v0.8.1, `vendor/rav1d` @ v1.1.0 | rav1e via the root lock (0.8.1); rav1d pinned | libaom encoder / dav1d |
| nushell | `vendor/nushell`, aphrody-labs/nushell | `bunos-nushell-default` | bash (interactive) |
| Rio | `vendor/rio`, aphrody-labs/rio @ 59203ccd | native-apps deb; Redox `rioterm` recipe | xterm, kitty |
| ion | aphrody-labs/redox-ion (Redox recipe rev) | Redox cookbook (`factory/os/rust-desktop/forks.json`) | Redox shell |
| smithay | `vendor/smithay`, aphrody-labs/smithay @ f581531d | cosmic-comp, niri | wlroots |
| cosmic-comp | `vendor/cosmic-epoch/cosmic-comp`, aphrody-labs/cosmic-comp | COSMIC session | Mutter |
| niri | `vendor/niri`, aphrody-labs/niri @ v26.04 | alternative compositor | Sway, Hyprland |
| cloud-hypervisor | `vendor/cloud-hypervisor` @ v54.0 (038ce5a7) | alternative VMM (UEFI guests) | QEMU |
| firecracker | `vendor/firecracker` @ v1.17.0 (95f868c8) | alternative microVM | QEMU microvm |
| rsbinder | `vendor/rsbinder` @ v0.12.0 (b7a8fc94) | binder IPC on Linux hosts (binderfs, redroid/Waydroid) | libbinder (C++) |
| Bun | `vendor/oven-bun`, upstream oven-sh/bun @ 11c36716 | `bun-canary` packages (npm binary of the same gitHead) | Node.js |

Upstream Bun is now a Rust workspace (`Cargo.toml`, about 80% Rust by GitHub's count) on `nightly-2026-09-15`, the
same channel as the root toolchain. AGENTS.md forbids the abandoned aphrody-labs/bun fork, so the upstream source is
pinned read-only and the runtime ships as the npm canary built from that gitHead. Its crates are internal (JSC
bindings, unpublished) and stay in their own nested workspace.

## Defaults

- **pacman images.** These are the factory OS images, the gaming image and the desktop composition, all built from
  `factory/usr`. `basePackages` lists `bunos-utils`, `bunos-sudo-rs` and `bunos-ntpd-rs`. `bunos-utils` provides,
  conflicts with and replaces `coreutils`, `findutils` and `diffutils`, and links their applets in `/usr/bin`. procps,
  util-linux and binutils applets are linked in `/usr/lib/bunos-utils/bin`, because procps-ng, util-linux and binutils
  are still required by systemd and base-devel. The `/usr` builder pulls the `rustBase` packages from the signed
  `aphrody` repository and verifies each file against the repository key.
- **Ubuntu 26.04 images.** These are the Pop!_OS + COSMIC session and `factory/images/bunos-unified`. Ubuntu already
  ships `rust-coreutils`, `rust-findutils`, `rust-diffutils`, `sudo-rs` and `ntpd-rs`.
  [`deb-build.sh`](../factory/rustbase/deb-build.sh) rebuilds those packages under the same names and keeps the Ubuntu
  maintainer scripts. It replaces the binaries with the fork builds and gives each package a version that sorts above
  the archive (`+bunos1`), so apt upgrades in place. `/usr/bin/coreutils` becomes the Bun OS multicall. The debs go to
  `~/native-apps/debs`, which the unified image installs, and the Store publishes them in apt suite `resolute`.
- **VMM.** crosvm with KVM is the VMM for Linux-kernel VM sessions. QEMU stays only where crosvm cannot boot the guest:
  - **Redox** needs BIOS or UEFI boot of its own bootloader. crosvm has no legacy BIOS, and its UEFI path needs a
    crosvm-specific OVMF build that Redox has not been qualified on. The Redox image is low priority (owner, 2026-10-30).
  - **Windows** needs UEFI, a TPM and Hyper-V enlightenments.
  - **Cuttlefish** ships its own crosvm. The Bun OS Android session runs redroid in a container, not a VM.
- **TLS.** First-party Rust code uses rustls with the `ring` provider: aphrody-gateway uses reqwest
  `rustls-no-provider` plus `rustls/ring`, aphrody-inventory uses ureq `rustls`, and tokio-rustls uses `ring`. `ring` is
  chosen because it builds with a C compiler alone (no CMake or Go) and covers the needed suites. `aws-lc-rs` is still
  in the lock as an optional rustls provider pulled by third-party crates and is not selected by first-party code. The
  WebOS server (`crates/aphrody-webos-server`) speaks plain HTTP on loopback; TLS for aphrody.com terminates in nginx.

## Remaining C/C++ gaps

- **Base system:** glibc, systemd, util-linux (`mount`, libmount, libblkid), procps-ng in `/usr/bin`, GNU sed/grep
  (the uutils ports are pinned but below parity), bash as `/bin/sh`, pacman/libalpm, PAM.
- **Ubuntu images:** GNU findutils and diffutils still own `/usr/bin` because Ubuntu has no `*-from-uutils` switch for
  them.
- **Network:** nginx still links OpenSSL (rustls-openssl-compat is pinned, not deployed), and curl/libcurl and OpenSSH
  are still C.
- **Media and graphics:** Mesa, PipeWire, dav1d and ffmpeg are still C.
- **crosvm:** minijail is C with Rust bindings, and the build uses `balloon,net,qcow,usb` without the GPU
  (virglrenderer).
- **Android:** keystore2 and the AOSP binder crates live in AOSP (Soong, AIDL) and are not usable outside Android
  without the AIDL toolchain. rsbinder is the Linux-host binder.
- **Compositors:** COSMIC and niri still link libinput, libseat, Mesa and xkbcommon (C).

## Qualification

Results of the latest `rust-base.ts qualify` run (`~/build/rust-base/qualification.json`):

<!-- rust-base:qualification -->
Not run yet.
