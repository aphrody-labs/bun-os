#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Idempotent per-user toolchain sync for a Linux host, driven by yolo infra/config/host/toolchain.json.
# Runs ON the host: ssh <host> 'bash -s' < scripts/tools/toolchain-sync.sh  (needs jq; stdin: manifest path in $MANIFEST_JSON)
# No Cargo build, only the marked PATH block in ~/.bashrc (above the interactive guard) and ~/.profile, no service/nginx/systemd/database access.
set -uo pipefail
M="${MANIFEST_JSON:-$HOME/.cache/aphrody-toolchain.json}"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
j() { jq -r "$1" "$M"; }
log() { printf '== %s\n' "$*"; }
mkdir -p "$HOME/.local/bin"
arch=$(uname -m); [ "$arch" = x86_64 ] || { echo "unsupported arch $arch"; exit 1; }

log apt
sudo -n apt-get install -y --no-install-recommends $(j '.apt|join(" ")') >/dev/null 2>&1 || sudo -n apt-get install -y $(j '.apt|map(select(.!="nodejs" and .!="gh"))|join(" ")') >/dev/null
for p in $(j '.aptRemovedAsShadowed|join(" ")'); do dpkg -s "$p" >/dev/null 2>&1 && sudo -n apt-get remove -y "$p" >/dev/null 2>&1; done

log rustup
RUST=$(j .versions.rust); NIGHT=$(j .versions.rustNightly)
if ! command -v rustup >/dev/null; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST" >/dev/null 2>&1
fi
rustup toolchain install "$RUST" --profile minimal $(j '.rustToolchain.components|map("-c "+.)|join(" ")') >/dev/null 2>&1
rustup default "$RUST" >/dev/null 2>&1
if [ "${WITH_RUST_TARGETS:-1}" = 1 ]; then rustup target add --toolchain "$RUST" $(j '.rustToolchain.targets|join(" ")') >/dev/null 2>&1; fi
[ "${WITH_NIGHTLY:-1}" = 1 ] && rustup toolchain install "$NIGHT" --profile minimal -c rustfmt -c clippy >/dev/null 2>&1

log cargo-binstall
command -v cargo-binstall >/dev/null || curl -fsSL https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash >/dev/null 2>&1
for c in $(j '.binstall|join(" ")'); do
  n=${c%@*}; v=${c#*@}; [ "$v" = "$c" ] && spec="$n" || spec="$n@$v"
  cargo-binstall --no-confirm --disable-strategies compile --locked "$spec" 2>&1 | tail -1
done

# Host-scoped tools (hostTools.<host>): TOOLCHAIN_HOST names the host being synced.
hj() { jq -r --arg h "${TOOLCHAIN_HOST:-}" "$1" "$M"; }
if [ -n "${TOOLCHAIN_HOST:-}" ] && [ "$(hj '.hostTools[$h] != null')" = true ]; then
  log "host tools ($TOOLCHAIN_HOST)"
  sudo -n apt-get install -y --no-install-recommends $(hj '.hostTools[$h].apt // [] | join(" ")') >/dev/null
  for c in $(hj '.hostTools[$h].binstall // [] | join(" ")'); do
    cargo-binstall --no-confirm --disable-strategies compile --locked "$c" 2>&1 | tail -1
  done
fi

log bun
BUN=$(j .versions.bun)
if [ "$(bun --version 2>/dev/null)" != "$BUN" ]; then npm install -g "bun@$BUN" >/dev/null 2>&1; fi
bun add -g $(j '.bunGlobal|join(" ")') 2>&1 | tail -2

log uv
if command -v uv >/dev/null; then uv self update >/dev/null 2>&1 || true; else curl -LsSf https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh >/dev/null 2>&1; fi
uv python install "$(j .versions.python)" 2>&1 | tail -1

log uv-tools
uv python install 3.13 2>&1 | tail -1
for t in $(j '.uvTools|map(.package+"|"+.from+"|"+.python)|join(" ")'); do
  IFS='|' read -r pkg from py <<<"$t"
  uv tool install -p "$py" --from "$from" "$pkg" 2>&1 | tail -1
done

log agent-code-intel
RTK=$(j .versions.rtk)
if ! rtk --version 2>/dev/null | grep -q "$RTK"; then
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v$RTK/rtk-x86_64-unknown-linux-musl.tar.gz" | tar -xz -C "$tmp" rtk && install -m 755 "$tmp/rtk" "$HOME/.local/bin/rtk"
  rm -rf "$tmp"
fi
if command -v codex >/dev/null; then
  codex mcp get context-mode >/dev/null 2>&1 || codex mcp add context-mode -- context-mode
  grep -qs rtk "$HOME/.codex/hooks.json" || rtk init -g --codex </dev/null 2>&1 | tail -1
fi
if command -v agy >/dev/null; then
  agy mcp list 2>/dev/null | grep -q 'context-mode' || agy mcp add context-mode context-mode
  [ -d "$HOME/.gemini/config/plugins/rtk" ] || rtk init -g --agent antigravity </dev/null 2>&1 | tail -1
fi
if command -v claude >/dev/null; then
  grep -qs 'rtk hook claude' "$HOME/.claude/settings.json" || rtk init -g --hook-only --auto-patch 2>&1 | tail -1
  claude plugin install aphrody-code-intel@aphrody-user >/dev/null 2>&1 || true
fi

log release-binaries
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
OV=$(j .versions.ovhcloud)
if ! ovhcloud version 2>/dev/null | grep -q "v$OV"; then
  curl -fsSL "https://github.com/ovh/ovhcloud-cli/releases/download/v$OV/ovhcloud-cli_Linux_x86_64.tar.gz" | tar -xz -C "$tmp" && install -m 755 "$tmp/ovhcloud" "$HOME/.local/bin/ovhcloud"
fi
RCV=$(rclone version 2>/dev/null | head -1)
case "$RCV" in *v1.75*|*v1.76*|*v1.77*|*v1.8*) ;; *) curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o "$tmp/r.zip" && (cd "$tmp" && unzip -qo r.zip) && install -m 755 "$tmp"/rclone-*/rclone "$HOME/.local/bin/rclone";; esac
YQ=$(j .versions.yq)
yq --version 2>/dev/null | grep -q "$YQ" || { curl -fsSL "https://github.com/mikefarah/yq/releases/download/v$YQ/yq_linux_amd64" -o "$tmp/yq" && install -m 755 "$tmp/yq" "$HOME/.local/bin/yq"; }
CP=$(j .versions.carapace)
carapace --version 2>&1 | grep -q "$CP" || { curl -fsSL "https://github.com/carapace-sh/carapace-bin/releases/download/v$CP/carapace-bin_${CP}_linux_amd64.tar.gz" | tar -xz -C "$tmp" carapace && install -m 755 "$tmp/carapace" "$HOME/.local/bin/carapace"; }
PW=$(j .versions.pwsh)
if ! pwsh --version 2>/dev/null | grep -q "$PW"; then
  d="$HOME/.local/share/powershell/$PW"; mkdir -p "$d"
  curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v$PW/powershell-$PW-linux-x64.tar.gz" | tar -xz -C "$d" && chmod +x "$d/pwsh" && ln -sfn "$d/pwsh" "$HOME/.local/bin/pwsh"
fi
GH=$(j .versions.gh)
gh --version 2>/dev/null | grep -q "$GH" || { curl -fsSL "https://github.com/cli/cli/releases/download/v$GH/gh_${GH}_linux_amd64.tar.gz" | tar -xz -C "$tmp" && install -m 755 "$tmp"/gh_*/bin/gh "$HOME/.local/bin/gh"; }
if [ "${WITH_JQ_RELEASE:-0}" = 1 ]; then JQ=$(j .versions.jq); jq --version 2>/dev/null | grep -q "$JQ" || { curl -fsSL "https://github.com/jqlang/jq/releases/download/jq-$JQ/jq-linux-amd64" -o "$tmp/jq" && install -m 755 "$tmp/jq" "$HOME/.local/bin/jq"; }; fi
log path-block
for f in "$HOME/.bashrc" "$HOME/.profile"; do
  [ -f "$f" ] || touch "$f"
  grep -q '# >>> aphrody-infra toolchain >>>' "$f" && continue
  { printf '%s\n' '# >>> aphrody-infra toolchain >>>' 'export BUN_INSTALL="$HOME/.bun"' \
      'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH" ;; esac' \
      '# <<< aphrody-infra toolchain <<<'; cat "$f"; } > "$f.new" && mv "$f.new" "$f"
done
log done
