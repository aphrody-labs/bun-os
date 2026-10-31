# Bun OS unified image

Owner order (2026-10-30): one Google-style OS made of Android, ChromiumOS, COSMIC and Bun OS, in one image with one UI, and no OS emulators. This page describes how that image is built.

## Principle

The image has one rootfs, one kernel and one session, and COSMIC is the only UI. Android 17 runs as a system container that shares the kernel, and each Android app opens as its own COSMIC window. Chromium (Helium) and installed web apps also open as COSMIC windows. There is no emulator, no Cuttlefish, no AVD and no OS VM. The same rootfs ships in two forms:

| Form          | Factory target                               | What it is                                                                                                                        |
| ------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| WebOS session | `bunos-unified:session`                      | One container per signed-in user. cage (headless) hosts a nested cosmic-comp, and `aphrody-remote-desktop` streams cage's output. |
| Bootable disk | `bunos-unified:unified` + `assemble-disk.sh` | The same rootfs plus a kernel, systemd and cosmic-greeter, written to a UEFI GPT disk image.                                      |

Build commands (VPS):

```sh
bun factory/images/build.ts build bunos-unified --target session
bun factory/images/build.ts build bunos-unified --target unified
factory/images/bunos-unified/assemble-disk.sh /home/ubuntu/bun-os-disk/unified   # -> bunos-unified.img (+ .sha256)
```

## Image layout

| Layer                 | Source                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base                  | `ubuntu:26.04` (digest pinned in `factory/images/manifest.json`) + the Pop!_OS `resolute` archive                             | The native-apps lane builds against 26.04 glibc.                                                                                                                                                                                                                                                                                           |
| UI                    | COSMIC: comp, session, panel, launcher, app library, applets, notifications, OSD, settings, files, term, edit, store, greeter | The fork debs of the native-apps lane (`~/native-apps/debs`, built from `vendor/cosmic-epoch` with the shared `[patch]` table `factory/os/rust-desktop/cargo-patch.toml`) override Pop's packages. Pop's packages fill the set until every fork deb exists.                                                                                |
| Session layer         | `factory/desktop/cosmic-session/`                                                                                             | Aphrody/Bun themes and the Omarchy-derived theme set, pop-launcher scripts, `bunos-launch-webapp`, `start-cosmic-headless`.                                                                                                                                                                                                                |
| Android 17            | `vendor/waydroid` (our fork, `make install`), libgbinder and python3-gbinder from repo.waydro.id                              | System image: LineageOS 24 (Android 17) GAPPS waydroid_x86_64 plus the MAINLINE vendor image. Kept private and cached on the VPS in `~/.cache/bunos-waydroid/a17/images`. It is bind-mounted read-only and never baked into the image. Multi-window and desktop-mode props are in `rootfs/usr/share/bunos/waydroid/waydroid_base.prop.d/`. |
| Browser and PWAs      | Helium 0.20.3.1 (`/opt/helium`, pin `helium`)                                                                                 | Ozone/Wayland. Web apps open in `--app` windows with their own app_id and `.desktop` entry (example: `com.aphrody.webapp.Gemini`). The Chromium lane's fork build will replace this pin.                                                                                                                                                   |
| Runtime               | Bun canary `1.4.4-canary.20261028.1` (pin `bun`)                                                                              | `/usr/bin/bun`, `bunx`.                                                                                                                                                                                                                                                                                                                    |
| Streaming             | `aphrody-remote-desktop` (features `wayland,android`), built by the session agent                                             | Uses wlr-screencopy and virtual pointer/keyboard. Checksum-verified at build time.                                                                                                                                                                                                                                                         |
| Extra binaries        | `~/build/storage/artifacts/bunos-unified/bin/` on the VPS                                                                     | Binaries placed there (bun-obscura, the `google` CLI, `bun-os-google`) are copied to `/usr/bin`.                                                                                                                                                                                                                                           |
| Boot (`unified` only) | Ubuntu `linux-image-generic` with modules-extra, initramfs-tools, systemd-boot, greetd + cosmic-greeter, NetworkManager       | `bunos-binderfs.service` loads binder and mounts binderfs, and `waydroid-container.service` starts at boot.                                                                                                                                                                                                                                |

## Session container contract

This contract is shared with the session and gateway agent and with `docs/webos/ARCHITECTURE.md`.

- **Entrypoint:** `/usr/bin/bunos-unified-session`, under tini.
  - Inputs: `BUNOS_SESSION_SIZE=WxH` and `APHRODY_REMOTE_TOKEN_FILE=/run/secrets/session.token`.
  - Writes `/run/bunos/ready` once cage and the gateway are up.
- **User:** `aphrody`, uid 1000, home `/home/aphrody` on the volume `aphrody-home-<user>`. `XDG_RUNTIME_DIR=/run/user/1000` is a tmpfs.
- **Wayland:**
  - cage runs on `wayland-0` with output `HEADLESS-1` (pixman).
  - cosmic-comp runs nested (`COSMIC_BACKEND=winit`) on `wayland-1`.
  - The gateway binds `0.0.0.0:8794` inside the container network only.
- **Android:** each session mounts its own binderfs instance, so the host's `/dev/binderfs` is not shared.
  - Waydroid's container manager runs as root.
  - The user session starts from COSMIC autostart (`bunos-waydroid-session.desktop`), so Android windows are COSMIC toplevels.
  - Waydroid writes `~/.local/share/applications/waydroid.*.desktop` for every Android app. The COSMIC launcher and app library list them next to the Linux and web apps.
- **Docker settings:** this is the privileged form, so only signed-in users get a session.
  - Capabilities: `SYS_ADMIN NET_ADMIN NET_RAW SETUID SETGID CHOWN DAC_OVERRIDE FOWNER KILL MKNOD SYS_CHROOT SETPCAP AUDIT_WRITE`.
  - AppArmor and seccomp unconfined; private cgroupns; no-new-privileges; pids limit of at least 4096.
  - Read-only rootfs, with tmpfs at `/run`, `/tmp`, `/var/lib/waydroid`, `/var/lib/misc` and `/var/log`.
  - `/dev/shm` of 1 GiB; no host network.
  - Waydroid images mounted read-only at `/usr/share/bunos/waydroid/images`.

## Components reused (no rewrites)

| Area              | Component                                                                                                                                           | Use in the image                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google            | `crates/bun-os-google` (SDK, cloud, search, atlas, languages; `/api/google/*` merged into aphrody-webos)                                            | System account broker: `bun-os-google token --account owner\|service`. Drive in COSMIC Files through `bun-os-google rclone-config` plus a user `rclone mount`. Google search in the launcher.            |
| Google            | `crates/aphrody-google` (Gemini, Antigravity, model client, `google` CLI) and `packages/google` (`@aphrody/google`)                                 | Gemini through Vertex as the system assistant in the launcher (Aphrody Chat against `/api/chat/v1/*`). Bun consumers use `@aphrody/google/services`.                                                     |
| Google            | aphrody-labs/gemini, plugin-google-gemini (private)                                                                                                 | Assistant backends; private.                                                                                                                                                                             |
| Chromium          | Helium (`vendor/helium-linux`), aphrody-labs/chromium mirror                                                                                        | Browser and PWA host.                                                                                                                                                                                    |
| Chromium          | Servo (fork), cef-rs (`vendor/cef-rs`, CEF 156)                                                                                                     | Embedded webview, with cef-rs as fallback inside Rust apps.                                                                                                                                              |
| Chromium          | aphrody-code/chrome-devtools-mcp                                                                                                                    | Agent automation of Helium.                                                                                                                                                                              |
| Chromium          | bun-chromium, bun-google                                                                                                                            | Retired: they depend on the abandoned Bun fork builtins. Useful parts are ported to upstream Bun (CDP over WebSocket, `Bun.WebView`) or to the Rust crates. chromium-rs is an empty stub and is ignored. |
| Headless engine   | aphrody-labs/bun-obscura (pinned `3ed4a76`)                                                                                                         | Headless engine and CDP server for agents, search and automation (a systemd user service), next to Helium.                                                                                               |
| ChromiumOS        | aphrody-labs/minijail                                                                                                                               | Sandbox for services and Android helpers.                                                                                                                                                                |
| ChromiumOS        | aphrody-labs/platform2 (`vm_tools/sommelier`, `arc/` as reference)                                                                                  | Only if a Wayland proxy is needed.                                                                                                                                                                       |
| ChromiumOS        | aphrody-labs/crosvm                                                                                                                                 | Optional guest VMs only, never for Android or the desktop.                                                                                                                                               |
| ChromeOS features | `cosmic-applet-phone-hub` in aphrody-labs/cosmic-applets                                                                                            | Phone Hub analogue: adb devices and the Android 17 container, scrcpy mirror, photos into COSMIC Files. Sits in the default panel next to the status area.                                                |
| Bun OS            | cosmic-store on the pacman/apt/flatpak/F-Droid feeds, Rio, Spacedrive, Aphrody Chat/Search, the Flutter/Compose apps, `crates/aphrody-webos-server` | Shipped as fork debs or extra binaries.                                                                                                                                                                  |
| Games             | The console emulators (store apps)                                                                                                                  | Run in the same COSMIC session. gamescope is used only as an app-level fullscreen wrapper.                                                                                                               |

## Retired

Product session types replaced by the unified image:

- the Android Emulator image (`factory/images/bunos-android-17`, AVD Pixel Tablet);
- Cuttlefish;
- the Googlebook AVD;
- the ChromiumOS VM;
- separate redroid sessions;
- the per-OS WebOS sessions (already dropped from protocol v2);
- the Redox image and sessions (Redox stays a code-sharing partner through the shared `[patch]` table);
- the Hyprland streamed session, once COSMIC streams.

`bunos-android-17` and `bunos-android` stay buildable only as developer tools, not as product sessions. The Arch-based `bunos-disk` remains the gaming/handheld disk until its packages move into this image.

## Open items

- Kernel: build `factory/kernel/linux-bun` (binder, binderfs, memfd, vkms, KVM) as a deb and swap it for Ubuntu's generic kernel.
- The Rust userland (uutils, sudo-rs) from the Rust base lane.
- The COSMIC fork debs for the whole set. Until then, Pop's packages fill the gaps (`/usr/share/bun-os/fork-debs.txt` lists what the image actually took from the forks).
- The M3 theme generator output as the default COSMIC theme.
- The Helium fork build.
- bun-obscura and the Google binaries in `extra-bin`.
- The phone-hub applet in the default panel.
- An ISO (the current deliverable is a raw UEFI disk image).
- Signed publication at aphrody.com/downloads/.
