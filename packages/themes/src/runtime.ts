// Theme runtime for web apps, Tauri webviews and the webos shell: one selection {theme, scheme, accent, transparency}
// applied as attributes on <html>, persisted, and synchronised live across every running app through
// BroadcastChannel (same origin), the Tauri event bus (all webview windows) and an optional HTTP bridge
// (native apps watch the same selection file with aphrody-themes::config).
import { COLORS, META, THEME_IDS, type Scheme, type ThemeId } from "./generated.ts";

export const STORAGE_KEY = "aphrody.theme";
export const CHANNEL = "aphrody-theme";
export const TAURI_EVENT = "aphrody://theme";

export interface Selection {
  theme: ThemeId;
  scheme: "auto" | Scheme;
  accent: string;
  /** Liquid Glass slider: 0 ultra clear .. 1 fully tinted. null keeps the theme default. */
  transparency: number | null;
}
export const DEFAULT_SELECTION: Selection = {
  theme: "m3",
  scheme: "auto",
  accent: META.m3.defaultAccent,
  transparency: null,
};

/** Coerces untrusted input (storage, events, files) into a valid selection. */
export function normalize(input: unknown, fallback: Selection = DEFAULT_SELECTION): Selection {
  const o = (typeof input === "object" && input ? input : {}) as Record<string, unknown>;
  const theme = (THEME_IDS as readonly unknown[]).includes(o.theme) ? (o.theme as ThemeId) : fallback.theme;
  const scheme = o.scheme === "light" || o.scheme === "dark" || o.scheme === "auto" ? o.scheme : fallback.scheme;
  const accents = META[theme].accents;
  const accent =
    typeof o.accent === "string" && accents.includes(o.accent)
      ? o.accent
      : theme === fallback.theme && accents.includes(fallback.accent)
        ? fallback.accent
        : META[theme].defaultAccent;
  const t =
    typeof o.transparency === "number" && Number.isFinite(o.transparency)
      ? Math.min(1, Math.max(0, o.transparency))
      : o.transparency === null
        ? null
        : fallback.transparency;
  return { theme, scheme, accent, transparency: t };
}

export const resolveScheme = (s: Selection, systemDark: boolean): Scheme =>
  s.scheme === "auto" ? (systemDark ? "dark" : "light") : s.scheme;

/** Glass opacity for the slider: 0 -> 0.04 (ultra clear) .. 1 -> 1 (fully tinted). */
const glassOpacity = (t: number) => Math.round((0.04 + 0.96 * t) * 1000) / 1000;

export function applyTheme(sel: Selection, systemDark: boolean, root: HTMLElement = document.documentElement): Scheme {
  const scheme = resolveScheme(sel, systemDark);
  const meta = META[sel.theme];
  root.dataset.skin = sel.theme;
  root.dataset.scheme = scheme;
  if (sel.accent === meta.defaultAccent) delete root.dataset.accent;
  else root.dataset.accent = sel.accent;
  root.dataset.controls = meta.controls;
  root.style.colorScheme = scheme;
  if (sel.transparency === null) root.style.removeProperty("--t-glass-opacity");
  else root.style.setProperty("--t-glass-opacity", String(glassOpacity(sel.transparency)));
  const doc = root.ownerDocument;
  const color = COLORS[sel.theme][scheme][sel.accent]?.bg;
  if (doc && color) {
    let m = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!m) {
      m = doc.createElement("meta");
      m.name = "theme-color";
      doc.head.appendChild(m);
    }
    m.content = color.slice(0, 7);
  }
  return scheme;
}

export interface TauriBridge {
  emit(event: string, payload: unknown): unknown;
  listen(event: string, cb: (e: { payload: unknown }) => void): unknown;
}
export interface ControllerOptions {
  root?: HTMLElement;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Defaults to window.__TAURI__.event when present. */
  tauri?: TauriBridge | null;
  /** POST target receiving the JSON selection (webos server, or a native bridge). */
  endpoint?: string | null;
  media?: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
  channel?: string;
}
export interface ThemeController {
  get(): Selection;
  set(patch: Partial<Selection>): Selection;
  subscribe(fn: (s: Selection, scheme: Scheme) => void): () => void;
  dispose(): void;
}

const NO_MEDIA = {
  matches: false,
  addEventListener() {},
  removeEventListener() {},
};

export function createThemeController(opts: ControllerOptions = {}): ThemeController {
  const root = opts.root ?? document.documentElement;
  const storage =
    opts.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : opts.storage;
  const media =
    opts.media ?? (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : NO_MEDIA);
  const tauri =
    opts.tauri === undefined
      ? ((globalThis as { __TAURI__?: { event?: TauriBridge } }).__TAURI__?.event ?? null)
      : opts.tauri;
  const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel(opts.channel ?? CHANNEL) : null;
  const subs = new Set<(s: Selection, scheme: Scheme) => void>();
  let sel = normalize(safeParse(storage?.getItem(STORAGE_KEY)));
  let scheme: Scheme = applyTheme(sel, media.matches, root);
  const apply = () => {
    scheme = applyTheme(sel, media.matches, root);
    for (const f of subs) f(sel, scheme);
  };
  const remote = (payload: unknown) => {
    const next = normalize(payload, sel);
    if (JSON.stringify(next) === JSON.stringify(sel)) return;
    sel = next;
    storage?.setItem(STORAGE_KEY, JSON.stringify(sel));
    apply();
  };
  const onMsg = (e: MessageEvent) => remote(e.data);
  bc?.addEventListener("message", onMsg);
  const onMedia = () => {
    if (sel.scheme === "auto") apply();
  };
  media.addEventListener("change", onMedia);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) remote(safeParse(e.newValue));
  };
  if (typeof addEventListener === "function") addEventListener("storage", onStorage as EventListener);
  tauri?.listen(TAURI_EVENT, e => remote(e.payload));
  apply();
  return {
    get: () => sel,
    set(patch) {
      // a new theme starts on its own default accent unless the patch names one
      const next =
        patch.theme && patch.theme !== sel.theme && patch.accent === undefined
          ? { ...sel, ...patch, accent: "" }
          : { ...sel, ...patch };
      sel = normalize(next, sel);
      storage?.setItem(STORAGE_KEY, JSON.stringify(sel));
      apply();
      bc?.postMessage(sel);
      tauri?.emit(TAURI_EVENT, sel);
      if (opts.endpoint) {
        void fetch(opts.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sel),
        }).catch(() => {});
      }
      return sel;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    dispose() {
      bc?.removeEventListener("message", onMsg);
      bc?.close();
      media.removeEventListener("change", onMedia);
      if (typeof removeEventListener === "function") removeEventListener("storage", onStorage as EventListener);
    },
  };
}

function safeParse(s: string | null | undefined): unknown {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Inline <head> script: applies the stored selection before first paint (no flash). */
export function bootScript(): string {
  const defaults = JSON.stringify(
    Object.fromEntries(THEME_IDS.map(t => [t, [META[t].defaultAccent, META[t].controls]])),
  );
  return `(function(){try{var d=${defaults},s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"{}"),t=d[s.theme]?s.theme:${JSON.stringify(DEFAULT_SELECTION.theme)},sc=s.scheme==="light"||s.scheme==="dark"?s.scheme:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),r=document.documentElement;r.dataset.skin=t;r.dataset.scheme=sc;r.dataset.controls=d[t][1];if(s.accent&&s.accent!==d[t][0])r.dataset.accent=s.accent;r.style.colorScheme=sc}catch(e){}})();`;
}
