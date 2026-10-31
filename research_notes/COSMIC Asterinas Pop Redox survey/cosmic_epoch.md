# COSMIC Epoch (pop-os/cosmic-epoch) and the COSMIC desktop

Research date: 2026-10-30. Note: WebFetch summarizes pages with a small model, so exact figures (versions, rust-version) should be re-verified against the raw files before being pinned in Bun OS manifests.

## What is the repo layout and how is the full desktop built and packaged?

### Takeaway
cosmic-epoch is a meta-repository: a pure aggregation of about 31 git submodules (one per COSMIC component) plus a root `justfile` that builds and installs them all, with a `just sysext` route for testing. There is no single Cargo workspace; each component is built through its own justfile or Makefile. Distros are expected to package per component, using the per-repo `debian/` folders and the root `justfile` as references, with no backwards-compatibility guarantees.

### Cited Findings
- cosmic-epoch is the meta-repo that bundles COSMIC components as git submodules; clone with `git clone --recurse-submodules https://github.com/pop-os/cosmic-epoch`, then `just sysext` — [README](https://github.com/pop-os/cosmic-epoch)
- `.gitmodules` lists 31 submodules: cosmic-session, cosmic-comp, cosmic-panel, cosmic-applets, cosmic-app-library (URL cosmic-applibrary), cosmic-launcher, simple-wrapper, cosmic-settings, cosmic-settings-daemon, xdg-desktop-portal-cosmic, cosmic-osd, cosmic-bg, cosmic-workspaces-epoch, cosmic-notifications, cosmic-icons, cosmic-greeter, cosmic-screenshot, cosmic-edit, cosmic-term, cosmic-randr, cosmic-files, cosmic-store, cosmic-wallpapers, cosmic-idle, cosmic-player, cosmic-initial-setup, pop-launcher (URL pop-os/launcher), cosmic-monitor, cosmic-sound-theme, cosmic-osk, cosmic-viewer — [.gitmodules](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/.gitmodules)
- The README groups libraries/crates (cosmic-protocols, cosmic-text, cosmic-theme, cosmic-time) and the toolkit libcosmic as part of the ecosystem; these are not necessarily root submodules and are pulled as git or crates.io deps by the apps — [README](https://github.com/pop-os/cosmic-epoch) (README list vs .gitmodules differ; see Gaps)
- Justfile targets: `build` (builds ~30 components via their sub-justfiles or Makefiles; cosmic-wallpapers and cosmic-workspaces-epoch use `make`; xdg-desktop-portal-cosmic built with `debug=0`), `install rootdir="" prefix="/usr/local"`, `sysext dir version`, `clean`; loads `.env` via `set dotenv-load` — [justfile](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/justfile)
- Sysext writes to `<dir>/usr` plus `usr/lib/extension-release.d/extension-release.cosmic-sysext` (NAME="Cosmic DE"); the README says the sysext links against host libraries, is not portable across distros and is not for long-term deployment — [justfile](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/justfile), [README](https://github.com/pop-os/cosmic-epoch)
- Packaging guidance: "COSMIC DE is packaged for Pop!_OS"; look at the `debian` folders in each project and the root `justfile` as references, with no backwards-compatibility guarantees at this stage — [README raw](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/README.md)
- Per-component build uses `just` (sub-justfiles accept `rootdir`/`prefix`-style vars); root build needs `just`, `make`, `git`; README says install `just` via cargo as distro versions may be old — [justfile](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/justfile), [README](https://github.com/pop-os/cosmic-epoch)
- Build deps listed in README (apt names): build tools, git + git-lfs, dbus, libdisplay-info, libglvnd, GStreamer dev, libinput, PAM, pixman, libseat, OpenSSL, Wayland, xkbcommon, dav1d, nasm, rustup, udev. Optional: libclang, expat, fontconfig, freetype, libgbm, PipeWire, PulseAudio, systemd, lld, mold — [README](https://github.com/pop-os/cosmic-epoch)

### Inferences
- A Bun OS COSMIC composition should mirror Arch's per-component split (one package per submodule) rather than a monolithic build; the root justfile is a reference for install ordering and paths, not a stable interface.
- `prefix=/usr` and `rootdir=$pkgdir` are the natural PKGBUILD mapping of the justfile's `install` target.

### Gaps
- Whether `libcosmic`, `cosmic-text`, `cosmic-theme`, `cosmic-time`, `cosmic-protocols` are submodules or only README-listed: `.gitmodules` as fetched did not list them (31 entries, none of those; but includes `cosmic-edit` and `simple-wrapper`, which the README list shows differently). Re-check with `git submodule status`.
- Exact `just` dependency (versions) and the `vendor` workflow (cargo vendor offline builds) not verified.

## What are the key components, languages, licenses, and release cadence?

### Takeaway
All components are Rust (edition 2024 where checked), built on libcosmic (an iced-based toolkit, MPL-2.0) with the compositor cosmic-comp on Smithay. Most apps/daemons are GPL-3.0-only; libcosmic is MPL-2.0; cosmic-protocols is MIT. Epoch 1 went stable in December 2025 with Pop!_OS 24.04 LTS; as of October 2026 the Epoch 1.x line is at 1.11.0 (20 Oct), with roughly 2-3 week minor releases.

### Cited Findings
- Epoch 1 stable shipped with Pop!_OS 24.04 LTS in December 2025 (System76 planned 11 Dec 2025); described as a from-scratch Rust desktop and a reset of the earlier GNOME-based COSMIC numbering — [Phoronix](https://www.phoronix.com/news/Pop-OS-24.04-In-December), [The Register](https://www.theregister.com/2025/12/22/popos_2404_cosmic_epoch_1/), [FOSS Force](https://fossforce.com/2025/12/pop_os-24-04-lts-launches-with-scratch-built-cosmic-epoch-1/), [System76 blog](https://system76.com/blog/post/pop-os-letter-from-our-founder)
- Pop!_OS 24.04 shipped with Linux 6.17.9; future Pop!_OS releases (from 26.04) align with Ubuntu LTS timing — [The Register](https://www.theregister.com/2025/12/22/popos_2404_cosmic_epoch_1/), [System76 blog](https://system76.com/blog/post/pop-os-letter-from-our-founder) (second-hand summary via search tool)
- Releases (dates have no year on the page; the month/day sequence is consistent with 2026): 1.6.0 (18 Aug; EI protocol, wl-dmabuf-v6), 1.7.0 (25 Aug; remote desktop portal, shake-to-magnify cursor), 1.8.0 (10 Sep; touchscreen, configurable SSD), 1.9.0 (23 Sep; adds COSMIC Viewer and COSMIC OSK, new Store), 1.10.0 (08 Oct; tablet-to-display mapping, WGPU launcher), 1.11.0 (20 Oct, marked Latest; Escape handling, xdg-dialog-v1, touchpad tap/drag) — [cosmic-epoch releases](https://github.com/pop-os/cosmic-epoch/releases)
- Tag scheme: `epoch-X.Y.Z`, pre-releases `-alpha.Y.Z`/`-beta.Y.Z`; tags are mainly for non-Pop!_OS distros because Pop!_OS updates submodules before tagging — [README](https://github.com/pop-os/cosmic-epoch)
- cosmic-session: version 1.11.0, GPL-3.0-only, edition 2024, rust-version 1.93 — [Cargo.toml](https://raw.githubusercontent.com/pop-os/cosmic-session/master/Cargo.toml)
- cosmic-comp: GPL-3.0-only, edition 2024, rust-version 1.95 (the manifest still shows package version 1.0.0), smithay 0.7.0 with a `[patch.crates-io]` git rev, xwayland feature, cosmic-protocols from git (server feature) — [Cargo.toml](https://raw.githubusercontent.com/pop-os/cosmic-comp/master/Cargo.toml)
- cosmic-settings: workspace rust-version 1.93, resolver 3; license not stated in the workspace root manifest — [Cargo.toml](https://raw.githubusercontent.com/pop-os/cosmic-settings/master/Cargo.toml)
- cosmic-protocols: MIT, edition 2024, version 0.2.0, workspace member client-toolkit — [Cargo.toml](https://raw.githubusercontent.com/pop-os/cosmic-protocols/main/Cargo.toml)
- libcosmic: MPL-2.0; "GUI platform toolkit" based on iced, with iced vendored as a submodule from `pop-os/iced` (pinned to commit 229186b per the fetch); features: `wayland` (conflicts with `winit`), `winit` (X11/cross-platform), `wgpu`, `tokio`/`smol`, `a11y` (experimental), `xdg-portal`, `animated-image`, `debug` — [libcosmic](https://github.com/pop-os/libcosmic)
- Component roles (from submodule names and release notes): cosmic-comp (Wayland compositor on Smithay), cosmic-panel/cosmic-applets, cosmic-launcher + pop-launcher, cosmic-app-library, cosmic-workspaces-epoch, cosmic-settings + cosmic-settings-daemon, cosmic-greeter (login/lock screen), cosmic-session, cosmic-notifications, cosmic-osd, cosmic-bg, cosmic-idle, cosmic-randr, xdg-desktop-portal-cosmic, apps (files, edit, term, store, player, viewer, screenshot, monitor, osk, initial-setup) — [.gitmodules](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/.gitmodules), [releases](https://github.com/pop-os/cosmic-epoch/releases)

### Inferences
- Licensing is mixed: GPL-3.0-only for most binaries (cosmic-comp, cosmic-session confirmed), MPL-2.0 for libcosmic, MIT for protocol crates. Per-repo LICENSE files must be checked for the rest (icons, wallpapers, sound theme, text, pop-launcher likely differ); do not assume uniform GPL.
- MSRV is high and moves quickly (1.93 to 1.95 across components); only the stable channel is evidenced, no nightly requirement was seen in the Cargo manifests checked. This contrasts with Bun OS's nightly Rust contract, so a separate stable toolchain (or a nightly new enough to satisfy 1.95) is needed for COSMIC builds.
- Cadence is roughly every 1-3 weeks in Aug-Oct (intervals 7, 16, 13, 15, 12 days).

### Gaps
- Per-component license for cosmic-panel, applets, greeter, files, edit, term, store, icons, wallpapers, text, theme: not individually verified.
- Release years are not shown on the releases page; 2026 is an inference. Epoch 1.0 through 1.5 history not retrieved.
- Whether an "Epoch 2" is announced: only a low-reliability source (lavx.hu) speculated; not relied on.
- Exact rust-version for each crate and any `rust-toolchain.toml`: only checked for comp, session, settings.

## What are the integration considerations for an Arch-based (pacman) distro that wants a COSMIC Desktop composition?

### Takeaway
COSMIC is already in the official Arch `extra` repo as a `cosmic` package group at 1.10.0 (cosmic-session pulls the rest), so a pacman-based Bun OS can consume it by installing prebuilt packages rather than building cosmic-epoch. Login is via cosmic-greeter and a Wayland session; X11 apps run through Xwayland in cosmic-comp.

### Cited Findings
- Arch's `cosmic` group (x86_64) lists 29 entries, all 1:1.10.0-1 (or 1.10.0-1 / 2:1.10.0-1 for wallpapers/workspaces): cosmic-app-library, applets, bg, comp, files, greeter, idle, initial-setup, launcher, monitor, notifications, osd, osk, panel, player, randr, screenshot, session, settings, settings-daemon, sound-theme (any), store, terminal, text-editor, viewer, wallpapers (any), workspaces, xdg-desktop-portal-cosmic — [Arch group](https://archlinux.org/groups/x86_64/cosmic/). Arch lagged the upstream 1.11.0 release (20 Oct) at fetch time. A separate search snippet showed 1.0.16 on the same group page, which conflicts; the direct fetch (1.10.0) is the more specific and recent, but this is unresolved — [search result](https://archlinux.org/groups/x86_64/cosmic/)
- Arch names differ from upstream repos: cosmic-app-library, cosmic-terminal (cosmic-term), cosmic-text-editor (cosmic-edit), cosmic-workspaces (cosmic-workspaces-epoch); cosmic-store was in Extra-Staging at 1.10.0-2 at fetch time — [Arch group](https://archlinux.org/groups/x86_64/cosmic/)
- Install on Arch: `pacman -S cosmic-session` or `pacman -S cosmic`, then pick COSMIC from the session selector at login — [README raw](https://raw.githubusercontent.com/pop-os/cosmic-epoch/master/README.md)
- ArchWiki says COSMIC is installable via cosmic-session or the cosmic group, and cosmic-greeter.service must be enabled to start from a login screen; cosmic-session has optional deps cosmic-player, cosmic-store, cosmic-terminal, cosmic-text-editor, cosmic-wallpapers — via search summary of [ArchWiki Cosmic](https://wiki.archlinux.org/title/Cosmic) (page fetch blocked by Anubis; not read directly)
- CachyOS mirrors COSMIC in its repo (cosmic-session 1:1.0.15-1 listed in a search snippet, an older version) — [CachyOS packages](https://packages.cachyos.org/package/extra/x86_64/cosmic-session). AUR has `cosmic-session-git` which provides/conflicts with the repo package and uses the `cosmic` group — [AUR](https://aur.archlinux.org/pkgbase/cosmic-session-git)
- cosmic-comp has Smithay `xwayland` feature enabled (X11 apps via Xwayland); the session is Wayland-only; libcosmic `winit` feature covers X11 for third-party apps — [cosmic-comp Cargo.toml](https://raw.githubusercontent.com/pop-os/cosmic-comp/master/Cargo.toml), [libcosmic](https://github.com/pop-os/libcosmic)
- Other distros document COSMIC too: Pop!_OS 24.04, Fedora 41+, NixOS (modules since 25.05), openSUSE Tumbleweed, Gentoo overlay — [README](https://github.com/pop-os/cosmic-epoch)

### Inferences
- For Bun OS (CachyOS/ChimeraOS/Omarchy integration, pacman/libalpm primary): the COSMIC Desktop composition should be a package list (`cosmic` group or `cosmic-session` + greeter + chosen apps) from Arch `extra` / CachyOS repos, kept separate from Server and Gamescope compositions as per AGENTS.md. Only vendor cosmic-epoch as a pinned external owner if custom builds or patches are needed; if so, track `epoch-X.Y.Z` tags and build per-component with `prefix=/usr`.
- Runtime stack to include: a Wayland session (cosmic-comp, Xwayland), xdg-desktop-portal-cosmic, PipeWire/PulseAudio, NetworkManager/Bluetooth via applets (inferred from applets), logind/seat (libseat), PAM (greeter), dbus. Specific Arch dependency lists were not retrieved.
- Since Arch pins 1.10.0 while upstream is 1.11.0, a custom repo would be needed only for bleeding-edge; also consider building with a stable Rust >= 1.95 on the VPS (not the repo nightly).
- Gaming composition conflict risk: Gamescope is a separate Wayland compositor; COSMIC and Gamescope sessions should be separate session entries rather than layered (inference, not sourced).

### Gaps
- ArchWiki page and the Arch PKGBUILD sources (dependencies, makedepends, rust version used) could not be read (Anubis block / not fetched). Check `https://gitlab.archlinux.org/archlinux/packaging/packages/cosmic-session` for PKGBUILDs.
- Known issues (NVIDIA, Secure Boot installs on Pop!_OS, etc.) were not researched beyond a Register note on EFI partition size.
- Explicit Wayland-only statement for the session was not found; it is inferred from the compositor architecture.
- Version conflict: Arch group page showed 1.10.0 on direct fetch but a search snippet cited 1:1.0.16-1 and ArchLinux ARM 1:1.0.16-1; the latter may be stale or from a differently-versioned scheme. Verify with `pacman -Si`.
