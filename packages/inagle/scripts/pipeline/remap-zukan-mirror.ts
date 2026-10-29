/**
 * Re-match every inagle_characters row to the correct zukan entry by ATTRIBUTES
 * (position + element + stats + era + description), not name alone, and write the
 * corrected zukan_hash + zukan_order into the SQLite mirror + emit a Supabase SQL file.
 *
 * This is a faithful port of scripts/inagle/pipeline/map-zukan-images.ts matching
 * logic, adapted to read/write the active SQLite mirror instead of the (drifted /
 * auth-broken) local Postgres database. Only zukan_hash and zukan_order are touched.
 *
 * Sources of truth:
 *   - DATA_PATH/zukan/param_en.json  (5407 EN zukan entries)
 *   - DATA_PATH/zukan/param_ja.json  (5407 JA zukan entries, merged by hash)
 *   - /tmp/zukan_official_order.json         (order_map: zukanHash -> index)
 *
 * Run:
 *   bun packages/inagle/scripts/pipeline/remap-zukan-mirror.ts --dry
 *   bun packages/inagle/scripts/pipeline/remap-zukan-mirror.ts        # apply
 */

import { Database } from "bun:sqlite";
import { createRequire } from "node:module";
import {
  assignBest,
  createMatchContext,
  descriptionSimilarity,
  ERAS,
  matchGroupsStrict,
  matchScore,
  normElem,
  normPos,
  zukanGameToSeries,
} from "../../src/zukan/matcher.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { iecodeDataRoot, iecodePath, webAppPath } from "../../src/core/roots.ts";

const requireNiers = createRequire(import.meta.url);
let Kuroshiro: any = null;
let KuromojiAnalyzer: any = null;
try {
  Kuroshiro = requireNiers("kuroshiro").default;
  KuromojiAnalyzer = requireNiers("kuroshiro-analyzer-kuromoji").default;
} catch {
  // Le remap strict EN/FR/JA, les héritages et les overrides restent exécutables dans
  // un checkout minimal. Seule la passe optionnelle de translittération sera sautée.
}

const DRY = process.argv.includes("--dry") || !process.argv.includes("--apply");
const ONLY_SHAWN = process.argv.includes("--only-shawn");
const MIRROR_ARG = process.argv.find(arg => arg.startsWith("--mirror="))?.slice("--mirror=".length);

const DATA_DIR = iecodeDataRoot();
const PARAM_EN = process.env.ZUKAN_PARAM_EN || join(DATA_DIR, "zukan/param_en.json");
const PARAM_JA = process.env.ZUKAN_PARAM_JA || join(DATA_DIR, "zukan/param_ja.json");
const TMP_ORDER = join(tmpdir(), "zukan_official_order.json");
const ORDER_PATH = existsSync(TMP_ORDER) ? TMP_ORDER : join(DATA_DIR, "zukan/zukan_order_en.json");
const SUPABASE_SQL_OUT = join(tmpdir(), "zukan_remap_supabase.sql");
const AUDIT_OUT = process.env.AUDIT_OUT || join(DATA_DIR, "zukan-audit-mirror.json");

function mirrorPath(): string {
  if (MIRROR_ARG) return MIRROR_ARG;
  const fs = require("node:fs");
  const candidates = [
    [webAppPath("data", "backups"), /^supabase-.*\.sqlite$/],
    [iecodePath("var", "miroir"), /^inagle-.*\.sqlite$/],
    [iecodePath("var"), /^mirror\.sqlite$/],
  ] as const;
  for (const [dir, pattern] of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f: string) => pattern.test(f))
      .sort();
    if (files.length > 0) return `${dir}/${files[files.length - 1]}`;
  }
  throw new Error("aucun miroir SQLite Azalée/Inagle trouvé");
}

// ============================================================================
// Types
// ============================================================================

interface ZukanEntry {
  name: string;
  nickname?: string;
  zukanHash?: string;
  position?: string;
  element?: string;
  stats?: {
    kick: number;
    control: number;
    technique: number;
    pressure: number;
    physical: number;
    agility: number;
    intelligence: number;
  };
  game?: string;
  gender?: string;
  description?: string;
}

interface DbChar {
  id: string;
  name_ja: string;
  name_en: string;
  name_fr: string;
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
  description_en: string | null;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const MIRROR = mirrorPath();
  console.log(`Mode: ${DRY ? "DRY-RUN" : "APPLY"}`);
  console.log(`Mirror: ${MIRROR}`);

  // ── Load zukan EN + JA (merge by hash so JA names available where needed) ──
  const enEntries: ZukanEntry[] = JSON.parse(await Bun.file(PARAM_EN).text());
  const jaEntries: ZukanEntry[] = JSON.parse(await Bun.file(PARAM_JA).text());
  const orderRaw: { order_map: Record<string, number> } | Array<{ zukanHash: string | null; order: number }> =
    JSON.parse(await Bun.file(ORDER_PATH).text());
  const orderMap = Array.isArray(orderRaw)
    ? Object.fromEntries(orderRaw.filter(row => row.zukanHash).map(row => [row.zukanHash!, row.order]))
    : orderRaw.order_map;

  const withHash = enEntries.filter(e => e.zukanHash).length;
  const jaWithHash = jaEntries.filter(e => e.zukanHash).length;
  console.log(`EN entries with hash: ${withHash}/${enEntries.length}`);
  console.log(`JA entries with hash: ${jaWithHash}/${jaEntries.length}`);

  // ── Read DB chars from the mirror ──
  const ro = new Database(MIRROR, { readonly: true });
  const dbChars = ro
    .query<DbChar, []>(
      `SELECT id, name_ja, name_en, name_fr, position, element, gender, rarity_label, series, zukan_hash,
              stat_frappe, stat_controle, stat_technique, stat_pression,
              stat_physique, stat_agilite, stat_intelligence,
              description_en
       FROM inagle_characters`,
    )
    .all();
  console.log(`DB has ${dbChars.length} characters.`);

  const currentHashById = new Map<string, string | null>();
  for (const c of dbChars) currentHashById.set(c.id, c.zukan_hash);

  const assigned = new Map<string, string>(); // id -> hash
  // Contexte de matching (set usedHashes propre à ce run) — enforce le 1:1 hash↔perso.
  const ctx = createMatchContext();
  const usedHashes = ctx.usedHashes;

  // ── Index zukan by hash (used in C/D/validation for description checks) ──
  const zukanByHash = new Map<string, ZukanEntry>();
  for (const e of [...jaEntries, ...enEntries]) {
    if (e.zukanHash) zukanByHash.set(e.zukanHash, e);
  }
  const dbById = new Map(dbChars.map(c => [c.id, c]));

  // ── Index zukan EN by name ──
  const enByName = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const key = e.name.trim().toLowerCase();
    if (!enByName.has(key)) enByName.set(key, []);
    enByName.get(key)!.push(e);
  }

  // ── Index zukan JA by name ──
  const jaByName = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash)) {
    const key = e.name.trim();
    if (!jaByName.has(key)) jaByName.set(key, []);
    jaByName.get(key)!.push(e);
  }

  // ── Index DB by name (EN + FR + JA) ──
  const dbByNameEn = new Map<string, DbChar[]>();
  const dbByNameFr = new Map<string, DbChar[]>();
  const dbByNameJa = new Map<string, DbChar[]>();

  for (const c of dbChars) {
    if (c.name_en) {
      const k = c.name_en.trim().toLowerCase();
      if (!dbByNameEn.has(k)) dbByNameEn.set(k, []);
      dbByNameEn.get(k)!.push(c);
    }
    if (c.name_fr) {
      const k = c.name_fr.trim().toLowerCase();
      if (!dbByNameFr.has(k)) dbByNameFr.set(k, []);
      dbByNameFr.get(k)!.push(c);
    }
    if (c.name_ja) {
      const k = c.name_ja.trim();
      if (!dbByNameJa.has(k)) dbByNameJa.set(k, []);
      dbByNameJa.get(k)!.push(c);
    }
  }

  // ═══ Phase A: Exact EN name match (strict pos+elem+stats) ═══
  for (const [name, zukanGroup] of enByName) {
    const dbGroup = dbByNameEn.get(name);
    if (dbGroup) matchGroupsStrict(ctx, zukanGroup, dbGroup, assigned);
  }
  console.log(`Phase A: ${assigned.size} matched`);

  // Phase A2 DISABLED (1:1 hash policy) — see original.

  // ═══ Phase B: EN zukan name -> DB FR name ═══
  const beforeB = assigned.size;
  for (const [name, zukanGroup] of enByName) {
    const dbGroup = dbByNameFr.get(name);
    if (!dbGroup) continue;
    const unassigned = dbGroup.filter(c => !assigned.has(c.id));
    if (unassigned.length > 0) matchGroupsStrict(ctx, zukanGroup, unassigned, assigned);
  }
  console.log(`Phase B: +${assigned.size - beforeB} (total: ${assigned.size})`);

  // ═══ Phase B1.5: Nickname match ═══
  const beforeB15 = assigned.size;
  const enByNickname = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash && e.nickname)) {
    const nick = e.nickname!.trim().toLowerCase();
    const firstWord = e.name
      .trim()
      .toLowerCase()
      .split(/[\s-]+/)[0];
    if (nick.length >= 2 && firstWord === nick) {
      if (!enByNickname.has(nick)) enByNickname.set(nick, []);
      enByNickname.get(nick)!.push(e);
    }
  }
  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const dbName = c.name_en.trim().toLowerCase();
    if (dbName.includes(" ")) continue;
    const zukanGroup = enByNickname.get(dbName);
    if (zukanGroup && zukanGroup.length > 0) assignBest(ctx, c, zukanGroup, assigned);
  }
  console.log(`Phase B1.5: +${assigned.size - beforeB15} (total: ${assigned.size})`);

  // ═══ Phase B2: First-word EN match ═══
  const beforeB2 = assigned.size;
  const enByFirstWord = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const first = e.name.trim().split(/\s+/)[0].toLowerCase();
    if (first.length >= 3) {
      if (!enByFirstWord.has(first)) enByFirstWord.set(first, []);
      enByFirstWord.get(first)!.push(e);
    }
  }
  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const dbName = c.name_en.trim().toLowerCase();
    if (dbName.includes(" ")) continue;
    const zukanGroup = enByFirstWord.get(dbName);
    if (zukanGroup && zukanGroup.length > 0) assignBest(ctx, c, zukanGroup, assigned);
  }
  console.log(`Phase B2: +${assigned.size - beforeB2} (total: ${assigned.size})`);

  // ═══ Phase B3: Surname match ═══
  const beforeB3 = assigned.size;
  const enByLastWord = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const words = e.name.trim().split(/\s+/);
    if (words.length >= 2) {
      const last = words[words.length - 1].toLowerCase();
      if (last.length >= 3) {
        if (!enByLastWord.has(last)) enByLastWord.set(last, []);
        enByLastWord.get(last)!.push(e);
      }
    }
  }
  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const words = c.name_en.trim().split(/\s+/);
    if (words.length < 2) continue;
    const dbLast = words[words.length - 1].toLowerCase();
    const zukanGroup = enByLastWord.get(dbLast);
    if (!zukanGroup) continue;
    const dbFirst = words[0].toLowerCase();
    const filtered = zukanGroup.filter(z => z.name.toLowerCase().includes(dbFirst));
    if (filtered.length > 0) assignBest(ctx, c, filtered, assigned);
  }
  console.log(`Phase B3: +${assigned.size - beforeB3} (total: ${assigned.size})`);

  // ═══ Phase B4: MixiMax skipped ═══
  const mixiMaxCount = dbChars.filter(c => c.name_en && (c.name_en.includes("×") || c.name_en.includes("+"))).length;
  console.log(`Phase B4: ${mixiMaxCount} MixiMax characters excluded from zukan matching`);

  // ═══ Phase JA-A: Exact JA name match ═══
  const beforeJA = assigned.size;
  for (const [name, zukanGroup] of jaByName) {
    const dbGroup = dbByNameJa.get(name);
    if (dbGroup) {
      const unassigned = dbGroup.filter(c => !assigned.has(c.id));
      if (unassigned.length > 0) matchGroupsStrict(ctx, zukanGroup, unassigned, assigned);
    }
  }
  console.log(`Phase JA-A: +${assigned.size - beforeJA} (total: ${assigned.size})`);

  // ═══ Phase JA-B: JA nickname match ═══
  const beforeJAB = assigned.size;
  const jaByNickname = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash && e.nickname)) {
    const nick = e.nickname!.trim();
    const fullName = e.name.trim();
    if (nick.length >= 1 && fullName.startsWith(nick)) {
      if (!jaByNickname.has(nick)) jaByNickname.set(nick, []);
      jaByNickname.get(nick)!.push(e);
    }
  }
  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_ja) continue;
    const dbName = c.name_ja.trim();
    if (dbName.includes("・") || dbName.length > 8) continue;
    const zukanGroup = jaByNickname.get(dbName);
    if (!zukanGroup || zukanGroup.length === 0) continue;
    assignBest(ctx, c, zukanGroup, assigned);
  }
  console.log(`Phase JA-B: +${assigned.size - beforeJAB} (total: ${assigned.size})`);

  // ═══ Phase JA-C: JA first-part match ═══
  const beforeJAC = assigned.size;
  const jaByFirstPart = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash)) {
    const parts = e.name.trim().split(/[\s・]+/);
    if (parts[0] && parts[0].length >= 2) {
      if (!jaByFirstPart.has(parts[0])) jaByFirstPart.set(parts[0], []);
      jaByFirstPart.get(parts[0])!.push(e);
    }
  }
  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_ja) continue;
    const parts = c.name_ja.trim().split(/[\s・]+/);
    if (parts.length < 2 || !parts[0] || parts[0].length < 2) continue;
    const zukanGroup = jaByFirstPart.get(parts[0]);
    if (!zukanGroup) continue;
    const dbSecond = parts[1];
    const filtered = zukanGroup.filter(z => {
      if (!z.zukanHash) return false;
      const zParts = z.name.trim().split(/[\s・]+/);
      return zParts.some(p => p === dbSecond);
    });
    if (filtered.length > 0) assignBest(ctx, c, filtered, assigned);
  }
  console.log(`Phase JA-C: +${assigned.size - beforeJAC} (total: ${assigned.size})`);

  // ═══ Phase JA-R: Romaji transliteration match ═══
  const beforeJAR = assigned.size;
  if (!Kuroshiro || !KuromojiAnalyzer) {
    console.log("Phase JA-R: skipped (kuroshiro non installé)");
  } else {
    console.log("  Initializing Kuroshiro...");
    const kuroshiro = new Kuroshiro();
    await kuroshiro.init(new KuromojiAnalyzer());

    function normalizeForMatch(s: string): string {
      return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const enNormIndex = new Map<string, ZukanEntry[]>();
    for (const e of enEntries.filter(e => e.zukanHash)) {
      const norm = normalizeForMatch(e.name);
      if (!enNormIndex.has(norm)) enNormIndex.set(norm, []);
      enNormIndex.get(norm)!.push(e);
      const first = norm.split(" ")[0];
      if (first.length >= 3) {
        const fKey = `_first:${first}`;
        if (!enNormIndex.has(fKey)) enNormIndex.set(fKey, []);
        enNormIndex.get(fKey)!.push(e);
      }
    }

    const unmatched = dbChars.filter(c => !assigned.has(c.id) && c.name_ja);
    console.log(`  Converting ${unmatched.length} JA names to romaji...`);

    for (const c of unmatched) {
      const romaji = (await kuroshiro.convert(c.name_ja, {
        to: "romaji",
        romajiSystem: "hepburn",
      })) as string;
      const normRomaji = normalizeForMatch(romaji);
      if (!normRomaji || normRomaji.length < 2) continue;

      let zukanGroup = enNormIndex.get(normRomaji);
      if (!zukanGroup) {
        const firstWord = normRomaji.split(" ")[0];
        if (firstWord.length >= 3) zukanGroup = enNormIndex.get(`_first:${firstWord}`);
      }
      if (!zukanGroup || zukanGroup.length === 0) continue;

      const candidates = zukanGroup
        .filter(z => z.zukanHash)
        .map(z => ({ z, score: matchScore(z, c) }))
        .filter(p => p.score >= 20)
        .sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        // NOTE: original does NOT add to usedHashes here — preserved verbatim.
        assigned.set(c.id, candidates[0].z.zukanHash!);
      }
    }
    console.log(`Phase JA-R: +${assigned.size - beforeJAR} (total: ${assigned.size})`);
  }

  // ═══ Phase C: Inherit from same-name siblings (strict) ═══
  const beforeC = assigned.size;
  for (const c of dbChars) {
    if (assigned.has(c.id)) continue;
    const siblings = dbByNameEn.get(c.name_en?.trim().toLowerCase() || "") || dbByNameJa.get(c.name_ja?.trim() || "");
    if (siblings) {
      const sameEraOrUnknown = (s: DbChar) => {
        if (!c.series || !s.series) return true;
        const cEra = ERAS[c.series];
        const sEra = ERAS[s.series];
        return !cEra || !sEra || cEra === sEra;
      };
      const descOk = (s: DbChar) => {
        const hash = assigned.get(s.id);
        if (!hash) return false;
        const z = zukanByHash.get(hash);
        if (!z?.description || !c.description_en) return true;
        return descriptionSimilarity(z.description, c.description_en) > 0;
      };
      const withHashSib =
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.series === c.series &&
            s.rarity_label === c.rarity_label &&
            descOk(s),
        ) ||
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.series === c.series &&
            descOk(s),
        ) ||
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.rarity_label === c.rarity_label &&
            sameEraOrUnknown(s) &&
            descOk(s),
        );
      if (withHashSib) {
        assigned.set(c.id, assigned.get(withHashSib.id)!);
      }
    }
  }
  console.log(`Phase C: +${assigned.size - beforeC} (total: ${assigned.size})`);

  // ═══ Phase D: Relaxed sibling inheritance (series + position) ═══
  const beforeD = assigned.size;
  for (const c of dbChars) {
    if (assigned.has(c.id)) continue;
    if (c.name_en && (c.name_en.includes("×") || c.name_en.includes("+"))) continue;
    const siblings = dbByNameEn.get(c.name_en?.trim().toLowerCase() || "") || dbByNameJa.get(c.name_ja?.trim() || "");
    if (siblings) {
      const withHashSib = siblings.find(
        s =>
          assigned.has(s.id) &&
          s.series &&
          c.series &&
          s.series === c.series &&
          s.position === c.position &&
          (() => {
            const hash = assigned.get(s.id);
            if (!hash) return false;
            const z = zukanByHash.get(hash);
            if (!z?.description || !c.description_en) return true;
            return descriptionSimilarity(z.description, c.description_en) > 0;
          })(),
      );
      if (withHashSib) {
        assigned.set(c.id, assigned.get(withHashSib.id)!);
      }
    }
  }
  console.log(`Phase D: +${assigned.size - beforeD} (total: ${assigned.size})`);

  // ═══ Phase E: Era correction ═══
  let eraSwaps = 0;
  const zukanByNamePosElem = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const pos = normPos(e.position);
    const elem = normElem(e.element);
    const key = `${e.name.trim().toLowerCase()}|${pos}|${elem}`;
    if (!zukanByNamePosElem.has(key)) zukanByNamePosElem.set(key, []);
    zukanByNamePosElem.get(key)!.push(e);
  }
  const zukanHashToEntry = new Map<string, ZukanEntry>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    zukanHashToEntry.set(e.zukanHash!, e);
  }
  const ERA_ORDER: Record<string, number> = { OG: 1, GO: 2, Modern: 3 };

  for (const c of dbChars) {
    if (!assigned.has(c.id) || !c.series) continue;
    const currentHash = assigned.get(c.id)!;
    const currentZukan = zukanHashToEntry.get(currentHash);
    if (!currentZukan) continue;

    const zSeries = zukanGameToSeries(currentZukan.game);
    const dbEra = ERAS[c.series];
    const zEra = zSeries ? ERAS[zSeries] : null;
    const isHero = c.rarity_label === "Héros";

    if (isHero) {
      const currentOrder = ERA_ORDER[zEra || ""] || 0;
      const key = `${(c.name_en || "").trim().toLowerCase()}|${c.position}|${c.element}`;
      const alternatives = zukanByNamePosElem.get(key);
      if (!alternatives) continue;
      let bestAlt: ZukanEntry | null = null;
      let bestOrder = currentOrder;
      for (const alt of alternatives) {
        if (alt.zukanHash === currentHash) continue;
        const altSeries = zukanGameToSeries(alt.game);
        const altEra = altSeries ? ERAS[altSeries] : null;
        const altOrder = ERA_ORDER[altEra || ""] || 0;
        if (altOrder < bestOrder) {
          bestOrder = altOrder;
          bestAlt = alt;
        }
      }
      if (bestAlt?.zukanHash) {
        assigned.set(c.id, bestAlt.zukanHash);
        eraSwaps++;
      }
    } else {
      if (!dbEra || !zEra || dbEra === zEra) continue;
      const key = `${(c.name_en || "").trim().toLowerCase()}|${c.position}|${c.element}`;
      const alternatives = zukanByNamePosElem.get(key);
      if (!alternatives) continue;
      let bestAlt: ZukanEntry | null = null;
      let bestScore = 0;
      for (const alt of alternatives) {
        if (alt.zukanHash === currentHash) continue;
        const altSeries = zukanGameToSeries(alt.game);
        const altEra = altSeries ? ERAS[altSeries] : null;
        let score = 0;
        if (altSeries === c.series) score = 100;
        else if (altEra === dbEra) score = 50;
        if (score > bestScore) {
          bestScore = score;
          bestAlt = alt;
        }
      }
      if (bestAlt?.zukanHash) {
        assigned.set(c.id, bestAlt.zukanHash);
        eraSwaps++;
      }
    }
  }
  console.log(`Phase E: ${eraSwaps} era corrections applied`);

  // ═══ Validation: remove assignments where position OR element mismatch ═══
  let removed = 0;
  for (const [id, hash] of assigned) {
    const db = dbById.get(id);
    const z = zukanByHash.get(hash);
    if (!db || !z) continue;
    const zPos = normPos(z.position);
    const zElem = normElem(z.element);
    const dPos = db.position ? normPos(db.position) : null;
    const dElem = db.element ? normElem(db.element) : null;
    if (zElem && dElem && zElem !== dElem) {
      assigned.delete(id);
      usedHashes.delete(hash);
      removed++;
      continue;
    }
    if (zPos && dPos && zPos !== dPos) {
      assigned.delete(id);
      usedHashes.delete(hash);
      removed++;
    }
  }
  console.log(`Validation pos/elem: removed ${removed} bad assignments (total: ${assigned.size})`);

  // ═══ Validation description — reject sim=0 ═══
  let descRejected = 0;
  for (const [id, hash] of assigned) {
    const db = dbById.get(id);
    const z = zukanByHash.get(hash);
    if (!db?.description_en || !z?.description) continue;
    const sim = descriptionSimilarity(z.description, db.description_en);
    if (sim === 0) {
      assigned.delete(id);
      usedHashes.delete(hash);
      descRejected++;
    }
  }
  console.log(`Validation description: rejected ${descRejected} (sim=0).`);

  // ═══ Manual overrides — ambiguïtés que les attributs seuls ne peuvent départager ═══
  // Shawn possède 7 cartes officielles pour 17 lignes IEVR. Plusieurs partagent nom,
  // poste, élément et statistiques : une politique 1:1 ou un héritage par frère écrase
  // alors IE2 DF/FW/Aiden/Bear Killer sur une seule image et confond adulte/Miximax.
  // Associations vérifiées sur la recherche officielle (IDs 1162, 1163, 1164, 1166,
  // 2813, 3955, 4538) et consignées dans outputs/hakuren-shawn/zukan-profiles/manifest.json.
  const MANUAL_OVERRIDES: Record<string, { hash: string; order?: number }> = {
    "0x3F14143F": { hash: "k/p/j/pjw-aty8hpc" },
    "0x24F07F94": { hash: "k/p/j/pjw-aty8hpc" },
    "0xB380F082": { hash: "k/p/j/pjw-aty8hpc" },
    "0xA2957757": { hash: "k/o/p/opancch54ie", order: 1116 },
    "0x8AB17EED": { hash: "k/o/p/opancch54ie", order: 1116 },
    "0x3DD430EE": { hash: "k/i/g/iggcoacccik", order: 1117 },
    "0xEBBD5BFF": { hash: "k/i/g/iggcoacccik", order: 1117 },
    "0x15F03954": { hash: "k/i/g/iggcoacccik", order: 1117 },
    "0x3CFE7E61": { hash: "k/i/3/i30spf7yhce", order: 1118 },
    "0xBA4C2C21": { hash: "k/w/k/wk5ezxf-7dm", order: 1119 },
    "0x0B8A439A": { hash: "k/w/k/wk5ezxf-7dm" },
    "0xA9C5C501": { hash: "k/w/k/wk5ezxf-7dm" },
    "0xA5AAAB6B": { hash: "k/w/k/wk5ezxf-7dm" },
    "0xE4A9DA7F": { hash: "k/w/k/wk5ezxf-7dm" },
    "0x04F417C5": { hash: "k/w/k/wk5ezxf-7dm" },
    "0x2D3CA337": { hash: "k/w/k/wk5ezxf-7dm" },
    "0x36D8C89C": { hash: "k/w/k/wk5ezxf-7dm" },
    "0x2DEC08C2": { hash: "k/n/p/npvivtwkt3m", order: 2696 },
    "0x04DB53B4": { hash: "k/m/c/mc0a0kigy_k", order: 3661 },
    "0x5E959869": { hash: "k/g/1/g1zm_1kbai8", order: 4187 },
  };
  const SHAWN_BIO: Record<string, { age: string; school: string | null }> = {
    "k/o/p/opancch54ie": { age: "Middle School", school: "Grade 8" },
    "k/i/g/iggcoacccik": { age: "Middle School", school: "Grade 8" },
    "k/i/3/i30spf7yhce": { age: "Middle School", school: "Grade 8" },
    "k/w/k/wk5ezxf-7dm": { age: "Middle School", school: "Grade 8" },
    "k/n/p/npvivtwkt3m": { age: "Adult", school: null },
    "k/m/c/mc0a0kigy_k": { age: "Middle School", school: "Grade 8" },
    "k/g/1/g1zm_1kbai8": { age: "Middle School", school: "Grade 9" },
  };
  const SHAWN_INTERNAL_CODES: Record<string, string> = {
    "0x2D3CA337": "c02023380",
    "0x36D8C89C": "c02023380",
  };
  for (const [id, { hash, order }] of Object.entries(MANUAL_OVERRIDES)) {
    if (dbById.has(id)) assigned.set(id, hash);
    if (order !== undefined) orderMap[hash] = order;
  }
  console.log(`Manual overrides: ${Object.keys(MANUAL_OVERRIDES).length} applied`);

  // ════════════════════════════════════════════════════════════════════════
  // Compute final hash + order per row, diff against current
  // ════════════════════════════════════════════════════════════════════════
  const finalHashById = new Map<string, string | null>();
  for (const c of dbChars) {
    finalHashById.set(c.id, assigned.get(c.id) ?? null);
  }

  let changedCount = 0;
  let toNull = 0;
  let fromNull = 0;
  let changes: { id: string; hash: string | null; order: number | null }[] = [];
  for (const c of dbChars) {
    const cur = currentHashById.get(c.id) ?? null;
    const next = finalHashById.get(c.id) ?? null;
    const nextOrder = next != null ? (orderMap[next] ?? null) : null;
    if (cur !== next) {
      changedCount++;
      if (next === null && cur !== null) toNull++;
      if (cur === null && next !== null) fromNull++;
      changes.push({ id: c.id, hash: next, order: nextOrder });
    } else {
      // hash unchanged but order may need correction (recompute against order_map)
      const curOrderRow = ro
        .query<{ zukan_order: number | null }, [string]>("SELECT zukan_order FROM inagle_characters WHERE id = ?")
        .get(c.id);
      const curOrder = curOrderRow?.zukan_order ?? null;
      if (curOrder !== nextOrder) {
        changes.push({ id: c.id, hash: next, order: nextOrder });
      }
    }
  }
  ro.close();
  if (ONLY_SHAWN) {
    const shawnIds = new Set(Object.keys(MANUAL_OVERRIDES).slice(3));
    changes = changes.filter(change => shawnIds.has(change.id));
  }

  console.log("\n════════ DIFF SUMMARY ════════");
  console.log(`Total rows: ${dbChars.length}`);
  console.log(`Assigned (got a hash): ${assigned.size}`);
  console.log(`Hash CHANGED vs current: ${changedCount}`);
  console.log(`  -> becoming NULL: ${toNull}`);
  console.log(`  -> from NULL to a hash: ${fromNull}`);
  console.log(`Rows to UPDATE${ONLY_SHAWN ? " (Shawn uniquement)" : ""} (hash and/or order delta): ${changes.length}`);

  // ── Top-15 by zukan_order (after remap) ──
  console.log("\n════════ TOP-15 by zukan_order (after remap) ════════");
  const ranked = dbChars
    .map(c => {
      const h = finalHashById.get(c.id) ?? null;
      const ord = h != null ? (orderMap[h] ?? null) : null;
      return { c, h, ord };
    })
    .filter(r => r.ord != null)
    .sort((a, b) => a.ord! - b.ord! || a.c.id.localeCompare(b.c.id))
    .slice(0, 15);
  for (const r of ranked) {
    console.log(
      `  #${String(r.ord).padStart(4)}  ${(r.c.name_en || "").padEnd(22)} ${(r.c.position || "").padEnd(10)} ${(r.c.element || "").padEnd(8)} ${r.c.rarity_label.padEnd(12)} ${r.c.series || ""} [${r.c.id}] ${r.h}`,
    );
  }

  // ── 5 verification cases ──
  console.log("\n════════ VERIFICATION CASES ════════");
  const verify = (label: string, predicate: (c: DbChar) => boolean) => {
    const matched = dbChars.filter(predicate);
    console.log(`\n[${label}] (${matched.length} rows)`);
    for (const c of matched) {
      const h = finalHashById.get(c.id) ?? null;
      const ord = h != null ? (orderMap[h] ?? null) : null;
      const cur = currentHashById.get(c.id) ?? null;
      console.log(
        `  ${c.id} ${(c.name_en || "").padEnd(20)} ${c.position}/${c.element} ${c.rarity_label}/${c.series}  cur=${cur}  ->  new=${h} (order=${ord})`,
      );
    }
  };
  verify("Alexander (フロイ, MF/Wind, Orion — should -> NULL, no zukan entry)", c => c.name_ja === "フロイ");
  verify("Alan Master (era)", c => c.name_en === "Alan Master");
  verify("Alexander Scrivener (keep k/x/b/xbs1kbllvxu, GK/Mountain/Ares)", c => c.name_en === "Alexander Scrivener");

  // ════════════════════════════════════════════════════════════════════════
  // Emit Supabase SQL + apply to mirror (only when not dry)
  // ════════════════════════════════════════════════════════════════════════
  if (changes.length > 0) {
    const sqlEsc = (s: string) => s.replace(/'/g, "''");
    const lines: string[] = [];
    lines.push("-- Remap zukan_hash + zukan_order on inagle_characters (Supabase).");
    lines.push(`-- Generated ${new Date().toISOString()} from mirror ${MIRROR}`);
    lines.push(`-- ${changes.length} rows. Only zukan_hash + zukan_order touched; sheet_data untouched.`);
    lines.push("BEGIN;");
    // Batch as individual UPDATEs grouped by (hash, order) to keep file compact-ish.
    // Group ids that share the same (hash, order) into one IN(...) update.
    const groups = new Map<string, { hash: string | null; order: number | null; ids: string[] }>();
    for (const ch of changes) {
      const key = `${ch.hash ?? "<NULL>"}|${ch.order ?? "<NULL>"}`;
      if (!groups.has(key)) groups.set(key, { hash: ch.hash, order: ch.order, ids: [] });
      groups.get(key)!.ids.push(ch.id);
    }
    for (const { hash, order, ids } of groups.values()) {
      const hashSql = hash === null ? "NULL" : `'${sqlEsc(hash)}'`;
      const orderSql = order === null ? "NULL" : String(order);
      const idList = ids.map(id => `'${sqlEsc(id)}'`).join(", ");
      lines.push(
        `UPDATE inagle_characters SET zukan_hash = ${hashSql}, zukan_order = ${orderSql} WHERE id IN (${idList});`,
      );
    }
    if (ONLY_SHAWN) {
      for (const [hash, bio] of Object.entries(SHAWN_BIO)) {
        const schoolSql = bio.school === null ? "NULL" : `'${sqlEsc(bio.school)}'`;
        lines.push(
          `UPDATE inagle_characters SET age_group = '${sqlEsc(bio.age)}', school_year = ${schoolSql} WHERE zukan_hash = '${sqlEsc(hash)}';`,
        );
      }
      for (const [id, internalCode] of Object.entries(SHAWN_INTERNAL_CODES)) {
        lines.push(
          `UPDATE inagle_characters SET internal_code = '${sqlEsc(internalCode)}' WHERE id = '${sqlEsc(id)}';`,
        );
      }
    }
    lines.push("COMMIT;");
    await Bun.write(SUPABASE_SQL_OUT, lines.join("\n") + "\n");
    const updateCount = lines.filter(l => l.startsWith("UPDATE")).length;
    console.log(
      `\nSupabase SQL written: ${SUPABASE_SQL_OUT} (${updateCount} UPDATE statements, ${changes.length} rows)`,
    );
  }

  if (!DRY) {
    const rw = new Database(MIRROR, { readwrite: true });
    const stmt = rw.query("UPDATE inagle_characters SET zukan_hash = ?, zukan_order = ? WHERE id = ?");
    const tx = rw.transaction((rows: typeof changes) => {
      for (const ch of rows) stmt.run(ch.hash, ch.order, ch.id);
      if (ONLY_SHAWN) {
        const bioStmt = rw.query("UPDATE inagle_characters SET age_group = ?, school_year = ? WHERE zukan_hash = ?");
        for (const [hash, bio] of Object.entries(SHAWN_BIO)) {
          bioStmt.run(bio.age, bio.school, hash);
        }
        const codeStmt = rw.query("UPDATE inagle_characters SET internal_code = ? WHERE id = ?");
        for (const [id, internalCode] of Object.entries(SHAWN_INTERNAL_CODES)) {
          codeStmt.run(internalCode, id);
        }
      }
    });
    tx(changes);
    rw.close();
    console.log(`\nAPPLIED ${changes.length} updates to mirror ${MIRROR}.`);
  } else {
    console.log("\nDRY-RUN: mirror NOT modified.");
  }

  // stash for audit
  (globalThis as Record<string, unknown>).__remap = {
    mirror: MIRROR,
    finalHashById,
    orderMap,
    dbChars,
    enEntries,
    jaEntries,
    auditOut: AUDIT_OUT,
  };
}

await main();
