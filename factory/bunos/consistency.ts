#!/usr/bin/env bun
/**
 * Repository consistency, no build (run by `buncc doctor --repo`, `just components` and the "Component manifest" CI step):
 *   bun factory/bunos/consistency.ts
 * Fails when
 *   - a pin differs between its sources (Bun runtime, Rust channel, buncc tool pins, vendor/microsoft/PINS.json vs gitlinks);
 *   - a generated document is stale (docs/ARCHITECTURE-MAP.md, the pin table of docs/BUNCC.md);
 *   - an architecture entry has no owner, no existing owner path, no resolvable entry command, doc or CI job;
 *   - a workflow is not on the map, or runs Bun without the one setup action;
 *   - a new copy of a capability that has one owner appears (raw vswhere, a second `doctor`);
 *   - a fork-only reference (toolchains/bun, bun:windows, bun msvc ...) reappears in the owned documents and packages.
 * check-components.ts keeps the module manifest, the workspace graph and the runtime pin honest; this file covers what
 * crosses those boundaries.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFacts, renderMap, root, withPins, type Entry, type Facts } from "./generate-map.ts";

const errors: string[] = [];
const warnings: string[] = [];
const strict = process.argv.includes("--strict");
const fail = (message: string) => errors.push(message);
/** Arrivals the owners have not registered yet: a warning (an error with --strict). Errors stay for real defects (pins, fork references, stale generated documents, broken entries). */
const soft = (message: string) => (strict ? errors : warnings).push(message);
const read = (path: string) => Bun.file(join(root, path)).text();
const exists = (path: string) => existsSync(join(root, path));

const git = async (...args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out.replace(/\r/g, "").split("\n").filter(Boolean);
};

const f: Facts = await loadFacts();
const a = f.architecture;
const entries: Entry[] = a.entries;
const layers = new Set<string>(a.layers.map((l: any) => l.id));
const moduleIds = new Set<string>(f.components.modules.map((m: any) => m.id));
const tracked = await git("ls-files");
const trackedSet = new Set(tracked);
const pathExists = (p: string) => exists(p) || [...trackedSet].some(t => t.startsWith(p.replace(/\/$/, "") + "/"));

// ---- 1. architecture entries ---------------------------------------------------------------------------------------
const bunccCli = await read("packages/buncc/src/cli.ts");
const bunccCases = new Set([...bunccCli.matchAll(/case "([a-z][a-z0-9-]*)"/g)].map(m => m[1]!));
const bins = new Set<string>();
for (const file of tracked.filter(t => /^packages\/[^/]+\/package\.json$/.test(t))) {
  const bin = JSON.parse(await read(file)).bin;
  if (typeof bin === "object" && bin) for (const name of Object.keys(bin)) bins.add(name);
}
const seen = new Set<string>();
for (const e of entries) {
  const at = `entry ${e.id}`;
  if (seen.has(e.id)) fail(`${at}: duplicate id`);
  seen.add(e.id);
  if (!layers.has(e.layer)) fail(`${at}: unknown layer ${e.layer}`);
  if (!["built", "ci-verified", "unverified"].includes(e.status)) fail(`${at}: unknown status ${e.status}`);
  if (e.status === "ci-verified" && !e.ci.length) fail(`${at}: ci-verified needs a CI job`);
  if (!e.owner) fail(`${at}: no owner`);
  if (e.module && !moduleIds.has(e.module)) fail(`${at}: module ${e.module} is not in components.json`);
  const missing: string[] = [];
  if (!pathExists(e.owner)) missing.push(`owner ${e.owner}`);
  for (const doc of e.docs) if (!exists(doc)) missing.push(`doc ${doc}`);
  for (const pin of e.pins) if (!exists(pin.split("#")[0]!)) missing.push(`pin file ${pin}`);
  for (const ci of e.ci) {
    const [file, job] = ci.split("#");
    const workflow = f.workflows.find(w => w.file === file);
    if (!workflow) missing.push(`workflow ${file}`);
    else if (job && !(job in workflow.jobs)) fail(`${at}: workflow ${file} has no job ${job}`);
  }
  if (e.pending) {
    soft(`${at}: pending (announced, not landed)${e.note ? `: ${e.note}` : ""}`);
    if (!missing.length) soft(`${at}: everything it announces exists now; remove "pending"`);
    if (!e.note) soft(`${at}: pending entries need a note naming the owner`);
  } else {
    for (const m of missing) fail(`${at}: ${m} does not exist (mark the entry pending until it lands)`);
    if (!e.entry.length && !e.docs.length) fail(`${at}: needs an entry command or a doc`);
  }
  for (const cmd of e.entry) {
    const [head, sub, ...more] = cmd.split(/\s+/);
    if (head === "just" && !f.recipes.has(sub!)) fail(`${at}: justfile has no recipe ${sub}`);
    else if (head === "buncc" && sub && !bunccCases.has(sub)) fail(`${at}: buncc has no command ${sub}`);
    else if (head === "aphrody-bun" || head === "aphrody-wasm") {
      if (!bins.has(head)) fail(`${at}: no package declares bin ${head}`);
    } else if (
      (head === "bash" || (head === "bun" && sub !== "test" && sub !== "run" && sub !== "--version")) &&
      sub &&
      sub.includes("/") &&
      !exists(sub)
    )
      fail(`${at}: ${cmd}: ${sub} does not exist`);
    else if (head === "bun" && sub === "test" && more[0] && !pathExists(more[0]))
      fail(`${at}: ${cmd}: ${more[0]} does not exist`);
  }
}

// every workflow on the map, one setup action
for (const w of f.workflows) {
  if (!entries.some(e => e.ci.some(c => c.startsWith(`${w.file}#`))))
    soft(`workflow ${w.file}: not referenced by any architecture entry`);
  if (!w.usesSetup && !a.noBunSetup?.[w.file])
    soft(`workflow ${w.file}: neither uses ${a.ci.setupAction} nor is listed in noBunSetup with a reason`);
}
for (const file of Object.keys(a.noBunSetup ?? {}))
  if (!f.workflows.some(w => w.file === file)) fail(`noBunSetup: ${file} is not a workflow`);
for (const req of a.ci.required) {
  const [file, job] = req.split("#");
  if (!f.workflows.find(w => w.file === file)?.jobs[job!]) fail(`ci.required ${req}: no such job`);
}
if (!exists(`${a.ci.setupAction}/action.yml`)) fail(`ci.setupAction ${a.ci.setupAction}: missing`);

// factory directories and key packages have an owner entry
const covered = (p: string) =>
  entries.some(
    e =>
      p === e.owner ||
      p.startsWith(`${e.owner}/`) ||
      e.owner.startsWith(`${p}/`) ||
      (e.covers ?? []).some((c: string) => p === c || p.startsWith(`${c}/`)),
  );
for (const dir of new Set(
  tracked.filter(t => t.startsWith("factory/") && t.includes("/", 8)).map(t => t.split("/").slice(0, 2).join("/")),
))
  if (!covered(dir)) soft(`${dir}: no architecture entry owns or covers it`);
for (const pkg of [
  "packages/buncc",
  "packages/windows",
  "packages/wasm",
  "packages/bun-workspace",
  "packages/windows-samples-tests",
])
  if (!covered(pkg)) soft(`${pkg}: no architecture entry`);
const entryModules = new Set(entries.map(e => e.module).filter(Boolean));
for (const mod of f.components.modules)
  if (
    mod.kind === "factory-module" &&
    !entryModules.has(mod.id) &&
    !(mod.id.startsWith("factory:distro/") && [...entryModules].some(m => m!.startsWith("factory:distro/")))
  )
    soft(`${mod.id}: factory module without an architecture entry`);

// ---- 2. pins -----------------------------------------------------------------------------------------------------
const runtime = f.components.runtime.source.version;
if (f.packageManager !== `bun@${runtime}`)
  fail(`pin: package.json packageManager ${f.packageManager} != components.json runtime bun@${runtime}`);
const semver = (v: string) => v.split(/[.-]/).map(n => (Number.isNaN(Number(n)) ? -1 : Number(n)));
const lessThan = (x: string, y: string) => {
  const p = semver(x),
    q = semver(y);
  for (let i = 0; i < Math.max(p.length, q.length); i++)
    if ((p[i] ?? 0) !== (q[i] ?? 0)) return (p[i] ?? 0) < (q[i] ?? 0);
  return false;
};
for (const [tool, spec] of Object.entries<any>(f.toolchain.tools ?? {})) {
  if (typeof spec.min !== "string") fail(`pin: buncc.toolchain.json ${tool} has no min`);
  else if (typeof spec.latest === "string" && lessThan(spec.latest, spec.min))
    fail(`pin: buncc.toolchain.json ${tool} latest ${spec.latest} < min ${spec.min}`);
}
if (!f.rustChannel) fail("pin: rust-toolchain.toml has no channel");
const exempt: Record<string, string> = a.pinExemptions?.nightly ?? {};
const nightly = await git(
  "grep",
  "-nIE",
  "nightly-[0-9]{4}-[0-9]{2}-[0-9]{2}",
  "--",
  ".",
  ":!vendor",
  ":!packages/re",
  ":!docs/aphrody",
  ":!*.lock",
  ":!packages/buncc/test",
);
for (const line of nightly) {
  const file = line.split(":")[0]!;
  if (Object.keys(exempt).some(p => file.startsWith(p))) continue;
  for (const m of line.matchAll(/nightly-\d{4}-\d{2}-\d{2}/g))
    if (m[0] !== f.rustChannel) fail(`pin: ${file} names ${m[0]} but rust-toolchain.toml is ${f.rustChannel}`);
}
const gitlinks = new Map<string, string>();
for (const line of await git("ls-files", "-s")) {
  const m = line.match(/^160000 (\w+) \d\t(.*)$/);
  if (m) gitlinks.set(m[2]!, m[1]!);
}
for (const [name, pin] of Object.entries<any>(f.msPins)) {
  const link = gitlinks.get(`vendor/microsoft/${name}`);
  if (link && pin.sha && link !== pin.sha)
    fail(`pin: vendor/microsoft/PINS.json ${name} ${String(pin.sha).slice(0, 12)} != gitlink ${link.slice(0, 12)}`);
  if (!link) fail(`pin: vendor/microsoft/PINS.json ${name} has no gitlink`);
}

// ---- 3. generated documents are fresh -------------------------------------------------------------------------------
const norm = (s: string) => s.replace(/\r\n/g, "\n");
if (!exists("docs/ARCHITECTURE-MAP.md") || norm(await read("docs/ARCHITECTURE-MAP.md")) !== norm(renderMap(f)))
  fail("docs/ARCHITECTURE-MAP.md is stale: run `just map` (bun factory/bunos/generate-map.ts)");
try {
  if (norm(await read("docs/BUNCC.md")) !== norm(withPins(await read("docs/BUNCC.md"), f)))
    fail("docs/BUNCC.md pin table is stale: run `just map`");
} catch (error) {
  fail(String((error as Error).message));
}
for (const doc of ["README.md", "PLAN.md"])
  if (!(await read(doc)).includes("docs/ARCHITECTURE-MAP.md")) fail(`${doc}: does not link docs/ARCHITECTURE-MAP.md`);

// ---- 4. one owner per capability ----------------------------------------------------------------------------------
const canonicalVswhere = new Set([
  "packages/buncc/src/providers/msvc.ts",
  "packages/buncc/src/providers/msvc-layout.ts",
]);
const vswhereAllowed: Record<string, string> = a.duplicatesAllowed?.vswhere ?? {};
for (const line of await git("grep", "-lI", String.raw`vswhere\.exe`, "--", "*.ts", "*.tsx", "*.js", "*.mjs")) {
  if (canonicalVswhere.has(line) || /(^|\/)test\//.test(line) || /\.test\.[tj]s$/.test(line)) continue;
  if (!vswhereAllowed[line])
    soft(
      `duplicate: ${line} runs vswhere itself; use @aphrody/buncc/msvc (or list it in architecture.json duplicatesAllowed.vswhere with a reason)`,
    );
}
for (const file of Object.keys(vswhereAllowed))
  if (!trackedSet.has(file)) fail(`duplicatesAllowed.vswhere: ${file} no longer exists; remove the entry`);
const doctors = a.doctors ?? {};
for (const line of await git(
  "grep",
  "-lE",
  String.raw`case "doctor"`,
  "--",
  "packages/buncc/*.ts",
  "packages/bun-workspace/*.ts",
  "packages/windows/*.ts",
  "packages/wasm/*.ts",
  "factory/*.ts",
  ":!factory/bunos/*.ts",
)) {
  if (line.includes("/test/") || line.endsWith(".test.ts")) continue;
  if (!doctors[line] && line !== "packages/buncc/src/cli.ts")
    soft(`duplicate: ${line} adds a doctor command; fold it into buncc doctor (architecture.json doctors)`);
}
for (const [file, how] of Object.entries<string>(doctors)) {
  if (!trackedSet.has(file)) fail(`doctors: ${file} no longer exists`);
  const script = how.split(/\s+/)[1] ?? "";
  if (!how.startsWith("bun ") || !trackedSet.has(script)) fail(`doctors: "${how}" must be "bun <tracked script> ..."`);
}
if (!bunccCli.includes("architecture.json")) fail("doctors: buncc doctor --all does not read architecture.json");

// ---- 5. fork-only references -----------------------------------------------------------------------------------------
const FORK = String.raw`toolchains/bun|bun:(windows|winrt|winui|linux|nginx|video|vpn|yolo)\b|\bbun (msvc|winmd|n2b)\b`;
const docs = [
  "BUNCC",
  "WINDOWS",
  "WSL",
  "WSLG",
  "POSIX-ON-WINDOWS",
  "MONOREPO-SCALE",
  "DISTRO-INSPIRATION",
  "WAYLAND-CLOSURE",
  "BUNCC-DESKTOP",
  "WINDOWS-SAMPLES",
  "KERNEL-ROADMAP",
].map(d => `docs/${d}.md`);
const owned = [
  "README.md",
  "PLAN.md",
  "justfile",
  ".github",
  "factory",
  "packages/buncc",
  "packages/windows",
  "packages/wasm",
  "packages/bun-workspace",
  "packages/windows-samples-tests",
  ...docs.filter(exists),
];
const allowedLine =
  /(removed|no longer|upstream (Bun )?has no|does not exist|not an upstream|fork|abandoned|legacy|replaces|replaced|instead of|was)/i;
for (const line of await git(
  "grep",
  "-nIE",
  FORK,
  "--",
  ...owned,
  ":!factory/bunos/consistency.ts",
  ":!factory/bunos/check-components.ts",
  ":!factory/bunos/architecture.json",
  ":!docs/ARCHITECTURE-MAP.md",
)) {
  const body = line.replace(/^[^:]+:\d+:/, "");
  if (!allowedLine.test(body)) fail(`fork-only reference: ${line.slice(0, 160)}`);
}

const inCi = Boolean(process.env.GITHUB_ACTIONS);
for (const line of warnings) console.warn(inCi ? `::warning title=architecture map::${line}` : `warning: ${line}`);
for (const line of errors.slice(0, 200)) console.error(inCi ? `::error title=consistency::${line}` : `error: ${line}`);
if (errors.length > 200) console.error(`... ${errors.length - 200} more`);
console.log(
  `consistency: ${entries.length} architecture entries (${entries.filter(e => e.pending).length} pending), ${f.workflows.length} workflows, ` +
    `${Object.keys(f.toolchain.tools ?? {}).length} toolchain pins, ${Object.keys(f.msPins).length} Microsoft pins; ${warnings.length} warnings, ${errors.length} errors`,
);
process.exit(errors.length ? 1 : 0);
