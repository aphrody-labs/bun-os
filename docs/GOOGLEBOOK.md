# Googlebook parity (2026-10-30)

Owner order: a Googlebook, meaning Android 17 plus ChromiumOS, inside the one unified Bun OS image.
Owner pivot (2026-10-30): no OS emulators or VMs in the product. Android runs as the native Android 17
container, ChromiumOS contributes components, and COSMIC hosts the ChromeOS-style features.

## What Googlebook is

- Googlebook is Google's laptop line. It runs the Android-based ChromeOS successor developed as
  "Aluminium OS" (ALOS), built on Android 17. Sources: [Googlebook](https://en.wikipedia.org/wiki/Googlebook),
  [Aluminium OS](https://en.wikipedia.org/wiki/Aluminium_OS),
  [The Gadgeteer, 2026-05-16](https://the-gadgeteer.com/2026/05/16/googlebook-aluminiumos-leak-first-look/).
- API level: Android 17 = API 37. Google's SDK repository (read with `sdkmanager --list --channel=3`
  on 2026-10-30) publishes the desktop images at API 37.0 and 37.1, and platforms 37.0, 37.1 and 37.2:
  - `system-images;android-37.1;android-desktop;x86_64|arm64-v8a`, "Google APIs Desktop (Preview)", rev 1.
    This is the closest public build to a Googlebook.
  - `system-images;android-37.0;android-desktop;x86_64|arm64-v8a`, "AOSP Desktop (Preview)", rev 1, without GMS.
  - Older desktop images exist for API 32, 33 and 34.
- Device profiles in `avdmanager list device`: `desktop_small`, `desktop_medium`, `desktop_large` and
  `13.5in Freeform`.
- No Googlebook-specific SDK add-on exists. The desktop APIs are in the platform: desktop windowing
  (freeform, resizable windows with caption bars), Android 17 bubbles as a windowing mode (apps must
  target API 37), the pinned interactive PiP layer on external displays, and the large-screen rule that
  apps targeting API 37 can no longer refuse resizing or orientation changes on large screens.

## Applied to Bun OS

| Googlebook piece | Bun OS owner | State |
| --- | --- | --- |
| Android 17 SDK, NDK, JDK at API 37.x | `factory/android/sdk.json`, `/opt/android-sdk`, image `bunos-android-sdk:37` | installed on the VPS; see [ANDROID.md](ANDROID.md) |
| Android 17 runtime | Waydroid Android 17 container in `factory/images/bunos-unified` | owned by the Android 17 agent |
| Desktop windowing in that container | settings below | applied by `waydroid-android17 provision` (globals) and the unified image (`persist.wm.debug.desktop_mode_enabled`) |
| ChromeOS sandboxing | `aphrody-labs/minijail`, `factory/chromiumos/minijail-deb.ts` | `bunos-minijail` deb built against ubuntu:26.04 into `~/native-apps/debs`, smoke-tested |
| Other ChromeOS system pieces | forks `aphrody-labs/platform2`, `aphrody-labs/crosvm` | forked; not in the default image |
| Phone Hub | `cosmic-applet-phone-hub` in `aphrody-labs/cosmic-applets` | `aphrody-labs/cosmic-applets` fcf8d6ae, `cargo check --locked` passes; on the default top bar via `aphrody-labs/cosmic-panel` be1bf7b3; pinned by `aphrody-labs/cosmic-epoch` 55646124 |
| Files integration | Phone Hub "Recent photos in Files" | copies camera photos and opens COSMIC Files |

Desktop windowing settings for the Android 17 container (adb shell, persistent in `/data`):

```sh
settings put global enable_freeform_support 1
settings put global force_resizable_activities 1
settings put global enable_non_resizable_multi_window 1
setprop persist.wm.debug.desktop_mode_enabled true   # Developer options > Enable desktop windowing
```

Use a landscape display of at least 1920x1080 at 160 dpi with a hardware keyboard and pointer, as the
`desktop_large` profile does.

## ChromiumOS components

- Upstream: `https://chromium.googlesource.com/chromiumos/*`, pinned in `factory/chromiumos/projects.json`
  (latest release branch `release-R158-16868.B`).
- `aphrody-labs/platform2`: mirror of `chromiumos/platform2` `main` and `release-R158-16868.B` with
  full history, kept as reference: `arc/` (ARC++ Android-on-Linux integration), `cros-disks`,
  `vm_tools/garcon`. `vm_tools/sommelier` is not needed: the Android container speaks Wayland to
  cosmic-comp directly. BSD-3-Clause.
- `aphrody-labs/minijail`: sandboxing and jailing for services in the image. `bun factory/chromiumos/minijail-deb.ts`
  builds `bunos-minijail` (minijail0, libminijail, libminijailpreload, headers, man pages, licence) in
  ubuntu:26.04; the unified image installs every deb in `~/native-apps/debs`. BSD-3-Clause.
- `aphrody-labs/crosvm`: only for optional guest VMs; the product image runs no OS VM.
- Official ChromiumOS images: Google publishes no downloadable ChromiumOS amd64-generic image; ChromeOS
  Flex is the official x86 build (proprietary, private use only). A ChromiumOS VM is dropped by the pivot.

## Phone Hub applet

ChromeOS Phone Hub equivalent for COSMIC, in the multicall `cosmic-applets` binary
(`cosmic-applet-phone-hub`, desktop id `com.aphrody.BunOsAppletPhoneHub`). It lists adb devices (USB or
network phones and the Android 17 container, `BUNOS_ANDROID_ADB`, default `127.0.0.1:5555`) with model,
Android version, API level, battery and Do Not Disturb state. Actions: mirror the screen (scrcpy),
copy the newest camera photos to `~/Pictures/Phone Hub/<model>` and open them in COSMIC Files, toggle
Do Not Disturb, lock the phone, connect the container. adb is taken from `ADB`, `ANDROID_HOME` or
`/opt/android-sdk`.

## Remaining

- Rebuild the `cosmic-applets` and `cosmic-panel` debs in the native-apps lane from the new pins.
- Expose the Android container `/sdcard` in Files.
- ChromeOS-style Smart Lock, tethering and notification mirroring in Phone Hub.
- NDK canary builds are not in the SDK repository (ci.android.com only); the pinned NDKs are r30 stable
  and r29 side by side.
