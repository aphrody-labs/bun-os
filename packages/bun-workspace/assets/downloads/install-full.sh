#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Aphrody installer. One line:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh
#
# The command-line twin of Aphrody-Setup.exe (Windows, one click): by default (`all`) it installs the single
# `aphrody` multi-call binary (it carries the MCP server: `aphrody-mcp`, and every former standalone CLI name,
# linked by `aphrody self install-path`), the Claude plugins, and declares the aphrody MCP server and the
# plugins in Claude Code when it is installed. With `all`, a component not published for this platform is
# skipped with a note; a component named explicitly must install. One component only:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | APHRODY_COMPONENTS="aphrody" sh
#
# Environment:
#   APHRODY_DOWNLOAD_URL  base URL of the download server (default https://downloads.aphrody.com)
#   APHRODY_RELEASE       immutable release ID (default: select latest.json once)
#   APHRODY_COMPONENTS    `all` (default) or space separated: aphrody plugin-aphrody plugin-yolo mcp
#   APHRODY_PREFIX        install prefix (default ~/.local): binaries in <prefix>/lib/aphrody/<release>,
#                         links in ~/.local/bin, plugins in <prefix>/share/aphrody/plugins
#   APHRODY_NO_LINKS=1    do not run `aphrody self install-path`
#
# Every download is verified against SHA256SUMS of the same release before it is used.
set -eu

BASE="${APHRODY_DOWNLOAD_URL:-https://downloads.aphrody.com}"
BASE=${BASE%/}
COMPONENTS="${APHRODY_COMPONENTS:-all}"
ALL=""
if [ "$COMPONENTS" = all ]; then
  ALL=1
  COMPONENTS="aphrody plugin-aphrody plugin-yolo mcp"
fi
PREFIX="${APHRODY_PREFIX:-$HOME/.local}"

say() { printf '%s\n' "$*"; }
# skip <message>: with `all`, an unpublished component is a note; named explicitly, it is an error.
skip() { if [ -n "$ALL" ]; then say "  skipped: $*"; return 0; fi; die "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) os_part=unknown-linux-gnu ;;
  Darwin) os_part=apple-darwin ;;
  *) die "unsupported OS: $os (Windows: irm $BASE/install.ps1 | iex)" ;;
esac
case "$arch" in
  x86_64 | amd64) arch_part=x86_64 ;;
  aarch64 | arm64) arch_part=aarch64 ;;
  *) die "unsupported architecture: $arch" ;;
esac
TARGET="$arch_part-$os_part"

if have curl; then fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$1" -o "$2"; }
elif have wget; then fetch() { wget -qO "$2" "$1"; }
else die "curl or wget is required"; fi
if have sha256sum; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif have shasum; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi
have tar || die "tar is required"

TMP=$(mktemp -d)
STAGING=""
trap '[ -z "$STAGING" ] || rm -rf "$STAGING"; rm -rf "$TMP"' EXIT INT TERM

RELEASE_ID="${APHRODY_RELEASE:-}"
if [ -z "$RELEASE_ID" ]; then
  fetch "$BASE/latest.json" "$TMP/latest.json" || die "cannot read $BASE/latest.json"
  RELEASE_ID=$(tr '\n' ' ' <"$TMP/latest.json" | sed -n 's/.*"release"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9][A-Za-z0-9._-]*\)".*/\1/p')
fi
case "$RELEASE_ID" in "" | *[!A-Za-z0-9._-]* | . | ..) die "invalid or missing release ID" ;; esac
case "$RELEASE_ID" in [A-Za-z0-9]*) ;; *) die "invalid release ID" ;; esac
[ ${#RELEASE_ID} -le 128 ] || die "release ID is too long"
RELEASE_BASE="$BASE/releases/$RELEASE_ID"
fetch "$RELEASE_BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "cannot read $RELEASE_BASE/SHA256SUMS"
# Restrict checksum entries before using any filename as a local path or URL.
awk 'NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ || $2 !~ /^[A-Za-z0-9][A-Za-z0-9._-]*$/ { exit 1 }' "$TMP/SHA256SUMS" || die "invalid SHA256SUMS"
say "Selected release $RELEASE_ID"

# Reject paths and links that could escape the staging directory.
preflight_tar() {
  tar -tzf "$1" >"$TMP/archive-paths" || die "invalid archive"
  awk '$0 ~ /^\// || $0 ~ /^[A-Za-z]:/ || $0 ~ /(^|\/)\.\.(\/|$)/ { exit 1 }' "$TMP/archive-paths" || die "unsafe archive path"
  tar -tvzf "$1" >"$TMP/archive-types" || die "invalid archive"
  awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { exit 1 }' "$TMP/archive-types" || die "archive links or special files are unsupported"
}

# Keep the active directory intact until its replacement has passed preflight.
promote_directory() {
  dest="$1"
  previous="$dest.previous"
  [ ! -e "$previous" ] || die "previous installation exists: $previous"
  if [ -e "$dest" ]; then mv "$dest" "$previous"; fi
  if ! mv "$dest.new" "$dest"; then
    [ ! -e "$previous" ] || mv "$previous" "$dest"
    die "cannot activate $dest"
  fi
  STAGING=""
  [ ! -e "$previous" ] || rm -rf "$previous"
}

# file_for <prefix> <suffix-pattern>: the release file `<prefix>-*<suffix>` listed in SHA256SUMS
file_for() { awk -v p="$1" -v s="$2" '{ n=$2; if (index(n, p "-") == 1 && n ~ s) print n }' "$TMP/SHA256SUMS" | head -1; }

download() { # file -> $TMP/file, verified
  name="$1"
  fetch "$RELEASE_BASE/files/$name" "$TMP/$name" || die "cannot download $RELEASE_BASE/files/$name"
  want=$(awk -v n="$name" '$2 == n { print $1 }' "$TMP/SHA256SUMS")
  [ -n "$want" ] || die "$name is not listed in SHA256SUMS"
  got=$(sha256 "$TMP/$name")
  [ "$want" = "$got" ] || die "checksum mismatch for $name (expected $want, got $got)"
  say "  verified $name"
}

install_aphrody() {
  name=$(file_for aphrody "-${TARGET}[.]tar[.]gz\$")
  [ -n "$name" ] || { skip "no aphrody build for $TARGET in this release"; return 0; }
  download "$name"
  release=${name%-"$TARGET".tar.gz}
  dest="$PREFIX/lib/aphrody/$release"
  preflight_tar "$TMP/$name"
  [ ! -e "$dest.new" ] || die "staging installation exists: $dest.new"
  STAGING="$dest.new"
  mkdir -p "$dest.new"
  tar -xzf "$TMP/$name" -C "$dest.new"
  [ -x "$dest.new/aphrody" ] || die "the archive has no aphrody executable"
  "$dest.new/aphrody" --version >/dev/null || die "the downloaded aphrody does not run on this host"
  promote_directory "$dest"
  APHRODY_BIN="$dest/aphrody"
  if [ -z "${APHRODY_NO_LINKS:-}" ]; then
    mkdir -p "$HOME/.local/bin"
    "$dest/aphrody" self install-path --bin "$dest/aphrody" || die "aphrody self install-path failed"
  fi
  say "aphrody installed in $dest ($("$dest/aphrody" --version | head -1))"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "add $HOME/.local/bin to PATH" ;; esac
}

install_plugin() {
  component="$1"
  name=$(file_for "$component" "[.]tar[.]gz\$")
  [ -n "$name" ] || { skip "no $component archive in this release"; return 0; }
  download "$name"
  dest="$PREFIX/share/aphrody/plugins/$component"
  preflight_tar "$TMP/$name"
  [ ! -e "$dest.new" ] || die "staging installation exists: $dest.new"
  STAGING="$dest.new"
  mkdir -p "$dest.new"
  tar -xzf "$TMP/$name" -C "$dest.new"
  [ -f "$dest.new/.claude-plugin/plugin.json" ] || die "the archive has no plugin manifest"
  promote_directory "$dest"
  say "$component installed in $dest"
  PLUGINS="$PLUGINS $component"
}

# The installed plugins as a local Claude Code marketplace (the same one Aphrody-Setup writes), then installed.
register_plugins() {
  [ -n "$PLUGINS" ] || return 0
  root="$PREFIX/share/aphrody/plugins"
  mkdir -p "$root/.claude-plugin"
  {
    printf '{\n  "name": "aphrody-local",\n  "owner": { "name": "aphrody-dev", "email": "contact@aphrody.com" },\n'
    printf '  "description": "Aphrody plugins installed from downloads.aphrody.com",\n  "plugins": ['
    sep=""
    for component in $PLUGINS; do
      printf '%s\n    { "name": "%s", "source": "./%s" }' "$sep" "${component#plugin-}" "$component"
      sep=","
    done
    printf '\n  ]\n}\n'
  } >"$root/.claude-plugin/marketplace.json"
  if ! have claude; then
    say "plugins in $root (Claude Code not found: claude plugin marketplace add $root)"
    return 0
  fi
  claude plugin marketplace add "$root" --scope user >/dev/null || say "  claude refused the marketplace $root"
  for component in $PLUGINS; do
    if claude plugin install "${component#plugin-}@aphrody-local" --scope user >/dev/null; then
      say "  ${component#plugin-} installed in Claude Code"
    else
      say "  claude refused ${component#plugin-}"
    fi
  done
}

# The canonical aphrody MCP server, over stdio.
install_mcp() {
  # Prefer the canonical installed executable; fall back to the supported multicall command.
  bin=$(command -v aphrody-mcp || true)
  mcp_args=""
  if [ -z "$bin" ]; then
    bin="${APHRODY_BIN:-$(command -v aphrody || true)}"
    mcp_args="mcp-server"
  fi
  [ -n "$bin" ] || { skip "aphrody is not installed: no MCP server to declare"; return 0; }
  have claude || { skip "Claude Code is not installed: claude mcp add --scope user aphrody -- $bin $mcp_args"; return 0; }
  claude mcp remove aphrody --scope user >/dev/null 2>&1 || true
  if [ -n "$mcp_args" ]; then
    claude mcp add --scope user aphrody -- "$bin" "$mcp_args" >/dev/null || die "claude mcp add failed"
  else
    claude mcp add --scope user aphrody -- "$bin" >/dev/null || die "claude mcp add failed"
  fi
  say "aphrody MCP server declared in Claude Code"
}

PLUGINS=""
APHRODY_BIN=""
for component in $COMPONENTS; do
  say "Installing $component ($TARGET)"
  case "$component" in
    aphrody) install_aphrody ;;
    plugin-aphrody | plugin-yolo) install_plugin "$component" ;;
    mcp) install_mcp ;;
    *) die "unknown component: $component" ;;
  esac
done
register_plugins
