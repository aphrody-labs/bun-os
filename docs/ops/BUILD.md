# Build

Bun OS builds in ordered stages, each with one owner, pinned inputs and a gate that must pass before the next
stage consumes its output. The model follows three references:

- **Linux From Scratch** ([LFS book](https://www.linuxfromscratch.org/lfs/view/stable/)): verified source
  pins first (LFS ch. 3), a toolchain checked before anything is built with it (ch. 5 sanity checks), then the
  system, its configuration and the bootable image as separate steps (ch. 8–10); packages install into a staging
  root (`DESTDIR`), never straight onto the build host.
- **COSMIC** ([pop-os/cosmic-epoch](https://github.com/pop-os/cosmic-epoch)) and **Arch Linux**
  ([PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD), [makepkg](https://wiki.archlinux.org/title/Makepkg),
  [pacman repositories](https://wiki.archlinux.org/title/Pacman/Tips_and_tricks#Custom_local_repository)): every
  desktop component is its own repository with a `justfile` (`just vendor`, `just build-release`); Bun OS packages
  each one with a PKGBUILD pointing at our fork, builds it with `makepkg` in a clean `archlinux:base-devel`
  container and ships it through signed pacman repositories (rolling release, [RELEASES.md](RELEASES.md)). The
  distribution consumes packages, not loose binaries.
- **Google engineering practice** ([Software Engineering at Google](https://abseil.io/resources/swe-book),
  [SRE release engineering](https://sre.google/sre-book/release-engineering/),
  [third-party code](https://opensource.google/documentation/reference/thirdparty)): one repository and one
  version of each dependency, hermetic and reproducible builds from pinned inputs, presubmit gates on every change,
  releases built once from a published commit and promoted unchanged; imported code lives in its own directory with
  its license and metadata.

All stages run on `vps` ([FLEET.md](FLEET.md)). The workstation edits and pushes; it does not build releases.

## Stages

| Stage | What                                                             | Inputs (pinned)                                                                                    | Entry point                                                                  | Gate                                                                           |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0     | Toolchain: Bun canary, Rust, wasm tools                          | `package.json` (`bun` pin), `rust-toolchain.toml`, `buncc.toolchain.json`                          | `bun scripts/setup.ts`                                                       | `bun --revision`, `rustc -V` match pins                                        |
| 1     | Sources: forks and upstreams                                     | `sources.lock.json`, `.gitmodules` gitlinks                                                        | `bun scripts/setup-submodules.ts`                                            | every gitlink at its pin                                                       |
| 2     | Workspace: Rust crates, Bun packages, WASM                       | `Cargo.lock`, `bun.lock`                                                                           | `cargo check --workspace --locked`, `bun check`, `bun lint`, `bun format`    | presubmit (sync gate, `vps-gate/*`)                                            |
| 3a    | Kernel: `linux-bun` (mainline, no LTS), WSL kernel                | kernel.org tarball + signature, `factory/kernel/linux-bun/PKGBUILD`, `factory/wsl/kernel/*.config` | `factory/kernel/build.sh`, `factory/wsl/kernel/build-wsl-kernel.sh`          | `factory/kernel/boot-bun-init.sh`: Bun boots as PID 1 under QEMU/KVM (receipt) |
| 3b    | Packages: COSMIC, Hyprland/Omarchy, GNOME, Mesa d3d12, Rust CLIs | fork gitlinks, `factory/desktop/{recipes,cli}.json`, PKGBUILDs                                     | `factory/desktop/build.sh`, `factory/wsl/build-gpu.sh`                       | each package installs in a clean Arch root                                     |
| 3c    | Repository: `[bunos-testing]` → `[bunos]`                        | the stage 3a/3b packages, the Store signing key                                                    | `repo-add`, `factory/wsl/publish-testing.sh`                                 | signed db; `pacman -Sy` from a clean client                                    |
| 4     | Images: WSL distro bundle, disk image and ISO                    | `factory/wsl/packages.*`, the stage 3c repository                                                  | `factory/wsl/build-rootfs.sh`, `bun factory/images/build.ts …`               | image plan resolves; payload verified                                          |
| 5     | Qualification: boot, sessions, Android, screenshots              | the stage 4 image                                                                                  | nightly (`bunos-auto-nightly.timer`), `factory/wsl/windows/session-probe.ts` | qualified receipt with screenshots                                             |

A stage never reaches back: a stage 4 image installs stage 3 packages from the repository, not a cargo target
directory. Heavy stage 3 builds take `~/build/locks/heavy.lock` (a second lane uses `heavy-2.lock`) inside
`build.slice` and check free memory before starting.

## Resources

The build host gives builds every CPU, its memory and its disk; there is no repository-imposed cap.
Concurrency is bounded by memory, not CPUs: buncc opens one lane per 4 GiB of RAM (11 concurrent builds on `vps`)
and every lane runs with `CARGO_BUILD_JOBS = nproc`; the kernel scheduler and `build.slice` share the CPUs.
`BUNCC_SLOTS` and `CARGO_BUILD_JOBS` override both and are operator controls; the repository sets no ceiling. Cargo goes through the lane wrapper
(`scripts/aphrody/build/rust/cargo-serial.sh`) so lanes do not fight over one lock, and each lane keeps its own
target directory under `~/build/storage/targets/<lane>`. Shared caches: `~/.cargo/{git,registry}` (on the build
volume), sccache. Host tuning (sysctl, zram, I/O cost, build slice): [VPS-TUNING.md](VPS-TUNING.md).

## Full workspace build

```sh
ssh vps-t
cd ~/src/bun-os && git pull --ff-only origin main
OUT=~/build/out/full; mkdir -p "$OUT"
bun packages/buncc/src/cli.ts exec -- build --workspace --locked --keep-going 2>&1 | tee "$OUT/rust.log"
bun install --frozen-lockfile --ignore-scripts && bun check && bun lint && bun format --check 2>&1 | tee "$OUT/bun.log"
```

The same steps run as the presubmit gate after every sync ([SYNC.md](SYNC.md)) and in `.github/workflows/ci.yml`;
when they disagree, the VPS gate is the reference.

## Rules

- Build from a clean, published commit of `main`. Release scripts refuse a dirty tree or an unpublished commit.
- Outputs go to `~/build/{out,storage}`; never into the checkout, never into `/usr` on the build host.
- A cache is derived data: it can be deleted at any time and the build must recreate it (the `~/.cargo/git`
  symlink pointed into a deleted `~/build/cargo` on 2026-11-03 and broke every git dependency; recreate the
  directory, do not special-case it).
- Imported projects stay pinned forks under `vendor/` with their license; they are built from source, never
  installed as binaries.
