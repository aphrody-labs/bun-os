#!/bin/sh
# YOLO installer — one command, like bun:
#
#   curl -fsSL https://github.com/aphrody-labs/yolo/releases/latest/download/install.sh | bash
#   gh release download -R aphrody-labs/yolo -p install.sh -O - | bash        # private repository
#
# Environment:
#   YOLO_VERSION      release tag to install (default: latest)
#   YOLO_HOME         installation directory (default: ~/.yolo)
#   YOLO_REPO         GitHub repository (default: aphrody-labs/yolo)
#   YOLO_RELEASE_DIR  install from a local release directory (offline / testing)
#   GITHUB_TOKEN      token for a private repository (else `gh auth token` is used)
#   YOLO_NO_CRATES=1  skip the Rust sources of the desktop scaffold
#   YOLO_NO_MODIFY_PATH=1  do not touch shell profiles
#   YOLO_NO_ALIASES=1 do not install the `bun` and `vu` aliases of the single yolo executable
set -eu

REPO="${YOLO_REPO:-aphrody-labs/yolo}"
HOME_DIR="${YOLO_HOME:-$HOME/.yolo}"
VERSION="${YOLO_VERSION:-latest}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- platform -----------------------------------------------------------------------------------
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) os_part=unknown-linux-gnu ;;
  Darwin) os_part=apple-darwin ;;
  *) die "unsupported OS: $os (Windows: use install.ps1)" ;;
esac
case "$arch" in
  x86_64 | amd64) arch_part=x86_64 ;;
  aarch64 | arm64) arch_part=aarch64 ;;
  *) die "unsupported architecture: $arch" ;;
esac
TARGET="$arch_part-$os_part"

have tar || die "tar is required"
if have sha256sum; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif have shasum; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# --- download ----------------------------------------------------------------------------------
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$token" ] && have gh; then token=$(gh auth token 2>/dev/null || true); fi

fetch_asset() { # name -> $TMP/name
  name="$1"
  if [ -n "${YOLO_RELEASE_DIR:-}" ]; then
    cp "$YOLO_RELEASE_DIR/$name" "$TMP/$name" || die "missing $YOLO_RELEASE_DIR/$name"
    return
  fi
  if [ "$VERSION" = latest ]; then base="https://github.com/$REPO/releases/latest/download"
  else base="https://github.com/$REPO/releases/download/$VERSION"; fi
  if curl -fsSL "$base/$name" -o "$TMP/$name" 2>/dev/null; then return; fi
  # private repository: resolve the asset through the API with a token
  [ -n "$token" ] || die "cannot download $name (private repository? set GITHUB_TOKEN or run gh auth login)"
  if [ "$VERSION" = latest ]; then api="https://api.github.com/repos/$REPO/releases/latest"
  else api="https://api.github.com/repos/$REPO/releases/tags/$VERSION"; fi
  json=$(curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api") \
    || die "cannot read release $VERSION of $REPO"
  url=$(printf '%s' "$json" | tr ',' '\n' | grep -B30 "\"name\": *\"$name\"" | grep '"url": *"https://api.github.com/repos/.*/releases/assets/' | tail -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/' || true)
  [ -n "$url" ] || url=$(printf '%s' "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(a['url'] for a in d['assets'] if a['name']=='$name'))" 2>/dev/null || true)
  [ -n "$url" ] || die "release $VERSION has no asset $name"
  curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/octet-stream" "$url" -o "$TMP/$name" \
    || die "cannot download $name"
}

say "Installing yolo ($TARGET, $VERSION) into $HOME_DIR"
fetch_asset SHA256SUMS
main_asset=$(grep -E "yolo-[^ ]*-$TARGET\.tar\.gz\$" "$TMP/SHA256SUMS" | awk '{print $2}' | head -1)
[ -n "$main_asset" ] || die "no build for $TARGET in this release"
fetch_asset "$main_asset"
crates_asset=""
if [ -z "${YOLO_NO_CRATES:-}" ]; then
  crates_asset=$(grep -E "yolo-[^ ]*-crates\.tar\.gz\$" "$TMP/SHA256SUMS" | awk '{print $2}' | head -1 || true)
  [ -z "$crates_asset" ] || fetch_asset "$crates_asset"
fi

# --- verify ------------------------------------------------------------------------------------
verify() {
  want=$(grep -E "  $1\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$want" ] || die "$1 is not listed in SHA256SUMS"
  got=$(sha256 "$TMP/$1")
  [ "$want" = "$got" ] || die "checksum mismatch for $1 (expected $want, got $got)"
}
verify "$main_asset"
[ -z "$crates_asset" ] || verify "$crates_asset"

# --- validate the extracted release before replacing an existing installation -------------------
mkdir -p "$TMP/main"
tar -xzf "$TMP/$main_asset" -C "$TMP/main"
if [ -n "$crates_asset" ]; then
  mkdir -p "$TMP/crates"
  tar -xzf "$TMP/$crates_asset" -C "$TMP/crates"
  [ -d "$TMP/crates/crates" ] || die "missing crates directory in $crates_asset"
fi
[ -f "$TMP/main/bin/yolo" ] || die "release is missing bin/yolo"
chmod +x "$TMP/main/bin/yolo"
# A release built from the Bun release artifact carries the aliases `bun` (engine) and `vu` as links to the same file.
if [ -L "$TMP/main/bin/bun" ]; then
  "$TMP/main/bin/bun" --revision >/dev/null || die "the bun alias of this release does not run"
fi
# Use the release's own standalone CLI and an isolated runtime store. Checking the outer archive's
# hash does not establish that its native payload has a compatible ABI or can actually be loaded.
YOLO_HOME="$TMP/main" YOLO_RUNTIME_HOME="$TMP/runtime-probe" "$TMP/main/bin/yolo" version
YOLO_HOME="$TMP/main" YOLO_RUNTIME_HOME="$TMP/runtime-probe" "$TMP/main/bin/yolo" runtime install "$TMP/main/artifact"
YOLO_HOME="$TMP/main" YOLO_RUNTIME_HOME="$TMP/runtime-probe" "$TMP/main/bin/yolo" runtime info --installed >/dev/null

# --- install -----------------------------------------------------------------------------------
mkdir -p "$HOME_DIR"
# code and data are replaced; runtime artifact history (current/previous) is kept by `yolo runtime install`
for part in bin packages m3 templates crates VERSION LICENSE LICENSES vendor.lock; do
  [ -e "$TMP/main/$part" ] || continue
  rm -rf "$HOME_DIR/$part.new"
  cp -R "$TMP/main/$part" "$HOME_DIR/$part.new"
  rm -rf "${HOME_DIR:?}/$part"
  mv "$HOME_DIR/$part.new" "$HOME_DIR/$part"
done
# earlier layout: sdk/ and stack/ became packages/runtime and templates/
rm -rf "$HOME_DIR/sdk" "$HOME_DIR/stack"
if [ -n "$crates_asset" ]; then
  mkdir -p "$HOME_DIR/crates"
  cp -R "$TMP/crates/crates/." "$HOME_DIR/crates/"
fi
chmod +x "$HOME_DIR/bin/yolo"
# YOLO_NO_ALIASES=1 keeps an existing `bun` or `vu` of the PATH from being shadowed by this installation.
if [ -n "${YOLO_NO_ALIASES:-}" ]; then rm -f "$HOME_DIR/bin/bun" "$HOME_DIR/bin/vu"; fi

YOLO_HOME="$HOME_DIR" "$HOME_DIR/bin/yolo" runtime install "$TMP/main/artifact"

# --- PATH ---------------------------------------------------------------------------------------
bin="$HOME_DIR/bin"
if [ -z "${YOLO_NO_MODIFY_PATH:-}" ]; then
  case ":$PATH:" in *":$bin:"*) on_path=1 ;; *) on_path=0 ;; esac
  if [ "$on_path" = 0 ]; then
    line="export PATH=\"$bin:\$PATH\""
    [ "$HOME_DIR" = "$HOME/.yolo" ] || line="export YOLO_HOME=\"$HOME_DIR\"; $line"
    added=""
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      [ -f "$rc" ] || continue
      grep -qs "yolo" "$rc" 2>/dev/null && continue
      printf '\n# yolo\n%s\n' "$line" >> "$rc"
      added="$added $rc"
    done
    [ -z "$added" ] || say "Added $bin to PATH in:$added"
    if [ -n "${NU_VERSION:-}" ] || have nu; then
      say "Nushell: add to config.nu →  \$env.PATH = (\$env.PATH | prepend \"$bin\")"
    fi
  fi
fi

say ""
YOLO_HOME="$HOME_DIR" "$HOME_DIR/bin/yolo" version
say "yolo is installed. Open a new shell (or: export PATH=\"$bin:\$PATH\") and run:"
say "  yolo doctor"
say "  yolo create my-app && cd my-app && bun install && bun run dev"
