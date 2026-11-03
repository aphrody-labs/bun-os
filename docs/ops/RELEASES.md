# Releases and versions

Bun OS follows the Arch Linux model (owner order 2026-11-03): a **rolling release** with the latest upstream
versions, delivered continuously as packages, never as frozen distribution versions. The machine-readable policy is
[`infra/releases/policy.toml`](../../infra/releases/policy.toml).

## Package managers

| Manager   | Scope                                                                 | Repository                                         |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| `pacman`  | the system: kernel, base, COSMIC, Rust CLIs, Bun, Craft apps, drivers | `[bunos]` and `[bunos-testing]`, signed, on aphrody.com/repo |
| Flatpak   | sandboxed desktop applications (Flathub plus our remote)              | `aphrody.com/repo/flatpak`                          |
| `bun`     | Bun/TypeScript packages and tools in the user's space                 | npm registry (`@aphrody/*`)                         |

The userland is Rust and Bun: Rust CLIs (uutils, sudo-rs, ntpd-rs, ripgrep, fd, eza, bat, dust, procs, ...),
nushell as the default shell, Rio as the terminal, COSMIC as the desktop, Craft apps, Redox crates wherever a
component exists there (relibc-free crates such as `redox_syscall`, `orbclient`-free UI crates, `redoxfs` tooling).
C userland is only what the kernel boot path still requires (glibc, systemd until a Rust replacement qualifies).

## Rolling release (Arch practice)

- **Upstream first and latest.** A new upstream release is packaged as soon as it is out (the dependency loop in
  [AUTOMATION.md](AUTOMATION.md) bumps pins daily). Patches are minimal and sent upstream.
- **Staging, testing, release.** Rebuilds that touch many packages go to a staging area first, then
  `[bunos-testing]`; a package moves to `[bunos]` after the qualification run (stage 5, [BUILD.md](BUILD.md)) passes
  with it, as Arch moves packages from `[core-testing]`/`[extra-testing]` to `[core]`/`[extra]`.
- **pkgver/pkgrel.** `pkgver` is the upstream version; `pkgrel` counts Bun OS rebuilds of it. First-party packages use
  their workspace version (`1.4.7`) as `pkgver`. Git snapshots use `r<count>.<shorthash>`.
- **No partial upgrades.** Users run `pacman -Syu`; the repository is always a consistent set.
- **Installation media**: a dated ISO snapshot `YYYY.MM.DD` on the 1st of every month (Arch publishes its ISO
  monthly), signed, with checksums, on aphrody.com/downloads. An installed system never needs a new ISO.

## Kernel (one kernel, Linux mainline)

One kernel, `linux-bun`: Linux mainline, whichever of Linus's newest `-rc` and the newest stable release is newer
(7.4-rc1 on 2026-11-03), rolling like the rest of the system; there is no LTS or second variant (owner decision,
2026-11-03: Bun OS is a research project and wants the most Rust). An `-rc` comes from Linus's annotated tag, which
must verify against his key (rc tarballs carry no `.sign`); a release comes from cdn.kernel.org with its `.sign`.
`pkgver` is the version without the dash (`7.4rc1-1`), so pacman orders `7.4rc1 < 7.4 < 7.4.1`. Built by
`factory/kernel/build.sh` with `LLVM=1` and `CONFIG_RUST=y`, the `aphrody-bun.config` and `android.config`
fragments (Android 17 requirements from AOSP, checked by `check-android.ts`), into `[bunos-testing]`; it moves to
`[bunos]` after `factory/kernel/boot-bun-init.sh` qualifies it (Bun as PID 1, binderfs). The WSL kernel uses the same
base and Android fragment plus Microsoft's WSL2 series (`factory/wsl/kernel`). Our patches follow upstream rules:
upstream first, small, real fixes only.

## Crates and npm packages

SemVer 2.0 with one workspace version for first-party crates and packages (today `1.4.7`); `cargo semver-checks`
gates crate releases. Publication through `scripts/publish-plan.ts` and `scripts/publish.ts` on the build host: [PUBLISH.md](PUBLISH.md).

## Version strings

- `/etc/os-release`: `ID=bunos`, `ID_LIKE=arch`, `BUILD_ID=rolling`, `VERSION_ID` absent (as on Arch); the image
  snapshot date in `IMAGE_VERSION=YYYY.MM.DD`.
- Every binary reports `<version> (<commit> <date>)` with `--version`; every HTTP service reports `version`, `commit`
  and `channel` in its health endpoint (`channel` is `bunos` or `bunos-testing`).
