# factory/kernel: the Bun OS kernel (`linux-bun`)

Phase 0, step 1 of [ROADMAP.md](ROADMAP.md): an owned, Arch-derived kernel package. Nothing here has been
built, installed or booted. The unmodified upstream Bun canary stays the runtime; this directory only adds
the kernel packaging that a later Bun-as-`/init` image needs.

## Pinned base (recorded 2026-10-29)

| Item                     | Value                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arch packaging           | `gitlab.archlinux.org/archlinux/packaging/packages/linux.git`, commit `0c178d550ec6392265d3a443333229823634bd08`, "7.2.11.arch1-1", committed 2026-10-16 (shallow clone of `main`, fetched 2026-10-29) |
| Kernel                   | **7.2.11** (`pkgver=7.2.11.arch1`; release string `7.2.11-arch1-1-bun`)                                                                                                                                |
| Kernel tarball           | `https://cdn.kernel.org/pub/linux/kernel/v7.x/linux-7.2.11.tar.xz`, 160,421,420 bytes                                                                                                                  |
| Arch patch               | `linux-v7.2.11-arch1.patch.zst` from `github.com/archlinux/linux` release `v7.2.11-arch1` (EXTRAVERSION `-arch1`, 2 DRM fixes, `kernel/fork.c`), 2,316 bytes                                           |
| Arch config              | `config.x86_64` of that commit, vendored unchanged (`linux-bun/config.x86_64`)                                                                                                                         |
| Newer stable (not taken) | kernel.org `sha256sums.asc` already lists 7.2.12, 7.2.13 and 7.3 on 2026-10-29; Arch is at 7.2.11, `linux-bun` follows Arch                                                                            |

## Files (`linux-bun/`)

| File                                        | Purpose                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PKGBUILD`                                  | `pkgbase=linux-bun`; packages `linux-bun` and `linux-bun-headers`                                   |
| `config.x86_64`                             | Arch's configuration, byte-identical (`b2sum` equals Arch's PKGBUILD entry)                         |
| `aphrody-bun.config`                        | fragment merged over it; each option justified from the 7.2.11 Kconfig in the file itself           |
| `check-config.sh`                           | fails `prepare()` when a fragment line is missing from the final `.config`                          |
| `linux-bun.preset`                          | mkinitcpio preset (default + fallback), installed to `/usr/share/linux-bun/`                        |
| `limine-linux-bun.conf.template`            | Limine entries (normal, fallback, Bun-as-`/init` placeholder), installed to `/usr/share/linux-bun/` |
| `verify-sources.sh`                         | offline subset of `makepkg --verifysource`: recomputes every b2sum/sha256sum                        |
| `keys/pgp/*.asc`                            | the three `validpgpkeys` (Linus Torvalds, Greg Kroah-Hartman, heftig), copied from Arch's packaging |
| `../.gitattributes`, `../LICENSES/0BSD.txt` | `-text` so the hashed files keep their bytes; Arch's packaging license (0BSD)                       |

## Differences from Arch's `linux` PKGBUILD

1. `pkgbase=linux-bun`, `pkgdesc`, `KBUILD_BUILD_HOST=bunos`; kernel and headers only (the `-docs` split,
   `make htmldocs` and its makedepends are dropped, as the Arch wiki recipe suggests).
2. `prepare()` merges `aphrody-bun.config` with the kernel's own `scripts/kconfig/merge_config.sh -m`, runs
   `make olddefconfig`, then `check-config.sh`, then `make rustavailable` (fails early with the reason when
   rustc, bindgen or libclang do not meet the 7.2.11 minimums).
3. `replaces=` removed (it would uninstall unrelated Arch packages); `provides` of the module virtual names
   kept as in Arch. `linux` is not provided, per the Arch wiki.
4. The preset, the Limine template and the fragment are installed under `/usr/share/linux-bun/`.
5. Everything else, including the `pkgbase` file that mkinitcpio reads, `/usr/lib/modules/<kver>/vmlinuz`,
   GCC as the C compiler with Rust from the `rust` package, and the headers package, is Arch's.

## Config fragment, in one paragraph

Arch 7.2.11 already has `CONFIG_RUST=y`, devtmpfs, tmpfs, initramfs, BPF, `SCHED_CLASS_EXT` and io_uring.
The fragment therefore only changes four options (`OVERLAY_FS`, `SQUASHFS`, `EROFS_FS`, `VIRTIO_NET` from `m`
to `y`, so a module-less initramfs with a Bun `/init` can mount an image root and reach the network) and
pins 20 others so they cannot silently disappear. Findings worth knowing: `DEVTMPFS_MOUNT` "does not affect
initramfs based booting" (its Kconfig help), so a Bun `/init` must mount `/dev`, `/proc`, `/sys` itself; upstream
Bun at `11c367163a4b` does not use io_uring (one TODO comment), so `IO_URING` is pinned for the roadmap's
opcode experiment, not as a Bun dependency; `CONFIG_BUN_ACCEL` is not in the 7.2.11 tree (it lives only in
`aphrody-labs/linux` branches) and is therefore deliberately absent.

## VERIFIED (run on this Windows workstation, 2026-10-29)

- Real downloads, real sums: `linux-7.2.11.tar.xz` and `linux-v7.2.11-arch1.patch.zst` were downloaded and
  their `b2sum` equal Arch's PKGBUILD values; their `sha256sum` equal the kernel.org `sha256sums.asc` line
  (tarball) and Arch's value (patch); `config.x86_64` `b2sum` equals Arch's. `linux-bun/verify-sources.sh
<download dir>` re-runs all nine source checks (rc 0). The signature files are `SKIP` as in Arch; see the
  next list for the PGP check.
- `bash -n` on `PKGBUILD`, `check-config.sh`, `verify-sources.sh`: clean. ShellCheck 0.11.0 (official
  release, sha256 matched the GitHub release digest): `check-config.sh` and `verify-sources.sh` clean;
  `PKGBUILD` has no error-level findings (its warning/info findings are Arch idioms such as unquoted
  `cd $_srcname`, kept for fidelity).
- The kernel's real `scripts/kconfig/merge_config.sh -m` from the 7.2.11 tarball, run on the base config plus
  the fragment: exactly the four intended redefinitions (m to y), none for the 20 pinned lines (so they
  already hold in Arch's config), and `check-config.sh` reports all 24 fragment lines present; run against the
  un-merged Arch config it fails on exactly those four lines (negative test).
- Every symbol of the fragment, and the `CONFIG_RUST` dependencies, minimum tool versions
  (rustc 1.85.0, bindgen 0.71.1, LLVM 17.0.1) and the `rdinit=` parameter, were read in the Kconfig and
  documentation files of the 7.2.11 tarball.
- Limine entry syntax (`protocol`, `path`, `cmdline`, `module_path`) checked against Limine's `CONFIG.md`
  (trunk) and against the entries already used in `factory/images/bunos-disk/assemble-inner.sh`; the
  mkinitcpio preset keys against mkinitcpio's own `hook.preset` template (Arch GitLab, master).
- PGP: `gpg --verify` reports a good signature for the tarball (Greg Kroah-Hartman, key
  `647F28654894E3BD457199BE38DBBDC86092693E`, signed 2026-10-15, checked over the decompressed tar as
  kernel.org requires) and for the Arch patch (Jan Alexander Steffens, key
  `83BC8889351B5DEBBB68416EB8AC08600F108CDF`, signed 2026-10-16). Both fingerprints equal the `validpgpkeys`
  entries. The public keys come from Arch's packaging repository (`keys/pgp/`), not from a web of trust:
  gpg printed "not certified with a trusted signature", so the key-to-person binding is as trustworthy as
  Arch's repository, not independently proven. The Linus Torvalds key was not exercised (it did not sign
  these two files).

## NOT verified, and why

- `makepkg --verifysource`, `makepkg`, `namcap`, `updpkgsums`, `.SRCINFO` generation: Arch tooling is not
  installable on Windows and WSL is not used on this workstation. `verify-sources.sh` replaces only the
  checksum part of `--verifysource`; `.SRCINFO` is not committed.
- `make olddefconfig` on the merged config: needs a compiled `conf` (C toolchain, not present here). The
  claim that the four changed options survive follows from reading their Kconfig `depends`/`select` lines
  (all dependencies are already `y` in Arch's config), not from running Kconfig. `check-config.sh` exists to
  turn that claim into a hard build failure on the first real build.
- `make rustavailable`, any compile, any boot: no kernel was built (not expected here). The GCC-C plus
  LLVM-Rust mixed build is what Arch ships; the report calls it "still quite experimental" (UNVERIFIED).
- mkinitcpio and Limine behaviour with this package (hook-generated preset name, `limine-entry-tool` entry
  generation) is derived from documentation and the existing Bun OS image scripts; nothing was installed.
- The Bun-as-`/init` entry is a placeholder: no Bun PID 1 implementation or initramfs is part of this change.
- Out-of-tree modules (`bun_accel`, NVIDIA) against `linux-bun-headers`: not attempted; `bun_accel` is not in
  this tree.
- Reproducibility, signing of the package, and publication to a `[bunos]` repository: not done.
- Licensing of Arch's packaging files is 0BSD (their `REUSE.toml`); the kernel is GPL-2.0-only. No legal
  review was done.
