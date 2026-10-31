# Synchronisation: workstation, GitHub, VPS

GitHub `aphrody-labs/bun-os` on `main` is the source of truth. The workstation edits and pushes; the VPS synchronizes, builds, qualifies, and writes Cargo.lock when a manifest change requires it. Both automated sync modes use the same Bun implementation in `factory/sync/bunos-sync.ts`. Host environment variables, the Bun runtime, the MCP servers and the A2A client settings are documented in [ENVIRONMENT.md](ENVIRONMENT.md).

Install from the checkout to configure that checkout. `BUNOS_REPO` overrides the detected repository root; `BUNOS_SYNC_INTERVAL` sets the interval in seconds.

## Workstation

```powershell
bun factory/sync/install.ts
bun factory/sync/install.ts --uninstall
Get-ScheduledTask BunOS-Sync | Get-ScheduledTaskInfo
Get-Content "$HOME\.local\state\bunos-sync\status.json"
```

The installer registers a hidden Scheduled Task. It fetches `origin/main`, never pushes, and gives recently edited files a grace period. If the checkout is dirty or diverged beyond that period, sync saves a recoverable snapshot under `refs/wip/workstation/<timestamp>` before moving the checkout to `main`. Files larger than 64 MiB are left on disk and listed in the snapshot record. The snapshot location and outcome are recorded under the user's `.local/state/bunos-sync` directory.

## VPS

```sh
bun factory/sync/install.ts
bun factory/sync/install.ts --uninstall
systemctl --user status bunos-sync.timer bunos-sync.service
cat ~/.local/state/bunos-sync/status.json
```

The installer registers a persistent systemd user timer and configures the VPS role: synchronization, the single Cargo.lock writer, and the main gate. A clean checkout fast-forwards when behind and uses a normal push when ahead. Dirty, diverged, detached, or non-main states are snapshotted before recovery; no force push is used. The shared checkout is for synchronization and builds; source work belongs in a separate clone and is pushed to GitHub before the VPS syncs it.

## Recovery and safeguards

- Run `bun factory/sync/bunos-sync.ts --dry-run` to inspect the next decision without changing the checkout.
- Set `BUNOS_SYNC_HEAL=0` to report a dirty or divergent checkout without healing it.
- Recover a snapshot with `git switch -c recovery <refs/wip/<host>/<timestamp>>`, then review and cherry-pick or restore paths deliberately.
- The installer configures `.githooks` for matching clones under `~/work`; the pre-push hook runs the main gate. GitHub remains the only source of truth, and pushes are fast-forward only.

The status file contains the last result, source revisions, and any recovery ref. Do not infer deployment or release qualification from a successful synchronization pass.
