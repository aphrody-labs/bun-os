// SPDX-License-Identifier: MIT
// Port of upstream scripts/design-context.py: gather optional lexical context for the agent to synthesize a 3D design.
import type { Catalog, CatalogRecord } from "./catalog.ts";
import { KNOWLEDGE_KINDS } from "./manifest-contract.ts";
import { buildBrief, checkHeroes, DEFAULT_DELIVERY, DELIVERY, type Host, PROBE } from "./quality-brief.ts";
import { resolveRecords } from "./resolve.ts";
import { search, type SearchResult } from "./search.ts";

/** The kinds a blueprint's fits_looks may name. */
export const LOOK_KINDS = new Set(["style-profile", "lighting-profile", "theme-profile"]);

const ASSEMBLY_STEP =
  "Assess each blueprint against the intended silhouette, structure, behavior and finish. " +
  "Reuse, adapt, reject or combine it with custom or sourced geometry by actual fit. " +
  "A matching noun does not require using its kit; document choices when useful.";

const NEXT_STEP =
  "Interpret the user constraints and negation yourself. Select useful " +
  "records, research factual claims, then synthesize a coherent design " +
  "with custom choices. Do not present this retrieval output as a " +
  "completed design system or treat absent matches as a capability limit.";

export interface BlueprintSummary {
  [key: string]: unknown;
  id: string;
  title: string;
  asset: string;
  kind: string;
  footprint_m: unknown;
  poly_budget: unknown;
  sockets: string[];
  detail_ladder: unknown;
  params: Record<string, unknown>;
}

/** Every blueprint compatible with the chosen looks. A filter, not a ranking. */
export function blueprintsFor(records: CatalogRecord[], looks: readonly string[]): BlueprintSummary[] {
  const chosen = new Set(looks);
  const rows: BlueprintSummary[] = [];
  for (const record of records) {
    if (record.knowledge_kind !== "blueprint" || record.status !== "active") continue;
    const fits = (record.fits_looks as string[] | undefined) ?? [];
    if (chosen.size && !fits.some(look => chosen.has(look))) continue;
    const asset = record.asset as { path: string; kind: string };
    rows.push({
      id: record.id,
      title: record.title.en,
      asset: asset.path,
      kind: asset.kind,
      footprint_m: record.footprint_m,
      poly_budget: record.poly_budget,
      sockets: (record.sockets as { name: string }[]).map(s => s.name),
      detail_ladder: record.detail_ladder,
      params: Object.fromEntries((record.params as { name: string; default: unknown }[]).map(p => [p.name, p.default])),
    });
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Same refusal shape as resolve(): name what is unknown rather than silently dropping it. */
export function checkLooks(records: CatalogRecord[], looks: readonly string[]): void {
  const byId = new Map(records.map(r => [r.id, r]));
  const unique = [...new Set(looks)];
  const unknown = unique.filter(look => !byId.has(look)).sort();
  if (unknown.length) throw new Error(`Unknown record IDs: ${unknown.join(", ")}`);
  const wrong = unique.filter(look => !LOOK_KINDS.has(byId.get(look)!.knowledge_kind ?? "")).sort();
  if (wrong.length) throw new Error(`Not a style, theme or lighting profile: ${wrong.join(", ")}`);
}

export interface GatherOptions {
  direction?: string | null;
  kinds?: readonly string[];
  excludeIds?: readonly string[];
  blueprints?: boolean;
  looks?: readonly string[];
  host?: Host | null;
  delivery?: string;
  heroes?: readonly string[];
}

export function gather(query: string, catalog: Catalog, options: GatherOptions = {}) {
  const { manifest, records, sources } = catalog;
  const {
    direction = null,
    kinds = [],
    excludeIds = [],
    blueprints = false,
    looks = [],
    host = null,
    delivery = DEFAULT_DELIVERY,
    heroes = [],
  } = options;
  if (!query.trim()) throw new Error("A nonempty objective is required");
  if (kinds.some(kind => !KNOWLEDGE_KINDS.has(kind))) throw new Error("Unknown knowledge kind");
  if (looks.length && !blueprints) throw new Error("--look only applies with --blueprints");
  if ((host || heroes.length) && !blueprints) throw new Error("--host and --hero only apply with --blueprints");
  if (heroes.length && !host) throw new Error(`--hero needs the host ceiling. Write one with: ${PROBE}`);
  if (!(delivery in DELIVERY))
    throw new Error(`Unknown delivery target ${delivery}: one of ${JSON.stringify(Object.keys(DELIVERY).sort())}`);
  checkLooks(records, looks);
  const groups: Record<string, SearchResult> = {
    recipes: search(query, manifest, records, { limit: 3, direction, excludeIds, collection: "recipes" }),
  };
  for (const kind of kinds) {
    groups[kind] = search(query, manifest, records, { limit: 2, direction, excludeIds, collection: "knowledge", kind });
  }
  const ids = [...new Set(Object.values(groups).flatMap(group => group.results.map(r => r.id)))];
  const context = resolveRecords(ids, manifest, records, sources);
  const result: Record<string, unknown> = {
    objective: query,
    status: ids.length ? "candidates" : "no-match",
    candidate_groups: groups,
    context,
    next_step: NEXT_STEP,
  };
  if (blueprints) {
    // A filter over fits_looks, not a ranking: with 22 blueprints the compatible set is small enough to hand
    // over whole, and a BM25 score over authored geometry names would be noise.
    const rows = blueprintsFor(records, looks);
    result.blueprints = rows;
    result.next_step = `${NEXT_STEP} ${ASSEMBLY_STEP}`;
    if (host) {
      checkHeroes(rows, heroes);
      result.quality_brief = buildBrief(rows, records, host, delivery, heroes, catalog.root);
    }
  }
  return result;
}
