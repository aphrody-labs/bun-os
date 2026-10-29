// SPDX-License-Identifier: Apache-2.0
// Read-only portable export contract guards.
/**
 * Read-only, opt-in portable export contract for flat Bun OS workspace members.
 * This is not universal Bun OS policy: native/FFI owners remain legitimate,
 * but are intentionally forbidden by this portable consumer contract.
 *
 * The walker reads a package manifest (`exports` + `bunos.runtime`), follows
 * the relative-import closure of each entry and applies the runtime class
 * table plus the cross-cutting rules. It is a lexical checker: comments and
 * string contents are blanked (length-preserving) before any pattern runs, so
 * a forbidden word inside a comment or a message never counts.
 *
 * Runtime class: `server` (conformance tooling, reads files only).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type RuntimeClass = "pure" | "server" | "hono" | "react" | "next" | "bun";

export interface Offence {
  file: string;
  rule: string;
  excerpt: string;
}

export const RUNTIME_CLASSES: readonly RuntimeClass[] = ["pure", "server", "hono", "react", "next", "bun"];

/** Classes of non-code export entries (tsconfig presets, stylesheets). */
export const ASSET_CLASSES: readonly string[] = ["json", "css"];

/** Classes an importer may reach through declared first-party package subpaths. */
const CLASS_REACH: Readonly<Record<RuntimeClass, readonly RuntimeClass[]>> = {
  pure: ["pure"],
  server: ["pure", "server"],
  hono: ["pure", "server", "hono"],
  react: ["pure", "react"],
  next: ["pure", "server", "next"],
  bun: ["pure", "server", "hono", "bun"],
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const WALK_PRUNE = new Set(["node_modules", ".next", ".turbo", "dist", "build", "coverage", "fixtures", ".git"]);
const ENV_DEFAULT_FILES = new Set(["config.ts", "env.ts", "paths.ts"]);
const NODE_BUILTINS = new Set(builtinModules.filter(name => !name.startsWith("_")));

// ── Lexing ───────────────────────────────────────────────────────────────────

/** Characters after which a `/` starts a regular expression literal. */
const REGEX_PRECEDERS = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Blanks comments and the contents of string, template and regex literals
 * with spaces, keeping every newline, every quote and every offset. Code inside
 * template `${ … }` substitutions is kept.
 */
export function stripNonCode(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  // Stack of template-literal brace depths: a `}` at the recorded depth resumes the template.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let lastSignificant = "";
  let lastSignificantEnd = 0;
  let i = 0;
  const n = source.length;

  const scanTemplate = (start: number): number => {
    // `start` is the index right after the opening backtick or the closing `}` of a substitution.
    let j = start;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") {
        blank(start, j);
        return j + 1;
      }
      if (c === "$" && source[j + 1] === "{") {
        blank(start, j);
        templateStack.push(braceDepth);
        braceDepth++;
        return j + 2;
      }
      j++;
    }
    blank(start, n);
    return n;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      lastSignificant = c;
      lastSignificantEnd = i;
      continue;
    }
    if (c === "`") {
      i = scanTemplate(i + 1);
      lastSignificant = "`";
      lastSignificantEnd = i;
      continue;
    }
    if (c === "/") {
      const before = source.slice(Math.max(0, lastSignificantEnd - 12), lastSignificantEnd);
      const isRegex = lastSignificant === "" || REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(before);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && source[j] !== "\n") {
          const d = source[j];
          if (d === "\\") {
            j += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          j++;
        }
        blank(i + 1, Math.min(j, n));
        i = j + 1;
        lastSignificant = "/";
        lastSignificantEnd = i;
        continue;
      }
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      braceDepth--;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        i = scanTemplate(i + 1);
        lastSignificant = "`";
        lastSignificantEnd = i;
        continue;
      }
    }
    if (c !== undefined && !/\s/.test(c)) {
      lastSignificant = c;
      lastSignificantEnd = i + 1;
    }
    i++;
  }
  return out.join("");
}

interface ImportRef {
  specifier: string;
  index: number;
  typeOnly: boolean;
}

/** Import / export / dynamic import / require specifiers, read from the original text. */
function extractImports(source: string, code: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const readString = (quoteIndex: number): string | null => {
    const quote = source[quoteIndex];
    if (quote !== "'" && quote !== '"') return null;
    const end = source.indexOf(quote, quoteIndex + 1);
    return end === -1 ? null : source.slice(quoteIndex + 1, end);
  };
  const patterns: { re: RegExp; typeGroup: boolean }[] = [
    { re: /\b(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]+?)\s*\bfrom\s*(["'])/g, typeGroup: true },
    { re: /\bimport\s*(["'])/g, typeGroup: false },
    { re: /\bimport\s*\(\s*(["'])/g, typeGroup: false },
    { re: /\brequire\s*\(\s*(["'])/g, typeGroup: false },
  ];
  for (const { re, typeGroup } of patterns) {
    for (const match of code.matchAll(re)) {
      const quoteIndex = (match.index ?? 0) + match[0].length - 1;
      const specifier = readString(quoteIndex);
      if (specifier === null) continue;
      refs.push({ specifier, index: match.index ?? 0, typeOnly: typeGroup && Boolean(match[1]) });
    }
  }
  return refs.toSorted((a, b) => a.index - b.index);
}

function lineAt(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const endRaw = source.indexOf("\n", index);
  const end = endRaw === -1 ? source.length : endRaw;
  return source.slice(start, end).trim().slice(0, 160);
}

// ── Manifest and resolution ──────────────────────────────────────────────────

interface Manifest {
  name?: string;
  exports?: unknown;
  bunos?: { runtime?: Record<string, unknown> };
  workspaces?: unknown;
}

function readManifest(dir: string): Manifest | null {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/** Resolves one `exports` value (string or condition object) to a relative target. */
function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const condition of ["bun", "import", "default", "node", "require"]) {
      const target = exportTarget(record[condition]);
      if (target) return target;
    }
  }
  return null;
}

export interface ExportEntry {
  /** Export key as written in the manifest (`"."`, `"./env"`, `"./repos/*"`). */
  key: string;
  /** Concrete subpath (wildcards expanded). */
  subpath: string;
  /** Absolute file path. */
  file: string;
  /** Declared runtime class, `null` when absent or not a known class. */
  runtime: RuntimeClass | null;
  /** Raw declared class (may be `"json"`). */
  declared: string | null;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (WALK_PRUNE.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Expands a package's `exports` into concrete entries. A wildcard key
 * (`"./repos/*"`) yields one entry per matching file. Targets that do not
 * exist are reported with `file` set but missing on disk (callers check).
 */
export function listExportEntries(packageDir: string): ExportEntry[] {
  const manifest = readManifest(packageDir);
  if (!manifest) return [];
  const runtime = manifest.bunos?.runtime ?? {};
  const exportsField = manifest.exports;
  const map: Record<string, unknown> =
    typeof exportsField === "string"
      ? { ".": exportsField }
      : exportsField && typeof exportsField === "object"
        ? (exportsField as Record<string, unknown>)
        : {};
  const entries: ExportEntry[] = [];
  for (const [key, value] of Object.entries(map)) {
    const target = exportTarget(value);
    if (!target) continue;
    const declaredRaw = runtime[key];
    const declared = typeof declaredRaw === "string" ? declaredRaw : null;
    const runtimeClass =
      declared && (RUNTIME_CLASSES as readonly string[]).includes(declared) ? (declared as RuntimeClass) : null;
    if (!key.includes("*")) {
      entries.push({
        key,
        subpath: key,
        file: resolve(packageDir, target),
        runtime: runtimeClass,
        declared,
      });
      continue;
    }
    const [targetPrefix = "", targetSuffix = ""] = target.split("*");
    const [keyPrefix = "", keySuffix = ""] = key.split("*");
    const base = resolve(packageDir, targetPrefix);
    const baseDir = targetPrefix.endsWith("/") ? base : dirname(base);
    for (const file of listFiles(baseDir)) {
      const rel = toPosix(relative(packageDir, file));
      const normalisedPrefix = targetPrefix.replace(/^\.\//, "");
      if (!rel.startsWith(normalisedPrefix) || !rel.endsWith(targetSuffix)) continue;
      const star = rel.slice(normalisedPrefix.length, rel.length - targetSuffix.length);
      if (!star || star.includes("/") || /\.test\.tsx?$/.test(rel)) continue;
      entries.push({
        key,
        subpath: `${keyPrefix}${star}${keySuffix}`,
        file,
        runtime: runtimeClass,
        declared,
      });
    }
  }
  return entries;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base];
  for (const ext of SOURCE_EXTENSIONS) candidates.push(base + ext);
  const jsMatch = /\.(m|c)?jsx?$/.exec(base);
  if (jsMatch) {
    const stem = base.slice(0, base.length - jsMatch[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }
  for (const ext of SOURCE_EXTENSIONS) candidates.push(join(base, `index${ext}`));
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel);
}

/** Directory of the workspace root (the nearest ancestor whose manifest declares `workspaces`). */
function findWorkspaceRoot(fromDir: string): string | null {
  let current = resolve(fromDir);
  for (;;) {
    const manifest = readManifest(current);
    if (manifest?.workspaces) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const packageCache = new Map<string, Map<string, string>>();

/** Package identity to source directory, restricted to explicitly declared flat members. */
function workspacePackages(root: string): Map<string, string> {
  const cached = packageCache.get(root);
  if (cached) return cached;
  const map = new Map<string, string>();
  const members = readManifest(root)?.workspaces;
  if (!Array.isArray(members)) return map;
  for (const member of members) {
    if (typeof member !== "string" || !/^(?:packages|apps)\/[^/*]+$/.test(member)) continue;
    const packageDir = resolve(root, member);
    if (!isInside(root, packageDir)) continue;
    const manifest = readManifest(packageDir);
    if (manifest?.name) map.set(manifest.name, packageDir);
  }
  packageCache.set(root, map);
  return map;
}

/** Declared runtime class of a scoped first-party package export. */
function packageSpecifierClass(
  root: string | null,
  specifier: string,
): { found: true; declared: string | null } | { found: false } {
  if (!root) return { found: false };
  const parts = specifier.split("/");
  const name = `${parts[0]}/${parts[1]}`;
  const sub = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  const dir = workspacePackages(root).get(name);
  if (!dir) return { found: false };
  const manifest = readManifest(dir);
  const runtime = manifest?.bunos?.runtime ?? {};
  if (typeof runtime[sub] === "string") return { found: true, declared: runtime[sub] as string };
  for (const [key, value] of Object.entries(runtime)) {
    if (!key.includes("*") || typeof value !== "string") continue;
    const [prefix = "", suffix = ""] = key.split("*");
    if (sub.startsWith(prefix) && sub.endsWith(suffix)) return { found: true, declared: value };
  }
  return { found: true, declared: null };
}

// ── Rules ────────────────────────────────────────────────────────────────────

function isNodeBuiltin(specifier: string): boolean {
  if (isBunSpecifier(specifier)) return false;
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTINS.has(specifier.split("/")[0] ?? "");
}

function isBunSpecifier(specifier: string): boolean {
  return specifier === "bun" || specifier.startsWith("bun:");
}

function isPackage(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

/** Specifier rules that apply to every package whatever its class. */
function globalSpecifierRule(specifier: string): string | null {
  if (specifier === "server-only") return "server-only";
  if (specifier.startsWith("@t3-oss/")) return "t3-env";
  if (specifier.startsWith("@/")) return "app-alias";
  if (isPackage(specifier, "tsyringe")) return "tsyringe";
  if (isPackage(specifier, "reflect-metadata")) return "reflect-metadata";
  if (
    ["@discordx/di", "discordx", "@discordx/importer", "@discordx/internal", "@discordx/pagination"].some(name =>
      isPackage(specifier, name),
    )
  )
    return "aphrody-discord";
  if (specifier === "bun:ffi") return "bun-ffi";
  if (
    isPackage(specifier, "@aphrody/bun") ||
    isPackage(specifier, "@aphrody/zstd") ||
    isPackage(specifier, "@aphrody/xml2")
  ) {
    return "aphrody-native";
  }
  return null;
}

/** Specifier rules of the declared runtime class table. */
function classSpecifierRule(runtime: RuntimeClass, specifier: string): string | null {
  const react = isPackage(specifier, "react") || isPackage(specifier, "react-dom");
  const next = isPackage(specifier, "next");
  const hono = isPackage(specifier, "hono") || specifier.startsWith("@hono/");
  switch (runtime) {
    case "pure":
      if (isNodeBuiltin(specifier)) return "pure:node";
      if (isBunSpecifier(specifier)) return "pure:bun";
      if (react) return "pure:react";
      if (next) return "pure:next";
      if (hono) return "pure:hono";
      return null;
    case "server":
    case "hono":
      if (isBunSpecifier(specifier)) return `${runtime}:bun`;
      if (react) return `${runtime}:react`;
      if (next) return `${runtime}:next`;
      if (runtime === "server" && hono) return "server:hono";
      return null;
    case "react":
      if (isNodeBuiltin(specifier)) return "react:node";
      if (isBunSpecifier(specifier)) return "react:bun";
      if (next) return "react:next";
      if (hono) return "react:hono";
      return null;
    case "next":
      if (isBunSpecifier(specifier)) return "next:bun";
      return null;
    case "bun":
      if (react) return "bun:react";
      if (next) return "bun:next";
      return null;
  }
}

/** Token rules of the runtime class table, applied to blanked code. */
function classTokenRules(runtime: RuntimeClass): { rule: string; re: RegExp }[] {
  const bunGlobal = /(?<![\w$.])Bun\s*\./g;
  const processGlobal = /(?<![\w$.])process\s*[.[]/g;
  const dom = /(?<![\w$.])(?:window|document)\s*\./g;
  switch (runtime) {
    case "pure":
      return [
        { rule: "pure:bun-global", re: bunGlobal },
        { rule: "pure:process", re: processGlobal },
        { rule: "pure:dom", re: dom },
      ];
    case "server":
    case "hono":
      return [
        { rule: `${runtime}:bun-global`, re: bunGlobal },
        { rule: `${runtime}:dom`, re: dom },
      ];
    case "react":
      return [
        { rule: "react:bun-global", re: bunGlobal },
        { rule: "react:process", re: processGlobal },
      ];
    case "next":
      return [{ rule: "next:bun-global", re: bunGlobal }];
    case "bun":
      return [];
  }
}

/**
 * Indices of `{` that open a function body (or a class body, whose methods are
 * function bodies themselves): the brace follows `)`, `=>`, or a return type
 * annotation after `)`. Other braces (objects, blocks, types) are not bodies.
 */
function isFunctionBrace(code: string, braceIndex: number): boolean {
  const before = code.slice(Math.max(0, braceIndex - 240), braceIndex);
  if (/(?:\)|=>)\s*$/.test(before)) return true;
  if (/\)\s*:\s*[^;{}()=]*$/.test(before)) return true;
  if (/\bclass\b[^;{}()]*$/.test(before)) return true;
  return false;
}

/** `true` when `index` starts a `= process.env` default parameter (`(env = process.env)`). */
function isEnvDefaultParameter(code: string, index: number): boolean {
  const match = /^(?:process|Bun)\s*\.\s*env\b/.exec(code.slice(index));
  if (!match) return false;
  const after = code.slice(index + match[0].length);
  return /=\s*$/.test(code.slice(Math.max(0, index - 40), index)) && /^\s*[,)]/.test(after);
}

/**
 * Offsets of `process.env`, `Bun.env` and `import.meta.env` that execute when
 * the module is evaluated (outside any function body). A default parameter
 * `= process.env` is exempt in files named config.ts, env.ts or paths.ts.
 */
function moduleLevelEnvReads(code: string, fileName: string): number[] {
  const functionDepthAt: boolean[] = [];
  const stack: boolean[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") stack.push(isFunctionBrace(code, i));
    else if (c === "}") stack.pop();
    functionDepthAt[i] = stack.includes(true);
  }
  const hits: number[] = [];
  const re = /(?<![\w$.])(?:process\s*\.\s*env|Bun\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)\b/g;
  for (const match of code.matchAll(re)) {
    const index = match.index ?? 0;
    if (functionDepthAt[index]) continue;
    // Arrow function with an expression body on the same statement: `() => process.env.X`.
    const statementStart = Math.max(code.lastIndexOf(";", index), code.lastIndexOf("\n", index));
    const lead = code.slice(statementStart + 1, index);
    if (/=>/.test(lead)) continue;
    // Look further back for an unbraced arrow spanning lines (`=>\n  process.env.X`).
    if (/=>\s*$/.test(code.slice(Math.max(0, index - 200), index))) continue;
    if (ENV_DEFAULT_FILES.has(fileName) && isEnvDefaultParameter(code, index)) continue;
    hits.push(index);
  }
  return hits;
}

function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

function relFile(packageDir: string, file: string): string {
  return toPosix(relative(packageDir, file));
}

/** Offences of one file under one runtime class (specifiers, tokens, module-level env). */
function checkFile(
  packageDir: string,
  root: string | null,
  file: string,
  runtime: RuntimeClass,
): {
  offences: Offence[];
  relatives: string[];
} {
  const source = readSource(file);
  const code = stripNonCode(source);
  const offences: Offence[] = [];
  const relatives: string[] = [];
  const rel = relFile(packageDir, file);
  const push = (rule: string, index: number) => offences.push({ file: rel, rule, excerpt: lineAt(source, index) });

  for (const ref of extractImports(source, code)) {
    const { specifier } = ref;
    if (specifier.startsWith(".")) {
      const target = resolveRelative(file, specifier);
      const absolute = resolve(dirname(file), specifier);
      if (/(^|[\\/])apps[\\/]/.test(relative(root ?? packageDir, absolute)) && !isInside(packageDir, absolute)) {
        push("apps-import", ref.index);
        continue;
      }
      if (target && isInside(packageDir, target)) relatives.push(target);
      continue;
    }
    const global = globalSpecifierRule(specifier);
    if (global) {
      push(global, ref.index);
      continue;
    }
    if (ref.typeOnly) continue;
    const classRule = classSpecifierRule(runtime, specifier);
    if (classRule) {
      push(classRule, ref.index);
      continue;
    }
    if (specifier.startsWith("@")) {
      const target = packageSpecifierClass(root, specifier);
      if (!target.found) continue;
      const declared = target.declared;
      if (declared === null || !(RUNTIME_CLASSES as readonly string[]).includes(declared)) {
        push("package:undeclared-class", ref.index);
      } else if (!CLASS_REACH[runtime].includes(declared as RuntimeClass)) {
        push(`${runtime}:package-${declared}`, ref.index);
      }
    }
  }

  if (/(?<![\w$.])dlopen\s*\(/.test(code)) push("dlopen", code.search(/(?<![\w$.])dlopen\s*\(/));

  const defaultParamExempt = ENV_DEFAULT_FILES.has(basename(file));
  for (const { rule, re } of classTokenRules(runtime)) {
    for (const match of code.matchAll(re)) {
      const index = match.index ?? 0;
      if (defaultParamExempt && isEnvDefaultParameter(code, index)) continue;
      push(rule, index);
    }
  }
  for (const index of moduleLevelEnvReads(code, basename(file))) push("module-env", index);

  return { offences, relatives };
}

function dedupe(offences: Offence[]): Offence[] {
  const seen = new Set<string>();
  const out: Offence[] = [];
  for (const offence of offences) {
    const key = `${offence.file}\u0000${offence.rule}\u0000${offence.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(offence);
  }
  return out;
}

/**
 * Applies the runtime class table and the cross-cutting rules to the
 * relative-import closure of every exported entry of `packageDir`.
 */
export async function checkPackageRuntimes(packageDir: string): Promise<Offence[]> {
  const dir = resolve(packageDir);
  const root = findWorkspaceRoot(dirname(dir));
  const offences: Offence[] = [];
  for (const entry of listExportEntries(dir)) {
    if (!/\.(?:m|c)?tsx?$/.test(entry.file)) {
      // Asset entries (tsconfig presets, stylesheets) carry an asset class, not a runtime class.
      if (!entry.declared || !ASSET_CLASSES.includes(entry.declared)) {
        offences.push({
          file: "package.json",
          rule: "missing-runtime-class",
          excerpt: `${entry.key}${entry.declared ? ` (unknown class "${entry.declared}")` : ""}`,
        });
      }
      continue;
    }
    if (!entry.runtime) {
      offences.push({
        file: "package.json",
        rule: "missing-runtime-class",
        excerpt: `${entry.key}${entry.declared ? ` (unknown class "${entry.declared}")` : ""}`,
      });
      continue;
    }
    if (!existsSync(entry.file)) {
      offences.push({ file: "package.json", rule: "missing-export-target", excerpt: entry.key });
      continue;
    }
    const visited = new Set<string>();
    const queue = [entry.file];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (visited.has(file)) continue;
      visited.add(file);
      const result = checkFile(dir, root, file, entry.runtime);
      offences.push(...result.offences);
      queue.push(...result.relatives);
    }
  }
  return dedupe(offences);
}

/**
 * Every source file of the package (fixtures and build output excluded) must
 * keep its relative imports inside the package and must not use the app alias.
 */
export async function checkNoEscapingImports(packageDir: string): Promise<Offence[]> {
  const dir = resolve(packageDir);
  const offences: Offence[] = [];
  for (const file of listFiles(dir)) {
    if (!/\.(?:m|c)?tsx?$/.test(file)) continue;
    const source = readSource(file);
    const code = stripNonCode(source);
    for (const ref of extractImports(source, code)) {
      const push = (rule: string) =>
        offences.push({ file: relFile(dir, file), rule, excerpt: lineAt(source, ref.index) });
      if (ref.specifier.startsWith("@/")) {
        push("app-alias");
        continue;
      }
      if (!ref.specifier.startsWith(".")) continue;
      const absolute = resolve(dirname(file), ref.specifier);
      if (!isInside(dir, absolute)) push("escaping-import");
    }
  }
  return dedupe(offences);
}
