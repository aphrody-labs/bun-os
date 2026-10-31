# uutils (Rust userland) distribution adoption and packaging, as of 2026-10-30

Research budget was about 10 tool calls. Search-engine summaries were used for several items and are flagged as secondary. Nothing here was checked against the live Ubuntu archive.

## Ubuntu (25.10, 26.04 LTS, 26.10): what shipped, how, incidents, outcome

### Takeaway
Ubuntu 25.10 was the first major distro to default to uutils coreutils and sudo-rs. 26.04 LTS shipped uutils coreutils 0.8.0 with GNU `cp`, `mv` and `rm` held back over TOCTOU bugs. 26.10 moves those three to uutils too. Switching is done with provider metapackages, not update-alternatives. The status of findutils and diffutils as defaults is unverified.

### Cited Findings
- sudo-rs became the default `sudo` in 25.10, with 25.10 used as a test run before 26.04 LTS. The switch uses the Debian alternatives system, so `sudo` points to `sudo-rs`. The original sudo stays installable. Source package is `rust-sudo-rs`. LDAP-distributed sudoers will not be supported. Upstream gaps were NOEXEC, AppArmor control, and sudoedit. — [Ubuntu Discourse: Adopting sudo-rs by default in 25.10](https://discourse.ubuntu.com/t/adopting-sudo-rs-by-default-in-ubuntu-25-10/60583)
- 26.04 ships rust-coreutils 0.8.0. `cp`, `mv` and `rm` remain GNU because of open TOCTOU issues (8 open as of 2026-04-22, across cp, df, mv and rm). Target for 26.10 is "100% rust-coreutils". — [Ubuntu Discourse: An update on rust-coreutils](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- Package model: `coreutils` is an essential metapackage that depends on one provider. `coreutils-from-uutils` is the default and pulls in `rust-coreutils`. `coreutils-from-gnu` pulls in `gnu-coreutils` and repoints names to GNU. The Discourse thread describes switching via the alternatives system. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- One third-party guide says there is no `update-alternatives` or `dpkg-divert`. `/usr/bin/ls` resolves to `/usr/lib/cargo/bin/coreutils/ls`, a symlink to the multicall binary `/usr/lib/cargo/bin/coreutils/coreutils`. `cp` resolves to `/usr/bin/gnucp`. This conflicts in wording with the Discourse "alternatives" phrasing. Treat the layout as plausible but secondary. — [computingforgeeks guide](https://computingforgeeks.com/ubuntu-2604-rust-coreutils-guide/)
- `build-essential` (since 12.12ubuntu2, 2025-09-04) hard-depends on `coreutils-from-uutils`. Canonical's juliank said this began as a temporary fix for old buildd chroots and was kept so builds consistently use uutils. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- Zellic audit, funded by Canonical, in two rounds (Dec 2025 to Mar 2026): 113 issues (73 and 40), 44 CVEs (CVE-2026-35338 through CVE-2026-35381), most reported resolved. Zellic's section 1.3 says build pipelines and distro packaging were not evaluated. cargo-auditable is not enabled for rust-coreutils on Launchpad because of its custom build. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- A 523-package Cargo.lock and 409 vendored directories were cited by a forum commenter, not confirmed by Canonical. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- 25.10 incident: a bug in uutils `date` (reported on `-r`) made the timestamp difference always 0, so unattended-upgrades never ran. Fixed in rust-coreutils 0.2.2-0ubuntu2. Affected systems had to upgrade manually. A `dd` bug was fixed at the same time. — [Phoronix](https://www.phoronix.com/news/Ubuntu-25.10-Broken-Upgrade), [OMG Ubuntu](https://www.omgubuntu.co.uk/2025/10/ubuntu-25-10-rust-coreutils-date-bug)
- Other user-reported problems: `install` replaces a destination symlink such as `/sbin`; one user claims 0.8.0 can corrupt files (Launchpad bug 2158615, unverified). — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- Secondary-source breakages: `uname -p` prints `unknown`, `stat` label casing, stricter `env -S`, multibyte `sort` collation, AppArmor profiles naming `/usr/bin/ls` literally (LP#2123870), sha256sum about 2.3x slower in one blogger's benchmark. — [computingforgeeks guide](https://computingforgeeks.com/ubuntu-2604-rust-coreutils-guide/)
- GNU coreutils 9.10 (2026-02-04) missed the 26.04 autosync cutoff (2026-02-19). Ubuntu ships `gnu-coreutils` 9.7. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- 26.10: `cp`, `mv`, `rm` moved to uutils (article dated 2026-09-15). In July 2026 uutils `cp` was added to the archive and quickly removed after breaking live image builds. Next Canonical Rust target is ntpd-rs for 27.04. — [It's FOSS](https://itsfoss.com/news/ubuntu-rustification-coreutils-migration/)
- Ubuntu ships `rust-diffutils` 0.4.2 in the archive (versions 25.04, 25.10, stonking); whether it is default is not shown. — [packages.ubuntu.com](https://packages.ubuntu.com/stonking/rust-diffutils)
- `oxidizr` is a community tool for swapping in uutils coreutils, findutils, diffutils and sudo-rs on Ubuntu. — [oxidizr via ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fjnsgruk%2Foxidizr)

### Inferences
- Canonical's carve-out of cp/mv/rm shows the weakest area is filesystem-mutating tools with race conditions, not read-only tools.
- A provider-metapackage design is easier to roll back than file diversion. It also breaks anything depending on a specific provider (build-essential).
- Symlink-path-sensitive consumers (AppArmor, `install` into symlinked dirs) are a recurring regression class.

### Gaps
- Whether Ubuntu 26.04 or 26.10 defaults findutils or diffutils to uutils. No primary source found. Check `findutils-from-uutils` or `diffutils-from-uutils` in the archive and the release notes.
- sudo-rs incidents in 25.10 ("two moderate security issues" per a search summary) were not traced to a primary advisory.
- Exact `/usr/bin` layout on Ubuntu not verified on a live system.

## Other distros: Debian, Arch/AUR, Fedora, NixOS, Alpine, Yocto, Chimera

### Takeaway
No distro found other than Ubuntu uses uutils as the default. Elsewhere it is an opt-in side package: Debian under `/usr/lib/cargo/bin/coreutils`, Arch with `uu-` prefixed binaries, NixOS and Alpine opt-in. Chimera uses FreeBSD-derived chimerautils, not uutils. Yocto and Gentoo not found.

### Cited Findings
- Debian packages `rust-coreutils`, binaries in `/usr/lib/cargo/bin/coreutils/`, opt-in via PATH, README says not recommended for production (README from version 0.6.0-1; may be outdated). Debian stable lists 0.0.30-2; codegraph shows 0.10.0-1. Maintainer is Sylvestre Ledru. — [Debian README via search result](https://sources.debian.org/src/rust-coreutils/0.6.0-1/debian/README.Debian), [Debian stable](https://packages.debian.org/stable/utils/rust-coreutils), [Debian codegraph](https://codegraph.jelmer.uk/rust-coreutils/0.10.0-1/)
- Arch official `extra/uutils-coreutils` 0.12.0-1 (built 2026-09-17): MIT, depends on glibc, libgcc, openssl, systemd-libs; installed size 15.7 MB. Every binary under `/usr/bin` is `uu-` prefixed (including `uu-coreutils`). No `/usr/bin/coreutils` entry. — [Arch package](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/), [file list](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/files/)
- Arch has no conflict with core `coreutils` because of the prefix; no conflicts shown on the package page. — same sources
- AUR `coreutils-uutils` conflicted with and provided `coreutils`, did not replace stty/chcon/runcon/install (breaking mkinitcpio), and appears removed from the AUR in early 2026. A deletion request (Aug 2025, saying symlink-only packages are not allowed) was rejected. — [AUR page](https://aur.archlinux.org/packages/coreutils-uutils), [aur-requests](https://lists.archlinux.org/archives/list/aur-requests@lists.archlinux.org/thread/VAI3R4JNVT3R7TI572T2QACL4BH22PVW/), [Arch forum](https://bbs.archlinux.org/viewtopic.php?id=311729)
- AUR `uutils-findutils` 0.9.1-2 (updated June 2026); maintainer open to moving it to extra once binary naming is agreed. AUR `uutils-diffutils-bin` exists; a commenter asked for `uu-` naming. — [AUR uutils-findutils](https://aur.archlinux.org/packages/uutils-findutils/), [AUR uutils-diffutils-bin](https://aur.archlinux.org/packages/uutils-diffutils-bin)
- Arch official `sudo-rs` exists in extra (0.2.13-1 per Arch ARM page; extra-testing showed 0.2.12-2). — [Arch sudo-rs](https://archlinux.org/packages/extra/x86_64/sudo-rs), [Arch Linux ARM](https://archlinuxarm.org/packages/aarch64/sudo-rs)
- Fedora: FESCo approved rust-coreutils 0.5 for F44 with no plan to make it default; `uutils-coreutils` 0.7.0 pushed to F45 stable. — [Fedora change](https://fedoraproject.org/wiki/Changes/Rust_Uutils_Coreutils_0.5_Nushell_0.109), [FESCo #3555](https://pagure.io/fesco/issue/3555)
- NixOS: opt-in via `uutils-coreutils-noprefix` with high priority; community thread argues it is not a sane default. — [NixOS wiki](https://wiki.nixos.org/w/index.php?oldid=24102&title=Uutils), [NixOS Discourse](https://discourse.nixos.org/t/what-do-you-think-about-replacing-gnu-core-utils-with-uutils-by-default-in-nixos/61797)
- Alpine: `uutils-coreutils` in community; versions vary by branch (third-party indexes, possibly stale). — [pkgs.alpinelinux.org](https://pkgs.alpinelinux.org/package/edge/community/armhf/uutils-coreutils)
- Chimera Linux uses chimerautils (FreeBSD-based) for coreutils, findutils, diffutils; not uutils. — [chimerautils](https://git.omada.cafe/chimera-linux/chimerautils/src/tag/v14.1.1)

### Inferences
- Arch's `uu-` prefix with no conflict is the lowest-risk model. It leaves the choice of symlinking to the user or a separate package.
- A conflicting `coreutils` drop-in on Arch has already been tried in the AUR and had gaps (install, stty), which is the main precedent warning.

### Gaps
- Yocto and Gentoo uutils status: no results.
- Whether any non-Ubuntu distro defaults to uutils: none found, but not exhaustively searched (Debian derivatives, Redox, others unchecked).
- Arch `uutils-coreutils` file list was truncated after 100k characters; presence of a `PKGBUILD` provides/conflicts not seen.
- Current Fedora and Alpine versions unverified.

## Security, performance, audits and GNU compatibility

### Takeaway
The Canonical-funded Zellic audit found 113 issues and 44 CVEs, mostly logic and TOCTOU rather than memory-safety. GNU test-suite pass rate reached 93.48% in 0.10. Reliable performance numbers are not available.

### Cited Findings
- Zellic audit stats and CVE range as above. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- The oss-security list carries disclosure postings (2026-05-02). — [oss-security](https://www.openwall.com/lists/oss-security/2026/05/02/2)
- Coreutils 0.9.0 (end of May 2026) added TOCTOU hardening after the audit. — [WebProNews](https://www.webpronews.com/rust-coreutils-0-9-hardens-against-races-and-unsafe-code/) (secondary)
- GNU test pass rate: 88% at 0.5.0, 90.58% at 0.9, 93.48% (645 of 690) at 0.10. — [heise](https://heise.de/-11115595), [Linuxiac](https://linuxiac.com/rust-based-uutils-coreutils-0-10-reaches-93-5-gnu-compatibility/)
- The project treats divergence from GNU as a bug. — [It's FOSS](https://itsfoss.com/news/ubuntu-rustification-coreutils-migration/)
- The Arch package is at 0.12.0 as of 2026-09-17, so upstream has moved well past Ubuntu's 0.8.0. — [Arch package](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/)

### Inferences
- A pass rate of about 93% still means roughly 7% of GNU tests fail; scripts relying on edge behaviour may break.
- Distro packaging was explicitly out of the audit scope, so a packager owns supply-chain review of the roughly 500 crates.

### Gaps
- No credible benchmark found (only one blogger's sha256sum claim). Run own benchmarks.
- Audit report itself (on GitHub) was not read; counts are from Canonical's post and third-party summaries, which differ in framing (73 critical-scope findings vs 113).
- Whether the audit covered findutils, diffutils or sudo-rs: not established (sudo-rs has had separate audits, not researched).

## Practical recommendations for Arch/pacman (Bun OS)

### Takeaway
Install `uutils-coreutils` from extra alongside GNU, using its `uu-` prefix, and keep GNU `coreutils` (an essential base dependency) in place. Opt in per tool through a separate pinned package or PATH directory, and keep `cp`, `mv`, `rm`, `install`, `stty` on GNU until upstream settles.

### Cited Findings
- Official Arch package is prefix-only and coexists with GNU. — [Arch file list](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/files/)
- The only conflicting drop-in (AUR `coreutils-uutils`) broke `install`/mkinitcpio and was removed. — [AUR](https://aur.archlinux.org/packages/coreutils-uutils), [Arch forum](https://bbs.archlinux.org/viewtopic.php?id=311729)
- Ubuntu's provider-package approach plus GNU-held `cp/mv/rm` is the tested precedent. — [Ubuntu Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)

### Inferences (recommendations, not sourced facts)
- Side by side: depend on `uutils-coreutils`, `uutils-findutils` (AUR, so build into the Bun OS repo), `uutils-diffutils` (prefix naming not settled), `sudo-rs` (official). No conflicts with `coreutils`.
- Symlink strategy: ship a small package such as `bunos-uutils-links` that installs symlinks in a dedicated directory (for example `/usr/lib/bunos/uutils/bin`) mapping bare names to `uu-*`, and put it on PATH for chosen shells or services. Avoid replacing `/usr/bin` names: pacman has no alternatives system, `/usr/bin` file ownership conflicts with `coreutils`, and a symlink-only package was an AUR policy issue.
- If a full swap is wanted later, use a `provides=coreutils` / `conflicts=coreutils` package plus pacman hooks, and keep GNU `install`, `stty`, `chcon`, `runcon`, `cp`, `mv`, `rm` until verified. Test with mkinitcpio, makepkg and pacman hooks.
- Risks: symlink-sensitive tools (AppArmor, `install`), `date -r`-style regressions, scripts parsing `stat`/`uname -p`, pacman/makepkg expecting GNU behaviour, supply-chain breadth (about 500 crates).
- Pinned-owner fit: track upstream tags (0.12.x) as a pinned source, and track Arch extra versions for the binary; record the GNU test-suite pass rate per pin.
- sudo-rs: ships in extra, usable in place of `sudo` via a conflicting package, but known gaps (LDAP sudoers, NOEXEC at the time of the Ubuntu post) need checking against current 0.2.x.

### Gaps
- None of the above was tested on an Arch host. Run on the VPS builder per project policy.
