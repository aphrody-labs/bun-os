<!-- SPDX-License-Identifier: Apache-2.0 -->
# Cloud-ready setup, end to end

One procedure for GitHub, Claude Code cloud sessions, the two VPS (`vps`, `dbfr`) and WSL, with no human in the
loop. Applies to `aphrody-labs/{aphrody,vu,bun}`; Yolo ships from the aphrody monorepo.

## Per-repository hooks (committed, secret-free)

| Repository | `.claude/settings.json` SessionStart | Files |
| --- | --- | --- |
| aphrody | `session-start.sh` (pinned Bun, `bun install`, `cloud-setup.sh`), `cloud-ssh.sh`, `session-start.ts` | `.claude/hooks/`, `scripts/dev/` |
| vu | `cloud-setup.sh`, `cloud-ssh.sh`, `session-start.ts` | `scripts/dev/` |
| bun fork | `cloud-ssh.sh`, `session-start.ts` (builds go to the VPS factory) | `scripts/dev/` |

All hooks are idempotent, tolerant (exit 0) and do nothing outside a cloud session except `session-start.ts`, which
only prints local Git state and canonical repository guidance (`START-HERE.md`).
It does not contact SSH hosts or select a backlog item; the current request owns the scope.

## Cloud environment (claude.ai, environment settings)

Attach the four repositories (see [CONTEXT-HANDOFF.md](CONTEXT-HANDOFF.md)), then set these variables. They are
secrets: never commit them, never print them.

| Variable | Meaning |
| --- | --- |
| `APHRODY_SSH_KEY_B64` | base64 of a dedicated private key authorised on both VPS (and WSL if reachable) |
| `APHRODY_VPS_HOST`, `APHRODY_DBFR_HOST` | addresses of the two VPS |
| `APHRODY_SSH_USER` | login, default `ubuntu` |
| `APHRODY_WSL_HOST`, `APHRODY_WSL_PORT`, `APHRODY_WSL_USER` | optional: WSL reachable through a reverse tunnel or the private network ([PRIVATE-TUNNEL.md](../infra/PRIVATE-TUNNEL.md)) |
| `APHRODY_DOWNLOAD_BASE` | optional: `https://downloads.aphrody.com`, installs the released `aphrody` and `yolo` |
| `GH_TOKEN` | GitHub token for `gh` and HTTPS pushes (`cloud-ssh.sh` sets the identity and the credential helper) |

`cloud-ssh.sh` writes the `vps`, `dbfr` and `wsl` aliases in `~/.ssh/config` so `aphrody infra ssh exec --host <alias>`
and `ssh <alias>` work as on the owner machine.

## Work split

- Cloud (4 CPU, 15 GB): Bun, docs, scoped `-p <crate>` Cargo gates through `scripts/build/rust/cargo-serial.sh`.
- Heavy builds (full workspace, V8, Tauri, WebKit, the Bun fork, `vu` runtime artifacts): the VPS factory,
  `bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` from WSL or `aphrody infra ssh exec --host vps` from the cloud.
- WSL: no heavy Cargo (crashes WSL); `vps-cargo.ts`, `bootstrap.sh`, tmux tunnels `vps-tunnel`/`vps-cargo`.
- Host roles (2026-10-09): `vps` builds and develops Bun, Aphrody and their forks only (no desktop, local LLM or
  monitoring stack); production lives on `dbfr`. State and archives: [hosts-minimal-2026-10-09.md](../infra/hosts-minimal-2026-10-09.md).
- Hosts change only through Infra's catalog: plan before apply. Publication and `omar`/WireGuard apply are authorised (owner directive 2026-10-07);
  keep the plan-before-apply order and the data rules.

### Current factory budget and storage (2026-10-15)

Native Infra verified `vps` as `vps-203bea89`: 12 allocated CPUs, 45.93 GiB RAM.
The owner authorizes 12 build jobs and 12 linker threads. The factory declares
8 GiB memory reserve, 32 GiB disk reserve and 1 GiB available memory per job.
Every admitted build measures execution-host affinity, Linux `MemAvailable`
and free space on its actual cache and artifact filesystems after taking the
heavy and source locks. Generic Cargo defaults stay bounded by the host's
available CPUs; explicit job counts are no longer capped at six.

`/home/ubuntu/build/storage` is the shared artifact pool, with about 479 GiB
available at verification. Use its `cache`, `artifacts` and `transient`
directories for the Aphrody factory. The older `/home/ubuntu/src` and
`/home/ubuntu/build` filesystem had about 3 GiB free and can fill independently.
Reuse existing source checkouts, including `/home/ubuntu/src/bun`; the absent
`/home/ubuntu/builds/bun-os-factory/sources/bun` is not a build source.
Historical outputs and protected stores are preserved, not relocated by this
configuration update.

Native Infra verified `dbfr` as `vps-6732365f`: 6 CPUs and about 11.40 GiB RAM.
Its production allocation remains separate, with the configured three-job
ceiling and its own memory/disk admission. A factory refusal is retried only
after capacity changes; it does not authorize bypassing reserves.

Invoke `aphrody infra --root /home/ubuntu ssh exec --host vps|dbfr ...` from
`/home/ubuntu`. A command-scoped `APHRODY_INFRA_ROOT=/home/ubuntu` is equivalent.
The native owner in `crates/infra/infra/src/cli.rs` writes receipts below the
selected Infra root as `var/runs/<epoch>-<PID>`; working directory alone does
not pin that root. Do not export the override globally: the same root also
selects source catalogs for other Infra commands.

Verified on 2026-10-15 at 22:23 UTC with the installed CLI and one `hostname`
command: VPS identity was `vps-203bea89`, and the successful receipt was
`/home/ubuntu/var/runs/1792102996-1776829/manifest.json`. This qualifies the root
filesystem destination for SSH receipts; it does not relocate earlier runs.
At 22:25 UTC the same override also qualified native `ssh sftp` with a direct
listing of `/home/ubuntu/.bun/bin`, recorded successfully in
`/home/ubuntu/var/runs/1792103144-1785922/manifest.json`. No file content or
transfer was requested.
Recheck host identity and both filesystems before applying a plan. Coordinate
heavy work through
`/home/ubuntu/build/locks/heavy.lock`; no second heavy build is started here.

## Verify

`bun scripts/dev/cloud-doctor.ts` prints one line per check (Bun pin, Rust, uv, `aphrody`, `yolo`, SSH aliases, remote
reachability, push remote) and exits non-zero on a missing required item. Sessions sync through
[CLOUD-SYNC.md](CLOUD-SYNC.md).

## Automation in place (2026-10-07)

- GitHub: `bun scripts/ops/github-automation.ts [--org aphrody-labs] [--dry-run]` is idempotent; on every owned non-fork
  repository it enables delete-branch-on-merge, auto-merge, update-branch, Dependabot alerts and security updates.
  `.github/dependabot.yml` keeps the workflow actions current weekly.
- Hosts (`vps`, `dbfr`): `aphrody-selfheal.timer` (units in `tools/config/host/systemd/aphrody/`, installed on both)
  runs every 5 minutes: clears failed units whose file is gone, restarts failed `aphrody-*`, `nie-*`
  services, vacuums the journal and apt cache above 85 % disk.
  Unattended upgrades, certbot, log rotation and backup timers were already active.

## Browser automation (Aphrody Web, live sites)

Two browser surfaces, both loaded as deferred MCP tools (`ToolSearch select:...`):

- `claude-in-chrome` (extension in the owner Chrome, already signed in, so no cookie is ever copied into a session):
  `list_connected_browsers`, `tabs_context_mcp {createIfEmpty:true}`, `navigate`, `get_page_text`, `read_page`,
  `browser_batch` for several actions at once. Verified 2026-10-07: navigating to `https://aphrody.com` and reading the
  page text works.
- `chrome-devtools-mcp` plugin (`.claude/settings.json` `enabledPlugins`): console, network, performance and Lighthouse
  on the same sites.

Server-side crawling, extraction and mirroring stay with the Rust owner (`aphrody web`, skill `aphrody:aphrody-web`);
use the browser tools for pages that need a logged-in or interactive session. Session cookies and tokens are never
pasted into a chat, a file or a repository.
