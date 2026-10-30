/** Import the multilingual game-text indexes into PostgreSQL. */
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { createInagleSql, type Insertable } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import { webAppPath } from "../src/core/roots.ts";

const roots = [process.env.GAME_TEXT_DATA_DIR, webAppPath("data")].filter((v): v is string => Boolean(v));
const files = roots
  .flatMap(root => ["game-text-names.ndjson.gz", "game-text-dialogue.ndjson.gz"].map(name => `${root}/${name}`))
  .filter(existsSync);
if (files.length === 0) throw new Error("Index game-text introuvable: fournissez GAME_TEXT_DATA_DIR.");

const rowsByKey = new Map<string, Insertable<Database["inagle_game_text"]>>();
for (const file of files)
  for (const line of gunzipSync(readFileSync(file)).toString("utf8").split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as unknown;
      if (!Array.isArray(entry) || entry.length !== 4 || entry.some(v => typeof v !== "string")) continue;
      const [hash_id, locale, category, value] = entry as [string, string, string, string];
      rowsByKey.set(`${hash_id}\0${locale}`, {
        hash_id,
        locale,
        category,
        value,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Ignore malformed extraction lines.
    }
  }

const rows = [...rowsByKey.values()];
const db = createInagleSql<Database>();
await db.transaction().execute(async tx => {
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000);
    await tx
      .insertInto("inagle_game_text")
      .values(batch)
      .onConflict(oc =>
        oc.columns(["hash_id", "locale"]).doUpdateSet(eb => ({
          category: eb.ref("excluded.category"),
          value: eb.ref("excluded.value"),
          updated_at: eb.ref("excluded.updated_at"),
        })),
      )
      .execute();
  }
});
console.log(`Imported ${rows.length} game-text rows into PostgreSQL.`);
await db.destroy();
