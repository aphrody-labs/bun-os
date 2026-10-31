// SPDX-License-Identifier: Apache-2.0
// Installs the automation units on the VPS (idempotent; the delivery loop re-runs it when factory/automation changes):
// systemd user units for the loops, restart drop-ins for the live system units, the status page nginx snippet, and
// the native-apps publish path unit that replaces the old tmux watcher.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, NEVER_TOUCH, repo, run, statusRoot, sudo } from "./lib.ts";

const bun = process.execPath;
const auto = join(repo, "factory", "automation", "auto.ts");
const path = [
  join(home, ".local", "bin"),
  join(home, ".bun", "bin"),
  join(home, ".cargo", "bin"),
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
].join(":");
const env = `Environment=BUNOS_REPO=${repo}
Environment=APHRODY_BUILD_HOST=vps
Environment=APHRODY_A2A_HUB_URL=http://127.0.0.1:8788
Environment=APHRODY_A2A_TOKEN_FILE=${home}/.aphrody/private/a2a/bearer
Environment=APHRODY_A2A_PEER_ID=automation
Environment=PATH=${path}`;

function oneshot(name: string, description: string, args: string, extra = "") {
  return [
    `${name}.service`,
    `[Unit]
Description=${description} (docs/AUTOMATION.md)
[Service]
Type=oneshot
${env}
WorkingDirectory=${repo}
ExecStart=${bun} ${auto} ${args}
Nice=10
${extra}`,
  ] as const;
}
function timer(name: string, description: string, schedule: string, unit?: string) {
  return [
    `${name}.timer`,
    `[Unit]
Description=${description}
[Timer]
${schedule}
Persistent=true
${unit ? `Unit=${unit}\n` : ""}[Install]
WantedBy=timers.target
`,
  ] as const;
}

const USER_UNITS: (readonly [string, string])[] = [
  oneshot("bunos-auto-deliver", "Bun OS delivery of green gates", "deliver", "TimeoutStartSec=5h\n"),
  [
    "bunos-auto-deliver.path",
    `[Unit]
Description=Deliver when the VPS gate writes a result
[Path]
PathChanged=${home}/.local/state/bunos-sync/gate.json
Unit=bunos-auto-deliver.service
[Install]
WantedBy=default.target
`,
  ],
  timer(
    "bunos-auto-deliver",
    "Delivery catch-up (a gate result missed by the path unit)",
    "OnBootSec=5min\nOnUnitInactiveSec=15min",
  ),
  oneshot("bunos-auto-health", "Bun OS runtime health probes and restarts", "health", "TimeoutStartSec=15min\n"),
  timer(
    "bunos-auto-health",
    "Bun OS health probes every 2 minutes",
    "OnBootSec=2min\nOnUnitInactiveSec=2min\nAccuracySec=15s",
  ),
  oneshot(
    "bunos-auto-guard",
    "Bun OS disk, OOM, runaway, log, certificate and compose guards",
    "guard",
    "TimeoutStartSec=2h\n",
  ),
  timer("bunos-auto-guard", "Bun OS resource guards every 10 minutes", "OnBootSec=4min\nOnUnitInactiveSec=10min"),
  oneshot("bunos-auto-status", "Bun OS status page", "status", "TimeoutStartSec=5min\n"),
  timer("bunos-auto-status", "Bun OS status page every 5 minutes", "OnBootSec=3min\nOnUnitInactiveSec=5min"),
  oneshot(
    "bunos-auto-nightly",
    "Bun OS nightly end-to-end qualification",
    "nightly",
    "TimeoutStartSec=7h\nCPUWeight=30\n",
  ),
  timer(
    "bunos-auto-nightly",
    "Bun OS nightly qualification at 02:30 UTC",
    "OnCalendar=*-*-* 02:30:00 UTC\nRandomizedDelaySec=300",
  ),
  [
    "bunos-auto-deps@.service",
    `[Unit]
Description=Bun OS dependency job %i (docs/AUTOMATION.md)
[Service]
Type=oneshot
${env}
WorkingDirectory=${repo}
ExecStart=${bun} ${auto} deps %i
Nice=15
IOSchedulingClass=idle
TimeoutStartSec=8h
`,
  ],
  timer(
    "bunos-auto-deps-forks",
    "Fork pin refresh (rotating, 4 forks a day)",
    "OnCalendar=*-*-* 04:30:00 UTC",
    "bunos-auto-deps@forks.service",
  ),
  timer(
    "bunos-auto-deps-locks",
    "Cargo.lock and bun.lock refresh (weekly)",
    "OnCalendar=Sun *-*-* 05:00:00 UTC",
    "bunos-auto-deps@locks.service",
  ),
  timer(
    "bunos-auto-deps-bun",
    "Bun canary pin refresh (daily)",
    "OnCalendar=*-*-* 06:00:00 UTC",
    "bunos-auto-deps@bun.service",
  ),
  timer(
    "bunos-auto-deps-helium",
    "Helium pin refresh (daily)",
    "OnCalendar=*-*-* 06:30:00 UTC",
    "bunos-auto-deps@helium.service",
  ),
  timer(
    "bunos-auto-deps-android",
    "Android 17 image pin check (weekly)",
    "OnCalendar=Mon *-*-* 06:45:00 UTC",
    "bunos-auto-deps@android.service",
  ),
  [
    "bunos-auto-coordinator.service",
    `[Unit]
Description=Bun OS autonomous coordinator: PRODUCT.md lines and automation tasks to agents (docs/AUTOMATION.md)
StartLimitIntervalSec=0
[Service]
${env}
WorkingDirectory=${repo}
ExecStart=${bun} ${auto} coordinator
Restart=always
RestartSec=30
Nice=10
[Install]
WantedBy=default.target
`,
  ],
  [
    "bunos-native-publish.service",
    `[Unit]
Description=Republish the signed apt feed when a fork deb lands (replaces the tmux publish-watch loop)
[Service]
Type=oneshot
Environment=PATH=${path}
ExecStart=/bin/sh ${home}/.local/bin/aphrody-native-apps publish
TimeoutStartSec=1h
Nice=10
`,
  ],
  [
    "bunos-native-publish.path",
    `[Unit]
Description=Watch the native-apps deb index
[Path]
PathChanged=${home}/native-apps/debs/index.tsv
Unit=bunos-native-publish.service
[Install]
WantedBy=default.target
`,
  ],
];

const ENABLE = [
  "bunos-auto-deliver.path",
  "bunos-auto-deliver.timer",
  "bunos-auto-health.timer",
  "bunos-auto-guard.timer",
  "bunos-auto-status.timer",
  "bunos-auto-nightly.timer",
  "bunos-auto-deps-forks.timer",
  "bunos-auto-deps-locks.timer",
  "bunos-auto-deps-bun.timer",
  "bunos-auto-deps-helium.timer",
  "bunos-auto-deps-android.timer",
  "bunos-auto-coordinator.service",
  "bunos-native-publish.path",
];

/** Live Bun OS system units: always restarted by systemd, and never parked by the start limit. */
const LIVE_UNITS = [
  "aphrody-webos",
  "aphrody-site",
  "aphrody-store",
  "aphrody-android-gateway",
  "aphrody-android17",
  "aphrody-bun-os-server",
  "aphrody-chat-gateway",
  "aphrody-downloads",
  "aphrody-fonts-proxy",
  "aphrody-remote",
  "aphrody-web-browser-vps",
  "aphrody-desktop-xvfb",
  "aphrody-desktop-wm",
  "aphrody-a2a",
  "waydroid-container",
];

export async function install() {
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const [name, text] of USER_UNITS) writeFileSync(join(unitDir, name), text);
  await run(["systemctl", "--user", "daemon-reload"]);
  for (const unit of ENABLE) {
    const r = await run(["systemctl", "--user", "enable", "--now", unit]);
    if (r.code !== 0) console.log(`enable ${unit}: ${r.out}`);
  }
  // A changed coordinator restarts on the new code.
  await run(["systemctl", "--user", "try-restart", "bunos-auto-coordinator.service"]);

  for (const unit of LIVE_UNITS) {
    if (NEVER_TOUCH.test(unit)) continue;
    const dir = `/etc/systemd/system/${unit}.service.d`;
    // A unit retired from the host keeps no drop-in of ours (a lone drop-in would resurrect a stub unit).
    const fragment = (await run(["systemctl", "show", "-p", "FragmentPath", "--value", `${unit}.service`])).out.trim();
    if (!fragment) {
      await sudo(["rm", "-f", `${dir}/90-bunos-auto.conf`]);
      await sudo(["rmdir", "--ignore-fail-on-non-empty", dir]);
      continue;
    }
    const restart = unit === "waydroid-container" || unit === "aphrody-android17" ? "on-failure" : "always";
    const text = `# Installed by factory/automation/install.ts (docs/AUTOMATION.md): restart on any exit, never parked by the
# start limit; the health loop (bunos-auto-health.timer) is the HTTP watchdog on top.
[Unit]
StartLimitIntervalSec=600
StartLimitBurst=30
[Service]
Restart=${restart}
RestartSec=5
`;
    const tmp = join(home, ".cache", `bunos-auto-${unit}.conf`);
    mkdirSync(join(home, ".cache"), { recursive: true });
    writeFileSync(tmp, text);
    await sudo(["install", "-d", "-m", "0755", dir]);
    await sudo(["install", "-m", "0644", tmp, `${dir}/90-bunos-auto.conf`]);
  }
  // The host self-heal pass, from the repository (it skips Shenron units).
  for (const name of ["aphrody-selfheal.service", "aphrody-selfheal.timer"])
    await sudo([
      "install",
      "-m",
      "0644",
      join(repo, "infra/config/host/systemd/aphrody", name),
      `/etc/systemd/system/${name}`,
    ]);
  await sudo(["systemctl", "daemon-reload"]);

  // Status page: the nginx snippet and the server block that includes it, tested before reload, rolled back on failure.
  mkdirSync(statusRoot, { recursive: true });
  const installs = [
    ["infra/config/host/nginx/snippets/aphrody-status.inc", "/etc/nginx/snippets/aphrody-status.inc"],
    ["infra/config/host/nginx/aphrody/aphrody.com.conf", "/etc/nginx/sites-available/aphrody.com"],
  ];
  const backups: [string, string][] = [];
  for (const [from, to] of installs) {
    if ((await run(["cmp", "-s", join(repo, from!), to!])).code === 0) continue;
    const backup = join(home, ".cache", `bunos-auto-nginx-${to!.replace(/\//g, "_")}`);
    if (existsSync(to!)) await sudo(["cp", "-p", to!, backup]);
    backups.push([to!, existsSync(to!) ? backup : ""]);
    await sudo(["install", "-o", "root", "-g", "root", "-m", "0644", join(repo, from!), to!]);
  }
  if (backups.length) {
    const test = await sudo(["nginx", "-t"]);
    if (test.code !== 0) {
      for (const [to, backup] of backups)
        await (backup ? sudo(["install", "-m", "0644", backup, to]) : sudo(["rm", "-f", to]));
      console.log(`nginx -t failed, rolled back: ${test.out}`);
    } else await sudo(["systemctl", "reload", "nginx"]);
  }

  // The tmux publish loop is replaced by bunos-native-publish.path.
  const tmux = await run(["tmux", "has-session", "-t", "native-publish"]);
  if (tmux.code === 0) await run(["tmux", "kill-session", "-t", "native-publish"]);
  const list = await run(["systemctl", "--user", "list-timers", "bunos-*", "--no-pager"]);
  console.log(list.out);
  return true;
}
