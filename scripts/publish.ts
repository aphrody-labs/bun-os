#!/usr/bin/env bun
// Publishes the plan from scripts/publish-plan.ts (docs/ops/PUBLISH.md). Runs on the build host only; resumable.
//   bun scripts/publish.ts crates [--dry-run] [--limit N] [--only external|members]
//   bun scripts/publish.ts npm [--dry-run] [--limit N]
// Gates per item: the version is not already on the registry; the name is free or already ours; `cargo publish
// --dry-run` (or `bun publish --dry-run`) passes. State: ~/.local/state/bunos-publish/<registry>.json.
// Crates: the external first-party workspaces of the plan (aphrody-labs forks patched in from git, crates in their own
// workspace) go first, each in its own topological order, then the members in plan order. crates.io allows a burst of
// new crates and then about one every ten minutes; the publisher waits out every 429 instead of failing.
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    only: { type: "string" },
  },
});
const registry = positionals[0];
if (registry !== "crates" && registry !== "npm") {
  console.error("usage: bun scripts/publish.ts <crates|npm> [--dry-run] [--limit N] [--only external|members]");
  process.exit(2);
}
const dry = values["dry-run"]!;
const limit = Number(values.limit ?? Infinity);
const stateDir = join(homedir(), ".local", "state", "bunos-publish");
await mkdir(stateDir, { recursive: true });
const stateFile = join(stateDir, `${registry}.json`);
type Status = "published" | "exists" | "taken" | "failed" | "verified" | "private" | "staged";
type Outcome = { at: string; status: Status; detail?: string };
const state: Record<string, Outcome> = (await Bun.file(stateFile).exists()) ? await Bun.file(stateFile).json() : {};
const save = () => Bun.write(stateFile, `${JSON.stringify(state, null, 2)}\n`);
const mark = async (key: string, status: Status, detail?: string) => {
  state[key] = { at: new Date().toISOString(), status, ...(detail ? { detail } : {}) };
  await save();
};
const plan = await Bun.file(join(root, "docs", "generated", "publish-plan.json")).json();
const UA = { "User-Agent": "bun-os-release (contact@aphrody.com)" };
const final = new Set<Status>(["published", "exists", "taken", "private", "staged"]);

function run(cmd: string[], cwd = root, env: Record<string, string> = {}): { code: number; out: string } {
  const r = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CARGO_TERM_COLOR: "never", ...env },
  });
  return { code: r.exitCode ?? 1, out: `${r.stdout}${r.stderr}` };
}
const errors = (out: string) =>
  out
    .split("\n")
    .filter(l => /^error|^\s+(no matching|failed to|could not|the lock)/i.test(l))
    .slice(0, 4)
    .join(" | ")
    .slice(0, 600);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let done = 0;

async function crateExists(name: string, version: string): Promise<"exists" | "taken" | "ours" | "free"> {
  const owner = Bun.env.CRATES_OWNER ?? "aphrody-dev";
  for (let attempt = 0; ; attempt++) {
    const info = await fetch(`https://crates.io/api/v1/crates/${name}`, { headers: UA });
    if (info.status === 404) return "free";
    if (!info.ok) {
      if (attempt < 5) {
        await sleep(5_000 * (attempt + 1));
        continue;
      }
      throw new Error(`crates.io ${info.status} for ${name}`);
    }
    const body = (await info.json()) as { versions: { num: string }[] };
    if (body.versions.some(v => v.num === version)) return "exists";
    const owners = (await (await fetch(`https://crates.io/api/v1/crates/${name}/owners`, { headers: UA })).json()) as {
      users: { login: string }[];
    };
    return owners.users.some(u => u.login === owner) ? "ours" : "taken";
  }
}

// One crate: registry gates, dry run, then the upload with rate-limit waits. `cwd` is the crate's workspace.
async function publishCrate(
  name: string,
  version: string,
  cwd: string,
  env: Record<string, string>,
  siblings: string[],
) {
  const key = `${name}@${version}`;
  if (final.has(state[key]?.status as Status)) return;
  if (dry && state[key]?.status === "verified") return;
  const reg = await crateExists(name, version);
  if (reg === "exists") return mark(key, "exists");
  if (reg === "taken") {
    await mark(key, "taken");
    console.log(`taken   ${key}`);
    return;
  }
  // Before the first upload, siblings are not on crates.io yet and a plain dry run of a dependent cannot resolve them:
  // the dry run packages the crate together with its unpublished workspace dependencies (cargo resolves those from the
  // packages it just built) without the verification build. The real run verifies once its deps are on crates.io.
  const check = dry
    ? run(
        ["cargo", "package", "--no-verify", "--allow-dirty", ...[name, ...siblings].flatMap(n => ["-p", n])],
        cwd,
        env,
      )
    : run(["cargo", "publish", "-p", name, "--dry-run", "--allow-dirty"], cwd, env);
  if (check.code !== 0) {
    await mark(key, "failed", errors(check.out));
    console.log(`failed  ${key}: ${state[key].detail}`);
    return;
  }
  if (dry) {
    await mark(key, "verified");
    console.log(`ok      ${key} (dry run)`);
    done++;
    return;
  }
  for (let attempt = 0; ; attempt++) {
    const pub = run(["cargo", "publish", "-p", name, "--allow-dirty", "--no-verify"], cwd, env);
    if (pub.code === 0) {
      await mark(key, "published");
      console.log(`publish ${key}`);
      break;
    }
    if (/already exists|already uploaded/i.test(pub.out)) {
      await mark(key, "exists");
      break;
    }
    const wait = /try again after ([^\n]+?)(?: or email|\.?\s*$)/im.exec(pub.out)?.[1];
    if ((/429|rate limit|too many/i.test(pub.out) || wait) && attempt < 48) {
      const until = wait ? Date.parse(wait) - Date.now() : Number.NaN;
      const ms = Math.max(60_000, Number.isFinite(until) ? until + 15_000 : 600_000);
      console.log(`wait    ${Math.round(ms / 1000)} s (crates.io rate limit, ${key})`);
      await sleep(ms);
      continue;
    }
    await mark(key, "failed", errors(pub.out));
    console.log(`failed  ${key}: ${state[key].detail}`);
    break;
  }
  done++;
}

type Meta = {
  workspace_root: string;
  workspace_members: string[];
  packages: {
    id: string;
    name: string;
    version: string;
    publish: string[] | null;
    dependencies: { name: string; kind: string | null; source: string | null; req: string }[];
  }[];
};
/// Path dependencies that must be on crates.io first: normal and build ones, and dev-dependencies with a version.
const needed = (d: { kind: string | null; source: string | null; req: string }) =>
  d.source === null && (d.kind !== "dev" || d.req !== "*");
// Topological order of the publishable members of a foreign workspace.
function workspaceOrder(dir: string): { name: string; version: string; publish: boolean; deps: string[] }[] {
  const r = run(["cargo", "metadata", "--format-version", "1", "--no-deps"], dir);
  if (r.code !== 0) throw new Error(`cargo metadata in ${dir}: ${errors(r.out)}`);
  const meta = JSON.parse(r.out.slice(r.out.indexOf("{"))) as Meta;
  const by = new Map(meta.packages.map(p => [p.name, p]));
  const out: { name: string; version: string; publish: boolean; deps: string[] }[] = [];
  const closure = (n: string, acc = new Set<string>()) => {
    for (const d of by.get(n)?.dependencies ?? [])
      if (needed(d) && by.has(d.name) && !acc.has(d.name)) {
        acc.add(d.name);
        closure(d.name, acc);
      }
    return acc;
  };
  const seen = new Set<string>();
  const visit = (n: string) => {
    const p = by.get(n);
    if (!p || seen.has(n)) return;
    seen.add(n);
    for (const d of p.dependencies) if (needed(d)) visit(d.name);
    out.push({
      name: p.name,
      version: p.version,
      publish: !(p.publish && p.publish.length === 0),
      deps: [...closure(n)],
    });
  };
  for (const p of [...meta.packages].sort((a, b) => a.name.localeCompare(b.name))) visit(p.name);
  return out;
}

// A git external is published from its default branch in a clone under ~/build/publish (outside the Bun OS
// checkout); the version on that branch is the one the members require.
function externalDir(x: { workspace: string; git?: string; path?: string }): string {
  if (x.path) return join(root, x.path);
  const dir = join(homedir(), "build", "publish", x.workspace);
  if (!existsSync(join(dir, ".git"))) {
    const c = run(["git", "clone", "--quiet", x.git!, dir], homedir());
    if (c.code !== 0) throw new Error(`clone ${x.git}: ${c.out}`);
  } else {
    const f = run(["git", "-C", dir, "fetch", "--quiet", "origin"]);
    if (f.code !== 0) throw new Error(`fetch ${x.git}: ${f.out}`);
    run(["git", "-C", dir, "checkout", "--quiet", "--detach", "origin/HEAD"]);
  }
  return dir;
}

type Member = { name: string; version: string; deps: string[] };
const byName = new Map<string, Member>((plan.crates.members as Member[]).map(m => [m.name, m]));
const memberClosure = (n: string, acc = new Set<string>()) => {
  for (const d of byName.get(n)?.deps ?? [])
    if (!acc.has(d)) {
      acc.add(d);
      memberClosure(d, acc);
    }
  return acc;
};
const unpublished = (n: string) =>
  !["published", "exists"].includes(state[`${n}@${byName.get(n)?.version}`]?.status ?? "");

if (registry === "crates") {
  if (values.only !== "members")
    for (const x of plan.crates.external as { workspace: string; git?: string; path?: string; crates: string[] }[]) {
      const dir = externalDir(x);
      const env = { CARGO_TARGET_DIR: join(homedir(), "build", "publish", "target", x.workspace.replaceAll("/", "-")) };
      for (const c of workspaceOrder(dir)) {
        if (done >= limit) break;
        if (!c.publish) {
          if (x.crates.includes(c.name)) {
            await mark(`${c.name}@${c.version}`, "private", `publish = false in ${x.workspace}`);
            console.log(`private ${c.name}@${c.version} (${x.workspace}), required by members`);
          }
          continue;
        }
        await publishCrate(c.name, c.version, dir, env, c.deps);
      }
    }
  if (values.only !== "external")
    for (const name of plan.crates.order as string[]) {
      if (done >= limit) break;
      const member = byName.get(name)!;
      await publishCrate(name, member.version, root, {}, [...memberClosure(name)].filter(unpublished));
    }
} else {
  const me = run(["bun", "pm", "whoami"]).out.trim();
  for (const m of plan.npm.members as { name: string; version: string; path: string; publishable: boolean }[]) {
    if (done >= limit) break;
    if (!m.publishable) continue;
    const key = `${m.name}@${m.version}`;
    if (final.has(state[key]?.status as Status)) continue;
    if (dry && state[key]?.status === "verified") continue;
    const res = await fetch(`https://registry.npmjs.org/${m.name.replace("/", "%2f")}`);
    if (res.ok) {
      const doc = (await res.json()) as { versions?: Record<string, unknown>; maintainers?: { name: string }[] };
      if (doc.versions?.[m.version]) {
        await mark(key, "exists");
        continue;
      }
      if (!doc.maintainers?.some(u => u.name === me)) {
        await mark(key, "taken", doc.maintainers?.map(u => u.name).join(","));
        console.log(`taken   ${key}`);
        continue;
      }
    }
    const args = ["bun", "publish", "--access", "public", ...(dry ? ["--dry-run"] : [])];
    const pub = run(args, join(root, m.path));
    // The account enforces npm staged publishing: an upload lands in the staging queue and only becomes installable
    // once a maintainer approves it with 2FA (npmjs.com, or `npm stage approve <id>`). Record that, not "published".
    const live = async () => {
      const doc = await fetch(`https://registry.npmjs.org/${m.name.replace("/", "%2f")}`, {
        headers: { "Cache-Control": "no-cache" },
      });
      return doc.ok && Boolean(((await doc.json()) as { versions?: Record<string, unknown> }).versions?.[m.version]);
    };
    const staged = /previously staged version/i.test(pub.out) || (pub.code === 0 && !dry && !(await live()));
    await mark(
      key,
      staged ? "staged" : pub.code === 0 ? (dry ? "verified" : "published") : "failed",
      staged
        ? "awaiting 2FA approval on npmjs.com"
        : pub.code === 0
          ? undefined
          : pub.out
              .split("\n")
              .filter(l => /error/i.test(l))
              .slice(0, 3)
              .join(" | "),
    );
    console.log(`${state[key].status.padEnd(9)} ${key}${state[key].detail ? `: ${state[key].detail}` : ""}`);
    done++;
  }
}
const counts: Record<string, number> = {};
for (const o of Object.values(state)) counts[o.status] = (counts[o.status] ?? 0) + 1;
console.log(`${registry}: ${JSON.stringify(counts)} (state ${stateFile})`);
