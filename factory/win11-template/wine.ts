// SPDX-License-Identifier: Apache-2.0
// Static Win32 import coverage against the locally supplied Wine source tree.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coverage as measureCoverage, parseSpec, type SpecCoverage } from "../../packages/microsoft/src/wine";
import type { PeFacts } from "./pe-worker";

const WINE_VERSION = "wine-11.20";
const STATUS = ["unknown", "implemented", "stub", "missing"] as const;
type ImportStatus = (typeof STATUS)[number];

interface WineImport {
  dll: string;
  name: string;
  delay: boolean;
  status: ImportStatus;
}

interface WineCounts {
  total: number;
  implemented: number;
  stub: number;
  missing: number;
  percent: number;
}

interface WineProgram {
  file: string;
  machine: string;
  dotnet: boolean;
  dlls: number;
  coverage: WineCounts;
  unknownDlls: string[];
  missing: string[];
  imports: WineImport[];
}

export interface WineCoverage {
  wine: { version: string; commit: string };
  summary: WineCounts & { programs: number; specDlls: number; unknownDlls: string[] };
  rows: WineProgram[];
}

function dllBase(module: string): string {
  return module.replace(/\.(?:dll|drv|ocx)$/i, "").toLowerCase();
}

function wineRevision(winePath: string): string {
  if (!existsSync(join(winePath, ".git"))) return "unavailable";
  try {
    const result = Bun.spawnSync(["git", "-C", winePath, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return "unavailable";
    const revision = new TextDecoder().decode(result.stdout).trim();
    return /^[0-9a-f]{40}$/i.test(revision) ? revision : "unavailable";
  } catch {
    return "unavailable";
  }
}

function counts(total: number, implemented: number, stub: number, missing: number): WineCounts {
  return {
    total,
    implemented,
    stub,
    missing,
    percent: total ? Math.round((implemented / total) * 1000) / 10 : 100,
  };
}

/** Build per-image import coverage. Wine specs are read only from the caller's pinned local checkout. */
export function buildCoverage(files: { rel: string; pe: PeFacts }[], winePath: string): WineCoverage {
  const requested = new Set<string>();
  for (const { pe } of files) for (const [module] of pe.imports) requested.add(dllBase(module));

  const specs = new Map<string, SpecCoverage>();
  for (const dll of requested) {
    const path = join(winePath, "dlls", dll, `${dll}.spec`);
    if (existsSync(path)) specs.set(dll, parseSpec(readFileSync(path, "utf8")));
  }

  let total = 0;
  let implemented = 0;
  let stub = 0;
  let missing = 0;
  const allUnknown = new Set<string>();
  const rows: WineProgram[] = files.map(({ rel, pe }) => {
    const imports = new Map<string, string[]>();
    const details: WineImport[] = [];
    for (const [module, delay, names] of pe.imports) {
      const base = dllBase(module);
      imports.set(base, [...(imports.get(base) ?? []), ...names]);
      const spec = specs.get(base);
      for (const name of names) {
        const status: ImportStatus =
          name.startsWith("#") || !spec
            ? "unknown"
            : spec.implemented.has(name)
              ? "implemented"
              : spec.stubs.has(name)
                ? "stub"
                : "missing";
        details.push({ dll: module, name, delay, status });
      }
    }

    const measured = measureCoverage(imports, specs);
    const unknownDlls = measured.unknownDlls.sort((a, b) => a.localeCompare(b));
    for (const dll of unknownDlls) allUnknown.add(dll);
    const coverage = counts(measured.total, measured.implemented, measured.stub, measured.missing);
    total += coverage.total;
    implemented += coverage.implemented;
    stub += coverage.stub;
    missing += coverage.missing;
    return {
      file: rel,
      machine: pe.machine,
      dotnet: pe.dotnet,
      dlls: imports.size,
      coverage,
      unknownDlls,
      missing: measured.missingNames.slice(0, 25),
      imports: details,
    };
  });

  return {
    wine: { version: WINE_VERSION, commit: wineRevision(winePath) },
    summary: {
      ...counts(total, implemented, stub, missing),
      programs: rows.length,
      specDlls: specs.size,
      unknownDlls: [...allUnknown].sort((a, b) => a.localeCompare(b)),
    },
    rows,
  };
}

/** Build the compact relation chunk: one row per imported function, with status codes in `meta.statuses`. */
export function wineChunkColumns(coverage: WineCoverage, symbols: { id(value: string): number }) {
  const file: number[] = [];
  const dll: number[] = [];
  const name: number[] = [];
  const status: number[] = [];
  const delay: number[] = [];
  const statusId = new Map<ImportStatus, number>(STATUS.map((value, index) => [value, index]));

  for (const row of coverage.rows) {
    for (const item of row.imports) {
      file.push(symbols.id(row.file));
      dll.push(symbols.id(item.dll));
      name.push(symbols.id(item.name));
      status.push(statusId.get(item.status)!);
      delay.push(item.delay ? 1 : 0);
    }
  }

  return {
    meta: {
      version: coverage.wine.version,
      commit: coverage.wine.commit,
      statuses: STATUS,
      rows: coverage.rows.reduce((sum, row) => sum + row.imports.length, 0),
    },
    columns: {
      file: new Uint32Array(file),
      dll: new Uint32Array(dll),
      name: new Uint32Array(name),
      status: new Uint8Array(status),
      delay: new Uint8Array(delay),
    },
  };
}

/** Write the generated compatibility report next to the public template artifacts. */
export async function writeCoverage(root: string, coverage: WineCoverage, manifest: { generated: string }) {
  const report = {
    generated: manifest.generated,
    wine: coverage.wine,
    summary: coverage.summary,
    programs: coverage.rows.map(({ imports: _imports, ...row }) => row),
  };
  await Bun.write(join(root, "apps/webos/public/win11/wine-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
}
