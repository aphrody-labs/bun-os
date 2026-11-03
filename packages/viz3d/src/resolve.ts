// SPDX-License-Identifier: MIT
// Port of upstream scripts/resolve.py: resolve explicitly selected records and their sources without guessing intent.
import { sequenceRatio } from "@aphrody/m3-design/intelligence/ui-ux-pro-max/scripts/difflib.ts";
import { type CatalogRecord, fingerprint, lossless, type Source } from "./catalog.ts";
import type { Manifest } from "./manifest-contract.ts";
import { canonical, pyDumps, type PyValue, sha256 } from "./pyjson.ts";

interface Param {
  name: string;
  default: unknown;
}

interface Asset {
  path: string;
  kind: string;
  factory?: string;
}

export interface BlueprintUsage {
  asset: string;
  kind: string;
  factory: string;
  module: string;
  awaits: boolean;
  params: Record<string, unknown>;
  sockets: string[];
  detail_ladder: unknown;
  proof: unknown;
  snippet: string;
}

/** difflib.get_close_matches(word, possibilities, n=1, cutoff): best ratio, ties to the larger string. */
export function closeMatch(word: string, possibilities: Iterable<string>, cutoff = 0.8): string | undefined {
  let best: { score: number; x: string } | undefined;
  for (const x of possibilities) {
    const score = sequenceRatio(x, word);
    if (score < cutoff) continue;
    if (!best || score > best.score || (score === best.score && x > best.x)) best = { score, x };
  }
  return best?.x;
}

/** Copy-paste starting point for one blueprint; the params are tunable, not a required call. */
export function blueprintUsage(record: CatalogRecord): BlueprintUsage {
  const asset = record.asset as Asset;
  const params = (record.params as Param[]) ?? [];
  // Python json.dumps of each default, floats included (1.0 stays 1.0), read from the lossless record.
  const exactParams = ((lossless(record) as { params?: { default: PyValue }[] }).params ?? []);
  const args = params.map((p, i) => `${p.name}: ${pyDumps(exactParams[i]?.default ?? null)}`).join(", ");
  const factory = asset.factory ?? "create";
  // A gltf-asset record points at the .glb; the callable is its sibling loader wrapper, whose
  // create() returns a Promise because the geometry lives in a file.
  const gltf = asset.kind === "gltf-asset";
  const module = gltf ? asset.path.replace(/\.glb$/, ".js") : asset.path;
  const call = `${gltf ? "await " : ""}${factory}({ ${args} })`;
  return {
    asset: asset.path,
    kind: asset.kind,
    factory,
    module,
    awaits: gltf,
    params: Object.fromEntries(params.map(p => [p.name, p.default])),
    sockets: ((record.sockets as { name: string }[]) ?? []).map(s => s.name),
    detail_ladder: record.detail_ladder ?? null,
    proof: record.proof ?? null,
    snippet:
      `import { ${factory} } from './${module.split("/").slice(2).join("/")}';\n` +
      `const { group, sockets } = ${call};\n` +
      `scene.add(group);`,
  };
}

export interface ResolveResult {
  catalog_hash: string;
  bundle_hash: string;
  selected_ids: string[];
  records: CatalogRecord[];
  sources: Source[];
  notice: string;
  blueprints?: Record<string, BlueprintUsage>;
}

export function resolveRecords(
  ids: readonly string[],
  manifest: Manifest,
  records: CatalogRecord[],
  sources: Source[],
  related = false,
): ResolveResult {
  const byId = new Map(records.map(r => [r.id, r]));
  const unknown = [...new Set(ids)].filter(id => !byId.has(id)).sort();
  if (unknown.length) {
    // A lexical near-name, not a claim that the suggestion is what the caller meant.
    const named = unknown.map(rid => {
      const close = closeMatch(rid, byId.keys());
      return close ? `${rid} (did you mean ${close}?)` : rid;
    });
    throw new Error(`Unknown record IDs: ${named.join(", ")}`);
  }
  const chosen = [...new Set(ids)];
  if (related) {
    // One hop only: avoid loading an entire connected catalog for one subject.
    for (const rid of [...chosen]) {
      for (const neighbor of byId.get(rid)!.related_ids ?? []) {
        if (!byId.has(neighbor)) throw new Error(`Dangling relationship: ${rid} -> ${neighbor}`);
        if (!chosen.includes(neighbor)) chosen.push(neighbor);
      }
    }
  }
  const selected = chosen.map(id => byId.get(id)!);
  const sourceIds = new Set(
    selected.flatMap(r => (r.claims ?? []).flatMap(c => (c.source_refs ?? []).map(ref => ref.source_id))),
  );
  const bySource = new Map(sources.map(s => [s.id, s]));
  const missing = [...sourceIds].filter(id => !bySource.has(id)).sort();
  if (missing.length) throw new Error(`Unknown source IDs: ${missing.join(", ")}`);
  const selectedSources = [...sourceIds].sort().map(id => bySource.get(id)!);
  const bundle = canonical([selected.map(r => lossless(r)), selectedSources.map(s => lossless(s))]);
  const result: ResolveResult = {
    catalog_hash: fingerprint(manifest, records),
    bundle_hash: sha256(bundle),
    selected_ids: [...new Set(ids)],
    records: selected,
    sources: selectedSources,
    notice:
      "These are authored records and source metadata, not new source reads " +
      "or runtime verification. Apply only the guidance relevant to the task.",
  };
  const blueprints = Object.fromEntries(selected.filter(r => "asset" in r).map(r => [r.id, blueprintUsage(r)]));
  // A blueprint carries a module and a proof; the snippet is where to start, not a contract.
  if (Object.keys(blueprints).length) result.blueprints = blueprints;
  return result;
}
