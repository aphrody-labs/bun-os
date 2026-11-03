#!/usr/bin/env bun
// Publishes the plan from scripts/publish-plan.ts (docs/ops/RELEASES.md). Runs on the build host only; resumable.
//   bun scripts/publish.ts crates [--dry-run] [--limit N]
//   bun scripts/publish.ts npm [--dry-run] [--limit N]
// Gates per item: the version is not already on the registry; the name is free or already ours; `cargo publish
// --dry-run` (or `bun publish --dry-run`) passes. State: ~/.local/state/bunos-publish/<registry>.json.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false }, limit: { type: "string" } },
});
const registry = positionals[0];
if (registry !== "crates" && registry !== "npm") {
  console.error("usage: bun scripts/publish.ts <crates|npm> [--dry-run] [--limit N]");
  process.exit(2);
}
const dry = values["dry-run"]!;
const limit = Number(values.limit ?? Infinity);
const stateDir = join(homedir(), ".local", "state", "bunos-publish");
await mkdir(stateDir, { recursive: true });
const stateFile = join(stateDir, `${registry}.json`);
type Outcome = { at: string; status: "published" | "exists" | "taken" | "failed" | "verified"; detail?: string };
const state: Record<string, Outcome> = (await Bun.file(stateFile).exists()) ? await Bun.file(stateFile).json() : {};
const save = () => Bun.write(stateFile, `${JSON.stringify(state, null, 2)}\n`);
const plan = await Bun.file(join(root, "docs", "generated", "publish-plan.json")).json();
const UA = { "User-Agent": "bun-os-release (contact@aphrody.com)" };

function run(cmd: string[], cwd = root): { code: number; out: string } {
  const r = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
  });
  return { code: r.exitCode ?? 1, out: `${r.stdout}${r.stderr}` };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let done = 0;

if (registry === "crates") {
  const owner = Bun.env.CRATES_OWNER ?? "aphrody-dev";
  for (const name of plan.crates.order as string[]) {
    if (done >= limit) break;
    const member = plan.crates.members.find((m: { name: string }) => m.name === name);
    const key = `${name}@${member.version}`;
    if (["published", "exists", "taken"].includes(state[key]?.status ?? "")) continue;
    const info = await fetch(`https://crates.io/api/v1/crates/${name}`, { headers: UA });
    if (info.ok) {
      const body = (await info.json()) as { versions: { num: string }[] };
      if (body.versions.some(v => v.num === member.version)) {
        state[key] = { at: new Date().toISOString(), status: "exists" };
        await save();
        continue;
      }
      const owners = (await (
        await fetch(`https://crates.io/api/v1/crates/${name}/owners`, { headers: UA })
      ).json()) as {
        users: { login: string }[];
      };
      if (!owners.users.some(u => u.login === owner)) {
        state[key] = {
          at: new Date().toISOString(),
          status: "taken",
          detail: owners.users.map(u => u.login).join(","),
        };
        await save();
        console.log(`taken   ${key} (${state[key].detail})`);
        continue;
      }
    }
    const check = run(["cargo", "publish", "-p", name, "--dry-run", "--allow-dirty"]);
    if (check.code !== 0) {
      state[key] = {
        at: new Date().toISOString(),
        status: "failed",
        detail: check.out
          .split("\n")
          .filter(l => l.startsWith("error"))
          .slice(0, 3)
          .join(" | "),
      };
      await save();
      console.log(`failed  ${key}: ${state[key].detail}`);
      continue;
    }
    if (dry) {
      state[key] = { at: new Date().toISOString(), status: "verified" };
      await save();
      console.log(`ok      ${key} (dry run)`);
      done++;
      continue;
    }
    for (let attempt = 0; ; attempt++) {
      const pub = run(["cargo", "publish", "-p", name, "--allow-dirty", "--no-verify"]);
      if (pub.code === 0) {
        state[key] = { at: new Date().toISOString(), status: "published" };
        console.log(`publish ${key}`);
        break;
      }
      const wait = /try again after ([^.\n]+)/i.exec(pub.out)?.[1];
      if ((/429|rate limit/i.test(pub.out) || wait) && attempt < 12) {
        const until = wait ? Date.parse(wait) - Date.now() : 0;
        const ms = Math.max(60_000, Number.isFinite(until) ? until + 5_000 : 600_000);
        console.log(`wait    ${Math.round(ms / 1000)} s (crates.io rate limit)`);
        await sleep(ms);
        continue;
      }
      state[key] = {
        at: new Date().toISOString(),
        status: "failed",
        detail: pub.out
          .split("\n")
          .filter(l => l.startsWith("error"))
          .slice(0, 3)
          .join(" | "),
      };
      console.log(`failed  ${key}: ${state[key].detail}`);
      break;
    }
    await save();
    done++;
  }
} else {
  const me = run(["bun", "pm", "whoami"]).out.trim();
  for (const m of plan.npm.members as { name: string; version: string; path: string; publishable: boolean }[]) {
    if (done >= limit) break;
    if (!m.publishable) continue;
    const key = `${m.name}@${m.version}`;
    if (["published", "exists", "taken"].includes(state[key]?.status ?? "")) continue;
    const res = await fetch(`https://registry.npmjs.org/${m.name.replace("/", "%2f")}`);
    if (res.ok) {
      const doc = (await res.json()) as { versions?: Record<string, unknown>; maintainers?: { name: string }[] };
      if (doc.versions?.[m.version]) {
        state[key] = { at: new Date().toISOString(), status: "exists" };
        await save();
        continue;
      }
      if (!doc.maintainers?.some(u => u.name === me)) {
        state[key] = {
          at: new Date().toISOString(),
          status: "taken",
          detail: doc.maintainers?.map(u => u.name).join(","),
        };
        await save();
        console.log(`taken   ${key}`);
        continue;
      }
    }
    const args = ["bun", "publish", "--access", "public", ...(dry ? ["--dry-run"] : [])];
    const pub = run(args, join(root, m.path));
    state[key] = {
      at: new Date().toISOString(),
      status: pub.code === 0 ? (dry ? "verified" : "published") : "failed",
      detail:
        pub.code === 0
          ? undefined
          : pub.out
              .split("\n")
              .filter(l => /error/i.test(l))
              .slice(0, 3)
              .join(" | "),
    };
    console.log(`${state[key].status.padEnd(9)} ${key}${state[key].detail ? `: ${state[key].detail}` : ""}`);
    await save();
    done++;
  }
}
const counts: Record<string, number> = {};
for (const o of Object.values(state)) counts[o.status] = (counts[o.status] ?? 0) + 1;
console.log(`${registry}: ${JSON.stringify(counts)} (state ${stateFile})`);
