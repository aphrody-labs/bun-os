#!/bin/sh
# SPDX-License-Identifier: MIT
# Runs without user credentials or a remote Google account.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/rootfs/usr/libexec/bunos/drive-mount"
if [ ! -c /dev/fuse ] || [ ! -r /dev/fuse ] || [ ! -w /dev/fuse ]; then
  printf 'SKIP: usable /dev/fuse is required\n'
  exit 0
fi
d=$(mktemp -d "${TMPDIR:-/tmp}/bunos-drive-test.XXXXXXXX")
case "$d" in "${TMPDIR:-/tmp}"/bunos-drive-test.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$d"' EXIT
mkdir -p "$d/home/.config/rclone" "$d/bin" "$d/volatile"
printf '[gdrive]\ntype = drive\n' >"$d/home/.config/rclone/rclone.conf"
cat >"$d/bin/rclone" <<'EOF'
#!/bin/sh
if [ "$3" = listremotes ]; then echo gdrive:; exit 0; fi
if [ "$3" = about ]; then exit 0; fi
if [ "$3" = config ] && [ "$4" = dump ]; then echo '{}'; exit 0; fi
[ "$3" = mount ] && [ "$4" = gdrive: ] || exit 1
while [ "$#" -gt 0 ]; do
  if [ "$1" = --cache-dir ]; then
    [ "$2" = "$HOME/.cache/bunos-drive" ] || exit 2
    printf 'called\n' >"$HOME/called"
    exit 0
  fi
  shift
done
exit 3
EOF
cat >"$d/bin/bun" <<'EOF'
#!/bin/sh
if [ "${TEST_MUTATE_CONFIG:-0}" = 1 ]; then printf '# changed\n' >> "$HOME/.config/rclone/rclone.conf"; fi
cat "$HOME/test-identity"
EOF
chmod +x "$d/bin/rclone" "$d/bin/bun"
export HOME="$d/home" PATH="$d/bin:/usr/bin:/bin" XDG_CACHE_HOME="$d/volatile"
unset XDG_CONFIG_HOME
printf '%064d\n' 1 > "$HOME/test-identity"
chmod 644 "$HOME/.config/rclone/rclone.conf"
if sh "$script" >/dev/null 2>&1; then echo 'insecure config accepted' >&2; exit 1; fi
chmod 600 "$HOME/.config/rclone/rclone.conf"
mkdir -p "$HOME/Google Drive"
printf 'keep' >"$HOME/Google Drive/local-file"
if sh "$script" >/dev/null 2>&1; then echo 'nonempty directory accepted' >&2; exit 1; fi
[ "$(cat "$HOME/Google Drive/local-file")" = keep ]
rm "$HOME/Google Drive/local-file"
mkdir -p "$HOME/.cache/bunos-drive/vfs"
printf 'pending' > "$HOME/.cache/bunos-drive/vfs/pending"
if sh "$script" >/dev/null 2>&1; then echo 'unidentified cache accepted' >&2; exit 1; fi
[ "$(cat "$HOME/.cache/bunos-drive/vfs/pending")" = pending ]
rm "$HOME/.cache/bunos-drive/vfs/pending"
rmdir "$HOME/.cache/bunos-drive/vfs"
if TEST_MUTATE_CONFIG=1 sh "$script" >/dev/null 2>&1; then echo 'concurrent config change accepted' >&2; exit 1; fi
[ ! -e "$HOME/.cache/bunos-drive/.identity.sha256" ]
sh "$script"
[ -f "$HOME/called" ] && [ -f "$HOME/.cache/bunos-drive/.mount.lock" ]
[ ! -e "$d/volatile/bunos-drive" ]
# An account change must never reuse the existing cache.
printf '%064d\n' 2 > "$HOME/test-identity"
if sh "$script" >/dev/null 2>&1; then echo 'different identity accepted' >&2; exit 1; fi
[ "$(cat "$HOME/.cache/bunos-drive/.identity.sha256")" = "$(printf '%064d' 1)" ]
printf 'drive-mount checks passed\n'
