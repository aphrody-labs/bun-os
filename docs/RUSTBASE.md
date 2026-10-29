# Bun OS Rust userland (rustbase)

Bun OS is a WASM OS with an Arch Linux variant (Omarchy + CachyOS ideas, upstream kernel). Its userland is replaced by
Rust tools. This document and `factory/rustbase/` define which tool, how it is chosen, how it replaces the legacy one,
and what is not verified yet.

Everything numeric below is generated: `factory/rustbase/rank.ts` reads `domains.json` (hand-listed candidates, the only
non-data input), queries GitHub, archlinux.org and the AUR RPC, and writes `catalog.json`. Ranks are data, not opinion.

## Layout

| Path | Role |
|---|---|
| `factory/rustbase/domains.json` | domains and candidate repositories (input) |
| `factory/rustbase/rank.ts` | computes `catalog.json`: stars, commits in 90 days, latest stable tag + full SHA + date, license, Arch/AUR/CachyOS/Omarchy status, test hints, score, rank |
| `factory/rustbase/catalog.json` | the result, with `observedAt` |
| `factory/rustbase/gen.ts` | `pins.json` (tags, SHAs, fork head, GNU versions) and every file under `pkg/` |
| `factory/rustbase/check.ts` | offline consistency check (`--patches` applies patches on shallow clones of the pinned tags) |
| `factory/rustbase/render-docs.ts` | regenerates the marked regions of this file |
| `factory/rustbase/pkg/` | PKGBUILDs: `bunos-rust-base`, `bunos-uutils-multicall`, `bunos-sudo-rs`, `bunos-nushell-default` |
| `factory/rustbase/patches/` | `git format-patch` series per tool, only when verified (see its README) |
| `factory/rustbase/smoke.sh` | post-install smoke test of the replaced tools |
| `.github/workflows/rustbase.yml` | check, Arch container build with makepkg and namcap, smoke test, GNU conformance |

Refresh: `bun factory/rustbase/rank.ts && bun factory/rustbase/gen.ts --refresh && bun factory/rustbase/render-docs.ts`.

## Scoring (computed by script)

Per candidate, maximum 88: stars (25, log scale to 100k), commits in the last 90 days (15, capped at 50), latest stable
release or tag dated in the current year (20; 10 and 4 for one and two years back), a GitHub-detected SPDX license (5),
Arch availability (15 official repo, 10 CachyOS-PKGBUILDS recipe, 5 AUR), Omarchy default package list (3), tests or CI
workflows at the repository root (5). A candidate is credible when it is not archived, is Rust-primary (unless the domain
allows otherwise), has at least 300 stars, was pushed within 400 days and scores at least 45. The pick is the best
credible candidate; a domain without one is a gap. Two kinds of owner directive override the data and are marked
`directive` with the data rank recorded: Bun as the JavaScript runtime, and the uutils util-linux/diffutils replacements.
The `find` domain (interactive tool, fd) is separate from `findutils` (POSIX replacement, uutils findutils); the same
split applies to `grep` (ripgrep) and `structural-search` (ast-grep).

## Decision table

<!-- rustbase:table:start -->
| Domain | Replaces | Pick | Status | Stars | Release (date) | License | Arch | Score | Runners-up (score) |
|---|---|---|---|---|---|---|---|---|---|
| shell | bash | nushell/nushell | pick | 40.8k | 0.116.1 (2026-10-04) | MIT | extra/nushell 0.116.1-1 | 83.05 | fish-shell (77.68), brush (76.78), ion (26.4) |
| coreutils | GNU coreutils | uutils/coreutils | pick | 24.3k | 0.12.0 (2026-09-17) | MIT | extra/uutils-coreutils 0.12.0-1 | 81.93 | - |
| util-linux | util-linux | uutils/util-linux | directive | 226 | 0.0.1 (2024-02-17) | MIT | aur/uutils-util-linux 0.0.1-1 | 45.78 | - |
| findutils | GNU findutils | uutils/findutils | pick | 653 | 0.10.0 (2026-08-03) | MIT | aur/uutils-findutils 0.10.0-4 | 64.08 | - |
| diffutils | GNU diffutils | uutils/diffutils | directive | 280 | v0.6.0 (2026-10-23) | Apache-2.0 | aur/uutils-diffutils 0.6.0-1 | 58.94 | - |
| privilege | sudo | trifectatechfoundation/sudo-rs | pick | 4.5k | v0.2.15 (2026-08-31) | Apache-2.0 | extra/sudo-rs 0.2.15-1 | 74.36 | please (28.6) |
| ls | ls | eza-community/eza | pick | 23.7k | v0.23.5 (2026-07-09) | EUPL-1.2 | extra/eza 0.23.5-2 | 69.87 | lsd (56.66) |
| find | find | sharkdp/fd | pick | 44.9k | v10.5.0 (2026-08-26) | Apache-2.0 | extra/fd 10.5.0-3 | 86.26 | findutils (64.08) |
| grep | grep | BurntSushi/ripgrep | pick | 69.5k | 15.2.0 (2026-07-15) | Unlicense | extra/ripgrep 15.2.0-1 | 78.51 | - |
| cat | cat | sharkdp/bat | pick | 61.0k | v0.26.1 (2025-12-02) | Apache-2.0 | extra/bat 0.26.1-3 | 76.93 | - |
| cd | cd | ajeetdsouza/zoxide | pick | 40.3k | v0.10.0 (2026-07-04) | MIT | extra/zoxide 0.10.0-1 | 80.93 | - |
| prompt | PS1 | starship/starship | pick | 60.5k | v1.27.0 (2026-10-17) | ISC | extra/starship 1.27.0-1 | 86.91 | - |
| editor | vi/nano | microsoft/edit | pick | 14.7k | v2.0.0 (2026-04-28) | MIT | extra/msedit 2.0.0-1 | 80.24 | zed (79.83), lapce (73.05), helix (59.85) |
| multiplexer | tmux/screen | zellij-org/zellij | pick | 35.9k | v0.45.1 (2026-08-28) | MIT | extra/zellij 0.45.1-1 | 82.77 | - |
| file-manager | ranger/mc | sxyazi/yazi | pick | 43.1k | v26.9.1 (2026-09-01) | MIT | extra/yazi 26.9.1-2 | 83.17 | broot (80.59), xplr (78.43), joshuto (50.36) |
| disk-usage | du/ncdu | bootandy/dust | pick | 12.6k | v1.2.6 (2026-09-16) | Apache-2.0 | extra/dust 1.2.6-1 | 80.5 | dua-cli (79.03), diskus (50.52) |
| process-viewer | top/htop | ClementTsang/bottom | pick | 14.1k | 0.14.9 (2026-08-27) | MIT | extra/bottom 0.14.9-1 | 80.75 | procs (78.97), zenith (64.83) |
| diff | diff pager | Wilfred/difftastic | pick | 26.1k | 0.71.0 (2026-09-18) | MIT | extra/difftastic 0.71.0-1 | 82.08 | delta (72.97) |
| benchmark | time loops | sharkdp/hyperfine | pick | 29.2k | v2.0.0 (2026-10-07) | Apache-2.0 | extra/hyperfine 2.0.0-1 | 82.33 | - |
| archiver | tar/unzip | ouch-org/ouch | pick | 3.8k | 0.8.3 (2026-09-13) | ? | extra/ouch 0.8.3-1 | 65.7 | ripunzip (32.35) |
| http-client | curl/httpie | ducaale/xh | pick | 8.2k | v0.26.3 (2026-10-21) | MIT | extra/xh 0.26.3-1 | 67.56 | - |
| substitute | sed s/// | chmln/sd | pick | 7.4k | v1.1.0 (2026-02-25) | MIT | extra/sd 1.1.0-1 | 64.35 | - |
| fields | cut/awk print | theryangeary/choose | pick | 2.3k | v1.3.7 (2025-08-26) | GPL-3.0 | extra/choose 1.3.7-2 | 51.8 | - |
| json | jq | 01mf02/jaq | pick | 3.8k | v3.1.2 (2026-10-21) | MIT | extra/jaq 3.1.2-1 | 77.91 | jql (57.74) |
| git-impl | git | GitoxideLabs/gitoxide | pick | 12.1k | none | Apache-2.0 | extra/gitoxide 0.56.0-1 | 60.41 | - |
| vcs | git workflow | jj-vcs/jj | pick | 32.3k | v0.46.0 (2026-10-07) | Apache-2.0 | extra/jujutsu 0.46.0-1 | 82.55 | - |
| git-tui | tig | gitui-org/gitui | pick | 22.6k | v0.28.1 (2026-03-24) | MIT | extra/gitui 0.28.1-2 | 68.27 | - |
| aur-helper | yay/makepkg wrapper | Morganamilo/paru | pick | 9.1k | v2.2.0 (2026-10-29) | GPL-3.0 | cachyos:paru | 72.38 | aura (56.42), rua (32.3) |
| ntp | chrony/ntpd | pendulum-project/ntpd-rs | pick | 1.2k | v1.9.0 (2026-06-12) | ? | extra/ntpd-rs 1.9.0-1 | 70.31 | - |
| bandwidth | nethogs | imsnif/bandwhich | pick | 12.0k | v0.23.1 (2024-10-08) | MIT | extra/bandwhich 0.23.1-3 | 49.4 | - |
| traceroute | traceroute/mtr | orf/gping | pick | 12.7k | gping-v1.21.0 (2026-08-31) | MIT | extra/gping 1.21.0-1 | 71.52 | trippy (61.45) |
| tls | OpenSSL TLS | rustls/rustls | pick | 7.7k | v/0.23.46 (2026-10-14) | ? | none | 59.44 | - |
| dns | bind/dig | hickory-dns/hickory-dns | pick | 5.5k | v0.26.3 (2026-09-10) | ? | aur/hickory-dns 0.26.3-1 | 63.69 | dog (39.13) |
| ssh | OpenSSH | Eugeny/russh | pick | 1.9k | v0.65.0 (2026-10-25) | Apache-2.0 | none | 61.41 | ssh2-rs (48.89) |
| compositor | Mutter/Sway/Hyprland | niri-wm/niri | pick | 28.7k | v26.04 (2026-04-25) | GPL-3.0 | extra/niri 26.04-1 | 82.29 | cosmic-comp (74.61), smithay (52.63), pinnacle (49.05) |
| terminal | xterm/kitty | raphamorim/rio | pick | 7.7k | v0.5.28 (2026-09-17) | MIT | extra/rio 0.5.28-1 | 79.42 | alacritty (71.2), wezterm (61.34), cosmic-term (54.1) |
| status-bar | waybar | JakeStanger/ironbar | pick | 1.5k | v0.19.1 (2026-09-20) | MIT | extra/ironbar 0.19.1-1 | 75.88 | i3status-rust (75.7), eww (39.52) |
| launcher | rofi/wofi | abenz1267/walker | pick | 3.1k | v2.17.2 (2026-10-08) | GPL-3.0 | aur/walker 2.17.2-1 | 54.26 | anyrun (51.8) |
| clipboard | wl-clipboard | YaLTeR/wl-clipboard-rs | pick | 525 | v0.9.5 (2026-10-26) | Apache-2.0 | aur/wl-clipboard-rs 0.9.3-1 | 53.1 | - |
| image-viewer | feh/eog | woelper/oculante | pick | 1.7k | 0.9.6 (2026-10-05) | MIT | extra/oculante 0.9.6-1 | 71.36 | viu (52.6), emulsion (48.23) |
| oci-runtime | runc/crun | youki-dev/youki | pick | 7.7k | v0.7.0 (2026-07-25) | Apache-2.0 | aur/youki 0.7.0-2 | 69.42 | - |
| microvm | QEMU (microvm) | firecracker-microvm/firecracker | pick | 37.7k | v1.17.0 (2026-09-10) | Apache-2.0 | extra/firecracker 1.17.0-1 | 82.88 | cloud-hypervisor (64.04) |
| wasm-runtime | WAMR/wasm3 | wasmerio/wasmer | pick | 21.2k | v7.5.0 (2026-10-01) | MIT | extra/wasmer 7.5.0-1 | 81.63 | wasmtime (81.37), wasmi (52.54) |
| kernel-rust | C drivers | Rust-for-Linux/linux | pick | 4.4k | v7.3 (2026-10-18) | ? | none | 53.23 | linux (52.41) |
| js-runtime | node | oven-sh/bun | directive (data rank 1: denoland/deno) | 96.5k | bun-v1.4.4 (2026-10-22) | ? | extra/bun 1.4.4-1 | 79.92 | deno (85) |
| python-tooling | pip/venv | astral-sh/uv | pick | 91.3k | 0.13.6 (2026-10-27) | Apache-2.0 | extra/uv 0.13.6-1 | 84.8 | - |
| python-lint | flake8/black | astral-sh/ruff | pick | 50.3k | 0.17.3 (2026-10-27) | MIT | extra/ruff 0.17.3-1 | 83.51 | - |
| fuzzy-finder | fzf | skim-rs/skim | pick | 7.0k | v5.9.0 (2026-10-27) | MIT | extra/skim 5.9.0-1 | 79.23 | television (75.43) |
| task-runner | make (tasks) | casey/just | pick | 36.5k | 1.59.0 (2026-10-15) | CC0-1.0 | extra/just 1.59.0-1 | 78.01 | - |
| watcher | entr | watchexec/watchexec | pick | 7.3k | v2.8.0 (2026-10-06) | Apache-2.0 | extra/watchexec 2.8.0-1 | 79.3 | - |
| code-stats | cloc | XAMPPRocky/tokei | pick | 15.0k | v15.0.0 (2026-09-06) | ? | extra/tokei 15.0.0-1 | 62.08 | - |
| hexdump | xxd/hexdump | sharkdp/hexyl | pick | 10.3k | v0.17.0 (2026-02-14) | Apache-2.0 | extra/hexyl 0.17.0-2 | 65.06 | - |
| help | man (examples) | tealdeer-rs/tealdeer | pick | 6.6k | v1.9.1 (2026-10-24) | Apache-2.0 | extra/tealdeer 1.9.1-1 | 72.51 | - |
| backup | restic/borg | rustic-rs/rustic | pick | 3.3k | v0.11.4 (2026-08-18) | Apache-2.0 | extra/rustic 0.11.4-1 | 65.93 | - |
| encryption | gpg (files) | str4d/rage | pick | 3.7k | v0.12.1 (2026-07-14) | Apache-2.0 | extra/rage-encryption 0.12.1-1 | 62.84 | - |
| reverse-proxy | nginx | sozu-proxy/sozu | pick | 3.8k | 2.3.3 (2026-10-19) | AGPL-3.0 | aur/sozu 2.3.3-1 | 67.87 | pingora (67.21), static-web-server (59.69), river (45.86) |
| sql-database | SQLite | tursodatabase/turso | pick | 25.1k | v0.8.3 (2026-10-12) | MIT | aur/turso 0.8.2-1 | 72 | - |
| bootloader | systemd-boot/GRUB | rust-osdev/bootloader | pick | 1.7k | v0.11.17 (2026-07-27) | Apache-2.0 | none | 47.96 | sprout (57.39) |
| network-manager | NetworkManager | nmstate/nmstate | pick | 399 | v2.2.62 (2026-08-25) | Apache-2.0 | extra/nmstate 2.2.62-1 | 73.01 | - |
| structural-search | grep (code) | ast-grep/ast-grep | pick | 16.4k | 0.51.0 (2026-10-15) | MIT | extra/ast-grep 0.44.1-1 | 81.07 | - |
| api-client | Postman | Julien-cpsn/ATAC | pick | 3.7k | v0.24.0 (2026-10-11) | MIT | extra/atac 0.24.0-1 | 70.07 | - |
| git-summary | git-summary | o2sh/onefetch | pick | 12.1k | 3.1.0 (2026-10-18) | MIT | extra/onefetch 3.1.0-1 | 80.41 | - |
| openpgp | GnuPG (library) | rpgp/rpgp | pick | 1.1k | v0.21.0 (2026-10-03) | Apache-2.0 | extra/rpgp 0.12.1-1 | 62.89 | - |
<!-- rustbase:table:end -->

## Gaps: no credible Rust number one

<!-- rustbase:gaps:start -->
- **procps** (ps/top/free/uptime, replaces procps-ng): best available uutils/procps (117 stars, score 39.36); not credible: stars 117 < 300; score 39.36 < 45.
- **sed** (Stream editor, replaces GNU sed): best available uutils/sed (110 stars, score 60.23); not credible: stars 110 < 300.
- **init** (Init / service manager, replaces systemd): best available threefoldtech/zinit (17 stars, score 26.28); not credible: stars 17 < 300; score 26.28 < 45.
- **greeter** (Login greeter, replaces GDM/SDDM): best available pop-os/cosmic-greeter (141 stars, score 66.86); not credible: stars 141 < 300.
- **sysinfo** (System information, replaces neofetch): best available Macchina-CLI/macchina (2.0k stars, score 45.5); not credible: last push 600 days ago.
- **pager** (Pager, replaces less): best available AMythicDev/minus (375 stars, score 44.68); not credible: score 44.68 < 45.
- **package-manager** (System package manager, replaces pacman): best available archlinux/alpm.rs (175 stars, score 25.23); not credible: stars 175 < 300; score 25.23 < 45.
- **firewall** (Packet filter front-end, replaces nftables): best available mullvad/nftnl-rs (111 stars, score 43.85); not credible: stars 111 < 300; score 43.85 < 45.
<!-- rustbase:gaps:end -->

Not covered by any candidate (no Rust implementation worth ranking, so kept as upstream C/other and not in the catalog):
the kernel itself (Rust-in-kernel is tracked in `kernel-rust` only as drivers), glibc, GCC/LLVM, pacman/libalpm,
systemd (the `init` candidates are far below the thresholds), NetworkManager/iwd, PipeWire, Mesa, curl/libcurl, OpenSSH
(russh is a library, not an sshd distribution), rsync, GnuPG (rpgp is a library; Sequoia lives on GitLab and is not
scored), tar/gzip/xz utilities.

## How each pick replaces the legacy tool

- **uutils coreutils** (`bunos-uutils-multicall`): one `/usr/bin/coreutils` binary built with `make MULTICALL=y`,
  with a symlink per applet (`LN='ln -sf'`) in `/usr/bin`. The package `provides=(coreutils=<Arch core version>)` and
  `conflicts=(coreutils)` so `base` stays installable. The applets `kill`, `more` (owned by util-linux) and `uptime`
  (procps-ng) are removed from the package because pacman reported file conflicts with those packages in CI. Locales and man pages come from the uutils Makefile.
- **uutils findutils**: `/usr/bin/{find,xargs,locate,updatedb}`, `provides=(findutils)`.
- **uutils diffutils**: one `diffutils` binary dispatching on the argv[0] suffix; `diff` and `cmp` are symlinks.
  `diff3` and `sdiff` do not exist upstream, so `provides=(diffutils)` is a known partial replacement.
- **uutils util-linux** (our fork `aphrody-labs/uutils-util-linux`, pinned by commit): Arch `util-linux` and
  `util-linux-libs` own `mount`, libmount, libblkid and are required by systemd, so the package cannot conflict with them.
  The fork's applets (blockdev, cal, dmesg, hexdump, last, lscpu, mountpoint, rev, uuidgen, ... the `feat_common_core`
  list) are staged in `/usr/lib/bunos/rust/bin` and activated per user decision with
  `bunos-rust-alternatives enable util-linux`, which links them into `/usr/local/bin` (ahead of `/usr/bin` in PATH).
  Nothing owned by another package is modified. `mount`, `hostname`, `ln`, `uname` that systemd and WSL init need stay
  GNU or uutils-coreutils as appropriate (the WSL owner asks to keep the swap unverified until `wsl-rootfs.yml` builds it).
- **sudo-rs** (`bunos-sudo-rs`): `/usr/bin/sudo` and `/usr/bin/visudo` setuid root (4755), `su` installed as `su-rs`
  (util-linux keeps `su`), `/etc/sudoers`, `/etc/pam.d/sudo` and `sudo-i` including `system-auth` as Arch's sudo does,
  built without the `pam-login` feature (that feature is for distributions whose sudo uses the `sudo-i` service).
  `provides=(sudo)`, `conflicts=(sudo sudo-rs)`.
- **nushell** (`bunos-nushell-default`): nushell itself comes from Arch extra; the package ships `/etc/skel` env and
  config (PATH with `~/.bun/bin`, `BUN_INSTALL`), adds `/usr/bin/nu` to `/etc/shells` and sets the default shell for new
  users in `/etc/default/useradd`. Root and existing accounts are not changed. nu is not POSIX: `/etc/profile` is not
  sourced for it, which is why PATH is set in `env.nu`.
- **Everything else** is installed by `bunos-rust-base`: `depends` holds the picks that exist in the official Arch repos
  and belong to the CORE set of `gen.ts`; the other official picks are `optdepends`; AUR-only or unpackaged picks are only
  listed in `/usr/share/bunos/rustbase/picks.json`. No GNU tool is removed for them (they are additions, not
  replacements). The compositor pick follows the data (niri); the COSMIC desktop path stays a `factory/distro` decision.

## Patches Bun OS needs

None is carried yet. `factory/rustbase/patches/README.md` records each candidate patch with the reason it is not a patch
(or not yet verifiable): WSL/WSLg-aware `uname`/`hostname`/`open` in uutils is not needed today (WSL owner, 2026-10-29),
the sudo-rs PAM configuration is package content, the nushell/Bun integration is package content. `check.ts --patches`
applies any `*.patch` that appears there to a shallow clone of the pinned SHA, and CI runs it.

## Licenses

Most picks are MIT or Apache-2.0. Picks that are copyleft or unlabelled on GitHub:

<!-- rustbase:licenses:start -->
- ls: eza-community/eza is EUPL-1.2.
- archiver: ouch-org/ouch is unlabelled on GitHub (check LICENSE).
- fields: theryangeary/choose is GPL-3.0.
- aur-helper: Morganamilo/paru is GPL-3.0.
- ntp: pendulum-project/ntpd-rs is unlabelled on GitHub (check LICENSE).
- tls: rustls/rustls is unlabelled on GitHub (check LICENSE).
- dns: hickory-dns/hickory-dns is unlabelled on GitHub (check LICENSE).
- compositor: niri-wm/niri is GPL-3.0.
- launcher: abenz1267/walker is GPL-3.0.
- kernel-rust: Rust-for-Linux/linux is unlabelled on GitHub (check LICENSE).
- js-runtime: oven-sh/bun is unlabelled on GitHub (check LICENSE).
- code-stats: XAMPPRocky/tokei is unlabelled on GitHub (check LICENSE).
- reverse-proxy: sozu-proxy/sozu is AGPL-3.0.
<!-- rustbase:licenses:end -->

The uutils diffutils package is dual MIT/Apache-2.0 upstream (GitHub reports Apache-2.0 only). Packages built here
ship the upstream license files under `/usr/share/licenses/<pkgname>/`.

## CI

`.github/workflows/rustbase.yml` (push to `os` on `factory/rustbase/**`, and manual dispatch):

1. `check`: `check.ts --patches`, `gen.ts --check`, `render-docs.ts --check`.
2. `packages`: Arch container (`archlinux:base-devel`), non-root `builder`, cargo registry cache, `makepkg` for
   `bunos-uutils-multicall`, `bunos-sudo-rs`, `bunos-nushell-default` and `bunos-rust-base`, `namcap` on every PKGBUILD
   and package, install into the container (conflicts resolved with `--ask 4`), `smoke.sh`, artifacts.
3. `gnu-coreutils`: uutils' own `fetch-gnu.sh`, `build-gnu.sh`, `run-gnu-test.sh` and `gnu-json-result.py` at the pinned
   SHA; the PASS/FAIL/SKIP/ERROR counts are written to the job summary and to `gnu-summary.json`.
4. `util-linux-tests`: `cargo test` of the fork at its pinned commit; the totals are parsed from the cargo output.

Only numbers produced by a run are reported; results of the latest run are recorded below.

<!-- rustbase:ci:start -->
No run recorded yet.
<!-- rustbase:ci:end -->

## Unverified

- The PKGBUILDs have not been built on a workstation (builds run in CI only); see the CI section for the run result.
- The packages have not been booted in a WSL rootfs or a bare-metal image; `wsl-rootfs.yml` does not install them yet.
- The upstream GNU util-linux test suite is not run (the uutils fork has no harness for it; only its own cargo tests).
- Arch/AUR/CachyOS membership is the observation of the `observedAt` date; CachyOS membership is derived from the
  pinned CachyOS-PKGBUILDS recipe names, not from the binary repository database.
- Candidate lists are hand-curated; a tool missing from `domains.json` was not ranked.
