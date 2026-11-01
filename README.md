<div align="center">

# Bun OS

**A unified Bun OS image and WebOS session powered by Aphrody Bun.**

[Docs](docs/index.mdx) ·
[Quickstart](docs/quickstart.mdx) ·
[Factory](factory/README.md) ·
[Architecture](docs/architecture.md) ·
[Repository map](docs/REPOSITORY-MAP.md) ·
[Plan](PLAN.md)

[![CI](https://github.com/aphrody-labs/bun-os/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aphrody-labs/bun-os/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/bun-1.4.4--canary.20261028.1-black?logo=bun)](https://www.npmjs.com/package/bun/v/1.4.4-canary.20261028.1)
[![Rust](https://img.shields.io/badge/rust-nightly-orange?logo=rust)](rust-toolchain.toml)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue)](LICENSE)

</div>

Bun OS is a unified product image combining the Bun OS Rust base, Aphrody Bun,
COSMIC, ChromiumOS components, Android 17 and Gemini. It ships as a bootable
disk image and as the streamed WebOS session. This repository owns product
assembly and shared application sources under `apps/`, `crates/` and
`packages/`; Rust and Bun workspace membership still has nested boundaries and
exclusions. [`docs/PRODUCT.md`](docs/PRODUCT.md) is the product checklist and
[`docs/REPOSITORY-MAP.md`](docs/REPOSITORY-MAP.md) maps source owners, vendor,
submodules and Aphrody Search. The runtime and each image input are pinned in
the corresponding source lock and factory manifest.

## Editions

| Factory composition | Session value in `distribution.json` |
| ------------------- | ------------------------------------ |
| `server`            | `null`                               |
| `desktop`           | `cosmic-session`                     |
| `gaming`            | `gamescope`                          |

The manifest also declares `full` and `perf` profiles and five targets:
`linux-x64`, `linux-arm64`, `windows-x64`, `macos-arm64` and `wasm`. These are
configuration selectors, not claims of build or runtime support. Package
catalog inputs are under `factory/arch/`; APT configuration is maintained as a
separate compatibility path. See [`distribution.json`](distribution.json),
[`sources.lock.json`](sources.lock.json) and the relevant factory manifests.

## Quickstart

Requires the repository-selected Aphrody Bun runtime (see `AGENTS.md` for its
provenance check and installer), Git, the nightly Rust toolchain from
[`rust-toolchain.toml`](rust-toolchain.toml), and the native toolchain of each
target you build. A setup/plan command does not qualify a product image.

```bash
git clone https://github.com/aphrody-labs/bun-os.git bun-os
```

```bash
bun run setup
```

```bash
bun src/cli.ts build plan --profile full --target linux-x64
```

```bash
bun run factory --action plan --composition server --snapshot 2026-10-17
```

`setup` initializes declared submodules, prepares the local
`build/packages/material-web.tgz` archive and installs dependencies from the
root Bun lockfile. `bun run setup --plan` prints a source preflight without
installing. A successful plan does not establish that setup, builds or product
qualification will succeed.

## Repository

| Path                | Contents                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/`              | Factory CLI: plan, sources, stage, rootfs, image, msys2, graph, infra, ops                                                         |
| `factory/`          | Arch factory, compositions, `/usr` images, Ubuntu and MSYS2 compatibility                                                          |
| `crates/`           | Rust source; root Cargo membership and nested workspace boundaries are tracked separately                                          |
| `packages/`         | Bun packages; the root Bun manifest declares the workspace members                                                                 |
| `apps/`             | Desktop, web, CLI and Android application sources                                                                                  |
| `vendor/`           | Imported sources; inspect `sources.lock.json` and `.gitmodules` for declared pins                                                  |
| `package.json`      | Root Bun package metadata and workspace declarations; runtime provenance is checked against the selected executable and source pin |
| `infra/`            | Host, nginx, systemd and DNS desired state                                                                                         |
| `fonts/`, `assets/` | Shared fonts and app assets with their licenses                                                                                    |
| `docs/`             | Documentation site ([`docs/docs.json`](docs/docs.json))                                                                            |

## Products

| Product                       | Where                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| COSMIC desktop and Material 3 | `apps/desktop`, `packages/m3*`, `packages/app-ui`                                                      |
| Craft suite                   | `apps/*craft*`: PDF, CAD web, film, photo, vector, sound, word, deck, design, grid, light, effect, fig |
| Reverse engineering (`re`)    | `packages/re`, `crates/re` (`bunre`)                                                                   |
| IECODE and nie game tooling   | `crates/aphrody-nie-*`, `packages/inagle`, `apps/iecode-*`                                             |
| Aphrody agents, MCP and A2A   | `crates/aphrody-*`, `packages/a2a`, `packages/m3-mcp`                                                  |
| Android                       | `apps/bun-android`, `packages/bun-android`, `crates/android-native`                                    |

## Development

```bash
bun run check
```

```bash
bun run lint
```

```bash
bun fmt --check
```

```bash
bun scripts/cargo.ts check
```

Type checking, lint, format and migration use the Aphrody runtime's native
`bun check`, `bun lint`, `bun fmt` and `bun n2b`. Cargo runs through the
repository's supported lane wrapper. Build
outputs go to `build/` and `target/`, and installed binaries to `install/`.
The [contributor guide](AGENTS.md) and [CI](.github/workflows) define the gates.

## Documentation

- [Introduction](docs/index.mdx), [installation](docs/installation.mdx), [quickstart](docs/quickstart.mdx)
- [Architecture](docs/architecture.md) and [Arch distribution](docs/architecture/arch-distribution.md)
- [Architecture map](docs/ARCHITECTURE-MAP.md): every component with its owner, entry command, docs, CI job, pins and status (generated)
- [Factory](factory/README.md), [native targets](docs/NATIVE-TARGETS.md), [builds](docs/APP-BUILDS.md)
- [Reverse-engineering pipeline](docs/re-pipeline.md) and [fonts](docs/fonts.md)
- [Deployment control](docs/control-plane.md) and [qualification](docs/NATIVE-QUALIFICATION.md)

## License

First-party code is MIT ([`LICENSE`](LICENSE)) or Apache-2.0 ([`LICENSE-APACHE`](LICENSE-APACHE)),
as each manifest states. Imported and vendored projects keep their own licenses. See
[`ATTRIBUTION.md`](ATTRIBUTION.md) and [`docs/licenses`](docs/licenses).
