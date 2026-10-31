// SPDX-License-Identifier: Apache-2.0
// One entry that builds, deploys and verifies every Aphrody site from the published main tip, on the VPS:
//   bun scripts/aphrody/release/deploy-sites.ts [--verify-only]
// WebOS (aphrody.com and its redirect/alias hosts) is built and staged by crates/aphrody-webos-server/release.sh; the root activator
// swaps the release. Independent site owners (downloads, cdn, creator) run as their own services and are only verified.
import { join, resolve } from "node:path";

if (process.platform !== "linux") throw new Error("Deploy sites from the VPS factory");
const root = resolve(import.meta.dir, "../../..");
const verifyOnly = Bun.argv.includes("--verify-only");

function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}
async function run(label: string, ...cmd: string[]) {
  console.log(`== ${label}`);
  const child = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw new Error(`${label} failed`);
}

git("fetch", "--quiet", "origin");
const commit = git("rev-parse", "HEAD");
// Verification reads the live hosts only; a deploy must build the published tip.
if (!verifyOnly && commit !== git("rev-parse", "refs/remotes/origin/main"))
  throw new Error("Deploy the published main tip (git fetch origin && git merge --ff-only origin/main)");

const routes = (await Bun.file(join(root, "infra/config/routes.catalog.json")).json()) as {
  origin: string;
  hosts: Record<string, { keep: boolean; path?: string }>;
};
const origin = new URL(routes.origin).hostname;

if (!verifyOnly) {
  await run("WebOS build and staging", "bash", join(root, "crates/aphrody-webos-server/release.sh"));
  // The root activator (aphrody-webos-deploy.timer) consumes the handoff; wait for the live commit to match.
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const live = (await fetch(`https://${origin}/api/health`)
      .then(r => r.json())
      .catch(() => ({}))) as {
      sourceCommit?: string;
    };
    if (live.sourceCommit === commit) break;
    if (Date.now() > deadline) throw new Error(`WebOS activation did not reach ${commit.slice(0, 10)} in 10 minutes`);
    await Bun.sleep(5000);
  }
}

// Verify every host of the catalog: each must answer without a server or edge error (a service host may answer 404 at
// its root); hosts that moved to a path of the canonical origin should redirect and are reported otherwise.
const failures: string[] = [];
const hosts = [origin, ...Object.keys(routes.hosts)];
await Promise.all(
  hosts.map(async host => {
    const entry = routes.hosts[host];
    const res = await fetch(`https://${host}/`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(
      () => undefined,
    );
    const ok = res !== undefined && res.status < 500;
    const note = entry && !entry.keep && res && ![301, 308].includes(res.status) ? " (expected a redirect)" : "";
    console.log(`${ok ? "ok  " : "FAIL"} ${host} ${res?.status ?? "no answer"}${note}`);
    if (!ok) failures.push(host);
  }),
);
const health = (await fetch(`https://${origin}/api/health`).then(r => r.json())) as { sourceCommit?: string };
console.log(`live source commit: ${health.sourceCommit?.slice(0, 10)} (main ${commit.slice(0, 10)})`);
if (failures.length) throw new Error(`Unverified hosts: ${failures.join(", ")}`);
