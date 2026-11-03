#!/bin/sh
# SPDX-License-Identifier: MIT
# Local-backend smoke test; no Google account or user data is accessed.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/rootfs/usr/libexec/bunos/drive-mount"
command -v rclone >/dev/null && command -v fusermount3 >/dev/null || { echo 'SKIP: rclone/fusermount3 unavailable'; exit 0; }
[ -c /dev/fuse ] && [ -r /dev/fuse ] && [ -w /dev/fuse ] || { echo 'SKIP: /dev/fuse unavailable'; exit 0; }
rclone=$(command -v rclone)
d=$(mktemp -d "${TMPDIR:-/tmp}/bunos-drive-fuse.XXXXXXXX")
case "$d" in "${TMPDIR:-/tmp}"/bunos-drive-fuse.*) ;; *) exit 1 ;; esac
pid=''
cleanup() {
  fusermount3 -uz "$d/home/Google Drive" 2>/dev/null || true
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if ! mountpoint -q "$d/home/Google Drive"; then rm -rf -- "$d"; fi
}
trap cleanup EXIT
mkdir -p "$d/home/.config/rclone" "$d/remote" "$d/bin"
ln -s "$rclone" "$d/bin/rclone"
cat >"$d/bin/bun" <<'EOF'
#!/bin/sh
printf '%064d\n' 1
EOF
chmod +x "$d/bin/bun"
printf '[gdrive]\ntype = alias\nremote = %s\n' "$d/remote" >"$d/home/.config/rclone/rclone.conf"
chmod 600 "$d/home/.config/rclone/rclone.conf"
export HOME="$d/home" PATH="$d/bin:/usr/bin:/bin"
unset XDG_CONFIG_HOME XDG_CACHE_HOME
start() {
  sh "$script" >"$d/log" 2>&1 & pid=$!
  i=0
  while ! mountpoint -q "$HOME/Google Drive"; do
    if ! kill -0 "$pid" 2>/dev/null; then cat "$d/log"; exit 1; fi
    [ "$i" -lt 50 ] || { echo 'mount timeout' >&2; exit 1; }
    i=$((i + 1)); sleep .2
  done
}
start
if sh "$script" >/dev/null 2>&1; then echo 'duplicate mount accepted' >&2; exit 1; fi
printf 'pending test' >"$HOME/Google Drive/probe.txt"
kill -9 "$pid"
wait "$pid" 2>/dev/null || true
pid=''
fusermount3 -uz "$HOME/Google Drive"
[ ! -f "$d/remote/probe.txt" ] || { echo 'write-back finished before interruption' >&2; exit 1; }
start
i=0
while [ ! -f "$d/remote/probe.txt" ]; do
  [ "$i" -lt 20 ] || { echo 'write-back timeout' >&2; exit 1; }
  i=$((i + 1)); sleep 1
done
[ "$(cat "$d/remote/probe.txt")" = 'pending test' ]
echo 'isolated mount, cache lock and write-back recovery passed'
