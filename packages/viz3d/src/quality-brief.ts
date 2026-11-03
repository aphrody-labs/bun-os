// SPDX-License-Identifier: MIT
// Port of upstream scripts/quality_brief.py: recommend a shipped-kit pipeline per blueprint from host tools and
// declared proof status. A hero gets the host ceiling capped by the delivery target (or reuse of a proved shipped
// GLB), mid ground gets T2, an instanced background T1. A tier a record calls missing or not-proved is never
// recommended: the brief steps down and names the status it stepped over. These defaults do not constrain custom
// construction, sourced assets, art direction or factual fidelity.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { CatalogRecord } from "./catalog.ts";
import { skillRoot } from "./paths.ts";

export const PROBE = "bun scripts/host-probe.js --out host.json";
export const TIER_ORDER = ["T0", "T1", "T2", "T3", "T4"] as const;
export type Tier = (typeof TIER_ORDER)[number];
const UNAVAILABLE = new Set(["missing", "not-proved"]);
export const DEFAULT_DELIVERY = "web-desktop";
export const DELIVERY: Record<string, { cap: Tier | null; background?: Tier }> = {
  "web-desktop": { cap: "T3" },
  "web-mobile": { cap: "T2", background: "T0" },
  "offline-still": { cap: null },
  presentation: { cap: "T2" },
};
export const ROLE_RULES = {
  hero: "host bake ceiling or proved shipped GLB reuse, capped by the delivery target",
  mid: "T2 (procedural surface, no shipped bytes)",
  background: "T1 (instanced repeat, flat material)",
};
export const DRAW_CALL_NOTE =
  "Background and repeated objects stay one InstancedMesh at T1 and are never wrapped in a LOD. " +
  "Eval run 3 measured 4,773 draw calls at 5 fps with every object built as a separate mesh - " +
  "that measurement is the concrete reason this note exists. An instanced field is one draw " +
  "call whatever the count; a LOD per repeat adds a per-frame update and removes no draws.";
export const BRIEF_NOTE =
  "Shipped-kit pipeline recommendations, not limits on artistic quality or construction. " +
  "Choose kit, adapted kit, custom geometry or sourced assets by object fit. " +
  "Blender availability does not grade the result; inspect identity, structure, surface " +
  "and factual fidelity at the intended viewing scale. T0 is an optional layout proxy. " +
  "Keep the declared proof status when reporting a kit tier.";

export interface TierEntry {
  mode?: string;
  status: string;
  asset?: { path?: string } | null;
  [key: string]: unknown;
}

export interface Host {
  quality_ceiling: Tier;
  quality_ceiling_reason?: string;
  capture_mode_expected?: string;
  [key: string]: unknown;
}

/** The uniform tier view: T1 is the record's own asset and proof, never stored twice (blueprint_tiers). */
export function tierView(record: CatalogRecord): Record<string, TierEntry> {
  const declared = (record.tiers as Record<string, TierEntry> | undefined) ?? {};
  if (typeof declared !== "object" || Array.isArray(declared)) throw new Error(`${record.id}.tiers: object required`);
  if ("T1" in declared) throw new Error(`${record.id}.tiers: T1 is the record asset, do not declare it`);
  return {
    ...declared,
    T1: {
      mode: "module",
      asset: (record.asset as TierEntry["asset"]) ?? null,
      proof: record.proof ?? null,
      poly_budget: record.poly_budget ?? null,
      status: "proved",
    },
  };
}

const index = (tier: string) => TIER_ORDER.indexOf(tier as Tier);
const lowerOf = (first: Tier, second: Tier): Tier => (index(first) <= index(second) ? first : second);

/** `instanced` is authored on exactly the blueprints meant to repeat in the background. */
export function roleFor(record: CatalogRecord, heroes: readonly string[]): "hero" | "mid" | "background" {
  if (heroes.includes(record.id)) return "hero";
  return ((record.tags as string[] | undefined) ?? []).includes("instanced") ? "background" : "mid";
}

/** What the role rule asks for, before the record gets a say. */
export function wantedTier(role: string, ceiling: Tier, delivery: string): [Tier, string] {
  const rules = DELIVERY[delivery]!;
  const cap = rules.cap ?? ceiling;
  if (role === "background") {
    const floor = rules.background ?? "T1";
    return [
      floor,
      floor === "T1" ? "instanced repeat: flat material, one draw call" : `instanced repeat, and ${delivery} caps it at ${floor}`,
    ];
  }
  if (role === "hero") {
    const target = lowerOf(ceiling, cap);
    return [
      target,
      target === ceiling
        ? `hero at the host ceiling ${ceiling}`
        : `hero wanted the host ceiling ${ceiling}, ${delivery} caps it at ${target}`,
    ];
  }
  const target = lowerOf("T2", cap);
  return [
    target,
    target === "T2" ? "mid ground: procedural surface, no shipped bytes" : `mid ground, capped by ${delivery} at ${target}`,
  ];
}

const declares = (tiers: Record<string, TierEntry>, name: string) =>
  tiers[name] ? `declares ${name} ${tiers[name]!.status}` : `declares no ${name} yet`;

/** Step down from the wanted tier until the record actually offers one. Never invents a tier. */
export function recommend(
  record: CatalogRecord,
  role: string,
  ceiling: Tier,
  delivery: string,
  root = skillRoot(),
): [Tier | null, string] {
  let [target, reason] = wantedTier(role, ceiling, delivery);
  const tiers = tierView(record);
  // Existing proved GLBs can be loaded without the Blender installation needed to rebake them.
  const baked = tiers.T3;
  const asset = baked?.asset?.path;
  const path = asset ? resolve(root, asset) : null;
  const reusable =
    baked?.mode === "gltf" &&
    baked.status === "proved" &&
    path !== null &&
    !relative(resolve(root), path).startsWith("..") &&
    existsSync(path) &&
    statSync(path).isFile();
  if (role === "hero" && reusable && index(target) < 3) {
    const reuseTarget = lowerOf("T3", DELIVERY[delivery]!.cap ?? "T3");
    if (index(reuseTarget) > index(target)) {
      target = reuseTarget;
      reason =
        "hero reuses a proved shipped T3 GLB; local Blender is only needed to rebake; " +
        `host bake ceiling ${ceiling}, delivery ${delivery}`;
    }
  }
  let tier: Tier | null = target;
  while (tier !== null && (!(tier in tiers) || UNAVAILABLE.has(tiers[tier]!.status))) {
    const i = index(tier);
    tier = i ? TIER_ORDER[i - 1]! : null;
  }
  if (tier === null) return [null, `${reason}; the record ${declares(tiers, target)} and offers no lower tier`];
  if (tier !== target) return [tier, `${reason}; the record ${declares(tiers, target)}, so ${tier}`];
  return [tier, `${reason}; the record ${declares(tiers, tier)}`];
}

export interface BlueprintRow {
  id: string;
  [key: string]: unknown;
}

/** A tier and a one-line reason per listed blueprint, from the probe and the records. */
export function buildBrief(
  rows: BlueprintRow[],
  records: CatalogRecord[],
  host: Host,
  delivery: string,
  heroes: readonly string[],
  root = skillRoot(),
) {
  const byId = new Map(records.map(r => [r.id, r]));
  const ceiling = host.quality_ceiling;
  const perBlueprint: Record<string, { role: string; tier: Tier | null; reason: string }> = {};
  for (const row of rows) {
    const record = byId.get(row.id)!;
    const role = roleFor(record, heroes);
    const [tier, reason] = recommend(record, role, ceiling, delivery, root);
    perBlueprint[row.id] = { role, tier, reason };
  }
  return {
    scope: "shipped-kit-pipelines",
    delivery,
    ceiling,
    ceiling_reason: host.quality_ceiling_reason ?? null,
    capture_mode_expected: host.capture_mode_expected ?? null,
    role_rules: ROLE_RULES,
    per_blueprint: perBlueprint,
    draw_call_note: DRAW_CALL_NOTE,
    note: BRIEF_NOTE,
  };
}

/** The probe's report, or a usage error naming the command that writes one. */
export function loadHost(path: string): Host {
  let host: unknown;
  try {
    host = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`--host ${path}: ${(error as Error).message}. Write one with: ${PROBE}`);
  }
  if (!host || typeof host !== "object" || !TIER_ORDER.includes((host as Host).quality_ceiling))
    throw new Error(`--host ${path}: no quality_ceiling in it. Write one with: ${PROBE}`);
  return host as Host;
}

export function checkHeroes(rows: BlueprintRow[], heroes: readonly string[]): void {
  const listed = new Set(rows.map(r => r.id));
  const unknown = [...new Set(heroes)].filter(h => !listed.has(h)).sort();
  if (unknown.length) throw new Error(`--hero names records that are not listed blueprints here: ${unknown.join(", ")}`);
}

export const skillFile = (rel: string, root = skillRoot()) => join(root, rel);
