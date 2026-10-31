// SPDX-License-Identifier: Apache-2.0
// Bun workspace contract for the flat first-party Bun OS packages.
//
//   bun scripts/bun-workspace.ts          report violations, exit 1 if any
//   bun scripts/bun-workspace.ts --fix    rewrite the fixable ones in place
//   bun scripts/bun-workspace.ts --json   machine-readable report
//
// Scope: direct apps/ and packages/ members; imported toolchain packages keep independent contracts.
// Rules (docs/BUN.md):
//   pm       only the root declares `packageManager`
//   engines  `engines.bun` follows the root engine or packageManager minimum, no `engines.node`
//   catalog  a dependency listed in the root catalog uses `catalog:`
//   scripts  no npm / npx / pnpm / yarn / node in scripts
//   typecheck  a package with a tsconfig.json exposes a `typecheck` script
//   m3       the M3 family shares the root product version and the `@aphrody/m3-config` presets
//            (docs/design/M3-PLAN.md)
//   install  `node_modules` holds only links into the isolated store: a real package directory is a
//            stale hoisted leftover that `bun install` never replaces (two copies of React, ...)

import { TOML } from "bun";
import { firstPartyManifests } from "@aphrody/update/manifests";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Vendored packages can be linked for resolution without adopting first-party manifest rules. */

/** The M3 UI family (published packages only): lockstep version and shared presets. */
export const M3_FAMILY = /^@aphrody\/(m3(-[a-z0-9-]+)?|material-web)$/;
/** M3 packages that keep their own tsconfig: the preset itself, the FFI package and the Lit fork. */
export const M3_OWN_TSCONFIG = new Set([
  "@aphrody/m3-config",
  "@aphrody/material-web",
  // Standalone targets: the Bun MCP server and the Next.js examples carry their own compiler options.
  "@aphrody/m3-mcp",
  "@aphrody/m3-next-example",
  "@aphrody/m3-next-tauri-example",
]);
/** Workspace packages whose tsconfig files are exported presets, not TypeScript source. */
export const TYPECHECK_EXEMPT = new Set(["@aphrody/drive-config"]);
const M3_PRESET = "@aphrody/m3-config/";

export interface Violation {
  path: string;
  rule: "pm" | "engines" | "catalog" | "scripts" | "typecheck" | "m3" | "install" | "bunfig";
  message: string;
  fixable: boolean;
}

/** What `checkManifest` knows about the package besides its manifest. */
export interface ManifestContext {
  hasTsconfig: boolean;
  bunRuntimeVersion?: string;
  /** `extends` of the package `tsconfig.json`, when present. */
  tsconfigExtends?: string;
  /** A `tsconfig.dev.json` exists (path maps the M3 source resolver replaces). */
  hasDevTsconfig?: boolean;
  /** Mutate the manifest to comply. */
  fix?: boolean;
}

type Manifest = Record<string, any>;
const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const FOREIGN_TOOL = /(^|[\s;&|(])(npx|npm|pnpm|yarn|node)(?=\s|$)/;

export function minimumBun(packageManager: string, runtimeVersion?: string): string {
  const version =
    /^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      packageManager,
    )?.[1];
  if (!version) throw new Error(`root packageManager must be bun@x.y.z, got ${packageManager}`);
  if (runtimeVersion && runtimeVersion !== version)
    throw new Error("Bun runtime contract must match the root packageManager");
  return `>=${runtimeVersion ?? version.split("-")[0]}`;
}

/** Check one manifest against the contract; with `fix`, mutate it to comply. */
export function checkManifest(path: string, manifest: Manifest, root: Manifest, context: ManifestContext): Violation[] {
  const { hasTsconfig, tsconfigExtends, hasDevTsconfig = false, fix = false } = context;
  const out: Violation[] = [];
  const catalog: Record<string, string> = root.catalog ?? root.workspaces?.catalog ?? {};
  const catalogs: Record<string, Record<string, string>> = root.catalogs ?? root.workspaces?.catalogs ?? {};
  const engine = root.engines?.bun ?? minimumBun(root.packageManager, context.bunRuntimeVersion);

  if (manifest.packageManager !== undefined) {
    out.push({
      path,
      rule: "pm",
      message: `packageManager ${manifest.packageManager}: only the root declares it`,
      fixable: true,
    });
    if (fix) delete manifest.packageManager;
  }
  if (manifest.engines?.node !== undefined) {
    out.push({
      path,
      rule: "engines",
      message: `engines.node ${manifest.engines.node}: Bun-only workspace`,
      fixable: true,
    });
    if (fix) delete manifest.engines.node;
  }
  if (manifest.engines?.bun?.replace(/^=/, "") !== engine.replace(/^=/, "")) {
    out.push({
      path,
      rule: "engines",
      message: `engines.bun ${manifest.engines?.bun ?? "(missing)"} -> ${engine}`,
      fixable: true,
    });
    if (fix) manifest.engines = { ...manifest.engines, bun: engine };
  }
  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries<string>(manifest[section] ?? {})) {
      const namedCatalog = /^catalog:([^:]+)$/.exec(spec)?.[1];
      const catalogSpec =
        spec === "catalog:" && name in catalog
          ? catalog[name]
          : namedCatalog && name in (catalogs[namedCatalog] ?? {})
            ? catalogs[namedCatalog]?.[name]
            : undefined;
      const expectedCatalog =
        name in catalog ? catalog[name] : Object.values(catalogs).find(entries => name in entries)?.[name];
      if (spec.startsWith("catalog:") && catalogSpec === undefined) {
        out.push({
          path,
          rule: "catalog",
          message: `${section}.${name} references missing ${namedCatalog ?? "default"} catalog entry`,
          fixable: false,
        });
        continue;
      }
      if (expectedCatalog && !catalogSpec && !spec.startsWith("workspace:")) {
        out.push({
          path,
          rule: "catalog",
          message: `${section}.${name} ${spec} -> catalog: (${expectedCatalog})`,
          fixable: true,
        });
        if (fix) manifest[section][name] = "catalog:";
      }
    }
  }
  for (const [name, command] of Object.entries<string>(manifest.scripts ?? {})) {
    const tool = FOREIGN_TOOL.exec(command)?.[2];
    if (tool)
      out.push({
        path,
        rule: "scripts",
        message: `scripts.${name} runs ${tool}: use bun or the PATH binary directly`,
        fixable: false,
      });
  }
  if (hasTsconfig && !TYPECHECK_EXEMPT.has(manifest.name) && !manifest.scripts?.typecheck) {
    out.push({
      path,
      rule: "typecheck",
      message: "tsconfig.json present but no `typecheck` script",
      fixable: true,
    });
    if (fix)
      manifest.scripts = {
        ...manifest.scripts,
        typecheck: "bun check -p tsconfig.json --noEmit",
      };
  }
  // Private manifests (the presets, the showcases) are never published: no lockstep for them.
  if (M3_FAMILY.test(manifest.name) && !manifest.private) {
    const version = root.version ?? root.aphrody?.m3Version;
    if (typeof version !== "string") throw new Error("root package.json must declare version or aphrody.m3Version");
    if (manifest.version !== version) {
      out.push({
        path,
        rule: "m3",
        message: `version ${manifest.version} -> ${version} (root product version)`,
        fixable: true,
      });
      if (fix) manifest.version = version;
    }
    if (hasTsconfig && !M3_OWN_TSCONFIG.has(manifest.name) && !tsconfigExtends?.startsWith(M3_PRESET)) {
      out.push({
        path,
        rule: "m3",
        message: `tsconfig.json extends ${tsconfigExtends ?? "(nothing)"}: extend ${M3_PRESET}tsconfig.json`,
        fixable: false,
      });
    }
    if (hasDevTsconfig) {
      out.push({
        path,
        rule: "m3",
        message: "tsconfig.dev.json: use the @aphrody/m3-config source resolver instead of path maps",
        fixable: false,
      });
    }
  }
  return out;
}

/**
 * Real (non-link) package directories directly under `<dir>/node_modules`, scoped ones as
 * `@scope/name`. The isolated linker only creates links there, plus `.bin` and scope folders.
 */
export async function staleInstallEntries(dir: string): Promise<string[]> {
  const root = join(dir, "node_modules");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    entries
      .filter(entry => !entry.name.startsWith("."))
      .map(async entry => {
        if (!entry.name.startsWith("@") || !entry.isDirectory()) return entry.isDirectory() ? [entry.name] : [];
        const scoped = await readdir(join(root, entry.name), {
          withFileTypes: true,
        });
        return scoped.filter(child => child.isDirectory()).map(child => `${entry.name}/${child.name}`);
      }),
  );
  return found.flat().toSorted();
}

interface InstallPolicy {
  linker?: string;
  hoist?: boolean;
  saveTextLockfile?: boolean;
  minimumReleaseAge?: number;
}

/** Read the package manager's native TOML config rather than infer settings from text. */
async function installPolicy(repo: string): Promise<InstallPolicy> {
  const file = Bun.file(join(repo, "bunfig.toml"));
  if (!(await file.exists())) return {};
  const parsed = TOML.parse(await file.text()) as { install?: InstallPolicy };
  return parsed.install ?? {};
}

function checkInstallPolicy(policy: InstallPolicy): Violation[] {
  const failures: string[] = [];
  if (policy.linker !== undefined && !["hoisted", "isolated"].includes(policy.linker))
    failures.push("install.linker must select hoisted or isolated");
  if (policy.saveTextLockfile === false) failures.push("install.saveTextLockfile must retain the root bun.lock");
  if (
    policy.minimumReleaseAge !== undefined &&
    (!Number.isFinite(policy.minimumReleaseAge) || policy.minimumReleaseAge < 0)
  )
    failures.push("install.minimumReleaseAge must be a non-negative duration");
  return failures.map(message => ({ path: "bunfig.toml", rule: "bunfig", message, fixable: false }));
}

export function parseTsconfigExtends(source: string): string | undefined {
  const parsed = Bun.JSONC.parse(source) as { extends?: unknown };
  return typeof parsed.extends === "string" ? parsed.extends : undefined;
}

async function readTsconfigExtends(dir: string): Promise<string | undefined> {
  const file = Bun.file(join(dir, "tsconfig.json"));
  if (!(await file.exists())) return undefined;
  return parseTsconfigExtends(await file.text());
}

export async function run(repo: string, fix: boolean): Promise<Violation[]> {
  const root = await Bun.file(join(repo, "package.json")).json();
  const runtimeFile = Bun.file(join(repo, "config", "bun-runtime.json"));
  const runtimeVersion = (await runtimeFile.exists()) ? (await runtimeFile.json()).version : undefined;
  if ((await runtimeFile.exists()) && typeof runtimeVersion !== "string")
    throw new Error("Bun runtime contract must declare its version");
  const policy = await installPolicy(repo);
  const isolated = policy.linker === "isolated";
  const perManifest = await Promise.all(
    (await firstPartyManifests(repo))
      .filter(path => /^(apps|packages)\/[^/]+\/package\.json$/.test(path))
      .map(async path => {
        const dir = join(repo, dirname(path));
        const file = Bun.file(join(repo, path));
        const manifest = await file.json();
        const [hasTsconfig, hasDevTsconfig, extended] = await Promise.all([
          Bun.file(join(dir, "tsconfig.json")).exists(),
          Bun.file(join(dir, "tsconfig.dev.json")).exists(),
          readTsconfigExtends(dir),
        ]);
        const found = checkManifest(path, manifest, root, {
          hasTsconfig,
          bunRuntimeVersion: runtimeVersion,
          hasDevTsconfig,
          tsconfigExtends: extended,
          fix,
        });
        if (fix && found.some(v => v.fixable)) await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
        const stale = isolated ? await staleInstallEntries(dir) : [];
        if (stale.length > 0) {
          const sample = stale.slice(0, 3).join(", ") + (stale.length > 3 ? ", ..." : "");
          found.push({
            path,
            rule: "install",
            message: `node_modules has ${stale.length} real package dir(s) (${sample}): stale hoisted install; move node_modules away and run bun install`,
            fixable: false,
          });
        }
        return found;
      }),
  );
  const violations = [...checkInstallPolicy(policy), ...perManifest.flat()];
  return fix ? violations.filter(v => !v.fixable) : violations;
}

function parseArgs(args: string[]): {
  repo: string;
  fix: boolean;
  json: boolean;
} {
  let repo = process.cwd();
  let fix = false;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repo = args[++index] ?? "";
    else if (arg === "--fix") fix = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops bun-workspace [--root <repository>] [--fix] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repo) throw new Error("--root requires a repository path");
  return { repo, fix, json };
}

export async function runBunWorkspace(args: string[]): Promise<number> {
  const options = parseArgs(args);
  const repo = resolve(options.repo);
  const violations = await run(repo, options.fix);
  if (options.json) {
    console.log(JSON.stringify(violations, null, 2));
  } else {
    for (const v of violations) console.log(`${v.path}  [${v.rule}]  ${v.message}${v.fixable ? "  (--fix)" : ""}`);
    const scanned = (await firstPartyManifests(repo)).length;
    console.log(
      `${scanned} first-party manifests, ${violations.length} violation(s)${options.fix ? " left after --fix" : ""}`,
    );
  }
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await runBunWorkspace(process.argv.slice(2)));
