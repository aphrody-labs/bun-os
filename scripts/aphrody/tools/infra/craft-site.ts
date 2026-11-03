#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The craft.aphrody.app directory around the studio builds: landing page, 404 page, previews, icon set, Open Graph
 * card, web manifest, robots.txt, sitemap.xml and llms.txt. deploy-craft-frontends.ts calls writeSite() on the VPS;
 * locally:
 *
 *   bun scripts/aphrody/tools/infra/craft-site.ts preview <dir>   write the directory files only (no studios)
 *   bun scripts/aphrody/tools/infra/craft-site.ts og [--browser <chromium>]
 *                                                                 render assets/craft/og.png from craft-og.html
 *
 * Colours come only from the custom properties of craft.css; the manifest and theme-color read its `--bg`.
 */
import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const BASE_URL = "https://craft.aphrody.app";
const here = import.meta.dir;
const root = resolve(here, "../../../..");

/** [path, name, summary, filter category, label]: every studio published under /<path>/. */
export const STUDIOS = [
  ["photo", "PhotoCraft", "Image editing, with space to get every detail right.", "visual", "Image editing"],
  ["vector", "VectorCraft", "Shape an idea with precise, scalable vector graphics.", "visual", "Vector graphics"],
  ["film", "FilmCraft", "Find your story in the edit. A studio for your next film.", "motion", "Video editing"],
  ["design", "DesignCraft", "Bring type, images and considered layouts together.", "visual", "Layout & publishing"],
  ["fig", "FigCraft", "Give your next interface a place to take shape.", "visual", "Interface design"],
  ["effect", "EffectCraft", "Add another dimension with motion and visual effects.", "motion", "Motion & effects"],
  ["light", "LightCraft", "Organize your photographs and develop your perspective.", "visual", "RAW & photo library"],
  ["sound", "SoundCraft", "Make every cut, layer and moment sound right.", "motion", "Audio editing"],
  ["cad", "CADCraft", "Move from an early sketch to a precise technical drawing.", "visual", "Drafting & CAD"],
  ["word", "WordCraft", "A dedicated space for words worth putting on the page.", "work", "Word processing"],
  ["deck", "DeckCraft", "Turn a collection of ideas into a compelling presentation.", "work", "Presentations"],
  ["grid", "GridCraft", "Make sense of the numbers, one clear sheet at a time.", "work", "Spreadsheets"],
  ["pdf", "PDFCraft", "Read, review and edit your PDF documents in one studio.", "work", "PDF documents"],
  [
    "art",
    "ArtCraft",
    "Explore the desktop studio interface. Generation requires the desktop application.",
    "visual",
    "Browser preview",
  ],
] as const;

/** schema.org applicationCategory of each filter category. */
const CATEGORY = {
  visual: "DesignApplication",
  motion: "MultimediaApplication",
  work: "BusinessApplication",
} as const;

const DESCRIPTION =
  "Craft by Aphrody: fourteen focused creative and productivity studios (image, vector, video, audio, layout, CAD, documents, slides, spreadsheets, PDF) that open directly in your browser.";

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The `--bg` custom property of craft.css (theme-color and manifest colours). */
export async function background(): Promise<string> {
  const css = await Bun.file(join(here, "craft.css")).text();
  const match = /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css);
  if (!match?.[1]) throw new Error("craft.css: --bg is missing");
  return match[1];
}

export function jsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${BASE_URL}/#website`,
        url: `${BASE_URL}/`,
        name: "Craft",
        alternateName: "Craft by Aphrody",
        description: DESCRIPTION,
        inLanguage: "en",
        publisher: { "@type": "Organization", name: "Aphrody", url: "https://aphrody.com/" },
      },
      {
        "@type": "ItemList",
        name: "Craft studios",
        numberOfItems: STUDIOS.length,
        itemListElement: STUDIOS.map(([path, name, summary, category, label], i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "WebApplication",
            name,
            url: `${BASE_URL}/${path}/`,
            description: `${label}. ${summary}`,
            applicationCategory: CATEGORY[category],
            operatingSystem: "Any (web browser)",
            browserRequirements: "Requires JavaScript and WebAssembly",
            ...(path === "art" ? {} : { image: `${BASE_URL}/previews/${path}.jpg` }),
          },
        })),
      },
    ],
  };
}

function cards(): string {
  return STUDIOS.map(
    ([path, name, summary, category, label]) => `<a class="card" href="/${path}/" data-category="${category}">
  ${path === "art" ? '<div class="preview art-preview" aria-hidden="true"><span>Make your mark.</span></div>' : `<div class="preview"><img src="/previews/${path}.jpg" width="1280" height="800" loading="lazy" alt="${name} editor workspace"></div>`}
  <div class="card-info"><div class="card-top"><h3>${name}</h3><span aria-hidden="true">↗</span></div><p>${escapeHtml(summary)}</p><span class="category">${escapeHtml(label)}</span></div></a>`,
  ).join("\n");
}

export function llmsTxt(): string {
  const list = STUDIOS.map(
    ([path, name, summary, , label]) => `- [${name}](${BASE_URL}/${path}/): ${label}. ${summary}`,
  ).join("\n");
  return `# Craft

> Craft (craft.aphrody.app, by Aphrody) is a directory of ${STUDIOS.length} focused creative and productivity studios that open directly in the browser, without installing a desktop application. Thirteen are Rust editors compiled to WebAssembly; ArtCraft is a browser preview of a desktop generation studio.

- Each studio is a single document at its own path (\`/<studio>/\`); there are no accounts on this site.
- Studios need JavaScript and WebAssembly. LightCraft, FilmCraft and EffectCraft run cross-origin isolated (worker threads).
- ArtCraft generation requires the desktop application; the browser build shows its interface.
- The same editors also exist as desktop applications and command-line tools in the Bun OS repository.

## Studios

${list}

## Optional

- [Source code](https://github.com/aphrody-labs/bun-os/tree/main/apps): the \`*craft\`, \`*craft-web\` and \`*craft-cli\` applications of Bun OS
- [Sitemap](${BASE_URL}/sitemap.xml)
`;
}

const robots = () => `User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`;

const sitemap = (lastmod: string) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["", ...STUDIOS.map(([path]) => `${path}/`)]
  .map(path => `  <url>\n    <loc>${BASE_URL}/${path}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
  .join("\n")}
</urlset>
`;

/** PNG-compressed ICO (PNG entries are valid ICO images since Windows Vista). */
async function ico(source: Uint8Array, sizes: number[]): Promise<Uint8Array> {
  const images = await Promise.all(
    sizes.map(async size => new Uint8Array(await new Bun.Image(source).resize(size, size).png().toBuffer())),
  );
  const header = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  header.setUint16(2, 1, true);
  header.setUint16(4, sizes.length, true);
  let offset = header.byteLength;
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i;
    header.setUint8(at, size >= 256 ? 0 : size);
    header.setUint8(at + 1, size >= 256 ? 0 : size);
    header.setUint16(at + 4, 1, true);
    header.setUint16(at + 6, 32, true);
    header.setUint32(at + 8, images[i]!.byteLength, true);
    header.setUint32(at + 12, offset, true);
    offset += images[i]!.byteLength;
  });
  return new Uint8Array(await new Blob([header.buffer, ...images]).arrayBuffer());
}

/** Directory files written by writeSite(), relative to the release root. */
export const SITE_FILES = [
  "index.html",
  "404.html",
  "craft.css",
  "craft.js",
  "aphrody-icon.png",
  "icon-192.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "og.png",
  "site.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  ...STUDIOS.filter(([path]) => path !== "art").map(([path]) => `previews/${path}.jpg`),
] as const;

/** Write the directory files into `release` (the studios themselves are copied by the deploy script). */
export async function writeSite(release: string, now = new Date()): Promise<void> {
  await mkdir(join(release, "previews"), { recursive: true });
  for (const [path] of STUDIOS)
    if (path !== "art")
      await cp(join(root, `assets/craft/previews/${path}.jpg`), join(release, `previews/${path}.jpg`));
  for (const file of ["craft.css", "craft.js", "craft-404.html"])
    await cp(join(here, file), join(release, file === "craft-404.html" ? "404.html" : file));
  const icon = join(root, "packages/identity/assets");
  await cp(join(icon, "icon-64.png"), join(release, "aphrody-icon.png"));
  await cp(join(icon, "icon-192.png"), join(release, "icon-192.png"));
  const icon192 = await Bun.file(join(icon, "icon-192.png")).bytes();
  await Bun.write(
    join(release, "apple-touch-icon.png"),
    new Uint8Array(await new Bun.Image(icon192).resize(180, 180).png().toBuffer()),
  );
  await Bun.write(join(release, "favicon.ico"), await ico(icon192, [16, 32, 48]));
  await cp(join(root, "assets/craft/og.png"), join(release, "og.png"));
  const bg = await background();
  const ld = JSON.stringify(jsonLd()).replaceAll("<", "\\u003c");
  const index = (await Bun.file(join(here, "craft-landing.html")).text())
    .replaceAll("{{BASE_URL}}", BASE_URL)
    .replaceAll("{{DESCRIPTION}}", escapeHtml(DESCRIPTION))
    .replaceAll("{{THEME_COLOR}}", bg)
    .replaceAll("{{COUNT}}", String(STUDIOS.length))
    .replace("{{JSON_LD}}", ld)
    .replace("{{CARDS}}", cards());
  if (index.includes("{{")) throw new Error("craft-landing.html: unresolved placeholder");
  await Bun.write(join(release, "index.html"), index);
  await Bun.write(
    join(release, "site.webmanifest"),
    `${JSON.stringify(
      {
        name: "Craft by Aphrody",
        short_name: "Craft",
        description: DESCRIPTION,
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "browser",
        background_color: bg,
        theme_color: bg,
        icons: [
          { src: "/aphrody-icon.png", sizes: "64x64", type: "image/png" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await Bun.write(join(release, "robots.txt"), robots());
  await Bun.write(join(release, "sitemap.xml"), sitemap(now.toISOString().slice(0, 10)));
  await Bun.write(join(release, "llms.txt"), llmsTxt());
  for (const file of SITE_FILES)
    if (!(await Bun.file(join(release, file)).exists())) throw new Error(`craft site: missing ${file}`);
}

/** Render assets/craft/og.png (1200x630) from craft-og.html with a headless Chromium. */
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
  const dir = join(root, "build/craft-site-og");
  await mkdir(join(dir, "previews"), { recursive: true });
  await cp(join(here, "craft.css"), join(dir, "craft.css"));
  await cp(join(here, "craft-og.html"), join(dir, "og.html"));
  await cp(join(root, "packages/identity/assets/icon-192.png"), join(dir, "icon-192.png"));
  for (const name of ["photo", "film", "word"])
    await cp(join(root, `assets/craft/previews/${name}.jpg`), join(dir, `previews/${name}.jpg`));
  const target = join(root, "assets/craft/og.png");
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
      `file:///${join(dir, "og.html").replaceAll("\\", "/").replace(/^\/+/, "")}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error("og render failed");
  console.log(target);
}

if (import.meta.main) {
  const [command, out] = Bun.argv.slice(2);
  if (command === "og") await renderOg();
  else if (command === "preview" && out) {
    await writeSite(resolve(out));
    console.log(resolve(out));
  } else console.error("usage: craft-site.ts preview <dir> | og [--browser <path>]");
}
