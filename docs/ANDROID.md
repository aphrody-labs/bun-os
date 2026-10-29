# Android on Bun OS (measured facts only, 2026-10-29)

State: WIP on branch `claude/wip-waydroid`. Nothing here has booted Android yet.

## Measured
- OTA channel (live, `bun-waydroid ota check`): system lineage-20.0 VANILLA x86_64, 153 builds, newest 2026-09-27, 847 449 341 bytes;
  vendor MAINLINE x86_64, 150 builds, newest 2026-10-22, 189 818 691 bytes. Hosted on SourceForge, integrity = SHA-256 `id` from the
  same HTTPS channel, no detached signature (upstream behaviour, kept; pin a hash out of band to do better). Android 13 (Lineage 20).
- VPS (kernel 7.3.0-9-generic, 12 cores, 47 GB): `CONFIG_ANDROID_BINDER_IPC=m`, `BINDERFS=m`, `binder_linux.ko.zst` present, module not loaded,
  no `/dev/binder*`, no sudo, Docker usable. Loading the module needs root: not done. redroid/Waydroid cannot run on the VPS.
- Linux v7.3 source: `ANDROID_BINDER_IPC` is bool, binderfs depends on it, Rust binder excludes it; ashmem is gone (memfd fallback).
  `factory/kernel/linux-bun/config.x86_64` selects the Rust binder, which Waydroid's binderfs allocation cannot use.
- Microsoft config-wsl (a989171) has everything Waydroid needs except binder: fragment `factory/wsl/kernel/wsl-android.config` (unbuilt).
- Tests: `crates/bun-waydroid` 17 unit tests pass (Windows host); `packages/waydroid` 13 tests pass (fake scrcpy server: every frame
  forwarded byte for byte, touch bytes reach the control socket, auth, APK signature check, path allow-list); `tsc --noEmit` clean.
- Not measured: boot time, fps, latency, RAM. `packages/waydroid/scripts/e2e.ts` produces them against any adb target
  (pinned F-Droid APK org.fdroid.fdroid 2.0.2, sha256 19d51fad...) and needs a runner with binder (`modprobe binder_linux`).

## Web paths
- Remote (implemented): Waydroid/redroid/Cuttlefish -> adb -> scrcpy-server v5.0.1 (pinned sha256) -> Bun gateway WS -> `<android-screen>` (WebCodecs).
- In-browser (container2wasm/QEMU-wasm + binder kernel + Waydroid): not attempted. wasm32 caps at 4 GB and Android needs about 2 GB plus TCG
  emulation of x86_64; no measurement exists, so no claim. APK without Android (ART in wasm): nothing exists.

## Remaining
CI workflow `waydroid.yml`, components.json/`just map` registration, git-profiles cone, e2e on a binder-capable runner, Cuttlefish backend
(agent ab8a9c802e7e62f05), Play via official routes only (microG optional), Weston/Hyprland notes, `buncc doctor --repo`, `bun run format`,
`cargo fmt` and clippy on the VPS (`~/build/waydroid/bun-os`).
