#!/usr/bin/env bash
# Native Bun frontend preflight shared by the Unix launchers.
frontend_preflight() {
  local frontend_path="$1"
  test -d "$frontend_path" || { echo "Frontend not found: $frontend_path" >&2; exit 1; }
  command -v bun >/dev/null || { echo 'The upstream Bun canary (oven-sh/bun) is required.' >&2; exit 1; }
  bun -e 'if (!/^[0-9a-f]{40}$/.test(Bun.revision) || !process.release.sourceUrl?.startsWith("https://github.com/oven-sh/bun/releases/download/")) throw new Error("Use the upstream oven-sh/bun canary");'
}

frontend_bun_install() {
  bun install --frozen-lockfile --ignore-scripts
}
