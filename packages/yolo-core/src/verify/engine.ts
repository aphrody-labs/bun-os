/**
 * `yolo verify`: the repository's own gates, run as a dependency graph in parallel, measured, and reported as
 * JSON (schema `yolo.verify/1`) or Markdown, so an agent can read the evidence instead of scraping logs.
 *
 *   yolo verify [--only a,b] [--changed] [--parallel N] [--timeout SECS] [--json|--md] [--out FILE]
 *   yolo verify --list [--json|--md]      the gates, their commands, dependencies and file surfaces
 *   yolo verify --last [--json|--md]      the previous report (var/verify/latest.json)
 *
 * Exit 0: every selected gate passed. 1: one failed (or was skipped because a dependency failed). 2: usage.
 * A gate that was not run is never silent: it is listed with the reason (`skipped`, or `notRun` for the heavy
 * checks that belong to the build factory or require explicit optional-provider selection). Zero dependencies.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { limiter } from "../sys/limiter";

export interface Gate {
  readonly id: string;
  readonly title: string;
  /** argv, run from the repository root */
  readonly command: readonly string[];
  /** gates that must pass first; if one fails this gate is skipped */
  readonly needs?: readonly string[];
  /** globs of repository files this gate covers (`--changed` selects a gate when one of them changed) */
  readonly surfaces: readonly string[];
  /** returns the reason to skip, or null when the gate can run */
  readonly precondition?: (root: string) => string | null;
  /** extra environment of the command */
  readonly env?: Readonly<Record<string, string>>;
}

export interface NotRun {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

const TS = ["**/*.ts", "**/*.tsx", "tsconfig.json", "package.json", "bun.lock"];

export const GATES: readonly Gate[] = [
  {
    id: "whitespace",
    title: "no whitespace errors in the diff",
    command: ["git", "diff", "--check"],
    surfaces: ["**"],
  },
  {
    id: "typecheck",
    title: "Bun native type check",
    command: ["bun", "check", "packages/", "scripts/", "test/", "m3/packages/"],
    surfaces: TS,
  },
  {
    id: "lint",
    title: "Bun native lint",
    command: ["bun", "lint", "scripts/", "test/", "packages/", "crates/infra/aphrody/src/", "m3/packages/"],
    surfaces: TS,
  },
  {
    id: "fmt-check",
    title: "Bun native format check",
    command: ["bun", "fmt", "--check", "scripts/", "test/", "packages/", "crates/infra/aphrody/src/", "m3/packages/"],
    surfaces: TS,
  },
  {
    id: "test",
    title: "Bun tests (test/)",
    command: ["bun", "test", "--timeout", "30000", "test/"],
    surfaces: [...TS, "templates/**", "packages/**", "scripts/**"],
  },
  {
    id: "rust-fmt",
    title: "rustfmt --check (yolo-core and yolo-runtime)",
    command: ["cargo", "fmt", "--check", "-p", "yolo-core", "-p", "yolo-runtime"],
    surfaces: [
      "crates/engine/yolo-core/**",
      "crates/engine/yolo-runtime/**",
      "Cargo.toml",
      "rustfmt.toml",
      ".rustfmt.toml",
    ],
  },
  {
    id: "docs",
    title: "mdBook build",
    command: ["mdbook", "build", "docs"],
    surfaces: ["docs/**", "*.md"],
  },
  {
    id: "import-check",
    title: "vendored crates equal a fresh import of the pinned submodules",
    command: ["bun", "run", "packages/engine/yolo/src/index.ts", "import", "--check", "--out", ".cache/vendor"],
    surfaces: ["vendor.toml", "vendor.lock", "crates/**", "vendor"],
    precondition: root =>
      existsSync(join(root, ".cache/vendor")) ? null : "the vendor worktree is missing (just vendor-worktree)",
  },
  {
    id: "python-lint",
    title: "ruff check (owned Python package)",
    command: ["ruff", "check", "packages/engine/python"],
    surfaces: ["packages/engine/python/**", "pyproject.toml"],
    precondition: () => (Bun.which("ruff") ? null : "ruff is not installed on PATH"),
  },
  {
    id: "python-native",
    title: "installed PyO3 extension import (workspace environment)",
    command: ["uv", "run", "--package", "yolo", "--no-sync", "--", "python", "-c", "import yolo._yolo_native"],
    surfaces: ["packages/engine/python/**", "pyproject.toml", "uv.lock"],
    precondition: () => (Bun.which("uv") ? null : "uv is not installed on PATH"),
  },
  {
    id: "python-test",
    title: "Python pytest (packages/engine/python)",
    command: [
      "uv",
      "run",
      "--package",
      "yolo",
      "--extra",
      "dev",
      "--no-sync",
      "--",
      "python",
      "-m",
      "pytest",
      "packages/engine/python/tests",
    ],
    needs: ["python-native"],
    surfaces: ["packages/engine/python/**", "pyproject.toml", "uv.lock"],
  },
];

/** Checks outside the default local core gates: heavy factory work and explicit optional-provider selection. */
export const NOT_RUN_HEAVY: readonly NotRun[] = [
  {
    id: "rust-fmt-upstream",
    title: "rustfmt --all --check (imports and optional providers)",
    reason:
      "explicit upstream profile: run just rust-fmt-upstream-check to check engine/import formatting; no compilation or reformatting, and the default core gate does not qualify these sources",
  },
  {
    id: "clippy",
    title: "strict clippy on yolo-core",
    reason: "heavy: compiles Tauri; runs through yolo ship",
  },
  {
    id: "test-crates",
    title: "cargo nextest of the workspace",
    reason: "heavy: runs through yolo ship",
  },
  {
    id: "check-workspace",
    title: "cargo check --workspace",
    reason: "heavy: runs through yolo ship",
  },
  {
    id: "deny",
    title: "cargo deny",
    reason: "network advisory data; runs through yolo ship",
  },
  {
    id: "runtime-test",
    title: "native runtime build and tests",
    reason: "heavy: runs through yolo ship",
  },
  {
    id: "python-build",
    title: "current-source PyO3 wheel build and acquisition",
    reason:
      "build yolo-pyo3 with Maturin through the serialized factory, install the verified wheel and sync the dev extra before python-native/python-test; local gates use the installed extension without rebuilding Cargo",
  },
];

export type Status = "pass" | "fail" | "skipped";

export interface GateResult {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  /** start offset from the beginning of the run, and duration, in milliseconds */
  readonly startMs: number;
  readonly durationMs: number;
  /** why a gate was skipped; the tail of the combined output for a failed one */
  readonly detail: string;
}

export interface Report {
  readonly schema: "yolo.verify/1";
  readonly startedAt: string;
  readonly root: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly selection: "all" | "only" | "changed";
  readonly parallel: number;
  /** wall-clock time of the whole run, the sum of the gates' own durations, and their ratio */
  readonly wallMs: number;
  readonly sumGateMs: number;
  readonly speedup: number;
  readonly ok: boolean;
  readonly gates: readonly GateResult[];
  readonly notRun: readonly NotRun[];
}

export interface Outcome {
  readonly exitCode: number | null;
  readonly output: string;
}
export type Runner = (gate: Gate) => Promise<Outcome>;

/** The gates selected by `--changed`: those with a surface glob that matches a changed file. */
export function selectChanged(gates: readonly Gate[], changed: readonly string[]): Gate[] {
  return gates.filter(g => g.surfaces.some(s => changed.some(f => new Bun.Glob(s).match(f))));
}

/** Check that `needs` refer to selected gates and that the graph has no cycle; throws with the reason. */
export function validateGraph(gates: readonly Gate[]): void {
  const ids = new Set(gates.map(g => g.id));
  for (const g of gates)
    for (const n of g.needs ?? []) if (!ids.has(n)) throw new Error(`gate ${g.id} needs ${n}, which is not selected`);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`dependency cycle: ${[...path, id].join(" -> ")}`);
    state.set(id, 1);
    for (const n of gates.find(g => g.id === id)?.needs ?? []) visit(n, [...path, id]);
    state.set(id, 2);
  };
  for (const g of gates) visit(g.id, []);
}

/**
 * Run the graph: a gate starts as soon as everything it needs has passed, at most `parallel` run at once, and a
 * gate whose dependency did not pass is skipped with that reason. Results keep the order of `gates`.
 */
export async function runGates(
  gates: readonly Gate[],
  run: Runner,
  options: { parallel: number; root: string; now?: () => number },
): Promise<{ results: GateResult[]; wallMs: number }> {
  validateGraph(gates);
  const now = options.now ?? ((): number => performance.now());
  const t0 = now();
  const gate = limiter(options.parallel);
  const done = new Map<string, Promise<GateResult>>();

  const start = (g: Gate): Promise<GateResult> => {
    const existing = done.get(g.id);
    if (existing !== undefined) return existing;
    const p = (async (): Promise<GateResult> => {
      const deps = await Promise.all((g.needs ?? []).map(n => start(gates.find(x => x.id === n) as Gate)));
      const base = { id: g.id, title: g.title, command: g.command };
      const bad = deps.find(d => d.status !== "pass");
      if (bad !== undefined)
        return {
          ...base,
          status: "skipped",
          exitCode: null,
          startMs: now() - t0,
          durationMs: 0,
          detail: `dependency ${bad.id} did not pass`,
        };
      const why = g.precondition?.(options.root) ?? null;
      if (why !== null)
        return {
          ...base,
          status: "skipped",
          exitCode: null,
          startMs: now() - t0,
          durationMs: 0,
          detail: why,
        };
      return gate(async () => {
        const startMs = now() - t0;
        const outcome = await run(g);
        const durationMs = now() - t0 - startMs;
        const pass = outcome.exitCode === 0;
        return {
          ...base,
          status: pass ? "pass" : "fail",
          exitCode: outcome.exitCode,
          startMs: Math.round(startMs),
          durationMs: Math.round(durationMs),
          detail: pass ? "" : outcome.output,
        };
      });
    })();
    done.set(g.id, p);
    return p;
  };
  const results = await Promise.all(gates.map(start));
  return { results, wallMs: Math.round(now() - t0) };
}

export function summarize(
  results: readonly GateResult[],
  wallMs: number,
): { sumGateMs: number; speedup: number; ok: boolean } {
  const sumGateMs = results.reduce((n, r) => n + r.durationMs, 0);
  return {
    sumGateMs,
    speedup: wallMs > 0 ? Math.round((sumGateMs / wallMs) * 100) / 100 : 1,
    ok: results.every(r => r.status === "pass"),
  };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderMarkdown(r: Report): string {
  const lines = [
    `# yolo verify: ${r.ok ? "PASS" : "FAIL"}`,
    "",
    `- commit \`${r.commit.slice(0, 12)}\`${r.dirty ? " (working tree has uncommitted changes)" : ""}, ${r.selection} gates, ${r.parallel} in parallel`,
    `- wall ${r.wallMs} ms, gates ${r.sumGateMs} ms summed, speedup ${r.speedup}x`,
    "",
    "| gate | status | exit | start ms | ms | command |",
    "| :-- | :-- | --: | --: | --: | :-- |",
    ...r.gates.map(
      g =>
        `| ${g.id} | ${g.status} | ${g.exitCode ?? "-"} | ${g.startMs} | ${g.durationMs} | \`${cell(g.command.join(" "))}\` |`,
    ),
  ];
  for (const g of r.gates.filter(x => x.detail !== "")) {
    lines.push(
      "",
      `## ${g.id}: ${g.status}`,
      "",
      g.status === "skipped" ? g.detail : "```text\n" + g.detail.trimEnd() + "\n```",
    );
  }
  lines.push("", "## Not run", "");
  const skipped = r.gates.filter(g => g.status === "skipped").map(g => `- ${g.id}: ${g.detail}`);
  const rest = r.notRun.map(n => `- ${n.id} (${n.title}): ${n.reason}`);
  lines.push(...(skipped.length + rest.length === 0 ? ["- nothing"] : [...skipped, ...rest]));
  return lines.join("\n") + "\n";
}

export function renderList(gates: readonly Gate[], notRun: readonly NotRun[], json: boolean): string {
  if (json)
    return JSON.stringify(
      {
        schema: "yolo.verify.gates/1",
        gates: gates.map(g => ({
          id: g.id,
          title: g.title,
          command: g.command,
          needs: g.needs ?? [],
          surfaces: g.surfaces,
        })),
        notRun,
      },
      null,
      2,
    );
  return [
    "| gate | command | needs |",
    "| :-- | :-- | :-- |",
    ...gates.map(g => `| ${g.id} | \`${cell(g.command.join(" "))}\` | ${(g.needs ?? []).join(", ") || "-"} |`),
    "",
    ...notRun.map(n => `- not run locally: ${n.id}: ${n.reason}`),
  ].join("\n");
}

/** Spawn a gate with a timeout; the output kept is the last 4 KiB of stdout and stderr together. */
export function spawnRunner(root: string, timeoutMs: number): Runner {
  return async gate => {
    // own process group, so a timeout kills the gate's children too instead of leaving them holding the pipes
    const proc = Bun.spawn([...gate.command], {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
      env: { ...process.env, NO_COLOR: "1", CI: "1", ...gate.env },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    }, timeoutMs);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    const output = `${out}${err}`.slice(-4096);
    return timedOut
      ? { exitCode: null, output: `timed out after ${timeoutMs} ms\n${output}` }
      : { exitCode: code, output };
  };
}

const git = (root: string, ...args: string[]): string =>
  spawnSync("git", args, {
    windowsHide: true,
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();

/** Paths changed in the working tree (staged, unstaged, untracked) relative to HEAD. */
export function changedFiles(root: string): string[] {
  return git(root, "status", "--porcelain", "-uall")
    .split("\n")
    .filter(Boolean)
    .map(l => l.slice(3).replace(/^.* -> /, ""));
}

export const reportDir = (root: string): string => join(root, "var/verify");

const VERIFY_USAGE = `Usage: yolo verify [--only a,b | --changed] [--parallel N] [--timeout SECS] [--json | --md] [--out FILE]
       yolo verify --list [--json | --md]
       yolo verify --last [--json | --md]
       yolo verify --help
Run repository gates; heavy engine checks belong to the build factory. Reports are written to var/verify/.`;

/** Validate the entire argv before reading reports, inspecting Git or starting a gate. */
function parseVerifyArgs(args: readonly string[]): Map<string, string | true> {
  const flags = new Set(["--help", "--json", "--md", "--list", "--last", "--changed"]);
  const values = new Set(["--only", "--parallel", "--timeout", "--out"]);
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index] === "-h" ? "--help" : args[index]!;
    if (!flags.has(option) && !values.has(option))
      throw new Error(`unknown option: ${option} (see yolo verify --help)`);
    if (parsed.has(option)) throw new Error(`duplicate option: ${option}`);
    if (flags.has(option)) {
      parsed.set(option, true);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("-")) throw new Error(`missing value for ${option}`);
    parsed.set(option, value);
  }
  for (const [a, b] of [
    ["--json", "--md"],
    ["--only", "--changed"],
    ["--list", "--last"],
  ]) {
    if (parsed.has(a!) && parsed.has(b!)) throw new Error(`${a} and ${b} cannot be combined`);
  }
  if (parsed.has("--list") || parsed.has("--last")) {
    for (const option of ["--only", "--changed", "--parallel", "--timeout", "--out"])
      if (parsed.has(option)) throw new Error(`${option} requires a gate run`);
  }
  const only = parsed.get("--only");
  if (typeof only === "string" && only.split(",").some(name => !name.trim()))
    throw new Error("--only requires a comma-separated list of gate names");
  const parallel = parsed.get("--parallel");
  if (typeof parallel === "string" && (!Number.isSafeInteger(Number(parallel)) || Number(parallel) < 1))
    throw new Error("--parallel must be a positive integer");
  const timeout = parsed.get("--timeout");
  if (typeof timeout === "string") {
    const milliseconds = Number(timeout) * 1000;
    if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647)
      throw new Error("--timeout must be positive seconds between 0.001 and 2147483.647");
  }
  return parsed;
}

export async function runVerifyCommand(
  args: readonly string[],
  root: string,
  deps: {
    gates?: readonly Gate[];
    run?: Runner;
    out?: (s: string) => void;
    err?: (s: string) => void;
    cpus?: number;
  } = {},
): Promise<number> {
  const out = deps.out ?? ((s: string): void => console.log(s));
  const err = deps.err ?? ((s: string): void => console.error(s));
  let parsed: ReturnType<typeof parseVerifyArgs>;
  try {
    parsed = parseVerifyArgs(args);
  } catch (error) {
    err(`yolo verify: ${(error as Error).message}`);
    return 2;
  }
  const flag = (n: string): string | undefined => {
    const value = parsed.get(n);
    return typeof value === "string" ? value : undefined;
  };
  const has = (n: string): boolean => parsed.has(n);
  if (has("--help")) {
    out(VERIFY_USAGE);
    return 0;
  }
  const json = has("--json");
  const catalog = deps.gates ?? GATES;

  if (has("--list")) {
    out(renderList(catalog, NOT_RUN_HEAVY, json));
    return 0;
  }
  if (has("--last")) {
    const file = join(reportDir(root), "latest.json");
    if (!existsSync(file)) {
      err("no previous report (var/verify/latest.json)");
      return 2;
    }
    const last = JSON.parse(readFileSync(file, "utf8")) as Report;
    out(json ? JSON.stringify(last, null, 2) : renderMarkdown(last));
    return last.ok ? 0 : 1;
  }

  let selected = [...catalog];
  let selection: Report["selection"] = "all";
  const only = flag("--only");
  if (only !== undefined) {
    const want = only.split(",").filter(Boolean);
    const unknown = want.filter(w => !catalog.some(g => g.id === w));
    if (unknown.length > 0) {
      err(`unknown gate(s): ${unknown.join(", ")} (see yolo verify --list)`);
      return 2;
    }
    selected = catalog.filter(g => want.includes(g.id));
    selection = "only";
  } else if (has("--changed")) {
    selected = selectChanged(catalog, changedFiles(root));
    selection = "changed";
  }
  const selectedIds = new Set(selected.map(gate => gate.id));
  for (const gate of selected) {
    for (const id of gate.needs ?? []) {
      if (selectedIds.has(id)) continue;
      const dependency = catalog.find(entry => entry.id === id);
      if (dependency) {
        selectedIds.add(id);
        selected.push(dependency);
      }
    }
  }
  selected = catalog.filter(gate => selectedIds.has(gate.id));
  const parallel = Math.max(1, Number(flag("--parallel") ?? deps.cpus ?? navigator.hardwareConcurrency ?? 4));
  const timeoutMs = Number(flag("--timeout") ?? 900) * 1000;
  const startedAt = new Date().toISOString();

  let outcome: Awaited<ReturnType<typeof runGates>>;
  try {
    outcome = await runGates(selected, deps.run ?? spawnRunner(root, timeoutMs), {
      parallel,
      root,
    });
  } catch (e) {
    err(`yolo verify: ${(e as Error).message}`);
    return 2;
  }
  const sum = summarize(outcome.results, outcome.wallMs);
  const report: Report = {
    schema: "yolo.verify/1",
    startedAt,
    root,
    commit: git(root, "rev-parse", "HEAD"),
    dirty: git(root, "status", "--porcelain") !== "",
    selection,
    parallel,
    wallMs: outcome.wallMs,
    ...sum,
    gates: outcome.results,
    notRun: NOT_RUN_HEAVY,
  };
  const text = json ? JSON.stringify(report, null, 2) : renderMarkdown(report);
  const dir = reportDir(root);
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(join(dir, "latest.json"), body);
  writeFileSync(join(dir, `${startedAt.replaceAll(/[:.]/g, "-")}.json`), body);
  const file = flag("--out");
  if (file !== undefined) writeFileSync(file, text + (text.endsWith("\n") ? "" : "\n"));
  out(text);
  return report.ok ? 0 : 1;
}
