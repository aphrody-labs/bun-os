/* SPDX-License-Identifier: Apache-2.0 */
/* oxlint-disable unicorn/consistent-function-scoping -- the factory below is this file module scope (browser global + CommonJS dual export) */
/*
 * YouTube Subs Sorter - pure logic.
 * No DOM and no browser API here: the file is loaded as a content script and by the
 * popup (global `YSS`), and imported by `bun test` (CommonJS export).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YSS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT = "yt-subs-sorter";
  const VERSION = 1;
  const LIMITS = Object.freeze({
    groups: 100,
    channels: 20000,
    aliases: 20000,
    groupName: 40,
    channelName: 120,
    importBytes: 8 * 1024 * 1024,
  });
  // design:content - default group colours offered by the colour picker (user data, not UI chrome).
  const PALETTE = Object.freeze([
    "#e53935",
    "#fb8c00",
    "#f9a825",
    "#43a047",
    "#00acc1",
    "#1e88e5",
    "#8e24aa",
    "#6d4c41",
  ]);
  const SORT_MODES = Object.freeze(["default", "alpha", "group"]);
  const DEFAULT_SETTINGS = Object.freeze({
    feedFilter: "all", // "all" | "none" (no group) | group id
    listFilter: "all",
    hideShorts: false,
    hideWatched: false,
    watchedThreshold: 80, // percent of the progress bar from which a video counts as watched
    sort: "default",
    badges: true,
  });

  const HANDLE_RE = /^@[^\s/?#]{1,100}$/;
  const ID_RE = /^UC[\w-]{22}$/;
  const LEGACY_RE = /^[cu]:[^\s/?#]{1,100}$/;
  const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

  function cleanText(value, max) {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, max);
  }

  // ---------------------------------------------------------------- channel keys

  function isValidKey(key) {
    return typeof key === "string" && (HANDLE_RE.test(key) || ID_RE.test(key) || LEGACY_RE.test(key));
  }

  /** Lower rank = preferred canonical key: handle, channel id, /c/, /user/. */
  function keyRank(key) {
    if (typeof key !== "string") return 9;
    if (key.startsWith("@")) return 0;
    if (key.startsWith("UC")) return 1;
    if (key.startsWith("c:")) return 2;
    return 3;
  }

  /** href (relative or absolute youtube.com) -> { kind, key } or null. */
  function parseChannelRef(href) {
    if (typeof href !== "string" || !href) return null;
    let path;
    if (href.startsWith("/") && !href.startsWith("//")) {
      path = href;
    } else {
      let url;
      try {
        url = new URL(href);
      } catch {
        return null;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      if (!/^(www\.|m\.)?youtube\.com$/.test(url.hostname)) return null;
      path = url.pathname;
    }
    const seg = path
      .split(/[?#]/)[0]
      .split("/")
      .filter(Boolean)
      .map(s => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
    if (!seg.length) return null;
    const [head, next] = seg;
    if (head.startsWith("@")) {
      const key = "@" + head.slice(1).toLowerCase();
      return HANDLE_RE.test(key) ? { kind: "handle", key } : null;
    }
    if (head === "channel" && next && ID_RE.test(next)) return { kind: "id", key: next };
    if ((head === "c" || head === "user") && next) {
      const key = (head === "c" ? "c:" : "u:") + next.toLowerCase();
      return LEGACY_RE.test(key) ? { kind: head === "c" ? "c" : "user", key } : null;
    }
    return null;
  }

  /** Page kind from location.pathname. */
  function routeOf(pathname) {
    if (typeof pathname !== "string") return null;
    const p = pathname.replace(/\/+$/, "");
    if (p === "/feed/subscriptions") return "feed";
    if (p === "/feed/channels") return "channels";
    if (p === "/watch") return "watch";
    return parseChannelRef(p) ? "channel" : null;
  }

  /** One element showing exactly one handle and one channel id = same channel: alias candidate. */
  function pairForAlias(keys) {
    const uniq = [...new Set((keys || []).filter(isValidKey))];
    const handles = uniq.filter(k => keyRank(k) === 0);
    const ids = uniq.filter(k => keyRank(k) === 1);
    return handles.length === 1 && ids.length === 1 && uniq.length === 2 ? { handle: handles[0], id: ids[0] } : null;
  }

  /** The canonical key of several keys found on one element (handle preferred). */
  function bestKey(keys) {
    const valid = (keys || []).filter(isValidKey);
    return valid.length ? valid.toSorted((a, b) => keyRank(a) - keyRank(b))[0] : null;
  }

  // ---------------------------------------------------------------- state

  function emptyState() {
    return {
      format: FORMAT,
      version: VERSION,
      groups: [],
      channels: {},
      aliases: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  function normalizeSettings(raw, groups) {
    const src = isObj(raw) ? raw : {};
    const ids = new Set((groups || []).map(g => g.id));
    const filter = v => (v === "all" || v === "none" || ids.has(v) ? v : "all");
    const threshold = Number.isFinite(src.watchedThreshold)
      ? Math.min(100, Math.max(1, Math.round(src.watchedThreshold)))
      : DEFAULT_SETTINGS.watchedThreshold;
    return {
      feedFilter: filter(src.feedFilter),
      listFilter: filter(src.listFilter),
      hideShorts: src.hideShorts === true,
      hideWatched: src.hideWatched === true,
      watchedThreshold: threshold,
      sort: SORT_MODES.includes(src.sort) ? src.sort : DEFAULT_SETTINGS.sort,
      badges: src.badges !== false,
    };
  }

  /** Lenient sanitiser for stored or imported data. Returns { state, warnings }. */
  function normalizeState(raw) {
    const warnings = [];
    const src = isObj(raw) ? raw : {};
    const groups = [];
    const seenIds = new Set();
    const seenNames = new Set();
    for (const g of Array.isArray(src.groups) ? src.groups : []) {
      if (groups.length >= LIMITS.groups) {
        warnings.push("groups: limit reached, extra groups ignored");
        break;
      }
      const name = cleanText(g && g.name, LIMITS.groupName);
      if (!isObj(g) || typeof g.id !== "string" || !GROUP_ID_RE.test(g.id) || !name) {
        warnings.push("groups: invalid entry ignored");
        continue;
      }
      if (seenIds.has(g.id) || seenNames.has(name.toLowerCase())) {
        warnings.push(`groups: duplicate "${name}" ignored`);
        continue;
      }
      seenIds.add(g.id);
      seenNames.add(name.toLowerCase());
      groups.push({
        id: g.id,
        name,
        color: COLOR_RE.test(g.color) ? g.color.toLowerCase() : PALETTE[groups.length % PALETTE.length],
      });
    }
    const channels = {};
    let count = 0;
    for (const [key, rec] of isObj(src.channels) ? Object.entries(src.channels) : []) {
      if (!isValidKey(key) || !isObj(rec) || !Array.isArray(rec.g)) {
        warnings.push("channels: invalid entry ignored");
        continue;
      }
      const ids = [...new Set(rec.g.filter(id => typeof id === "string" && seenIds.has(id)))];
      if (!ids.length) continue;
      if (count >= LIMITS.channels) {
        warnings.push("channels: limit reached, extra channels ignored");
        break;
      }
      channels[key] = { n: cleanText(rec.n, LIMITS.channelName), g: ids };
      count++;
    }
    const aliases = {};
    let aliasCount = 0;
    for (const [from, to] of isObj(src.aliases) ? Object.entries(src.aliases) : []) {
      if (!isValidKey(from) || !isValidKey(to) || from === to || aliasCount >= LIMITS.aliases) continue;
      aliases[from] = to;
      aliasCount++;
    }
    return {
      state: {
        format: FORMAT,
        version: VERSION,
        groups,
        channels,
        aliases,
        settings: normalizeSettings(src.settings, groups),
      },
      warnings,
    };
  }

  // ---------------------------------------------------------------- group editing (all pure: return a new state)

  function newGroupId(random = Math.random, now = Date.now) {
    return "g" + now().toString(36) + Math.floor(random() * 36 ** 4).toString(36);
  }

  function addGroup(state, name, color, id) {
    const clean = cleanText(name, LIMITS.groupName);
    if (!clean) return { state, error: "name-empty" };
    if (state.groups.length >= LIMITS.groups) return { state, error: "too-many-groups" };
    if (state.groups.some(g => g.name.toLowerCase() === clean.toLowerCase())) return { state, error: "name-duplicate" };
    let gid = id && GROUP_ID_RE.test(id) ? id : newGroupId();
    while (state.groups.some(g => g.id === gid)) gid += "x";
    const group = {
      id: gid.slice(0, 32),
      name: clean,
      color: COLOR_RE.test(color) ? color.toLowerCase() : PALETTE[state.groups.length % PALETTE.length],
    };
    return { state: { ...state, groups: [...state.groups, group] }, group };
  }

  function updateGroup(state, id, patch) {
    const current = state.groups.find(g => g.id === id);
    if (!current) return { state, error: "group-unknown" };
    const next = { ...current };
    if (patch && patch.name !== undefined) {
      const clean = cleanText(patch.name, LIMITS.groupName);
      if (!clean) return { state, error: "name-empty" };
      if (state.groups.some(g => g.id !== id && g.name.toLowerCase() === clean.toLowerCase()))
        return { state, error: "name-duplicate" };
      next.name = clean;
    }
    if (patch && patch.color !== undefined) {
      if (!COLOR_RE.test(patch.color)) return { state, error: "color-invalid" };
      next.color = patch.color.toLowerCase();
    }
    return {
      state: {
        ...state,
        groups: state.groups.map(g => (g.id === id ? next : g)),
      },
      group: next,
    };
  }

  function deleteGroup(state, id) {
    const channels = {};
    for (const [key, rec] of Object.entries(state.channels)) {
      const g = rec.g.filter(x => x !== id);
      if (g.length) channels[key] = { n: rec.n, g };
    }
    const groups = state.groups.filter(g => g.id !== id);
    const settings = { ...state.settings };
    if (settings.feedFilter === id) settings.feedFilter = "all";
    if (settings.listFilter === id) settings.listFilter = "all";
    return { ...state, groups, channels, settings };
  }

  function resolveKey(state, key) {
    if (!isValidKey(key)) return null;
    return hasOwn(state.aliases, key) && isValidKey(state.aliases[key]) ? state.aliases[key] : key;
  }

  function groupsOf(state, key) {
    const k = resolveKey(state, key);
    if (!k || !hasOwn(state.channels, k)) return [];
    const known = new Set(state.groups.map(g => g.id));
    return state.channels[k].g.filter(id => known.has(id));
  }

  /** Union of the groups of every key found on one element (handle and channel id may both be present). */
  function groupsOfAny(state, keys) {
    const out = [];
    for (const k of [].concat(keys || [])) for (const id of groupsOf(state, k)) if (!out.includes(id)) out.push(id);
    return out;
  }

  /** keys: one key or several keys of the same channel. Writes under the best key and drops the others. */
  function setChannelGroups(state, keys, name, groupIds) {
    const resolved = [
      ...new Set(
        []
          .concat(keys || [])
          .map(k => resolveKey(state, k))
          .filter(Boolean),
      ),
    ];
    if (!resolved.length) return state;
    const target = resolved.toSorted((a, b) => keyRank(a) - keyRank(b))[0];
    const known = new Set(state.groups.map(g => g.id));
    const ids = [...new Set((groupIds || []).filter(id => known.has(id)))];
    const channels = { ...state.channels };
    let previous = "";
    for (const k of resolved) {
      if (!hasOwn(channels, k)) continue;
      previous = previous || channels[k].n;
      delete channels[k];
    }
    if (ids.length)
      channels[target] = {
        n: cleanText(name, LIMITS.channelName) || previous,
        g: ids,
      };
    return { ...state, channels };
  }

  function toggleChannelGroup(state, keys, name, groupId) {
    const current = groupsOfAny(state, keys);
    const next = current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId];
    return setChannelGroups(state, keys, name, next);
  }

  /** `a` and `b` are the same channel. Records move to the best key, aliases are re-pointed. */
  function learnAlias(state, a, b) {
    if (!isValidKey(a) || !isValidKey(b) || a === b) return state;
    const ra = resolveKey(state, a);
    const rb = resolveKey(state, b);
    if (ra === rb) return state;
    const target = keyRank(ra) <= keyRank(rb) ? ra : rb;
    const source = target === ra ? rb : ra;
    const aliases = { ...state.aliases };
    for (const [from, to] of Object.entries(aliases)) if (to === source) aliases[from] = target;
    aliases[source] = target;
    const channels = { ...state.channels };
    if (hasOwn(channels, source)) {
      const moved = channels[source];
      delete channels[source];
      const existing = hasOwn(channels, target) ? channels[target] : null;
      channels[target] = {
        n: (existing && existing.n) || moved.n,
        g: [...new Set([...(existing ? existing.g : []), ...moved.g])],
      };
    }
    return { ...state, aliases, channels };
  }

  /** Fallback when a feed item has no channel link: unique stored display name -> key. */
  function resolveByName(state, name) {
    const wanted = cleanText(name, LIMITS.channelName).toLowerCase();
    if (!wanted) return null;
    let found = null;
    for (const [key, rec] of Object.entries(state.channels)) {
      if (rec.n.toLowerCase() !== wanted) continue;
      if (found) return null;
      found = key;
    }
    return found;
  }

  function countByGroup(state) {
    const counts = {};
    for (const g of state.groups) counts[g.id] = 0;
    for (const rec of Object.values(state.channels)) for (const id of rec.g) if (hasOwn(counts, id)) counts[id]++;
    return { counts, assigned: Object.keys(state.channels).length };
  }

  // ---------------------------------------------------------------- filtering and sorting decisions

  function matchesFilter(filter, groupIds) {
    if (!filter || filter === "all") return true;
    if (filter === "none") return groupIds.length === 0;
    return groupIds.includes(filter);
  }

  /** "42%" or "width: 42.5%;" -> 0..100, else null. */
  function parsePercent(text) {
    if (typeof text !== "string") return null;
    const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(text);
    if (!m) return null;
    return Math.min(100, Math.max(0, Number(m[1])));
  }

  /**
   * item: { isShort: boolean, watchedPct: number | null }  (null = no progress overlay)
   * returns { hide, reason }  reason: "short" | "watched" | "group" | null
   */
  function decideFeedItem(item, settings, groupIds) {
    if (settings.hideShorts && item.isShort) return { hide: true, reason: "short" };
    if (settings.hideWatched && item.watchedPct !== null && item.watchedPct >= settings.watchedThreshold)
      return { hide: true, reason: "watched" };
    if (!matchesFilter(settings.feedFilter, groupIds)) return { hide: true, reason: "group" };
    return { hide: false, reason: null };
  }

  /**
   * items: [{ key: string|null, name: string }] in DOM order.
   * returns the display rank of each item (CSS `order`), or null for "default".
   */
  function sortRanks(items, mode, state) {
    if (mode !== "alpha" && mode !== "group") return null;
    const collator = new Intl.Collator(undefined, {
      sensitivity: "base",
      numeric: true,
    });
    const order = new Map(state.groups.map((g, i) => [g.id, i]));
    const groupRank = item => {
      const ranks = (item.key ? groupsOf(state, item.key) : []).map(id => order.get(id)).filter(n => n !== undefined);
      return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
    };
    const decorated = items.map((item, index) => ({
      index,
      name: item.name || "",
      rank: mode === "group" ? groupRank(item) : 0,
    }));
    decorated.sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name) || a.index - b.index);
    const ranks = Array.from({ length: items.length });
    decorated.forEach((d, position) => {
      ranks[d.index] = position;
    });
    return ranks;
  }

  // ---------------------------------------------------------------- export / import

  function exportState(state, now = new Date()) {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: now.toISOString(),
      groups: state.groups.map(g => ({ ...g })),
      channels: Object.fromEntries(Object.entries(state.channels).map(([k, r]) => [k, { n: r.n, g: [...r.g] }])),
      aliases: { ...state.aliases },
      settings: { ...state.settings },
    };
  }

  /** text (JSON string) or object -> { ok: true, state, warnings } | { ok: false, errors } */
  function validateImport(input) {
    let raw = input;
    if (typeof input === "string") {
      if (input.length > LIMITS.importBytes) return { ok: false, errors: ["file too large"] };
      try {
        raw = JSON.parse(input);
      } catch {
        return { ok: false, errors: ["not valid JSON"] };
      }
    }
    const errors = [];
    if (!isObj(raw)) return { ok: false, errors: ["JSON root must be an object"] };
    if (raw.format !== FORMAT) errors.push(`format must be "${FORMAT}"`);
    if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > VERSION)
      errors.push(`unsupported version (supported: 1..${VERSION})`);
    if (!Array.isArray(raw.groups)) errors.push("groups must be an array");
    if (!isObj(raw.channels)) errors.push("channels must be an object");
    if (errors.length) return { ok: false, errors };
    const { state, warnings } = normalizeState(raw);
    return { ok: true, state, warnings };
  }

  /** mode "replace": the imported state. mode "merge": union of groups (by id, else by name) and channel assignments. */
  function mergeImport(current, imported, mode) {
    if (mode === "replace") return imported;
    let state = current;
    const idMap = new Map();
    for (const g of imported.groups) {
      const sameId = state.groups.find(x => x.id === g.id);
      const sameName = state.groups.find(x => x.name.toLowerCase() === g.name.toLowerCase());
      const target = sameId || sameName;
      if (target) {
        idMap.set(g.id, target.id);
        continue;
      }
      const added = addGroup(state, g.name, g.color, g.id);
      if (added.group) {
        state = added.state;
        idMap.set(g.id, added.group.id);
      }
    }
    const channels = { ...state.channels };
    for (const [key, rec] of Object.entries(imported.channels)) {
      const mapped = rec.g.map(id => idMap.get(id)).filter(Boolean);
      if (!mapped.length) continue;
      const existing = hasOwn(channels, key) ? channels[key] : null;
      channels[key] = {
        n: (existing && existing.n) || rec.n,
        g: [...new Set([...(existing ? existing.g : []), ...mapped])],
      };
    }
    const aliases = { ...imported.aliases, ...state.aliases };
    return { ...state, channels, aliases };
  }

  return {
    FORMAT,
    VERSION,
    LIMITS,
    PALETTE,
    SORT_MODES,
    DEFAULT_SETTINGS,
    isValidKey,
    keyRank,
    parseChannelRef,
    routeOf,
    pairForAlias,
    bestKey,
    emptyState,
    normalizeSettings,
    normalizeState,
    newGroupId,
    addGroup,
    updateGroup,
    deleteGroup,
    resolveKey,
    groupsOf,
    groupsOfAny,
    setChannelGroups,
    toggleChannelGroup,
    learnAlias,
    resolveByName,
    countByGroup,
    matchesFilter,
    parsePercent,
    decideFeedItem,
    sortRanks,
    exportState,
    validateImport,
    mergeImport,
  };
});
