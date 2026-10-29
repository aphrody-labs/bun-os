<!-- SPDX-License-Identifier: MIT -->
# Bun OS as a real bootable OS: audit and first disk image (2026-10-22)

Goal: a disk image that boots into the Bun Engine library as a gamescope session, plus an Omarchy-style
Hyprland desktop, at the level of Omarchy, Bazzite and CachyOS. This file records what exists, what was
built and booted on the VPS, and what is missing. Evidence is a repository path or a VPS observation;
"declared" (catalog, plan, package list) is not "built".

## What builds today

- `bun factory/images/build.ts plan bunos-gaming --target bootable` reports the `bootable` target as blocked:
  "No explicit kernel composition is selected or qualified" (`factory/images/bunos-gaming/Containerfile`,
  `factory/usr/manifest.json` `kernelSelection.state = blocked`). The `bun factory image ...` form from the
  task does not exist in the VPS checkout (it is behind origin/os) or in this one (`factory arch image` is
  rejected); `factory/images/build.ts` is the working entry.
- VPS (`ssh vps`): no `bunos-gaming` image, no rootfs tar, nothing under `bun-os-usr` except a package cache.
  The only Arch rootfs is `bunos-omarchy:imported-rootfs` (official Try-Omarchy 4.0.4 guest rootfs: 678 packages,
  Hyprland 0.56.2 (upstream current: v0.57.0, 2026-10-28), uwsm, NetworkManager, quickshell, Arch kernel 7.2.9, no initramfs, no gamescope, no Bun).
- Host tools: qemu 11.0.3, mkfs.btrfs/ext4/vfat, sfdisk, docker. Missing: OVMF (taken from the `edk2-ovmf` pacman
  package inside a container), guestfish, genimage, systemd-repart, mtools and bootctl (both used from the
  container image). `/dev/kvm` is `root:kvm 0660` and the `ubuntu` user is not in `kvm`, so QEMU runs with TCG.

## Feature matrix

`have` = present and exercised in the image or the repository; `partial` = declared, packaged elsewhere or
only the plumbing exists; `missing` = no implementation (an upstream catalog entry alone is `missing`).

| # | Feature | Omarchy / Bazzite / CachyOS | Bun OS today | Evidence |
| - | --- | --- | --- | --- |
| 1 | Arch base, pacman/libalpm | Arch (all but Bazzite: Fedora atomic) | have | `factory/arch/pacman.ts`, `factory/usr/manifest.json`; the disk image runs pacman |
| 2 | CachyOS repositories | CachyOS | partial | disk image: `cachyos-v3`, `cachyos-core-v3`, `cachyos-extra-v3`, `cachyos` inserted before `[core]` by upstream's `install-repo.awk` (`factory/upstream/cachyos-repo`, `factory/images/bunos-disk/cachyos-repo.sh`); the container image still uses only `[cachyos]` from `factory/usr/manifest.json` |
| 3 | Optimised kernel `linux-cachyos` | CachyOS, Bazzite (own kernel) | partial | `bootable.packages` is now the kernel list the disk image installs: `linux-cachyos` 7.3.0-3 (v3 build) replaces Arch `linux`; see "Absorbed image". The verity `/usr` factory keeps `kernelSelection` `blocked` (no qualified receipt) |
| 4 | sched-ext (scx), BORE | CachyOS | partial | `scx-scheds` + `scx-tools` installed, `scx_loader.service` enabled, `/etc/scx_loader/config.toml` selects `scx_lavd`; see "Absorbed image" for whether it ran |
| 5 | x86-64-v3/v4 package builds | CachyOS | partial | v3 repositories enabled in the disk image (kernel, inputplumber, mangohud, snapper, ... come from `cachyos-*-v3`); v4/znver4 not selected; the image needs an AVX2 CPU |
| 6 | Hyprland desktop | Omarchy | have | Hyprland 0.56.2 in the image (upstream current v0.57.0, 2026-10-28; Arch extra 0.57.0-1), uwsm, quickshell in the image; session file `bunos-desktop.desktop` |
| 7 | Omarchy defaults, menus, themes | Omarchy | partial | `/usr/share/omarchy` (444 `bin` scripts incl. `omarchy-menu*`, 21 themes) present; per-user config seeded by first boot; Omarchy installer migrations and `limine-snapper` not wired |
| 8 | gamescope session without a display manager, return to desktop | Bazzite, ChimeraOS | partial | `factory/bunos/pkgbuilds/bun-engine/bunos-gamescope-session`; `bunos-session.service` + `bunos-session switch desktop|gaming` in `factory/images/bunos-disk/` (this change) |
| 9 | Bun Engine library as the session client | Steam Big Picture equivalent | partial | `packages/bun-engine/src/frontend/cli.ts`; bundled with Bun in the image, served on loopback; needs a Chromium kiosk window under gamescope |
| 10 | Steam, Proton, Heroic, Lutris, umu | Bazzite, CachyOS gaming meta | partial | `gaming.packages` (now `cachyos-gaming-meta` + `cachyos-gaming-applications` + lib32 Mesa/NVIDIA userspace) is installed in the disk rootfs (all packages resolved, `missing-packages.txt` empty, rootfs about 12 GB); Steam, Proton and games were not run (no GPU, no Steam login) |
| 11 | Handheld support: hhd, InputPlumber, TDP | Bazzite, ChimeraOS | partial | `handheld.packages`: `hhd`, `inputplumber`, `steamos-manager`, `power-profiles-daemon`; `inputplumber.service` enabled, `hhd@` disabled and conflicting with it; ChimeraOS `device-quirks` via gamescope-session-plus. Not tested on handheld hardware |
| 12 | Controller udev rules | Bazzite, CachyOS (`game-devices-udev`) | partial | `steam-devices` (Valve rules), the rules shipped by `inputplumber` and `hhd`, and three reviewed Bazzite rules (backlight, ROG Ally X wake-up, Valve wake-up). `game-devices-udev` is not in the repositories |
| 13 | Decky-like plugin loader | Bazzite | missing | named in `BAZZITE-FORKS.md` only |
| 14 | Atomic or rollback updates | Bazzite (ostree), Omarchy (snapper + limine) | partial | Omarchy's stack: `snap-pac` (pre/post snapshot per pacman transaction), snapper `root` config from Omarchy's own `snapper.sh`, `limine-snapper-sync` (boot entry per snapshot), Limine on the ESP at `/boot`. In QEMU a `pacman -S linux-cachyos` produced snapshots 2/3 that appeared as Limine entries; booting a snapshot entry was not exercised. Verity `/usr` design: `factory/usr/boot/repart.d` (not used) |
| 15 | First-boot setup | Bazzite (yafti), Omarchy installer | partial | `bunos-firstboot.service` (hostname, home seed); no wizard, locale, user or network prompt |
| 16 | GPU drivers: AMD/Intel Mesa, NVIDIA, supergfxctl | all three | partial | Mesa + `vulkan-swrast`/`vulkan-virtio` in the image; NVIDIA and `supergfxctl` only listed in `gaming.packages` |
| 17 | Flatpak | Bazzite | partial | `flatpak` in `gaming.packages`, installed in the disk image; no remotes configured |
| 18 | Distrobox, Waydroid, Sunshine | Bazzite (ujust) | partial | `distrobox`, `waydroid`, `sunshine` in `gaming.packages` as pacman packages instead of ujust recipes; not exercised |
| 19 | Installer ISO / live media | all three | partial | engine chosen: `archinstall` 4.5 with `factory/images/bunos-disk/installer/archinstall-bunos.json` (accepted by archinstall's own config parser) and `bunos-installer-post`; no archiso profile, nothing installed to a disk by it yet |
| 20 | Update channel | all three | missing | procedure documented in `docs/bun-os/ABSORBED-UPSTREAM.md` (signed repo, `[bunos]` stanza, `pacman -Syu` with snap-pac); the local `[bunos]` repo is still unsigned and unpublished |
| 21 | UEFI boot loader with boot menu | CachyOS (limine/grub), Omarchy (limine) | partial | Limine (as Omarchy and CachyOS) replaces systemd-boot; ESP mounted on `/boot`, kernel at the ESP root, pacman hooks from `limine-mkinitcpio-hook`; see "Absorbed image" |
| 22 | Serial console | n/a | have | `console=ttyS0,115200`, console getty on ttyS0 (root, empty password, dev only) |
| 23 | Network | all | have | NetworkManager + systemd-resolved enabled in the image |
| 24 | Bootable disk-image builder | n/a | have | `factory/images/bunos-disk/` (rootless container, no loop device) |

Count after the 2026-10-23 absorption: have 5, partial 17, missing 2 (24 rows; before: 8 / 10 / 6). Rows 3, 4, 5, 10, 11,
12, 14, 17, 18, 19 and 21 moved from `missing`/`have` to `partial`: the work is packaged or configured from upstream and the
image was built, but see "Absorbed image" below for exactly what was and was not run. Row 21 went from `have` to `partial`
because the loader changed (systemd-boot to Limine) and the new boot path has less evidence than the old one.

Five biggest gaps: (1) no selected/qualified kernel, so no `linux-cachyos`, scx or v3 builds; (2) no
handheld/controller layer (hhd/InputPlumber/udev rules/TDP); (3) no installer or update channel, the
local `[bunos]` repo is never published; (4) the gaming package set was never installed into a bootable
rootfs (Steam, Proton, Heroic, NVIDIA); (5) no snapshot-driven rollback and no hardware (GPU) boot
qualification of the gamescope session.

## Disk image

Pieces, all under `factory/images/bunos-disk/`:

- `Containerfile`: `FROM bunos-omarchy:imported-rootfs`; `pacman -Syu`; adds gamescope, xwayland, lavapipe,
  virtio Vulkan, btrfs-progs, dosfstools, snapper; bundles the Bun Engine CLI (`bun build`) with the VPS Bun;
  creates user `bunos`; enables the session units; removes the Try-Omarchy Windows-launcher units from the boot
  path; rebuilds the initramfs without `autodetect`.
- `assemble.sh` / `assemble-inner.sh`: runs in an unprivileged container: copies the rootfs into a btrfs image
  (`mkfs.btrfs --rootdir`, zstd, subvolumes `@`, `@home`, `@snapshots`), builds a 512 MiB vfat ESP with systemd-boot
  and the Arch kernel/initramfs, writes a GPT (`sfdisk`) and joins them. No sudo, no loop device.
- `run-qemu.sh`: OVMF + virtio-gpu + serial log + monitor socket for `screendump`.

Sessions: `bunos-session.service` (tty1, PAM login, `Restart=always`, replaces getty) runs
`bunos-session-select`, which starts `bunos-gamescope-session` (default) or `uwsm start Hyprland` according
to the boot entry (`bunos.session=` on the kernel command line) or `bunos-session switch`.

The empty root password on the serial console and the `bunos` NOPASSWD sudo rule are development-only and must be removed from a
release image. The packages are not signed by a Bun OS key and the rootfs is not an immutable lock.

## Boot result

Image: `/home/ubuntu/bun-os-disk/work/bunos-disk.img` on the VPS (not committed): 16645095424 bytes sparse
(about 3.5 GiB used; ESP 512 MiB + 15 GiB btrfs), sha256
`2a01553b7e5164157e3ecf95b418f9b2a765c994a245da7512ed32ea187d2f1c`. Booted with OVMF under QEMU TCG
(`run-qemu.sh`, image copied to tmpfs because the /home disk was saturated by other jobs).

Seen booting:

- OVMF starts systemd-boot with the three entries; kernel 7.2.9-arch1-1 and the initramfs mount the btrfs root
  (`@`, `@home`, `@snapshots` listed by `btrfs subvolume list`), the ESP mounts on `/boot`.
- systemd reaches `running` with no failed units; NetworkManager gets 10.0.2.15 by DHCP; a root login works on the
  serial console (empty password, development only).
- `bunos-session.service` starts as `bunos` and selects the gaming session. gamescope 3.16.31 starts, then fails with
  "vulkan: not a valid physical device" (it rejects llvmpipe), as expected without a GPU. After two quick failures the
  selector logs "falling back to the desktop session" and starts Hyprland through uwsm.
- Omarchy's Hyprland desktop runs on virtio-gpu with llvmpipe at 1280x800: see `real-os-desktop.png` (Omarchy bar with
  workspaces, clock, tray; empty workspace). Hyprland needed the 600 s `wayland-wm@` timeout drop-in under TCG.

Not seen or not working:

- The gamescope session and the Bun Engine library were never displayed: no GPU on the VPS, so only the unit start and the
  gamescope failure are verified. The Bun Engine frontend HTTP server was verified separately on the host only
  (HTTP 200), not inside the image.
- `bunos-session switch` was not exercised end to end; the desktop was not interacted with.
- KVM was unavailable (`ubuntu` is not in `kvm`); everything ran under TCG and is slow.
- Known defect of the first image (fixed in the absorbed image below): the ESP was mounted on `/boot` while the loader
  entries pointed at `/bunos/vmlinuz-linux`, so a pacman kernel update would not have reached the boot entries. Still
  open: no Secure Boot.

## Absorbed image (2026-10-23): CachyOS kernel, Limine, handheld layer, gaming stack

What changed in `factory/images/bunos-disk` and the package lists is described per component in
`docs/bun-os/ABSORBED-UPSTREAM.md`; verbatim upstream files and their provenance are in `factory/upstream/`.

Verified on the VPS (`ssh vps`, work dir `~/absorb`, nothing touched in `~/src/bun-os`):

- All package lists (`bootable`, `handheld`, `gaming`) exist and resolve together with `pacman -Sup` against the live
  CachyOS (`cachyos-v3`, `cachyos-core-v3`, `cachyos-extra-v3`, `cachyos`) and Arch repositories (904 packages, no
  conflict). Names that do not exist were dropped (AUR-only `steamcmd`, `proton-ge-custom-bin`, `dxvk-bin`,
  `vkd3d-proton-bin`, `logiops`; `proton-cachyos` is `proton-cachyos-slr`).
- The rootfs image built (`bunos-disk:absorb`, 7.8 GB compressed layers, about 12 GB on disk): `linux-cachyos` 7.3.0-3 replaces
  Arch `linux`, `missing-packages.txt` is empty, the initramfs was generated for the CachyOS kernel, the listed services are enabled.
- `archinstall` 4.5 accepts `installer/archinstall-bunos.json` through its own `ArchConfig.from_config`.
- A disk assembled from that rootfs booted under QEMU/OVMF (TCG, no GPU): Limine showed the three Bun OS entries and loaded
  `vmlinuz-linux-cachyos` 7.3.0-3-cachyos from the ESP root, systemd reached the login prompt, root login on ttyS0 worked.
  On the running system: `/sys/kernel/sched_ext/state` was `enabled` with ops `lavd_1.1.4_x86_64_unknown_linux_gnu`
  (`scx_loader` started `scx_lavd`); `scx_loader`, `inputplumber` and `limine-snapper-sync` were active and `hhd@bunos`
  inactive as designed; snapper listed the `root` config and `bunos-boot-setup` created snapshot 1 ("bunos first boot");
  `limine-install` reported "Limine EFI install completed successfully".
- The upstream `gamescope-session-plus` wrapper ran through its systemd user unit with the Bun OS session definition,
  gamescope failed (no GPU, as in the first image) and the selector fell back to the desktop session after two failures.

Second pass (same day, final `Containerfile` rebuilt as `bunos-disk:absorb2`, reduced disk now with Python):

- Limine hand-over fixed. The failure was twofold: the UKI build (`omarchy-uki.conf`, now not installed) and
  `limine-snapper-sync` reading `TARGET_OS_NAME` from `/etc/default/limine` only (it defaulted to "Arch Linux").
  `TARGET_OS_NAME="Bun OS"` is now in `/etc/default/limine`, and `bunos-boot-setup` follows Omarchy's
  `omarchy-refresh-limine` sequence: `limine-install`, reset `/boot/limine.conf` to a header-only template
  (`/usr/share/bun-os/limine.conf`, `default_entry: 2` like Omarchy), `limine-update`, `limine-snapper-sync`.
- Seen in QEMU (persistent disk, two boots): first boot generated `/+Bun OS` > `//linux-cachyos` with the kernel and
  initramfs under `/boot/<machine-id>/linux-cachyos/` (b2sum-pinned in `limine.conf`) and `//Snapshots` > `///1`
  ("bunos first boot"). The second boot loaded that tool-generated entry.
- `pacman -S --noconfirm linux-cachyos` (exit 0) ran snap-pac (pre snapshot 2, post snapshot 3), Limine's
  `limine-mkinitcpio-install` hook (initramfs rebuilt, "Updated: /boot/limine.conf") and the watcher
  (`limine-snapper-watcher`: "CREATE,ISDIR -> 3", "Updated: /boot/limine.conf"); the boot menu then listed snapshots
  3, 2 and 1, each with its own `linux-cachyos` entry. Same package version, so the ESP kernel and initramfs files kept their
  hashes and were not re-copied; a version change (new hash) was not exercised.
- No failed units on that boot (`nvidia-container-toolkit` is gone).

Still not verified:

- The reduced disk leaves out Steam, Wine, `lib32`, firmware, browsers, locale and fonts and is not compressed; the full
  12 GB rootfs was not assembled or booted (tmpfs assembly pushed the shared VPS into swap). The desktop session was not
  rechecked with Python present.
- Booting a snapshot entry (rollback), a kernel version upgrade, Steam, Proton, Heroic, gamescope on a GPU, hhd or
  InputPlumber on handheld hardware, `archinstall` on a disk, KVM (still TCG).
- Omarchy's `omarchy-defaults.conf` appends `quiet splash loglevel=0` after the Bun OS flags in the generated command line,
  so the boot log is quiet on the generated entry.

## Next steps

1. Boot on a real GPU (KVM + virtio-gpu GL or a GPU host) to qualify gamescope and the Bun Engine library session, then
   Steam and a Proton title; package `bun-engine` properly instead of the bundled CLI.
2. Boot a Limine snapshot entry (rollback) and a kernel version upgrade; decide UKI and Secure Boot.
3. Assemble and boot the full-size disk on a host with enough RAM or fast disk.
4. Installer ISO (archiso with `bunos-installer-post`), published signed `[bunos]` repository, first-boot wizard, Secure Boot.
