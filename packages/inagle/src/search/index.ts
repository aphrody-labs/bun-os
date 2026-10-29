/**
 * Search Module - Unified fuzzy search for all game data
 *
 * @example
 * ```typescript
 * import { createGlobalSearch, createSearchIndex } from '@aphrody/inagle/search';
 *
 * // Global search across all data
 * const search = createGlobalSearch({ basara, characters, skills });
 * const results = search.global('endou');
 *
 * // Custom search index
 * const myIndex = createSearchIndex(items, item => item.name);
 * const found = myIndex.search('query');
 * ```
 */

export type { GlobalSearchAPI, GlobalSearchResult, SearchableType, SearchConfig, SearchResult } from "./fuzzy.js";
export { createGlobalSearch, createSearchIndex } from "./fuzzy.js";
