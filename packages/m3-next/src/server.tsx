// SPDX-License-Identifier: Apache-2.0
// Server side of @aphrody/m3-next: the App Router root components and the m3Css sheet helper.
// Import this entry only from Server Components, route handlers or next.config (it reads files
// and request cookies).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { HTMLAttributes, ReactNode } from "react";
import { cookies } from "next/headers";
import { M3NextThemeProvider } from "@aphrody/m3-next/client";
import {
  M3_BASELINE_SEED,
  M3_THEME_COOKIE,
  colorSchemeFor,
  colorSchemeScript,
  m3SchemeColors,
  m3SchemeStylesheet,
  m3TypefaceCss,
  parseThemeMode,
  rootDeclarations,
  type M3SchemeOptions,
  type M3ThemeMode,
  type M3Typefaces,
} from "./index";

export * from "./index";

/** A sheet `m3Css` can render. */
export type M3SheetName = "tokens" | "tailwind" | "spaceui" | "scheme";

export interface M3CssRequest extends M3SchemeOptions {
  sheet: M3SheetName;
  /** Dark mode, for the single-mode `scheme` sheet. */
  dark?: boolean;
}

/** Where a sheet came from: Rust through `bun:ffi`, the pre-generated file, or JS (`scheme`). */
export type M3CssSource = "ffi" | "static" | "js";

export interface M3CssResult {
  css: string;
  source: M3CssSource;
}

export interface M3CssOptions {
  /**
   * Directory to resolve `@aphrody/m3-next` from (default: the process working directory, which
   * is the app root under `next dev|build|start`, then this module's own location).
   */
  root?: string;
  /** Never load the native library, even under Bun (default `false`). */
  noFfi?: boolean;
}

interface BunM3Module {
  m3Css(request: { sheet: string; seed?: string; variant?: string; dark?: boolean; contrast?: number }): string;
}

const STATIC_SHEETS: Record<Exclude<M3SheetName, "scheme">, string> = {
  tokens: "@aphrody/m3-theme/tokens.css",
  tailwind: "@aphrody/m3-theme/tailwind.css",
  spaceui: "@aphrody/m3-theme/spaceui.css",
};

/** `true` when this process runs on Bun (`bun --bun next ...`, `bun test`). */
export function isBunRuntime(): boolean {
  return typeof process !== "undefined" && typeof process.versions?.bun === "string";
}

/** A `require` rooted at the installed `@aphrody/m3-next`, so its own dependencies resolve. */
function packageRequire(root?: string): NodeRequire {
  const bases = [root, typeof process !== "undefined" ? process.cwd() : undefined].filter(
    (base): base is string => typeof base === "string",
  );
  for (const base of bases) {
    try {
      const manifest = createRequire(join(base, "package.json")).resolve("@aphrody/m3-next/package.json");
      return createRequire(manifest);
    } catch {
      // Not installed under this base: try the next one.
    }
  }
  return createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
}

let bunModule: Promise<BunM3Module | null> | undefined;
let bunModuleError: unknown;

/** Load `@aphrody/bun` at runtime (never bundled), or `null` off Bun or without the library. */
function loadBunModule(root?: string): Promise<BunM3Module | null> {
  if (!isBunRuntime()) return Promise.resolve(null);
  bunModule ??= (async () => {
    try {
      const entry = packageRequire(root).resolve("@aphrody/bun");
      const specifier = pathToFileURL(entry).href;
      const loaded = (await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ specifier)) as BunM3Module;
      return typeof loaded.m3Css === "function" ? loaded : null;
    } catch (error) {
      bunModuleError = error;
      return null;
    }
  })();
  return bunModule;
}

/** Why the native path is unavailable (after a failed load), for diagnostics pages and logs. */
export function m3FfiError(): unknown {
  return bunModuleError;
}

function kebabVariant(variant: string): string {
  return variant.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

const cache = new Map<string, M3CssResult>();
const CACHE_LIMIT = 64;

function remember(key: string, result: M3CssResult): M3CssResult {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/**
 * Render an M3 sheet on the server. Under Bun (`bun --bun next ...`) it calls the Rust renderer
 * of `@aphrody/bun` (`crates/aphrody-m3-tokens/src/sheets.rs`), which honours every option.
 * Under Node, where `bun:ffi` does not exist, `tokens` / `tailwind` / `spaceui` come from the
 * pre-generated files of `@aphrody/m3-theme` (baseline seed) and `scheme` is computed in JS with
 * material-color-utilities. Results are cached per request shape.
 */
export async function m3CssResult(request: M3CssRequest, options: M3CssOptions = {}): Promise<M3CssResult> {
  const { sheet, seed = M3_BASELINE_SEED, variant = "tonalSpot", contrast = 0, dark = false } = request;
  const key = JSON.stringify([sheet, seed.toLowerCase(), variant, contrast, dark, options.noFfi === true]);
  const hit = cache.get(key);
  if (hit) return hit;

  const native = options.noFfi ? null : await loadBunModule(options.root);
  if (native) {
    const css = native.m3Css({
      sheet,
      seed,
      variant: kebabVariant(variant),
      dark,
      contrast,
    });
    return remember(key, { css, source: "ffi" });
  }
  if (sheet === "scheme") {
    const vars = m3SchemeColors({ seed, variant, contrast, dark });
    const body = Object.entries(vars)
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n");
    const mode = dark ? "dark" : "light";
    const css = `/* M3 ${variant} scheme, ${mode}, seed ${seed} (material-color-utilities). */\n:root {\n  color-scheme: ${mode};\n${body}\n}\n`;
    return remember(key, { css, source: "js" });
  }
  const file = STATIC_SHEETS[sheet];
  if (!file) throw new Error(`m3Css: unknown sheet ${String(sheet)}`);
  const css = readFileSync(packageRequire(options.root).resolve(file), "utf8");
  return remember(key, { css, source: "static" });
}

/** {@link m3CssResult}, returning only the CSS text. */
export async function m3Css(request: M3CssRequest, options: M3CssOptions = {}): Promise<string> {
  return (await m3CssResult(request, options)).css;
}

/**
 * The inline stylesheet of M3Html: the light and dark roles of one scheme, wired to the
 * `.light` / `.dark` classes and `prefers-color-scheme` (see `m3SchemeStylesheet`).
 */
export async function m3SchemeCss(scheme: M3SchemeOptions = {}, options: M3CssOptions = {}): Promise<M3CssResult> {
  const [light, dark] = await Promise.all([
    m3CssResult({ ...scheme, sheet: "scheme", dark: false }, options),
    m3CssResult({ ...scheme, sheet: "scheme", dark: true }, options),
  ]);
  return {
    css: m3SchemeStylesheet(rootDeclarations(light.css), rootDeclarations(dark.css)),
    source: light.source,
  };
}

/** Read the theme preference from the request cookies (Server Components, route handlers). */
export async function readM3ThemeMode(
  cookieName: string = M3_THEME_COOKIE,
  fallback: M3ThemeMode = "system",
): Promise<M3ThemeMode> {
  const jar = await cookies();
  return parseThemeMode(jar.get(cookieName)?.value, fallback);
}

export interface M3DocumentProps {
  /** Resolved theme mode: `light` / `dark` set the class and `color-scheme`, `system` defers to the OS. */
  mode: M3ThemeMode;
  children?: ReactNode;
  lang?: string;
  className?: string;
  bodyClassName?: string;
  /** Inline scheme stylesheet (from {@link m3SchemeCss}); omitted when undefined. */
  schemeCss?: string;
  /** Inline `:root` rule from {@link m3TypefaceCss}; omitted when undefined or empty. */
  typefaceCss?: string;
  /** Cookie the pre-paint script reads in `system` mode (default `m3-theme`). */
  cookieName?: string;
  /** Extra `<head>` children. */
  head?: ReactNode;
  /** Extra attributes for `<html>`. */
  htmlProps?: Omit<HTMLAttributes<HTMLHtmlElement>, "className" | "lang" | "style" | "children">;
}

/**
 * The synchronous document shell: `<html>` with the mode class, `color-scheme` and
 * `data-m3-theme`, the inline scheme sheet, the pre-paint script in `system` mode, `<body>`.
 */
export function M3Document({
  mode,
  children,
  lang = "en",
  className,
  bodyClassName,
  schemeCss,
  typefaceCss,
  cookieName,
  head,
  htmlProps,
}: M3DocumentProps) {
  const classes = [className, mode === "system" ? undefined : mode].filter(Boolean).join(" ");
  return (
    <html
      {...htmlProps}
      lang={lang}
      className={classes || undefined}
      style={{ colorScheme: colorSchemeFor(mode) }}
      data-m3-theme={mode}
      // The pre-paint script and the client provider adjust the class and style on <html>.
      suppressHydrationWarning
    >
      <head>
        {schemeCss !== undefined ? <style id="m3-scheme" dangerouslySetInnerHTML={{ __html: schemeCss }} /> : null}
        {typefaceCss ? <style id="m3-typefaces" dangerouslySetInnerHTML={{ __html: typefaceCss }} /> : null}
        {mode === "system" ? (
          <script id="m3-color-scheme" dangerouslySetInnerHTML={{ __html: colorSchemeScript(cookieName) }} />
        ) : null}
        {head}
      </head>
      <body className={bodyClassName}>{children}</body>
    </html>
  );
}

export interface M3HtmlProps extends Omit<M3DocumentProps, "mode" | "schemeCss">, M3SchemeOptions {
  /** Force a mode instead of reading the cookie. */
  mode?: M3ThemeMode;
  /** Mode when the cookie is absent or invalid (default `system`). */
  defaultMode?: M3ThemeMode;
  /**
   * Read the theme cookie on the server (default `true`). `false` keeps the shell static, as Cache Components and a
   * static export require: the pre-paint script and the client provider apply the saved preference in the browser.
   * Always `false` when `NEXT_PUBLIC_M3_STATIC=1` (`withM3(config, { tauri: true })`).
   */
  readCookie?: boolean;
  /** Cookie holding the preference (default `m3-theme`). */
  cookieName?: string;
  /** Inline the scheme roles into `<head>` (default `true`). */
  inlineScheme?: boolean;
  /** Point the M3 reference typefaces at fonts the app loads (see {@link m3TypefaceCss}). */
  typefaces?: M3Typefaces;
  /** Options for the sheet renderer. */
  css?: M3CssOptions;
}

async function resolveDocument(props: M3HtmlProps): Promise<M3DocumentProps> {
  const {
    mode,
    defaultMode = "system",
    readCookie = process.env.NEXT_PUBLIC_M3_STATIC !== "1",
    cookieName = M3_THEME_COOKIE,
    inlineScheme = true,
    typefaces,
    seed,
    variant,
    contrast,
    css,
    ...document
  } = props;
  const resolved = mode ?? (readCookie ? await readM3ThemeMode(cookieName, defaultMode) : defaultMode);
  const schemeCss = inlineScheme ? (await m3SchemeCss({ seed, variant, contrast }, css)).css : undefined;
  const typefaceCss = typefaces ? m3TypefaceCss(typefaces) : undefined;
  return { ...document, mode: resolved, schemeCss, typefaceCss, cookieName };
}

/**
 * Root layout `<html>` for the App Router (async Server Component): reads the theme cookie,
 * sets the dark / light class and `color-scheme`, and inlines the scheme's M3 colour roles so
 * the first HTML byte is already themed. The static M3 sheets come from
 * `@aphrody/m3-next/m3.css` in the app's global stylesheet.
 */
export async function M3Html(props: M3HtmlProps) {
  return <M3Document {...await resolveDocument(props)} />;
}

/**
 * {@link M3Html} plus the client theme provider: children can call `useM3Theme()` and the
 * preference is written back to the cookie on every change.
 */
export async function M3Root(props: M3HtmlProps) {
  const { children, seed, variant, contrast, cookieName = M3_THEME_COOKIE, inlineScheme = true } = props;
  const document = await resolveDocument(props);
  return (
    <M3Document {...document}>
      <M3NextThemeProvider
        initialMode={document.mode}
        seed={seed}
        variant={variant}
        contrast={contrast}
        cookieName={cookieName}
        schemeInlined={inlineScheme}
      >
        {children}
      </M3NextThemeProvider>
    </M3Document>
  );
}
