/**
 * Theme Provider Component
 *
 * Resolves the selected seed, the light/dark mode and the contrast preference, asks the scheme
 * worker for the engine's roles and writes them as `--md-sys-color-*` / `--md-ext-color-*` on the
 * document root, over the baseline roles of @aphrody/m3-theme/tokens.css.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SchemeReply, SchemeRequest } from "./scheme.worker";
import { BUILT_IN_THEMES, CUSTOM_VARIANTS, DEFAULT_CUSTOM_SEED, getDefaultTheme, getThemeById } from "./themes";
import {
  CUSTOM_THEME_STORAGE_KEY,
  SCHEME_CACHE_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type SchemeProperties,
  type SchemeSeed,
  type Theme,
  type ThemeId,
  type ThemeMode,
} from "./types";

interface ThemeContextValue {
  currentTheme: Theme;
  themeId: ThemeId;
  mode: ThemeMode;
  customSeed: SchemeSeed;
  setTheme: (id: ThemeId) => void;
  setMode: (mode: ThemeMode) => void;
  updateCustomSeed: (seed: Partial<SchemeSeed>) => void;
  resetCustomSeed: () => void;
  availableThemes: Theme[];
  /** Set when the engine rejected the last request; the previous scheme stays applied. */
  schemeError: string | null;
}

interface DerivedSchemes {
  key: string;
  light: SchemeProperties;
  dark: SchemeProperties;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then lasts for the session.
  }
}

function loadThemeId(): ThemeId {
  const stored = readStorage(THEME_STORAGE_KEY);
  if (stored === "custom" || (stored && getThemeById(stored))) return stored as ThemeId;
  return getDefaultTheme().id;
}

function loadMode(): ThemeMode {
  const stored = readStorage(THEME_MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function isSchemeSeed(value: unknown): value is SchemeSeed {
  if (!value || typeof value !== "object") return false;
  const { seed, variant, contrastLevel } = value as Record<string, unknown>;
  return (
    typeof seed === "string" &&
    /^#[\da-f]{6}$/i.test(seed) &&
    CUSTOM_VARIANTS.includes(variant as SchemeSeed["variant"]) &&
    typeof contrastLevel === "number" &&
    contrastLevel >= 0 &&
    contrastLevel <= 1
  );
}

function loadCustomSeed(): SchemeSeed {
  const stored = readStorage(CUSTOM_THEME_STORAGE_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (isSchemeSeed(parsed)) return parsed;
    } catch {
      // A value written by an older version: start from the default seed.
    }
  }
  return { ...DEFAULT_CUSTOM_SEED };
}

function schemeKey({ seed, variant, contrastLevel }: SchemeSeed): string {
  return `${seed.toLowerCase()}|${variant}|${contrastLevel}`;
}

/** Last engine output, so the next start paints the chosen scheme before the worker answers. */
function loadCachedSchemes(): DerivedSchemes | null {
  const stored = readStorage(SCHEME_CACHE_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as DerivedSchemes;
    return typeof parsed.key === "string" && parsed.light && parsed.dark ? parsed : null;
  } catch {
    return null;
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(loadThemeId);
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [customSeed, setCustomSeed] = useState<SchemeSeed>(loadCustomSeed);
  const [schemes, setSchemes] = useState<DerivedSchemes | null>(loadCachedSchemes);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const prefersMoreContrast = useMediaQuery("(prefers-contrast: more)");

  const customTheme: Theme = useMemo(
    () => ({ id: "custom", name: "Custom", description: "Your personalized color scheme", ...customSeed }),
    [customSeed],
  );
  const currentTheme: Theme = themeId === "custom" ? customTheme : (getThemeById(themeId) ?? getDefaultTheme());

  // The OS "increase contrast" setting raises the level to high; it never lowers a chosen level.
  const request: SchemeSeed = {
    seed: currentTheme.seed,
    variant: currentTheme.variant,
    contrastLevel: prefersMoreContrast ? Math.max(currentTheme.contrastLevel, 1) : currentTheme.contrastLevel,
  };
  const key = schemeKey(request);
  const dark = mode === "dark" || (mode === "system" && prefersDark);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (schemes?.key === key) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./scheme.worker.ts", import.meta.url), { type: "module" });
    }
    const worker = workerRef.current;
    const id = ++requestIdRef.current;
    const onMessage = (event: MessageEvent<SchemeReply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      worker.removeEventListener("message", onMessage);
      if (!reply.ok) {
        setSchemeError(reply.error);
        return;
      }
      const derived = { key, light: reply.light, dark: reply.dark };
      setSchemeError(null);
      setSchemes(derived);
      writeStorage(SCHEME_CACHE_STORAGE_KEY, JSON.stringify(derived));
    };
    worker.addEventListener("message", onMessage);
    const message: SchemeRequest = { id, ...request };
    worker.postMessage(message);
    return () => worker.removeEventListener("message", onMessage);
    // `request` is fully described by `key`.
  }, [key, schemes?.key]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = dark ? "dark" : "light";
    root.dataset.theme = dark ? "dark" : "light";
    if (!schemes) return;
    for (const [name, value] of Object.entries(dark ? schemes.dark : schemes.light)) {
      root.style.setProperty(name, value);
    }
  }, [schemes, dark]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    writeStorage(THEME_STORAGE_KEY, id);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStorage(THEME_MODE_STORAGE_KEY, next);
  }, []);

  const updateCustomSeed = useCallback((patch: Partial<SchemeSeed>) => {
    setCustomSeed((previous) => {
      const updated = { ...previous, ...patch };
      if (!isSchemeSeed(updated)) return previous;
      writeStorage(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetCustomSeed = useCallback(() => {
    const reset = { ...DEFAULT_CUSTOM_SEED };
    setCustomSeed(reset);
    writeStorage(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(reset));
  }, []);

  const availableThemes: Theme[] = useMemo(() => [...BUILT_IN_THEMES, customTheme], [customTheme]);

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        themeId,
        mode,
        customSeed,
        setTheme,
        setMode,
        updateCustomSeed,
        resetCustomSeed,
        availableThemes,
        schemeError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
