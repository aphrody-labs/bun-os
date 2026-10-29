// SPDX-License-Identifier: Apache-2.0
// Central preferences of the WebOS shell. One typed schema holds every key with its default and validator;
// values persist in IndexedDB, reach the other tabs through a BroadcastChannel and export to a JSON file.
// localStorage only keeps the boot snapshot that src/boot.ts replays before first paint (see appearance.ts).
//
//   await prefs.ready;
//   prefs.get("dock.size");                         // 44
//   prefs.set("dock.size", 52);                      // applied live, saved, synced
//   const off = prefs.subscribe("dock.size", v => …); // also "*" for every key
import type { SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import { ACTIONS } from "./shortcuts";

export type Mode = "auto" | "light" | "dark";
export type Variant = SchemeVariant;
/** An M3 colour role name ("primary", "tertiary-container") or a #rrggbb colour. */
export type ColorToken = string;

export interface CustomTheme {
  id: string;
  name: string;
  seed: string;
  variant: Variant;
  contrast: number;
}

export interface WallpaperSpec {
  kind: "contour" | "solid" | "gradient" | "image";
  /** Terrain seed of the generated contour map. */
  seed: number;
  /** Contour lines across the height range (density). */
  levels: number;
  /** Three glows of the contour map. */
  glows: [ColorToken, ColorToken, ColorToken];
  /** Contour line colour. */
  lines: ColorToken;
  solid: ColorToken;
  gradient: [ColorToken, ColorToken];
  /** Gradient angle in degrees. */
  angle: number;
  /** Picture in the WebOS file system (OPFS). */
  image: string;
  fit: "cover" | "contain";
  /** Darkening over the picture, 0 to 0.7. */
  dim: number;
}

export const BAR_ITEMS = [
  "launcher",
  "workspaces",
  "active",
  "clock",
  "layout",
  "search",
  "status",
  "settings",
] as const;
export type BarItem = (typeof BAR_ITEMS)[number];
export type BarZone = "left" | "center" | "right" | "hidden";

/** File kinds the default-app setting covers, by extension. */
export const FILE_TYPES = [
  {
    id: "text",
    label: "Text and code",
    exts: [
      "txt",
      "md",
      "js",
      "mjs",
      "ts",
      "tsx",
      "jsx",
      "json",
      "css",
      "html",
      "rs",
      "toml",
      "yaml",
      "yml",
      "sh",
      "py",
    ],
  },
  {
    id: "image",
    label: "Pictures",
    exts: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"],
  },
  { id: "video", label: "Videos", exts: ["mp4", "webm", "mov", "mkv"] },
  {
    id: "audio",
    label: "Music and audio",
    exts: ["mp3", "ogg", "wav", "flac", "m4a", "opus"],
  },
  { id: "pdf", label: "PDF documents", exts: ["pdf"] },
  {
    id: "binary",
    label: "Programs and archives",
    exts: ["wasm", "exe", "elf", "zip", "tar", "gz", "nds", "gba"],
  },
] as const;
export type FileTypeId = (typeof FILE_TYPES)[number]["id"];

export interface PrefMap {
  "theme.mode": Mode;
  /** A built-in theme id (themes.ts), "seed" for a scheme from theme.seed, or "custom:<id>". */
  "theme.id": string;
  "theme.seed": string;
  "theme.variant": Variant;
  /** M3 contrast level, -1 to 1. */
  "theme.contrast": number;
  "theme.custom": CustomTheme[];
  "type.family":
    | "google-sans-flex"
    | "roboto-flex"
    | "google-sans-code"
    | "roboto-mono"
    | "system";
  "type.scale": number;
  /** Corner radius multiplier, 0 (square) to 2. */
  "shape.radius": number;
  "layout.density": "compact" | "standard" | "comfortable";
  "motion.mode": "system" | "reduced" | "normal";
  /** Transparency of the bar, dock and panels, 0 (opaque) to 0.8. */
  "surface.transparency": number;
  /** Background blur behind translucent surfaces, in pixels. */
  "surface.blur": number;
  "wallpaper.default": WallpaperSpec;
  /** Overrides per workspace number. */
  "wallpaper.workspaces": Record<string, WallpaperSpec>;
  "bar.position": "top" | "bottom";
  "bar.items": Record<BarItem, BarZone>;
  "clock.hourCycle": "auto" | "h12" | "h23";
  "clock.seconds": boolean;
  "clock.date": "none" | "short" | "long";
  "dock.position": "bottom" | "left" | "right";
  /** Icon size in pixels. */
  "dock.size": number;
  "dock.autohide": boolean;
  /** Launch ids: builtin ids, "pkg:<package>" or "web:<url>". */
  "dock.pinned": string[];
  "desktop.icons": boolean;
  /** Launch ids shown as desktop icons. */
  "desktop.apps": string[];
  "workspaces.count": number;
  "windows.gap": number;
  "windows.border": number;
  "windows.tiling": "dwindle" | "master" | "scrolling" | "floating";
  /** Launch id per file kind. */
  "files.openWith": Record<FileTypeId, string>;
  /** Chords per action id (shortcuts.ts); missing actions use their defaults. */
  "keys.bindings": Record<string, string[]>;
  /** BCP 47 tag, or "auto" for the browser language. */
  "region.locale": string;
  /** IANA time zone, or "auto". */
  "region.timeZone": string;
  "region.dateStyle": "short" | "medium" | "long" | "full";
  "a11y.focusRing": number;
  "a11y.highContrast": boolean;
  "a11y.largeTargets": boolean;
  "a11y.announce": boolean;
  "notify.enabled": boolean;
  "notify.dnd": boolean;
  "notify.system": boolean;
  /** Seconds a notification stays on screen. */
  "notify.duration": number;
  "sound.enabled": boolean;
  "sound.volume": number;
  "sound.events": { open: boolean; close: boolean; notify: boolean };
  "shell.welcomed": boolean;
}
export type PrefKey = keyof PrefMap;

interface Spec<T> {
  default: T;
  /** The value when valid (coerced where harmless), otherwise undefined. */
  parse(value: unknown): T | undefined;
}

const oneOf = <T extends string>(def: T, values: readonly T[]): Spec<T> => ({
  default: def,
  parse: (v) => (values.includes(v as T) ? (v as T) : undefined),
});
const num = (def: number, min: number, max: number): Spec<number> => ({
  default: def,
  parse: (v) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : undefined,
});
const bool = (def: boolean): Spec<boolean> => ({
  default: def,
  parse: (v) => (typeof v === "boolean" ? v : undefined),
});
const HEX = /^#[\da-f]{6}$/i;
const ROLE = /^[a-z]+(-[a-z]+)*$/;
const isToken = (v: unknown): v is string =>
  typeof v === "string" && (HEX.test(v) || ROLE.test(v));
const hex = (def: string): Spec<string> => ({
  default: def,
  parse: (v) =>
    typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined,
});
const text = (def: string, max = 200): Spec<string> => ({
  default: def,
  parse: (v) => (typeof v === "string" && v.length <= max ? v : undefined),
});
const ids = (def: string[]): Spec<string[]> => ({
  default: def,
  parse: (v) =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? [...new Set(v as string[])]
      : undefined,
});
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const VARIANTS: readonly Variant[] = [
  "tonalSpot",
  "content",
  "fidelity",
  "expressive",
  "vibrant",
  "neutral",
  "monochrome",
];

export const DEFAULT_WALLPAPER: WallpaperSpec = {
  kind: "contour",
  seed: 0xb0b05,
  levels: 26,
  glows: ["primary", "tertiary", "secondary"],
  lines: "primary",
  solid: "surface-container-low",
  gradient: ["primary-container", "tertiary-container"],
  angle: 135,
  image: "",
  fit: "cover",
  dim: 0.15,
};

function parseWallpaper(v: unknown): WallpaperSpec | undefined {
  if (!isObject(v)) return undefined;
  const d = DEFAULT_WALLPAPER;
  const pick = <T>(value: unknown, ok: (x: unknown) => boolean, fallback: T) =>
    ok(value) ? (value as T) : fallback;
  const n = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback;
  const glows =
    Array.isArray(v.glows) && v.glows.length === 3 && v.glows.every(isToken)
      ? v.glows
      : d.glows;
  const gradient =
    Array.isArray(v.gradient) &&
    v.gradient.length === 2 &&
    v.gradient.every(isToken)
      ? v.gradient
      : d.gradient;
  return {
    kind: pick(
      v.kind,
      (x) => ["contour", "solid", "gradient", "image"].includes(x as string),
      d.kind,
    ),
    seed: Math.round(n(v.seed, 0, 0xffffffff, d.seed)),
    levels: Math.round(n(v.levels, 4, 64, d.levels)),
    glows: [...glows] as WallpaperSpec["glows"],
    lines: pick(v.lines, isToken, d.lines),
    solid: pick(v.solid, isToken, d.solid),
    gradient: [...gradient] as WallpaperSpec["gradient"],
    angle: n(v.angle, 0, 360, d.angle),
    image: pick(
      v.image,
      (x) => typeof x === "string" && x.length < 1024,
      d.image,
    ),
    fit: pick(v.fit, (x) => x === "cover" || x === "contain", d.fit),
    dim: n(v.dim, 0, 0.7, d.dim),
  };
}

const DEFAULT_BAR: Record<BarItem, BarZone> = {
  launcher: "left",
  workspaces: "left",
  active: "left",
  clock: "center",
  layout: "right",
  search: "right",
  status: "right",
  settings: "right",
};

export const SCHEMA: { [K in PrefKey]: Spec<PrefMap[K]> } = {
  "theme.mode": oneOf<Mode>("auto", ["auto", "light", "dark"]),
  "theme.id": text("aphrody", 80),
  "theme.seed": hex("#6750a4"),
  "theme.variant": oneOf<Variant>("tonalSpot", VARIANTS),
  "theme.contrast": num(0, -1, 1),
  "theme.custom": {
    default: [],
    parse: (v) =>
      Array.isArray(v)
        ? v.flatMap((t) =>
            isObject(t) &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            HEX.test(String(t.seed))
              ? [
                  {
                    id: t.id.slice(0, 40),
                    name: t.name.slice(0, 60),
                    seed: String(t.seed).toLowerCase(),
                    variant: VARIANTS.includes(t.variant as Variant)
                      ? (t.variant as Variant)
                      : "tonalSpot",
                    contrast:
                      typeof t.contrast === "number"
                        ? Math.max(-1, Math.min(1, t.contrast))
                        : 0,
                  },
                ]
              : [],
          )
        : undefined,
  },
  "type.family": oneOf("google-sans-flex", [
    "google-sans-flex",
    "roboto-flex",
    "google-sans-code",
    "roboto-mono",
    "system",
  ]),
  "type.scale": num(1, 0.8, 1.4),
  "shape.radius": num(1, 0, 2),
  "layout.density": oneOf("standard", ["compact", "standard", "comfortable"]),
  "motion.mode": oneOf("system", ["system", "reduced", "normal"]),
  "surface.transparency": num(0.26, 0, 0.8),
  "surface.blur": num(20, 0, 48),
  "wallpaper.default": { default: DEFAULT_WALLPAPER, parse: parseWallpaper },
  "wallpaper.workspaces": {
    default: {},
    parse: (v) => {
      if (!isObject(v)) return undefined;
      const out: Record<string, WallpaperSpec> = {};
      for (const [k, spec] of Object.entries(v)) {
        const parsed = parseWallpaper(spec);
        if (/^\d+$/.test(k) && parsed) out[k] = parsed;
      }
      return out;
    },
  },
  "bar.position": oneOf("top", ["top", "bottom"]),
  "bar.items": {
    default: DEFAULT_BAR,
    parse: (v) => {
      if (!isObject(v)) return undefined;
      const out = { ...DEFAULT_BAR };
      for (const item of BAR_ITEMS)
        if (["left", "center", "right", "hidden"].includes(v[item] as string))
          out[item] = v[item] as BarZone;
      return out;
    },
  },
  "clock.hourCycle": oneOf("auto", ["auto", "h12", "h23"]),
  "clock.seconds": bool(false),
  "clock.date": oneOf("short", ["none", "short", "long"]),
  "dock.position": oneOf("bottom", ["bottom", "left", "right"]),
  "dock.size": num(44, 32, 72),
  "dock.autohide": bool(false),
  "dock.pinned": ids([
    "files",
    "browser",
    "terminal",
    "apps",
    "creative",
    "docs",
  ]),
  "desktop.icons": bool(false),
  "desktop.apps": ids(["files", "browser", "terminal", "docs", "settings"]),
  "workspaces.count": num(5, 1, 10),
  "windows.gap": num(10, 0, 32),
  "windows.border": num(2, 0, 6),
  "windows.tiling": oneOf("dwindle", ["dwindle", "master", "scrolling", "floating"]),
  "files.openWith": {
    default: {
      text: "editor",
      image: "media",
      video: "media",
      audio: "media",
      pdf: "browser",
      binary: "inspector",
    },
    parse: (v) => {
      if (!isObject(v)) return undefined;
      const out = { ...SCHEMA["files.openWith"].default };
      for (const t of FILE_TYPES)
        if (typeof v[t.id] === "string") out[t.id] = v[t.id] as string;
      return out;
    },
  },
  "keys.bindings": {
    default: {},
    parse: (v) => {
      if (!isObject(v)) return undefined;
      const out: Record<string, string[]> = {};
      for (const a of ACTIONS) {
        const chords = v[a.id];
        if (
          Array.isArray(chords) &&
          chords.every((c) => typeof c === "string" && c.length < 60)
        )
          out[a.id] = chords as string[];
      }
      return out;
    },
  },
  "region.locale": {
    default: "auto",
    parse: (v) => {
      if (v === "auto") return "auto";
      if (typeof v !== "string") return undefined;
      try {
        return Intl.getCanonicalLocales(v)[0];
      } catch {
        return undefined;
      }
    },
  },
  "region.timeZone": {
    default: "auto",
    parse: (v) => {
      if (v === "auto") return "auto";
      if (typeof v !== "string") return undefined;
      try {
        return new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions()
          .timeZone;
      } catch {
        return undefined;
      }
    },
  },
  "region.dateStyle": oneOf("long", ["short", "medium", "long", "full"]),
  "a11y.focusRing": num(3, 1, 8),
  "a11y.highContrast": bool(false),
  "a11y.largeTargets": bool(false),
  "a11y.announce": bool(true),
  "notify.enabled": bool(true),
  "notify.dnd": bool(false),
  "notify.system": bool(false),
  "notify.duration": num(5, 2, 30),
  "sound.enabled": bool(true),
  "sound.volume": num(0.6, 0, 1),
  "sound.events": {
    default: { open: true, close: true, notify: true },
    parse: (v) =>
      isObject(v)
        ? {
            open: v.open !== false,
            close: v.close !== false,
            notify: v.notify !== false,
          }
        : undefined,
  },
  "shell.welcomed": bool(false),
};

export const PREF_KEYS = Object.keys(SCHEMA) as PrefKey[];
const isKey = (k: string): k is PrefKey => k in SCHEMA;
const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export const PREFS_FORMAT = "aphrody-webos-prefs";
export interface PrefsFile {
  format: typeof PREFS_FORMAT;
  version: 1;
  exported: string;
  prefs: Partial<PrefMap>;
}

type Listener<K extends PrefKey> = (value: PrefMap[K], key: K) => void;
type AnyListener = (value: unknown, key: PrefKey) => void;
type Message = { changes: [PrefKey, unknown][] };

const DB_NAME = "aphrody-webos";
const STORE = "prefs";
const MIGRATED = "$migrated";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("preferences database is blocked by another tab"));
  });
}

/** Values of the legacy localStorage keys, read once into the new store. */
function legacyValues(): [PrefKey, unknown][] {
  const out: [PrefKey, unknown][] = [];
  try {
    const ls = localStorage;
    const theme = ls.getItem("aph.theme");
    const seed = ls.getItem("aph.seed");
    if (theme) out.push(["theme.id", theme]);
    else if (seed) out.push(["theme.id", "seed"]);
    if (seed) out.push(["theme.seed", seed]);
    const mode = ls.getItem("aph.mode");
    if (mode) out.push(["theme.mode", mode]);
    const variant = ls.getItem("aph.variant");
    if (variant) out.push(["theme.variant", variant]);
    const contrast = ls.getItem("aph.contrast");
    if (contrast !== null) out.push(["theme.contrast", Number(contrast)]);
    const sounds = ls.getItem("aph.sounds");
    if (sounds) out.push(["sound.enabled", sounds === "on"]);
    if (ls.getItem("aph.welcome") === "done")
      out.push(["shell.welcomed", true]);
  } catch {
    // Storage blocked: nothing to migrate.
  }
  return out;
}

class PrefStore {
  /** Stored values; a missing key means its default. */
  private values = new Map<PrefKey, unknown>();
  private listeners = new Map<PrefKey | "*", Set<AnyListener>>();
  private db: IDBDatabase | undefined;
  private channel: BroadcastChannel | undefined;
  /** Resolves once stored values are loaded (always resolves, even without IndexedDB). */
  readonly ready: Promise<void>;
  /** False when IndexedDB is unavailable and changes only last for this page. */
  persistent = false;

  constructor() {
    this.ready = this.load();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("aphrody-webos-prefs");
      this.channel.onmessage = (e: MessageEvent<Message>) => {
        for (const [key, value] of e.data?.changes ?? [])
          if (isKey(key)) this.accept(key, value, false);
      };
    }
  }

  private async load() {
    try {
      this.db = await openDb();
      const tx = this.db.transaction(STORE, "readonly").objectStore(STORE);
      const [keys, vals] = await Promise.all([
        request(tx.getAllKeys()),
        request(tx.getAll()),
      ]);
      let migrated = false;
      keys.forEach((k, i) => {
        if (k === MIGRATED) migrated = true;
        else if (typeof k === "string" && isKey(k)) {
          const parsed = SCHEMA[k].parse(vals[i]);
          if (parsed !== undefined) this.values.set(k, parsed);
        }
      });
      this.persistent = true;
      if (!migrated) {
        for (const [k, v] of legacyValues())
          if (!this.values.has(k)) this.accept(k, v, true);
        void this.write([[MIGRATED as PrefKey, true]]);
      }
    } catch {
      // Private browsing or blocked storage: run on defaults plus legacy values for this page.
      for (const [k, v] of legacyValues()) this.accept(k, v, false);
    }
  }

  private async write(changes: [PrefKey, unknown][]) {
    if (!this.db) return;
    const tx = this.db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [k, v] of changes) {
      if (v === undefined) store.delete(k);
      else store.put(v, k);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Validate and store a value; returns the stored change, or undefined when nothing changed. */
  private accept(
    key: PrefKey,
    value: unknown,
    persist: boolean,
  ): [PrefKey, unknown] | undefined {
    const spec = SCHEMA[key] as Spec<unknown>;
    const parsed = value === undefined ? spec.default : spec.parse(value);
    if (parsed === undefined || same(parsed, this.get(key))) return undefined;
    // Defaults are not stored, so exports stay small and new defaults reach existing users.
    const stored = same(parsed, spec.default) ? undefined : parsed;
    if (stored === undefined) this.values.delete(key);
    else this.values.set(key, stored);
    if (persist) void this.write([[key, stored]]);
    this.notify(key);
    return [key, stored];
  }

  private notify(key: PrefKey) {
    const value = this.get(key);
    for (const fn of this.listeners.get(key) ?? []) fn(value, key);
    for (const fn of this.listeners.get("*") ?? []) fn(value, key);
  }

  get<K extends PrefKey>(key: K): PrefMap[K] {
    return (
      this.values.has(key) ? this.values.get(key) : SCHEMA[key].default
    ) as PrefMap[K];
  }

  /** The default of a key. */
  defaultOf<K extends PrefKey>(key: K): PrefMap[K] {
    return SCHEMA[key].default;
  }

  /** True when the key holds its default. */
  isDefault(key: PrefKey): boolean {
    return !this.values.has(key);
  }

  set<K extends PrefKey>(key: K, value: PrefMap[K]): boolean {
    return this.setMany([[key, value]]) > 0;
  }

  /** Apply several values at once (one write, one broadcast); returns how many changed. */
  setMany(entries: [PrefKey, unknown][]): number {
    const changes = entries.flatMap(([k, v]) => {
      if (!isKey(k)) return [];
      const c = this.accept(k, v, false);
      return c ? [c] : [];
    });
    if (changes.length) {
      void this.write(changes);
      this.channel?.postMessage({ changes } satisfies Message);
    }
    return changes.length;
  }

  /** Back to the default: one key, or every key. */
  reset(key?: PrefKey) {
    this.setMany(
      (key ? [key] : PREF_KEYS)
        .filter((k) => k !== "shell.welcomed" || key)
        .map((k) => [k, undefined]),
    );
  }

  subscribe<K extends PrefKey>(key: K, fn: Listener<K>): () => void;
  subscribe(key: "*", fn: AnyListener): () => void;
  subscribe(key: PrefKey | "*", fn: AnyListener): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Every non-default value as a JSON document. */
  export(): PrefsFile {
    return {
      format: PREFS_FORMAT,
      version: 1,
      exported: new Date().toISOString(),
      prefs: Object.fromEntries(this.values) as Partial<PrefMap>,
    };
  }

  /** Replace every preference from an exported document; unknown or invalid keys are skipped. */
  import(data: unknown): { applied: number; skipped: string[] } {
    if (
      !isObject(data) ||
      data.format !== PREFS_FORMAT ||
      !isObject(data.prefs)
    )
      throw new TypeError("This file is not a Bun OS settings export.");
    const incoming = data.prefs;
    const skipped = Object.keys(incoming).filter(
      (k) => !isKey(k) || SCHEMA[k].parse(incoming[k]) === undefined,
    );
    const applied = this.setMany(
      PREF_KEYS.map((k) => [k, k in incoming ? incoming[k] : undefined]),
    );
    return { applied, skipped };
  }
}

export const prefs = new PrefStore();

/** The file kind of a name, by extension. */
export function fileTypeOf(name: string): FileTypeId | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_TYPES.find((t) => (t.exts as readonly string[]).includes(ext))
    ?.id;
}

/** The launch id chosen in Settings to open a file, if its kind is known. */
export function defaultAppFor(name: string): string | undefined {
  const kind = fileTypeOf(name);
  return kind ? prefs.get("files.openWith")[kind] : undefined;
}
