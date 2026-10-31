// SPDX-License-Identifier: Apache-2.0
// Loop 1, delivery: runs when the VPS gate writes gate.json (bunos-auto-deliver.path). A green commit is deployed lane
// by lane (only lanes whose inputs changed since that lane last succeeded); a red one files an auto-fix task.
// Every lane remembers its own last good commit, so a failed lane is retried on the next green gate.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  closeTasks,
  commitStatus,
  event,
  fileTask,
  git,
  home,
  httpStatus,
  loadState,
  readJson,
  repo,
  run,
  saveState,
  stateDir,
  sudo,
  syncStateDir,
  withCheckoutLock,
} from "./lib.ts";

interface GateResult {
  name: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  file?: string;
  culprit?: { sha: string; author: string; subject: string };
}
interface Gate {
  at: string;
  sha: string;
  green: boolean;
  results: GateResult[];
}
interface LaneState {
  sha?: string;
  ok?: boolean;
  at?: string;
  detail?: string;
}
interface DeliverState {
  lastGateSeen?: string;
  lanes: Record<string, LaneState>;
  nginxDrift?: string[];
}

interface Lane {
  name: string;
  paths: RegExp;
  run: (sha: string, changed: string[]) => Promise<{ ok: boolean; detail: string }>;
}

const bun = process.execPath;

/** A long build in its own transient user unit: the unit name deduplicates (one build per lane at a time). */
async function background(name: string, argv: string[]) {
  const unit = `bunos-auto-lane-${name}`;
  const active = await run(["systemctl", "--user", "is-active", unit]);
  if (active.out.trim() === "active" || active.out.trim() === "activating")
    return { ok: true, detail: `${unit} already running` };
  await run(["systemctl", "--user", "reset-failed", unit]);
  const started = await run([
    "systemd-run",
    "--user",
    "--collect",
    `--unit=${unit}`,
    "-p",
    "CPUWeight=20",
    "-p",
    "IOWeight=20",
    "-p",
    `WorkingDirectory=${repo}`,
    ...argv,
  ]);
  return { ok: started.code === 0, detail: started.code === 0 ? `${unit} started` : started.out.slice(0, 300) };
}

const LANES: Lane[] = [
  {
    name: "webos",
    paths:
      /^(crates\/aphrody-webos-(server|client|protocol)|crates\/aphrody-inventory|crates\/bun-ui-web|packages\/bun-engine\/web-emulation\/qualify-page)\//,
    async run(sha) {
      const built = await withCheckoutLock(async () => {
        const head = (await git("rev-parse", "HEAD")).out.trim();
        if (head !== sha) return { code: 0, out: `superseded: checkout is at ${head.slice(0, 10)}` };
        return run(["bash", "crates/aphrody-webos-server/release.sh"], { timeoutMs: 3 * 60 * 60_000 });
      }, 60 * 60_000);
      if (!built) return { ok: false, detail: "checkout busy for an hour" };
      if (built.code !== 0) return { ok: false, detail: built.out.split("\n").slice(-6).join(" | ") };
      if (built.out.startsWith("superseded")) return { ok: true, detail: built.out };
      // The root activator (aphrody-webos-deploy.timer) swaps the release; wait until the live commit matches.
      for (let i = 0; i < 80; i++) {
        const live = (await fetch("http://127.0.0.1:8790/api/health")
          .then(r => r.json())
          .catch(() => ({}))) as { sourceCommit?: string };
        if (live.sourceCommit === sha) return { ok: true, detail: `aphrody.com serves ${sha.slice(0, 10)}` };
        await Bun.sleep(15_000);
      }
      return { ok: false, detail: "release staged but the activator did not switch within 20 minutes" };
    },
  },
  {
    name: "activator",
    paths: /^infra\/config\/host\/libexec\/aphrody-webos-activate\.ts$/,
    async run() {
      const r = await sudo([
        "install",
        "-o",
        "root",
        "-g",
        "root",
        "-m",
        "0755",
        join(repo, "infra/config/host/libexec/aphrody-webos-activate.ts"),
        "/usr/local/libexec/aphrody-webos-activate.ts",
      ]);
      return { ok: r.code === 0, detail: r.code === 0 ? "activator installed" : r.out };
    },
  },
  {
    name: "store",
    paths: /^apps\/webos\/store\//,
    async run() {
      await sudo(["systemctl", "restart", "aphrody-store.service"]);
      for (let i = 0; i < 20; i++) {
        const code = await httpStatus("http://127.0.0.1:8791/");
        if (code > 0 && code < 500) return { ok: true, detail: `store restarted (HTTP ${code})` };
        await Bun.sleep(3000);
      }
      return { ok: false, detail: "store did not answer after restart" };
    },
  },
  { name: "nginx", paths: /^infra\/config\/host\/nginx\//, run: async (_sha, changed) => nginxApply(changed) },
  { name: "compose", paths: /^infra\/config\/host\/apps\/vps\//, run: async (_sha, changed) => composeApply(changed) },
  {
    name: "automation",
    paths: /^factory\/automation\//,
    async run() {
      const r = await run([bun, "factory/automation/auto.ts", "install"], { timeoutMs: 300_000 });
      return { ok: r.code === 0, detail: r.out.split("\n").slice(-3).join(" | ") };
    },
  },
  {
    name: "unified-image",
    paths: /^(factory\/images\/bunos-unified\/|factory\/images\/manifest\.json$|factory\/desktop\/cosmic-session\/)/,
    run: async () => background("unified-image", [bun, "factory/automation/auto.ts", "image-build"]),
  },
  {
    name: "cosmic",
    paths: /^(factory\/native-apps\/|factory\/desktop\/cosmic|vendor\/cosmic|apps\/cosmic)/,
    run: async () => background("cosmic", ["sh", join(home, ".local/bin/aphrody-native-apps"), "container", "cosmic"]),
  },
  {
    name: "rust-base",
    paths: /^(factory\/rustbase\/|vendor\/uutils\/|vendor\/sudo-rs|vendor\/ntpd-rs)/,
    run: async () => background("rust-base", [bun, "factory/rustbase/rust-base.ts", "all"]),
  },
];

/** Live nginx files and the repository file each one is installed from (by file name under infra/config/host/nginx). */
async function nginxMap() {
  const tracked = (await git("ls-files", "infra/config/host/nginx")).out.split("\n").filter(Boolean);
  const byName = new Map<string, string>();
  for (const path of tracked) if (!byName.has(basename(path))) byName.set(basename(path), path);
  const live: { live: string; repo?: string }[] = [];
  for (const dir of ["/etc/nginx/conf.d", "/etc/nginx/snippets"])
    for (const name of existsSync(dir) ? readdirSync(dir) : [])
      if (/\.(conf|inc)$/.test(name)) live.push({ live: join(dir, name), repo: byName.get(name) });
  live.push({ live: "/etc/nginx/sites-available/aphrody.com", repo: byName.get("aphrody.com.conf") });
  return { live, tracked };
}

/** Repository files whose installed copy differs (drift), and repository snippets not installed yet. */
export async function nginxDrift() {
  const { live } = await nginxMap();
  const drift: string[] = [];
  for (const entry of live) {
    if (!entry.repo) continue;
    const same = await run(["cmp", "-s", join(repo, entry.repo), entry.live]);
    if (same.code !== 0) drift.push(`${entry.live} <- ${entry.repo}`);
  }
  return drift;
}

/**
 * Install the nginx files changed in this delivery, `nginx -t`, reload; on a failed test every installed file is put
 * back from its backup. Drift that no commit asked for is reported, not overwritten (certbot and hand edits live there).
 */
async function nginxApply(changed: string[]) {
  const { live } = await nginxMap();
  const wanted = changed.filter(path => path.startsWith("infra/config/host/nginx/") && existsSync(join(repo, path)));
  const installs: { from: string; to: string }[] = [];
  for (const path of wanted) {
    const target = live.find(entry => entry.repo === path);
    if (target) installs.push({ from: path, to: target.live });
    else if (path.startsWith("infra/config/host/nginx/snippets/") && path.endsWith(".inc"))
      installs.push({ from: path, to: join("/etc/nginx/snippets", basename(path)) });
  }
  const backup = join(stateDir, "nginx-backup", new Date().toISOString().replace(/[:.]/g, ""));
  mkdirSync(backup, { recursive: true });
  for (const item of installs) {
    if (existsSync(item.to)) cpSync(item.to, join(backup, basename(item.to)));
    await sudo(["install", "-o", "root", "-g", "root", "-m", "0644", join(repo, item.from), item.to]);
  }
  const test = await sudo(["nginx", "-t"]);
  if (test.code !== 0) {
    for (const item of installs) {
      const saved = join(backup, basename(item.to));
      if (existsSync(saved)) await sudo(["install", "-o", "root", "-g", "root", "-m", "0644", saved, item.to]);
      else await sudo(["rm", "-f", item.to]);
    }
    return { ok: false, detail: `nginx -t failed, rolled back: ${test.out.split("\n").slice(-3).join(" | ")}` };
  }
  if (installs.length) await sudo(["systemctl", "reload", "nginx"]);
  const drift = await nginxDrift();
  const state = loadState<DeliverState>("deliver", { lanes: {} });
  state.nginxDrift = drift;
  saveState("deliver", state);
  return {
    ok: true,
    detail: `${installs.length} file(s) installed, nginx -t ok${drift.length ? `; ${drift.length} drifted live file(s) reported` : ""}`,
  };
}

/** Install changed compose files into ~/apps and recreate the running services whose definition drifted. */
export async function composeApply(changed: string[]) {
  const appsDir = join(home, "apps");
  const prefix = "infra/config/host/apps/vps/";
  for (const path of changed.filter(p => p.startsWith(prefix) && p.endsWith("compose.yaml"))) {
    const source = join(repo, path);
    if (!existsSync(source)) continue;
    const target = join(appsDir, path.slice(prefix.length));
    if (existsSync(target)) cpSync(target, `${target}.bunos-auto-backup`);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(source, target);
  }
  return composeUp();
}

/** The repository is the source of the host compose files: a drifted installed copy is replaced (backup kept). */
async function syncComposeFiles() {
  const appsDir = join(home, "apps");
  const prefix = "infra/config/host/apps/vps/";
  const files = (await git("ls-files", prefix)).out.split("\n").filter(p => p.endsWith("compose.yaml"));
  const synced: string[] = [];
  for (const path of files) {
    const target = join(appsDir, path.slice(prefix.length));
    // Only apps already installed on this host (and the root project file).
    if (path !== `${prefix}compose.yaml` && !existsSync(join(target, ".."))) continue;
    if ((await run(["cmp", "-s", join(repo, path), target])).code === 0) continue;
    if (existsSync(target)) cpSync(target, `${target}.bunos-auto-backup`);
    cpSync(join(repo, path), target);
    synced.push(path.slice(prefix.length));
  }
  if (synced.length) event("deliver", "compose-sync", `installed from the repository: ${synced.join(", ")}`);
}

export async function composeUp() {
  const appsDir = join(home, "apps");
  await syncComposeFiles();
  const services = await run(["docker", "compose", "config", "--services"], { cwd: appsDir, timeoutMs: 60_000 });
  if (services.code !== 0) return { ok: false, detail: `compose config: ${services.out.split("\n").at(-1)}` };
  // Only services that already have a container: a declared but never started profile is not switched on here.
  const existing = await run(["docker", "compose", "ps", "-a", "--services"], { cwd: appsDir, timeoutMs: 60_000 });
  const names = existing.out.split("\n").filter(name => services.out.split("\n").includes(name));
  if (!names.length) return { ok: true, detail: "no compose service with a container" };
  const up = await run(["docker", "compose", "up", "-d", "--no-build", "--quiet-pull", ...names], {
    cwd: appsDir,
    timeoutMs: 900_000,
  });
  const recreated = up.out.split("\n").filter(line => /Recreat|Start|Creat/.test(line) && !/Running/.test(line));
  return {
    ok: up.code === 0,
    detail: up.code === 0 ? `compose up: ${recreated.length} change(s)` : up.out.split("\n").slice(-3).join(" | "),
  };
}

export async function deliver(force = false) {
  const gate = readJson<Gate | undefined>(join(syncStateDir, "gate.json"), undefined);
  if (!gate?.sha) return event("deliver", "idle", "no gate result yet");
  const state = loadState<DeliverState>("deliver", { lanes: {} });
  if (!force && state.lastGateSeen === gate.sha) return;
  state.lastGateSeen = gate.sha;
  saveState("deliver", state);
  const short = gate.sha.slice(0, 10);

  if (!gate.green) {
    for (const failed of gate.results.filter(r => !r.ok))
      await fileTask({
        key: `gate:${failed.name}`,
        kind: "autofix",
        title: `main ${short} is red at vps-gate/${failed.name}`,
        detail: `${failed.file ?? ""} ${failed.error ?? ""}\nCulprit: ${failed.culprit?.sha.slice(0, 10) ?? "?"} ${failed.culprit?.author ?? ""} "${failed.culprit?.subject ?? ""}"\nReproduce on the VPS: BUNOS_GATE_STEPS=${failed.name} bun factory/sync/bunos-gate.ts. Fix on main (normal push).`,
      });
    await commitStatus(gate.sha, "deliver", false, "gate red: not deployed, auto-fix task filed");
    return event(
      "deliver",
      "skipped-red",
      `${short} red: ${gate.results
        .filter(r => !r.ok)
        .map(r => r.name)
        .join(", ")}`,
    );
  }
  closeTasks("gate:", `green at ${short}`);
  await commitStatus(gate.sha, "deliver", "pending", "deploying");

  const results: { lane: string; ok: boolean; detail: string }[] = [];
  for (const lane of LANES) {
    const laneState = (state.lanes[lane.name] ??= {});
    // First sight of a lane: start from this commit (nothing to redeploy), except nginx/compose drift checks below.
    if (!laneState.sha) {
      laneState.sha = gate.sha;
      laneState.ok = true;
      laneState.at = new Date().toISOString();
      laneState.detail = "baseline";
      continue;
    }
    if (laneState.sha === gate.sha) continue;
    const diff = await git("diff", "--name-only", laneState.sha, gate.sha);
    const changed = diff.code === 0 ? diff.out.split("\n").filter(Boolean) : [];
    if (diff.code === 0 && !changed.some(path => lane.paths.test(path))) {
      laneState.sha = gate.sha;
      continue;
    }
    const outcome = await lane.run(gate.sha, changed).catch(error => ({ ok: false, detail: String(error) }));
    results.push({ lane: lane.name, ...outcome });
    Object.assign(laneState, { at: new Date().toISOString(), ok: outcome.ok, detail: outcome.detail });
    if (outcome.ok) {
      laneState.sha = gate.sha;
      closeTasks(`deliver:${lane.name}`, `ok at ${short}`);
    } else
      await fileTask({
        key: `deliver:${lane.name}`,
        kind: "autofix",
        title: `delivery lane ${lane.name} failed at ${short}`,
        detail: `${outcome.detail}\nRetry: bun factory/automation/auto.ts deliver --force (runs again on the next green gate).`,
      });
    event("deliver", outcome.ok ? "lane-ok" : "lane-failed", `${lane.name} @ ${short}: ${outcome.detail}`);
  }
  // Post-deploy verification of every public host (the deploy-sites verifier).
  const verify = await run([bun, "scripts/aphrody/release/deploy-sites.ts", "--verify-only"], { timeoutMs: 300_000 });
  results.push({ lane: "verify", ok: verify.code === 0, detail: verify.out.split("\n").slice(-2).join(" | ") });
  state.nginxDrift = await nginxDrift();
  saveState("deliver", state);
  const ok = results.every(r => r.ok);
  const summary = results.length
    ? results.map(r => `${r.lane}:${r.ok ? "ok" : "FAIL"}`).join(" ")
    : "no deployable change";
  await commitStatus(gate.sha, "deliver", ok, summary);
  return event("deliver", ok ? "delivered" : "partial", `${short} ${summary}`, { sha: gate.sha, results });
}
