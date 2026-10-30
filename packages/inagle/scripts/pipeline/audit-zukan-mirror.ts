/**
 * Audit zukan_hash assignments in the SQLite MIRROR (not local pg).
 * Faithful port of audit-zukan-matches.ts criteria, reading the active mirror.
 * Writes DATA_PATH/zukan-audit-mirror.json and prints AVANT/APRÈS summary.
 *
 * Run:
 *   bun scripts/inagle/pipeline/audit-zukan-mirror.ts
 */

import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  AUDIT_ERAS as ERAS,
  auditNormElem as normElem,
  auditNormPos as normPos,
  auditSpearmanCorrelation as spearmanCorrelation,
  auditZukanGameToSeries as zukanGameToSeries,
} from "../../src/zukan/audit.ts";
import { iecodeDataRoot, webAppPath } from "../../src/core/roots.ts";

const DATA_DIR = iecodeDataRoot();
const PARAM_EN = process.env.ZUKAN_PARAM_EN || join(DATA_DIR, "zukan/param_en.json");
const AUDIT_OUT = process.env.AUDIT_OUT || join(DATA_DIR, "zukan-audit-mirror.json");

function mirrorPath(): string {
  const fs = require("node:fs");
  const dir = process.env.MIRROR_DIR || webAppPath("data", "backups");
  if (!fs.existsSync(dir)) return "";
  const files = fs
    .readdirSync(dir)
    .filter((f: string) => /^supabase-.*\.sqlite$/.test(f))
    .sort();
  return files.length ? `${dir}/${files[files.length - 1]}` : "";
}

interface ZukanEntry {
  name: string;
  nickname?: string;
  zukanHash?: string;
  position?: string;
  element?: string;
  stats?: Record<string, number>;
  game?: string;
  gender?: string;
}

interface DbRow {
  id: string;
  name_en: string;
  name_fr: string;
  name_ja: string;
  position: string;
  element: string;
  gender: string | null;
  rarity_label: string;
  series: string | null;
  zukan_hash: string | null;
  stat_frappe: number | null;
  stat_controle: number | null;
  stat_technique: number | null;
  stat_pression: number | null;
  stat_physique: number | null;
  stat_agilite: number | null;
  stat_intelligence: number | null;
}

async function main() {
  const MIRROR = mirrorPath();
  const zukanData: ZukanEntry[] = JSON.parse(await Bun.file(PARAM_EN).text());

  const zukanByHash = new Map<string, ZukanEntry[]>();
  for (const z of zukanData) {
    if (z.zukanHash) {
      if (!zukanByHash.has(z.zukanHash)) zukanByHash.set(z.zukanHash, []);
      zukanByHash.get(z.zukanHash)!.push(z);
    }
  }
  console.log(`Mirror: ${MIRROR}`);
  console.log(`Zukan: ${zukanData.length} entries, ${zukanByHash.size} unique hashes`);

  const db = new Database(MIRROR, { readonly: true });
  const rows = db
    .query<DbRow, []>(
      `SELECT id, name_en, name_fr, name_ja, position, element, gender,
              rarity_label, series, zukan_hash,
              stat_frappe, stat_controle, stat_technique, stat_pression,
              stat_physique, stat_agilite, stat_intelligence
       FROM inagle_characters
       WHERE zukan_hash IS NOT NULL
       ORDER BY name_en, id`,
    )
    .all();
  db.close();
  console.log(`DB: ${rows.length} rows with zukan_hash\n`);

  interface Mismatch {
    type: string;
    dbId: string;
    dbName: string;
    dbPos: string;
    dbElem: string;
    dbSeries: string | null;
    dbRarity: string;
    dbGender: string | null;
    zukanName: string;
    zukanGame: string;
    hash: string;
    reasons: string[];
    statCorrelation?: number;
  }

  const mismatches: Mismatch[] = [];

  for (const db of rows) {
    const zukanEntries = zukanByHash.get(db.zukan_hash!);
    if (!zukanEntries || zukanEntries.length === 0) {
      mismatches.push({
        type: "STALE_HASH",
        dbId: db.id,
        dbName: db.name_en,
        dbPos: db.position,
        dbElem: db.element,
        dbSeries: db.series,
        dbRarity: db.rarity_label,
        dbGender: db.gender,
        zukanName: "?",
        zukanGame: "?",
        hash: db.zukan_hash!,
        reasons: ["STALE: hash not in current zukan data"],
      });
      continue;
    }

    const z = zukanEntries[0];
    const dbNameEn = (db.name_en || "").toLowerCase().trim();
    const zukanName = (z.name || "").toLowerCase().trim();
    const dbNameFr = (db.name_fr || "").toLowerCase().trim();
    const zukanFirst = zukanName.split(/\s+/)[0];
    const dbFirst = dbNameEn.split(/\s+/)[0];
    const dbFirstFr = dbNameFr.split(/\s+/)[0];
    const isMixiMax = dbNameEn.includes("×") || dbNameEn.includes("+");
    const dbBaseName = isMixiMax ? dbNameEn.split(/[×+]/)[0].trim().split(/\s+/)[0] : null;

    const nameMatch =
      zukanName === dbNameEn ||
      zukanName === dbNameFr ||
      zukanFirst === dbFirst ||
      zukanFirst === dbFirstFr ||
      (dbBaseName && zukanFirst === dbBaseName) ||
      zukanName.includes(dbFirst) ||
      dbNameEn.includes(zukanFirst);

    const posMismatch = z.position && db.position && normPos(z.position) !== normPos(db.position);
    const elemMismatch = !isMixiMax && z.element && db.element && normElem(z.element) !== normElem(db.element);
    const zGender = z.gender === "Male" ? "M" : z.gender === "Female" ? "F" : null;
    const genderMismatch = zGender && db.gender && zGender !== db.gender;

    const isAresHero = db.rarity_label === "Héros" && db.series === "Ares";
    const zSeries = zukanGameToSeries(z.game);
    const dbEra = db.series ? ERAS[db.series] : null;
    const zEra = zSeries ? ERAS[zSeries] : null;
    const eraMismatch = !isAresHero && dbEra && zEra && dbEra !== zEra;

    let statCorrelation: number | undefined;
    if (z.stats && db.stat_frappe != null) {
      const zArr = [
        z.stats.kick || 0,
        z.stats.control || 0,
        z.stats.technique || 0,
        z.stats.pressure || 0,
        z.stats.physical || 0,
        z.stats.agility || 0,
        z.stats.intelligence || 0,
      ];
      const dArr = [
        db.stat_frappe || 0,
        db.stat_controle || 0,
        db.stat_technique || 0,
        db.stat_pression || 0,
        db.stat_physique || 0,
        db.stat_agilite || 0,
        db.stat_intelligence || 0,
      ];
      const zTotal = zArr.reduce((a, b) => a + b, 0);
      const dTotal = dArr.reduce((a, b) => a + b, 0);
      if (zTotal > 0 && dTotal > 0) statCorrelation = spearmanCorrelation(zArr, dArr);
    }

    const reasons: string[] = [];
    if (!nameMatch) reasons.push(`NAME: zukan="${z.name}" ≠ db="${db.name_en}"`);
    if (posMismatch) reasons.push(`POS: zukan=${z.position} ≠ db=${db.position}`);
    if (elemMismatch) reasons.push(`ELEM: zukan=${z.element} ≠ db=${db.element}`);
    if (genderMismatch) reasons.push(`GENDER: zukan=${z.gender} ≠ db=${db.gender}`);
    if (eraMismatch) reasons.push(`ERA: zukan=${zSeries}(${zEra}) ≠ db=${db.series}(${dbEra})`);
    if (statCorrelation !== undefined && statCorrelation < 0.3) {
      reasons.push(`STATS: correlation=${statCorrelation.toFixed(2)} (very low)`);
    }

    if (reasons.length > 0) {
      mismatches.push({
        type: reasons.some(r => r.startsWith("NAME"))
          ? "NAME_MISMATCH"
          : reasons.some(r => r.startsWith("GENDER"))
            ? "GENDER_MISMATCH"
            : "ATTR_MISMATCH",
        dbId: db.id,
        dbName: db.name_en,
        dbPos: db.position,
        dbElem: db.element,
        dbSeries: db.series,
        dbRarity: db.rarity_label,
        dbGender: db.gender,
        zukanName: z.name,
        zukanGame: z.game || "?",
        hash: db.zukan_hash!,
        reasons,
        statCorrelation,
      });
    }
  }

  // Build JSON issues with same severity logic as the original audit
  interface AuditIssue {
    code: string;
    hash: string;
    dbNameEn: string;
    severity: "high" | "medium";
    category: string;
    problems: string[];
  }
  const jsonIssues: AuditIssue[] = [];
  for (const m of mismatches) {
    const isStatsInverted = m.statCorrelation !== undefined && m.statCorrelation < 0;
    const problems: string[] = [];
    if (isStatsInverted) problems.push(`Stats inversées (corr=${m.statCorrelation!.toFixed(2)})`);
    if (m.reasons.some(r => r.startsWith("ERA"))) problems.push(`Ère`);
    if (m.reasons.some(r => r.startsWith("NAME"))) problems.push(`Nom: DB="${m.dbName}" image="${m.zukanName}"`);
    if (m.reasons.some(r => r.startsWith("POS"))) problems.push(`Position`);
    if (m.reasons.some(r => r.startsWith("ELEM"))) problems.push(`Élément`);

    const category = isStatsInverted
      ? "stats_inverted"
      : m.reasons.some(r => r.startsWith("ERA"))
        ? "era_mismatch"
        : m.reasons.some(r => r.startsWith("NAME"))
          ? "name_mismatch"
          : "attribute_mismatch";
    const severity = isStatsInverted ? ("high" as const) : ("medium" as const);
    jsonIssues.push({
      code: m.dbId,
      hash: m.hash,
      dbNameEn: m.dbName,
      severity,
      category,
      problems,
    });
  }

  // Duplicate-hash detection (same hash on two DIFFERENT names)
  const hashToNames = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.zukan_hash) continue;
    if (!hashToNames.has(r.zukan_hash)) hashToNames.set(r.zukan_hash, new Set());
    hashToNames.get(r.zukan_hash)!.add(r.name_en || r.name_ja);
  }
  let dupHashGroups = 0;
  for (const [hash, names] of hashToNames) {
    if (names.size <= 1) continue;
    dupHashGroups++;
    jsonIssues.push({
      code: rows.find(r => r.zukan_hash === hash)?.id || "",
      hash,
      dbNameEn: [...names].join(" / "),
      severity: "medium",
      category: "duplicate_hash",
      problems: [`Hash partagé entre: ${[...names].join(", ")}`],
    });
  }

  const highCount = jsonIssues.filter(i => i.severity === "high").length;
  const mediumCount = jsonIssues.filter(i => i.severity === "medium").length;
  const byCat: Record<string, number> = {};
  for (const i of jsonIssues) byCat[i.category] = (byCat[i.category] || 0) + 1;

  const auditJson = {
    metadata: {
      date: new Date().toISOString(),
      mirror: MIRROR,
      totalAudited: rows.length,
      totalIssues: jsonIssues.length,
      bySeverity: { high: highCount, medium: mediumCount },
      byCategory: byCat,
    },
    issues: jsonIssues,
  };
  await Bun.write(AUDIT_OUT, JSON.stringify(auditJson, null, 2));

  console.log("═══════════════════════════════════════════════════");
  console.log("        ZUKAN MIRROR AUDIT (post-remap)");
  console.log("═══════════════════════════════════════════════════");
  console.log(`totalAudited: ${rows.length}`);
  console.log(`totalIssues:  ${jsonIssues.length}`);
  console.log(`  high:   ${highCount}`);
  console.log(`  medium: ${mediumCount}`);
  console.log(`byCategory:`, JSON.stringify(byCat));
  console.log(`duplicate-hash groups (2+ distinct names): ${dupHashGroups}`);
  console.log(`\nWritten: ${AUDIT_OUT}`);
}

await main();
