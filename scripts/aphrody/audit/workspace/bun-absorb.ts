// SPDX-License-Identifier: Apache-2.0
//! Bun-first dependency ratchet over `tools/config/bun-absorb.json`.
//!
//!   bun scripts/audit/workspace/bun-absorb.ts [--json] [--write-baseline] [--fork-active]
//!
//! Fails when a `builtin` package is declared by a workspace package, when a root catalog entry
//! is used by no workspace package, or when a `native` package is imported by more files than
//! `tools/config/bun-absorb.baseline.json` records. Declared `fork` packages were absorbed by the
//! abandoned the former Bun fork fork; upstream Bun does not resolve them, so they only warn (`--fork-active`
//! refuses them, for a runtime that does). `--write-baseline` records the
//! current import counts, which may only go down.

import { resolve } from "node:path";

export type Status = "builtin" | "fork" | "native" | "gap";

export interface AbsorbEntry {
  name: string;
  status: Status;
  bun: string;
}

export interface AbsorbConfig {
  schemaVersion: 1;
  scan: { include: string; exclude: string[] };
  packages: AbsorbEntry[];
}

export interface Manifest {
  path: string;
  json: Record<string, unknown>;
}

export interface Finding {
  level: "error" | "warn";
  kind: "declared-builtin" | "declared-fork" | "dead-catalog" | "native-regression";
  package: string;
  detail: string;
}

export interface Report {
  schema: "aphrody.bun-absorb/1";
  ok: boolean;
  imports: Record<string, number>;
  findings: Finding[];
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']((?:@[^/"'\s]+\/)?[^./"'\s][^/"'\s]*)(?:\/[^"'\s]*)?["']/g;

/** Bare package names imported by one source file. */
export function importedPackages(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(SPECIFIER)) found.add(match[1]!);
  return found;
}

/** Dependency names declared by one manifest, with their specifiers. */
export function declared(json: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of DEPENDENCY_FIELDS) {
    const deps = json[field];
    if (deps && typeof deps === "object") {
      for (const [name, spec] of Object.entries(deps)) out.set(name, String(spec));
    }
  }
  return out;
}

export function evaluate(
  config: AbsorbConfig,
  manifests: Manifest[],
  catalog: Record<string, string>,
  imports: Record<string, number>,
  baseline: Record<string, number>,
  forkActive: boolean,
): Report {
  const findings: Finding[] = [];
  const users = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const name of declared(manifest.json).keys()) {
      users.set(name, [...(users.get(name) ?? []), manifest.path]);
    }
  }
  for (const entry of config.packages) {
    const by = users.get(entry.name) ?? [];
    if (entry.status === "builtin" && by.length > 0) {
      findings.push({
        level: "error",
        kind: "declared-builtin",
        package: entry.name,
        detail: `${by.join(", ")} -> ${entry.bun}`,
      });
    }
    if (entry.status === "fork" && by.length > 0) {
      findings.push({
        level: forkActive ? "error" : "warn",
        kind: "declared-fork",
        package: entry.name,
        detail: `${by.join(", ")} -> ${entry.bun}`,
      });
    }
    if (entry.status === "native") {
      const now = imports[entry.name] ?? 0;
      const allowed = baseline[entry.name] ?? 0;
      if (now > allowed) {
        findings.push({
          level: "error",
          kind: "native-regression",
          package: entry.name,
          detail: `${now} files > baseline ${allowed}; use ${entry.bun}`,
        });
      }
    }
  }
  for (const name of Object.keys(catalog)) {
    if (!users.has(name)) {
      findings.push({
        level: "error",
        kind: "dead-catalog",
        package: name,
        detail: "no workspace package uses this catalog entry",
      });
    }
  }
  return {
    schema: "aphrody.bun-absorb/1",
    ok: findings.every(finding => finding.level !== "error"),
    imports,
    findings,
  };
}

async function workspaceManifests(root: string, patterns: string[]): Promise<Manifest[]> {
  const manifests: Manifest[] = [
    {
      path: "package.json",
      json: await Bun.file(resolve(root, "package.json")).json(),
    },
  ];
  // Negated workspace patterns (packages leaving for another repository) still count as users.
  for (const pattern of patterns.filter(p => !p.startsWith("!"))) {
    for await (const rawPath of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      const path = rawPath.replace(/\\/g, "/");
      if (path.includes("node_modules/")) continue;
      manifests.push({
        path,
        json: await Bun.file(resolve(root, path)).json(),
      });
    }
  }
  return manifests;
}

async function countImports(root: string, config: AbsorbConfig): Promise<Record<string, number>> {
  const tracked = new Set(config.packages.filter(entry => entry.status !== "builtin").map(entry => entry.name));
  const exclude = new RegExp(
    `(^|/)(${config.scan.exclude.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(/|$)`,
  );
  const counts: Record<string, number> = {};
  for await (const rawPath of new Bun.Glob(config.scan.include).scan({
    cwd: root,
    onlyFiles: true,
  })) {
    const path = rawPath.replace(/\\/g, "/");
    if (exclude.test(path)) continue;
    let source: string;
    try {
      source = await Bun.file(resolve(root, path)).text();
    } catch {
      continue;
    }
    for (const name of importedPackages(source)) {
      if (tracked.has(name)) counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  const root = resolve(import.meta.dir, "../../../../");
  const config: AbsorbConfig = await Bun.file(resolve(root, "tools/config/bun-absorb.json")).json();
  const rootManifest = await Bun.file(resolve(root, "package.json")).json();
  const baselinePath = resolve(root, "tools/config/bun-absorb.baseline.json");
  const imports = await countImports(root, config);
  const native = new Set(config.packages.filter(entry => entry.status === "native").map(entry => entry.name));
  if (args.has("--write-baseline")) {
    const counts = Object.fromEntries(Object.entries(imports).filter(([name]) => native.has(name)));
    await Bun.write(baselinePath, `${JSON.stringify({ schemaVersion: 1, imports: counts }, null, 2)}\n`);
  }
  const baselineFile = Bun.file(baselinePath);
  const baseline: Record<string, number> = (await baselineFile.exists()) ? (await baselineFile.json()).imports : {};
  const report = evaluate(
    config,
    await workspaceManifests(root, rootManifest.workspaces.packages),
    rootManifest.workspaces.catalog ?? {},
    imports,
    baseline,
    args.has("--fork-active"),
  );
  if (args.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const [name, count] of Object.entries(report.imports)) {
      const entry = config.packages.find(candidate => candidate.name === name)!;
      console.log(`${entry.status.padEnd(7)} ${name.padEnd(30)} ${String(count).padStart(4)}  -> ${entry.bun}`);
    }
    for (const finding of report.findings)
      console.log(`${finding.level} ${finding.kind} ${finding.package}: ${finding.detail}`);
    console.log(report.ok ? "bun-absorb: ok" : "bun-absorb: FAILED");
  }
  process.exit(report.ok ? 0 : 1);
}
