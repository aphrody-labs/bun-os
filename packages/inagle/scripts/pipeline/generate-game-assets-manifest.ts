/**
 * @file generate-game-assets-manifest.ts
 * @description Génère le manifeste de vérité `inagle_game_assets` {path, bucket, exists}.
 *
 * Table de vérité = un enregistrement par FICHIER RÉEL servi par le CDN. Le front
 * valide une URL en faisant un lookup exact sur `path` (exists=true garanti) AVANT
 * render → évite les 404 silencieux qui retombent sur `/ievr.webp`.
 *
 * Source de vérité (exists=true) : le listing réel du dump dx11 servi par le CDN
 * (`~/.local/share/Steam/iecode/inazuma/data/dx11/`, ~40 471 fichiers).
 *
 * La cross-référence (`packages/inagle/data/asset-cross-reference.json`, 17 353 assets
 * attendus par les données de jeu) sert UNIQUEMENT à mesurer la couverture (combien
 * d'assets attendus ont au moins un fichier réel correspondant) — log, non persisté :
 * ses `assetPath` désignent les packs G4TX d'origine, pas les noms PNG aplatis servis,
 * donc les marquer exists=false produirait de faux négatifs (le résolveur azalee remappe).
 *
 * Conventions de `path` : relatif à la racine CDN `/dx11/` (ce que le résolveur
 * azalee construit : `https://cdn.example.com/dx11/<path>`). Ex. `menu/icon_chr/face/c01000010_l_c01000010_1_l00.png`.
 *
 * Colonnes peuplées : path (PK), bucket (200_icon|220_img|icon_chr|210_minimap|movie),
 * kind (extension), size (octets), exists (true), buildid (Steam).
 *
 * Run : bun run scripts/inagle/pipeline/generate-game-assets-manifest.ts [--dry]
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { createPgClient, getInagleDatabaseURL } from "@rosegriffon/db/pg";
import { iecodeRoot } from "../../src/core/roots.ts";
import { homedir } from "node:os";

const REPO_ROOT = iecodeRoot();
const DUMP_ROOT =
  process.env.DUMP_ROOT || join(homedir(), ".local", "share", "Steam", "iecode", "inazuma", "data", "dx11");
const CROSS_REF_PATH = join(REPO_ROOT, "packages/inagle/data/asset-cross-reference.json");
const STEAM_BUILDID = 22792000; // appmanifest_2799860.acf (INAZUMA ELEVEN: Victory Road)
const DRY = process.argv.includes("--dry");

type ManifestRow = {
  path: string;
  bucket: string;
  kind: string | null;
  size: number | null;
  exists: boolean;
};

/** Premier segment de `menu/<bucket>/...` ou `movie` → bucket logique. */
function bucketOf(relPath: string): string {
  const parts = relPath.split("/");
  if (parts[0] === "menu" && parts[1]) {
    return parts[1]; // 200_icon | 220_img | 210_minimap | icon_chr
  }
  return parts[0]; // movie, etc.
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Code-feuille (basename sans extension/langue) d'un `assetPath` cross-ref.
 * Le dump aplatit la hiérarchie G4TX (`200_icon/10_icon_chr/face/…g4tx` →
 * `menu/icon_chr/face/<code>_…png`) de façon irrégulière : seul le code-feuille est
 * stable entre la cross-ref et le dump. On l'utilise pour mesurer la couverture
 * (l'asset attendu a-t-il au moins un fichier réel portant son code ?).
 */
function expectedLeafCode(assetPath: string): string | null {
  if (!assetPath) {
    return null;
  }
  const cleaned = assetPath.replace(/\/<LG>\//g, "/").replace(/\.[a-z0-9]+$/i, "");
  const leaf = cleaned.split("/").pop();
  return leaf || null;
}

async function main(): Promise<void> {
  console.log("== Génération manifeste inagle_game_assets ==");

  // 1) Walk du dump réel (exists = true).
  const files: string[] = [];
  await walk(DUMP_ROOT, files);
  console.log(`Dump : ${files.length} fichiers trouvés sous ${DUMP_ROOT}`);

  const rows = new Map<string, ManifestRow>();
  // Index des codes-feuilles présents : chaque basename du dump, et son préfixe
  // avant le 1er `_<code>_` dupliqué (les fichiers aplatis ont la forme
  // `<code>_l_<code>_…` ou `<code>_<code>`). Sert au matching cross-ref par code.
  const presentCodes = new Set<string>();
  for (const full of files) {
    const rel = relative(DUMP_ROOT, full).replace(/\\/g, "/");
    const st = await stat(full);
    rows.set(rel, {
      path: rel,
      bucket: bucketOf(rel),
      kind: extname(rel).slice(1).toLowerCase() || null,
      size: st.size,
      exists: true,
    });
    const base = (rel.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "");
    presentCodes.add(base);
    // Premier segment avant `_l_` ou `_<dup>` → code d'asset nu.
    const head = base.split("_l_")[0];
    presentCodes.add(head);
    const dup = base.match(/^(.+?)_\1(?:_|$)/);
    if (dup) {
      presentCodes.add(dup[1]);
    }
  }

  // 2) Cross-ref : mesure de couverture (log uniquement, non persisté).
  //    Un asset attendu est "couvert" si son code-feuille apparaît dans le dump.
  const crossRef = JSON.parse(await readFile(CROSS_REF_PATH, "utf8")) as {
    totalAssets: number;
    assets: Array<{ assetPath: string; bucket: string }>;
  };
  let expectedCovered = 0;
  let expectedTotal = 0;
  for (const a of crossRef.assets) {
    const code = expectedLeafCode(a.assetPath);
    if (!code) {
      continue;
    }
    expectedTotal += 1;
    if (presentCodes.has(code)) {
      expectedCovered += 1;
    }
  }

  const all = [...rows.values()];
  const pct = expectedTotal > 0 ? ((expectedCovered / expectedTotal) * 100).toFixed(1) : "n/a";
  console.log(`Manifeste : ${all.length} fichiers réels (tous exists=true)`);
  console.log(`Couverture cross-ref : ${expectedCovered}/${expectedTotal} assets attendus couverts (${pct}%)`);

  if (DRY) {
    console.log("--dry : aucune écriture DB. Échantillon :");
    console.log(all.slice(0, 5));
    return;
  }

  // 3) Upsert en masse.
  const client = createPgClient(getInagleDatabaseURL());
  await client.connect();

  const BATCH = 1000;
  let upserted = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((r, j) => {
      const b = j * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(r.path, r.bucket, r.kind, r.size, r.exists, STEAM_BUILDID);
    });
    await client.query(
      `INSERT INTO inagle_game_assets (path, bucket, kind, size, exists, buildid)
			 VALUES ${values.join(",")}
			 ON CONFLICT (path) DO UPDATE SET
			   bucket = EXCLUDED.bucket,
			   kind = EXCLUDED.kind,
			   size = EXCLUDED.size,
			   exists = EXCLUDED.exists,
			   buildid = EXCLUDED.buildid,
			   updated_at = now()`,
      params,
    );
    upserted += batch.length;
    if (i % (BATCH * 10) === 0) {
      console.log(`  upsert ${upserted}/${all.length}…`);
    }
  }

  const { rows: countRows } = await client.query(
    "SELECT count(*)::int AS n, count(*) FILTER (WHERE exists)::int AS present FROM inagle_game_assets",
  );
  console.log(`DB : ${countRows[0].n} lignes (présents=${countRows[0].present})`);
  await client.end();
  console.log("== Terminé ==");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
