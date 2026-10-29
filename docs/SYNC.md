# Synchronisation: local, GitHub, VPS

Owner decision of 2026-10-29: Bun OS is not a production project, everything lives on `main` and the three copies converge
automatically. Nothing is ever forced.

| Copy | Mechanism | Direction |
| --- | --- | --- |
| GitHub `aphrody-labs/bun-os`, branch `main` | source of truth, default branch | - |
| GitHub branch `os` | `.github/workflows/sync-os-mirror.yml` fast-forwards it on every push to `main` | main -> os |
| Locks and generated docs | `.github/workflows/regen-locks.yml` (Cargo.lock, bun.lock, component pins, architecture map) commits to `main` | runner -> main |
| Workstation `C:\bun-os` | Scheduled Task `BunOS-Sync` (every 10 min) runs `git pull --ff-only origin main` | main -> local |
| VPS `~/src/bun-os` | `factory/sync/bunos-sync.ts` via a systemd user timer or tmux loop | main <-> VPS (ff, push if ahead) |

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

- `main` is the default branch. Workflows trigger on `branches: [main, os]`; the `os` mirror is fast-forward only.
- If `os` ever holds commits that `main` lacks, the mirror job opens (or updates) the issue "os mirror out of sync with main"
  instead of forcing. Merge `origin/os` into `main` to clear it.
- A fast-forward that changes `.github/workflows/*` is rejected for `GITHUB_TOKEN`. Create the repository secret `MIRROR_TOKEN`
  (a PAT of the owner with `repo` and `workflow` scopes) to let the mirror carry those changes; without it the mirror job raises
  the same issue with state `push-failed`.
- Pushes made by `GITHUB_TOKEN` (the lock regeneration commit, the mirror) do not start new workflow runs, so they cannot loop.

## VPS

See [VPS-BUILD.md](VPS-BUILD.md) (installer, status file, build recipe, btrfs recovery). Nothing is installed there until the
owner restores access.

## Branches

Long-lived `claude/wip-*` and `codex/*` branches were merged into `main` on 2026-10-29. They are not deleted by this tooling;
`git branch -r --merged origin/main` lists the ones that can be removed. `claude/wip-local-multikernel-stash` is an autostash
of an old state and was deliberately not merged.
