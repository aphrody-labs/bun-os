// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical i18n runtime and contract for Aphrody Desktop UI (@aphrody/m3).
 *
 * Provides type-safe, zero-hardcoding bilingual localization (EN/FR)
 * mapped to the real Aphrody OS backend capabilities (FFI, CLI, App-Server,
 * OS Kernel, Drive, Koharu, Shell).
 */
import enCatalog from "./locales/en.json";
import frCatalog from "./locales/fr.json";

export type SupportedLocale = "en" | "fr";
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["en", "fr"] as const;

export type I18nSchema = typeof enCatalog;

export type Leaves<T> = T extends object
  ? {
      [K in keyof T]: `${Exclude<K, symbol>}${Leaves<T[K]> extends never ? "" : `.${Leaves<T[K]>}`}`;
    }[keyof T]
  : never;

export type I18nKey = Leaves<I18nSchema>;

export const CATALOGS: Record<SupportedLocale, I18nSchema> = {
  en: enCatalog,
  fr: frCatalog,
};

let currentLocale: SupportedLocale = "en";
const listeners = new Set<(locale: SupportedLocale) => void>();

/** Detect default locale from navigator or system environment. */
export function detectLocale(): SupportedLocale {
  if (typeof navigator !== "undefined" && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("fr")) return "fr";
  }
  if (typeof process !== "undefined" && process.env) {
    const lang = (process.env.LANG || process.env.LC_ALL || "").toLowerCase();
    if (lang.startsWith("fr")) return "fr";
  }
  return "en";
}

/** Get the currently active display locale. */
export function getLocale(): SupportedLocale {
  return currentLocale;
}

/** Set the active display locale and notify subscribers. */
export function setLocale(locale: SupportedLocale): void {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  if (currentLocale !== locale) {
    currentLocale = locale;
    listeners.forEach(fn => fn(locale));
  }
}

/** Subscribe to locale changes. */
export function onLocaleChange(fn: (locale: SupportedLocale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get the raw structured catalog for a given locale. */
export function getCatalog(locale: SupportedLocale = currentLocale): I18nSchema {
  return CATALOGS[locale] || CATALOGS.en;
}

/**
 * Type-safe translation lookup function.
 *
 * @param key - Dot-separated key, e.g. "nav.chat" or "common.save"
 * @param params - Optional interpolation parameters { key: value }
 * @param locale - Optional override locale (defaults to active locale)
 */
export function t(
  key: I18nKey,
  params?: Record<string, string | number>,
  locale: SupportedLocale = currentLocale,
): string {
  const parts = key.split(".");
  let node: unknown = getCatalog(locale);

  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      // Fallback to English catalog
      let fallbackNode: unknown = CATALOGS.en;
      for (const p of parts) {
        if (fallbackNode && typeof fallbackNode === "object" && p in (fallbackNode as Record<string, unknown>)) {
          fallbackNode = (fallbackNode as Record<string, unknown>)[p];
        } else {
          return key;
        }
      }
      node = fallbackNode;
      break;
    }
  }

  if (typeof node !== "string") return key;

  if (params) {
    return Object.entries(params).reduce((str, [k, v]) => {
      return str.replaceAll(`{${k}}`, String(v));
    }, node);
  }

  return node;
}
