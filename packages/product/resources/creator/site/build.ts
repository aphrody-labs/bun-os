#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build the creator.aphrody.com page from the shared Material packages: static tokens (m3-tokens.css), the colour scheme
 * of the logo seed (theme.json, the Rust `fidelity` export of aphrody-m3-tokens, kept current by its
 * creator_theme_golden test), the Google Sans Flex brand face of m3-fonts.
 * Also robots.txt, sitemap.xml, llms.txt, site.webmanifest, 404.html and the Open Graph card.
 * Output: packages/product/resources/creator/site/dist (build output, not versioned).
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nativeThemeColorRoles, parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";

const here = import.meta.dir;
/** Source colour of the logo (QuantizerCelebi + Score of material-color-utilities on assets/icon-256.png). */
export const SEED = "#951ae2";
const THEME = join(here, "theme.json");

const declarations = (roles: Record<string, string>, indent = "  ") =>
  Object.entries(roles)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join("\n");

/** Colour scheme CSS of the Rust export: OS preference by default, `data-theme` overrides. */
export async function schemeCss(path = THEME): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new Error(
      `${path} is missing; from the Material checkout, run APHRODY_UPDATE_TOKENS=1 cargo test --manifest-path crates/m3-tokens/Cargo.toml --test creator_theme_golden`,
    );
  const theme = parseNativeThemeExport(await file.json());
  if (theme.seed !== SEED || theme.variant !== "fidelity")
    throw new Error(`${path} is not the ${SEED} fidelity export (got ${theme.seed} ${theme.variant})`);
  const light = nativeThemeColorRoles(theme);
  const dark = nativeThemeColorRoles(theme, true);
  return [
    `:root {
  color-scheme: light dark;
${declarations(light)}
}
`,
    `@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${declarations(dark, "    ")}
  }
}
`,
    `:root[data-theme="light"] {
  color-scheme: light;
}
`,
    `:root[data-theme="dark"] {
  color-scheme: dark;
${declarations(dark)}
}
`,
  ].join("\n");
}

export const BASE_URL = "https://creator.aphrody.com";
const SOURCE_URL = "https://github.com/aphrody-labs/bun-os";
const RAW = "https://raw.githubusercontent.com/aphrody-labs/bun-os/main/packages/product/resources/creator";

async function productVersion(): Promise<string> {
  return ((await Bun.file(join(here, "../../../package.json")).json()) as { version: string }).version;
}

async function themeColors(): Promise<{ light: string; dark: string }> {
  const theme = parseNativeThemeExport(await Bun.file(THEME).json());
  return {
    light: nativeThemeColorRoles(theme)["--md-sys-color-surface"] as string,
    dark: nativeThemeColorRoles(theme, true)["--md-sys-color-surface"] as string,
  };
}

/** schema.org SoftwareApplication of the Windows pack (Google software app structured data). */
export function jsonLd(version: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Creator Kit",
    url: `${BASE_URL}/`,
    description:
      "Petits outils locaux pour créateurs : tournois Challonge, images de wiki, compression d'images, sous-titres anglais naturels, nettoyage des caches Adobe et du disque, scripts Windows.",
    inLanguage: "fr",
    operatingSystem: "Windows 10, Windows 11 (x64)",
    applicationCategory: "UtilitiesApplication",
    softwareVersion: version,
    downloadUrl: `${BASE_URL}/download/windows`,
    installUrl: `${BASE_URL}/download/windows`,
    image: `${BASE_URL}/og.png`,
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    codeRepository: `${SOURCE_URL}/tree/main/packages/product/resources/creator`,
    publisher: { "@type": "Organization", name: "MAKIT" },
    offers: { "@type": "Offer", price: 0, priceCurrency: "EUR" },
  };
}

/** llms.txt (llmstxt.org): H1, summary blockquote, details, then H2 link lists. */
export function llmsTxt(version: string): string {
  return `# Creator Kit

> Creator Kit (v${version}) is a free, Apache-2.0 Windows x64 pack of small local tools for creators working on fighting games, drawing and streaming. Everything runs on the user's PC; nothing is sent anywhere except the services the user configures (Challonge, Discord, a translation endpoint). The site and the tool are written in French.

- Download: ${BASE_URL}/download/windows (zip). Unzip and run \`creator-kit.exe\`; double-click opens a console menu. The exe updates itself in the background (\`CREATOR_KIT_NO_UPDATE=1\` disables it, \`creator-kit self-update\` forces it).
- Commands that change something are dry runs until \`--apply\` (PowerShell scripts: \`-Apply\`) is given.
- Commands: \`challonge\` (create and run Challonge tournaments, optional Discord bot), \`wiki-images\` (download a MediaWiki gallery through the API), \`img-compress\` (batch image compression; originals never overwritten), \`video-translate\` (natural English subtitles with local speech recognition and a local language model), \`adobe-clean\` (free RAM and clear regenerable Adobe caches), \`disk-clean\` (scan, clear rebuildable caches, list exact duplicates).
- The pack also ships an offline image compressor page, Windows PowerShell scripts (screen dead zone, Playnite autostart, Stacher7 cookies), the YouTube Subs Sorter browser extension and a PNGTuber-Plus hotkey combination patch.

## Release

- [latest.json](${BASE_URL}/latest.json): current version, artifact URLs, sizes and SHA-256 (polled by the updater)
- [SHA256SUMS](${BASE_URL}/SHA256SUMS): checksums of the versioned files under /files/

## Docs

- [README](${RAW}/README.md): every tool, its commands and its safety rules (French)
- [Challonge](${RAW}/docs-challonge.md): tournament CLI and Discord bot, API versions and verification state (French)
- [video-translate](${RAW}/docs-video-translate.md): subtitle translation pipeline, glossaries and privacy (French)
- [Windows scripts](${RAW}/windows/README.md): dead-zone, playnite-boost and stacher-cookies (French)
- [YouTube Subs Sorter](${RAW}/extensions/yt-subs-sorter/README.md): Manifest V3 extension for Chrome, Edge, Brave and Firefox (French)

## Optional

- [Source code](${SOURCE_URL}/tree/main/packages/product): the \`@aphrody/product\` package that builds creator-kit
`;
}

const ROBOTS = `User-agent: *
Allow: /
Disallow: /files/
Disallow: /download/

Sitemap: ${BASE_URL}/sitemap.xml
`;

const sitemap = (lastmod: string) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;

const manifest = (colors: { light: string; dark: string }) => ({
  name: "Creator Kit",
  short_name: "Creator Kit",
  description: "Petits outils locaux pour créateurs (jeux de combat, dessin, stream), pour Windows.",
  lang: "fr",
  start_url: "/",
  scope: "/",
  display: "browser",
  background_color: colors.light,
  theme_color: colors.light,
  icons: [
    { src: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-256.png", sizes: "256x256", type: "image/png" },
  ],
});

/** Every file of the page, relative to the output folder (the publish script and the vhost serve exactly these). */
export const PAGE_FILES = [
  "index.html",
  "404.html",
  "page.css",
  "app.js",
  "theme.css",
  "fonts/GoogleSansFlex-latin.woff2",
  "logo.webp",
  "favicon-32.png",
  "favicon-192.png",
  "icon-256.png",
  "apple-touch-icon.png",
  "og.png",
  "site.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
] as const;

export async function build(outDir = join(here, "dist"), { og = true } = {}): Promise<string> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "fonts"), { recursive: true });
  const tokens = await Bun.file(fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css"))).text();
  const scheme = await schemeCss();
  const font = `@font-face {
  font-family: "Google Sans Flex";
  src: url("/fonts/GoogleSansFlex-latin.woff2") format("woff2");
  font-weight: 1 1000;
  font-stretch: 25% 151%;
  font-display: swap;
}
`;
  await Bun.write(join(outDir, "theme.css"), `${font}\n${tokens}\n${scheme}`);
  await cp(
    fileURLToPath(import.meta.resolve("@aphrody/m3-fonts/fonts/web/GoogleSansFlex-latin.woff2")),
    join(outDir, "fonts/GoogleSansFlex-latin.woff2"),
  );
  const version = await productVersion();
  const colors = await themeColors();
  const ld = JSON.stringify(jsonLd(version), null, 2).replaceAll("<", "\\u003c").replaceAll("\n", "\n      ");
  const index = (await Bun.file(join(here, "src/index.html")).text())
    .replaceAll("{{BASE_URL}}", BASE_URL)
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{THEME_LIGHT}}", colors.light)
    .replaceAll("{{THEME_DARK}}", colors.dark)
    .replace("{{JSON_LD}}", ld);
  if (index.includes("{{")) throw new Error("index.html: unresolved placeholder");
  await Bun.write(join(outDir, "index.html"), index);
  await Promise.all(["404.html", "page.css", "app.js"].map(name => cp(join(here, "src", name), join(outDir, name))));
  await Promise.all(
    [
      "logo.webp",
      "favicon-32.png",
      "favicon-192.png",
      "icon-256.png",
      "apple-touch-icon.png",
      ...(og ? ["og.png"] : []),
    ].map(name => cp(join(here, "assets", name), join(outDir, name))),
  );
  await Bun.write(join(outDir, "site.webmanifest"), `${JSON.stringify(manifest(colors), null, 2)}\n`);
  await Bun.write(join(outDir, "robots.txt"), ROBOTS);
  await Bun.write(join(outDir, "sitemap.xml"), sitemap(new Date().toISOString().slice(0, 10)));
  await Bun.write(join(outDir, "llms.txt"), llmsTxt(version));
  for (const name of PAGE_FILES.filter(name => og || name !== "og.png"))
    if (!(await Bun.file(join(outDir, name)).exists())) throw new Error(`site build: missing ${name}`);
  return outDir;
}

/**
 * Render assets/og.png (1200x630 Open Graph card) from src/og.html with a headless Chromium (Edge or Chrome):
 * `bun build.ts og [--browser <path>]`. The card uses the page's own theme.css, so it carries only M3 token colours.
 */
async function renderOg(): Promise<void> {
  const i = Bun.argv.indexOf("--browser");
  const browser =
    (i >= 0 ? Bun.argv[i + 1] : undefined) ??
    Bun.env.CHROME_PATH ??
    [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      Bun.which("chromium") ?? "",
      Bun.which("google-chrome") ?? "",
      Bun.which("microsoft-edge") ?? "",
    ].find(path => path && Bun.file(path).size > 0);
  if (!browser) throw new Error("no Chromium browser found: pass --browser <path>");
  const out = await build(join(here, "dist"), { og: false });
  await cp(join(here, "src/og.html"), join(out, "og.html"));
  const target = join(here, "assets/og.png");
  const proc = Bun.spawn(
    [
      browser,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--allow-file-access-from-files",
      "--window-size=1200,630",
      `--screenshot=${target}`,
      `file:///${join(out, "og.html").replaceAll("\\", "/").replace(/^\/+/, "")}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error("og render failed");
  console.log(target);
}

if (import.meta.main) {
  if (Bun.argv[2] === "og") await renderOg();
  else console.log(await build());
}
