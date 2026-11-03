#!/usr/bin/env bun
// Promote a release built on the build host to a production host (docs/ops/DEPLOY.md).
//
//   bun infra/fleet/promote.ts --app webos --release <path on vps> [--to bunos] [--unit aphrody-webos.service]
//                              [--health http://127.0.0.1:8790/api/health] [--dry-run]
//
// 1. on the build host: verify <release>/receipt.json (sha256 of every file) and that its commit is on origin/main;
// 2. copy the release over the mesh into <to>:~/apps/<app>/releases/<name>/ (rsync, hard links against current);
// 3. on the target: verify the receipt again, switch ~/apps/<app>/current atomically, restart the unit, wait for the
//    health endpoint to report the release commit, and switch back on failure;
// 4. keep the four newest releases plus the active one.
import { parseArgs } from "node:util";
import fleetToml from "./fleet.toml";

type Host = { mesh_ip: string; user?: string; roles: string[] };
const fleet = fleetToml as unknown as { hosts: Record<string, Host> };

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    release: { type: "string" },
    from: { type: "string", default: "vps" },
    to: { type: "string", default: "bunos" },
    unit: { type: "string" },
    health: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

function die(message: string): never {
  console.error(`promote: ${message}`);
  process.exit(2);
}

const app = values.app ?? die("--app is required");
const release = values.release ?? die("--release is required");
if (!/^[a-z0-9][a-z0-9-]*$/.test(app)) die(`invalid app name ${app}`);
const from = values.from!;
const to = values.to!;
const target = fleet.hosts[to] ?? die(`unknown host ${to}`);
if (!fleet.hosts[from]) die(`unknown host ${from}`);
const name = release.replace(/\/+$/, "").split("/").pop()!;
if (!/^[a-f0-9]{40}-[0-9]+$/.test(name)) die(`release directory must be named <commit>-<epoch-ms>, got ${name}`);
const commit = name.split("-")[0];
const unit = values.unit ?? `aphrody-${app}.service`;
const dry = values["dry-run"];

async function ssh(host: string, script: string): Promise<string> {
  const proc = Bun.spawn(["ssh", host, "bash -s"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  // Parse the whole script before running it (sudo-rs and rsync read stdin).
  proc.stdin.write(`fleet_main() {\nset -euo pipefail\n${script}\n}\nfleet_main </dev/null\n`);
  await proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) die(`step failed on ${host}`);
  return out;
}

const verifyReceipt = (dir: string) => `
cd ${JSON.stringify(dir)}
command -v jq >/dev/null || { echo "jq missing" >&2; exit 1; }
[ "$(jq -r .sourceCommit receipt.json)" = "${commit}" ] || { echo "receipt commit mismatch" >&2; exit 1; }
jq -r '.files[] | "\\(.sha256)  \\(.path)"' receipt.json | sha256sum --quiet -c -
echo verified`;

// 1. Build host.
console.log(`promote ${app} ${name}: ${from} -> ${to}${dry ? " (dry run)" : ""}`);
await ssh(
  from,
  `${verifyReceipt(release)}
git -C ~/src/bun-os fetch -q origin
git -C ~/src/bun-os merge-base --is-ancestor ${commit} origin/main || { echo "commit ${commit} is not on main" >&2; exit 1; }`,
);
if (dry) process.exit(0);

// 2. Copy over the mesh (the build host reaches the target by its mesh address).
const dest = `${target.user ?? "ubuntu"}@${target.mesh_ip}`;
await ssh(
  from,
  `ssh -o BatchMode=yes ${dest} 'mkdir -p ~/apps/${app}/releases'
link=$(ssh -o BatchMode=yes ${dest} 'readlink -f ~/apps/${app}/current 2>/dev/null || true')
rsync -a --delete \${link:+--link-dest="$link"} ${JSON.stringify(release.replace(/\/+$/, ""))}/ ${dest}:apps/${app}/releases/${name}/
echo copied`,
);

// 3. Activate on the target with health gate and rollback.
const health = values.health;
const out = await ssh(
  to,
  `${verifyReceipt(`$HOME/apps/${app}/releases/${name}`)}
cd ~/apps/${app}
previous=$(readlink current 2>/dev/null || true)
ln -sfn releases/${name} current.new && mv -T current.new current
sudo -n systemctl restart ${unit}
ok=0
for i in $(seq 1 60); do
  sleep 2
  ${
    health
      ? `body=$(curl -fsS -m 3 ${JSON.stringify(health)} 2>/dev/null || true); case "$body" in *${commit}*) ok=1; break;; esac`
      : `systemctl is-active --quiet ${unit} && { ok=1; break; }`
  }
done
if [ "$ok" != 1 ]; then
  echo "health gate failed; rolling back to \${previous:-nothing}" >&2
  if [ -n "$previous" ]; then ln -sfn "$previous" current.new && mv -T current.new current; sudo -n systemctl restart ${unit}; fi
  exit 1
fi
ls -1dt releases/*/ | tail -n +6 | while read -r old; do [ "\${old%/}" = "$(readlink current)" ] || rm -rf "$old"; done
echo "active ${name}"`,
);
console.log(out.trim().split("\n").pop());
