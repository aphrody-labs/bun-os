/** Cell status and per-language percentages, computed from manifest/coverage.json and the recorded build/run results. */
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dir, "../../..");
export const LANGS = ["cpp", "cs", "rust", "bun"] as const;
export type Lang = (typeof LANGS)[number];
export type Status = "not-started" | "builds" | "runs-headless" | "runs-interactive-only-CI-or-manual";
export const STATUSES: Status[] = ["not-started", "builds", "runs-headless", "runs-interactive-only-CI-or-manual"];

export interface Cell {
  impl?: string;
  dotnet?: string;
}
export interface Row {
  id: string;
  category: string;
  title: string;
  source: { repo: string; pin: string; path: string };
  interactive: boolean;
  cells: Record<Lang, Cell>;
}
export interface Manifest {
  schemaVersion: number;
  pins: Record<string, { repo: string; ref: string; sha: string }>;
  rows: Row[];
}
export interface ImplResult {
  lang: string;
  dir: string;
  scope: string;
  build: boolean;
  run?: boolean;
}
export interface DotnetResults {
  sdk: string;
  tfm: string;
  templates: Record<
    string,
    { generated: boolean; build?: boolean; run?: boolean; aot?: boolean; interactive?: boolean }
  >;
}
export interface Inputs {
  manifest: Manifest;
  impls: Record<string, ImplResult>;
  dotnet: Record<string, DotnetResults>;
}

export async function load(): Promise<Inputs> {
  const dir = join(root, "packages/windows-samples-tests/manifest");
  const manifest = (await Bun.file(join(dir, "coverage.json")).json()) as Manifest;
  const resFile = Bun.file(join(dir, "results.json"));
  const impls = (await resFile.exists()) ? (await resFile.json()).impls : {};
  const dotnet: Record<string, DotnetResults> = {};
  for (const ch of ["10", "11"]) {
    const f = Bun.file(join(root, `examples/windows/dotnet${ch}/results.json`));
    if (await f.exists()) dotnet[`dotnet${ch}`] = await f.json();
  }
  return { manifest, impls, dotnet };
}

export function cellStatus(cell: Cell, row: Row, inp: Inputs): Status {
  if (cell.impl) {
    const r = inp.impls[cell.impl];
    if (!r?.build) return "not-started";
    if (row.interactive && r.run === undefined) return "runs-interactive-only-CI-or-manual";
    return r.run === true ? "runs-headless" : "builds";
  }
  if (cell.dotnet) {
    const [channel, name] = cell.dotnet.split("/") as [string, string];
    const t = inp.dotnet[channel]?.templates[name];
    if (!t?.generated || !t.build) return "not-started";
    if (t.interactive) return "runs-interactive-only-CI-or-manual";
    return t.run === true ? "runs-headless" : "builds";
  }
  return "not-started";
}

export interface Computed {
  statuses: Record<string, Record<Lang, Status>>;
  perLang: Record<
    Lang,
    {
      total: number;
      counts: Record<Status, number>;
      implementedPct: number;
      runsHeadlessPct: number;
      functionalImplementedPct: number;
      functionalRunsPct: number;
    }
  >;
  perCategory: Record<string, Record<Lang, Record<Status, number>> & { rows?: number }>;
  categoryRows: Record<string, number>;
}

/** Rows whose only implementation is the static XAML scan are excluded from the "functional" percentages. */
const isStatic = (row: Row) => row.cells.cpp.impl?.startsWith("xaml-static") ?? false;

export function compute(inp: Inputs): Computed {
  const statuses: Computed["statuses"] = {};
  const perLang = {} as Computed["perLang"];
  const perCategory: Computed["perCategory"] = {};
  const categoryRows: Record<string, number> = {};
  const fresh = () => Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  for (const l of LANGS)
    perLang[l] = {
      total: 0,
      counts: fresh(),
      implementedPct: 0,
      runsHeadlessPct: 0,
      functionalImplementedPct: 0,
      functionalRunsPct: 0,
    };
  const fn = Object.fromEntries(LANGS.map(l => [l, { total: 0, impl: 0, run: 0 }])) as Record<
    Lang,
    { total: number; impl: number; run: number }
  >;
  for (const row of inp.manifest.rows) {
    categoryRows[row.category] = (categoryRows[row.category] ?? 0) + 1;
    statuses[row.id] = {} as Record<Lang, Status>;
    perCategory[row.category] ??= Object.fromEntries(LANGS.map(l => [l, fresh()])) as never;
    for (const l of LANGS) {
      const s = cellStatus(row.cells[l], row, inp);
      statuses[row.id]![l] = s;
      perLang[l].total++;
      perLang[l].counts[s]++;
      (perCategory[row.category]![l] as Record<Status, number>)[s]++;
      if (!isStatic(row)) {
        fn[l].total++;
        if (s !== "not-started") fn[l].impl++;
        if (s === "runs-headless") fn[l].run++;
      }
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  for (const l of LANGS) {
    const p = perLang[l];
    p.implementedPct = pct(p.total - p.counts["not-started"], p.total);
    p.runsHeadlessPct = pct(p.counts["runs-headless"], p.total);
    p.functionalImplementedPct = pct(fn[l].impl, fn[l].total);
    p.functionalRunsPct = pct(fn[l].run, fn[l].total);
  }
  return { statuses, perLang, perCategory, categoryRows };
}
