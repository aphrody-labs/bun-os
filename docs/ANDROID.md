# Android on Bun OS (measured facts only, 2026-10-31)

State: Android 17 boots on the VPS host kernel as a Waydroid system container, x86_64, tablet profile,
with the complete Google Play stack. It is the Android of the unified Bun OS session
([UNIFIED-IMAGE.md](UNIFIED-IMAGE.md)); redroid 13 (`aphrody-redroid`) stays only as the stream fallback.

## Android 17 session (2026-10-31)

- Image: LineageOS 24.0 GAPPS `waydroid_x86_64` 20261017 (WayDroid-ATV, supechicken/waydroid-builds, OTA
  channel `https://waydroid-atv.github.io/ota/a17-qpr0`) plus MAINLINE vendor 20261017. Zip SHA-256 match the
  OTA ids (`f85e8c79...`, `bf964411...`). Extracted to `~/.cache/bunos-waydroid/a17/images` on the VPS with
  `SHA256SUMS` (system.img `6b200eaf...`, vendor.img `564252f4...`). Private: Google apps (MindTheGapps:
  Play Store, Play services, GSF, Google setup wizard) are not redistributable and the maintainer asks for
  no mirrors, so the images never enter a repository, a pushed container image or a download.
- Build: `ro.build.version.release=17`, SDK 37, abi x86_64, fingerprint
  `google/tangorpro/tangorpro:17/CP2A.260705.006` (Pixel Tablet), `ro.build.characteristics=tablet`.
- Runtime: `vendor/waydroid` (aphrody-labs fork, f4a04c3: own `anbox-*` binder nodes so it never takes
  redroid's `binder`/`hwbinder`/`vndbinder` on the shared binderfs) installed with `make install USE_NFTABLES=1`;
  `waydroid init -f -i ~/.cache/bunos-waydroid/a17/images -c <a17 system channel> -v <a17 vendor channel> -s GAPPS`.
- Host requirements, all measured on kernel 7.3: modules `binder_linux`, `erofs` (the images are EROFS),
  `vgem`, `nft_masq` (`modules-load.d/aphrody-vps.conf`); ufw `allow in on waydroid0` plus
  `route allow in/out on waydroid0`, otherwise the Android DHCP request never gets an answer. No LTS kernel
  and no BPF patch are needed: netbpfload logs, netd keeps running.
- No GPU: Android 17 has no gralloc 2/3 mapper, so Waydroid's software path (`ro.hardware.gralloc=default`)
  aborts surfaceflinger with "gralloc-mapper is missing". `/data/misc/waydroid_settings` selects minigbm
  gralloc 4 on the vgem render node (`waydroid-android17 prepare`); EGL is ANGLE, Vulkan `pastel`.
- Provisioning (`waydroid-android17 provision`, root, idempotent): desktop windowing globals
  (`enable_freeform_support`, `force_resizable_activities`, `enable_non_resizable_multi_window`), device
  provisioned, both setup wizards disabled; sign-in happens in the Play Store.
- VPS host bench: `aphrody-android17.service` (headless Weston 2560x1600, `waydroid session start`, density
  320) after `waydroid-container.service`; adb `192.168.240.112:5555` with the host key in
  `/data/misc/adb/adb_keys`. Boot to `sys.boot_completed=1` takes about 2 minutes.
- Qualified 2026-10-31: release 17, x86_64, tablet; the Launcher3 Quickstep home shows the large-screen
  taskbar (app drawer, pinned apps, navigation on the right); the Play Store opens on its Sign in screen;
  `aphrody-remote-desktop --android 192.168.240.112:5555 --max-size 2560` streams 2560x1600 H.264
  (avc1.42c032) to a WebSocket client.
- Play registration: GSF Android ID from `gservices.db` (`main.android_id`), registered at
  `https://www.google.com/android/uncertified`; the owner signs in.
- Unified image: `rootfs/usr/share/bunos/waydroid/waydroid_base.prop.d/20-android17.prop` and
  `rootfs/usr/libexec/bunos/waydroid-android17` in `factory/images/bunos-unified`.
- Dropped routes: the official emulator with the Android 17 Play image booted under KVM but is an OS
  emulator (owner pivot to one native session); redroid 17 needs our own AOSP build and has no x86_64 GApps.

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

## Earlier measurements (2026-10-29)
- Upstream OTA channel (`bun-waydroid ota check`): system lineage-20.0 VANILLA x86_64 (Android 13), vendor MAINLINE. Integrity =
  SHA-256 `id` from the same HTTPS channel, no detached signature (upstream behaviour, kept).
- Linux v7.3 source: `ANDROID_BINDER_IPC` is bool, binderfs depends on it, Rust binder excludes it; ashmem is gone (memfd fallback).
  `factory/kernel/linux-bun/config.x86_64` selects the Rust binder, which Waydroid's binderfs allocation cannot use.
- Microsoft config-wsl (a989171) has everything Waydroid needs except binder: fragment `factory/wsl/kernel/wsl-android.config` (unbuilt).
- Tests: `crates/bun-waydroid` 17 unit tests pass (Windows host); `packages/waydroid` 13 tests pass (fake scrcpy server: every frame
  forwarded byte for byte, touch bytes reach the control socket, auth, APK signature check, path allow-list); `tsc --noEmit` clean.
- Not measured: fps, latency, RAM. `packages/waydroid/scripts/e2e.ts` produces them against any adb target
  (pinned F-Droid APK org.fdroid.fdroid 2.0.2, sha256 19d51fad...).

## Web paths
- Remote (implemented): Waydroid/redroid/Cuttlefish -> adb -> scrcpy-server v5.0.1 (pinned sha256) -> Bun gateway WS -> `<android-screen>` (WebCodecs).
- In-browser (container2wasm/QEMU-wasm + binder kernel + Waydroid): not attempted. wasm32 caps at 4 GB and Android needs about 2 GB plus TCG
  emulation of x86_64; no measurement exists, so no claim. APK without Android (ART in wasm): nothing exists.

## Remaining
Android 17 inside the unified session container (vgem render node and waydroid0 netns there), the gateway unit on the Android 17
serial instead of redroid 13, notification bridge, CI workflow `waydroid.yml`, e2e numbers on the VPS.
