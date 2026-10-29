/** Import the decoded CPK path index into PostgreSQL. */
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { createInagleSql, type Insertable } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import { webAppPath } from "../src/core/roots.ts";

const sourceCandidates = [process.env.CPK_INDEX_PATH, webAppPath("data", "cpk-index.ndjson.gz")].filter(
  (v): v is string => Boolean(v),
);
const source = sourceCandidates.find(v => existsSync(v));
if (!source) throw new Error("Index CPK introuvable: fournissez CPK_INDEX_PATH.");

const rowsByPath = new Map<string, Insertable<Database["inagle_cpk_index"]>>();
for (const line of gunzipSync(readFileSync(source)).toString("utf8").split("\n")) {
  if (!line) continue;
  try {
    const entry = JSON.parse(line) as unknown;
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string")
      continue;
    const [path, cpk] = entry;
    const segments = path.split("/");
    const name = segments.at(-1) ?? path;
    const dir = segments.slice(0, -1).join("/");
    const dot = name.lastIndexOf(".");
    rowsByPath.set(path, {
      path,
      top: segments[0] === "data" ? (segments[1] ?? "") : (segments[0] ?? ""),
      sub: segments[0] === "data" ? (segments[2] ?? "") : (segments[1] ?? ""),
      dir,
      name,
      ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
      cpk,
      depth: segments.length,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Ignore malformed extraction lines.
  }
}

const rows = [...rowsByPath.values()];
const db = createInagleSql<Database>();
await db.transaction().execute(async tx => {
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000);
    await tx
      .insertInto("inagle_cpk_index")
      .values(batch)
      .onConflict(oc =>
        oc.column("path").doUpdateSet(eb => ({
          top: eb.ref("excluded.top"),
          sub: eb.ref("excluded.sub"),
          dir: eb.ref("excluded.dir"),
          name: eb.ref("excluded.name"),
          ext: eb.ref("excluded.ext"),
          cpk: eb.ref("excluded.cpk"),
          depth: eb.ref("excluded.depth"),
          updated_at: eb.ref("excluded.updated_at"),
        })),
      )
      .execute();
  }
});
console.log(`Imported ${rows.length} CPK entries into PostgreSQL.`);
await db.destroy();
