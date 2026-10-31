# uutils GitHub organization: repository inventory (excluding coreutils), as of 2026-10-30

Method note: star counts, licenses and push dates come from the org listing and GitHub API pages fetched 2026-10-30. READMEs were read through a summarizing fetch tool, so "not stated" means the summary did not surface it, not that it is absent. Release pages appeared empty in all captures, probably a scrape limit. Verify versions on crates.io before relying on them.

## Which repos exist, how popular and how mature is each?

### Takeaway
The org has 31 repos (30 captured). Coreutils dominates at about 24.3k stars. The next tier is findutils (653), diffutils (280), util-linux (226), grep (136), platform-info (131), procps (117) and sed (110). Almost every repo was pushed within the last week, so the org is very active. Most non-coreutils tools are early-stage: few versioned GitHub releases, and mostly "latest-commit" binaries or crates.io installs.

### Cited Findings
Org listing, sorted by stars (stars / license / last push):
- coreutils: 24k / MIT / 2026-10-30 (excluded from this survey) — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars), [API](https://api.github.com/orgs/uutils/repos?per_page=100&sort=updated)
- findutils: 653 / MIT / 2026-10-29. Provides xargs, find, locate, updatedb. The README states a goal of a "full drop-in replacement". It has a GNU test suite tracking chart (findutils-tracking, 8 stars) but no percentage in the README text — [findutils](https://github.com/uutils/findutils)
- diffutils: 280 / Apache-2.0 (the README shows Apache-2.0 and MIT; the API says Apache-2.0) / 2026-10-28. Provides diff, cmp, diff3, sdiff. Aims at a drop-in replacement and GNU diff/patch compatibility. 49 forks, 27 open issues — [diffutils](https://github.com/uutils/diffutils)
- util-linux: 226 / MIT / 2026-10-28. About 60 tools listed, only 14 marked "(started)": dmesg, lscpu, lsipc, lslocks, lsmem, lsns, mountpoint, blockdev, renice, last, setsid, uuidgen, cal, hexdump. kill and more are deliberately excluded to avoid overlap with coreutils. No maturity statement — [util-linux](https://github.com/uutils/util-linux)
- grep: 136 / MIT / 2026-10-28. The README says it is "an initial release and may contain bugs". Known issues: ignores LANG for encodings (non-UTF-8 matches are treated as binary), no localization, and performance needs work. Crate `uu_grep`. GNU test tracking exists (grep-tracking, 1 star) — [grep](https://github.com/uutils/grep)
- platform-info: 131 / MIT / 2026-10-26. Cross-platform machine information library (the basis of uname-style data) — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- procps: 117 / MIT / 2026-10-29. The README lists 18 tools as "Ongoing": free, hugetop, pgrep, pidof, pidwait, pkill, pmap, ps, pwdx, skill, slabtop, snice, sysctl, tload, top, vmstat, w, watch. kill and uptime live in coreutils. It describes procfs browsing, so it is Linux only — [procps](https://github.com/uutils/procps)
- sed: 110 / MIT / 2026-10-28. The README says it implements all POSIX features and runs three complex scripts (Hanoi, Mandelbrot, arbitrary-precision calculator) correctly. It claims faster performance than GNU and FreeBSD sed in most benchmarks. Planned work is GNU regex compatibility and more GNU extensions. 982 commits, 21 open issues. Install via `cargo binstall sed`; a latest-commit Linux x86_64 binary is also published. GNU test tracking exists (sed-tracking) — [sed](https://github.com/uutils/sed)
- tar: 52 / MIT / 2026-10-29. Built on the `tar-rs` library, which handles formats and permissions. Crate `uu_tar`, latest-commit binary only, 488 commits, 97 open issues. No maturity statement — [tar](https://github.com/uutils/tar)
- parse_datetime: 37 / MIT / 2026-10-26. Parses relative time strings into a jiff::Zoned. Used for `date -d` and `touch -d` — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- hostname: 34 / MIT / 2026-10-28 — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- num-prime: 33 / "Other" license / 2026-10-26. Number theory library (used by `factor`) — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- uucore (standalone repo): 32 / MIT / archived since 2020. The live uucore is now a crate inside the coreutils repo, version 0.12.0 on crates.io (2026-09-17), with about 2.46M downloads — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars), [crates.io](https://crates.io/api/v1/crates?q=uutils&per_page=20&sort=downloads)
- awk: 29 / MIT or Apache-2.0 / 2026-10-27. The README calls it a WIP and says differences with GNU are "treated as bugs". It is tested against gawk's own suite via `./util/run-gnu-testsuite.sh`. No releases. 444 commits. Targets Linux, macOS, BSD, Windows and WASI — [awk](https://github.com/uutils/awk)
- red: 28 / MIT / last push 2026-05-25. Described as an experimental drop-in replacement for GNU sed, now apparently superseded by the `sed` repo (inference) — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- acl: 25 / MIT / 2026-10-28 — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- login: 25 / MIT / archived 2026-04-23. Its functionality moved to `shadow` — [shadow README](https://github.com/uutils/shadow)
- shadow: 18 / MIT / 2026-10-27. Described as a memory-safe reimplementation of shadow-utils — see the shadow section below — [shadow](https://github.com/uutils/shadow)
- bsdutils: 12 / MIT / 2026-10-26. Only `renice` is started. logger, script, scriptlive, scriptreplay and wall are TODO. No releases — [bsdutils](https://github.com/uutils/bsdutils)
- uutils-args: 10 / MIT / archived 2026-02-11, an experimental derive-based argument parser — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- Support libraries: uutils-term-grid (13 stars; crate `uutils_term_grid` 0.8.1, about 4.0M downloads), ansi-width (13), rust-users (10, last push 2024-04-10)
- Infrastructure: coreutils-tracking (35), findutils-tracking (8), sed-tracking (2), grep-tracking (1), diffutils-tracking (0), all Python and GNU-suite result trackers. Also coreutils-l10n (5, Fluent translations), uutils.github.io (18, website), thirdparty-artifacts (0) — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars)
- No repo in the org is a fork — [API](https://api.github.com/orgs/uutils/repos?per_page=100&sort=updated)

### Inferences
- The org has pivoted to an "all of the base system" strategy. Per-GNU-package repos now exist for nearly every major package (coreutils, findutils, diffutils, util-linux, procps, sed, grep, awk, tar, shadow, acl, hostname, bsdutils).
- The star gap (24k vs. at most 653) shows adoption and community attention are concentrated on coreutils.

### Gaps
- Exact latest version numbers for findutils, diffutils, procps and others were not retrieved (release pages appeared empty). Check crates.io and GitHub Releases.
- GNU test-suite pass percentages are only in chart images and were not captured.

## Which are production-ready versus experimental?

### Takeaway
Only coreutils is clearly production-grade, and it ships in Ubuntu 26.04 with exceptions. Of the rest, findutils and diffutils are the most mature and are described as drop-in goals. Sed is advanced but still has GNU gaps. Grep, tar, procps, util-linux, awk, bsdutils and acl are early or in progress. Shadow looks like a rapidly maturing newcomer. This is my judgment: no README says "production ready".

### Cited Findings
- Ubuntu 26.04 makes rust-coreutils the default core utility set and sudo-rs the default sudo. Canonical's April 2026 status update says cp, mv and rm stay on GNU coreutils in 26.04 because of remaining TOCTOU issues. One source conflicts on this point, so it is uncertain — [turbogeek](https://www.turbogeek.co.uk/rust-coreutils-sudo-rs-ubuntu-26-04/), [linuxconfig](https://linuxconfig.org/understanding-sudo-rs-on-ubuntu-26-04)
- uutils coreutils 0.8.0 was tested on Ubuntu 26.04 in April 2026, and 0.9.0 shipped at the end of May 2026 after a Canonical-funded security audit (single secondary source) — [computingforgeeks](https://computingforgeeks.com/ubuntu-2604-rust-coreutils-guide/), [webpronews](https://www.webpronews.com/rust-coreutils-0-9-hardens-against-races-and-unsafe-code/)
- crates.io shows uucore and the uu_* coreutils crates at 0.12.0, published 2026-09-17 — [crates.io](https://crates.io/api/v1/crates?q=uutils&per_page=20&sort=downloads)
- shadow: 28 tools "Implemented", including passwd (all 16 flags), pwck, useradd, userdel, usermod, groupadd, chage, login (needs the `pam` feature), newuidmap, newgidmap and expiry. Output is claimed "bit-for-bit identical with GNU" for passwd and pwck. A Docker test matrix covers Debian, Alpine and Fedora. Releases publish glibc x86_64, glibc aarch64 and static musl archives. Limitations: the static musl build has no PAM, no NSS and no yescrypt. Insecure hashes and empty passwords are deliberately refused. MSRV is 1.94.0. faillog and lastlog are "not planned" and groupmems is out of scope. `nologin` lives in uutils/util-linux and `su` in sudo-rs — [shadow](https://github.com/uutils/shadow)
- grep self-describes as an initial release with bugs — [grep](https://github.com/uutils/grep). awk self-describes as WIP — [awk](https://github.com/uutils/awk).
- util-linux and bsdutils: most tools are not started — [util-linux](https://github.com/uutils/util-linux), [bsdutils](https://github.com/uutils/bsdutils)

### Inferences
- Rough tiers (my assessment): (1) coreutils, production, with a few exceptions; (2) findutils, diffutils, sed, shadow, advanced and usable but unverified for production; (3) grep, tar, procps, awk, in progress; (4) util-linux, bsdutils, acl, hostname, early or partial; (5) red, the archived login and uutils-args, retired.
- Because findutils and diffutils have no visible versioned releases in the scrape, I could not confirm whether any distro ships them. Treat that as unknown.

### Gaps
- No evidence found on whether Debian, Ubuntu or Fedora package findutils, diffutils, procps or sed from uutils. The search returned nothing for these. Check Ubuntu's rust-coreutils and rust-findutils packages and the Debian tracker.
- Maturity of acl and hostname: no README content fetched.

## Which together would form a full Rust userland replacement, and what gaps remain?

### Takeaway
A near-complete GNU base-system set can be assembled from uutils repos plus sudo-rs: coreutils, findutils, diffutils, sed, grep, awk, tar, procps, util-linux, shadow, acl, hostname and bsdutils. Maturity is uneven, and the gaps are mostly util-linux breadth, bsdutils, `su`/`sudo`, and non-uutils pieces such as bash, gzip, and mount and fdisk.

### Cited Findings
- Coverage by GNU package: coreutils (including kill and uptime), findutils (find, xargs, locate, updatedb), diffutils (diff, cmp, diff3, sdiff), sed, grep, awk (gawk), tar, procps (18 tools), util-linux (14 started of about 60), shadow (28 tools), acl, hostname, bsdutils (renice started) — repo READMEs as cited above.
- `su` is not in uutils but in sudo-rs; the Debian 13 and Ubuntu 25.10 `login` comes from util-linux, older releases use shadow's — [shadow](https://github.com/uutils/shadow)
- Shared libraries: uucore, parse_datetime, platform-info, num-prime, ansi-width, uutils-term-grid — [org list](https://github.com/orgs/uutils/repositories?q=sort%3Astars), [crates.io](https://crates.io/api/v1/crates?q=uutils&per_page=20&sort=downloads)

### Inferences
- Remaining gaps (my analysis, partly from knowledge outside the sources): most util-linux tools (mount, fdisk, lsblk, losetup, etc.), logger, script and wall in bsdutils, gzip/bzip2/xz, bash or another shell, patch (diffutils says patch compatibility, not that it implements patch), and PAM or NSS integration in static builds.
- Compatibility is measured against GNU test suites for coreutils, findutils, sed, grep and awk, via the `*-tracking` repos. Real replacement readiness depends on those pass rates, which I could not read.

### Gaps
- Whether a `patch` implementation exists in the org: not found.
- Current GNU test pass rates for each tool.
- Whether acl, hostname, procps and util-linux cover all subcommands of their GNU counterparts: README details not fully captured.
