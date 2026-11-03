// SPDX-License-Identifier: MIT
// `bunos rename`, `bunos docs`, `bunos parse` and `bunos bench`: the aphrody-labs/bun fork's built-in developer
// commands (`bun rename|docs|parse|bench`, fork src/js/eval/devtools.ts, last fork change 62fcdb38ec9) on
// unmodified upstream Bun. Everything here is public Bun API (Bun.Transpiler, Bun.Glob, Bun.stripANSI), so the
// port is the fork source with an exported entry point instead of the engine's `bun -e` boot.
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const COMMANDS = ["rename", "docs", "parse", "bench"] as const;
export type DevtoolsCommand = (typeof COMMANDS)[number];

const colors = Bun.enableANSIColors && process.stdout.isTTY;
const paint = (code: string, text: string) => (colors ? `\x1b[${code}m${text}\x1b[0m` : text);

class UsageError extends Error {}

type FlagSpec = Record<string, { type: "boolean" | "string" | "strings"; short?: string }>;

function parseFlags(args: string[], spec: FlagSpec) {
  const flags: Record<string, any> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    let name: string | undefined;
    let value: string | undefined;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      value = eq === -1 ? undefined : arg.slice(eq + 1);
    } else {
      name = Object.keys(spec).find(key => spec[key]!.short === arg.slice(1));
    }
    const kind = name !== undefined ? spec[name] : undefined;
    if (!kind) throw new UsageError(`Unknown option ${arg}`);
    if (kind.type === "boolean") {
      flags[name!] = value === undefined ? true : value !== "false";
      continue;
    }
    if (value === undefined) {
      value = args[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
    }
    if (kind.type === "strings") (flags[name!] ??= []).push(value);
    else flags[name!] = value;
  }
  return { flags, positionals };
}

// ─── rename ──────────────────────────────────────────────────────────────────
//
// Literal rules with identifier boundaries on git-tracked and non-ignored untracked files. Dry-run by
// default; --apply first writes a private JSONL journal (original bytes, SHA-256 before and after)
// that --restore replays, refusing files edited since.

interface RenameRule {
  from: string;
  to: string;
}

interface JournalEntry {
  path: string;
  destination: string;
  replacements: number;
  before: string;
  after: string;
  originalBase64: string;
  mode: number;
}

const RENAME_EXCLUDES = ["**/CHANGELOG*", "**/LICENSE*", "**/node_modules/**"];
const IDENT = /[\p{L}\p{N}\p{M}_$-]/u;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const readBytes = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A match is skipped when an identifier character touches it on the left, or on the right when the
 * pattern itself ends with one (so `@scope/` also renames `@scope/pkg`). */
function applyRules(input: string, rules: readonly RenameRule[]): { output: string; count: number } {
  let output = input;
  let count = 0;
  for (const rule of rules) {
    if (!rule.from) throw new UsageError("--from must not be empty");
    if (!output.includes(rule.from)) continue;
    const endsWithIdent = IDENT.test([...rule.from].at(-1)!);
    output = output.replace(new RegExp(escapeRegExp(rule.from), "g"), (match, offset: number, whole: string) => {
      const prev = whole.slice(Math.max(0, offset - 2), offset).match(/.$/u)?.[0];
      if (prev !== undefined && IDENT.test(prev)) return match;
      const next = whole
        .slice(offset + match.length)
        [Symbol.iterator]()
        .next().value;
      if (endsWithIdent && next !== undefined && IDENT.test(next)) return match;
      count++;
      return rule.to;
    });
  }
  return { output, count };
}

function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

async function gitFiles(cwd: string): Promise<string[]> {
  await using proc = Bun.spawn({
    cmd: ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new UsageError(`git ls-files failed in ${cwd}: ${err.trim()}`);
  return out.split("\0").filter(Boolean);
}

async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** Rejects traversal, `.git`, symlink components and non-file leaves (missing leaves allowed with `missing`). */
function safePath(root: string, path: string, missing = false): string {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).includes(".git"))
    throw new Error(`Unsafe path: ${path}`);
  let current = root;
  const parts = rel.split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]!);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error: any) {
      if (missing && error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symlink rejected: ${path}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Non-directory ancestor: ${path}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Not a regular file: ${path}`);
  }
  return abs;
}

function atomicWrite(path: string, bytes: Uint8Array, mode: number) {
  const temporary = resolve(dirname(path), `.bun-rename-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: mode & 0o777 });
    chmodSync(temporary, mode & 0o777);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function checkPlan(root: string, entries: readonly JournalEntry[], restore = false) {
  const destinations = new Set<string>();
  const sources = new Set<string>();
  await pool(entries, 16, async entry => {
    const source = safePath(root, restore ? entry.destination : entry.path);
    if (sources.has(source)) throw new Error(`Duplicate source: ${source}`);
    sources.add(source);
    const destination = safePath(root, restore ? entry.path : entry.destination, true);
    if (destinations.has(destination)) throw new Error(`Path collision: ${destination}`);
    destinations.add(destination);
    if (source !== destination && existsSync(destination)) throw new Error(`Destination exists: ${destination}`);
    if (sha256(await readBytes(source)) !== (restore ? entry.after : entry.before))
      throw new Error(`File changed since ${restore ? "rename" : "planning"}: ${source}`);
  });
  for (const destination of destinations) {
    let ancestor = dirname(destination);
    while (ancestor !== root) {
      if (destinations.has(ancestor)) throw new Error(`Destination ancestor collision: ${ancestor}`);
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
}

interface RenameOptions {
  cwd: string;
  rules: RenameRule[];
  apply: boolean;
  paths: boolean;
  include: string[];
  exclude: string[];
  journalDir: string;
}

async function renameTree(options: RenameOptions) {
  const started = Bun.nanoseconds();
  const cwd = realpathSync(options.cwd);
  const journalRelative = relative(cwd, options.journalDir).split(sep).join("/");
  const excludes = options.exclude.map(pattern => new Bun.Glob(pattern));
  const includes = options.include.map(pattern => new Bun.Glob(pattern));
  const files = [...new Set(await gitFiles(cwd))].filter(
    file =>
      file !== journalRelative &&
      !file.startsWith(journalRelative + "/") &&
      !excludes.some(glob => glob.match(file)) &&
      (includes.length === 0 || includes.some(glob => glob.match(file))),
  );
  const entries: JournalEntry[] = [];
  const outputs = new Map<string, Uint8Array>();
  let skippedBinary = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  await pool(files, Math.max(16, navigator.hardwareConcurrency * 8), async rel => {
    const abs = safePath(cwd, rel);
    const bytes = await readBytes(abs);
    let output = bytes;
    let count = 0;
    if (isBinary(bytes)) skippedBinary++;
    else {
      let text: string | undefined;
      try {
        text = decoder.decode(bytes);
      } catch {
        skippedBinary++;
      }
      if (text !== undefined) {
        const result = applyRules(text, options.rules);
        count = result.count;
        if (count) output = new TextEncoder().encode(result.output);
      }
    }
    const destination = options.paths ? applyRules(rel, options.rules).output : rel;
    if (!count && destination === rel) return;
    entries.push({
      path: rel,
      destination,
      replacements: count,
      before: sha256(bytes),
      after: sha256(output),
      originalBase64: Buffer.from(bytes).toString("base64"),
      mode: lstatSync(abs).mode,
    });
    outputs.set(rel, output);
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  await checkPlan(cwd, entries);
  let journal: string | undefined;
  if (options.apply && entries.length) {
    mkdirSync(options.journalDir, { recursive: true, mode: 0o700 });
    if (realpathSync(options.journalDir) !== resolve(options.journalDir))
      throw new Error("Symlinked journal directory rejected");
    journal = resolve(options.journalDir, `rename-${randomUUID()}.jsonl`);
    writeFileSync(journal, [{ version: 2, cwd }, ...entries].map(e => JSON.stringify(e)).join("\n") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    for (const entry of entries) {
      const { path, destination: destinationPath } = entry;
      const source = safePath(cwd, path);
      if (sha256(await readBytes(source)) !== entry.before) throw new Error(`Concurrent edit: ${path}`);
      if (entry.replacements) atomicWrite(source, outputs.get(path)!, entry.mode);
      if (destinationPath !== path) {
        const destination = safePath(cwd, destinationPath, true);
        if (existsSync(destination)) throw new Error(`Destination exists: ${destinationPath}`);
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(source, destination);
      }
    }
  }
  return {
    cwd,
    scanned: files.length,
    skippedBinary,
    changedFiles: entries.filter(e => e.replacements > 0).length,
    replacements: entries.reduce((n, e) => n + e.replacements, 0),
    renamedPaths: entries.filter(e => e.path !== e.destination).length,
    files: entries.map(e => ({
      path: e.path,
      destination: e.destination,
      replacements: e.replacements,
    })),
    applied: options.apply,
    elapsedMs: Number(((Bun.nanoseconds() - started) / 1e6).toFixed(3)),
    journal,
  };
}

async function restoreJournal(journalPath: string, apply: boolean) {
  const records = (await Bun.file(journalPath).text())
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  const header = records.shift();
  if (header?.version !== 2 || typeof header.cwd !== "string") throw new Error("Unsupported rename journal");
  const cwd = realpathSync(header.cwd);
  const entries = records as JournalEntry[];
  for (const entry of entries) {
    if (
      typeof entry.path !== "string" ||
      typeof entry.destination !== "string" ||
      typeof entry.originalBase64 !== "string" ||
      !Number.isInteger(entry.mode)
    )
      throw new Error("Invalid journal entry");
    if (sha256(Buffer.from(entry.originalBase64, "base64")) !== entry.before)
      throw new Error(`Corrupt journal backup: ${entry.path}`);
  }
  // An interrupted --apply can leave entries untouched, or rewritten but not yet moved.
  const pending: JournalEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const { path, destination } = entry;
    if (seen.has(path)) throw new Error(`Duplicate journal path: ${path}`);
    seen.add(path);
    const original = safePath(cwd, path, true);
    const renamed = safePath(cwd, destination, true);
    if (existsSync(original)) {
      const current = sha256(await readBytes(original));
      if (path !== destination && existsSync(renamed)) throw new Error(`Restore collision: ${path}`);
      if (current === entry.before) continue;
      if (current === entry.after) {
        pending.push({ ...entry, destination: path });
        continue;
      }
      throw new Error(`File changed since rename: ${path}`);
    }
    pending.push(entry);
  }
  await checkPlan(cwd, pending, true);
  if (apply)
    for (const entry of pending) {
      const source = safePath(cwd, entry.destination);
      if (sha256(await readBytes(source)) !== entry.after) throw new Error(`Concurrent edit: ${entry.destination}`);
      const destination = safePath(cwd, entry.path, true);
      if (source !== destination) {
        if (existsSync(destination)) throw new Error(`Destination exists: ${entry.path}`);
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(source, destination);
      }
      writeFileSync(destination, Buffer.from(entry.originalBase64, "base64"));
      chmodSync(destination, entry.mode & 0o777);
    }
  return { files: pending.length, applied: apply };
}

const RENAME_HELP = `Usage: bunos rename --from <text> --to <text> [...rules] [flags] [dir...]
       bunos rename --restore <journal> [--apply]

Renames literal text across the git-tracked and non-ignored untracked files of each dir (default: .).
A match next to an identifier character is skipped. Dry-run unless --apply.

Flags:
  --from <text> --to <text>   A rule; repeat the pair for more rules
  --rules <file.json>         Rules as [{ "from": "...", "to": "..." }]
  --paths                     Also rename matching file paths
  --include <glob>            Only these files (repeatable)
  --exclude <glob>            Skip these files (repeatable; CHANGELOG, LICENSE, node_modules always)
  --apply                     Write, after saving a journal under --journal-dir (default .cache/bun-rename)
  --restore <journal>         Undo an --apply (dry-run unless --apply); refuses files edited since
  --json                      Machine-readable report`;

async function rename(args: string[], cwd: string): Promise<number> {
  const { flags, positionals } = parseFlags(args, {
    from: { type: "strings" },
    to: { type: "strings" },
    rules: { type: "string" },
    paths: { type: "boolean" },
    include: { type: "strings" },
    exclude: { type: "strings" },
    apply: { type: "boolean" },
    restore: { type: "string" },
    "journal-dir": { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    console.log(RENAME_HELP);
    return 0;
  }
  const restore = flags.restore;
  if (restore) {
    const report = await restoreJournal(resolve(cwd, restore), !!flags.apply);
    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else console.log(`restore: ${report.files} file(s) (${report.applied ? "applied" : "dry-run"})`);
    return 0;
  }
  const from: string[] = flags.from ?? [];
  const to: string[] = flags.to ?? [];
  if (from.length !== to.length) throw new UsageError("Each --from needs a --to");
  const rules: RenameRule[] = from.map((text, i) => ({ from: text, to: to[i]! }));
  const rulesFile = flags.rules;
  if (rulesFile) {
    const extra = JSON.parse(readFileSync(resolve(cwd, rulesFile), "utf8"));
    if (!Array.isArray(extra) || extra.some(r => typeof r?.from !== "string" || typeof r?.to !== "string"))
      throw new UsageError(`${rulesFile}: expected [{ "from": "...", "to": "..." }]`);
    rules.push(...extra);
  }
  if (rules.length === 0) throw new UsageError(`No rules: pass --from and --to, or --rules\n\n${RENAME_HELP}`);
  if (rules.some(rule => !rule.from)) throw new UsageError("--from must not be empty");

  const targets = positionals.length ? positionals : ["."];
  const base = {
    rules,
    paths: !!flags.paths,
    include: flags.include ?? [],
    exclude: [...RENAME_EXCLUDES, ...(flags.exclude ?? [])],
    journalDir: resolve(cwd, flags["journal-dir"] ?? ".cache/bun-rename"),
  };
  // Preflight every target before the first write.
  if (flags.apply) for (const target of targets) await renameTree({ ...base, cwd: resolve(cwd, target), apply: false });
  const reports: Awaited<ReturnType<typeof renameTree>>[] = [];
  for (const target of targets)
    reports.push(await renameTree({ ...base, cwd: resolve(cwd, target), apply: !!flags.apply }));

  if (flags.json) {
    console.log(JSON.stringify({ schema: "bun.rename/1", rules, reports }, null, 2));
    return 0;
  }
  console.log(
    `${paint("1", "rename")} ${flags.apply ? "apply" : "dry-run"}: ${rules.map(r => `${r.from} -> ${r.to}`).join(", ")}`,
  );
  for (const [i, report] of reports.entries()) {
    console.log(
      `  ${targets[i]}: ${report.changedFiles} file(s), ${report.replacements} replacement(s)` +
        `${flags.paths ? `, ${report.renamedPaths} path(s)` : ""} (scanned ${report.scanned}, binary ${report.skippedBinary}, ${report.elapsedMs.toFixed(0)} ms)`,
    );
    for (const file of report.files)
      console.log(
        `    ${file.path}${file.destination !== file.path ? ` -> ${file.destination}` : ""}${file.replacements ? ` (${file.replacements})` : ""}`,
      );
    const journal = report.journal;
    if (journal) console.log(`    journal: ${journal}`);
  }
  if (!flags.apply) console.log("Dry-run. Re-run with --apply to write.");
  return 0;
}

// ─── docs ────────────────────────────────────────────────────────────────────

const DOCS_INDEX_URL = "https://bun.com/docs/llms.txt";

interface DocMatch {
  path: string;
  title: string;
  description: string;
}

function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!match) return out;
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

/** `--dir`, `$BUN_DOCS_DIR`, or the nearest `docs/` with a Mintlify `docs.json` from the working directory up. */
function findDocsDir(cwd: string, given?: string): string | undefined {
  if (given) return resolve(cwd, given);
  const configured = process.env.BUN_DOCS_DIR;
  if (configured) return resolve(cwd, configured);
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "docs", "docs.json")) && existsSync(join(dir, "docs", "runtime")))
      return join(dir, "docs");
    if (dirname(dir) === dir) return undefined;
  }
}

function localDocs(dir: string, terms: string[], content: boolean): DocMatch[] {
  const matches: DocMatch[] = [];
  for (const file of new Bun.Glob("**/*.{md,mdx}").scanSync({ cwd: dir, onlyFiles: true })) {
    const path = file.split("\\").join("/");
    if (path.startsWith("node_modules/")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const meta = frontmatter(text);
    const haystack = `${path} ${meta.title ?? ""} ${meta.description ?? ""}${content ? ` ${text}` : ""}`.toLowerCase();
    if (terms.every(term => haystack.includes(term)))
      matches.push({ path, title: meta.title ?? "", description: meta.description ?? "" });
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

async function remoteDocs(terms: string[]): Promise<DocMatch[]> {
  const response = await fetch(DOCS_INDEX_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${DOCS_INDEX_URL}: HTTP ${response.status}`);
  const matches: DocMatch[] = [];
  for (const line of (await response.text()).split("\n")) {
    const entry = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/.exec(line);
    if (!entry) continue;
    const [, title, path, description = ""] = entry;
    if (terms.every(term => `${path} ${title} ${description}`.toLowerCase().includes(term)))
      matches.push({ path: path!, title: title!, description });
  }
  return matches;
}

const DOCS_HELP = `Usage: bunos docs [query...] [flags]

Searches the Bun documentation by path, title and description: the local docs/ (--dir, $BUN_DOCS_DIR,
or a Bun checkout above the working directory), else the bun.com/docs index.

Flags:
  --dir <path>    Documentation directory (.md/.mdx)
  --content       Also search page bodies (local docs)
  --print         Print the first match (local docs)
  --json          Machine-readable output
  --md            Markdown list`;

async function docs(args: string[], cwd: string): Promise<number> {
  const { flags, positionals } = parseFlags(args, {
    dir: { type: "string" },
    content: { type: "boolean" },
    print: { type: "boolean" },
    json: { type: "boolean" },
    md: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    console.log(DOCS_HELP);
    return 0;
  }
  const terms = positionals.map(term => term.toLowerCase());
  const dir = findDocsDir(cwd, flags.dir);
  if (flags.dir && !existsSync(dir!)) throw new UsageError(`No documentation at ${dir}`);
  const local = dir !== undefined && existsSync(dir);
  const matches = local ? localDocs(dir, terms, !!flags.content) : await remoteDocs(terms);
  const source = local ? dir : DOCS_INDEX_URL;

  if (flags.print) {
    if (!local) throw new UsageError("--print needs local docs (--dir or $BUN_DOCS_DIR)");
    if (!matches.length) return 1;
    process.stdout.write(readFileSync(join(dir, matches[0]!.path), "utf8"));
    return 0;
  }
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          schema: "bun.docs/1",
          query: positionals.join(" ") || null,
          source,
          total: matches.length,
          matches,
        },
        null,
        2,
      ),
    );
    return matches.length ? 0 : 1;
  }
  if (flags.md) {
    console.log(
      [
        `# bunos docs${terms.length ? `: ${positionals.join(" ")}` : ""}`,
        "",
        `- Source: \`${source}\``,
        `- Matches: ${matches.length}`,
        "",
      ]
        .concat(matches.map(m => `- \`${m.path}\`${m.title ? `: ${m.title}` : ""}`))
        .join("\n"),
    );
    return matches.length ? 0 : 1;
  }
  for (const match of matches)
    console.log(
      `${paint("36", match.path)}${match.title ? `  ${match.title}` : ""}${match.description ? paint("2", ` - ${match.description}`) : ""}`,
    );
  console.error(paint("2", `${matches.length} match(es) in ${source}`));
  return matches.length ? 0 : 1;
}

// ─── parse ───────────────────────────────────────────────────────────────────

const LOADERS: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

async function parseFile(path: string) {
  const loader = LOADERS[extname(path).toLowerCase()];
  if (!loader) throw new UsageError(`${path}: not a JavaScript or TypeScript file`);
  const started = Bun.nanoseconds();
  const bytes = await readBytes(path);
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const scanned = new Bun.Transpiler({ loader }).scan(source);
  return {
    path,
    lines: source.length === 0 ? 0 : source.split("\n").length,
    bytes: bytes.byteLength,
    checksum: Bun.hash.wyhash(bytes).toString(16),
    exports: scanned.exports,
    imports: scanned.imports.map(entry => ({ path: entry.path, kind: entry.kind })),
    parseTimeMs: Number(((Bun.nanoseconds() - started) / 1e6).toFixed(3)),
  };
}

const PARSE_HELP = `Usage: bunos parse <file...> [--json | --md]

Lines, bytes, wyhash, exports and imports of JavaScript/TypeScript files (Bun's transpiler scan).`;

async function parse(args: string[], cwd: string): Promise<number> {
  const { flags, positionals } = parseFlags(args, {
    json: { type: "boolean" },
    md: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  const help = flags.help;
  if (help || positionals.length === 0) {
    console.log(PARSE_HELP);
    return help ? 0 : 1;
  }
  const results: Awaited<ReturnType<typeof parseFile>>[] = [];
  for (const file of positionals) {
    const abs = resolve(cwd, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`File not found: ${file}`);
    results.push({ ...(await parseFile(abs)), path: relative(cwd, abs).split("\\").join("/") });
  }
  if (flags.json) {
    console.log(
      JSON.stringify(
        results.length === 1 ? { schema: "bun.parse/1", ...results[0] } : { schema: "bun.parse/1", files: results },
        null,
        2,
      ),
    );
    return 0;
  }
  for (const r of results) {
    if (flags.md) {
      console.log(
        [
          `# ${r.path}`,
          "",
          `- Lines: ${r.lines}`,
          `- Bytes: ${r.bytes}`,
          `- wyhash: \`0x${r.checksum}\``,
          `- Parse: ${r.parseTimeMs} ms`,
          "",
          `## Exports (${r.exports.length})`,
          "",
          ...r.exports.map(name => `- \`${name}\``),
          "",
          `## Imports (${r.imports.length})`,
          "",
          ...r.imports.map(entry => `- \`${entry.path}\` (${entry.kind})`),
          "",
        ].join("\n"),
      );
      continue;
    }
    console.log(paint("1", r.path));
    console.log(`  lines ${r.lines}, ${r.bytes} bytes, wyhash 0x${r.checksum}, ${r.parseTimeMs} ms`);
    console.log(`  exports (${r.exports.length}): ${r.exports.join(", ")}`);
    console.log(`  imports (${r.imports.length}): ${r.imports.map(entry => entry.path).join(", ")}`);
  }
  return 0;
}

// ─── bench ───────────────────────────────────────────────────────────────────

function timeLoop(iterations: number, body: (i: number) => unknown) {
  let last: unknown;
  const started = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) last = body(i);
  const elapsedMs = Number(((Bun.nanoseconds() - started) / 1e6).toFixed(3));
  return {
    elapsedMs,
    opsPerSec: Math.round((iterations / Math.max(elapsedMs, 1e-3)) * 1000),
    last,
  };
}

const BENCH_HELP = `Usage: bunos bench [--iterations N] [--json | --md]

Micro-benchmarks of runtime primitives: Bun.hash (wyhash, crc32, rapidhash), Bun.stringWidth,
Bun.stripANSI and Bun.Transpiler.`;

async function bench(args: string[]): Promise<number> {
  const { flags } = parseFlags(args, {
    iterations: { type: "string" },
    json: { type: "boolean" },
    md: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    console.log(BENCH_HELP);
    return 0;
  }
  const iterations = flags.iterations === undefined ? 500_000 : Number(flags.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < 1)
    throw new UsageError("--iterations must be a positive integer");
  const data = Buffer.from("Bun runtime primitive benchmark payload, 64 bytes of sample data!");
  const ansi = "\x1b[32mbun\x1b[0m 🚀 \x1b[34mbench\x1b[0m";
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const code = "export const add = (a: number, b: number): number => a + b;";
  const transpileIterations = Math.max(1, Math.floor(iterations / 1000));
  const results = {
    "Bun.hash.wyhash": timeLoop(iterations, i => Bun.hash.wyhash(data, BigInt(i))),
    "Bun.hash.crc32": timeLoop(iterations, i => Bun.hash.crc32(data, i)),
    "Bun.hash.rapidhash": timeLoop(iterations, i => Bun.hash.rapidhash(data, BigInt(i))),
    "Bun.stringWidth": timeLoop(iterations, () => Bun.stringWidth(ansi)),
    "Bun.stripANSI": timeLoop(iterations, () => Bun.stripANSI(ansi)),
    "Bun.Transpiler.transformSync": timeLoop(transpileIterations, () => transpiler.transformSync(code)),
  };
  const rows = Object.entries(results).map(([name, r]) => ({
    name,
    iterations: name === "Bun.Transpiler.transformSync" ? transpileIterations : iterations,
    elapsedMs: r.elapsedMs,
    opsPerSec: r.opsPerSec,
  }));
  const report = {
    schema: "bun.bench/1",
    timestamp: new Date().toISOString(),
    bun: Bun.version,
    revision: Bun.revision,
    platform: `${process.platform}-${process.arch}`,
    results: rows,
  };
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (flags.md) {
    console.log(
      [
        `# bunos bench (${report.bun}, ${report.platform})`,
        "",
        "| Benchmark | Iterations | Elapsed | ops/s |",
        "| :--- | ---: | ---: | ---: |",
        ...rows.map(r => `| ${r.name} | ${r.iterations} | ${r.elapsedMs} ms | ${r.opsPerSec.toLocaleString()} |`),
      ].join("\n"),
    );
    return 0;
  }
  for (const r of rows)
    console.log(
      `${r.name.padEnd(30)} ${String(r.iterations).padStart(9)} in ${r.elapsedMs.toFixed(2).padStart(9)} ms  ${r.opsPerSec.toLocaleString()} ops/s`,
    );
  return 0;
}

// ─── dispatch ────────────────────────────────────────────────────────────────

/** Run one devtools command; resolves to its exit code (usage and runtime errors print and return 1). */
export async function run(command: DevtoolsCommand, args: string[], cwd = process.cwd()): Promise<number> {
  try {
    switch (command) {
      case "rename":
        return await rename(args, cwd);
      case "docs":
        return await docs(args, cwd);
      case "parse":
        return await parse(args, cwd);
      case "bench":
        return await bench(args);
    }
    throw new UsageError(`Expected one of ${COMMANDS.join(", ")}`);
  } catch (error) {
    process.stderr.write(`${paint("31", "error")}: ${(error as Error)?.message ?? error}\n`);
    return 1;
  }
}

/** `bun devtools.ts <command> [args]`, the fork's `bun -e` entry. */
if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  process.exit(await run(command as DevtoolsCommand, args));
}
