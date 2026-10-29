// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Apply serializes reviewed file writes in the shared checkout. */
/**
 * Repository-wide audit of machine- and host-specific paths: removed checkouts (~/source, the
 * pre-monorepo superproject), absolute user homes, WSL mounts and VPS-only homes. Aphrody must run
 * from any checkout location and platform; host layouts belong to the declarations in yolo `infra/config/host`.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type HostPathRule =
  "repo-absolute" | "sibling-absolute" | "source-checkouts" | "user-home" | "vps-home" | "wsl-mount" | "legacy-layout";
/** `host` is the declared VPS catalog, `platform` a WSL/Windows tool by design `test` fixture data. */
export type HostPathArea = "platform" | "code" | "config" | "host" | "test" | "docs" | "record" | "data";
export interface HostPathFinding {
  line: number;
  rule: HostPathRule;
  match: string;
  rewrite?: string;
}
export interface HostPathFile {
  path: string;
  area: HostPathArea;
  findings: HostPathFinding[];
}

/** Retired sibling repositories map to their location inside the monorepo. */
let monorepoDirs = new Map<string, string>();

/** Crate, package and app names to their monorepo directory; names that exist twice are dropped. */
function indexMonorepo(root: string): void {
  const seen = new Map<string, string | null>();
  const add = (key: string, dir: string) => seen.set(key, seen.has(key) ? null : dir);
  for (const file of git(root, [
    "ls-files",
    "crates/*/Cargo.toml",
    "packages/*/package.json",
    "apps/*/package.json",
  ]).split("\n")) {
    const parts = file.split("/");
    if (parts.length !== 4) continue;
    const kind = parts[0] === "crates" ? "crates" : parts[0];
    add(`${kind}/${parts[2]!.replace(/^aphrody-/, "")}`, `${parts[0]}/${parts[1]}/${parts[2]}`);
  }
  monorepoDirs = new Map([...seen].filter((entry): entry is [string, string] => entry[1] !== null));
}

function legacyRewrite(match: string): string {
  if (match.startsWith("aphrody-infra/")) return match.slice("aphrody-infra/".length);
  if (match === "aphrody-contracts/docs") return "docs/apis/contracts";
  const named = /^aphrody-[a-z]+\/(crates|packages|apps)\/([\w@.-]+)$/.exec(match);
  if (named) return monorepoDirs.get(`${named[1]}/${named[2]!.replace(/^aphrody-/, "")}`) ?? match;
  return match;
}

const END = String.raw`(?=$|[/\\\s"'\x60),:;\]}>|])`;
/** Ordered: the first rule that claims a span owns it. `rewrite` applies only to prose and records. */
const RULES: {
  rule: HostPathRule;
  pattern: RegExp;
  rewrite?: (match: string) => string;
}[] = [
  {
    rule: "repo-absolute",
    pattern: new RegExp(String.raw`/home/[\w.-]+/aphrody${END}/?`, "g"),
    // A path inside the checkout becomes repository-relative; the bare root becomes "<repo>".
    rewrite: match => (match.endsWith("/") ? "" : "<repo>"),
  },
  {
    rule: "sibling-absolute",
    pattern: new RegExp(String.raw`/home/[\w.-]+/(?:yolo|iecode|aphrody-py|rg|rg-legacy-data)${END}`, "g"),
    rewrite: match => `../${match.split("/").at(-1)}`,
  },
  {
    rule: "source-checkouts",
    pattern: new RegExp(
      String.raw`(?:/home/[\w.-]+|~|\$HOME|\$\{HOME\})/source${END}|(?<![\w.-])\.\./source${END}`,
      "g",
    ),
    rewrite: () => ".cache/upstream",
  },
  {
    rule: "user-home",
    pattern:
      /(?<![\w.-])\/home\/(?!ubuntu\b)[\w.-]+(?=\/)|\/Users\/[\w.-]+(?=\/)|[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[\w.-]+/g,
    rewrite: match => (match.startsWith("/") ? "~" : "%USERPROFILE%"),
  },
  { rule: "vps-home", pattern: /\/home\/ubuntu\b/g, rewrite: () => "~" },
  { rule: "wsl-mount", pattern: /(?<![\w.-])\/mnt\/[a-z](?=\/)/g },
  {
    rule: "legacy-layout",
    pattern:
      /\baphrody-src\b|\baphrody-(?:infra|ai|web|ui|os|compat|contracts|shell|native)\/(?:scripts|crates|systemd|nginx|packages|apps|config|docs)\b(?:\/[\w@.-]+)?/g,
    rewrite: legacyRewrite,
  },
];
const PREFILTER = String.raw`/home/|/Users/|[A-Za-z]:[\\/]+Users|/mnt/[a-z]/|/source([/"'\x60[:space:])]|$)|aphrody-src|aphrody-(infra|ai|web|ui|os|compat|contracts|shell|native)/`;
const REWRITABLE: ReadonlySet<HostPathArea> = new Set<HostPathArea>(["docs", "record", "data", "code", "config"]);
/** Config files only take the retired-layout mapping; other rules need a reviewed edit. */
const CONFIG_REWRITES: ReadonlySet<HostPathRule> = new Set<HostPathRule>(["legacy-layout"]);
const canRewrite = (area: HostPathArea, rule: HostPathRule, line: string): boolean =>
  REWRITABLE.has(area) &&
  (area !== "code" || COMMENT_LINE.test(line)) &&
  (area !== "config" || CONFIG_REWRITES.has(rule));
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#(?!!)|<!--|--\s)/;
/** Rules a zone legitimately carries: fixtures and the declared VPS catalog name hosts on purpose. */
const ALLOWED: Partial<Record<HostPathArea, HostPathRule[]>> = {
  platform: ["wsl-mount"],
  host: ["vps-home", "legacy-layout"],
};

const OWN_FILES = new Set([
  "packages/bun-workspace/src/automation/host-paths.ts",
  "packages/bun-workspace/test/host-paths.test.ts",
  "infra/config/host-paths.baseline.json",
]);

export function hostPathArea(path: string): HostPathArea {
  const name = path.split("/").at(-1) ?? "";
  if (path.startsWith("infra/config/host/")) return "host";
  if (path.startsWith("infra/config/") || path.startsWith("tools/aphrody/config/")) return "config";
  if (
    !path.startsWith("docs/") &&
    !/\.(md|mdx|txt|rst|html)$/.test(name) &&
    /(^|\/)(aphrody-wsl|msvc-wsl)|\/wsl[-_./]|winclean|diagnostics\/src\/doctor\.rs$|\.ps1$/.test(path)
  )
    return "platform";
  if (/(^|\/)(examples?|benchmarks\/results|adapters)\//.test(path)) return "test";
  if (path === "crates/engine/yolo-core/src/mapper/audit.rs") return "test";
  if (/^(systemd|nginx|config\/infra)\//.test(path)) return "host";
  if (/^(config\/service-catalog\.json|\.github\/)|\/\.github\/workflows\//.test(path)) return "host";
  if (/^scripts\/(atomic-deploy-|rg\/assemble-vps|ops\/provision)/.test(path)) return "host";
  if (/^scripts\/(migration|audit\/live-candidates|test-atomic-)/.test(path)) return "host";
  if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|_tests?\.rs$|\/tests\.rs$/.test(path)) return "test";
  if (/(^|\/)data\//.test(path) || name.endsWith(".jsonl") || /\/inventaires\//.test(path)) return "data";
  if (/\.(md|mdx|txt|rst|html)$/.test(name)) return "docs";
  if (path.startsWith("docs/")) return "record";
  if (/^(config|systemd|nginx)\//.test(path) || /\.(service|timer|conf|env\.example|ya?ml|toml)$/.test(name))
    return "config";
  return "code";
}

/** Findings for one text; rewrites are offered for prose, records and data only. */
export function scanHostPaths(text: string, area: HostPathArea, rust = false): HostPathFinding[] {
  const findings: HostPathFinding[] = [];
  let inTests = false;
  for (const [index, line] of text.split("\n").entries()) {
    // Inline unit-test modules hold fixture paths, not runtime behaviour.
    if (rust && /^\s*#\[cfg\(test\)\]/.test(line)) inTests = true;
    if (inTests) continue;
    const claimed: [number, number][] = [];
    for (const { rule, pattern, rewrite } of RULES)
      for (const match of line.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (claimed.some(([a, b]) => start < b && end > a)) continue;
        claimed.push([start, end]);
        if (area === "test" || ALLOWED[area]?.includes(rule)) continue;
        // Prose and records naming a retired repository are provenance, not a machine dependency.
        if (rule === "legacy-layout" && ["docs", "record", "data"].includes(area) && rewrite?.(match[0]) === match[0])
          continue;
        findings.push({
          line: index + 1,
          rule,
          match: match[0],
          ...(rewrite && REWRITABLE.has(area) && (area !== "code" || COMMENT_LINE.test(line))
            ? { rewrite: rewrite(match[0]) }
            : {}),
        });
      }
  }
  return findings;
}

/** Apply the offered rewrites, rule by rule in RULES order, to prose, records and data. */
export function rewriteHostPaths(text: string, area: HostPathArea): string {
  if (!REWRITABLE.has(area)) return text;
  return text
    .split("\n")
    .map(line => {
      const claimed: [number, number, string][] = [];
      for (const { rule, pattern, rewrite } of RULES)
        for (const match of line.matchAll(pattern)) {
          const start = match.index;
          const end = start + match[0].length;
          if (claimed.some(([a, b]) => start < b && end > a)) continue;
          claimed.push([start, end, rewrite && canRewrite(area, rule, line) ? rewrite(match[0]) : match[0]]);
        }
      let output = "";
      let cursor = 0;
      for (const [start, end, replacement] of claimed.toSorted((a, b) => a[0] - b[0])) {
        output += line.slice(cursor, start) + replacement;
        cursor = end;
      }
      return output + line.slice(cursor);
    })
    .join("\n");
}

function git(root: string, args: string[], allowEmpty = false): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0 && !(allowEmpty && result.exitCode === 1))
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

export async function collectHostPaths(root: string): Promise<HostPathFile[]> {
  indexMonorepo(root);
  const candidates = git(root, ["grep", "-l", "-z", "-I", "-E", PREFILTER], true)
    .split("\0")
    .filter(path => path && !OWN_FILES.has(path) && existsSync(join(root, path)));
  const files = await Promise.all(
    candidates.map(async path => {
      const area = hostPathArea(path);
      // Migration records name original repositories as provenance; only machine prefixes count.
      const provenance = path.startsWith("docs/migration/");
      const findings = scanHostPaths(await Bun.file(join(root, path)).text(), area, path.endsWith(".rs")).filter(
        finding => !(provenance && finding.rule === "legacy-layout"),
      );
      return { path, area, findings };
    }),
  );
  return files.filter(file => file.findings.length).toSorted((a, b) => a.path.localeCompare(b.path));
}

type Baseline = {
  schemaVersion: 1;
  $comment?: string;
  files: Record<string, number>;
};

export async function runHostPaths(args: string[]): Promise<number> {
  let root = process.cwd();
  let markdown = false;
  let apply = false;
  let check = false;
  let writeBaseline = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = args[++i] ?? "";
    else if (arg === "--markdown") markdown = true;
    else if (arg === "--json") markdown = false;
    else if (arg === "--apply") apply = true;
    else if (arg === "--check") check = true;
    else if (arg === "--write-baseline") writeBaseline = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops path-audit --repository [--root <repository>] [--json | --markdown] [--apply] [--check] [--write-baseline]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a path");
  root = resolve(root);
  let rewritten = 0;
  const skipped: string[] = [];
  // Shared checkouts: never rewrite a file another session has modified or not yet committed.
  const dirty = new Set(
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no"])
      .split("\0")
      .filter(Boolean)
      .map(entry => entry.slice(3)),
  );
  if (apply)
    for (const file of await collectHostPaths(root)) {
      if (!file.findings.some(finding => finding.rewrite !== undefined)) continue;
      if (dirty.has(file.path)) {
        skipped.push(file.path);
        continue;
      }
      const absolute = join(root, file.path);
      const text = await Bun.file(absolute).text();
      const next = rewriteHostPaths(text, file.area);
      if (next !== text) {
        await Bun.write(absolute, next);
        rewritten++;
      }
    }
  const files = await collectHostPaths(root);
  const baselinePath = join(root, "infra/config/host-paths.baseline.json");
  const counts = Object.fromEntries(files.map(file => [file.path, file.findings.length]));
  if (writeBaseline)
    await Bun.write(
      baselinePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          $comment: "Host- and machine-specific path ratchet (yolo ops path-audit --repository). Counts may only fall.",
          files: counts,
        } satisfies Baseline,
        null,
        2,
      )}\n`,
    );
  const baseline = existsSync(baselinePath) ? ((await Bun.file(baselinePath).json()) as Baseline) : null;
  const regressions = baseline
    ? files
        .filter(file => file.findings.length > (baseline.files[file.path] ?? 0))
        .map(file => ({
          path: file.path,
          baseline: baseline.files[file.path] ?? 0,
          current: file.findings.length,
        }))
    : [];
  const all = files.flatMap(file => file.findings.map(finding => ({ ...finding, area: file.area })));
  const tally = (key: (item: (typeof all)[number]) => string) =>
    all.reduce<Record<string, number>>((acc, item) => {
      acc[key(item)] = (acc[key(item)] ?? 0) + 1;
      return acc;
    }, {});
  const report = {
    schemaVersion: 1,
    root,
    revision: git(root, ["rev-parse", "HEAD"]).trim(),
    rewrittenFiles: rewritten,
    skippedDirty: skipped,
    totals: {
      findings: all.length,
      files: files.length,
      rewritable: all.filter(item => item.rewrite !== undefined).length,
      byRule: tally(item => item.rule),
      byArea: tally(item => item.area),
    },
    ratchet: {
      baseline: baseline ? "infra/config/host-paths.baseline.json" : null,
      regressions,
    },
    files,
  };
  if (markdown) {
    const rows = files
      .toSorted((a, b) => b.findings.length - a.findings.length || a.path.localeCompare(b.path))
      .map(file => {
        const rules = [...new Set(file.findings.map(finding => finding.rule))].join(", ");
        return `| ${file.area} | \`${file.path}\` | ${file.findings.length} | ${rules} |`;
      });
    console.log(
      [
        "# Host-specific path audit",
        "",
        `Revision \`${report.revision}\`: ${all.length} findings in ${files.length} files; ${report.totals.rewritable} rewritable in prose, records and data.`,
        "",
        `By rule: ${Object.entries(report.totals.byRule)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}.`,
        `By area: ${Object.entries(report.totals.byArea)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}.`,
        ...(regressions.length
          ? ["", ...regressions.map(item => `- regression: \`${item.path}\` ${item.baseline} → ${item.current}`)]
          : []),
        "",
        "| Area | File | Findings | Rules |",
        "| --- | --- | ---: | --- |",
        ...rows,
        "",
      ].join("\n"),
    );
  } else console.log(JSON.stringify(report, null, 2));
  return check && regressions.length ? 1 : 0;
}
