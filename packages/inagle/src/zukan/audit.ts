/**
 * Zukan audit engine — canonical, shared module.
 *
 * Logique d'audit partagée entre `scripts/inagle/pipeline/audit-zukan-matches.ts`
 * (lit le pg local) et `audit-zukan-mirror.ts` (lit le mirror SQLite). Les deux
 * scripts calculaient les MÊMES critères de mismatch (nom / poste / élément /
 * genre / ère / corrélation de stats) sur des lignes DB identiques.
 *
 * DIVERGENCE VOLONTAIRE PRÉSERVÉE : les normaliseurs d'audit (POS_MAP/ELEM_MAP/
 * zukanGameToSeries ci-dessous) NE SONT PAS ceux du matcher. L'audit ajoute les
 * alias `Defenseur`/`Neant`/`Foret`, omet les caractères JA et `Coach`/`Aucun`,
 * et son `zukanGameToSeries` n'a PAS la branche `Orion`. C'est l'état exact des
 * deux scripts d'audit avant refactor — on le garde tel quel pour 0 régression.
 * Ne PAS remplacer par les normaliseurs de `matcher.ts`.
 *
 * Pas de dépendance lourde (ni navigateur, ni cheerio, ni pg/sqlite) : module pur.
 * Importable en leaf `@aphrody/inagle/zukan/audit`. NON ré-exporté par le
 * barrel.
 */

/** Entrée zukan minimale pour l'audit. */
export interface AuditZukanEntry {
  name: string;
  nickname?: string;
  zukanHash?: string;
  position?: string;
  element?: string;
  stats?: Record<string, number>;
  game?: string;
  gender?: string;
}

/** Ligne DB minimale pour l'audit. */
export interface AuditDbRow {
  id: string;
  name_en: string;
  name_fr?: string;
  name_ja?: string;
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

// ============================================================================
// Normalization — VARIANTE AUDIT (différente du matcher, cf. en-tête)
// ============================================================================

export const AUDIT_POS_MAP: Record<string, string> = {
  FW: "FW",
  MF: "MF",
  DF: "DF",
  GK: "GK",
  Attaquant: "FW",
  Milieu: "MF",
  Défenseur: "DF",
  Defenseur: "DF",
  Gardien: "GK",
};

export const AUDIT_ELEM_MAP: Record<string, string> = {
  Fire: "Fire",
  Wind: "Wind",
  Forest: "Forest",
  Mountain: "Mountain",
  Void: "Void",
  Feu: "Fire",
  Vent: "Wind",
  Forêt: "Forest",
  Foret: "Forest",
  Montagne: "Mountain",
  Néant: "Void",
  Neant: "Void",
};

export function auditNormPos(p: string | undefined): string | null {
  if (!p) return null;
  return AUDIT_POS_MAP[p] || p || null;
}

export function auditNormElem(e: string | undefined): string | null {
  if (!e) return null;
  return AUDIT_ELEM_MAP[e] || e || null;
}

export const AUDIT_ERAS: Record<string, string> = {
  "Inazuma Eleven": "OG",
  "Inazuma Eleven 2": "OG",
  "Inazuma Eleven 3": "OG",
  "Inazuma Eleven GO": "GO",
  "Chrono Stone": "GO",
  Galaxy: "GO",
  Ares: "Modern",
  Orion: "Modern",
  "Victory Road": "Modern",
};

/** zukanGameToSeries variante audit — NB: pas de branche `Orion` (verbatim). */
export function auditZukanGameToSeries(game?: string): string | null {
  if (!game) return null;
  if (game === "Inazuma Eleven: Victory Road") return "Victory Road";
  if (game === "Inazuma Eleven Ares") return "Ares";
  if (game.startsWith("Inazuma Eleven GO Galaxy")) return "Galaxy";
  if (game.startsWith("Inazuma Eleven GO Chrono Stones") || game.startsWith("Inazuma Eleven GO2"))
    return "Chrono Stone";
  if (game.startsWith("Inazuma Eleven GO")) return "Inazuma Eleven GO";
  if (game.startsWith("Inazuma Eleven 3")) return "Inazuma Eleven 3";
  if (game.startsWith("Inazuma Eleven 2")) return "Inazuma Eleven 2";
  if (game === "Inazuma Eleven") return "Inazuma Eleven";
  return null;
}

export function auditSpearmanCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  function ranks(arr: number[]): number[] {
    const sorted = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const r = Array.from<number>({ length: n });
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n - 1 && sorted[j + 1].v === sorted[j].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k].i] = avgRank;
      i = j + 1;
    }
    return r;
  }
  const ra = ranks(a);
  const rb = ranks(b);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = ra[i] - rb[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

// ============================================================================
// Mismatch detection — critères partagés
// ============================================================================

export type AuditMismatchType = "STALE_HASH" | "NAME_MISMATCH" | "GENDER_MISMATCH" | "ATTR_MISMATCH";

/** Résultat d'audit pour une ligne DB. */
export interface AuditMismatch {
  type: AuditMismatchType;
  db: AuditDbRow;
  /** Entrée zukan résolue par hash (undefined si STALE). */
  z?: AuditZukanEntry;
  reasons: string[];
  statCorrelation?: number;
}

/**
 * Évalue une ligne DB contre les entrées zukan indexées par hash.
 * Retourne un `AuditMismatch` si au moins un critère échoue, sinon `null`.
 *
 * Réplique EXACTE des critères des deux scripts d'audit :
 *  - nameMatch (exact EN/FR, first-word, includes, MixiMax base) ;
 *  - posMismatch / elemMismatch (elem ignoré pour MixiMax) ;
 *  - genderMismatch ;
 *  - eraMismatch (ignoré pour Héros Ares) ;
 *  - corrélation de stats < 0.3 → raison "STATS".
 */
export function evaluateRow(db: AuditDbRow, zukanByHash: Map<string, AuditZukanEntry[]>): AuditMismatch | null {
  const zukanEntries = db.zukan_hash ? zukanByHash.get(db.zukan_hash) : undefined;
  if (!zukanEntries || zukanEntries.length === 0) {
    return {
      type: "STALE_HASH",
      db,
      reasons: ["STALE: hash not in current zukan data"],
    };
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

  const posMismatch = z.position && db.position && auditNormPos(z.position) !== auditNormPos(db.position);
  const elemMismatch = !isMixiMax && z.element && db.element && auditNormElem(z.element) !== auditNormElem(db.element);
  const zGender = z.gender === "Male" ? "M" : z.gender === "Female" ? "F" : null;
  const genderMismatch = zGender && db.gender && zGender !== db.gender;

  const isAresHero = db.rarity_label === "Héros" && db.series === "Ares";
  const zSeries = auditZukanGameToSeries(z.game);
  const dbEra = db.series ? AUDIT_ERAS[db.series] : null;
  const zEra = zSeries ? AUDIT_ERAS[zSeries] : null;
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
    if (zTotal > 0 && dTotal > 0) statCorrelation = auditSpearmanCorrelation(zArr, dArr);
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

  if (reasons.length === 0) return null;

  const type: AuditMismatchType = reasons.some(r => r.startsWith("NAME"))
    ? "NAME_MISMATCH"
    : reasons.some(r => r.startsWith("GENDER"))
      ? "GENDER_MISMATCH"
      : "ATTR_MISMATCH";

  return { type, db, z, reasons, statCorrelation };
}

/** Index les entrées zukan par hash (toutes les entrées d'un même hash). */
export function indexZukanByHash(entries: AuditZukanEntry[]): Map<string, AuditZukanEntry[]> {
  const map = new Map<string, AuditZukanEntry[]>();
  for (const z of entries) {
    if (z.zukanHash) {
      if (!map.has(z.zukanHash)) map.set(z.zukanHash, []);
      map.get(z.zukanHash)!.push(z);
    }
  }
  return map;
}

/** Index la première entrée JA par hash (pour `zukanNameJa`). */
export function indexZukanJaByHash(entries: AuditZukanEntry[]): Map<string, AuditZukanEntry> {
  const map = new Map<string, AuditZukanEntry>();
  for (const z of entries) {
    if (z.zukanHash && !map.has(z.zukanHash)) map.set(z.zukanHash, z);
  }
  return map;
}

/** Détecte les hashes partagés entre plusieurs noms distincts (duplicate_hash). */
export function detectDuplicateHashes(rows: AuditDbRow[]): Map<string, Set<string>> {
  const hashToNames = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.zukan_hash) continue;
    if (!hashToNames.has(r.zukan_hash)) hashToNames.set(r.zukan_hash, new Set());
    hashToNames.get(r.zukan_hash)!.add(r.name_en || r.name_ja || "");
  }
  return hashToNames;
}
