> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody in a container

The `runtime` image installs the published Aphrody and Yolo Linux artifacts with the existing SHA-256-verifying
installer. It has no repository checkout, workspace `node_modules`, Bun/uv developer toolchain, or Rust build tools.
The `dev` image keeps the source workspace and adds Bun, uv, Rust and build tools. Toolchains are installed
before the checkout/dependency layer, so code changes reuse them. The `wasm-toolchain` target installs both
Rust WASM targets, `wasm-bindgen-cli` matching `Cargo.lock`, `wasm-pack`, and Binaryen 132 (`wasm-opt -Oz`).
It selects checksum-verified AMD64 or ARM64 prebuilt tools without compiling cargo-binstall. `wasm-artifacts`
compiles and exports the portable command package without installing Bun workspace or Python ML dependencies.
The opt-in `release-builder` adds the frozen Bun workspace and every locked Python workspace dependency.
The separate Ubuntu desktop image supplies GTK4/CEF build or runtime libraries; the Alpine/COSMIC
image stays independent of GNU binaries.

| File                                                                                                  | Role                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [tools/config/container/Dockerfile](../../../../tools/aphrody/config/container/Dockerfile)                       | `runtime`, `dev`, `wasm-toolchain`, portable `wasm-artifacts`, and full `release-builder` |
| [tools/config/container/build/Dockerfile](../../../../tools/aphrody/config/container/build/Dockerfile)           | `aphrody-build`: the VPS build image (see below)            |
| [tools/config/container/desktop/Dockerfile](../../../../tools/aphrody/config/container/desktop/Dockerfile)       | Ubuntu GTK4/CEF builder and non-root desktop runtime                                      |
| [tools/config/container/aphrody-os/Dockerfile](../../../../tools/aphrody/config/container/aphrody-os/Dockerfile) | Alpine musl Bun runtime, CLI userland, and COSMIC desktop                                 |
| [tools/config/container/entrypoint.sh](../../../../tools/aphrody/config/container/entrypoint.sh)                 | Selects `mcp`, `api`, `yolo`, `aphrody` or `shell`                                        |
| [tools/config/container/compose.yaml](../../../../tools/aphrody/config/container/compose.yaml)                   | Loopback-only API, stdio MCP, developer shell, and release builder                        |
| [.devcontainer/devcontainer.json](../../devcontainer/devcontainer.json)                           | VS Code dev container on the `dev` target                                                 |
| [.dockerignore](../../.dockerignore)                                                               | Excludes caches, outputs, coordination state and protected data                           |

## Run

```sh
docker build -f tools/config/container/Dockerfile --target runtime -t aphrody:runtime .
docker run --rm aphrody:runtime aphrody --version
docker run --rm -i aphrody:runtime mcp
YOLO_API_TOKEN=<secret> docker compose -f tools/config/container/compose.yaml up --build api

docker compose -f tools/config/container/compose.yaml run --rm dev
# inside the source container:
scripts/build/rust/cargo-serial.sh check --locked -p <crate>

# Complete Rust/Bun/Python release toolchain, with all locked Python workspace dependencies
docker compose -f tools/config/container/compose.yaml --profile release run --rm release-builder
# inside: cd packages/infra/cli-wasm && bun run build:wasm

# Export the browser/Bun module, JS glue and TypeScript declarations.
docker buildx build -f tools/config/container/Dockerfile --target wasm-artifacts \
  --output type=local,dest=dist/container-wasm .

# Rebuild from an explicit immutable download release instead of resolving latest.
docker build -f tools/config/container/Dockerfile --target runtime \
  --build-arg APHRODY_RELEASE=<release-id> -t aphrody:runtime .
```

The Ubuntu GTK4/CEF app environment is built separately because its native desktop libraries do not belong in the
compact API/MCP runtime:

```sh
docker build -f tools/config/container/desktop/Dockerfile --target builder -t aphrody:desktop-builder .
docker build -f tools/config/container/desktop/Dockerfile --target runtime -t aphrody:desktop-runtime .
```

`aphrody:desktop-runtime` supplies application/UI libraries for host X11/Wayland display forwarding; it does not
start a virtual desktop or fetch the CEF bundle. See the desktop README for launch wiring. WASM artifacts use the
explicit optimizer feature set of `bun:wasm` (aphrody-labs/bun, called by `scripts/build/rust/wasm-package.ts`), which keeps generated glue
compatible with Bun's JavaScriptCore and browser engines.

## VPS build image (`aphrody-build`)

One build image serves the VPS factory:
[tools/config/container/build/Dockerfile](../../../../tools/aphrody/config/container/build/Dockerfile), driven by
[scripts/build/container/aphrody-build.ts](../../../../scripts/aphrody/build/container/aphrody-build.ts). Its build context is that
directory only: no checkout, env file or secret enters the image.

| Content             | Source of the pin                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Rust                | `rust-toolchain.toml`: channel plus every target (Linux, Windows MSVC, wasm32, Apple) and component                 |
| `wasm-bindgen-cli`  | `Cargo.lock` (`wasm-bindgen`), prebuilt through checksum-pinned cargo-binstall                                      |
| Bun / uv            | `package.json#packageManager` / Dockerfile `UV_VERSION`                                                             |
| sccache, cargo-xwin | Dockerfile `SCCACHE_VERSION` / `CARGO_XWIN_VERSION` (same versions as the VPS host)                                 |
| Native              | Ubuntu 26.04 LTS (glibc 2.43): clang/lld/llvm 22 (`clang-cl`, `lld-link`, `llvm-lib`), mold 2.40, cmake 4.2, nasm 3 |

It covers `aws-lc-sys` (cmake, clang, nasm), the WireGuard crates (`defguard_wireguard_rs` netlink and boringtun are
pure Rust), remote desktop/VNC (`rustvncserver`, `vnc-rs`, `x11rb` and `jpeg-encoder` are pure Rust), Windows MSVC
cross builds such as `aphrody-mcp --features winclean` through `cargo xwin` (the MSVC CRT/SDK download is cached in
a volume), Dragon Pixel and Koharu wasm32 and Bun builds. Linux links use clang + mold.

Base choice (2026-10-09): Ubuntu 26.04 LTS has the newest glibc of the candidates checked on the VPS (2.43; Fedora 43
2.42, Debian 13 2.41) and is the OS of both deployment hosts (vps, dbfr), so artifacts built here run there
natively; a binary linked against glibc 2.43 does not run on older distributions. The MSVC STL that cargo-xwin
fetches requires clang-cl 19 or newer; Windows C/C++ is compiled for x86-64-v2 (`-msse4.2 -mpopcnt`, the Windows 11
24H2 baseline) because clang-cl needs the ISA enabled for SSE4.1 intrinsics. `CMAKE_POLICY_VERSION_MINIMUM=3.5` keeps
vendored CMake projects that predate CMake 4 building. Private GitHub dependencies authenticate through the image's system credential helper with `APHRODY_GIT_TOKEN`, which
`run` resolves from the caller (`APHRODY_GIT_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token`) and passes by
name only.

```sh
bun scripts/build/container/aphrody-build.ts image      # aphrody-build:<rust>-bun<bun>-<sha9> and :latest
bun scripts/build/container/aphrody-build.ts run -- scripts/build/rust/cargo-serial.sh check --locked -p aphrody-wireguard
bun scripts/build/container/aphrody-build.ts run --target-volume aphrody -- cargo xwin check --target x86_64-pc-windows-msvc -p aphrody-mcp --features winclean
```

Run contract:

- The checkout is bind mounted at its own absolute path; the process runs as the caller's uid/gid plus the shared
  `aphrody-build` group (gid 1500) with umask 002, `--cap-drop ALL`, `no-new-privileges` and `--init`.
- Caches are named volumes on the system disk (the release disk is nearly full): `aphrody-build-cargo` (registry and git),
  `-sccache` (local disk, 20 GiB cap), `-bun`, `-xwin`, `-xdg`. Volume roots are setgid and group writable, so
  `ubuntu` (releases) and the runner user share them. `--target-volume NAME` moves `CARGO_TARGET_DIR` to
  `aphrody-build-target-NAME` for checkouts that CI cleans between jobs.
- Limits: `--cpus` 6 (`APHRODY_BUILD_CPUS`, at most 6), `--memory` 16g without swap (`APHRODY_BUILD_MEMORY`),
  `--cpu-shares 512`, `--pids-limit 8192` and `--oom-score-adj 500`, so earlyoom and the kernel kill a build before
  the llama-server services. `CARGO_BUILD_JOBS=6`, `CARGO_INCREMENTAL=0`, `RUSTC_WRAPPER=sccache`.
- The factory heavy lock `/home/ubuntu/build/locks/heavy.lock` wraps the run when it exists (`--no-lock` only when
  the caller already holds it). `--env NAME` passes a secret by name; its value never reaches argv or the image.
- `--host-network` is opt-in, for loopback services such as the PostgreSQL tunnel.

## WASM, browser and native FFI

The release builder covers the repository's existing Rust-to-WASM package path (`wasm32-unknown-unknown` plus
`wasm32-wasip1`); it does not compile Bun itself to WASM. The browser bundle is a separate output: use Bun's browser
target and ship the generated JS/WASM module with the application. A native `bun:ffi` library follows the host C ABI
and cannot be loaded by a browser or WASI module. Share Rust logic across targets and expose separate host adapters
(native C ABI/Node-API for Bun, generated WASM bindings for browser or WASI), with explicit ownership and error
contracts.

`container2wasm` wraps a Linux image in an emulated machine and is a compatibility/testing route, not the default
for small Aphrody services. New portable services should compile directly to a supported WASI target. WASI Preview 1
does not provide general networking; select the WASI version and host capabilities deliberately. Use x86 emulation
such as v86 only when browser-based hardware/OS compatibility is the goal.

`APHRODY_DOWNLOAD_URL` is a Docker build argument for a release mirror. The installer resolves `latest.json` once
(or uses `APHRODY_RELEASE`) and fetches checksums and artifacts under `/releases/<id>/`. It verifies archives before
activation and installs Yolo without its Rust scaffold sources. The GitHub workflow selects one release for the
whole matrix and exports the compiled WASM package as a workflow artifact. Pull requests and normal pushes build
without publication. A manual workflow dispatch with `publish=true` publishes revision-tagged images to
`ghcr.io/aphrody-labs/aphrody:<matrix-cache>-<git-sha>` using the job-scoped GitHub token. Its optional `release`
input selects and verifies an explicit existing immutable downloads release. No floating image tag or package
visibility change is performed; repository and package access remain authoritative. Registry publication still
requires a successful workflow run, and is not established by the workflow source or Actionlint.

The runtime runs as uid 1000, keeps `~/.aphrody` in a volume, and requires `YOLO_API_TOKEN` before binding the API to
`0.0.0.0`. Compose publishes the API on host loopback and drops capabilities. The `.dockerignore` excludes `.coord`,
`.codex`, `.git`, build outputs, local databases, model weights and credential files. Fetched `vendor/bun` and
`vendor/deno` trees are excluded; native engine source acquisition follows `tools/config/vendor.json`. Integrated sources
under `crates/` remain available. Python's venv lives outside `/app`, so mounting a checkout keeps it available.
Cargo target/registry/git, sccache and uv caches are mounted during builds and do not become image payloads.

## Current limits

- Docker CLI is absent in this WSL session; the factory runs Docker 29.1.3 and Buildx 0.30.1. The pinned runtime
  was built there and passed native CLI/Yolo/MCP launch, UID 1000 and missing-token checks. Podman 4.9.3 previously
  built the Alpine CLI and Ubuntu desktop runtime. Full release-builder and ARM64 builds remain to qualify.
- The published Aphrody and Yolo artifacts currently cover Linux x86_64; native ARM64 images require both artifacts
  for that target. The portable toolchain supports AMD64 and ARM64 tool downloads; the workflow declares both for
  the minimal Alpine runtime. Windows `yolo` and macOS native release artifacts remain unavailable.
- The separate Alpine/COSMIC image remains in `tools/config/container/aphrody-os`. CEF desktop, GPU drivers and model weights
  are not part of the compact CLI runtime image.
- The `dev` image uses the full checkout and installs workspace dependencies. It is intentionally separate from the
  compact runtime image.
- The `release-builder` image is a disposable build environment: Rust and Bun remain pinned to repository manifests,
  and the Python workspace syncs with `uv.lock`. Use repository release scripts and build factories for native engines;
  this image does not silently bypass them or publish artifacts.
- The stripped Aphrody runtime image measured 475,484,521 bytes in Podman versus 1,050,639,821 bytes for the first
  smoke-build iteration. This is a measured reduction against that initial image iteration, not a comparable
  before/after release benchmark or a claim that all builds or binaries are 50% smaller.
- On 2026-10-07 the new packaging script generated a valid, runnable 4,231,918-byte command WASM module from a
  checksum-fetched factory artifact (5,597,813 bytes before `wasm-opt`). Its SHA-256 is
  `8656c5295cae81b0123b87c69f0452f3311ee00846419c4f9f3c0ce08238d977`. This qualifies the packaging path; it does
  not establish a full-workspace Docker build or the target build-time reduction.

## Factory qualification — 2026-10-07

Docker 29.1.3 and Buildx 0.30.1 built `runtime` and exported `wasm-artifacts` on the VPS under the factory's
heavy-build and Cargo locks. The context was commit `41b54d557a84` with the Dockerfile's `cargo-binstall -V`
correction; the resulting Dockerfile SHA-256 was
`045b47e9426e27277d3f4dcf77d68cb5889c9f7f113e4130f5c398340ea90663`.

- Runtime used immutable downloads release `20261007T090053Z-41b54d557a84-assets-10b78047`. Its image digest was
  `sha256:e6ee5489b8853cd6802889afa09821349e0bd3545ca72f8780002f95cbf8b8dd`; Docker reported 199,902,869 bytes.
  This storage metric is not directly comparable with the earlier Podman size. An actual API health probe passed
  with a read-only root filesystem, dropped capabilities, `no-new-privileges`, and a read-only token file mount.
  The token value was absent from Docker's configured environment. Stop completed with exit 143 (SIGTERM).
- The Docker-built command module was 4,232,122 bytes after `wasm-opt -Oz`, from 5,598,005 bytes before optimization.
  Its SHA-256 was `c200ead00262f165d46539f4df7d48bfb6283a6bcd30296b71773ef2a24ba0df`. Instantiation under Bun,
  command help, JSON repair, HTML conversion using named input, invalid-input rejection, and 100 repeated calls passed.
  The four exported files were fetched through native SFTP and their SHA-256 hashes verified locally. The existing
  CLI-WASM, packaging, and entrypoint suites passed 26 tests with one native-parity test skipped.
  Browser execution and the rest of the native workspace still require their own qualification.
- GitHub Actions run `37598733049` did not start: its check annotation reports failed account payments or a spending
  limit. Factory builds above succeeded independently; no registry publication is established by that Actions run.

## Published one-click installers — 2026-10-07

Downloads release `20261007T092640Z-8081351f06e8-kits-e68aaa55` contains the nine inherited native/plugin artifacts
with unchanged hashes and four new installer artifacts built from clean commit `81cd80a3e8fdce199abae732a350578c0bc833bc`.
The publisher's existing immutable snapshot path now accepts qualified prebuilt stages:

```sh
bun scripts/release/publish-downloads.ts assets \
  --staged <setup-stage-directory> --staged <omar-stage-directory> \
  --staged-revision <full-build-commit>
```

It validates configured manifests, target, regular files, sizes, hashes and secret patterns, then preserves unrelated
artifacts and their build revision. New artifacts record their independent source revision. Installer scripts use
`latest.json`'s `assetChecksums`; `SHA256SUMS` continues to describe artifact payloads. Snapshot publication keeps
the existing reservation, checksum checks and atomic current-release selection.

All 13 host payload checksums, the four public installer hashes/sizes and six public asset hashes passed. Both
`aphrody.com` and `downloads.aphrody.com` link their Download Aphrody button to the immutable Setup EXE. Setup and
Omar passed PE32+/AMD64 checks and Wine 10 launch/version/simulation checks. These executables are unsigned;
execution on native Windows and the unavailable CEF desktop installer remain separate qualification items.

## Published container images — 2026-10-07

The existing organization package remains private. Authenticate through the existing GitHub account before pulling.

| Image                                                   | Immutable digest                                                          | Qualified scope                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ghcr.io/aphrody-labs/aphrody:runtime-81cd80a3e`        | `sha256:9584253e39340758b4efcb1d11e86aa48f165a3e045759f75bb4a600559c3031` | GNU x86_64 Aphrody/Yolo runtime; registry pull, API health, UID 1000, secret file and SIGTERM |
| `ghcr.io/aphrody-labs/aphrody:alpine-runtime-41b54d557` | `sha256:7506e634d1ab1acfadaaceb6a59d52629a02b62bd59ec1507c334816e7b55aad` | Official musl Bun 1.4.2 on AMD64 and ARM64; registry pulls, UID 1000, JS, WASM and SHA-256    |

The Alpine manifest retains both architecture images and their attestations. ARM64 ran through Ubuntu's QEMU 10.2.1;
existing LLVM/Python binfmt handlers were preserved. This qualifies the minimal Bun image; the Aphrody fork and Rust
CLI still need musl/ARM64 artifacts. Registry authentication used temporary private Docker configuration that was
removed after publication and smoke checks.

Compose reuses one runtime definition for API and MCP. `APHRODY_RELEASE` pins source builds; `APHRODY_RUNTIME_IMAGE`
selects a published image. To run the qualified GNU image without rebuilding, after preparing the private token:

```sh
bun scripts/tools/secrets/vault.ts runtime
APHRODY_RUNTIME_IMAGE=ghcr.io/aphrody-labs/aphrody@sha256:9584253e39340758b4efcb1d11e86aa48f165a3e045759f75bb4a600559c3031 \
  docker compose --env-file "$HOME/.aphrody/private/container-vault/compose.env" \
  -f tools/config/container/compose.yaml -f tools/config/container/compose.secrets.yaml up --no-build --pull always -d api
```

The mounted token stays outside the image and repository. Compose 2.40.3 validated the selected image/release,
read-only filesystem, init process, dropped capabilities, security option and loopback API port.

## Services (complete image, 2026-10-09)

One image, `aphrody:runtime` (verified Aphrody release artifacts only), runs as a service on each target through a
compose profile of [compose.yaml](../../../../tools/aphrody/config/container/compose.yaml). `aphrody-mcp http` refuses non-loopback
binds, so the entrypoint keeps it on the container loopback and `socat` exposes the port to the container interface;
every host publishes it on its own loopback. The bearer token (`APHRODY_MCP_HTTP_TOKEN`, 32 bytes or more) is never
baked into an image.

| Target             | Profile | Service                                                                                                                         | Token                                                       |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Owner PC (Windows) | `pc`    | scheduled task `\Aphrody\Container` ← `scripts/install/container-service.ts` (boot entry `Container`)                          | `~\.aphrody\private\aphrody_mcp_http_token`, generated once |
| Omar PC (Windows)  | `pc`    | same task, `APHRODY_PC=omar`, applied by Omar on his PC (his consent scope: services he authorizes)                              | his own private file                                        |
| dbfr (production)  | `prod`  | `~/apps/aphrody/compose.yaml`, included by the host project `~/apps/compose.yaml` (`restart: always`)                           | `/etc/aphrody/aphrody_mcp_http_token` (0400)                |
| vps (build, SSH)   | `build` | idle `aphrody-build` container of the host project `~/apps/compose.yaml`; builds enter by `ssh vps docker exec aphrody-build …` | none                                                        |

Release: `bun scripts/release/container-image.ts release --on vps --host dbfr` builds on the VPS from a minimal context
streamed over SSH (no checkout needed), loads the image on dbfr and retags `aphrody:runtime`; `--ref REGISTRY/NAME`
also pushes. `docker compose -f ~/apps/compose.yaml up -d prod` on dbfr activates a new image. Each host runs ONE compose
project (`aphrody`), versioned in `tools/config/host/apps/<host>/` and installed by
`bun scripts/tools/infra/host-apps.ts --host <host> --apply`; Docker restart policies replace the former systemd wrappers. PCs load it with
`ssh vps docker save aphrody:<tag> | gzip -1 | gunzip | docker load`, then `docker tag aphrody:<tag> aphrody:runtime`.
The installers retry transient download failures (`curl --retry-all-errors`).

## Docker plugin and MCP Toolkit (PC, verified 2026-10-09)

Docker publishes the official agent plugin `docker-skills` (marketplace `docker`, source `docker/skills`, 0.3.1:
skills for Dockerfile, Compose, Sandboxes, Docker Agent and destructive-operation guardrails; it ships no MCP server).

```sh
claude plugin marketplace add docker/skills && claude plugin install docker-skills@docker
codex plugin marketplace add docker/skills && codex plugin add docker-skills@docker
```

The tools come from the Docker MCP Toolkit profile `aphrody`, connected globally to both agents as `MCP_DOCKER`
(`docker mcp gateway run --profile aphrody`; `docker mcp client connect claude-code --global`, same for `codex`).
The exportable, secret-free definition is [mcp/aphrody-profile.yaml](../../../../tools/aphrody/config/container/mcp/aphrody-profile.yaml)
(`docker mcp profile import`). Servers: `fetch`, `context7`, `sequentialthinking`, `docker-docs`, `time` and
`github-official` restricted to its read-only tools (writes are disabled in the profile). The GitHub token lives only in the
Docker Desktop secret store (`docker mcp secret set github.personal_access_token`, stdin, no trailing newline).

`bun scripts/tools/docker-mcp-probe.ts` calls one real tool per server through the gateway and exits non-zero on failure.
Images must be pulled first (the gateway runs with `--pull never`).

Excluded on purpose: `node-code-sandbox` needs the Docker socket inside a third-party container (engine-root access);
`ast-grep` needs a host path mount; the `terminal_control` profile has missing paths and must not be opened on sensitive folders.

Docker Desktop settings (`%APPDATA%\Docker\settings-store.json`): `MemoryMiB` 16384 (host 32 GB). Model Runner needs
`%USERPROFILE%\.docker\bin\inference` populated from `C:\Program Files\Docker\Docker\resources\model-runner\bin` (Desktop does not
recreate it if deleted); then `docker model pull ai/smollm2 && docker model run ai/smollm2 "..."` works.
`ExposeDockerAPIOnTCP2375` is enabled: the daemon API on tcp/2375 is unauthenticated and unencrypted; keep it
loopback/firewalled to trusted peers.

Hosts: dbfr and vps run Docker 29.1.3 with `live-restore` and the `local` log driver (20 MB x 5). The systemd units no
longer pass `--remove-orphans` (it removed same-project containers not in the active profile). Do not prune volumes: the
build caches and `aphrody-home` volumes are persistent; only `docker image prune` and `docker builder prune --filter until=168h`
are routine. Images are synchronised with `bun scripts/release/docker-sync.ts` (VPS is the source).
