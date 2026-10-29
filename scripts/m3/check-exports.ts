#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// check-exports.ts: fails when a workspace package of this repository is incomplete or dangling.
//
//   bun scripts/check-exports.ts [--json] [--warn-only] [package-dir..]
//
// Per package (`packages/*`, `apps/*`, including the nested repositories and the packages the root
// workspace excludes):
//   manifest   name and version; a README.md; a `test` script and at least one test file; a
//              `typecheck` or `build` script.
//   entries    every `main`, `module`, `types`, `bin` and `exports` target exists. A `dist/` target
//              is accepted only when the package has a `build` script and the source it compiles
//              from exists (`dist/x.js` <- `src/x.ts|tsx`); wildcard targets need their directory.
//   deps       every `workspace:*` names a package of this repository and every `catalog:` names an
//              entry of the root catalog.
//   imports    in source, test, bin and script files: every relative import resolves to a file;
//              every import of a first-party package (one of this repository) is declared in the
//              nearest manifest (or the root manifest) and matches an export of the target (subpath and file, with Bun's
//              extension probing). Platform addons (`./x.node`, napi `*.wasi.cjs`) are optional.
// Packages excluded from the root workspace (`!packages/x`) are host-bound: their `workspace:*`
// dependencies resolve in a host repository ($M3_HOST_ROOTS, default ~/aphrody:/mnt/c/iecode).
// Nested repositories (submodules such as packages/nie-ui) own their gates: their findings are
// warnings here, attributed to the nested package that holds the file.
// Exit status 1 when any error is found (0 with --warn-only).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");

export type Severity = "error" | "warn";
export interface Finding {
  pkg: string;
  check: "manifest" | "entries" | "deps" | "imports";
  severity: Severity;
  message: string;
}

export interface Pkg {
  dir: string;
  rel: string;
  manifest: Record<string, any>;
  /** Inside a nested repository (git submodule): findings are warnings. */
  nested?: boolean;
  /** Excluded from the root workspace: consumed and installed by a host repository. */
  hostBound?: boolean;
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  ".next",
  "target",
  "fixtures",
  "__fixtures__",
  "__testfixtures__",
  "coverage",
  "out",
]);
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".d.ts", ".json"];

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** Workspace patterns of a manifest (`workspaces` array or `{ packages }`). */
export function workspacePatterns(manifest: Record<string, any>): string[] {
  const ws = manifest.workspaces;
  return Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
}

/** Package directories matched by workspace patterns under `root` (negations honoured). */
export function expandWorkspaces(root: string, patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns.filter(p => !p.startsWith("!"))) {
    for (const file of new Bun.Glob(`${pattern.replace(/\/$/, "")}/package.json`).scanSync({
      cwd: root,
      onlyFiles: true,
    })) {
      if (!file.includes("node_modules")) dirs.add(dirname(file));
    }
  }
  for (const negated of patterns.filter(p => p.startsWith("!"))) {
    const glob = new Bun.Glob(negated.slice(1).replace(/\/$/, ""));
    // Deleting the current element while iterating a Set is well defined.
    for (const d of dirs) if (glob.match(d)) dirs.delete(d);
  }
  return [...dirs].toSorted();
}

/** Every package directory: `packages/*` and `apps/*` holding a package.json, plus the workspace
 * packages of nested repositories. */
export function listPackages(root = REPO): Pkg[] {
  const out: Pkg[] = [];
  const rootManifest = readJson(join(root, "package.json"));
  const members = new Set(expandWorkspaces(root, workspacePatterns(rootManifest)));
  for (const group of ["packages", "apps"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).toSorted()) {
      const dir = join(base, name);
      const file = join(dir, "package.json");
      if (!existsSync(file)) continue;
      const rel = `${group}/${name}`;
      const nested = existsSync(join(dir, ".git"));
      const manifest = readJson(file);
      out.push({
        dir,
        rel,
        manifest,
        nested,
        hostBound: !nested && !members.has(rel),
      });
      // Workspace members declared below a package (`packages/m3-next/examples/*`).
      for (const member of [...members].filter(m => m.startsWith(`${rel}/`)).toSorted())
        out.push({
          dir: join(root, member),
          rel: member,
          manifest: readJson(join(root, member, "package.json")),
        });
      if (nested) {
        for (const sub of expandWorkspaces(dir, workspacePatterns(manifest))) {
          out.push({
            dir: join(dir, sub),
            rel: `${rel}/${sub}`,
            manifest: readJson(join(dir, sub, "package.json")),
            nested: true,
          });
        }
      }
    }
  }
  return out;
}

/** Package names of the host repositories that install the host-bound packages. */
export function hostPackageNames(
  roots = (
    process.env["M3_HOST_ROOTS"] ??
    (process.platform === "win32" ? ["C:\\aphrody", "C:\\iecode"].join(";") : `${homedir()}/aphrody:/mnt/c/iecode`)
  ).split(process.platform === "win32" ? ";" : ":"),
): Set<string> {
  const names = new Set<string>();
  for (const root of roots.filter(r => r && existsSync(join(r, "package.json")))) {
    for (const dir of expandWorkspaces(root, workspacePatterns(readJson(join(root, "package.json"))))) {
      try {
        const name = readJson(join(root, dir, "package.json")).name;
        if (name) names.add(name);
      } catch {
        // unreadable manifest: not a package
      }
    }
  }
  return names;
}

function walk(dir: string, accept: (file: string) => boolean, out: string[] = [], root = dir): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    // A directory with its own manifest is another package (example apps, nested workspaces).
    if (entry.isDirectory() && existsSync(join(path, "package.json")) && path !== root) continue;
    if (entry.isDirectory()) walk(path, accept, out, root);
    else if (entry.isFile() && accept(path)) out.push(path);
  }
  return out;
}

/** Test files of a package (`*.test.*`, `*.spec.*`); a workspace root counts the tests of its members. */
const acceptTestFile = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

export function testFiles(pkg: Pkg): string[] {
  if (workspacePatterns(pkg.manifest).length === 0) return walk(pkg.dir, acceptTestFile);
  return [pkg.dir, ...expandWorkspaces(pkg.dir, workspacePatterns(pkg.manifest)).map(m => join(pkg.dir, m))].flatMap(
    d => walk(d, acceptTestFile),
  );
}

/** Flattened `exports` targets: [subpath, condition path, target]. */
export function exportTargets(exportsField: unknown, subpath = "."): Array<[string, string, string]> {
  if (exportsField == null) return [];
  if (typeof exportsField === "string") return [[subpath, "", exportsField]];
  if (Array.isArray(exportsField)) return exportsField.flatMap(e => exportTargets(e, subpath));
  const obj = exportsField as Record<string, unknown>;
  const keys = Object.keys(obj);
  const isSubpathMap = keys.length > 0 && keys.every(k => k.startsWith("."));
  if (isSubpathMap) return keys.flatMap(k => exportTargets(obj[k], k));
  return keys.flatMap(cond =>
    exportTargets(obj[cond], subpath).map(([s, c, t]) => [s, c ? `${cond}.${c}` : cond, t] as [string, string, string]),
  );
}

/** The source file a `dist/` build output compiles from, if any. */
export function distSource(pkgDir: string, target: string): string | undefined {
  const m = /^\.?\/?dist\/(.+?)(?:\.d)?\.(?:[cm]?js|[cm]?ts)$/.exec(target);
  if (!m) return undefined;
  const stem = m[1]!;
  for (const base of ["src", "."]) {
    for (const ext of [".ts", ".tsx", ".mts", ".js", ".jsx"]) {
      const candidate = join(pkgDir, base, stem + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  // tsup flattens `src/x/index.ts` to `dist/x.js`.
  for (const ext of [".ts", ".tsx"]) {
    const candidate = join(pkgDir, "src", stem, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Whether `target` (relative to the package) is satisfied: a file, a dist output with a source, or a wildcard directory. */
export function targetStatus(pkg: Pkg, target: string): { ok: boolean; note?: string } {
  if (target.includes("*")) {
    const prefix = target.slice(0, target.indexOf("*"));
    const dir = join(pkg.dir, prefix.endsWith("/") ? prefix : dirname(prefix));
    return existsSync(dir)
      ? { ok: true }
      : {
          ok: false,
          note: `wildcard directory ${relative(pkg.dir, dir) || "."} missing`,
        };
  }
  const abs = join(pkg.dir, target);
  // Bun probes extensions on exports targets (`./svgs/*` -> `urls.ts`).
  if ([abs, ...RESOLVE_EXT.map(e => abs + e)].some(p => existsSync(p))) return { ok: true };
  if (/^\.?\/?dist\//.test(target)) {
    if (!pkg.manifest.scripts?.build) return { ok: false, note: "dist target without a build script" };
    const src = distSource(pkg.dir, target);
    return src ? { ok: true, note: "build output" } : { ok: false, note: "dist target whose source is missing" };
  }
  return { ok: false, note: "file missing" };
}

/** Test files the `test` script names explicitly (`bun --cwd=../.. test test/x.test.ts`), resolved like Bun does. */
export function scriptTestFiles(pkg: Pkg): string[] {
  const script: string = pkg.manifest.scripts?.test ?? "";
  const cwd = /--cwd[= ](\S+)/.exec(script)?.[1];
  const base = cwd ? resolve(pkg.dir, cwd) : pkg.dir;
  return [...script.matchAll(/(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/g)]
    .map(m => resolve(base, m[1]!))
    .filter(f => existsSync(f));
}

function manifestChecks(pkg: Pkg, findings: Finding[]) {
  const m = pkg.manifest;
  const add = (severity: Severity, message: string) =>
    findings.push({
      pkg: pkg.rel,
      check: "manifest",
      severity: pkg.hostBound ? "warn" : severity,
      message,
    });
  if (!m.name) add("error", "package.json has no name");
  if (!m.version) add("error", "package.json has no version");
  if (!existsSync(join(pkg.dir, "README.md"))) add("error", "README.md missing");
  if (!m.scripts?.test) add("error", "no test script");
  else if (
    testFiles(pkg).length === 0 &&
    !/run[-.]|fixtures|scripts\//.test(m.scripts.test) &&
    scriptTestFiles(pkg).length === 0
  )
    add("error", "test script but no *.test.* file");
  if (!m.scripts?.typecheck && !m.scripts?.build) add("error", "no typecheck or build script");
}

function entryChecks(pkg: Pkg, findings: Finding[]) {
  const m = pkg.manifest;
  const add = (message: string) =>
    findings.push({
      pkg: pkg.rel,
      check: "entries",
      severity: "error",
      message,
    });
  for (const field of ["main", "module", "types", "typings"]) {
    if (typeof m[field] !== "string") continue;
    const s = targetStatus(pkg, m[field]);
    if (!s.ok) add(`${field} -> ${m[field]}: ${s.note}`);
  }
  const bins = typeof m.bin === "string" ? { [m.name]: m.bin } : (m.bin ?? {});
  for (const [name, target] of Object.entries(bins) as [string, string][]) {
    const s = targetStatus(pkg, target);
    if (!s.ok) add(`bin ${name} -> ${target}: ${s.note}`);
  }
  for (const [subpath, cond, target] of exportTargets(m.exports)) {
    const s = targetStatus(pkg, target);
    if (!s.ok) add(`exports["${subpath}"]${cond ? `[${cond}]` : ""} -> ${target}: ${s.note}`);
  }
}

function depChecks(
  pkg: Pkg,
  names: Set<string>,
  catalog: Record<string, string>,
  host: () => Set<string>,
  findings: Finding[],
) {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg.manifest[field] ?? {}) as [string, string][]) {
      if (spec.startsWith("workspace:") && !names.has(name)) {
        if (pkg.hostBound && host().has(name)) continue;
        findings.push({
          pkg: pkg.rel,
          check: "deps",
          severity: pkg.hostBound ? "warn" : "error",
          message: `${field} ${name}@${spec}: no package of that name in this repository${pkg.hostBound ? " or its host repositories" : ""}`,
        });
      }
      if (spec === "catalog:" && !(name in catalog))
        findings.push({
          pkg: pkg.rel,
          check: "deps",
          severity: pkg.hostBound ? "warn" : "error",
          message: `${field} ${name}@catalog: not in the root catalog`,
        });
    }
  }
}

/** Resolve a relative import from `file` to an existing file, or undefined. */
export function resolveRelative(file: string, spec: string): string | undefined {
  const clean = spec.replace(/[?#].*$/, "");
  const base = resolve(dirname(file), clean);
  const tries = [base, ...RESOLVE_EXT.map(e => base + e), ...RESOLVE_EXT.map(e => join(base, `index${e}`))];
  // `./x.js` written for a `./x.ts` source (TypeScript NodeNext / Bundler style).
  const js = /\.(m|c)?jsx?$/.exec(clean);
  if (js) {
    const stem = base.slice(0, -js[0].length);
    tries.push(stem + ".ts", stem + ".tsx", stem + ".mts", stem + ".d.ts");
  }
  return tries.find(p => existsSync(p) && statSync(p).isFile());
}

/** Match a subpath against an exports map key (supports one `*`). Returns the capture or null. */
export function matchExportKey(key: string, subpath: string): string | null {
  if (!key.includes("*")) return key === subpath ? "" : null;
  const [pre, post] = key.split("*") as [string, string];
  if (subpath.startsWith(pre) && subpath.endsWith(post) && subpath.length >= pre.length + post.length)
    return subpath.slice(pre.length, subpath.length - post.length);
  return null;
}

/** Split a bare specifier into package name and `./subpath`. */
export function splitSpecifier(spec: string): {
  name: string;
  subpath: string;
} {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, n).join("/");
  const rest = parts.slice(n).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

/** Import specifiers of a source file (static, dynamic, re-exports, require). */
export function scanImports(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const t = /\.[cm]?tsx$|\.jsx$/.test(file) ? transpilers.tsx : transpilers.ts;
  try {
    return t.scanImports(code).map(i => i.path);
  } catch {
    // Fallback for files the transpiler rejects (syntax under development): a lexical scan.
    const out: string[] = [];
    for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g))
      out.push(m[1]!);
    return out;
  }
}

const declaredDeps = (m: Record<string, any>) =>
  new Set([
    ...Object.keys(m.dependencies ?? {}),
    ...Object.keys(m.devDependencies ?? {}),
    ...Object.keys(m.peerDependencies ?? {}),
    ...Object.keys(m.optionalDependencies ?? {}),
  ]);

/** Platform-conditional native addons loaded in try/catch by napi-rs bindings. */
const OPTIONAL_NATIVE = /\.node$|\.wasi(?:-browser)?\.c?js$/;

function importChecks(pkg: Pkg, all: Pkg[], byName: Map<string, Pkg>, rootDeps: Set<string>, findings: Finding[]) {
  // Root manifest dependencies resolve from every member (node resolution walks up to the root).
  const declared = new Set([...declaredDeps(pkg.manifest), ...rootDeps]);
  // Files of a nested package belong to that package, not to this one.
  const inner = all.filter(p => p !== pkg && p.dir.startsWith(pkg.dir + "/")).map(p => p.dir + "/");
  const files = walk(pkg.dir, f => SOURCE_EXT.test(f) && !f.endsWith(".d.ts") && !inner.some(d => f.startsWith(d)));
  const severity: Severity = pkg.nested || pkg.hostBound ? "warn" : "error";
  const push = (f: Finding) =>
    findings.push({
      ...f,
      severity: f.severity === "error" ? severity : f.severity,
    });
  for (const file of files) {
    const rel = relative(pkg.dir, file);
    for (const spec of scanImports(file)) {
      if (OPTIONAL_NATIVE.test(spec)) continue;
      if (spec.startsWith(".")) {
        if (/\.(css|scss|sass|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|html|md|txt|wasm)(\?.*)?$/.test(spec)) {
          if (!resolveRelative(file, spec))
            push({
              pkg: pkg.rel,
              check: "imports",
              severity: "error",
              message: `${rel}: asset import ${spec} does not resolve`,
            });
          continue;
        }
        if (!resolveRelative(file, spec))
          push({
            pkg: pkg.rel,
            check: "imports",
            severity: "error",
            message: `${rel}: relative import ${spec} does not resolve`,
          });
        continue;
      }
      const { name, subpath } = splitSpecifier(spec);
      const target = byName.get(name);
      if (!target) continue; // not first-party: resolved by the package manager
      if (target !== pkg && !declared.has(name)) {
        push({
          pkg: pkg.rel,
          check: "imports",
          severity: "error",
          message: `${rel}: imports ${spec} but ${name} is not declared in package.json`,
        });
        continue;
      }
      const exp = target.manifest.exports;
      if (exp == null) {
        if (
          subpath === "." &&
          !target.manifest.main &&
          !existsSync(join(target.dir, "index.ts")) &&
          !existsSync(join(target.dir, "index.js"))
        )
          push({
            pkg: pkg.rel,
            check: "imports",
            severity: "error",
            message: `${rel}: ${spec}: ${name} has neither exports nor main`,
          });
        continue;
      }
      const map: Record<string, unknown> =
        typeof exp === "string" || Array.isArray(exp) || !Object.keys(exp).every(k => k.startsWith("."))
          ? { ".": exp }
          : exp;
      let matched = false;
      for (const [key, value] of Object.entries(map)) {
        const capture = matchExportKey(key, subpath);
        if (capture === null) continue;
        matched = true;
        const targets = exportTargets(value, key).map(([, , t]) => t.replace("*", capture));
        const ok = targets.some(t => targetStatus(target, t).ok);
        if (!ok)
          push({
            pkg: pkg.rel,
            check: "imports",
            severity: "error",
            message: `${rel}: ${spec} -> ${targets.join(" | ")} missing in ${target.rel}`,
          });
        break;
      }
      if (!matched)
        push({
          pkg: pkg.rel,
          check: "imports",
          severity: "error",
          message: `${rel}: ${spec} is not exported by ${target.rel}`,
        });
    }
  }
}

/** Catalog of the nested repository that holds `pkg`. */
function nestedCatalog(pkg: Pkg, all: Pkg[]): Record<string, string> {
  const owner = all.find(
    p => p.nested && p.rel.split("/").length === 2 && (pkg.dir === p.dir || pkg.dir.startsWith(p.dir + "/")),
  );
  return owner?.manifest.workspaces?.catalog ?? {};
}

export function checkAll(root = REPO, only: string[] = []): { packages: number; findings: Finding[] } {
  const pkgs = listPackages(root);
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const catalog: Record<string, string> = rootManifest.workspaces?.catalog ?? rootManifest.catalog ?? {};
  const byName = new Map(pkgs.filter(p => p.manifest.name && !p.nested).map(p => [p.manifest.name as string, p]));
  for (const p of pkgs) if (p.nested && p.manifest.name && !byName.has(p.manifest.name)) byName.set(p.manifest.name, p);
  const names = new Set(byName.keys());
  let hostNames: Set<string> | undefined;
  const host = () => (hostNames ??= hostPackageNames());
  const selected = only.length
    ? pkgs.filter(p => only.some(o => p.rel === o.replace(/\/$/, "") || p.manifest.name === o))
    : pkgs;
  const findings: Finding[] = [];
  for (const pkg of selected) {
    const before = findings.length;
    // Nested workspace members of a nested repository are checked for imports and deps only.
    const member = pkg.nested && pkg.rel.split("/").length > 2;
    if (!member) {
      manifestChecks(pkg, findings);
      entryChecks(pkg, findings);
    }
    depChecks(pkg, names, pkg.nested ? { ...catalog, ...nestedCatalog(pkg, pkgs) } : catalog, host, findings);
    importChecks(pkg, pkgs, byName, pkg.nested ? new Set() : declaredDeps(rootManifest), findings);
    if (pkg.nested) for (const f of findings.slice(before)) f.severity = "warn";
  }
  return { packages: selected.length, findings };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const warnOnly = args.includes("--warn-only");
  const only = args.filter(a => !a.startsWith("--"));
  const { packages, findings } = checkAll(REPO, only);
  const errors = findings.filter(f => f.severity === "error");
  if (json) console.log(JSON.stringify({ packages, errors: errors.length, findings }, null, 2));
  else {
    for (const f of findings)
      console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.pkg.padEnd(32)} ${f.check.padEnd(8)} ${f.message}`);
    console.log(
      `check-exports: ${packages} packages, ${errors.length} errors, ${findings.length - errors.length} warnings`,
    );
  }
  process.exit(errors.length && !warnOnly ? 1 : 0);
}
