# Bun OS: the product (single source of truth)

Owner order (2026-10-31): consolidate everything into one product. The product is the **unified Bun OS image**: Android 17 running natively, ChromiumOS components, the COSMIC UI and the Bun OS Rust base, with Gemini at the centre. It ships in two forms:

- **(a)** a bootable ISO/disk image on aphrody.com/downloads;
- **(b)** the single WebOS session streamed at aphrody.com.

Everything that does not feed the image is cut. This checklist is the only place for status. Other goal documents point here. Image layout and the session container contract: [`docs/UNIFIED-IMAGE.md`](UNIFIED-IMAGE.md). WebOS server design: [`docs/webos/ARCHITECTURE.md`](webos/ARCHITECTURE.md).

Product lead: the integrator agent. Each owner updates their own lines in place, commits straight to main, and reports to the product lead.

States: **done** (with evidence), **building** (work in flight), **missing** (nobody has started).

## Critical path to the first end-to-end build

1. COSMIC packages
2. COSMIC session in cage
3. Android 17 inside it
4. Helium and PWAs
5. Gemini defaults
6. Disk image/ISO plus the WebOS stream, qualified with screenshots

## Checklist

### Image and session

| #   | Component                                                                                         | Owner                                                                                                        | State                                 | Evidence                                                                                                                          | Next step                                                                   |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Unified rootfs `factory/images/bunos-unified` (Ubuntu 26.04 + Pop!_OS resolute)                   | integrator                                                                                                   | done                                  | `bunos-unified:session` 3.86 GB built on the VPS (job `bunos-unified-20261030T232700` and later)                                  | Rebuild on every fork deb drop.                                             |
| 2   | COSMIC session in cage, streamed by screencopy                                                    | integrator                                                                                                   | done                                  | `~/bun-os-disk/qualify-session-4/02-linux-and-web.png`: COSMIC panel, dock and a terminal window at 1600x900                      | Feed it through the WebOS server (line 12).                                 |
| 3   | COSMIC fork debs (comp, session, panel, launcher, app library, applets, settings, greeter, store) | native-apps lane (tmux `native-lane2`); product lead collects the outputs; forks and pins: a9ca9004273dae97e | building                              | `~/native-apps/debs/index.tsv`; until a deb exists, Pop's package fills the slot (`/usr/share/bun-os/fork-debs.txt` in the image) | Land cosmic-comp and cosmic-session first; product lead rebuilds the image. |
| 4   | Rio, Spacedrive, Aphrody Chat/Search debs                                                         | native-apps lane                                                                                             | building                              | same lane                                                                                                                         | Same drop path.                                                             |
| 5   | M3 theme `bunos-m3` as the default theme                                                          | a36e37401f4096d1f                                                                                            | done (theme); building (verification) | Theme files on main (e1db66eb93); `first-login` applies it                                                                        | Product lead verifies it in the next screenshot.                            |
| 6   | Flutter/Compose apps (bunos-flutter-store, Compose tokens)                                        | a36e37401f4096d1f                                                                                            | building                              | —                                                                                                                                 | Binary to `~/build/storage/artifacts/bunos-unified/bin/`.                   |
| 7   | Stream gateway `aphrody-remote-desktop` inside the container (:8794)                              | a7f4b115bcd8b4ae5                                                                                            | done (in image)                       | Starts with the token file; `ready` marker written                                                                                | End-to-end input test through the server.                                   |
| 8   | Per-user session manager (bollard)                                                                | a7f4b115bcd8b4ae5                                                                                            | building                              | `crates/aphrody-webos-sessions` on main, not compiled yet                                                                         | Compile, then start `bunos-unified:session` per signed-in user.             |

### Android

| #   | Component                                                                                        | Owner             | State        | Evidence                                                                                                                           | Next step                                            |
| --- | ------------------------------------------------------------------------------------------------ | ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 9   | Android 17 in the session (Waydroid, multi-window, private binderfs)                             | aa04df4a20cbea375 | building     | Inside the container: init, network, image mounts and LXC start all pass. Android then stops after about 90 s (cgroup v2 nesting). | `sys.boot_completed=1` in `bunos-unified-qualify`.   |
| 10  | Play Store (LineageOS 24 GAPPS) and F-Droid; Android apps as COSMIC windows and launcher entries | aa04df4a20cbea375 | blocked on 9 | Images cached at `~/.cache/bunos-waydroid/a17` (private)                                                                           | Screenshot of the Play Store next to Rio and Helium. |
| 11  | Android notification and clipboard bridges into COSMIC                                           | aa04df4a20cbea375 | missing      | —                                                                                                                                  | After 10.                                            |

### WebOS

| #   | Component                                                                           | Owner             | State    | Evidence                                               | Next step                                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | ----------------- | -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Rust WebOS server and iced client; aphrody.com points at the unified session stream | a44763853d47efe83 | building | Server and client on main; first release build running | Activate on aphrody.com. Set `WEBOS_SESSION` to the container gateway (remote-desktop wire, token file `/run/secrets/session.token`). |
| 13  | bun-ui/buncc WASM, only where the server's `/ui` consumes it                        | ae8dc2cf7c9c5e8c2 | building | —                                                      | Keep to what `/ui` serves; cut the rest.                                                                                              |

### Browser and web

| #   | Component                                                     | Owner                          | State    | Evidence                                                                                                      | Next step                                             |
| --- | ------------------------------------------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 14  | Helium browser: fork build replaces the upstream 0.20.3.1 pin | a7f4b115bcd8b4ae5              | building | Upstream pin in the image. Streamed sessions run it without the Chromium sandbox (the host restricts userns). | Publish the fork tarball; product lead swaps the pin. |
| 15  | PWAs as Helium windows with launcher entries                  | integrator + a51eaa3f99faff2dc | building | Gemini PWA entry in the image; Helium window screenshot pending                                               | Add AI Studio and NotebookLM with real icons.         |
| 16  | bun-obscura headless engine (CDP) as a user service           | accecfbc3ef3c32d8              | missing  | —                                                                                                             | Binary to `extra-bin`, plus a user unit.              |

### Google and Gemini

| #   | Component                                                                                                                                                         | Owner             | State    | Evidence                                                                                                                       | Next step                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 17  | Gemini at the centre: APK in the Android first-boot defaults, forked gemini-cli, native Aphrody Gemini client, Gemini as default assistant (launcher, Files, Rio) | a51eaa3f99faff2dc | building | Slots reserved: APKs in `/usr/share/bunos/android/apks/`, CLI and client in `extra-bin`/debs, assistant in the launcher plugin | Deliver the packages to those slots. |
| 18  | System Google account broker; Drive in COSMIC Files (rclone mount)                                                                                                | a51eaa3f99faff2dc | building | `/api/google/*` on the server; rclone and fuse3 in the image                                                                   | User unit plus a Files bookmark.     |
| 19  | Microsoft account (OneDrive)                                                                                                                                      | a51eaa3f99faff2dc | missing  | —                                                                                                                              | After 18.                            |

### Base, ChromiumOS and kernel

| #   | Component                                                                                  | Owner             | State    | Evidence                          | Next step                                                   |
| --- | ------------------------------------------------------------------------------------------ | ----------------- | -------- | --------------------------------- | ----------------------------------------------------------- |
| 20  | Rust base debs (rust-coreutils, sudo-rs, ntpd-rs)                                          | af59785b9af6497ec | building | —                                 | Debs into `~/native-apps/debs`.                             |
| 21  | ChromiumOS components: minijail deb, phone-hub applet in cosmic-applets; SDK/NDK           | a33f41200d26035af | building | Forks in aphrody-labs             | minijail deb and the applet in the cosmic-applets fork deb. |
| 22  | Kernel `linux-bun` as a deb (binder, binderfs, memfd, vkms, KVM), replacing Ubuntu generic | a70548c63f0d79d74 | missing  | Ubuntu generic in the image today | Deb build on the OS lane.                                   |

### Store and games

| #   | Component                                                                                                     | Owner             | State    | Evidence                                                        | Next step                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 23  | Store: cosmic-store on the apt/pacman/flatpak/F-Droid feeds; signed apt feed `aphrody.com/repo/apt resolute`  | a8712258e32ef0222 | building | The apt feed returns 404                                        | Make the feed live; product lead switches the image to it.                                             |
| 24  | Games: emulators and Proton as Store apps in the same COSMIC session (gamescope only as an app-level wrapper) | a6abdc4bbd18b6999 | building | 18 PKGBUILDs; qualification in `~/apps/webos/objects/emulators` | Ship as apps in the unified image. `bunos-gaming:session` stays a test harness, not a product session. |

### Delivery and process

| #   | Component                                                                                            | Owner             | State    | Evidence                             | Next step                                                            |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------- | -------- | ------------------------------------ | -------------------------------------------------------------------- |
| 25  | Bootable disk image/ISO (`unified` target + `assemble-disk.sh`), QEMU/KVM boot to the COSMIC greeter | integrator        | building | Target defined                       | Build, assemble, boot and screenshot. Then produce the ISO.          |
| 26  | Signed publication at aphrody.com/downloads                                                          | integrator        | missing  | Keys in `~/apps/webos/secrets/store` | After 25.                                                            |
| 27  | CI gate, blockers, a2a                                                                               | af7c62e4cef507784 | building | —                                    | Pre-push gate runs `bun factory/images/build.ts plan bunos-unified`. |

## Cut (does not feed the image)

| Item                                                                                       | Owner             |
| ------------------------------------------------------------------------------------------ | ----------------- |
| aphrody-app purge                                                                          | abbe258baa2e290f9 |
| Discord                                                                                    | a79224f40231878fb |
| Legacy cleanup                                                                             | a70548c63f0d79d74 |
| Bun fork builtins (port useful pieces to plugins)                                          | accecfbc3ef3c32d8 |
| Redox image and sessions (code-sharing partner only)                                       | —                 |
| Android Emulator / Cuttlefish / Googlebook AVD / ChromiumOS VM / separate redroid sessions | —                 |
| Hyprland streamed session, once line 12 serves COSMIC                                      | —                 |
| Per-OS WebOS sessions                                                                      | —                 |
