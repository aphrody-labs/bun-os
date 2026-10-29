<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Infra

Infrastructure authority for hosts, services, routes, toolchains and releases.
Application repositories retain business logic and data schemas.

| Source | Authority |
| --- | --- |
| `tools/config/service-catalog.json`, `yolo/tools/config/host/nginx/routes.json` | Workloads and routing |
| `tools/config/production-topology.json`, `scheduler-policy.json` | Placement and timers |
| `yolo/tools/config/host/inventory/targets.json`, dated inventory files | Targets and sanitized observations |
| `tools/config/application-contracts.json`, `local-ai.json` | Shared application/AI integration |
| `tools/config/pipeline.json` | Cross-repository delivery stages |
| `systemd/`, `nginx/`, `host/` | Reviewable host templates and policy |
| `crates/`, `scripts/` | Native control plane, SSH/Git/VPN/OVH and operational adapters |

The development Discord application is declared as an Infra-owned service at
`https://bot.aphrody.com`, bound to loopback port `4010` in the catalogue; DNS,
TLS, Nginx, systemd, immutable releases, and its external env file are managed
here. Its dated deployment observation and OAuth redirect registration are recorded in
[`docs/operations/infra/IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md) and
[`docs/PLAN.md` (not in repo)](../../plans/infra/PLAN.md). Reusable Discord code and upstream bot
architecture audits belong to the separate
[Aphrody Discord monorepo](https://github.com/aphrody-labs/aphrody).
Its Carbon profile login requests `identify`. Its separate bot installation
requests `bot applications.commands` and permission bitfield `8` for the
development guild; Discord-specific
scope/approval limits are documented in that repository's
[`docs/guides/discord/carbon-oauth.md`](../../guides/discord/carbon-oauth.md).

## Operations

Use the pinned Rust/Bun tools; Python checks use the sibling AI uv workspace.
Run `aphrody-infra --help` for current commands, or
`scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- --help` to build/run
the checkout version through the shared lock. `doctor --strict`
checks the pinned Rust/Bun/uv toolchains, the installed Aphrody CLI set, the
Codex NHITL/plugin configuration and the local source-sync user unit without
reading secret values. `status`,
`validate`, `service`, `pipeline`, `deploy`, `ssh`, `git`, `vpn` and `ovh` share
the catalogues above. Mutation flags such as `--apply` remain explicit command
semantics; NHITL agents select them autonomously within the authorized task.

The current Infra CLI exposes bounded repository operations directly; do not
assume older root aliases such as `source:sync`, `github:audit`,
`workspace:workflow` or `crates:*` are present. The root manifest currently
declares `sources:sync` for pinned external source checkouts. Use
`aphrody-infra workspace-git-audit --help` for the catalogued local/GitHub
inventory, and `aphrody-infra maintenance --help` for scoped Cargo maintenance.
Maintenance mutations require a catalogued target and explicit `--apply`.

Examples (run the installed CLI, or invoke the checkout version through
`scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- <args>`):

```bash
aphrody-infra workspace-git-audit --json
aphrody-infra maintenance scan --repo <catalogued-repo> --json
aphrody-infra maintenance update --repo <catalogued-repo> --apply --json
aphrody-infra quality lint --repo <catalogued-repo> --run --json
```

- [Open work](../../plans/infra/PLAN.md), [agent rules](../../reference/infra/AGENTS.md)
- [Aphrody Bun platform map and integration plan](../../reference/infra/APHRODY-BUN-PLATFORM.md)
- Aphrody Bun fork operations and pin
- [GitHub organization ownership and repository transfer](../../reference/infra/GITHUB-OWNERSHIP.md)
- [GitHub identity, CI, release and upstream automation plan](../../plans/infra/GITHUB-AUTONOMY-PLAN.md)
- `nu scripts/tools/workspace/scan-ui-crates.nu --skip-ui` (from any working directory; optional
  `--ui-root path`; `--skip-ui` never opens the UI repository or dependency targets into UI)
  compares first-party Aphrody crate names and Rust sources,
  and inventories workspace and crate-level path dependencies across first-party repos,
  workspace and crate-level Git dependencies, local/Git patches, Cargo.lock version multiplicity,
  Cargo packages and identical Rust files under vendor/third-party trees and local `patches`
  directories at any depth, plus their generated outputs (read-only).
  crates.io candidates only pass the static path, version and package `publish` checks; confirm
  an actual release, compatible API, license and target graph before migrating. The scan skips
  `.git`, `target`, `node_modules`, `dist`, `.bun-cache`, `.venv`, `venv`, `.tox` and `.nox` while
  locating vendor roots. Lockfile multiplicity is a triage signal; confirm active target
  reachability with `cargo tree -d` before consolidation.
- `nu scripts/tools/workspace/scan-ui-crates.nu --skip-ui` performs the read-only Rust
  dependency/source inventory without opening the separately owned UI checkout.
  Cargo maintenance is exposed by `aphrody-infra maintenance`; use `--help` for
  current action and repository constraints. The old `crates:scan`,
  `crates:update`, `crates:fix`, `crates:clean`, and `crates:build` aliases are
  not declared in the current package manifests.
- [Operations index](./ops/README.md), [VPS](./vps/README.md), [OVH](./ovh/README.md)
- [Shared automation migration](../../reference/infra/AUTOMATION-MIGRATION.md)
- [Authority map](../../reference/infra/UNIFIED-AGENT-CONTEXT.md), [repository layering](../../reference/infra/REPO-LAYERING.md)
- [Generated ecosystem](../../ecosystem/ECOSYSTEM.md), [CLI](../../ecosystem/CLI.md), [MCP](../../ecosystem/MCP-TOOLS.md)

Optional interactive developer tools are separate from server provisioning:
`nu scripts/dev/setup.nu --developer-cli` reports missing commands;
`nu scripts/dev/setup.nu --developer-cli --apply` installs prebuilt Rust CLI releases
and the declared Nu plugin binaries from crates.io, then registers those plugins
with the local Nu installation. The inventory is
`tools/config/developer-cli-tools.json`; none of these tools are workspace dependencies.

`aphrody-infra dev-env --local wsl --apply` and the root bootstrap install the
Rust development tools declared in `tools/config/system-packages.json` through
`cargo-binstall`. The set includes nextest, deny/audit/machete, expand/hack and
the optional cross-compilation frontends; they remain host tools, not workspace
dependencies.

Keep distribution systemd as host supervisor. Templates are not automatically
installed; a catalogue or old health report does not establish a live deployment.
Protect runtime data with the runbook's verified backup/rollback procedure and
exclude secrets from Git/logs. Never reset an active child checkout to build a bundle.

## Validation

Documentation-only: links/anchors and `git diff --check`. For implementation or
release tooling, use the relevant gates below; deployment additionally needs live probes.

```bash
bun run --filter @aphrody/workspace typecheck
bun run --filter @aphrody/workspace lint
bun run --filter @aphrody/workspace test
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- validate
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- pipeline --stage plan
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- service catalog
```

Deploy adapters (Linux or WSL, as root; systemd, Nginx, curl and Bun are stubbed):

There is no root `test:adapters` package script in the current manifest.
