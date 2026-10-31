# Pop!_OS and the pop-os GitHub org (as of 2026-10-30)

## What is the pop-os/pop repo's role and what does it contain?

### Takeaway
pop-os/pop is a meta/management repo ("A project for managing all Pop!_OS sources"), not the OS source itself. It holds helper scripts, a repo index (REPOS.md), licensing policy and the (large) central issue tracker for Pop!_OS.

### Cited Findings
- Description: "A project for managing all Pop!_OS sources"; binary packages live in the Pop!_OS APT repositories, source for many packages under the pop-os org. README: Pop!_OS is built on Ubuntu, first release 19 Oct 2017. — [pop-os/pop](https://github.com/pop-os/pop)
- Contents: `.github/`, `scripts/` (clone, debversion, ignore, issues, launchpad, prs, pull, readme, validate), CODE_OF_CONDUCT.md, CONTRIBUTING.md, LICENSING.md, README.md, REPOS.md, SECURITY.md. Scripts need `python3-launchpadlib`. — [pop-os/pop](https://github.com/pop-os/pop)
- Stats seen: ~1.8k open issues, 3 PRs, 2.9k stars, 109 forks, 652 commits on master (snapshot at fetch time; GitHub lists language as Rust, odd for a scripts repo). — [pop-os/pop](https://github.com/pop-os/pop), [org page](https://github.com/pop-os)
- REPOS.md indexes: distinst (installer backend) and distinst-v2 (DBus service rewrite), system76-power, launcher and cosmic-launcher, installer, firmware-manager (GTK UI/framework), system76-firmware (tool+daemon), linux-firmware (fork of Ubuntu's), linux (fork of Ubuntu kernel source). No repo literally named "pop-launcher" or "kernel"; the launcher repo is `pop-os/launcher`, the kernel is `pop-os/linux`. — [REPOS.md](https://github.com/pop-os/pop/blob/master/REPOS.md)
- Org licensing policy: default GPL-3.0-only for applications; MPL-2.0 for libraries needing to link with other licenses; MIT OR Apache-2.0 for foundational libraries; SPDX identifier in every source file. — [LICENSING.md](https://github.com/pop-os/pop/blob/master/LICENSING.md)

### Inferences
- Useful to a downstream distro as a map of which Pop components exist (REPOS.md) and their license tiers; no code to reuse directly.

### Gaps
- Exact last-commit date and issue-tracker activity level not visible from the fetch.

## What is the relationship between Pop!_OS and COSMIC Epoch, and what is Pop!_OS's current state?

### Takeaway
Pop!_OS 24.04 LTS (Ubuntu 24.04 base) shipped 11 Dec 2025 with COSMIC Epoch 1 as default desktop. COSMIC is a Rust, from-scratch, standalone desktop developed by System76/the Pop team, now also packaged in Arch, Fedora, NixOS and others.

### Cited Findings
- Pop!_OS 24.04 LTS with COSMIC Epoch 1 released 11 Dec 2025 (announced late Oct 2025); based on Ubuntu 24.04 LTS. — [Phoronix](https://www.phoronix.com/news/Pop-OS-24.04-In-December), [System76 blog](https://blog.system76.com/post/pop-os-letter-from-our-founder)
- System76 said future Pop!_OS releases (from 26.04 LTS) will follow Ubuntu LTS timing, roughly two weeks after Ubuntu. — search result summary of [Phoronix](https://www.phoronix.com/news/Pop-OS-24.04-In-December) and forum posts (secondary)
- COSMIC timeline: 2021 announced; alpha 1 on 8 Aug 2024; alphas 2-7 through 24 Apr 2025; first beta 26 Sep 2025; stable with Pop!_OS 24.04 on 11 Dec 2025. Rust, Iced toolkit, Wayland compositor, GPL-3.0-or-later. Originally a GNOME-based shell for Pop, then rebuilt from scratch. — [Wikipedia: COSMIC desktop](https://en.wikipedia.org/wiki/COSMIC_desktop)
- Point releases: 1.0.3 mid-Jan 2026, 1.0.4 days later. — [dev.to](https://dev.to/vintagetechie/the-desktop-outgrew-the-distro-487l) (blog, secondary)
- Wikipedia infobox lists stable 1.11.0 dated 20 Oct 2026; a Wikipedia citation shows Epoch 1.2.0 on 1 Jul 2026. — [Wikipedia](https://en.wikipedia.org/wiki/COSMIC_desktop) (version/date sequence looks unusual; verify against cosmic-epoch tags)
- cosmic-epoch is the meta repo (git submodules: cosmic-comp, cosmic-panel, cosmic-settings, libcosmic...), release commits tagged `epoch-X.Y.Z`; Pop!_OS uses its own build system and gets submodule updates before tagging. Install paths: Arch (`cosmic-session` package / `cosmic` group), Fedora 41+, NixOS 25.05+, openSUSE Tumbleweed, Gentoo overlay; `just sysext` for testing. 7k stars. — [cosmic-epoch](https://github.com/pop-os/cosmic-epoch), [org page](https://github.com/pop-os)
- COSMIC is in official Arch repos and a standard archinstall option as of archinstall 3.0.15. — [dev.to](https://dev.to/vintagetechie/the-desktop-outgrew-the-distro-487l) (secondary)
- COSMIC Epoch 2 is reportedly tracked on a public project board; whether the next LTS includes it is unconfirmed. — search summary of secondary sources.

### Inferences
- COSMIC is decoupled from Pop!_OS; Pop is one distribution channel for it. For Bun OS/Arch, consume COSMIC from Arch repos rather than Pop packaging.

### Gaps
- No confirmed Pop!_OS 26.04 release date or status found as of Oct 2026 (a "May" plan was an unconfirmed forum claim). Check blog.system76.com and pop-os/beta.
- Epoch 2 scope/date unconfirmed.

## Which pop-os org components are reusable/portable to Arch-based distros, and under what licenses?

### Takeaway
Most components are Rust and permissively usable (GPL-3.0/LGPL-3.0/MPL-2.0) but packaged for Debian (`debian/`, `apt build-dep`); porting means writing PKGBUILDs. Hardware-specific pieces (system76-power, system76-firmware) are most useful on System76 hardware.

### Cited Findings
- distinst: LGPL-3.0, Rust library (Rust/C/Vala APIs) for installer backends (partitioning, encryption); frontends: Rust CLI and elementary's Vala installer; build docs use apt; requires you to supply squashfs base image and `.manifest-remove`. Debian/Ubuntu-oriented, so pacman/Arch support would need work. 1,050 commits, not archived. — [distinst](https://github.com/pop-os/distinst)
- system76-power: GPL-3.0, Rust (Cargo.toml, zbus), DBus power/graphics profile daemon covering Intel/AMD/NVIDIA hybrid graphics; has `debian/` and Makefile, no Arch packaging noted; hotplug uses a GNOME extension. — [system76-power](https://github.com/pop-os/system76-power)
- launcher (pop-launcher): MPL-2.0, Rust, IPC service with JSON over stdin/stdout; plugins include calc, desktop_entries, files, find, pop_shell, pulse, recent, scripts, terminal, web; frontends: pop-shell, cosmic-launcher, onagre. Most portable component. — [launcher](https://github.com/pop-os/launcher)
- system76-firmware: GPL-3.0, CLI updater plus systemd service with D-Bus API (BIOS/EC/ME info); Debian packaging, `make vendor` for offline builds; hardware scope presumably System76 machines (page does not state). — [system76-firmware](https://github.com/pop-os/system76-firmware)
- firmware-manager (GTK UI/framework) and linux-firmware fork listed in REPOS.md; licenses not verified. — [REPOS.md](https://github.com/pop-os/pop/blob/master/REPOS.md)
- Kernel: `pop-os/linux` is a fork of Ubuntu's kernel source (branch master_noble seen), license "See COPYING" (GPL-2.0 Linux); contains debian/ dirs and System76 helper scripts; specific Pop patches not documented on the page. — [pop-os/linux](https://github.com/pop-os/linux)
- upgrade (pop-upgrade): GPL-3.0 Rust, upgrades Pop!_OS and recovery partition, Ubuntu/apt-specific; system-updater: MPL-2.0 (systemd services for update checking). cosmic-settings, cosmic-greeter, cosmic-edit, cosmic-monitor, cosmic-initial-setup: GPL-3.0; libcosmic, cosmic-text (pure Rust text handling) are libraries (license not shown on the page; policy suggests MPL-2.0 or MIT/Apache). iso repo (Makefile ISO production, Debian-based). — [org page](https://github.com/pop-os)
- Package management is apt/dpkg (Ubuntu base, `apt build-dep`, `debian/` dirs); Arch has COSMIC packaged natively. — [cosmic-epoch](https://github.com/pop-os/cosmic-epoch), [distinst](https://github.com/pop-os/distinst)

### Inferences
- Best reuse candidates for an Arch/pacman distro: pop-launcher (MPL-2.0), libcosmic/cosmic-text (libraries), COSMIC components (already in Arch). Distinst would need a libalpm/pacstrap backend (it assumes squashfs image + apt); system76-power only relevant for hybrid-graphics laptops (Arch already has `system76-power` in AUR/community as I recall, unverified); upgrade/pop-upgrade/iso are not portable. Kernel patches: not worth lifting without diffing against Ubuntu.
- GPL-3.0 components are compatible as separate programs; LGPL-3.0 distinst can be linked; MPL-2.0 is file-level copyleft.

### Gaps
- Licenses of libcosmic, cosmic-epoch, cosmic-text, firmware-manager, iso, installer not shown by the fetches (verify LICENSE files).
- Arch/AUR package existence for system76-power, distinst, pop-launcher not verified.
- Actual Pop kernel patches vs Ubuntu not determined.
- Last-commit dates/release tags for these repos not visible.
