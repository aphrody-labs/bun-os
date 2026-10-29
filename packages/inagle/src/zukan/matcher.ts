/**
 * Zukan matching engine — canonical, shared module.
 *
 * Logique de matching attribut-par-attribut (position + élément + stats + ère +
 * description) entre une entrée zukan (`ZukanMatchEntry`) et une ligne DB
 * (`ZukanMatchDbChar`). Extraite VERBATIM de
 * `scripts/inagle/pipeline/map-zukan-images.ts` — le matcher prouvé. Le port
 * `remap-zukan-mirror.ts` partageait déjà la même logique (diff vérifié :
 * identique au commentaire/formatage près). Les deux scripts délèguent désormais
 * ici au lieu de dupliquer.
 *
 * Comportement à préserver à l'identique :
 *  - gate poste/élément → -1 (incompatible) si les deux sont connus et diffèrent ;
 *  - blocage cross-ère dur (sauf Héros qui privilégient l'ère la plus ancienne) ;
 *  - mapping 1:1 hash↔perso via `usedHashes` (set GLOBAL partagé sur tout le run) ;
 *  - corrélation de Spearman sur les 7 stats, Jaccard sur les descriptions EN, genre.
 *
 * IMPORTANT : ce module ne tire AUCUNE dépendance lourde (pas de navigateur, pas de
 * cheerio, pas de pg). Il peut donc être importé en leaf
 * `@aphrody/inagle/zukan/matcher`. Il n'est PAS ré-exporté par le barrel
 * `zukan/index.ts` (réservé aux types/parser/library) par prudence, mais reste
 * sans danger pour le bundle Next.
 */

/** Entrée zukan minimale nécessaire au matching (sous-ensemble de ZukanCharacter). */
export interface ZukanMatchEntry {
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

/** Ligne DB minimale nécessaire au matching (champs `inagle_characters`). */
export interface ZukanMatchDbChar {
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
// Normalization — source de vérité partagée
// ============================================================================

/** Normalise une position vers le format EN canonique (DB peut avoir EN ou FR). */
export const POS_MAP: Record<string, string> = {
  FW: "FW",
  MF: "MF",
  DF: "DF",
  GK: "GK",
  Attaquant: "FW",
  Milieu: "MF",
  Défenseur: "DF",
  Gardien: "GK",
  Entraîneur: "Coach",
  Coach: "Coach",
};

/** Normalise un élément vers le format EN canonique (DB peut avoir EN/FR/JA). */
export const ELEM_MAP: Record<string, string> = {
  Fire: "Fire",
  Wind: "Wind",
  Forest: "Forest",
  Mountain: "Mountain",
  Void: "Void",
  Feu: "Fire",
  Vent: "Wind",
  Forêt: "Forest",
  Montagne: "Mountain",
  Néant: "Void",
  Foret: "Forest",
  Neant: "Void",
  Aucun: "Void",
  火: "Fire",
  風: "Wind",
  林: "Forest",
  山: "Mountain",
  無: "Void",
};

export function normPos(p?: string): string | null {
  return p ? POS_MAP[p] || p : null;
}

export function normElem(e?: string): string | null {
  return e ? ELEM_MAP[e] || e : null;
}

/** Map le titre de jeu zukan → nom de série DB. */
export function zukanGameToSeries(game?: string): string | null {
  if (!game) return null;
  if (game === "Inazuma Eleven: Victory Road") return "Victory Road";
  if (game === "Inazuma Eleven Ares") return "Ares";
  if (game === "Inazuma Eleven Orion") return "Orion";
  if (game.startsWith("Inazuma Eleven GO Galaxy")) return "Galaxy";
  if (game.startsWith("Inazuma Eleven GO Chrono Stones") || game.startsWith("Inazuma Eleven GO2"))
    return "Chrono Stone";
  if (game.startsWith("Inazuma Eleven GO")) return "Inazuma Eleven GO";
  if (game.startsWith("Inazuma Eleven 3")) return "Inazuma Eleven 3";
  if (game.startsWith("Inazuma Eleven 2")) return "Inazuma Eleven 2";
  if (game === "Inazuma Eleven") return "Inazuma Eleven";
  return null;
}

/** Série DB → ère (OG / GO / Modern). Sert au blocage cross-ère. */
export const ERAS: Record<string, string> = {
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

/** Ordre canonique des ères (plus petit = plus ancien). */
export const ERA_ORDER: Record<string, number> = { OG: 1, GO: 2, Modern: 3 };

/** Deux séries appartiennent-elles à la même ère (sans être identiques) ? */
export function sameEra(a: string, b: string): boolean {
  const eraA = ERAS[a];
  const eraB = ERAS[b];
  return !!(eraA && eraB && eraA === eraB && a !== b);
}

/** Normalise le genre zukan vers le format DB (M/F). */
export function normGender(g?: string): string | null {
  if (!g) return null;
  if (g === "Male" || g === "男") return "M";
  if (g === "Female" || g === "女") return "F";
  return null;
}

// ============================================================================
// Similarity helpers
// ============================================================================

/** Corrélation de rang de Spearman entre deux tableaux de même longueur.
 *  Retourne une valeur entre -1 et +1. */
export function spearmanCorrelation(a: number[], b: number[]): number {
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

export const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "of",
  "to",
  "is",
  "are",
  "was",
  "were",
  "he",
  "she",
  "they",
  "his",
  "her",
  "their",
  "it",
  "its",
  "with",
  "for",
  "at",
  "from",
  "that",
  "this",
  "as",
  "be",
  "by",
  "has",
  "have",
  "had",
  "not",
  "who",
  "which",
  "when",
]);

/** Similarité de Jaccard entre deux descriptions (chevauchement de mots, EN). */
export function descriptionSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
    );
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  const intersection = [...sa].filter(w => sb.has(w)).length;
  const union = new Set([...sa, ...sb]).size;
  return intersection / union;
}

// ============================================================================
// Scoring — strict, gate poste/élément
// ============================================================================

/** Score de compatibilité entre une entrée zukan et une ligne DB.
 *  Plus haut = meilleur ; -1 = incompatible (rejet dur). */
export function matchScore(z: ZukanMatchEntry, db: ZukanMatchDbChar): number {
  const zPos = normPos(z.position);
  const zElem = normElem(z.element);
  const dPos = db.position ? normPos(db.position) : null;
  const dElem = db.element ? normElem(db.element) : null;

  // Position and element must match if both are known
  if (zPos && dPos && zPos !== dPos) return -1;
  if (zElem && dElem && zElem !== dElem) return -1;

  let score = 0;
  if (zPos && zPos === dPos) score += 10;
  if (zElem && zElem === dElem) score += 10;

  // Gender: +5 match, -10 explicit mismatch
  const zGender = normGender(z.gender);
  if (zGender && db.gender) {
    if (zGender === db.gender) {
      score += 5;
    } else {
      score -= 10;
    }
  }

  // Series matching — hard era gate
  // Cross-era matches are BLOCKED to prevent assigning adult GO / Ares redesign
  // images to OG-era characters (or vice versa).
  // Exception: Héros Ares are OG characters (Mark, Axel, etc.) re-released
  //            in Ares series → prefer EARLIEST era (IE1/IE2) portraits.
  const isHero = db.rarity_label === "Héros";
  const zSeries = zukanGameToSeries(z.game);
  if (zSeries && db.series) {
    const dbEra = ERAS[db.series];
    const zEra = ERAS[zSeries];
    if (isHero) {
      // Heroes use original character designs — prefer EARLIEST era portrait
      const zOrder = ERA_ORDER[zEra || ""] || 0;
      if (zOrder === 1)
        score += 60; // OG era = best for heroes
      else if (zSeries === db.series)
        score += 40; // Same series = ok fallback
      else if (zEra === dbEra)
        score += 30; // Same era = ok
      else score += 5; // Other = last resort
    } else {
      if (dbEra && zEra && dbEra !== zEra) return -1; // Hard block cross-era
      if (zSeries === db.series) {
        score += 50;
      } else if (dbEra && zEra && dbEra === zEra) {
        score += 20; // Same era, different sub-series (e.g. IE1 ↔ IE2)
      }
    }
  }

  // Description similarity: zukan EN description vs DB description_en
  if (z.description && db.description_en) {
    const sim = descriptionSimilarity(z.description, db.description_en);
    if (sim >= 0.15) {
      score += Math.round(sim * 30); // up to +30 for high overlap
    } else if (sim === 0) {
      score -= 10; // aucun mot commun = mauvais signe
    }
  }

  // Stats comparison: Spearman rank correlation (Lv50 zukan vs community Lv99 DB)
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

    if (zTotal > 0 && dTotal > 0) {
      const corr = spearmanCorrelation(zArr, dArr);
      // Map correlation (-1..+1) to score (0..+15), clamped
      score += Math.round(Math.max(0, corr) * 15);
    }
  }

  return score;
}

// ============================================================================
// Assignment — 1:1 mapping via usedHashes
// ============================================================================

/**
 * Créé un contexte d'assignation isolé (set `usedHashes` propre). Chaque run de
 * matching doit créer le sien pour garantir le 1:1 sur l'ensemble du run.
 *
 * Le matcher d'origine utilisait un set `usedHashes` au scope module ; ici on le
 * paramètre pour éviter tout état partagé entre invocations (ex : tests, deux
 * passes successives). Le comportement par run reste IDENTIQUE.
 */
export interface MatchContext {
  /** Hashes déjà assignés sur ce run (mapping 1:1). */
  usedHashes: Set<string>;
}

export function createMatchContext(): MatchContext {
  return { usedHashes: new Set<string>() };
}

/**
 * Assigne les paires (db, zukan) d'un groupe en respectant le 1:1.
 * Greedy par meilleur score décroissant, seuil minimal de 20 (pos+elem requis).
 */
export function matchGroupsStrict(
  ctx: MatchContext,
  zukanGroup: ZukanMatchEntry[],
  dbGroup: ZukanMatchDbChar[],
  assigned: Map<string, string>,
) {
  const unassignedDb = dbGroup.filter(c => !assigned.has(c.id));
  if (unassignedDb.length === 0) return;

  const available = zukanGroup.filter(z => z.zukanHash && !ctx.usedHashes.has(z.zukanHash));

  // Build score matrix and assign greedily by best score
  const pairs: { db: ZukanMatchDbChar; z: ZukanMatchEntry; score: number }[] = [];
  for (const db of unassignedDb) {
    for (const z of available) {
      const s = matchScore(z, db);
      if (s >= 20) pairs.push({ db, z, score: s }); // Minimum pos+elem match required
    }
  }

  // Sort by score descending, assign greedily (1:1)
  pairs.sort((a, b) => b.score - a.score);
  for (const { db, z } of pairs) {
    if (assigned.has(db.id) || ctx.usedHashes.has(z.zukanHash!)) continue;
    assigned.set(db.id, z.zukanHash!);
    ctx.usedHashes.add(z.zukanHash!);
  }
}

/** Assigne le meilleur match unique pour un perso DB (phases fuzzy). */
export function assignBest(
  ctx: MatchContext,
  c: ZukanMatchDbChar,
  candidates: ZukanMatchEntry[],
  assigned: Map<string, string>,
  minScore = 20,
) {
  if (assigned.has(c.id)) return;
  const scored = candidates
    .filter(z => z.zukanHash && !ctx.usedHashes.has(z.zukanHash))
    .map(z => ({ z, score: matchScore(z, c) }))
    .filter(p => p.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    assigned.set(c.id, scored[0].z.zukanHash!);
    ctx.usedHashes.add(scored[0].z.zukanHash!);
  }
}
