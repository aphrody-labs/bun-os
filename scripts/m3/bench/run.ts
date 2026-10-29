#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// m3 + yolo benchmark harness: reproduces the numbers of docs/material/m3/reports/PERF.md and enforces docs/material/m3/reports/perf-budget.json.
//
//   bun scripts/m3/bench/run.ts [--only yolo,mcp,...] [--runs N] [--repeat N] [--out snapshot.json]
//   bun scripts/m3/bench/run.ts --check [--budget docs/material/m3/reports/perf-budget.json] [--retries 2]
//   bun scripts/m3/bench/run.ts --update-budget [--baseline docs/material/m3/reports/perf-before.json]
//   bun scripts/m3/bench/run.ts --compare before.json after.json [--md]
//
// Groups (all but `build` run by default; `--cold-cache` adds a registry download to `install`):
//   yolo       `bun $YOLO_ROOT/apps/cli/src/index.ts version`, 20 runs after 3 warm-ups
//   mcp        m3-mcp cold start: spawn to the `initialize` response over stdio
//   themes     m3-os-themes: CLI wall time, and in-process import / first / warm generation
//   install    `bun install --frozen-lockfile` in a manifest-only copy of the workspace (cold node_modules, warm no-op)
//   test       `bun run test` per workspace package
//   typecheck  `bun run typecheck` per workspace package
//   lint       the oxlint step of `bun scripts/m3/yolo.ts lint`
//   tasks      the root tasks `bun scripts/m3/yolo.ts lint|typecheck|test` end to end
//   bundle     Bun.build per package: ESM, minified, split, gzip
//   compile    `bun build --compile` of the minimal M3 server and of the yolo CLI: size, build time, start time
//   build      `bun scripts/m3/yolo.ts build` (writes dist/, so opt-in)
//
/* oxlint-disable eslint/no-await-in-loop -- the harness measures serially on purpose */
// --check exits 1 when a budgeted metric exceeds its budget by more than the tolerance (default 10%). Timings that fail are
// re-measured up to --retries times and the best p50 counts, so a loaded machine does not fail the gate on noise.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { YOLO_CLI, YOLO_ROOT, plan } from "../yolo.ts";
import {
  type Budget,
  type Metric,
  type Snapshot,
  compareBudget,
  dirBytes,
  exact,
  formatValue,
  groupOf,
  pct,
  readEnv,
  sample,
  spawnTimed,
  summarize,
  timeToFirstLine,
} from "./lib.ts";
import { bundlePackage, workspacePackages } from "./workspace.ts";

const REPO = resolve(dirname(import.meta.path), "../../..");
const FIXTURES = join(import.meta.dir, "fixtures");
const BUDGET_FILE = join(REPO, "docs/material/m3/reports/perf-budget.json");
/** Per-process scratch directory, so two harness runs never clobber each other. */
const SCRATCH = join(tmpdir(), `m3-bench-${process.pid}`);

interface Ctx {
  metrics: Record<string, Metric>;
  gates: Record<string, string>;
  errors: Record<string, string>;
  /** Run-count override (--runs). */
  runs: number | undefined;
  coldCache: boolean;
  /** The metric keys a `--check` needs; undefined measures everything. */
  wanted: readonly string[] | undefined;
}

/** False only when a `--check` run needs none of the metrics under `prefix`, so the work for them can be skipped. */
const wants = (ctx: Ctx, prefix: string): boolean =>
  ctx.wanted === undefined || ctx.wanted.some(key => key.startsWith(prefix));

const runsOf = (ctx: Ctx, fallback: number): number => ctx.runs ?? fallback;
const digest = (text: string): string => Bun.hash.wyhash(text).toString(16);
const fail = (ctx: Ctx, key: string, error: unknown): void => {
  ctx.errors[key] = String((error as Error)?.message ?? error).slice(0, 300);
};

// ---------------------------------------------------------------- yolo

async function yolo(ctx: Ctx): Promise<void> {
  if (!process.env["YOLO_ROOT"])
    throw new Error(
      "Historical CLI benchmarks require an explicit YOLO_ROOT; no retired checkout is selected automatically.",
    );
  const version = ["bun", YOLO_CLI, "version"];
  ctx.metrics["yolo.version"] = summarize(await sample(() => spawnTimed(version).ms, runsOf(ctx, 20), 3));
  // The default command of a source checkout: submodule inspection (file system heavy).
  const status = ["bun", YOLO_CLI, "status", "--json"];
  ctx.metrics["yolo.status"] = summarize(await sample(() => spawnTimed(status).ms, runsOf(ctx, 12), 2));
  ctx.gates["yolo.status"] = digest(spawnTimed(status).out.replace(/"timestamp": "[^"]*"/, '"timestamp": ""'));
  const asJson = ["bun", YOLO_CLI, "version", "--json"];
  ctx.metrics["yolo.version_json"] = summarize(await sample(() => spawnTimed(asJson).ms, runsOf(ctx, 20), 3));
  // Equivalence gates: the lazy command loading must not change what any of these print or return.
  ctx.gates["yolo.version"] = spawnTimed(version).out.trim();
  const help = spawnTimed(["bun", YOLO_CLI, "help"]);
  ctx.gates["yolo.help"] = `${help.code} ${digest(help.out)}`;
  const unknown = spawnTimed(["bun", YOLO_CLI, "no-such-command"]);
  ctx.gates["yolo.unknown"] = `${unknown.code} ${digest(unknown.out)}`;
  const rt = spawnTimed(["bun", YOLO_CLI, "runtime", "info"]);
  ctx.gates["yolo.runtime_info"] = `${rt.code} ${digest(rt.out)}`;
  const check = spawnTimed(["bun", YOLO_CLI, "plugin", "check"]);
  ctx.gates["yolo.plugin_check"] = `${check.code} ${digest(check.out)}`;
}

// ---------------------------------------------------------------- mcp

const MCP_SERVER = process.env["BENCH_MCP_SERVER"] ?? join(REPO, "packages/m3-mcp/src/server.ts");
const rpc = (id: number, method: string, params: unknown = {}): string =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
const INIT = rpc(1, "initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "m3-bench", version: "0" },
});

/** Send a handshake and `calls` to the server and return every JSON-RPC response by id. */
async function mcpSession(
  server: string,
  calls: { id: number; method: string; params?: unknown }[],
): Promise<Map<number, unknown>> {
  const proc = Bun.spawn(["bun", server], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(INIT + `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  for (const c of calls) proc.stdin.write(rpc(c.id, c.method, c.params ?? {}));
  proc.stdin.flush();
  const responses = new Map<number, unknown>();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (responses.size < calls.length + 1) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      const msg = JSON.parse(line) as { id?: number };
      if (msg.id !== undefined) responses.set(msg.id, msg);
    }
  }
  proc.kill();
  await proc.exited;
  return responses;
}

const mcpToolCall = (id: number, name: string, args: unknown) => ({
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

async function mcp(ctx: Ctx): Promise<void> {
  const samples = await sample(
    async () => (await timeToFirstLine(["bun", MCP_SERVER], { stdin: INIT })).ms,
    runsOf(ctx, 10),
    2,
  );
  ctx.metrics["mcp.cold"] = summarize(samples);
  // Gates: the same tools, and the same answers from the tools that load their module on demand.

  const out = await mcpSession(MCP_SERVER, [
    { id: 2, method: "tools/list" },
    mcpToolCall(3, "m3_os_themes_list", {
      seed: "#6750a4",
      target: "all",
      name: "Aphrody",
    }),
    mcpToolCall(4, "m3_os_themes_generate", {
      seed: "#6750a4",
      target: "gnome",
      name: "Aphrody",
      path: "gnome/install-gnome.sh",
    }),
    mcpToolCall(5, "m3_symbol_search", { query: "home", limit: 20 }),
    mcpToolCall(6, "m3_symbol_svg", {
      name: "home",
      style: "outlined",
      weight: 400,
      filled: false,
    }),
    mcpToolCall(7, "m3_token_lookup", { query: "primary", limit: 10 }),
  ]);
  const names = ((out.get(2) as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools ?? [])
    .map(t => t.name)
    .toSorted();
  ctx.gates["mcp.tools"] = `${names.length} ${digest(names.join(","))}`;
  for (const id of [3, 4, 5, 6, 7])
    ctx.gates[`mcp.call.${id}`] = digest(
      JSON.stringify((out.get(id) as { result?: unknown } | undefined)?.result ?? "missing"),
    );
}

// ---------------------------------------------------------------- themes

async function themes(ctx: Ctx): Promise<void> {
  const out = join(SCRATCH, "themes-out");
  const cli = ["bun", join(REPO, "packages/m3-os-themes/src/cli.ts"), "generate", "--target", "all", "--out", out];
  ctx.metrics["themes.cli"] = summarize(await sample(() => spawnTimed(cli).ms, runsOf(ctx, 20), 3));
  const probe = ["bun", join(FIXTURES, "themes-probe.ts")];
  const rows: {
    importMs: number;
    firstMs: number;
    warmMs: number;
    files: number;
    bytes: number;
    digest: string;
  }[] = [];
  for (let i = 0; i < runsOf(ctx, 10) + 2; i++) {
    const r = spawnTimed(probe);
    if (r.code !== 0) throw new Error(`themes-probe exited ${r.code}: ${r.out.slice(0, 200)}`);
    if (i >= 2) rows.push(JSON.parse(r.out.trim().split("\n").at(-1)!));
  }
  ctx.metrics["themes.import"] = summarize(rows.map(r => r.importMs));
  ctx.metrics["themes.first"] = summarize(rows.map(r => r.firstMs));
  ctx.metrics["themes.warm"] = summarize(rows.map(r => r.warmMs));
  ctx.gates["themes.output"] = `${rows[0]!.files} files ${rows[0]!.bytes} B ${rows[0]!.digest}`;
  rmSync(out, { recursive: true, force: true });
}

// ---------------------------------------------------------------- install

/** A copy of the workspace's manifests and lockfile: everything `bun install` reads, none of the sources. */
function installFixture(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Everything the root manifest can point at: the lockfile, the registry config, the dependency patches.
  for (const file of ["package.json", "bun.lock", "bunfig.toml", ".npmrc", "patches"]) {
    if (existsSync(join(REPO, file))) cpSync(join(REPO, file), join(dir, file), { recursive: true });
  }
  for (const pkg of workspacePackages(REPO)) {
    mkdirSync(join(dir, pkg.rel), { recursive: true });
    cpSync(join(pkg.dir, "package.json"), join(dir, pkg.rel, "package.json"));
  }
}

async function install(ctx: Ctx): Promise<void> {
  const dir = join(SCRATCH, "install");
  installFixture(dir);
  const cmd = ["bun", "install", "--frozen-lockfile", "--no-progress"];
  const run = (extra: string[] = []) => spawnTimed([...cmd, ...extra], { cwd: dir });
  const first = run();
  if (first.code !== 0) throw new Error(`bun install failed: ${first.out.slice(-300)}`);
  ctx.metrics["install.nm_bytes"] = exact(dirBytes(join(dir, "node_modules")), "B");
  if (wants(ctx, "install.cold_nm"))
    ctx.metrics["install.cold_nm"] = summarize(
      await sample(
        () => {
          rmSync(join(dir, "node_modules"), { recursive: true, force: true });
          return run().ms;
        },
        runsOf(ctx, 3),
      ),
    );
  if (wants(ctx, "install.warm"))
    ctx.metrics["install.warm"] = summarize(await sample(() => run().ms, runsOf(ctx, 5), 1));
  const summary = /(\d+) packages installed|Checked (\d+) installs across (\d+) packages/.exec(run().out);
  ctx.gates["install.packages"] = summary?.[0] ?? "unknown";
  if (existsSync(join(REPO, "node_modules")))
    ctx.metrics["install.repo_nm_bytes"] = exact(dirBytes(join(REPO, "node_modules")), "B");
  const hoisted = join(SCRATCH, "install-hoisted");
  if (wants(ctx, "install.cold_nm_hoisted")) installFixture(hoisted);
  const probe = wants(ctx, "install.cold_nm_hoisted")
    ? spawnTimed([...cmd, "--linker", "hoisted"], { cwd: hoisted })
    : undefined;
  if (probe === undefined) {
    // not needed by this run
  } else if (probe.code === 0) {
    ctx.metrics["install.cold_nm_hoisted"] = summarize(
      await sample(
        () => {
          rmSync(join(hoisted, "node_modules"), {
            recursive: true,
            force: true,
          });
          return spawnTimed([...cmd, "--linker", "hoisted"], { cwd: hoisted }).ms;
        },
        runsOf(ctx, 3),
      ),
    );
    ctx.metrics["install.nm_bytes_hoisted"] = exact(dirBytes(join(hoisted, "node_modules")), "B");
  } else fail(ctx, "install.hoisted", probe.out.slice(-200));
  rmSync(hoisted, { recursive: true, force: true });
  if (ctx.coldCache) {
    const cache = join(SCRATCH, "cache");
    rmSync(cache, { recursive: true, force: true });
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    const cold = spawnTimed([...cmd, "--cache-dir", cache], { cwd: dir });
    if (cold.code === 0) {
      ctx.metrics["install.cold_cache"] = summarize([cold.ms]);
      ctx.metrics["install.cache_bytes"] = exact(dirBytes(cache), "B");
    } else fail(ctx, "install.cold_cache", cold.out.slice(-200));
    rmSync(cache, { recursive: true, force: true });
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- test, typecheck, lint, tasks

const counts = (out: string): string => {
  const pass = /^\s*(\d+) pass/m.exec(out)?.[1] ?? "?";
  const failed = /^\s*(\d+) fail/m.exec(out)?.[1] ?? "?";
  return `${pass} pass ${failed} fail`;
};

async function perPackage(ctx: Ctx, script: "test" | "typecheck"): Promise<void> {
  let sum = 0;
  for (const pkg of workspacePackages(REPO)) {
    if (!pkg.manifest.scripts?.[script]) continue;
    const cmd = ["bun", "run", script];
    let first: ReturnType<typeof spawnTimed> | undefined;
    const samples = await sample(
      () => {
        const r = spawnTimed(cmd, { cwd: pkg.dir });
        first ??= r;
        return r.ms;
      },
      runsOf(ctx, 3),
    );
    const metric = summarize(samples);
    ctx.metrics[`${script}.pkg.${pkg.id}`] = metric;
    ctx.gates[`${script}.pkg.${pkg.id}`] =
      script === "test" ? `exit ${first!.code}, ${counts(first!.out)}` : `exit ${first!.code}`;
    sum += metric.value;
  }
  ctx.metrics[`${script}.sum`] = {
    value: Math.round(sum * 1000) / 1000,
    unit: "ms",
  };
}

async function lint(ctx: Ctx): Promise<void> {
  const step = plan("lint").at(-1)!;
  ctx.metrics["lint.oxlint"] = summarize(
    await sample(() => spawnTimed(step.cmd, { cwd: step.cwd, env: step.env }).ms, runsOf(ctx, 5), 1),
  );
  const r = spawnTimed(step.cmd, { cwd: step.cwd, env: step.env });
  const count = (kind: string): number => r.out.split("\n").filter(l => l.includes(`: ${kind} `)).length;
  ctx.gates["lint.oxlint"] = `exit ${r.code}, ${count("warning")} warnings, ${count("error")} errors`;
}

async function tasks(ctx: Ctx): Promise<void> {
  for (const task of ["lint", "typecheck", "test"]) {
    if (!wants(ctx, `task.${task}`)) continue;
    const cmd = ["bun", join(REPO, "scripts/m3/yolo.ts"), task];
    let code = 0;
    const samples = await sample(
      () => {
        const r = spawnTimed(cmd, { cwd: REPO });
        code = r.code;
        return r.ms;
      },
      runsOf(ctx, 3),
      1,
    );
    ctx.metrics[`task.${task}`] = summarize(samples);
    ctx.gates[`task.${task}`] = `exit ${code}`;
  }
}

// ---------------------------------------------------------------- bundle

async function bundle(ctx: Ctx): Promise<void> {
  let js = 0;
  let gzip = 0;
  let css = 0;
  const started = performance.now();
  for (const pkg of workspacePackages(REPO)) {
    const size = await bundlePackage(pkg);
    ctx.metrics[`bundle.pkg.${pkg.id}.min`] = exact(size.jsBytes, "B");
    ctx.metrics[`bundle.pkg.${pkg.id}.gzip`] = exact(size.gzipBytes, "B");
    if (size.cssBytes > 0) ctx.metrics[`bundle.pkg.${pkg.id}.css`] = exact(size.cssBytes, "B");
    if (size.error) fail(ctx, `bundle.pkg.${pkg.id}`, size.error);
    js += size.jsBytes;
    gzip += size.gzipBytes;
    css += size.cssBytes;
  }
  ctx.metrics["bundle.total.min"] = exact(js, "B");
  ctx.metrics["bundle.total.gzip"] = exact(gzip, "B");
  ctx.metrics["bundle.total.css"] = exact(css, "B");
  ctx.metrics["bundle.time"] = exact(Math.round(performance.now() - started), "ms");
}

// ---------------------------------------------------------------- compile

/** What a tuned `bun build --compile` adds: a bytecode cache and no runtime scan for .env / bunfig.toml. */
const TUNED = ["--bytecode", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig"];

async function compileServer(ctx: Ctx, variant: "default" | "tuned"): Promise<void> {
  const exe = join(SCRATCH, `server-${variant}`);
  const cmd = [
    "bun",
    "build",
    "--compile",
    ...(variant === "tuned" ? TUNED : []),
    join(FIXTURES, "server.ts"),
    "--outfile",
    exe,
  ];
  const first = spawnTimed(cmd, { cwd: FIXTURES });
  if (first.code !== 0) throw new Error(`compile ${variant}: ${first.out.slice(-300)}`);
  const key = `compile.server_${variant}`;
  ctx.metrics[`${key}.build`] = summarize(await sample(() => spawnTimed(cmd, { cwd: FIXTURES }).ms, runsOf(ctx, 3)));
  ctx.metrics[`${key}.size`] = exact(Bun.file(exe).size, "B");
  const samples = await sample(async () => (await timeToFirstLine([exe], { cwd: SCRATCH })).ms, runsOf(ctx, 20), 3);
  ctx.metrics[`${key}.start`] = summarize(samples);
  // Gate: the executable serves the embedded HTML.
  const proc = Bun.spawn([exe], {
    cwd: SCRATCH,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  const line = await proc.stdout.getReader().read();
  const port = /ready (\d+)/.exec(new TextDecoder().decode(line.value))?.[1];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    ctx.gates[`${key}.http`] =
      `${res.status} ${res.headers.get("content-type")?.split(";")[0]} title=${body.includes("<title>m3 bench</title>")}`;
  } catch (error) {
    ctx.gates[`${key}.http`] = `error ${(error as Error).message}`;
  }
  proc.kill();
  await proc.exited;
}

async function compileYolo(ctx: Ctx): Promise<void> {
  const flagsFile = join(YOLO_ROOT, "scripts/release/compile-flags.ts");
  const flags: string[] = existsSync(flagsFile)
    ? ((await import(flagsFile)) as { COMPILE_FLAGS: string[] }).COMPILE_FLAGS
    : [];
  ctx.gates["compile.yolo.flags"] = flags.join(" ") || "(none)";
  const version = existsSync(join(YOLO_ROOT, "VERSION"))
    ? readFileSync(join(YOLO_ROOT, "VERSION"), "utf8").trim()
    : "0.0.0";
  const exe = join(SCRATCH, "yolo");
  const cmd = [
    "bun",
    "build",
    "--compile",
    "--define",
    `YOLO_VERSION=${JSON.stringify(version)}`,
    ...flags,
    "apps/cli/src/index.ts",
    "--outfile",
    exe,
  ];
  const first = spawnTimed(cmd, { cwd: YOLO_ROOT });
  if (first.code !== 0) throw new Error(`compile yolo: ${first.out.slice(-300)}`);
  ctx.metrics["compile.yolo.build"] = summarize(
    await sample(() => spawnTimed(cmd, { cwd: YOLO_ROOT }).ms, runsOf(ctx, 3)),
  );
  ctx.metrics["compile.yolo.size"] = exact(Bun.file(exe).size, "B");
  const run = ["version"];
  ctx.metrics["compile.yolo.start"] = summarize(
    await sample(() => spawnTimed([exe, ...run], { cwd: SCRATCH }).ms, runsOf(ctx, 20), 3),
  );
  const out = spawnTimed([exe, ...run], { cwd: SCRATCH });
  ctx.gates["compile.yolo.version"] = `${out.code} ${out.out.trim()}`;
  const help = spawnTimed([exe, "help"], { cwd: SCRATCH });
  ctx.gates["compile.yolo.help"] = `${help.code} ${digest(help.out)}`;
}

async function compile(ctx: Ctx): Promise<void> {
  mkdirSync(SCRATCH, { recursive: true });
  if (wants(ctx, "compile.server_default")) await compileServer(ctx, "default");
  if (wants(ctx, "compile.server_tuned")) await compileServer(ctx, "tuned");
  if (process.env["YOLO_ROOT"] && wants(ctx, "compile.yolo")) await compileYolo(ctx);
}

// ---------------------------------------------------------------- build (opt-in)

async function build(ctx: Ctx): Promise<void> {
  const cmd = ["bun", join(REPO, "scripts/m3/yolo.ts"), "build"];
  let code = 0;
  ctx.metrics["build.task"] = summarize(
    await sample(
      () => {
        const r = spawnTimed(cmd, { cwd: REPO });
        code = r.code;
        return r.ms;
      },
      runsOf(ctx, 3),
    ),
  );
  ctx.gates["build.task"] = `exit ${code}`;
}

// ---------------------------------------------------------------- driver

const GROUPS: Record<string, (ctx: Ctx) => Promise<void>> = {
  yolo,
  mcp,
  themes,
  install,
  test: ctx => perPackage(ctx, "test"),
  typecheck: ctx => perPackage(ctx, "typecheck"),
  lint,
  task: tasks,
  bundle,
  compile,
  build,
};
const DEFAULT_GROUPS = ["mcp", "themes", "install", "test", "typecheck", "lint", "task", "bundle", "compile"];

/** Metrics a freshly written budget covers: stable headline figures, not the per-package series. */
const BUDGETED = [
  "yolo.version",
  "yolo.version_json",
  "yolo.status",
  "mcp.cold",
  "themes.cli",
  "themes.first",
  "themes.warm",
  "install.nm_bytes",
  "bundle.total.min",
  "bundle.total.gzip",
  "compile.server_tuned.size",
  "compile.server_tuned.start",
  "compile.yolo.size",
  "compile.yolo.start",
  "task.lint",
];

async function measure(
  groups: string[],
  opts: { runs?: number; coldCache: boolean; wanted?: readonly string[] },
): Promise<Snapshot> {
  const ctx: Ctx = {
    metrics: {},
    gates: {},
    errors: {},
    runs: opts.runs,
    coldCache: opts.coldCache,
    wanted: opts.wanted,
  };
  const env = await readEnv({ "aphrody-m3": REPO, yolo: YOLO_ROOT });
  mkdirSync(SCRATCH, { recursive: true });
  for (const name of groups) {
    const fn = GROUPS[name];
    if (!fn) throw new Error(`unknown group ${name}; known: ${Object.keys(GROUPS).join(", ")}`);
    const started = performance.now();
    process.stderr.write(`bench ${name} ...`);
    try {
      await fn(ctx);
    } catch (error) {
      fail(ctx, name, error);
    }
    process.stderr.write(` ${Math.round(performance.now() - started)} ms\n`);
  }
  env.loadEnd = (await import("node:os")).loadavg().map(n => Math.round(n * 100) / 100);
  return {
    schema: "m3-bench/1",
    repeat: 1,
    env,
    metrics: ctx.metrics,
    gates: ctx.gates,
    errors: ctx.errors,
  };
}

function table(snapshot: Snapshot, only?: (key: string) => boolean): string {
  const rows = Object.entries(snapshot.metrics)
    .filter(([key]) => (only ? only(key) : true))
    .map(([key, m]) => {
      const spread =
        m.n && m.n > 1 ? `p95 ${formatValue(m.p95, m.unit)}, min ${formatValue(m.min, m.unit)}, n=${m.n}` : "";
      return `| ${key} | ${formatValue(m.value, m.unit)} | ${spread} |`;
    });
  return ["| metric | value | distribution |", "| --- | ---: | --- |", ...rows].join("\n");
}

function compare(before: Snapshot, after: Snapshot): string {
  // Only what both snapshots measured: a partial run (`--only yolo`) compares against the full baseline.
  const keys = Object.keys(before.metrics).filter(k => k in after.metrics);
  const lines = ["| metric | before | after | change |", "| --- | ---: | ---: | ---: |"];
  for (const key of keys) {
    const b = before.metrics[key];
    const a = after.metrics[key];
    const unit = (a ?? b)!.unit;
    const dist = (m: Metric | undefined): string =>
      m
        ? `${formatValue(m.value, unit)}${m.p95 !== undefined && m.n && m.n > 1 ? ` (p95 ${formatValue(m.p95, unit)})` : ""}`
        : "n/a";
    lines.push(`| ${key} | ${dist(b)} | ${dist(a)} | ${pct(b?.value, a?.value)} |`);
  }
  const gateKeys = Object.keys(before.gates).filter(k => k in after.gates);
  const changed = gateKeys.filter(k => before.gates[k] !== after.gates[k]);
  lines.push("", `Equivalence gates: ${gateKeys.length - changed.length} of ${gateKeys.length} identical.`);
  for (const k of changed) lines.push(`- ${k}: \`${before.gates[k] ?? "-"}\` -> \`${after.gates[k] ?? "-"}\``);
  return lines.join("\n");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(file), "utf8")) as T;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const has = (name: string): boolean => args.includes(name);
  const only = flag("--only")?.split(",");
  const runs = flag("--runs") ? Number(flag("--runs")) : undefined;

  if (has("--compare")) {
    const [a, b] = args.slice(args.indexOf("--compare") + 1);
    console.log(compare(readJson<Snapshot>(a!), readJson<Snapshot>(b!)));
    return 0;
  }

  if (has("--check")) {
    const budgetFile = flag("--budget") ?? BUDGET_FILE;
    const budget = readJson<Budget>(budgetFile);
    const retries = Number(flag("--retries") ?? 2);
    const groups = [...new Set(Object.keys(budget.metrics).map(groupOf))].filter(g => g in GROUPS);
    const errors: Record<string, string> = {};
    let best: Record<string, Metric> = {};
    let rows = compareBudget(budget, {});
    for (let attempt = 0; attempt <= retries; attempt++) {
      const needed = attempt === 0 ? groups : [...new Set(rows.filter(r => !r.ok).map(r => groupOf(r.key)))];
      if (needed.length === 0) break;
      const wanted = attempt === 0 ? Object.keys(budget.metrics) : rows.filter(r => !r.ok).map(r => r.key);
      const snap = await measure(needed, { runs, coldCache: false, wanted });
      Object.assign(errors, snap.errors);
      for (const [key, metric] of Object.entries(snap.metrics)) {
        const prev = best[key];
        if (!prev || metric.value < prev.value) best[key] = metric;
      }
      rows = compareBudget(budget, best);
      if (rows.every(r => r.ok)) break;
      if (attempt < retries)
        process.stderr.write(
          `bench check: ${rows.filter(r => !r.ok).length} over budget, re-measuring (${attempt + 1}/${retries})\n`,
        );
    }
    const lines = ["| metric | budget | measured | ratio | |", "| --- | ---: | ---: | ---: | --- |"];
    for (const r of rows) {
      lines.push(
        `| ${r.key} | ${formatValue(r.budget, r.unit)} | ${formatValue(r.actual, r.unit)} | ${r.ratio === undefined ? "n/a" : r.ratio.toFixed(2)} | ${r.ok ? "ok" : "OVER"} |`,
      );
    }
    console.log(lines.join("\n"));
    for (const [key, why] of Object.entries(errors)) console.log(`\nnot measured: ${key}: ${why}`);
    const bad = rows.filter(r => !r.ok);
    console.log(
      bad.length === 0
        ? `\nbench check: ok (tolerance ${budget.tolerance * 100}%)`
        : `\nbench check: ${bad.length} metric(s) over budget by more than ${budget.tolerance * 100}%: ${bad.map(r => r.key).join(", ")}`,
    );
    return bad.length === 0 ? 0 : 1;
  }

  const groups = only ?? [...DEFAULT_GROUPS, ...(has("--with-build") ? ["build"] : [])];
  const snapshot = await measure(groups, {
    runs,
    coldCache: has("--cold-cache"),
  });
  const repeat = Math.max(1, Number(flag("--repeat") ?? 1));
  for (let i = 1; i < repeat; i++) {
    // Another complete run: keep, per timing, the sample set with the lowest p50 (a loaded machine only ever adds time).
    const next = await measure(groups, { runs, coldCache: false });
    for (const [key, metric] of Object.entries(next.metrics)) {
      const kept = snapshot.metrics[key];
      if (!kept || (metric.unit === "ms" && metric.value < kept.value)) snapshot.metrics[key] = metric;
    }
    for (const [key, why] of Object.entries(next.errors)) snapshot.errors[key] ??= why;
    snapshot.env.loadEnd = next.env.loadEnd;
  }
  snapshot.repeat = repeat;

  if (has("--update-budget")) {
    const baselineFile = flag("--baseline");
    const baseline = baselineFile ? readJson<Snapshot>(baselineFile) : undefined;
    // A partial run (`--only bundle`) refreshes only the metrics it measured and keeps the rest of the file.
    const previous: Partial<Budget> = existsSync(BUDGET_FILE) ? readJson<Budget>(BUDGET_FILE) : {};
    const budget: Budget = {
      schema: "m3-bench-budget/1",
      tolerance: previous.tolerance ?? 0.1,
      note:
        previous.note ??
        "Lower is better. `bun scripts/m3/bench/run.ts --check` fails when a metric exceeds `value` by more than `tolerance`.",
      env: {
        bun: snapshot.env.bun,
        kernel: snapshot.env.kernel,
        wsl: snapshot.env.wsl,
        cpu: snapshot.env.cpu,
        cores: snapshot.env.cores,
      },
      metrics: { ...previous.metrics },
    };
    for (const key of BUDGETED) {
      const m = snapshot.metrics[key];
      if (!m) continue;
      const first = baseline?.metrics[key]?.value ?? previous.metrics?.[key]?.baseline;
      budget.metrics[key] = {
        value: m.value,
        unit: m.unit,
        ...(first === undefined ? {} : { baseline: first }),
      };
    }
    mkdirSync(dirname(BUDGET_FILE), { recursive: true });
    writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`);
    console.error(`bench: wrote ${BUDGET_FILE}`);
  }

  const out = flag("--out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), `${JSON.stringify(snapshot, null, 2)}\n`);
    console.error(`bench: wrote ${resolve(out)}`);
  }
  console.log(
    `bun ${snapshot.env.bun}, ${snapshot.env.cpu} x${snapshot.env.cores}, ${snapshot.env.memMiB} MiB, kernel ${snapshot.env.kernel}${snapshot.env.wsl ? " (WSL2)" : ""}, load ${snapshot.env.loadStart.join("/")} -> ${snapshot.env.loadEnd.join("/")}\n`,
  );
  console.log(table(snapshot));
  console.log(
    `\nGates:\n${Object.entries(snapshot.gates)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n")}`,
  );
  for (const [key, why] of Object.entries(snapshot.errors)) console.log(`\nnot measured: ${key}: ${why}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true });
  }
}
