# `aphrody-infra` orchestrator

The ownership tables below describe the former split-repository deployment
design. On 2026-10-02, the root production topology marked Aphrody Web and AI
planes retired; the active host observation found application releases on
VPS. Consult the dated VPS status,
topology observation,
and root `config/` catalogs before operational use. This page remains a
historical description of control-plane capabilities.

The current CLI is the `aphrody-infra` Rust binary in this monorepo. It owns
host/workflow operations and reads root `config/` catalogues; the Bun
`@aphrody/workspace` package exposes its `infra` bridge and an `orchestrate`
shortcut. It does not duplicate application code.

The catalog is the authority for one unit per workload. It covers Rust HTTP,
Bun/Next HTTP, Discord bots, workers and PostgREST. Nginx is the single public
proxy. Systemd remains the host supervisor. `aphrody-infra service` is the
native lifecycle surface; deployment remains atomic and release-based through the Rust CLI and the per-stack adapters
(`scripts/atomic-deploy-{aphrody-stack,bundle}.sh`).

## Commands

```bash
aphrody-infra status --json
aphrody-infra doctor --json
aphrody-infra inventory --json
aphrody-infra dev-env --target linux-container-26.04
aphrody-infra sync --target windows-local
aphrody-infra deploy --target vps --stack bundle --release /home/ubuntu/apps/infra/bundles/<id>
aphrody-infra deploy --target vps --stack bundle --release /home/ubuntu/apps/infra/bundles/<id> --apply
aphrody-infra deploy --target vps --stack <stack> --release /home/ubuntu/apps/<stack>/releases/<id>
aphrody-infra service catalog
aphrody-infra service status --target local
```

Run the CLI from the monorepo root through
`scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- <args>` when a
Cargo build is required; direct `cargo run` bypasses the repository's shared
Cargo lock. Bun bridge/shortcut forms are
`yolo ops infra <args>` and
`yolo ops orchestrate <action> ...`.

Every invocation creates `var/runs/<timestamp>-<pid>/manifest.json` with the
scope, actions, outputs and final status. Status output keeps the catalog's
`sourceGeneratedAt` for provenance and adds a fresh `observedAtEpoch`; the
catalog timestamp is never treated as live state. Runtime claims require the live
adapters (`ssh`, `wsl.exe`, `systemctl`) to succeed. `sync` and `deploy` are
plan-only unless `--apply` is explicit; dirty worktrees are never reset.

The VPS deploy adapters are installed by `scripts/tools/install-vps-adapter.sh` as
`/usr/local/sbin/aphrody-infra-deploy-{aphrody,bundle}` (reviewed
copies of `scripts/release/atomic-deploy-aphrody-stack.sh`
and `atomic-deploy-bundle.sh`, with
`/usr/local/share/aphrody-infra/ADAPTER.json` recording the infra commit). Each
accepts only a release below its own root, verifies checksums and preconditions,
probes loopback and HTTPS routes and restores the previous `current` on failure
(`docs/operations/infra/IMMUTABLE-RELEASES.md`).

## Former split-repository ownership model

- `aphrody-ai`: AI agents, A2A, RAG, MCP (`dragonball.*` included) and E5; its listeners stay on loopback.
- `aphrody-web`: public site, Web API, BXC browser engine and render FFI.
- `aphrody-ui`: M3 design system, the agent console (`ui-dist`) and `@aphrody/bun`.
- `aphrody-os`: kernel, sandbox, services and WinClean (not deployed on the VPS).
- The separate `scripts/tools/infra/infra-status.ts` Bun monitor reports its implemented host checks and probes; lifecycle/status commands are native Rust. Neither is a full discovery of arbitrary host units.
- RG: RG services and the imported resource monitor.
- Niers: data/build checkout and service-specific assets.
- `aphrody-infra`: target matrix, run evidence, environment checks, SSH/Git
  routing and release orchestration.
