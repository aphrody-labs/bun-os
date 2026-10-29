# VPS build and recovery

The VPS (12 cores, 45 GB RAM) is the build machine of Bun OS; the Windows workstation edits and synchronises. This page holds the
full-build recipe (one tmux session) and the recovery steps for the incident of 2026-10-29. The recipe and the sync installer were
written while the VPS was unreachable: **nothing here has been run on the VPS yet**. Verify each command on first use.

## Recovery after the /home btrfs incident (2026-10-29)

Symptom: `/home` (btrfs) went read-only after a metadata ENOSPC, and sshd refused every key (`Permission denied (publickey)`),
including from `dbfr`. These steps need the owner's console (provider rescue or serial console); they are not scripted and
no session may run them remotely.

1. From the console, as root, look before touching anything: `dmesg | grep -i btrfs | tail`, `btrfs filesystem usage /home`,
   `btrfs device stats /home`.
2. Remount read-write: `mount -o remount,rw /home`. If it refuses, `umount /home`, then `btrfs check --readonly <device>` (read
   only) and decide from its output; do not run `--repair` without a snapshot or a copy.
3. Give metadata room, cheapest first: `btrfs balance start -dusage=5 /home` (compacts nearly empty data chunks so they can become
   metadata chunks), then `-dusage=20` if needed. Check progress with `btrfs balance status /home`.
4. Free space (check each path before deleting; a forgotten build tree is the usual culprit):
   - `~/bunos` (old checkout) once its commits are on `origin/main`;
   - `~/build/purge-rust`, and the other `~/build/purge-*` trees;
   - `docker system prune -af --volumes` (only if no container holds data you need: `docker ps -a` first);
   - cargo targets under `~/build` (`cargo clean` per tree), `~/.cache` and `~/build/google/cache` if they are over budget.
5. Confirm `touch ~/x && rm ~/x`, then `df -h /home` (aim for more than 20 % free and `btrfs filesystem usage` showing unallocated
   space for metadata).
6. sshd: check `journalctl -u ssh -n 50`, the permissions of `~/.ssh` (0700) and `~/.ssh/authorized_keys` (0600, owner = user),
   and that `/home/<user>` is not group-writable (StrictModes). Fix by console, then test from the workstation.
7. Once SSH is back, install the sync (below) and rerun the full build.

Keep a quota: `btrfs quota` is off by default; at least keep `ncdu`/`btrfs filesystem du -s ~/build/*` in the weekly routine.

## Auto-sync (systemd user timer or tmux loop)

```bash
git clone --filter=blob:none https://github.com/aphrody-labs/bun-os.git ~/src/bun-os   # skip if it exists
bash ~/src/bun-os/factory/sync/vps-install.sh            # systemd --user timer, falls back to a tmux loop
bash ~/src/bun-os/factory/sync/vps-install.sh --tmux     # force the tmux loop
bash ~/src/bun-os/factory/sync/vps-install.sh --uninstall
cat ~/.local/state/bunos-sync/status.json                # outcome of the last pass
```

`factory/sync/bunos-sync.ts` fast-forwards the checkout to `origin/main`, pushes local commits on `main` with a normal push, and
refuses (exit 2, written to the status file) when the tree is dirty or diverged. Credentials: HTTPS through
`gh auth git-credential`; the token lives in the `gh` configuration only. The installer refuses to run on a read-only `/home` or
with less than 5 GiB free. See [SYNC.md](SYNC.md) for the whole loop (workstation, GitHub, VPS).

## Full build in tmux (session `bunos`)

One session, six windows, a summary writer. Heavy work goes through the factory slots so two builds never collide
(`bun factory run -- <command>` takes a free slot; `bun factory slots` lists them). CPU budget: 12 cores; keep
`CARGO_BUILD_JOBS=8` for the Rust windows and leave 4 cores for bun, wasm and docker.

```bash
SRC=~/src/bun-os; OUT=~/build/out/bun-os; mkdir -p "$OUT"
cd "$SRC" && git pull --ff-only origin main && git submodule update --init --depth 1 --recommend-shallow   # profile "ci" is enough for the Rust gates
export CARGO_BUILD_JOBS=8 CARGO_TERM_COLOR=never

tmux new-session -d -s bunos -n build-rust -c "$SRC" \
  "bun packages/buncc/src/cli.ts exec -- build --workspace --locked --keep-going 2>&1 | tee $OUT/build-rust.log; echo exit=\${PIPESTATUS[0]} > $OUT/build-rust.exit"
tmux new-window -t bunos -n test-rust -c "$SRC" \
  "bun packages/buncc/src/cli.ts exec -- test --workspace --locked --no-fail-fast 2>&1 | tee $OUT/test-rust.log; echo exit=\${PIPESTATUS[0]} > $OUT/test-rust.exit"
tmux new-window -t bunos -n bun -c "$SRC" \
  "bun install --frozen-lockfile --ignore-scripts && bun run check && bun run lint && bun run format:check 2>&1 | tee $OUT/bun.log; echo exit=\${PIPESTATUS[0]} > $OUT/bun.exit"
tmux new-window -t bunos -n wasm -c "$SRC" \
  "bun packages/buncc/src/cli.ts exec -- build -p aphrody-webos-wasm --target wasm32-unknown-unknown --locked 2>&1 | tee $OUT/wasm.log; echo exit=\${PIPESTATUS[0]} > $OUT/wasm.exit"
tmux new-window -t bunos -n docker -c "$SRC" \
  "just test-distro 2>&1 | tee $OUT/docker.log; echo exit=\${PIPESTATUS[0]} > $OUT/docker.exit"
tmux new-window -t bunos -n watch -c "$SRC" \
  "watch -n 30 'df -h /home | tail -1; free -g | sed -n 2p; uptime; for f in $OUT/*.exit; do echo \$f: \$(cat \$f); done'"
```

The commands per window mirror the CI jobs (`.github/workflows/ci.yml`: quality, rust, `just test-distro`); if a window fails
for a missing flag, take the exact line from the CI job, which is the reference. The `docker` window assumes the Docker daemon
is up and `/var/lib/docker` is on a volume with space.

Summary writer (run in any pane, or from cron after the windows end):

```bash
{
  echo "# bunos full build $(date -u +%FT%TZ) @ $(git -C $SRC rev-parse --short HEAD)"
  for w in build-rust test-rust bun wasm docker; do
    printf '%-12s %s\n' "$w" "$(cat $OUT/$w.exit 2>/dev/null || echo running/missing)"
  done
  echo; echo "## first errors"; grep -hE '^(error|FAIL|✗)' $OUT/*.log | head -40
} | tee $OUT/summary.md
```

Rules: never delete `$OUT` while a window runs; free `~/build` trees after each lot (the disk is btrfs: keep more than 20 % free);
do not start the Docker window when `df -h /home` shows less than 30 GB free.
