// SPDX-License-Identifier: Apache-2.0
// Runtime theme application. Colours always come from the Rust owner (`crates/aphrody-m3-tokens`):
// the page's compiled sheets (`m3:theme.css`, `tokens.css`, a brand sheet) carry the build-time
// theme, and a different seed, variant or contrast is a Rust `scheme` sheet installed as a
// stylesheet. Nothing here computes a colour or writes a colour role inline, so the Rust
// `@media (prefers-contrast: more)` blocks keep their effect.

export { M3_PLATFORM_CONTRACT, platformState } from "@aphrody/m3-tokens/platform-contract";
export type { M3PlatformState } from "@aphrody/m3-tokens/platform-contract";
export { M3_UI_CATALOG, resolveM3Layer } from "./catalog";
export type { M3UiLayer } from "./catalog";
export { GEMINI_BRAND_COLORS, GEMINI_BRAND_GRADIENTS, GEMINI_BRAND_SHAPES, getGeminiBrandCss } from "./brand";

/** Scheme variant names, all provided by the Rust owner (`aphrody_m3_tokens::scheme::Variant`). */
export type SchemeVariant = "tonalSpot" | "content" | "fidelity" | "expressive" | "vibrant" | "neutral" | "monochrome";

/** One `m3Css({ sheet: "scheme", ... })` request: a single mode of one scheme. */
export interface M3SchemeRequest {
  sheet: "scheme";
  /** `#rrggbb`. */
  seed: string;
  /** Kebab-case Rust name (`tonal-spot`). */
  variant: string;
  /** -1..=1. */
  contrast: number;
  dark: boolean;
}

/**
 * Returns the Rust `scheme` sheet for a request: `m3Css` of `@aphrody/bun` on the server or in a
 * desktop host, or a route of the app server that answers with it.
 */
export type M3SchemeSheet = (request: M3SchemeRequest) => string | Promise<string>;

export interface ApplyDynamicFusionThemeOptions {
  dark?: boolean;
  /** Element whose subtree is themed (default `<html>`). */
  target?: HTMLElement;
  contrastLevel?: number;
  variant?: SchemeVariant;
  /** Source of the Rust scheme sheets. Required: colours are never derived in JS. */
  sheet?: M3SchemeSheet;
}

const SEED = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const STYLE_ATTRIBUTE = "data-m3-scheme";
let scopes = 0;

/** `#rrggbb` from `#rgb` / `rrggbb` input; throws on anything else. */
export function normalizeSeed(seed: string): string {
  const hex = SEED.exec(seed.trim())?.[1];
  if (!hex) throw new TypeError(`Invalid M3 seed color: ${JSON.stringify(seed)}`);
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map(c => c + c)
          .join("")
      : hex;
  return `#${full.toLowerCase()}`;
}

/** Rust spelling of a variant (`tonalSpot` -> `tonal-spot`). */
export function rustVariant(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Mode classes and `color-scheme` on `target`. No colour role is touched. */
export function applyM3Mode(dark: boolean, target: HTMLElement): void {
  target.classList.toggle("dark", dark);
  target.classList.toggle("light", !dark);
  target.style.setProperty("color-scheme", dark ? "dark" : "light");
}

/** Declarations of the single `:root` block of a Rust `scheme` sheet. */
export function schemeDeclarations(css: string): string {
  const body = /:root\s*\{([^{}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1];
  if (body === undefined || !/--md-sys-color-primary\s*:\s*#[0-9a-f]{6}\s*;/i.test(body))
    throw new Error("@aphrody/m3-theme: the scheme sheet is not a Rust m3Css `scheme` sheet");
  return body.trim().replace(/\s*\n\s*/g, "\n  ");
}

function styleElement(target: HTMLElement): HTMLStyleElement | null {
  const id = target.getAttribute(STYLE_ATTRIBUTE);
  if (!id) return null;
  return target.ownerDocument.head.querySelector(`style[${STYLE_ATTRIBUTE}="${id}"]`);
}

/** `--md-sys-color-*` roles of a Rust `scheme` sheet, in sheet order. */
export function schemeRoles(css: string): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const [, name, value] of schemeDeclarations(css).matchAll(/(--md-sys-color-[\w-]+)\s*:\s*([^;]+);/g))
    roles[name!] = value!.trim();
  return roles;
}

/**
 * Scheme sheets from an HTTP endpoint serving the Rust renderer with the `m3Css` request fields as
 * query parameters (`GET /api/m3/css` of aphrody-site). A non-2xx answer is an error carrying the
 * server message.
 */
export function httpSchemeSheet(
  endpoint = "/api/m3/css",
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): M3SchemeSheet {
  return async ({ sheet, seed, variant, contrast, dark }) => {
    const query = new URLSearchParams({
      sheet,
      seed,
      variant,
      contrast: String(contrast),
      dark: String(dark),
    });
    const response = await fetcher(`${endpoint}?${query}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`@aphrody/m3-theme: ${endpoint} answered ${response.status}: ${body.trim()}`);
    return body;
  };
}

/** Remove the runtime scheme sheet of `target`; the compiled sheets apply again. */
export function clearM3Scheme(target: HTMLElement): void {
  styleElement(target)?.remove();
  target.removeAttribute(STYLE_ATTRIBUTE);
}

/**
 * Install the Rust scheme for `seed` on `target`: mode classes and `color-scheme`, then one
 * stylesheet holding the requested contrast and, unless it already is 1, the contrast-1 scheme
 * under `@media (prefers-contrast: more)`. The previous theme stays in place when any input or
 * sheet is invalid.
 */
export async function applyDynamicFusionTheme(
  seed: string,
  options: ApplyDynamicFusionThemeOptions = {},
): Promise<void> {
  const target = options.target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;
  if (!options.sheet)
    throw new Error(
      "@aphrody/m3-theme: a seed, variant or contrast change needs the Rust scheme sheet (`sheet`: m3Css from @aphrody/bun or an app-server route); colours are not computed in JS",
    );
  const contrast = options.contrastLevel ?? 0;
  if (!Number.isFinite(contrast) || contrast < -1 || contrast > 1)
    throw new RangeError(`M3 contrast level must be between -1 and 1, got ${contrast}`);
  const dark =
    options.dark ??
    (target.classList.contains("dark") ||
      (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  const request: M3SchemeRequest = {
    sheet: "scheme",
    seed: normalizeSeed(seed),
    variant: rustVariant(options.variant ?? "tonalSpot"),
    contrast,
    dark,
  };
  const [standard, higher] = await Promise.all([
    options.sheet(request),
    contrast < 1 ? options.sheet({ ...request, contrast: 1 }) : undefined,
  ]);
  const standardBody = schemeDeclarations(standard);
  const higherBody = higher === undefined ? undefined : schemeDeclarations(higher);

  const id = target.getAttribute(STYLE_ATTRIBUTE) ?? String(++scopes);
  const scope = target === target.ownerDocument.documentElement ? ":root" : `[${STYLE_ATTRIBUTE}="${id}"]`;
  const selector = `${scope},\n${scope}.light,\n${scope}.dark`;
  let text = `${selector} {\n  ${standardBody}\n}\n`;
  if (higherBody) text += `@media (prefers-contrast: more) {\n${selector} {\n  ${higherBody}\n}\n}\n`;

  applyM3Mode(dark, target);
  target.setAttribute(STYLE_ATTRIBUTE, id);
  let style = styleElement(target);
  if (!style) {
    style = target.ownerDocument.createElement("style");
    style.setAttribute(STYLE_ATTRIBUTE, id);
    target.ownerDocument.head.append(style);
  }
  style.textContent = text;
}
