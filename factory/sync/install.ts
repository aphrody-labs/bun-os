#!/usr/bin/env bun
/**
 * Installs the Bun OS sync for this host. Idempotent; safe to re-run after every change to factory/sync.
 *
 *   bun factory/sync/install.ts                 install for this host (Linux: VPS role, Windows: workstation role)
 *   bun factory/sync/install.ts --uninstall     remove the timer or task (checkouts and state are kept)
 *   bun factory/sync/install.ts --hooks <dir>   only point a clone's core.hooksPath at .githooks (the pre-push gate)
 *
 * Linux (VPS): systemd user units bunos-sync.service + bunos-sync.timer (wall-clock OnCalendar every 10 minutes, so a
 * missed or failed run never stops the schedule), running factory/sync/bunos-sync.ts from the shared checkout with the
 * VPS roles: self-healing, Cargo.lock writer and main gate. Every bun-os clone under ~/work gets the pre-push hook.
 * Windows (workstation): Scheduled Task BunOS-Sync every 10 minutes, hidden (conhost --headless), no push, healing only
 * trees that were not edited during the grace period.
 * Environment: BUNOS_REPO (default: this checkout), BUNOS_SYNC_INTERVAL (seconds).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const home = homedir();
const windows = process.platform === "win32";
const repo = resolve(process.env.BUNOS_REPO ?? resolve(import.meta.dir, "../.."));
const intervalSeconds = Number(process.env.BUNOS_SYNC_INTERVAL ?? 600);
const intervalMinutes = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? Math.max(1, Math.round(intervalSeconds / 60)) : 10;

function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

const canonicalRemote = normalizeRemote(run(["git", "-C", repo, "remote", "get-url", "origin"], true));

function run(cmd: string[], allowFailure = false): string {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const text = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
  if (result.exitCode !== 0 && !allowFailure) throw new Error(`${cmd.join(" ")} failed: ${text}`);
  return text;
}

function setHooks(clone: string) {
  run(["git", "-C", clone, "config", "core.hooksPath", ".githooks"]);
  console.log(`pre-push gate enabled in ${clone}`);
}

function bunOsClones(root: string, remote: string): string[] {
  if (!remote || !existsSync(root)) return [];
  return readdirSync(root)
    .map(name => join(root, name))
    .filter(dir => existsSync(join(dir, ".git")))
    .filter(dir => normalizeRemote(run(["git", "-C", dir, "remote", "get-url", "origin"], true)) === remote);
}

function installLinux() {
  const unitDir = join(home, ".config", "systemd", "user");
  const bun = process.execPath;
  const script = join(repo, "factory", "sync", "bunos-sync.ts");
  if (!existsSync(script)) throw new Error(`${script} missing: point BUNOS_REPO at an initialized checkout`);
  run(["git", "-C", repo, "config", "submodule.recurse", "false"]);
  run(["git", "-C", repo, "config", "fetch.recurseSubmodules", "false"]);
  run(["git", "-C", repo, "config", "user.name", "aphrody-dev"]);
  run(["git", "-C", repo, "config", "user.email", "contact@aphrody.com"]);
  const path = [join(home, ".local", "bin"), join(home, ".bun", "bin"), join(home, ".cargo", "bin"), "/usr/local/bin", "/usr/bin", "/bin"];
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(
    join(unitDir, "bunos-sync.service"),
    `[Unit]
Description=Bun OS sync with origin/main (self-healing, lock writer, main gate; never forced)

[Service]
Type=oneshot
Environment=BUNOS_REPO=${repo}
Environment=BUNOS_SYNC_HOST=vps
Environment=BUNOS_SYNC_LOCK_WRITER=1
Environment=BUNOS_SYNC_GATE=1
Environment=APHRODY_BUILD_HOST=vps
Environment=PATH=${path.join(":")}
ExecStart=${bun} ${script}
Nice=15
IOSchedulingClass=idle
# The gate can run a cold cargo check; the timer simply skips while a pass is active.
TimeoutStartSec=6h
# exit 2 = dirty within the grace period (reported in status.json), not a unit failure
SuccessExitStatus=2
`,
  );
  writeFileSync(
    join(unitDir, "bunos-sync.timer"),
    `[Unit]
Description=Run the Bun OS sync every ${intervalMinutes} minutes

[Timer]
OnBootSec=2min
OnCalendar=*:0/${intervalMinutes}
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
`,
  );
  run(["systemctl", "--user", "daemon-reload"]);
  run(["systemctl", "--user", "enable", "--now", "bunos-sync.timer"]);
  run(["systemctl", "--user", "restart", "bunos-sync.timer"]);
  run(["loginctl", "enable-linger", process.env.USER ?? ""], true);
  for (const clone of [repo, ...bunOsClones(join(home, "work"), canonicalRemote)]) setHooks(clone);
  console.log(run(["systemctl", "--user", "list-timers", "bunos-sync.timer", "--no-pager"]));
}

function installWindows() {
  const script = join(repo, "factory", "sync", "bunos-sync.ts");
  if (!existsSync(script)) throw new Error(`${script} missing: is ${repo} on main?`);
  const command = `conhost.exe --headless "${process.execPath}" "${script}" --repo "${repo}" --host workstation --no-push --grace-always`;
  if (command.length > 261) throw new Error(`Scheduled Task command exceeds 261 characters: ${command}`);
  run(["schtasks.exe", "/Create", "/F", "/SC", "MINUTE", "/MO", String(intervalMinutes), "/TN", "BunOS-Sync", "/TR", command]);
  setHooks(repo);
  console.log(`Scheduled Task BunOS-Sync: every ${intervalMinutes} min -> ${command}`);
}

function uninstall() {
  if (windows) run(["schtasks.exe", "/Delete", "/F", "/TN", "BunOS-Sync"], true);
  else {
    run(["systemctl", "--user", "disable", "--now", "bunos-sync.timer"], true);
    for (const unit of ["bunos-sync.service", "bunos-sync.timer"])
      rmSync(join(home, ".config", "systemd", "user", unit), { force: true });
    run(["systemctl", "--user", "daemon-reload"], true);
  }
  console.log(`bunos-sync removed (checkout ${repo} and state kept).`);
}

const hooksIndex = argv.indexOf("--hooks");
if (hooksIndex >= 0) setHooks(resolve(argv[hooksIndex + 1] ?? "."));
else if (argv.includes("--uninstall")) uninstall();
else if (windows) installWindows();
else installLinux();
