# uutils/coreutils (Rust GNU coreutils rewrite), status as of late Oct 2026

## How complete and compatible is it today (versions, GNU test counts, missing utilities, performance)?

### Takeaway
Latest stable release seen is 0.12.0 (2026-09-17); main is already at 0.13.0. The GNU suite pass rate is about 93-95% (653 pass / 21 fail / 0 error at 0.12.0). Percentages move with GNU suite version changes, so the trend is not monotonic. I found no credible uutils-vs-GNU benchmark.

### Cited Findings
- Release 0.12.0 published Sep 17, 2026. It focused on Ubuntu compatibility fixes, replaced the C `onig` dependency in `expr` with pure-Rust fancy-regex, and added Windows builds of `nice`, `nohup` and `hostid`. It also hardened `ls`, `sort` and `install`, and rewrote code carried over from GNU. Reported 653 pass, 21 fail, 0 error GNU tests. — [GitHub releases API](https://api.github.com/repos/uutils/coreutils/releases?per_page=12)
- Release 0.11.0 published Aug 31, 2026. It added an ariadne-based diagnostic engine (caret-pointing parse errors for chmod modes, cut lists and sort keys) and PGO release builds ("up to 31% faster" for some utilities). It also fixed an xattr race in mv/cp and changed rm/chmod symlink handling. 653 pass, 22 fail, 0 error. — [GitHub releases API](https://api.github.com/repos/uutils/coreutils/releases?per_page=12)
- Release 0.10 was reported Sep 16, 2026 at a 93.48% GNU test pass rate. — [LinuxToday](https://www.linuxtoday.com/blog/rust-based-uutils-coreutils-0-10-reaches-93-5-gnu-compatibility/)
- A computingforgeeks guide says upstream reported 94.74% (630/665, GNU 9.10) at 0.8.0. — [computingforgeeks](https://computingforgeeks.com/ubuntu-2604-rust-coreutils-guide/) (secondary source)
- A uutils/awk PR says the GNU reference moved from 9.10 to 9.11, adding 25 tests (665 to 690) and lowering the percentage without any regression. It is about awk, but it suggests the same denominator shift for coreutils. — [uutils/awk PR 33](https://github.com/uutils/awk/pull/33)
- Root Cargo.toml on main shows version 0.13.0, edition 2024, license MIT. — [Cargo.toml](https://raw.githubusercontent.com/uutils/coreutils/main/Cargo.toml)
- Daily-updated results and a progress chart live at the user-manual test_coverage page and the coreutils-tracking repo. The page text has no numbers (chart is an image). — [test coverage](https://uutils.org/coreutils/docs/test_coverage.html), [coreutils-tracking](https://redirect.github.com/uutils/coreutils-tracking)
- The README states the goal as "Differences with GNU are treated as bugs" and that some options may be missing. Meta bugs are tracked in the org project board. — [README](https://github.com/uutils/coreutils)
- Performance: no uutils-vs-GNU benchmark found. The only PGO claim is the "up to 31%" figure from the project's 0.11.0 notes (relative to prior uutils builds, not GNU). The search surfaced only fcoreutils, a different project, with self-reported numbers. — [fcoreutils README](https://docs.rs/crate/fcoreutils/0.18.0/source/README.md)

### Inferences
- With roughly 21 failures out of about 675 tests, completeness is high, but the sudden pass-rate dips are likely GNU-suite version changes, not regressions.
- 0.8.0 to 0.12.0 passed roughly 630 to 653 tests; the cadence of about 2 weeks to 2 months between releases suggests rapid pre-1.0 releases (0.10 Sep 16, 0.11 Aug 31 and 0.12 Sep 17 are inconsistent in order, see Gaps).

### Gaps
- Exact current list of missing utilities; the README gives none.
- Release dates are inconsistent: 0.11.0 is dated Aug 31 and 0.12.0 Sep 17, while LinuxToday reports 0.10 on Sep 16. I could not reconcile this (the LinuxToday byline may not be the release date). The first part of the releases list was truncated, so there may be releases between.
- Whether 0.13.0 has been tagged; main already says 0.13.0.
- Authoritative performance comparison versus GNU.
- A historical trend series (only the chart image was available).

## How is it built, packaged and installed as a drop-in, and what are the Arch/pacman pitfalls?

### Takeaway
It builds as a single multicall `coreutils` binary or per-utility binaries via Cargo features or `make`. Distros ship it either with symlinks (Ubuntu) or via a separate path/prefix (Debian, Fedora, Arch). On Arch the official `uutils-coreutils` package does not replace `coreutils`.

### Cited Findings
- Build: `cargo build --release` (or `--profile=release-small`); `--features unix`/`windows`/`feat_wasm` (wasm32-wasip1, `--no-default-features`); custom sets via `--features "base32 cat echo rm" --no-default-features`; per-utility `-p uu_<name>`; separate binaries via `cargo build --release --bins --workspace --exclude coreutils --exclude uu_runcon --exclude uu_chcon`. — [README](https://github.com/uutils/coreutils)
- SELinux: `--features unix,feat_selinux` (needs libselinux and libclang). Cargo.toml's `feat_selinux` enables selinux sub-features for cp, id, install, ls, mkdir, mkfifo, mknod, stat and runcon/chcon. — [README](https://github.com/uutils/coreutils), [Cargo.toml](https://raw.githubusercontent.com/uutils/coreutils/main/Cargo.toml)
- `--features openssl` speeds up checksum utilities (statically linked by default; `OPENSSL_NO_VENDOR=1` for dynamic). — [README](https://github.com/uutils/coreutils)
- `make install` options: `PREFIX`/`DESTDIR`, `PROG_PREFIX=uu-`, `MULTICALL=y`, `COMPLETIONS=n`, `MANPAGES=n`, `UTILS`/`SKIP_UTILS`. `cargo install --path . --locked` installs no completions or man pages. Completions and manpages are generated with `uudoc`. — [README](https://github.com/uutils/coreutils)
- Install docs: Arch `pacman -S uutils-coreutils` (no notes), Debian/Ubuntu `apt install rust-coreutils` (binaries under `/usr/lib/cargo/bin/coreutils`, add to PATH), Fedora `uutils-coreutils` (`/usr/libexec/uutils-coreutils`), Alpine edge, Gentoo, NixOS, Homebrew, MacPorts, FreeBSD `pkg install rust-coreutils`, winget/Scoop, conda, Yocto (meta-openembedded; `PREFERRED_PROVIDER_coreutils = "uutils-coreutils"`). AUR: `uutils-coreutils-git`, `uutils-coreutils-git-bin`. — [installation docs](https://uutils.org/coreutils/docs/installation.html)
- Arch official `uutils-coreutils` is at 0.12.0-1 in extra; deps: glibc, libgcc, openssl, systemd-libs. The page did not show conflicts/provides or file paths. — [Arch package page](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/)
- Per an arch-general mailing list post, official `uutils-coreutils` neither conflicts with nor provides `coreutils`, and its tools carry a `uu-` prefix, so it cannot replace coreutils as-is. — [arch-general thread](https://lists.archlinux.org/archives/list/arch-general@lists.archlinux.org/thread/HTEMRGXMR6KSOZU7ABUDCOKH4VGTPTGX) (via search summary; I did not open the thread)
- AUR `coreutils-uutils`: Conflicts b3sum, coreutils, sha3sum; Provides b3sum, coreutils; still builds some GNU tools such as `install` (uutils `install` breaks mkinitcpio). A forum thread says it disappeared from the AUR. — [AUR pkgbase](https://aur.archlinux.org/pkgbase/coreutils-uutils), [Arch forum](https://bbs.archlinux.org/viewtopic.php?id=311729)
- AUR `coreutils-hybrid` mixes stable uutils tools with GNU for unfinished/buggy ones and conflicts with coreutils. — [AUR](https://aur.archLinux.org/pkgbase/coreutils-hybrid)
- Ubuntu uses a provider model: `coreutils` depends on `coreutils-from-uutils` (default) or `coreutils-from-gnu`; GNU binaries remain available with a prefix. The revert command `apt install coreutils-from-gnu coreutils-from-uutils- --allow-remove-essential` is a community report. — [computingforgeeks](https://computingforgeeks.com/ubuntu-2604-rust-coreutils-guide/) (secondary)

### Inferences
- For an Arch/pacman-based Bun OS: do not remove `coreutils` (an essential dependency of base); either keep `uutils-coreutils` side-by-side (`uu-` prefix) and symlink selectively, or build a custom package that provides/conflicts `coreutils`, ideally hybrid (GNU `install`, plus cp/mv/rm as GNU per Ubuntu's lead). Multicall symlinks must be created by the package, and `MULTICALL=y` is the make option for that.
- mkinitcpio breaking on uutils `install` is a concrete Arch pitfall; test initramfs generation.

### Gaps
- Current official Arch package file list, whether it ships `/usr/bin/uu-*` or a multicall binary, and exact conflicts (page did not show them).
- Whether `coreutils-uutils` returned to the AUR.
- `feat_acl` was not found in Cargo.toml (my fetch summary may have missed it); the ACL feature name could not be verified.

## What toolchain/MSRV does it require, and can it be consumed as uu_* crates?

### Takeaway
MSRV is 1.88.0 (edition 2024) on main, so a recent stable toolchain suffices; nightly is not required. Each utility is a separate `uu_*` crate in the workspace and published to crates.io.

### Cited Findings
- `rust-version = "1.88.0"`, edition 2024, MIT. — [Cargo.toml](https://raw.githubusercontent.com/uutils/coreutils/main/Cargo.toml)
- README: follows Rust release channels, tested against stable, beta and nightly. — [README](https://github.com/uutils/coreutils)
- Workspace members: `.`, `src/uu/*`, `src/uu/stdbuf/src/libstdbuf`, `src/uucore`, `src/uucore_procs`, `tests/uutests`. `[workspace.dependencies]` includes `uu_ls`, `uu_base32`, `uu_checksum_common`; many other `uu_*` are optional path dependencies. — [Cargo.toml](https://raw.githubusercontent.com/uutils/coreutils/main/Cargo.toml)
- `uu_ls` is on crates.io/docs.rs at 0.12.0 (2026-09-17), described "ls ~ (uutils) display directory contents". — [docs.rs uu_ls](https://docs.rs/crate/uu_ls/latest)
- Per-utility build: `cargo build -p uu_<name>`. — [README](https://github.com/uutils/coreutils)

### Inferences
- A Bun OS Cargo workspace can depend on `uu_<name> = "0.12"` (crates.io) or as a git/path dependency; utilities share `uucore`, so versions must be pinned in lockstep. Nightly pin is compatible but not required.
- MSRV 1.88 is for main; older tags have lower MSRVs (unverified).

### Gaps
- Per-crate MSRV on crates.io; stability/semver guarantees of `uu_*` library APIs (the crates are built for the multicall binary, and I found no API stability statement).

## License, GNU-contamination policy, platforms, adopters, incompatibilities, governance

### Takeaway
MIT licensed, with a strict clean-room policy. It targets Linux, macOS, BSD, Windows and WASI; Ubuntu ships it by default (26.04 with GNU cp/mv/rm retained for security reasons). Governance is informal and sponsor-funded.

### Cited Findings
- License MIT; GNU coreutils is GPL-3.0-or-later. — [README](https://github.com/uutils/coreutils)
- Policy: no changes based on GNU source; cannot link to GNU source; do not read source of reciprocally-licensed (GPL/LGPL) implementations; BSD/MIT sources (Apple, OpenBSD) are acceptable references. Dependencies accepted: MIT, MIT-equivalents (BSD, ISC), CC0, Apache-2.0; GPL/LGPL rejected. The AI-assisted-work policy warns against GPL-derived output. — [CONTRIBUTING.md](https://raw.githubusercontent.com/uutils/coreutils/main/CONTRIBUTING.md)
- Platforms: Linux, macOS, *BSD, Windows, WASI (wasm32-wasip1) and others; musl prebuilts offered. — [README](https://github.com/uutils/coreutils); Windows progress (nice, nohup, hostid) — [releases](https://api.github.com/repos/uutils/coreutils/releases?per_page=12); NetBSD support noted for 0.0.22 — [Phoronix](https://mail.phoronix.com/news/Rust-Coreutils-uutils-0.0.22)
- Ubuntu: default since 25.10 per the README. 26.04 includes upstream 0.8.0; cp, mv, rm remain GNU due to open TOCTOU issues (8 open as of 2026-04-22); Zellic audits found 113 issues, mostly resolved; CVE-2026-35338 through CVE-2026-35381 disclosed; goal is 100% Rust in 26.10. `build-essential` depends on coreutils-from-uutils (intentional, per replies). Users reported install symlink handling and file-corruption claims, which are unconfirmed. — [Canonical Discourse](https://discourse.ubuntu.com/t/an-update-on-rust-coreutils/80773)
- Debian `rust-coreutils`, Fedora 43/44 and EPEL at 0.7.0, Alpine edge 0.7.0, Yocto meta-oe, Arch extra 0.12.0. — [installation docs](https://uutils.org/coreutils/docs/installation.html), [Fedora packages](https://packages.fedoraproject.org/pkgs/rust-coreutils/uutils-coreutils/), [Arch](https://archlinux.org/packages/extra/x86_64/uutils-coreutils/)
- Org uutils: description "Reimplementation of core tools in Rust", located France, site uutils.org; 12 public GitHub sponsors plus 1 private (e.g. Devel08, ChihweiLHBird, ArniDagur, tgrez, meenzen, finnbear, TSYCapital, tas50, vially, lassebm, saiarcot895). Sibling repos: findutils, diffutils, util-linux, grep, platform-info. No public members or governance docs. — [GitHub org](https://github.com/uutils)
- Known incompatibilities: TOCTOU in cp/mv/rm (Ubuntu); uutils `install` breaks mkinitcpio on Arch (AUR notes); pure GNU test failures: 21 at 0.12.0. — sources above.

### Inferences
- Security hardening (TOCTOU, symlink races) is the main open issue for a distro default; a Bun OS should keep GNU cp/mv/rm until upstream closes them, matching Ubuntu.

### Gaps
- Redox support: not confirmed in any source I read.
- Android support: not confirmed.
- Debian current version and whether Debian makes it default (docs only show an optional package).
- Fedora/Debian newer versions than 0.7.0 may exist; the cited versions may be stale.
- Governance (maintainers, decision process, corporate backers such as Canonical funding) not found.
- Specific list of utilities not implemented.
