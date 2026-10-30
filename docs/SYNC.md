# Synchronisation: local, GitHub, VPS

Owner decision of 2026-10-30: plain git and GitHub (`aphrody-labs/bun-os`, branch `main`) only. There is no self-hosted forge,
no Gitea runner and no `os` branch ceremony. Nothing is ever forced.

| Copy | Mechanism | Direction |
| --- | --- | --- |
| GitHub `aphrody-labs/bun-os`, branch `main` | source of truth, default and only branch | - |
| Locks and generated docs | `.github/workflows/regen-locks.yml` (Cargo.lock, bun.lock, component pins, architecture map) commits to `main` | runner -> main |
| Workstation `C:\bun-os` | Scheduled Task `BunOS-Sync` (every 10 min) runs `git pull --ff-only origin main` | main -> local |
| VPS `~/src/bun-os` | `factory/sync/bunos-sync.ts` via a systemd user timer or tmux loop | main <-> VPS (ff, push if ahead) |

Flow for any change: `git fetch origin`, fast-forward or merge `origin/main`, `git push origin HEAD:main` (normal push only).
Builds and qualification run on the VPS checkout; the workstation edits and synchronises sources.

## Workstation

```powershell
pwsh -File scripts/sync/install-local.ps1            # clone (blobless, sparse), register the task
pwsh -File scripts/sync/install-local.ps1 -Uninstall # remove the task, keep the clone
Get-ScheduledTask BunOS-Sync | Get-ScheduledTaskInfo # last run and result
Get-Content C:\bun-os\.git\bunos-sync.log -Tail 20   # why a pull was refused, if it was
```

The clone is light: no blobs until read, a sparse cone (docs, `.github`, `factory/bunos`, the sync scripts, manifests), no
submodules. Add paths with `git -C C:\bun-os sparse-checkout add <path>`. The task never commits, resets, stashes or pushes:
a dirty or diverged clone makes `git pull --ff-only` refuse, and the refusal is logged. Commit and push from the clone yourself
(`git push origin HEAD:main`, normal push only).

## GitHub

- `main` is the default and only branch. Workflows trigger on `branches: [main]`.
- The GitHub `os` ref is a stale leftover. It is not maintained or deleted by this tooling; ignore it.
- Pushes made by `GITHUB_TOKEN` (the lock regeneration commit) do not start new workflow runs, so they cannot loop.

## VPS

See [VPS-BUILD.md](VPS-BUILD.md) (installer, status file, build recipe, btrfs recovery). `bunos-sync.ts` fast-forwards
whatever branch is checked out when that is safe, and never touches a dirty or diverged tree.

## Branches

Long-lived `claude/wip-*` and `codex/*` branches were merged into `main` on 2026-10-29. They are not deleted by this tooling;
`git branch -r --merged origin/main` lists the ones that can be removed. `claude/wip-local-multikernel-stash` is an autostash
of an old state and was deliberately not merged.
