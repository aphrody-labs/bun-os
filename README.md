<div align="center">

# Bun OS

**An Arch-based Linux distribution and product workspace built on the unmodified upstream Bun runtime.**

[Docs](docs/index.mdx) ·
[Quickstart](docs/quickstart.mdx) ·
[Factory](factory/README.md) ·
[Architecture](docs/architecture.md) ·
[Plan](PLAN.md)

[![CI](https://github.com/aphrody-labs/bun-os/actions/workflows/ci.yml/badge.svg?branch=os)](https://github.com/aphrody-labs/bun-os/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/bun-1.4.4--canary.20261028.1-black?logo=bun)](https://www.npmjs.com/package/bun/v/1.4.4-canary.20261028.1)
[![Rust](https://img.shields.io/badge/rust-nightly-orange?logo=rust)](rust-toolchain.toml)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue)](LICENSE)

</div>

Bun OS is the distribution workspace for an Arch-based system using the
[upstream Bun runtime](https://github.com/oven-sh/bun), pinned to the canary `bun@1.4.4-canary.20261028.1`. This repository
owns assembly and the root Bun workspace. Product sources live under `apps/`,
`crates/` and `packages/`, while Cargo ownership is still split by nested
workspace boundaries and excluded sources. The image factory uses
pacman/libalpm and runs from TypeScript. The planned compositions are COSMIC
Desktop and Gamescope Gaming, alongside Server.

## Editions

| Declared composition | Session value in `distribution.json` |
| -------------------- | ------------------------------------ |
| `server`             | `null`                               |
| `desktop`            | `cosmic-session`                     |
| `gaming`             | `gamescope`                           |

The manifest also declares `full` and `perf` profiles and five targets:
`linux-x64`, `linux-arm64`, `windows-x64`, `macos-arm64` and `wasm`. These are
configuration selectors, not claims of build or runtime support. Package
catalog inputs are under `factory/arch/`; APT configuration is maintained as a
separate compatibility path. See [`distribution.json`](distribution.json),
[`sources.lock.json`](sources.lock.json) and the relevant factory manifests.

## Quickstart

Requires the upstream Bun canary `1.4.4-canary.20261028.1` (`npm install -g bun@1.4.4-canary.20261028.1`; `bun --revision` prints `1.4.4-canary.1+11c367163`), Git, the nightly Rust toolchain from [`rust-toolchain.toml`](rust-toolchain.toml),
and the native toolchain of each target you build.

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

| Path                | Contents                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| `src/`              | Factory CLI: plan, sources, stage, rootfs, image, msys2, graph, infra, ops |
| `factory/`          | Arch factory, compositions, `/usr` images, Ubuntu and MSYS2 compatibility  |
| `crates/`            | Rust source; root Cargo membership and nested workspace boundaries are tracked separately |
| `packages/`          | Bun packages; the root Bun manifest declares the workspace members         |
| `apps/`              | Desktop, web, CLI and Android application sources                          |
| `vendor/`            | Imported sources; inspect `sources.lock.json` and `.gitmodules` for declared pins |
| `package.json`      | Pins the upstream Bun runtime (`bun@1.4.4-canary.20261028.1`, oven-sh/bun `11c367163a4b`) |
| `infra/`            | Host, nginx, systemd and DNS desired state                                 |
| `fonts/`, `assets/` | Shared fonts and app assets with their licenses                            |
| `docs/`             | Documentation site ([`docs/docs.json`](docs/docs.json))                    |

## Products

| Product                       | Where                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| COSMIC desktop and Material 3 | `apps/desktop`, `packages/m3*`, `packages/app-ui`                                                  |
| Craft suite                   | `apps/*craft*`: PDF, CAD web, film, photo, vector, sound, word, deck, design, grid, light, effect, fig |
| Reverse engineering (`re`)    | `packages/re`, `crates/re` (`bunre`)                                                               |
| IECODE and nie game tooling   | `crates/aphrody-nie-*`, `packages/inagle`, `apps/iecode-*`                                         |
| Aphrody agents, MCP and A2A   | `crates/aphrody-*`, `packages/a2a`, `packages/m3-mcp`                                              |
| Android                       | `apps/bun-android`, `packages/bun-android`, `crates/android-native`                                |

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

Type checking, lint and format use the upstream `bun check`, `bun lint` and
`bun fmt` (the fork-only n2b command no longer exists). Cargo runs through the serialized wrapper `scripts/cargo.ts`. Build
outputs go to `build/` and `target/`, and installed binaries to `install/`.
The [contributor guide](AGENTS.md) and [CI](.github/workflows) define the gates.

## Documentation

- [Introduction](docs/index.mdx), [installation](docs/installation.mdx), [quickstart](docs/quickstart.mdx)
- [Architecture](docs/architecture.md) and [Arch distribution](docs/architecture/arch-distribution.md)
- [Architecture map](docs/ARCHITECTURE-MAP.md): every component with its owner, entry command, docs, CI job, pins and status (generated)
- [Factory](factory/README.md), [native targets](docs/NATIVE-TARGETS.md), [builds](docs/builds.md)
- [Reverse-engineering pipeline](docs/re-pipeline.md) and [fonts](docs/fonts.md)
- [Deployment control](docs/control-plane.md) and [qualification](docs/qualification.md)

## License

First-party code is MIT ([`LICENSE`](LICENSE)) or Apache-2.0 ([`LICENSE-APACHE`](LICENSE-APACHE)),
as each manifest states. Imported and vendored projects keep their own licenses. See
[`ATTRIBUTION.md`](ATTRIBUTION.md) and [`docs/licenses`](docs/licenses).
