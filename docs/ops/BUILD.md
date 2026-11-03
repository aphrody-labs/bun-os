# Build

Bun OS builds in ordered stages, each with one owner, pinned inputs and a gate that must pass before the next
stage consumes its output. The model follows three references:

- **Linux From Scratch** ([LFS book](https://www.linuxfromscratch.org/lfs/view/stable/)): verified source
  pins first (LFS ch. 3), a toolchain checked before anything is built with it (ch. 5 sanity checks), then the
  system, its configuration and the bootable image as separate steps (ch. 8–10); packages install into a staging
  root (`DESTDIR`), never straight onto the build host.
- **COSMIC** ([pop-os/cosmic-epoch](https://github.com/pop-os/cosmic-epoch)): every desktop component is its own
  repository with a `justfile` (`just vendor`, `just build-release`, `just install`) and a `debian/` directory; the
  distribution consumes `.deb` packages, not loose binaries.
- **Google engineering practice** ([Software Engineering at Google](https://abseil.io/resources/swe-book),
  [SRE release engineering](https://sre.google/sre-book/release-engineering/),
  [third-party code](https://opensource.google/documentation/reference/thirdparty)): one repository and one
  version of each dependency, hermetic and reproducible builds from pinned inputs, presubmit gates on every change,
  releases built once from a published commit and promoted unchanged; imported code lives in its own directory with
  its license and metadata.

All stages run on `vps` ([FLEET.md](FLEET.md)). The workstation edits and pushes; it does not build releases.

## Stages

| Stage | What                                                         | Inputs (pinned)                                                           | Entry point                                                               | Gate                                         |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| 0     | Toolchain: Bun canary, Rust, wasm tools                      | `package.json` (`bun` pin), `rust-toolchain.toml`, `buncc.toolchain.json` | `bun scripts/setup.ts`                                                    | `bun --revision`, `rustc -V` match pins      |
| 1     | Sources: forks and upstreams                                 | `sources.lock.json`, `.gitmodules` gitlinks                               | `bun scripts/setup-submodules.ts`                                         | every gitlink at its pin                     |
| 2     | Workspace: Rust crates, Bun packages, WASM                   | `Cargo.lock`, `bun.lock`                                                  | `cargo check --workspace --locked`, `bun check`, `bun lint`, `bun format` | presubmit (sync gate, `vps-gate/*`)          |
| 3     | Packages: COSMIC forks, Rust base, native apps as `.deb`     | fork pins, `factory/rustbase/forks.json`                                  | `factory/native-apps/build.ts`, `bun factory/rustbase/rust-base.ts all`   | each deb builds and installs in a clean root |
| 4     | Image: unified rootfs, session container, disk image and ISO | `factory/images/manifest.json`, the stage 3 debs                          | `bun factory/images/build.ts bunos-unified --target session` / `unified`  | image plan resolves; payload verified        |
| 5     | Qualification: boot, session, Android, screenshots           | the stage 4 image                                                         | nightly (`bunos-auto-nightly.timer`), `container/qualify-image.ts`        | qualified receipt with screenshots           |

A stage never reaches back: a stage 4 image consumes stage 3 debs, not a cargo target directory.

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
