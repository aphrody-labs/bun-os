# Android on Bun OS (measured facts only, 2026-10-29)

State: WIP on branch `claude/wip-waydroid`. Nothing here has booted Android yet.

## Toolchain (Googlebook level, Android 17 / API 37, 2026-10-30)

One shared toolchain, pinned in `factory/android/sdk.json`, installed by `bun factory/android/sdk.ts install`
and checked by `bun factory/android/sdk.ts verify` (compares `sdkmanager --list_installed`; all 19 pins ok on
the VPS). Environment: `set -a; . factory/android/android.env; set +a`. `packages/bun-android` also falls back
to `/opt/android-sdk`. Why API 37: see [GOOGLEBOOK.md](GOOGLEBOOK.md).

- VPS: `/opt/android-sdk` (ubuntu:aphrody, setgid 2775), Gradle and Kotlin in `/opt/android-tools`.
- SDK: cmdline-tools 23.0, platform-tools 37.0.1, build-tools 37.0.0, platforms and sources android-37.0,
  37.1 and 37.2, NDK 30.0.16248370 (default) and 29.0.14206865, CMake 4.1.2 and 3.22.1, emulator 37.2.13,
  Play services 49, Android support repository 47.0.0.
- System images: `android-37.1;android-desktop;x86_64` (Google APIs Desktop, the Googlebook image, canary
  channel), `android-37.0;android-desktop;x86_64` (AOSP Desktop), `android-37.0;google_apis_playstore;x86_64`
  (phone and tablet). Product images run no emulator; these serve app testing only.
- JDK 21 (`JAVA_HOME`, AGP 9.x) and JDK 25 (latest LTS) from Ubuntu; Gradle 9.8.2; Kotlin 2.4.21.
- Rust: `aarch64-linux-android`, `x86_64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`
  through rustup, plus `cargo-ndk` 4.1.2.
- Build containers: `bun factory/android/sdk.ts image` builds the private `bunos-android-sdk:37` image (build
  profile, no emulator). Never push it to a public registry.
- Pitfalls: `dl.google.com` returns 404 over IPv6 from the VPS, so downloads use IPv4. cmdline-tools 23
  makes `sdkmanager` a shim over the Android CLI, which the recipe prefetches into `~/.android/bin`. The
  desktop images exist only on channel 3.

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
