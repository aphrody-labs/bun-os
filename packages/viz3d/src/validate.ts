// SPDX-License-Identifier: MIT
// The manifest contract plus JSON Schema validation of the whole dataset against upstream's schemas/ (draft
// 2020-12, through Ajv): every recipe, knowledge record, source and direction, the record layout, unique IDs, the
// relationships and source references a resolve would follow, and the catalog-summary hashes and counts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { catalogHashes, fingerprint, loadCatalog } from "./catalog.ts";
import { parse } from "./commands.ts";
import { skillRoot } from "./paths.ts";

export interface ValidationReport {
  ok: boolean;
  counts: { recipes: number; knowledge: number; blueprints: number; sources: number; directions: number };
  knowledge_by_kind: Record<string, number>;
  hashes: { catalog_hash: string; content_catalog_hash: string; layout_hash: string; match_summary: boolean };
  errors: string[];
}

export function validateDataset(root = skillRoot()): ValidationReport {
  const errors: string[] = [];
  const schema = (name: string) => JSON.parse(readFileSync(join(root, "schemas", `${name}.schema.json`), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const check = (validator: NonNullable<ReturnType<typeof ajv.getSchema>>, value: unknown, label: string) => {
    if (!validator(value))
      for (const e of validator.errors ?? []) errors.push(`${label}${e.instancePath}: ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
  };
  // The schemas refer to each other by file name (knowledge.schema.json -> recipe.schema.json#/allOf/0).
  const names = ["recipe", "knowledge", "source", "direction", "evidence-event"];
  for (const name of names) ajv.addSchema(schema(name), `${name}.schema.json`);
  const compiled = (name: string) => ajv.getSchema(`${name}.schema.json`)!;
  const catalog = loadCatalog(root, "all");
  const recipe = compiled("recipe");
  const knowledge = compiled("knowledge");
  const source = compiled("source");
  const direction = compiled("direction");
  const byKind: Record<string, number> = {};
  for (const { _path, ...record } of catalog.records) {
    if (record.id.startsWith("recipe.")) check(recipe, record, record.id);
    else {
      check(knowledge, record, record.id);
      byKind[record.knowledge_kind ?? "?"] = (byKind[record.knowledge_kind ?? "?"] ?? 0) + 1;
    }
  }
  for (const s of catalog.sources) check(source, s, `source ${s.id}`);
  const directions = JSON.parse(readFileSync(join(root, "data/directions.json"), "utf8")) as { id: string }[];
  for (const d of directions) check(direction, d, `direction ${d.id}`);
  const ids = new Set(catalog.records.map(r => r.id));
  const sourceIds = new Set(catalog.sources.map(s => s.id));
  const directionIds = new Set(directions.map(d => d.id));
  for (const r of catalog.records) {
    for (const rel of r.related_ids ?? []) if (!ids.has(rel)) errors.push(`${r.id}: dangling related_ids ${rel}`);
    for (const c of r.claims ?? [])
      for (const ref of c.source_refs ?? []) if (!sourceIds.has(ref.source_id)) errors.push(`${r.id}: unknown source ${ref.source_id}`);
    for (const d of r.direction_ids ?? []) if (!directionIds.has(d)) errors.push(`${r.id}: unknown direction ${d}`);
  }
  const summary = JSON.parse(readFileSync(join(root, "data/catalog-summary.json"), "utf8"));
  const hashes = { catalog_hash: fingerprint(catalog.manifest, catalog.records), ...catalogHashes(catalog.records) };
  const recipes = catalog.records.filter(r => r.id.startsWith("recipe.")).length;
  const match =
    summary.catalog_hash === hashes.catalog_hash &&
    summary.content_catalog_hash === hashes.content_catalog_hash &&
    summary.layout_hash === hashes.layout_hash;
  if (!match) errors.push("data/catalog-summary.json hashes do not match the records");
  if (summary.recipes !== recipes || summary.knowledge !== catalog.records.length - recipes)
    errors.push("data/catalog-summary.json counts do not match the records");
  return {
    ok: errors.length === 0,
    counts: {
      recipes,
      knowledge: catalog.records.length - recipes,
      blueprints: byKind.blueprint ?? 0,
      sources: catalog.sources.length,
      directions: directions.length,
    },
    knowledge_by_kind: Object.fromEntries(Object.entries(byKind).sort()),
    hashes: { ...hashes, match_summary: match },
    errors,
  };
}

export const VALIDATE_HELP = `usage: validate.js [--skill DIR]
Validate the manifest, the record layout and every record, source and direction against schemas/ (JSON Schema
2020-12), plus relationships, source references and the catalog-summary hashes. Exit 1 when anything fails.`;

export function validateCommand(argv: string[]): { code: number; report: ValidationReport | string } {
  const { values } = parse(argv, { skill: { type: "string" } });
  if (values.help) return { code: 0, report: VALIDATE_HELP };
  const report = validateDataset((values.skill as string | undefined) ?? skillRoot());
  return { code: report.ok ? 0 : 1, report };
}
