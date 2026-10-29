# Host-wide operations

Cross-repository and host-wide automation owned by this monorepo's Infra
workspace. Product services remain in their Rust, Bun or Python owners; their
declared units/routes are summarized in the root catalogues. Templates in this
repository are not automatically installed.

The Bun modules that serve multiple repositories are documented in
[shared automation migration](../../../reference/infra/AUTOMATION-MIGRATION.md).

| Path | Purpose | Formerly in |
| --- | --- | --- |
| `tools/config/host/aphrody-os/VPS-TUNING.md` (`90-aphrody-bun.conf`, package `aphrody-sysctl`) | Kernel memory tuning (`/etc/sysctl.d`) | `rg/infra/sysctl` |
| `tools/config/host/logrotate/rsyslog` | Daily system log rotation (`/etc/logrotate.d`) | `rg/infra/logrotate` |
| `iecode/config/rg/host/systemd/rg-zram-swap.service` | Compressed zram swap, main VPS | `rg/infra/systemd` |
| `tools/config/host/systemd/shared/nginx.service.d/*.conf` | nginx restart policy and CPU/IO priority | `rg/infra/systemd` |
| `systemd/rg-watchdog@.{service,timer}` (not in repo) + `iecode/scripts/rg/ops/rg-watchdog.sh` | Per-service HTTP/memory watchdog template | `rg` |
| `systemd/rg-infra-monitor.{service,timer}` (not in repo) + `scripts/tools/infra/infra-status.ts` | Bun status/check/plan monitor | Formerly split across `rg`, `aphrody` (`stack.ts`) |
| `systemd/rg-repo-sync.{service,timer}` (retired with the rg stack, ff7c957063; its Infra copy `scripts/ops/repo-sync.ts` (not in repo) was removed on 2026-10-05) | Explicit rg/nie Git sync, no autocommit — [REPO-SYNC.md](../../../reference/infra/ops/REPO-SYNC.md) | `rg` |
| `tools/config/host/systemd/aphrody/aphrody-source-sync.service` (not in repo) + `scripts/tools/workspace/source-sync.ts` | User service for first-party source fetch and fast-forward sync; preserves dirty and divergent worktrees | Aphrody development workstation |
| `scripts/nie/model-serve-prewarm.sh` (not in repo) | Historical prewarm helper for the retired NIE VPS service (:8790) | `nie/scripts/ops/` |
| `iecode/scripts/rg/assemble-vps-release.sh` | Next.js 16 standalone release assembler | `rg/scripts/ops/` |
| `crates/infra/infra/src/secrets/` + Infra CLI `secrets` commands | Sovereign AES-256-GCM GitOps secrets & leak audit | [Secret management](../../../reference/infra/SECRET-MANAGEMENT.md) |
| `tools/config/host/nginx/aphrody/` | `aphrody.com` vhost and includes | `aphrody/deploy/nginx`, `nie/deploy/nginx` |

The table is a migration map, not a live list of installed units. Compare every
unit with `tools/config/service-catalog.json` and a dated host observation before
changing it. Commands run from the Aphrody monorepo root unless a script states
otherwise. See [INFRA-UNIFICATION.md](../../../operations/infra/INFRA-UNIFICATION.md)
for the historical consolidation record.

Historical record: [secondary storage operations (August 2026)](../../../reference/infra/ops/stockage-secondaire.md).
