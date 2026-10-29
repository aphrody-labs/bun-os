#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Deploys the built release (apps/play/dist, from scripts/build.ts on this workstation) to the VPS:
 * replaces ~/apps/play/current in place (no kept releases), preserves ~/apps/play/play.env, installs
 * the user unit bun-os-play.service (bun-os-gaming.slice) and the distro TLS vhost
 * play.aphrody.app.conf (nginx -t, then reload only). Nothing is compiled on the VPS.
 *
 * Usage: bun apps/play/scripts/deploy.ts [--build] [--host vps] [--skip-vhost]
 * Prerequisites on the VPS: an installed upstream Bun and the existing play.env, plus an nginx
 * executable at ~/apps/play/nginx/sbin/nginx (stock nginx, or one built with the optional Bun module).
 */
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const host = args.includes("--host")
  ? args[args.indexOf("--host") + 1]!
  : "vps";
const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");
const dist = join(app, "dist");

if (args.includes("--build")) await $`bun ${join(import.meta.dir, "build.ts")}`;
if (!(await Bun.file(join(dist, "server.js")).exists()))
  throw new Error("apps/play/dist is missing; run scripts/build.ts");

const staging = await mkdtemp(join(tmpdir(), "play-release-"));
try {
  // Relative operands: GNU tar and scp read "C:" in a Windows path as a remote host.
  await $`tar -czf play.tgz -C ${dist} .`.cwd(staging);
  await $`scp -q -o ConnectTimeout=15 -o BatchMode=yes play.tgz ${host}:/tmp/`.cwd(
    staging,
  );
  await $`scp -q -o ConnectTimeout=15 -o BatchMode=yes infra/config/host/apps/vps/gaming/play/bun-os-play.service infra/config/host/nginx/play/play.aphrody.app.conf ${host}:/tmp/`.cwd(
    repo,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}

const remote = String.raw`
set -eu
P="$HOME/apps/play"
test -f "$P/play.env" && test -x "$P/nginx/sbin/nginx"
RUNTIME=$(printenv PLAY_DEPLOY_RUNTIME || true)
if [ -z "$RUNTIME" ]; then
  if [ -x "$P/runtime/bun" ]; then RUNTIME="$P/runtime/bun"; else RUNTIME="$HOME/.local/bin/bun"; fi
fi
case "$RUNTIME" in /*) ;; *) echo 'Runtime must be an absolute installed path' >&2; exit 1 ;; esac
case "$RUNTIME" in *[!a-zA-Z0-9_./-]*) echo 'Unsupported runtime path characters' >&2; exit 1 ;; esac
test -x "$RUNTIME"
"$RUNTIME" --revision >/dev/null
"$P/nginx/sbin/nginx" -v
rm -rf "$P/next" && mkdir -p "$P/next" "$P/data/usr" && tar -xzf /tmp/play.tgz -C "$P/next" && rm -f /tmp/play.tgz
# Existing host-specific environment and protected session stores stay untouched.
mkdir -p "$HOME/.config/systemd/user"
sed "s|__PLAY_RUNTIME__|$RUNTIME|g" /tmp/bun-os-play.service > "$HOME/.config/systemd/user/bun-os-play.service"
chmod 644 "$HOME/.config/systemd/user/bun-os-play.service"
rm -f /tmp/bun-os-play.service
systemctl --user daemon-reload
systemctl --user stop bun-os-play.service 2>/dev/null || true
rm -rf "$P/current" && mv "$P/next" "$P/current"
systemctl --user enable --now bun-os-play.service
curl --fail --silent --retry 12 --retry-delay 1 --retry-connrefused --retry-max-time 20 --max-time 3 -o /dev/null http://127.0.0.1:18480/healthz
curl --fail --silent --max-time 5 -o /dev/null http://127.0.0.1:18480/api/platform/theme
curl --fail --silent --max-time 5 -o /dev/null 'http://127.0.0.1:18480/api/platform/i18n?domains=common,play&lang=fr'
systemctl --user --no-pager --lines=8 status bun-os-play.service | sed -n '1,14p'
`;
const vhost = String.raw`
set -eu
LIVE=/etc/nginx/conf.d/play.aphrody.app.conf
if ! sudo cmp -s /tmp/play.aphrody.app.conf "$LIVE"; then
  PREVIOUS=$(mktemp)
  sudo cat "$LIVE" > "$PREVIOUS" 2>/dev/null || : > "$PREVIOUS"
  sudo install -m 644 /tmp/play.aphrody.app.conf "$LIVE"
  if sudo nginx -t; then
    sudo systemctl reload nginx
  else
    # Never leave a configuration that fails nginx -t for the other vhosts' next reload.
    if [ -s "$PREVIOUS" ]; then sudo install -m 644 "$PREVIOUS" "$LIVE"; else sudo rm -f "$LIVE"; fi
    rm -f "$PREVIOUS" /tmp/play.aphrody.app.conf
    exit 1
  fi
  rm -f "$PREVIOUS"
fi
rm -f /tmp/play.aphrody.app.conf
`;
await $`ssh -o ConnectTimeout=15 -o BatchMode=yes ${host} ${"timeout 60 sh <<'PLAY_DELIVERY'\n" + remote + "\nPLAY_DELIVERY"}`;
if (!args.includes("--skip-vhost"))
  await $`ssh -o ConnectTimeout=15 -o BatchMode=yes ${host} ${"timeout 30 sh <<'PLAY_VHOST'\n" + vhost + "\nPLAY_VHOST"}`;
console.log(`deployed apps/play to ${host}`);
