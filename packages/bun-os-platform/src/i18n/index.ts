// SPDX-License-Identifier: Apache-2.0
/**
 * Catalog loading and locale negotiation for Bun hosts (play server, bun-engine CLI, sidecar).
 * Order of precedence: explicit override (settings / query / cookie) > OS UI languages
 * (Windows GetUserPreferredUILanguages, POSIX LANGUAGE/LC_ALL/LC_MESSAGES/LANG) or the
 * Accept-Language header > `en`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { platformPaths, readSettings } from "../paths";
import { type CatalogSources, fallbackChain, type LocaleInfo, Localizer, lookupLocale } from "./localizer";

export * from "./fluent";
export * from "./localizer";

export const DEFAULT_LOCALE = "en";

/** Accept-Language ranges with their q-values, best first (stable for equal q). */
function parseAcceptLanguage(header: string): { range: string; quality: number }[] {
  return header
    .split(",")
    .map((part, index) => {
      const [range = "", ...params] = part.trim().split(";");
      const q = params.map(p => /^s*qs*=s*([0-9.]+)s*$/i.exec(p)?.[1]).find(Boolean);
      const quality = q === undefined ? 1 : Number(q);
      return { range: range.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(p => p.range)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map(({ range, quality }) => ({ range, quality }));
}

/** Declared locales (`locales/locales.json`), plus locales contributed by plugins. */
export function locales(extra: LocaleInfo[] = []): LocaleInfo[] {
  const file = join(platformPaths().baseLocales, "locales.json");
  const base = JSON.parse(readFileSync(file, "utf8")).locales as LocaleInfo[];
  const out = [...base];
  for (const info of extra) if (!out.some(l => l.tag === info.tag)) out.push(info);
  return out;
}

function ftlFiles(dir: string, domains?: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".ftl") && (!domains || domains.includes(f.slice(0, -4))))
    .sort()
    .map(f => readFileSync(join(dir, f), "utf8"));
}

/** Extra `.ftl` sources by locale (plugins); appended after base and usr catalogs. */
const contributed: CatalogSources = {};
export function contributeCatalog(tag: string, source: string): void {
  (contributed[tag] ??= []).push(source);
}

/** Sources for one locale: base catalogs, then `usr/share/bun-os/locale`, then plugins. */
export function catalogSources(tag: string, domains?: readonly string[]): string[] {
  const paths = platformPaths();
  return [
    ...ftlFiles(join(paths.baseLocales, tag), domains),
    ...ftlFiles(join(paths.locales, tag), domains),
    ...(contributed[tag] ?? []),
  ];
}

/** OS UI languages, most preferred first. */
export function osLocales(): string[] {
  if (process.platform === "win32") {
    try {
      const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
      const kernel32 = dlopen("kernel32.dll", {
        GetUserPreferredUILanguages: {
          args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.bool,
        },
      }).symbols;
      const MUI_LANGUAGE_NAME = 0x8;
      const count = new Uint32Array(1);
      const size = new Uint32Array(1);
      if (kernel32.GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, ptr(count), null, ptr(size)) && size[0]) {
        const buffer = new Uint16Array(size[0]);
        if (kernel32.GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, ptr(count), ptr(buffer), ptr(size)))
          return String.fromCharCode(...buffer)
            .split("\0")
            .filter(Boolean);
      }
    } catch {
      /* fall through to the environment */
    }
  }
  const env = Bun.env;
  const raw = env.LANGUAGE?.split(":") ?? [env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? ""];
  return raw
    .map(v => v.replace(/\..*$/, "").replace(/@.*$/, "").replace(/_/g, "-"))
    .filter(v => v && v !== "C" && v !== "POSIX");
}

export interface NegotiateInput {
  /** Explicit choice (settings, `?lang=`, cookie). */
  override?: string | null;
  /** Accept-Language header (web). */
  acceptLanguage?: string | null;
  /** Use the OS languages (native hosts). */
  os?: boolean;
}

export interface Negotiated {
  locale: string;
  chain: string[];
  source: "override" | "accept-language" | "os" | "default";
  direction: "ltr" | "rtl";
}

export function negotiate(input: NegotiateInput, available: LocaleInfo[] = locales()): Negotiated {
  const tags = available.map(l => l.tag);
  const pick = (source: Negotiated["source"], requested: string[]): Negotiated | null => {
    const locale = lookupLocale(requested, tags);
    if (!locale) return null;
    const direction = available.find(l => l.tag === locale)?.direction ?? "ltr";
    return {
      locale,
      chain: fallbackChain(locale, available, DEFAULT_LOCALE),
      source,
      direction,
    };
  };
  return (
    (input.override ? pick("override", [input.override]) : null) ??
    (input.acceptLanguage
      ? pick(
          "accept-language",
          parseAcceptLanguage(input.acceptLanguage)
            .filter(p => p.range !== "*" && p.quality > 0)
            .map(p => p.range),
        )
      : null) ??
    (input.os ? pick("os", osLocales()) : null) ?? {
      locale: DEFAULT_LOCALE,
      chain: [DEFAULT_LOCALE],
      source: "default",
      direction: "ltr",
    }
  );
}

/** A localizer for the negotiated chain over the given catalog domains. */
export function localizer(chain: string[], domains?: readonly string[]): Localizer {
  const sources: CatalogSources = {};
  for (const tag of chain) sources[tag] = catalogSources(tag, domains);
  return new Localizer(chain, sources);
}

/** Native hosts: settings override, then the OS languages. */
export async function systemLocalizer(
  domains?: readonly string[],
): Promise<{ negotiated: Negotiated; l10n: Localizer }> {
  const settings = await readSettings();
  const negotiated = negotiate({
    override: Bun.env.BUN_OS_LOCALE ?? settings.locale,
    os: true,
  });
  return { negotiated, l10n: localizer(negotiated.chain, domains) };
}
