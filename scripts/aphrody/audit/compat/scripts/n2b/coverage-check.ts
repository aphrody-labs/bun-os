#!/usr/bin/env bun
import { pluginStorePath } from "@aphrody/paths";
/**
 * n2b coverage audit
 *
 * Vérifie que le plugin (agents/skills/commands) et n2b (rules) couvrent
 * toutes les APIs Bun documentées dans `docs/` du fork the former Bun fork.
 *
 * Usage :
 *   bun scripts/audit/compat/scripts/n2b/coverage-check.ts              # run once, print summary + write report
 *   bun scripts/audit/compat/scripts/n2b/coverage-check.ts --json       # output structured JSON
 *   bun scripts/audit/compat/scripts/n2b/coverage-check.ts --strict     # exit 1 si coverage < threshold
 *
 * Env vars :
 *   CLAUDE_PLUGIN_ROOT    plugin root scanned for agents/skills/commands (default: plugins/aphrody, ~/plugins/aphrody,
 *                         else the aphrody plugin installed by Claude Code)
 *   N2B_DOCS_BUN          Bun docs directory (default: resolveBunDocs : APHRODY_BUN_DOCS, checkout du fork,
 *                         corpus installé, sinon téléchargement versionné au commit épinglé)
 *   N2B_COVERAGE_DIR      report output directory (default: var/audit/n2b-coverage)
 *   COVERAGE_THRESHOLD    % minimum pour --strict (default: 80)
 */

import { Glob } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { copyFile, mkdir } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import { resolveBunDocs } from "@aphrody/bun-workspace/automation/bun-upstream-docs";

const SCRIPT_DIR = dirname(import.meta.path);
// scripts/audit/compat/scripts/n2b -> repository root is five levels up.
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "..", "..");
const REPO_PLUGIN = join(REPO_ROOT, "plugins/aphrody");
function installedClaudePlugin(name: string): string | undefined {
  const registry = join(homedir(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(registry)) return undefined;
  const { plugins = {} } = JSON.parse(readFileSync(registry, "utf8")) as {
    plugins?: Record<string, Array<{ installPath?: string }>>;
  };
  return Object.entries(plugins)
    .filter(([key]) => key.startsWith(`${name}@`))
    .flatMap(([, installs]) => installs.map(install => install.installPath))
    .find((path): path is string => !!path && existsSync(path));
}
const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT ??
  [REPO_PLUGIN, pluginStorePath("aphrody")].find(path => existsSync(path)) ??
  installedClaudePlugin("aphrody");
if (!PLUGIN_ROOT || !existsSync(PLUGIN_ROOT))
  throw new Error(
    `aphrody plugin not found (CLAUDE_PLUGIN_ROOT, ${REPO_PLUGIN}, ${pluginStorePath("aphrody")}, Claude Code installed plugins)`,
  );
// docs/ of the Bun fork, read in place (Aphrody keeps no copy since lot 13 of M-produit).
const DOCS_BUN = process.env.N2B_DOCS_BUN ?? (await resolveBunDocs()).dir;
const COVERAGE_DIR = process.env.N2B_COVERAGE_DIR ?? join(REPO_ROOT, "var/audit/n2b-coverage");
const THRESHOLD = Number(process.env.COVERAGE_THRESHOLD ?? "80");

const args = new Set(process.argv.slice(2));
const FORMAT_JSON = args.has("--json");
const STRICT = args.has("--strict");
// Progress goes to stderr in --json mode so stdout stays a single JSON document.
const log = (msg: string) => (FORMAT_JSON ? console.error(msg) : console.log(msg));

// ──────────────────────────────────────────────────────────────────
// 1. Extract Bun APIs from official docs
// ──────────────────────────────────────────────────────────────────

const API_PATTERNS = [
  /\bBun\.([A-Za-z][A-Za-z0-9]*)/g, // Bun.serve, Bun.file, Bun.spawn, ...
  /\bbun:([a-z][a-z0-9-]*)/g, // bun:sqlite, bun:ffi, bun:test, ...
  /\bimport\s*[{\s,\w]*\s*from\s*['"]bun['"]/g, // import { Glob } from "bun"
];

type ApiRef = {
  api: string; // ex. "Bun.serve" | "bun:sqlite"
  category: "Bun.*" | "bun:*" | "import";
  sources: Set<string>; // files where found
};

const apiMap = new Map<string, ApiRef>();

function recordApi(api: string, category: ApiRef["category"], source: string) {
  const existing = apiMap.get(api);
  if (existing) existing.sources.add(source);
  else apiMap.set(api, { api, category, sources: new Set([source]) });
}

async function scanDocs(): Promise<number> {
  const glob = new Glob("**/*.{md,mdx}");
  let fileCount = 0;

  for await (const rel of glob.scan({ cwd: DOCS_BUN })) {
    fileCount++;
    const abs = join(DOCS_BUN, rel);
    const text = await Bun.file(abs).text();

    // Bun.foo
    for (const m of text.matchAll(API_PATTERNS[0]!)) {
      const name = `Bun.${m[1]}`;
      // Filter out common false positives (Bun. as prose)
      if (m[1] && m[1].length > 1) recordApi(name, "Bun.*", rel);
    }

    // bun:foo
    for (const m of text.matchAll(API_PATTERNS[1]!)) {
      recordApi(`bun:${m[1]}`, "bun:*", rel);
    }

    // import from "bun"
    if (API_PATTERNS[2]!.test(text)) {
      recordApi('from "bun"', "import", rel);
    }
  }

  return fileCount;
}

// ──────────────────────────────────────────────────────────────────
// 2. Load n2b rule catalogue (via CLI if available, else doc scan)
// ──────────────────────────────────────────────────────────────────

type N2bRule = { id: string; replacement: string | null; aggressive: boolean };

async function loadN2bRules(): Promise<N2bRule[]> {
  // n2b lives in the Bun fork (packages/bun-n2b); use its binary, else the aphrody multicall.
  const n2b = Bun.which("n2b");
  const aphrody = Bun.which("aphrody");
  const cmd = n2b ? [n2b] : aphrody ? [aphrody, "n2b"] : null;
  if (!cmd) return [];
  try {
    const out = await Bun.$`${cmd} rules --report json`.quiet().text();
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: any) => ({
      id: r.id ?? r.rule_id ?? "",
      replacement: r.replacement ?? r.suggestion ?? null,
      aggressive: Boolean(r.aggressive ?? r.autofix === "aggressive"),
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────
// 3. Map n2b rules → Bun APIs they target (heuristic via rule id)
// ──────────────────────────────────────────────────────────────────

// Known mapping rule-id → target Bun API
const RULE_TO_API: Record<string, string> = {
  "api/fs-readFileSync": "Bun.file",
  "api/fs-writeFileSync": "Bun.write",
  "api/fs-readFile-promise": "Bun.file",
  "api/json-parse-readFileSync": "Bun.file",
  "api/fs-existsSync": "Bun.file",
  "api/dirname-esm": "import.meta.dir",
  "api/filename-esm": "import.meta.path",
  "api/sleep-promise": "Bun.sleep",
  "api/util-inspect": "Bun.inspect",
  "api/execSync": "Bun.$",
  "api/exec": "Bun.$",
  "api/child-process-spawn": "Bun.spawn",
  "api/crypto-createHash": "Bun.hash",
  "api/http-createServer": "Bun.serve",
  "api/https-createServer": "Bun.serve",
  "api/uuid-v4": "Bun.randomUUIDv7",
  "api/toml-parse": "Bun.TOML",
  "api/semver": "Bun.semver",
  "api/performance-now": "Bun.nanoseconds",
  "api/require-resolve": "Bun.resolveSync",
  "api/process-stdout-write": "Bun.stdout",
  "api/process-stderr-write": "Bun.stderr",
  "api/process-env": "Bun.env",
  "api/path-join-dirname": "import.meta.dir",
  "api/fileURLToPath": "Bun.fileURLToPath",
};

// ──────────────────────────────────────────────────────────────────
// 4. Scan plugin (.md) for API mentions
// ──────────────────────────────────────────────────────────────────

async function scanPlugin(): Promise<Set<string>> {
  const mentioned = new Set<string>();
  const glob = new Glob("{agents,commands,skills,hooks,output-styles}/**/*.md");
  for await (const rel of glob.scan({ cwd: PLUGIN_ROOT })) {
    const text = await Bun.file(join(PLUGIN_ROOT!, rel)).text();
    for (const m of text.matchAll(API_PATTERNS[0]!)) mentioned.add(`Bun.${m[1]}`);
    for (const m of text.matchAll(API_PATTERNS[1]!)) mentioned.add(`bun:${m[1]}`);
    if (API_PATTERNS[2]!.test(text)) mentioned.add('from "bun"');
  }
  return mentioned;
}

// ──────────────────────────────────────────────────────────────────
// 5. Build coverage matrix + report
// ──────────────────────────────────────────────────────────────────

type CoverageRow = {
  api: string;
  category: string;
  in_docs: boolean;
  in_n2b: boolean;
  in_plugin: boolean;
  sources_count: number;
};

async function main() {
  log(`🔍 Scanning docs at ${relative(REPO_ROOT, DOCS_BUN)}/ ...`);
  const docFiles = await scanDocs();

  log(`📚 Loading n2b rules ...`);
  const rules = await loadN2bRules();
  const n2bTargetApis = new Set(rules.map(r => RULE_TO_API[r.id]).filter(Boolean) as string[]);

  log(`🔎 Scanning plugin mentions ...`);
  const pluginApis = await scanPlugin();

  // Build coverage rows
  const rows: CoverageRow[] = [...apiMap.values()]
    .map(r => ({
      api: r.api,
      category: r.category,
      in_docs: true,
      in_n2b: n2bTargetApis.has(r.api),
      in_plugin: pluginApis.has(r.api),
      sources_count: r.sources.size,
    }))
    .toSorted((a, b) => b.sources_count - a.sources_count || a.api.localeCompare(b.api));

  const total = rows.length;
  const pluginCov = rows.filter(r => r.in_plugin).length;
  const n2bCov = rows.filter(r => r.in_n2b).length;
  const pluginPct = Math.round((pluginCov / total) * 100);
  const n2bPct = Math.round((n2bCov / total) * 100);

  const gaps = rows.filter(r => !r.in_plugin);
  const criticalGaps = gaps.filter(r => r.sources_count >= 3); // mentionnée dans 3+ docs

  const summary = {
    timestamp: new Date().toISOString(),
    doc_files_scanned: docFiles,
    n2b_rules_loaded: rules.length,
    unique_apis_in_docs: total,
    plugin_coverage_pct: pluginPct,
    n2b_coverage_pct: n2bPct,
    critical_gaps: criticalGaps.length,
    threshold: THRESHOLD,
    passed: pluginPct >= THRESHOLD,
  };

  // Write report
  await mkdir(COVERAGE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(COVERAGE_DIR, `report-${date}.md`);
  const mdReport = renderMarkdown(summary, rows, criticalGaps);
  await Bun.write(reportPath, mdReport);
  // A plain copy instead of a symlink: works on Windows and never dangles in git.
  await copyFile(reportPath, join(COVERAGE_DIR, "latest.md"));

  // Output
  if (FORMAT_JSON) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log();
    console.log(`📊 Coverage report — ${summary.timestamp}`);
    console.log(`   Doc files scanned        : ${summary.doc_files_scanned}`);
    console.log(`   n2b rules loaded         : ${summary.n2b_rules_loaded}`);
    console.log(`   Unique Bun APIs in docs  : ${summary.unique_apis_in_docs}`);
    console.log(`   Plugin coverage          : ${pluginCov}/${total} (${pluginPct}%)`);
    console.log(`   n2b rule coverage        : ${n2bCov}/${total} (${n2bPct}%)`);
    console.log(`   Critical gaps (≥3 docs)  : ${criticalGaps.length}`);
    console.log(`   Threshold                : ${THRESHOLD}% ${summary.passed ? "✅" : "❌"}`);
    console.log();
    console.log(`   → ${relative(REPO_ROOT, reportPath)}`);
    if (criticalGaps.length > 0) {
      console.log();
      console.log(`⚠ Critical gaps (top 10) :`);
      for (const g of criticalGaps.slice(0, 10)) {
        console.log(`   ${g.api.padEnd(40)} (${g.sources_count} docs)`);
      }
    }
  }

  if (STRICT && !summary.passed) process.exit(1);
}

function renderMarkdown(summary: any, rows: CoverageRow[], gaps: CoverageRow[]): string {
  const lines: string[] = [];
  lines.push(`# n2b coverage report`);
  lines.push("");
  lines.push(`Generated : **${summary.timestamp}**`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Doc files scanned | ${summary.doc_files_scanned} |`);
  lines.push(`| n2b rules loaded | ${summary.n2b_rules_loaded} |`);
  lines.push(`| Unique Bun APIs found | ${summary.unique_apis_in_docs} |`);
  lines.push(`| Plugin coverage | **${summary.plugin_coverage_pct}%** |`);
  lines.push(`| n2b rule coverage | ${summary.n2b_coverage_pct}% |`);
  lines.push(`| Critical gaps (≥3 docs) | ${summary.critical_gaps} |`);
  lines.push(`| Threshold | ${summary.threshold}% — ${summary.passed ? "✅ passed" : "❌ failed"} |`);
  lines.push("");

  if (gaps.length > 0) {
    lines.push(`## Critical gaps — APIs not mentioned in plugin`);
    lines.push("");
    lines.push(`| API | Category | Docs |`);
    lines.push(`|---|---|---|`);
    for (const g of gaps.slice(0, 50)) {
      lines.push(`| \`${g.api}\` | ${g.category} | ${g.sources_count} |`);
    }
    lines.push("");
  }

  lines.push(`## Full matrix`);
  lines.push("");
  lines.push(`| API | Category | Docs | n2b | Plugin |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of rows) {
    lines.push(
      `| \`${r.api}\` | ${r.category} | ${r.sources_count} | ${r.in_n2b ? "✓" : ""} | ${r.in_plugin ? "✓" : ""} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

await main();
