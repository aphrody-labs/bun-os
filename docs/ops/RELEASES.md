# Releases, versions and LTS

Bun OS ships three kinds of artifacts, each with the versioning its upstream community uses:

| Artifact                          | Scheme                          | Modelled on                                                                |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| The OS image (ISO, disk, session) | `YY.MM` + point releases        | Ubuntu / Pop!_OS calendar releases, COSMIC epochs, LFS dated book releases |
| Kernel `linux-bun`                | upstream kernel version         | kernel.org mainline, stable and longterm                                   |
| Crates and npm packages           | SemVer 2.0, one workspace train | Rust's release train and Cargo SemVer; one version per dependency (Google) |

The machine-readable policy is [`infra/releases/policy.toml`](../../infra/releases/policy.toml); release tooling reads
it, so this page and the tools cannot disagree.

## Channels

| Channel  | What it is                                                      | Cadence                         | Support                                                 | Upstream analogue                   |
| -------- | --------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `edge`   | every green commit of `main` that passed presubmit              | continuous                      | none; replaced by the next build                        | kernel mainline `-rc`, Rust nightly |
| `beta`   | release candidate of the next `YY.MM`: `YY.MM-rcN`              | weekly during the 4-week freeze | until the release                                       | kernel `-rcN`, Rust beta            |
| `stable` | `YY.MM.P`, released in April and October                        | point release every 4 weeks     | until the next stable + 1 month                         | kernel stable, Pop!_OS interim      |
| `lts`    | the April release of even years (`26.04 LTS`, `28.04 LTS`, ...) | point release every 4 weeks     | 5 years (fixes), first 2 years with hardware enablement | Ubuntu/Pop!_OS LTS, kernel longterm |

Rules, taken from the kernel's [stable rules](https://docs.kernel.org/process/stable-kernel-rules.html):

- **Upstream first.** A fix lands on `main` first and is then backported to `stable/YY.MM` or `lts/YY.MM` with the
  upstream commit id in the message (`commit <sha> upstream.`). Nothing exists only on a release branch.
- **Backports are small and fix real bugs** (security, data loss, crash, regression, new hardware ids). No features,
  no refactors, no dependency bumps beyond security fixes.
- **No regressions.** A point release is the previous one plus backports; it passes the full stage 5 qualification
  ([BUILD.md](BUILD.md)) before publication.

Branches: `main` (edge), `stable/YY.MM` and `lts/YY.MM`, cut at the end of the freeze. AGENTS.md keeps `main` as the
only development branch; release branches only receive backports through the release tooling.

## The release cycle (six months, like the kernel merge window plus rc)

1. **Development** on `main`, about 20 weeks. New upstream pins (COSMIC epoch, Ubuntu base, Android, Bun canary)
   land here.
2. **Freeze**, 4 weeks before the release: `YY.MM-rc1` is cut; only fixes land on `main` for that release; one `rcN`
   per week (Linus Torvalds' rc cadence).
3. **Release** `YY.MM.0`: signed ISO, disk image and checksums on `aphrody.com/downloads`, release notes generated
   from the commit log, tag `vYY.MM.0`.
4. **Maintenance**: point releases `YY.MM.P` every 4 weeks or immediately for a security fix.

## Kernel

`linux-bun` follows kernel.org exactly: an LTS image ships the current [longterm](https://www.kernel.org/category/releases.html)
series (the last mainline release of the previous year), stable images ship the newest stable series. Patches are
kept as a quilt-style series on top of the upstream tag, never as a fork that drifts; each one is either upstream,
sent upstream, or documented as Bun OS specific.

## Crates and npm packages

- One workspace version for all first-party crates and packages (`[workspace.package] version` in `Cargo.toml`,
  `version` in the root `package.json`), today `1.4.7`. SemVer 2.0: breaking API change = major, feature = minor,
  fix = patch. `cargo semver-checks` gates crate releases.
- Pre-1.0 forks of upstream projects keep their upstream version plus a `+bunos.N` build suffix; they are not
  published under the upstream name.
- MSRV is the toolchain in `rust-toolchain.toml`; editions follow Rust's three-year cadence, migrated with
  `cargo fix --edition` on `main`.
- Publication: crates.io (`cargo publish --workspace` in dependency order) and npm (`bun publish`) under the
  `aphrody` / `@aphrody` names, from the release tooling only, with provenance; never from a workstation.

## Version strings

- Image: `/etc/os-release` carries `VERSION_ID="26.04"`, `VERSION="26.04 LTS (Bun OS)"`, `BUILD_ID=<commit>`;
  `edge` builds use `VERSION_ID="26.10~edge"` and `BUILD_ID=<date>.<commit>`.
- Every binary reports `<version> (<commit> <date>)` with `--version`; every HTTP service reports the same in
  `GET /api/health` (`version`, `commit`, `channel`).
