<!-- SPDX-License-Identifier: Apache-2.0 -->
# Infra repair: forge, Git, SSH and tools (2026-10-25)

Scope: Gitea forge on the VPS, Git remotes (forge, GitHub, GitLab), SSH hosts, workstation and
VPS build tools, and the read-only infra scripts. Measurements were taken at 05:20–05:55 UTC.

## Forge (Gitea 28.1.0, `aphrody-gitea`)

### Root cause

All SQLite writes in Gitea wait for one writer, and that writer was stuck in `fsync`.
The goroutine dump from `gitea manager processes --stacktraces` shows the lock holder in
`sqlite3PagerCommitPhaseOne → walFrames → unixSync → full_fsync`, with every other writer in
`sqliteDefaultBusyCallback`. The cause is the storage, not Gitea:

| Path | Filesystem / device | `dd bs=4k oflag=dsync` |
| --- | --- | --- |
| `~/apps/gitea/data/gitea` (holds `gitea.db`) | btrfs (zstd, CoW) on `sdb`, a **rotational** disk, `/home` | 5 writes in **83.7 s** (about 17 s per fsync) |
| `/var/tmp` | ext4 on `sda` (SSD), `/` | 20 writes in 0.05 s |

`sdb` was at 97 % utilization and the I/O pressure was `full avg60≈58 %`. Most of the reads came
from long-running `grep -r` scans started by other sessions over `/home/ubuntu/apps`, a tree
that includes the 24 GiB of Gitea repositories (PIDs 370119, 470164 and 625858, running for up
to an hour). This agent did not touch them because they belong to other sessions. The
`aphrody-git-mirrors` timer (8 parallel fetches every 5 minutes into `~/build/git-mirrors`)
also adds load on `/home`.

What breaks as a result: any single-row update waits up to `SQLITE_TIMEOUT` (60 s).
- `UPDATE public_key SET updated_unix` fails, so `gitea serv` stays alive about 60 s after
  `git-upload-pack` has finished. The client prints `Failed to update public key`, or the
  connection is closed by the remote host.
- Runner `UpdateTask` calls fail with `can't update runner status: context canceled`.
- Pull-mirror sync fails with `SQLITE_BUSY`.

### Applied

- The runner poll and report intervals, already written to `~/apps/gitea-runner/config.yaml`,
  were applied at 05:33:51Z by the idle-guarded script `/tmp/gitea-safe-restart.sh`. The script
  waits for no `GITEA-ACTIONS-TASK-*` container, stops the runner, runs a passive WAL
  checkpoint, restarts Gitea **once**, waits for `/api/healthz`, then starts the runner. No job
  was running when it acted.
- Documented options were added to `app.ini` (backup `app.ini.bak-2026-10-25`), following the
  docs.gitea.com config cheat sheet. The forge holds 433 pull mirrors and 15,931 synced
  releases, so these settings spread the mirror sync load:
  `[cron.update_mirrors] SCHEDULE=@every 30m, PULL_LIMIT=5`, `[mirror] DEFAULT_INTERVAL=24h`,
  `[cron.check_repo_stats] RUN_AT_START=false`, `[cron.archive_cleanup] RUN_AT_START=false`,
  `[cron.update_checker] ENABLED=false`.
- Both changes are recorded in the tracked sources:
  - `infra/config/host/apps/vps/gitea/compose.yaml`, as `GITEA__…` environment variables.
  - `infra/config/host/apps/vps/gitea-runner/config.yaml`, which now matches the deployed file.

### Verification from the workstation

- `git ls-remote origin` returns the refs (`os` = `ba1a7c65e0`). It still takes about 60 s,
  and the client may print `Failed to update public key`, because `gitea serv` waits on the
  slow fsync before it exits.
- `git push --dry-run origin os` gives `Everything up-to-date` in 31 s.
- The 30 s target is **not met** while `sdb` stays saturated. Applying the restart and the
  config did not change the fsync latency.

### Applied fix: SQLite and queues on the root SSD (05:48 UTC)

Applied at 05:48:26–05:48:50 UTC by `~/apps/gitea/move-db-to-ssd.sh` (log next to it) while no job ran.
`gitea.db`, its `-wal`/`-shm` and the LevelDB `queues` moved to `/var/lib/aphrody-gitea/db` (ext4 on
`sda`), mounted at `/data/gitea-db` with `GITEA__database__PATH` and `GITEA__queue__DATADIR`. The
originals stay in `~/apps/gitea/data/gitea/*.pre-ssd-2026-10-25` as the rollback. A dump taken
during a hung push showed the writer held by the `Stop actions zombie tasks` cron, whose
transaction waited on a LevelDB journal write behind a `btrfs_sync_log` fsync (thread in `D`).
After the move, `git push origin os:refs/heads/claude/forge-push-probe` and its `--delete` each
exit 0 in under 4 s from the workstation. The steps below record the procedure that was followed.

1. `sudo install -d -o 1000 -g 1000 /var/lib/aphrody-gitea-db`
2. Wait until no `GITEA-ACTIONS-TASK-*` container is running. Then run
   `docker stop aphrody-gitea-runner aphrody-gitea`.
3. Run these commands:
   ```sh
   sqlite3 ~/apps/gitea/data/gitea/gitea.db 'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;'
   cp -p ~/apps/gitea/data/gitea/gitea.db /var/lib/aphrody-gitea-db/
   ```
4. In the **deployed** `~/apps/gitea/compose.yaml`, add the volume
   `/var/lib/aphrody-gitea-db:/data/gitea-db` and the variable
   `GITEA__database__PATH: /data/gitea-db/gitea.db`. Then run
   `docker compose -f ~/apps/gitea/compose.yaml up -d gitea` followed by
   `docker start aphrody-gitea-runner`.
5. Verify `ls-remote` and pushes. Keep the old `gitea.db` as the rollback copy.

The deployed and tracked Gitea compose files differ: the tracked file also mounts
`native-storage-guard.sh` and the `aphrody-gitea-native-storage` volume. Do not run
`host-apps.ts --apply` for the VPS until they are reconciled.

### Durable fix: PostgreSQL (not executed)

1. Add a pinned `postgres` service (digest pin, like the other services) to
   `infra/config/host/apps/vps/gitea/compose.yaml`.
   - Put its data on the SSD (`/var/lib/aphrody-gitea-pg`). On `sdb` it would have the same
     fsync problem.
   - Put the password in the protected env store, not in Git.
2. Wait for the runner to be idle, then stop the runner. Dump the database without the
   repositories:
   ```sh
   docker exec -u git aphrody-gitea gitea dump --database postgres --skip-repository --skip-log --skip-attachment-data --file /data/gitea-pg-dump.zip
   ```
3. `docker stop aphrody-gitea`. Unzip the dump, then load `gitea-db.sql` with
   `psql -v ON_ERROR_STOP=1`.
4. Change the Gitea environment:
   - Set `GITEA__database__DB_TYPE=postgres`, `HOST=gitea-db:5432`, `NAME=gitea`,
     `USER=gitea` and `SSL_MODE=disable`.
   - Supply `PASSWD` from the secret env file.
   - Remove the `SQLITE_*` keys.
5. Start Gitea, run `gitea doctor check --all`, verify SSH `ls-remote`, a push and one Actions
   job, then start the runner. Keep `gitea.db` and the dump as the rollback.

## Git and GitHub

- `gh auth status`: `aphrody-dev` (active; scopes `repo`, `workflow`, `admin:org`, `gist`) and
  `aphrody-code`.
- `os` is at `ba1a7c65e0` on the workstation, the forge and GitHub `aphrody-labs/bun-os`. The
  three are in sync, so no fast-forward push was needed.
- `C:\src\bun-os` remotes:
  - `origin` = `git@bun-forge:aphrody-dev/bun-os.git`
  - `github` = `https://github.com/aphrody-labs/bun-os.git`
- `C:\src\bun-ui` has only `github` = `aphrody-labs/bun-ui` and no forge remote.
- The VPS `~/src/bun-os` remotes now point at `aphrody-labs/bun-os`; they pointed at
  `bun-distribution`, which redirects. Only the URLs changed: the shallow clone and its
  uncommitted edits were not touched.

### `aphrody-labs/bun-distribution` references

There are 120 tracked files. Updated here (link URLs only):
- `README.md`
- `docs/docs.json`, `docs/index.mdx`, `docs/installation.mdx`, `docs/quickstart.mdx`
- `docs/MONOREPO.md` (entry and decision 4)
- `infra/config/routes.catalog.json`
- `tools/aphrody/config/stack-training.json`
- the GitHub backends in `infra/config/host/apps/vps/bun-os-server.json`
- the usage text of `scripts/aphrody/audit/verify-google-pipeline.ts`

Left unchanged because they are repository identities checked by code, or forge mirror names,
and need a coordinated change:
- `infra/app-build.ts`, `infra/apps.json`, `infra/source-portal.json`, `infra/source-workspace.json`
- `infra/config/host/apps/vps/gitea/{aphrody-labs-mirrors,bun-os-repositories}.json`
- `scripts/aphrody/tools/infra/gitea-provision{,-remote}.ts`, `scripts/forge-transport.ts`
  (public forge mirror `aphrody-dev/bun-distribution`, which still exists)
- `crates/aphrody-infra/src/gitea.rs`, `container/*`, `factory/product-payload.ts`, `src/distribution.ts`, `src/workspace-manifests.ts`
- `docs/generated/component-inventory.json`, the PKGBUILDs, `Cargo.toml` and the crate/package
  `repository` fields, `tools/aphrody/config/commit-sync.json`

Also left unchanged because another session has uncommitted edits in them:
`docs/DEPLOYMENT-CONTROL.md`, `docs/control-plane.md`, `infra/config/service-catalog.json`.

Owned by the fork-alignment session: `vendor/sources.json` (and `.gitmodules` /
`sources.lock.json` if they contain the name).

## GitLab

No GitLab remote, instance or SSH host is configured for Aphrody. The only GitLab URL in the
repository is the freedesktop Mesa upstream.

`glab` status:
- Workstation: logged in as `aphrody-dev`.
- VPS: present, but its token sits in the locked Secret Service keyring and cannot be read
  over non-interactive SSH. This is harmless while GitLab is unused.

## SSH

BatchMode tests from the workstation:

| Host | Result |
| --- | --- |
| `vps` | OK |
| `bun-forge` | OK (authenticated as `aphrody-dev`, key `aphrody-owner-pc`) |
| `github.com` | OK (`aphrody-dev`) |
| `dbfr` / `shenron` | OK |
| `omar` | Timeout |

`omar` (10.200.77.10) is offline: its last WireGuard handshake was 4 h 25 min earlier, so the
problem is on the peer side and needs the owner. On the VPS, `github.com` authenticates as
`aphrody-code`.

The repo-local `.git/aphrody-forge/ssh-config` generated by `scripts/forge-transport.ts` works.
No known_hosts or alias changes were needed.

## Build tools

Workstation:
- `bun` 1.4.6 (`v1.4.6-canary.1 (169d8c5ea)`, `C:\Users\aphro\.bun\bin\bun.exe`).
- `bun agent-plugin doctor`: current, MCP OK.
- Rust: cargo nightly 1.100 (`nightly-2026-09-15` through `rust-toolchain.toml`), rustup 1.29.2.
- Git 2.55.0.windows.5.
- MSVC BuildTools 14.44 `link.exe` is present. No `link.exe` is on the PowerShell PATH since
  the shim was removed, which is correct: Cargo finds MSVC through vswhere. Git Bash resolves
  `/usr/bin/link.exe` (coreutils), as it always does.

VPS:
- `bun` 1.4.6.
- Rust: default cargo 1.98.1; `nightly-2026-09-15` is installed for the repository toolchain.
- Docker 29.7.2.
- Disk: `/` at 88 % (36 GB free); `/home` at 82 %.
- Docker reclaimable space: 24 GB of images, 23 GB of volumes, 5 GB of build cache.
- Failed user units: `bun-release-{linux,windows}-x64`, `depot-tools-update`,
  `shenron-auto-deploy`, `shenron-sync`.
- `sdc1` (305 GB) is device 2 of the `/home` btrfs (`btrfs filesystem show /home`), so its writes
  are `/home` writes. `sdb` and `sdc` each saturate at 250 IOPS, which looks like a provider cap.

## Infra scripts

- `check-infra.ts`: OK (`a2a-check`, `local-ai-env`, `infra-check`).
- `infra-status.ts` fixed:
  - repository root depth after the move to `scripts/aphrody/` (the catalog was not found);
  - crash on catalog entries without a systemd `unit`;
  - new `--host=<alias>` / `APHRODY_CATALOG_HOST` filter;
  - stale header and usage text.
  - On the VPS (`--host=vps`), the report is degraded. Most catalog units are not installed
    (`loaded:false`) and `shenron-mcp` is a duplicate id. This is catalog drift for the owner
    to reconcile.
- `host-apps.ts` fixed: the repository root depth and the container compose path
  (`tools/aphrody/config/container/compose.yaml`). The dry run now resolves every source.
- `gitea-provision.ts` (plan) runs.
- Stale `tools/config/container/...` paths remain in `scripts/aphrody/build/container/*` and
  `scripts/aphrody/release/container-image.ts`. They were not changed here.
