/** Import the Cross Addressables catalogue into the durable PostgreSQL source. */
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { createInagleSql, type Insertable } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import { iecodePath, webAppPath } from "../src/core/roots.ts";

const sourceCandidates = [
  process.env.CROSS_CATALOG_PATH,
  webAppPath("data", "cross", "catalog-index.ndjson.gz"),
  iecodePath("packages", "inagle-cross", "data", "catalog-index.ndjson.gz"),
].filter((value): value is string => Boolean(value));
const source = sourceCandidates.find(value => existsSync(value));
if (!source) throw new Error("Catalogue Cross introuvable: fournissez CROSS_CATALOG_PATH.");

const rowsByGuid = new Map<string, Insertable<Database["inagle_cross_catalog"]>>();
for (const line of gunzipSync(readFileSync(source)).toString("utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry.kind !== "asset" || typeof entry.guid !== "string" || typeof entry.key !== "string") continue;
    rowsByGuid.set(entry.guid, {
      guid: entry.guid,
      key: entry.key,
      type: typeof entry.type === "string" ? entry.type : "Unknown",
      bundle: typeof entry.bundle === "string" ? entry.bundle : "",
      size: Number(entry.size ?? 0),
      n_deps: Number(entry.n_deps ?? 0),
      deps: JSON.stringify(Array.isArray(entry.deps) ? entry.deps : []),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Ignore malformed extraction lines and continue the import.
  }
}

const db = createInagleSql<Database>();
const rows = [...rowsByGuid.values()];
await db.transaction().execute(async tx => {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    await tx
      .insertInto("inagle_cross_catalog")
      .values(batch)
      .onConflict(oc =>
        oc.column("guid").doUpdateSet(eb => ({
          key: eb.ref("excluded.key"),
          type: eb.ref("excluded.type"),
          bundle: eb.ref("excluded.bundle"),
          size: eb.ref("excluded.size"),
          n_deps: eb.ref("excluded.n_deps"),
          deps: eb.ref("excluded.deps"),
          updated_at: eb.ref("excluded.updated_at"),
        })),
      )
      .execute();
  }
});
console.log(`Imported ${rows.length} Cross catalogue assets into PostgreSQL.`);
await db.destroy();
