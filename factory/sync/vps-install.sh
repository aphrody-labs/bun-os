#!/usr/bin/env bash
# Installs the Bun OS auto-sync on the VPS (user level, no root): a systemd --user timer when a user bus exists,
# otherwise a tmux loop. Idempotent. NOT RUN by the session that wrote it (the VPS was down on 2026-10-29);
# run it by hand once access is restored and /home is healthy (docs/VPS-BUILD.md, "Recovery").
#
#   bash factory/sync/vps-install.sh [--tmux] [--uninstall]
set -euo pipefail

REPO="${BUNOS_REPO:-$HOME/src/bun-os}"
REMOTE="https://github.com/aphrody-labs/bun-os.git"
INTERVAL="${BUNOS_SYNC_INTERVAL:-600}"
UNIT_DIR="$HOME/.config/systemd/user"
mode=auto
for a in "$@"; do
  case "$a" in
    --tmux) mode=tmux ;;
    --uninstall) mode=uninstall ;;
    *) echo "unknown argument: $a" >&2; exit 64 ;;
  esac
done

if [ "$mode" = uninstall ]; then
  systemctl --user disable --now bunos-sync.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/bunos-sync.service" "$UNIT_DIR/bunos-sync.timer"
  systemctl --user daemon-reload 2>/dev/null || true
  tmux kill-session -t bunos-sync 2>/dev/null || true
  echo "bunos-sync removed (checkout $REPO kept)."
  exit 0
fi

# Refuse to start on a read-only or nearly full /home: that is the failure that took the VPS down (docs/VPS-BUILD.md).
if ! touch "$HOME/.bunos-sync-write-test" 2>/dev/null; then
  echo "$HOME is read-only: do the btrfs recovery first (docs/VPS-BUILD.md)." >&2
  exit 1
fi
rm -f "$HOME/.bunos-sync-write-test"
avail_kb=$(df --output=avail -k "$HOME" | tail -1 | tr -d ' ')
if [ "${avail_kb:-0}" -lt 5242880 ]; then
  echo "less than 5 GiB free on $HOME: free space first (docs/VPS-BUILD.md)." >&2
  exit 1
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun is required (PATH)" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh is required (authenticate once with: gh auth login)" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated: run 'gh auth login' (token stays in the gh keyring/config, never in this repo)" >&2; exit 1; }

# https pushes use the gh credential helper; no token is written anywhere by this script.
git config --global credential.https://github.com.helper ''
git config --global --add credential.https://github.com.helper '!gh auth git-credential'

if [ ! -d "$REPO/.git" ]; then
  mkdir -p "$(dirname "$REPO")"
  git clone --filter=blob:none --branch main "$REMOTE" "$REPO"
fi
git -C "$REPO" remote set-url origin "$REMOTE"
git -C "$REPO" config submodule.recurse false
git -C "$REPO" config fetch.recurseSubmodules false
git -C "$REPO" config user.name "aphrody-dev"
git -C "$REPO" config user.email "contact@aphrody.com"

BUN="$(command -v bun)"
SCRIPT="$REPO/factory/sync/bunos-sync.ts"
[ -f "$SCRIPT" ] || { echo "$SCRIPT missing: is $REPO on main?" >&2; exit 1; }

if [ "$mode" = auto ] && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_DIR/bunos-sync.service" <<EOF
[Unit]
Description=Bun OS sync with origin/main (fast-forward, push-if-ahead, never force)

[Service]
Type=oneshot
Environment=BUNOS_REPO=$REPO
ExecStart=$BUN $SCRIPT
Nice=15
IOSchedulingClass=idle
# exit 2 = diverged/dirty (needs a human), reported in status.json, not a unit failure
SuccessExitStatus=2
EOF
  cat >"$UNIT_DIR/bunos-sync.timer" <<EOF
[Unit]
Description=Run the Bun OS sync every ${INTERVAL}s

[Timer]
OnBootSec=120
OnUnitActiveSec=${INTERVAL}
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now bunos-sync.timer
  # keep the timer running after logout
  loginctl enable-linger "$USER" 2>/dev/null || echo "note: loginctl enable-linger failed; ask the owner to run: sudo loginctl enable-linger $USER" >&2
  systemctl --user list-timers bunos-sync.timer --no-pager
else
  command -v tmux >/dev/null || { echo "no systemd user bus and no tmux" >&2; exit 1; }
  tmux kill-session -t bunos-sync 2>/dev/null || true
  tmux new-session -d -s bunos-sync "BUNOS_REPO=$REPO BUNOS_SYNC_INTERVAL=$INTERVAL nice -n 15 $BUN $SCRIPT --loop"
  echo "tmux session bunos-sync started (attach: tmux attach -t bunos-sync)"
fi
echo "status file: ${BUNOS_SYNC_STATUS:-$HOME/.local/state/bunos-sync/status.json}"
