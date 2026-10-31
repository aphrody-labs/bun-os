// SPDX-License-Identifier: Apache-2.0
// Loop 2, resource guards (bunos-auto-guard.timer, every 10 minutes): disk thresholds with cache pruning, btrfs
// metadata room (the 2026-10-29 incident), OOM kills, runaway builds, log rotation, certificate expiry and Docker
// compose drift. Derived data (build caches, dangling images, old job trees) is pruned; anything else is moved to
// the quarantine first and purged after its retention period.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { composeUp } from "./deliver.ts";
import { closeTasks, event, fileTask, home, loadState, NEVER_TOUCH, run, saveState, stateDir, sudo } from "./lib.ts";

const WARN = 80;
const PRUNE = 85;
const HARD = 92;
const QUARANTINE_DAYS = 7;
const quarantine = join(home, ".local", "share", "bunos-auto", "quarantine");

async function usage(mount: string) {
  const df = await run(["df", "--output=pcent,avail", "-B1G", mount]);
  const [pcent = "0", avail = "0"] = (df.out.split("\n")[1] ?? "").trim().split(/\s+/);
  return { percent: Number(pcent.replace("%", "")), availGiB: Number(avail) };
}

const ageDays = (path: string) => (Date.now() - statSync(path).mtimeMs) / 86_400_000;

/** Old directories under `root`, newest `keep` kept: moved to the quarantine (not deleted). */
function quarantineOld(root: string, days: number, keep: number) {
  if (!existsSync(root)) return 0;
  const entries = readdirSync(root)
    .map(name => join(root, name))
    .filter(path => statSync(path).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  let moved = 0;
  for (const path of entries.slice(keep)) {
    if (ageDays(path) < days) continue;
    const target = join(quarantine, new Date().toISOString().slice(0, 10), path.replace(/[\\/]/g, "_"));
    mkdirSync(join(target, ".."), { recursive: true });
    try {
      renameSync(path, target);
      moved++;
    } catch {
      // Another filesystem: leave it, the report lists the disk state.
    }
  }
  return moved;
}

function purgeQuarantine() {
  if (!existsSync(quarantine)) return 0;
  let purged = 0;
  for (const day of readdirSync(quarantine)) {
    const path = join(quarantine, day);
    if (ageDays(path) >= QUARANTINE_DAYS) {
      rmSync(path, { recursive: true, force: true });
      purged++;
    }
  }
  return purged;
}

async function disk(report: string[]) {
  for (const mount of ["/home", "/"]) {
    const before = await usage(mount);
    report.push(`${mount} ${before.percent}% (${before.availGiB} GiB free)`);
    if (before.percent < PRUNE) continue;
    const actions: string[] = [];
    // Derived data first, cheapest to rebuild last.
    await run(["docker", "builder", "prune", "-f", "--filter", "until=72h"], { timeoutMs: 900_000 });
    actions.push("docker builder cache > 72h");
    await run(["docker", "image", "prune", "-f"], { timeoutMs: 600_000 });
    actions.push("dangling images");
    await sudo(["journalctl", "--vacuum-size=500M"]);
    actions.push(
      `image jobs moved: ${quarantineOld(join(home, "bun-os-images"), 3, 3)}`,
      `qualification runs moved: ${quarantineOld(join(home, "bun-os-disk"), 14, 10)}`,
      `quarantine purged: ${purgeQuarantine()}`,
    );
    if ((await usage(mount)).percent >= HARD) {
      await run(["docker", "builder", "prune", "-af"], { timeoutMs: 1_800_000 });
      await run(["bun", "pm", "cache", "rm"], { timeoutMs: 300_000 });
      if (existsSync("/var/cache/sccache")) await run(["sccache", "--zero-stats"]);
      actions.push("all build cache (hard threshold)");
    }
    const after = await usage(mount);
    event("guard", "pruned", `${mount} ${before.percent}% -> ${after.percent}%: ${actions.join(", ")}`);
    if (after.percent >= HARD)
      await fileTask({
        key: `guard:disk:${mount}`,
        kind: "escalation",
        title: `${mount} still at ${after.percent}% after pruning`,
        detail: `Free space by removing finished build trees (btrfs filesystem du -s ~/build/*). Quarantine: ${quarantine}.`,
      });
    else closeTasks(`guard:disk:${mount}`, `${after.percent}%`);
  }
  // btrfs metadata needs unallocated room (2026-10-29: ENOSPC on metadata made /home read-only).
  const fs = await sudo(["btrfs", "filesystem", "usage", "-b", "/home"]);
  const unallocated = Number(fs.out.match(/Device unallocated:\s+(\d+)/)?.[1] ?? NaN) / 2 ** 30;
  if (Number.isFinite(unallocated)) {
    report.push(`/home btrfs unallocated ${unallocated.toFixed(1)} GiB`);
    if (unallocated < 8) {
      await sudo(["btrfs", "balance", "start", "-dusage=10", "/home"], 3_600_000);
      event("guard", "btrfs-balance", `unallocated ${unallocated.toFixed(1)} GiB: balance -dusage=10`);
    }
  }
}

async function oom(state: { lastOomCheck?: string }, report: string[]) {
  const since = state.lastOomCheck ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const kernel = await sudo(["journalctl", "-k", "--since", since.replace("T", " ").slice(0, 19), "--no-pager", "-q"]);
  const earlyoom = await sudo([
    "journalctl",
    "-u",
    "earlyoom",
    "--since",
    since.replace("T", " ").slice(0, 19),
    "--no-pager",
    "-q",
  ]);
  // Kernel OOM kills and earlyoom actions only (Android init inside Waydroid also logs "Sending SIGKILL to service").
  const kills = [
    ...kernel.out.split("\n").filter(line => /Out of memory: Killed process|oom-kill:/.test(line)),
    ...earlyoom.out.split("\n").filter(line => /sending SIG(TERM|KILL) to process/i.test(line)),
  ];
  state.lastOomCheck = new Date().toISOString();
  report.push(`OOM kills since last pass: ${kills.length}`);
  if (kills.length) event("guard", "oom", kills.slice(0, 5).join(" | "));
}

/**
 * Runaway builds: a compiler/build process older than 12 h is pushed to idle priority (quarantined), one older than
 * 24 h is stopped. Shenron builds are never touched.
 */
async function runaway(report: string[]) {
  const ps = await run(["ps", "-eo", "pid=,etimes=,comm=,args="]);
  const builders = /^(cargo|rustc|cc1plus|cc1|clang|ld\.lld|ninja|make|makepkg|soong_ui)$/;
  let slowed = 0;
  let stopped = 0;
  for (const line of ps.out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, seconds, comm, args] = match;
    if (!builders.test(comm!) || NEVER_TOUCH.test(args!) || /\/srv\/shenron/.test(args!)) continue;
    const hours = Number(seconds) / 3600;
    if (hours > 24) {
      await run(["kill", "-TERM", pid!]);
      stopped++;
      event("guard", "runaway-stopped", `${comm} pid ${pid} after ${hours.toFixed(1)} h: ${args!.slice(0, 200)}`);
    } else if (hours > 12) {
      await run(["renice", "-n", "19", "-p", pid!]);
      await run(["ionice", "-c", "3", "-p", pid!]);
      slowed++;
    }
  }
  report.push(`runaway builds: ${slowed} at idle priority, ${stopped} stopped`);
}

/** Our own logs (outside logrotate): files over 64 MiB are compressed to .1.zst, three generations kept. */
async function logs(report: string[]) {
  let rotated = 0;
  for (const dir of [join(home, "logs"), join(home, "native-apps", "log"), stateDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!/\.(log|jsonl)$/.test(name) || !statSync(path).isFile() || statSync(path).size < 64 * 2 ** 20) continue;
      for (let i = 2; i >= 1; i--)
        if (existsSync(`${path}.${i}.zst`)) renameSync(`${path}.${i}.zst`, `${path}.${i + 1}.zst`);
      const z = await run(["zstd", "-q", "-19", "-f", path, "-o", `${path}.1.zst`], { timeoutMs: 600_000 });
      if (z.code === 0) {
        await Bun.write(path, "");
        rotated++;
      }
    }
  }
  report.push(`logs rotated: ${rotated}`);
}

/** Certificates: renew below 20 days (certbot), escalate below 10. */
async function certificates(report: string[]) {
  const live = await sudo(["sh", "-c", "ls -d /etc/letsencrypt/live/*/ 2>/dev/null"]);
  const soon: string[] = [];
  for (const dir of live.out.split("\n").filter(Boolean)) {
    const end = await sudo(["openssl", "x509", "-enddate", "-noout", "-in", `${dir}fullchain.pem`]);
    const date = Date.parse(end.out.replace("notAfter=", ""));
    if (!Number.isFinite(date)) continue;
    const days = (date - Date.now()) / 86_400_000;
    if (days < 20) soon.push(`${dir.split("/").at(-2)} ${days.toFixed(0)}d`);
  }
  if (soon.length) {
    const renew = await sudo(["certbot", "renew", "--quiet", "--deploy-hook", "systemctl reload nginx"], 900_000);
    event("guard", "cert-renew", `${soon.join(", ")}: certbot ${renew.code === 0 ? "ok" : renew.out.slice(-200)}`);
  }
  report.push(`certificates expiring < 20 d: ${soon.length ? soon.join(", ") : "none"}`);
  const critical = soon.filter(s => Number(s.split(" ").at(-1)!.replace("d", "")) < 10);
  if (critical.length)
    await fileTask({
      key: "guard:certs",
      kind: "escalation",
      title: `certificates expire in under 10 days: ${critical.join(", ")}`,
      detail: "certbot renew failed; see journalctl -u certbot and the ACME challenge locations in nginx.",
    });
  else closeTasks("guard:certs", "renewed");
}

/** Docker: containers recreated from the host compose project when their definition drifted; unhealthy ones restarted. */
async function docker(report: string[]) {
  const up = await composeUp();
  report.push(`compose: ${up.detail}`);
  if (!up.ok)
    await fileTask({
      key: "guard:compose",
      kind: "autofix",
      title: "the host compose project does not apply",
      detail: `${up.detail}\nSource: infra/config/host/apps/vps/compose.yaml installed at ~/apps/compose.yaml.`,
    });
  else closeTasks("guard:compose", "applies");
  const ps = await run(["docker", "ps", "--filter", "health=unhealthy", "--format", "{{.Names}}"]);
  for (const name of ps.out.split("\n").filter(Boolean)) {
    if (NEVER_TOUCH.test(name)) continue;
    await run(["docker", "restart", name], { timeoutMs: 180_000 });
    event("guard", "container-restart", `${name} was unhealthy`);
  }
}

export async function guard() {
  const state = loadState<{ lastOomCheck?: string; report?: string[]; at?: string }>("guard", {});
  const report: string[] = [];
  for (const step of [disk, (r: string[]) => oom(state, r), runaway, logs, certificates, docker])
    await step(report).catch(error => report.push(`error: ${String(error).slice(0, 200)}`));
  state.report = report;
  state.at = new Date().toISOString();
  saveState("guard", state);
  console.log(report.join("\n"));
  return state;
}

export { WARN };
