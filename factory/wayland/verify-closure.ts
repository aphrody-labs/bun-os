#!/usr/bin/env bun
/**
 * Verifies factory/wayland/closure.json and wslg-deps.json.
 *   bun factory/wayland/verify-closure.ts [--offline]
 * 1. every pin exists on its remote: tag -> peeled commit == sha (git ls-remote); gitlinks of bundled submodules and
 *    tags unreachable by ls-remote -> commit API (GitHub / GitLab); anything else is reported as "unchecked"
 * 2. the source dependency graph is cycle free and buildOrder / wslg-deps order respect every edge
 * 3. no missing dependency: every depends/makedepends entry is an item of the closure or `base:<pkg>` with <pkg> in
 *    distroBase ("provided by distro: <pkg>"); every distro item names an Arch package and version
 * Exit code 1 on any error.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const closure = await Bun.file(resolve(root, "factory/wayland/closure.json")).json();
const wslg = await Bun.file(resolve(root, "factory/wayland/wslg-deps.json")).json();
const offline = process.argv.includes("--offline");
const errors: string[] = [];
const fail = (m: string) => errors.push(m);
const items: any[] = closure.items;
const byId = new Map<string, any>(items.map(i => [i.id, i]));
const baseSet = new Set<string>(closure.distroBase);
if (byId.size !== items.length) fail("duplicate item ids");

// ---- 3. resolution
let edges = 0,
  providedByDistro = 0;
for (const it of items)
  for (const d of [...it.depends, ...it.makedepends]) {
    edges++;
    if (d.startsWith("base:")) {
      providedByDistro++;
      if (!baseSet.has(d.slice(5))) fail(`${it.id}: ${d} not in distroBase`);
    } else if (!byId.has(d)) fail(`${it.id}: dependency ${d} does not resolve inside the closure`);
  }
for (const it of items) {
  if (it.kind === "distro" && !(it.arch?.packages?.length && it.version))
    fail(`${it.id}: distro item without Arch package/version`);
  if (it.kind !== "distro" && !/^[a-f0-9]{40}$/.test(it.sha ?? "")) fail(`${it.id}: sha is not a 40-hex commit`);
  if (it.kind === "source" && !it.tag) fail(`${it.id}: source item without tag`);
}

// ---- 2. cycles and order (source + bundled items)
const srcIds = items.filter(i => i.kind !== "distro").map(i => i.id);
const srcSet = new Set(srcIds);
const indeg = new Map<string, number>(srcIds.map(i => [i, 0]));
const rev = new Map<string, string[]>();
for (const id of srcIds)
  for (const d of [...byId.get(id).depends, ...byId.get(id).makedepends])
    if (srcSet.has(d)) {
      indeg.set(id, indeg.get(id)! + 1);
      (rev.get(d) ?? rev.set(d, []).get(d)!).push(id);
    }
const q = srcIds.filter(i => indeg.get(i) === 0);
let sorted = 0;
while (q.length) {
  const n = q.pop()!;
  sorted++;
  for (const m of rev.get(n) ?? []) {
    indeg.set(m, indeg.get(m)! - 1);
    if (indeg.get(m) === 0) q.push(m);
  }
}
if (sorted !== srcIds.length) fail(`source graph has a cycle: ${srcIds.filter(i => indeg.get(i)! > 0).join(", ")}`);
const pos = new Map<string, number>((closure.buildOrder as string[]).map((id, n) => [id, n]));
for (const id of srcIds) if (!pos.has(id)) fail(`buildOrder lacks ${id}`);
for (const id of srcIds)
  for (const d of [...byId.get(id).depends, ...byId.get(id).makedepends])
    if (srcSet.has(d) && pos.get(d)! > pos.get(id)!) fail(`buildOrder: ${d} must precede ${id}`);
const wpos = new Map<string, number>(wslg.entries.map((e: any) => [e.id, e.order]));
for (const e of wslg.entries)
  for (const a of e.after) if (!(wpos.get(a)! < e.order)) fail(`wslg-deps: ${a} must precede ${e.id}`);
for (const e of wslg.entries) if (!byId.has(e.id)) fail(`wslg-deps: ${e.id} not in closure`);
// every source dependency of a WSLg entry is itself a WSLg entry
for (const e of wslg.entries)
  for (const d of [...byId.get(e.id).depends, ...byId.get(e.id).makedepends])
    if (srcSet.has(d) && !wpos.has(d)) fail(`wslg-deps: ${e.id} needs ${d} which is not an entry`);

// ---- 1. pins on remotes
const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [o, , c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return c ? "" : o;
};
const stats = { verified: 0, unchecked: [] as string[] };
async function checkPin(it: any) {
  if (it.tag) {
    const out = await run(["git", "ls-remote", it.url, `refs/tags/${it.tag}`, `refs/tags/${it.tag}^{}`]);
    const shas = out
      .split("\n")
      .filter(Boolean)
      .map(l => l.split("\t")[0]);
    if (shas.includes(it.sha)) return void stats.verified++;
    // a fork mirror may lag: fall through to the canonical URLs
    for (const u of it.urls ?? []) {
      const o2 = await run(["git", "ls-remote", u, `refs/tags/${it.tag}`, `refs/tags/${it.tag}^{}`]);
      if (
        o2
          .split("\n")
          .filter(Boolean)
          .some(l => l.split("\t")[0] === it.sha)
      )
        return void stats.verified++;
    }
    return fail(
      `${it.id}: tag ${it.tag} does not point at ${it.sha} on ${it.url} (remote: ${shas.join(",") || "tag missing"})`,
    );
  }
  const gh = it.url.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (gh) {
    const o = await run(["gh", "api", `repos/${gh[1]}/commits/${it.sha}`, "--jq", ".sha"]);
    return o.trim() === it.sha ? void stats.verified++ : fail(`${it.id}: commit ${it.sha} not found on ${it.url}`);
  }
  const gl = it.url.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (gl && /gitlab/.test(gl[1])) {
    const r = await fetch(
      `https://${gl[1]}/api/v4/projects/${encodeURIComponent(gl[2])}/repository/commits/${it.sha}`,
    ).catch(() => null);
    return r?.ok ? void stats.verified++ : fail(`${it.id}: commit ${it.sha} not found on ${it.url}`);
  }
  stats.unchecked.push(it.id);
}
if (!offline) {
  const todo = items.filter(i => i.kind !== "distro");
  let k = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (k < todo.length) await checkPin(todo[k++]);
    }),
  );
}

for (const e of errors.slice(0, 100)) console.error("error:", e);
console.log(
  `${items.length} items (${items.filter(i => i.kind === "source").length} source, ${items.filter(i => i.kind === "bundled").length} bundled, ${items.filter(i => i.kind === "distro").length} distro, ${baseSet.size} base), ${edges} edges (${providedByDistro} provided by distro base), ` +
    `${offline ? "pins not checked (--offline)" : `${stats.verified} pins verified on remote, ${stats.unchecked.length} unchecked [${stats.unchecked.join(", ")}]`}, ` +
    `${wslg.entries.length} WSLg entries, ${errors.length} errors`,
);
process.exit(errors.length ? 1 : 0);
