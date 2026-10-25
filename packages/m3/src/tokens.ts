// SPDX-License-Identifier: Apache-2.0
// Token sheets and the self-contained token bundle (`m3 tokens`). Every sheet comes from
// `crates/aphrody-m3-tokens` through `m3Css` (docs/design/M3-PLAN.md, decision D1); the bundle
// replaces the former static `assets/design-system/m3` tree.
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cssRequest, defaultM3Css, type M3CssConfig, type M3CssFn, type M3Sheet } from "./native.js";
import { fontPaths, resolveRepoRoot, SYMBOL_STYLES } from "./paths.js";
import { fontsCss } from "./plugin.js";

export const SHEETS: readonly M3Sheet[] = ["tokens", "tailwind", "spaceui", "scheme"];

export interface M3TokensOptions extends Omit<M3CssConfig, "sheet"> {
  /** Sheet to emit (default `tokens`). */
  sheet?: M3Sheet;
  /** Sheet generator (default `m3Css` from `@aphrody/bun`). */
  css?: M3CssFn;
}

/** One sheet as CSS text. */
export async function m3Tokens(options: M3TokensOptions = {}): Promise<string> {
  const { sheet = "tokens", css, ...rest } = options;
  const generate = css ?? (await defaultM3Css());
  return generate(cssRequest(sheet, rest));
}

export interface TokenBundleOptions extends Omit<M3TokensOptions, "sheet" | "dark"> {
  /** Aphrody OS checkout holding the fonts (default: discovered). */
  root?: string;
}

/** Files a bundle contains, relative to its directory. */
export const BUNDLE_FILES = [
  "index.css",
  "tokens.css",
  "tailwind.css",
  "spaceui.css",
  "scheme-light.css",
  "scheme-dark.css",
  "fonts.css",
  ...SYMBOL_STYLES.map(style => `fonts/material-symbols-${style}.woff2`),
  "fonts/GoogleSansFlex-Variable.ttf",
  "fonts/OFL.txt",
  "fonts/LICENSE-material-symbols.txt",
  "manifest.json",
] as const;

/** `@font-face` rules and icon classes for the bundle, with `./fonts` URLs. */
export async function bundleFontsCss(root: string): Promise<string> {
  const fonts = fontPaths(root);
  const symbols = await Bun.file(join(fonts.symbolsDir, "index.css")).text();
  return [
    symbols.replaceAll('url("./material-symbols-', 'url("./fonts/material-symbols-'),
    fontsCss().replace('url("./GoogleSansFlex', 'url("./fonts/GoogleSansFlex'),
  ].join("\n");
}

/**
 * Write the self-contained token bundle into `dir`: every sheet, light and dark schemes, the
 * fonts and a manifest. Returns the written files, relative to `dir`.
 */
export async function writeTokenBundle(dir: string, options: TokenBundleOptions = {}): Promise<string[]> {
  const { root: rootOption, css, ...theme } = options;
  const root = resolveRepoRoot(rootOption);
  const generate = css ?? (await defaultM3Css());
  const fonts = fontPaths(root);
  await mkdir(join(dir, "fonts"), { recursive: true });

  const sheets: Record<string, string> = {
    "tokens.css": generate(cssRequest("tokens", theme)),
    "tailwind.css": generate(cssRequest("tailwind", theme)),
    "spaceui.css": generate(cssRequest("spaceui", theme)),
    "scheme-light.css": generate(cssRequest("scheme", { ...theme, dark: false })),
    "scheme-dark.css": generate(cssRequest("scheme", { ...theme, dark: true })),
    "fonts.css": await bundleFontsCss(root),
    "index.css": '@import "./fonts.css";\n@import "./tokens.css";\n',
  };
  await Promise.all(Object.entries(sheets).map(([name, text]) => Bun.write(join(dir, name), text)));
  await Promise.all([
    ...SYMBOL_STYLES.map(style =>
      copyFile(fonts.symbols[style], join(dir, "fonts", `material-symbols-${style}.woff2`)),
    ),
    copyFile(fonts.sansFlex, join(dir, "fonts", "GoogleSansFlex-Variable.ttf")),
    copyFile(join(fonts.sansFlexDir, "OFL.txt"), join(dir, "fonts", "OFL.txt")),
    copyFile(join(fonts.symbolsDir, "LICENSE"), join(dir, "fonts", "LICENSE-material-symbols.txt")),
  ]);
  const manifest = {
    generator: "@aphrody/m3",
    theme,
    files: BUNDLE_FILES.filter(f => f !== "manifest.json"),
  };
  await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return [...BUNDLE_FILES];
}
