/**
 * @file api.ts
 * @description Constellation API for Players Universe
 *
 * Provides access to the 30 constellations in the game and their associated characters.
 *
 * @example
 * ```typescript
 * import { createConstellationAPI } from '@aphrody/inagle';
 *
 * const constellations = createConstellationAPI();
 *
 * // Get all constellations
 * const all = constellations.all();
 * console.log(all.length); // 30
 *
 * // Get constellation by name
 * const boulederius = constellations.byName('Boulederius');
 *
 * // Get character's constellation
 * const charConstellation = constellations.forCharacter('0xA41870E9');
 *
 * // Search constellations
 * const results = constellations.search('pingouin');
 * ```
 */

import { buildConstellationMapping, type Constellation, type ConstellationMapping } from "../parsers/constellation.js";

// Re-export types
export type { Constellation, ConstellationMapping };

/** Constellation database with indexes */
export interface ConstellationDatabase {
  generatedAt: string;
  totalConstellations: number;
  totalMappedCharacters: number;
  constellations: Constellation[];
  byIndex: Map<number, Constellation>;
  byName: Map<string, Constellation>;
  byCharacterId: Map<string, number>;
  stats: {
    avgCharactersPerConstellation: number;
    maxCharacters: number;
    minCharacters: number;
    byConstellation: Record<string, number>;
  };
}

/**
 * Build constellation database with indexes
 */
export function buildConstellationDatabase(): ConstellationDatabase {
  const mapping = buildConstellationMapping();
  const constellations = mapping.constellations;

  const byIndex = new Map<number, Constellation>();
  const byName = new Map<string, Constellation>();
  const byConstellation: Record<string, number> = {};

  let maxChars = 0;
  let minChars = Number.POSITIVE_INFINITY;
  let totalChars = 0;

  for (const c of constellations) {
    byIndex.set(c.index, c);

    // Index by all name variants
    if (c.names.fr) byName.set(c.names.fr.toLowerCase(), c);
    if (c.names.en) byName.set(c.names.en.toLowerCase(), c);
    if (c.names.ja) byName.set(c.names.ja, c);

    // Stats
    const count = c.characterCount;
    totalChars += count;
    if (count > maxChars) maxChars = count;
    if (count < minChars) minChars = count;

    const displayName = c.names.fr || c.names.en || `Constellation ${c.index}`;
    byConstellation[displayName] = count;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalConstellations: constellations.length,
    totalMappedCharacters: mapping.byCharacterId.size,
    constellations,
    byIndex,
    byName,
    byCharacterId: mapping.byCharacterId,
    stats: {
      avgCharactersPerConstellation: Math.round(totalChars / constellations.length),
      maxCharacters: maxChars,
      minCharacters: minChars === Number.POSITIVE_INFINITY ? 0 : minChars,
      byConstellation,
    },
  };
}

/**
 * Create Constellation API
 */
export function createConstellationAPI() {
  const db = buildConstellationDatabase();

  return {
    /** Metadata */
    meta: {
      generatedAt: db.generatedAt,
      totalConstellations: db.totalConstellations,
      totalMappedCharacters: db.totalMappedCharacters,
      stats: db.stats,
    },

    /** Get all 30 constellations */
    all: () => db.constellations,

    /** Get constellation by index (0-29) */
    byIndex: (index: number) => db.byIndex.get(index),

    /** Get constellation by exact name (FR, EN, or JA) */
    byName: (name: string) => {
      const lower = name.toLowerCase();
      return db.byName.get(lower) || db.byName.get(name);
    },

    /** Get constellation for a character (by charaParamId) */
    forCharacter: (charaParamId: string): Constellation | undefined => {
      const index = db.byCharacterId.get(charaParamId);
      if (index === undefined) return undefined;
      return db.byIndex.get(index);
    },

    /** Get constellation name for a character */
    getNameForCharacter: (charaParamId: string, lang: "fr" | "en" | "ja" = "fr"): string | undefined => {
      const index = db.byCharacterId.get(charaParamId);
      if (index === undefined) return undefined;
      const constellation = db.byIndex.get(index);
      return constellation?.names[lang];
    },

    /** Search constellations by name */
    search: (query: string): Constellation[] => {
      const q = query.toLowerCase();
      return db.constellations.filter(
        c =>
          c.names.fr?.toLowerCase().includes(q) || c.names.en?.toLowerCase().includes(q) || c.names.ja?.includes(query),
      );
    },

    /** Get all character IDs in a constellation */
    getCharacterIds: (constellationIndex: number): string[] => {
      const constellation = db.byIndex.get(constellationIndex);
      return constellation?.characterIds || [];
    },

    /** Get constellation with the most characters */
    largest: (): Constellation | undefined => {
      return db.constellations.reduce((a, b) => (a.characterCount > b.characterCount ? a : b));
    },

    /** Get constellation with the fewest characters */
    smallest: (): Constellation | undefined => {
      return db.constellations.reduce((a, b) => (a.characterCount < b.characterCount ? a : b));
    },

    /** Get constellations sorted by character count */
    sortedByCount: (ascending = false): Constellation[] => {
      const sorted = [...db.constellations].sort((a, b) => a.characterCount - b.characterCount);
      return ascending ? sorted : sorted.reverse();
    },

    /** Check if a character is mapped to any constellation */
    hasConstellation: (charaParamId: string): boolean => {
      return db.byCharacterId.has(charaParamId);
    },

    /** Raw database access */
    raw: db,
  };
}

export type ConstellationAPI = ReturnType<typeof createConstellationAPI>;
