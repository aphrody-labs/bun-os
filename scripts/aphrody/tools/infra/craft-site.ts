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

/**
 * [path, name, summary, filter category, label, parity]:
 * The 14 sovereign studios published under /<path>/ with explicit ecosystem parity tiers:
 * - Document & Office (Google Workspace & Microsoft Office parity)
 * - Visual & Graphic (Adobe Creative Cloud & Figma parity)
 * - Motion, Audio & 3D (Premiere, After Effects, Audition & AutoCAD parity)
 */
export const STUDIOS = [
  // Document & Office (Google Workspace / Microsoft 365 Parity)
  [
    "word",
    "WordCraft",
    "Sovereign typography & prose editor. Pure Rust layout engine with real-time OPFS persistence and zero cloud telemetry.",
    "work",
    "Word processing",
    "Word / Google Docs",
  ],
  [
    "grid",
    "GridCraft",
    "High-throughput spreadsheet computing powered by Rust WebAssembly. Millions of cells, formula trees, and zero telemetry.",
    "work",
    "Spreadsheets",
    "Excel / Google Sheets",
  ],
  [
    "deck",
    "DeckCraft",
    "Architect cinematic presentations with hardware-accelerated layouts, vector charts, and instant deck export right in your browser.",
    "work",
    "Presentations",
    "PowerPoint / Google Slides",
  ],
  [
    "pdf",
    "PDFCraft",
    "Inspect, annotate, sign, and compile PDF documents locally with native Rust parsing. Confidential files never leave your machine.",
    "work",
    "PDF documents",
    "Acrobat Pro",
  ],
  // Visual & Graphic (Adobe Creative Cloud & Figma Parity)
  [
    "photo",
    "PhotoCraft",
    "Non-destructive 32-bit float photo editing and RAW grading. WebGPU compute shaders deliver instant 120 FPS adjustments on gigapixel images.",
    "visual",
    "Image editing",
    "Photoshop RAW",
  ],
  [
    "vector",
    "VectorCraft",
    "Infinite canvas vector precision. High-performance bezier math, path booleans, and scalable SVG/PDF export compiled from Rust to WASM.",
    "visual",
    "Vector graphics",
    "Illustrator",
  ],
  [
    "design",
    "DesignCraft",
    "Publication layout studio fusing typography, multi-page grids, bleed guides, and CMYK workflows directly in your browser.",
    "visual",
    "Layout & publishing",
    "InDesign",
  ],
  [
    "fig",
    "FigCraft",
    "Sovereign UI/UX interface design studio. Vector networks, auto-layout constraints, interactive components, and offline-first design systems.",
    "visual",
    "Interface design",
    "Figma / Adobe XD",
  ],
  [
    "light",
    "LightCraft",
    "Catalog, cull, and develop entire RAW libraries in your browser using multi-threaded WebAssembly workers and color science tone curves.",
    "visual",
    "RAW & photo library",
    "Lightroom Library",
  ],
  // Motion, Audio & 3D (Premiere, After Effects, Audition & AutoCAD Parity)
  [
    "film",
    "FilmCraft",
    "Multi-track non-linear video editing studio. WebGPU timeline playback, frame-accurate trimming, and cross-origin isolated worker rendering.",
    "motion",
    "Video editing",
    "Premiere Pro",
  ],
  [
    "effect",
    "EffectCraft",
    "Layer-based motion graphics and compositor. Procedural keyframe graphs, particle engines, and WebGPU compute shaders.",
    "motion",
    "Motion & effects",
    "After Effects",
  ],
  [
    "sound",
    "SoundCraft",
    "Multi-track audio workstation. Spectral waveform editing, parametric EQ, sovereign DSP plugins, and low-latency WebAudio buffers.",
    "motion",
    "Audio editing",
    "Audition / Logic Pro",
  ],
  [
    "cad",
    "CADCraft",
    "Parametric drafting and technical CAD modelling. Precise geometric dimensioning, constraints, and DXF/STEP geometry kernels.",
    "motion",
    "Drafting & CAD",
    "Fusion 360 / AutoCAD",
  ],
  [
    "art",
    "ArtCraft",
    "Sovereign 3D generation and creative canvas studio. Native desktop engine with real-time WebGPU browser preview.",
    "motion",
    "Creative Studio",
    "Creative Studio",
  ],
] as const;

/** schema.org applicationCategory of each filter category. */
const CATEGORY = {
  visual: "DesignApplication",
  motion: "MultimediaApplication",
  work: "BusinessApplication",
} as const;

const DESCRIPTION =
  "Craft by Aphrody: 14 sovereign creative and office studios fusing Google Workspace, Microsoft 365, and Adobe Creative Cloud into one unified suite. Pure Rust WebAssembly and WebGPU, zero cloud telemetry, local-first privacy.";

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
        alternateName: "Craft by Aphrody — Sovereign Creative & Office Suite",
        description: DESCRIPTION,
        inLanguage: "en",
        publisher: {
          "@type": "Organization",
          name: "Aphrody",
          url: "https://aphrody.com/",
          logo: `${BASE_URL}/aphrody-icon.png`,
        },
      },
      {
        "@type": "ItemList",
        name: "Craft Sovereign Studios",
        numberOfItems: STUDIOS.length,
        itemListElement: STUDIOS.map(([path, name, summary, category, label, parity], i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "WebApplication",
            name,
            url: `${BASE_URL}/${path}/`,
            description: `${label} (${parity} parity). ${summary}`,
            applicationCategory: CATEGORY[category],
            operatingSystem: "Any modern browser supporting WebGPU and WebAssembly",
            browserRequirements: "Requires WebAssembly and native WebGPU support",
            ...(path === "art" ? {} : { image: `${BASE_URL}/previews/${path}.jpg` }),
          },
        })),
      },
    ],
  };
}

function cards(): string {
  return STUDIOS.map(
    ([path, name, summary, category, label, parity]) => `
<article class="card" data-category="${category}" data-studio="${path}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="Inspect ${name} (${parity})">
  <div class="card-badge-row">
    <span class="parity-badge" title="Ecosystem parity tier: ${escapeHtml(parity)}">${escapeHtml(parity)}</span>
    <span class="engine-badge">Rust WASM · WebGPU</span>
  </div>
  ${
    path === "art"
      ? '<div class="preview art-preview" aria-hidden="true"><div class="art-preview-glow"></div><span class="art-preview-title">ArtCraft</span><span class="art-preview-sub">WebGPU Sovereign Engine</span></div>'
      : `<div class="preview"><img src="/previews/${path}.jpg" width="1280" height="800" loading="lazy" alt="${name} editor workspace"></div>`
  }
  <div class="card-info">
    <div class="card-top">
      <div class="card-title-group">
        <h3>${name}</h3>
        <span class="category-tag">${escapeHtml(label)}</span>
      </div>
      <a class="card-launch-icon" href="/${path}/" aria-label="Open ${name} studio in new tab" target="_blank" rel="noopener">↗</a>
    </div>
    <p>${escapeHtml(summary)}</p>
    <div class="card-actions">
      <button type="button" class="btn-inspect" data-inspect="${path}" aria-label="Inspect ${name} specifications">
        <svg class="icon-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
        Inspect
      </button>
      <a class="btn-launch" href="/${path}/" target="_blank" rel="noopener">
        Launch Studio <span aria-hidden="true">↗</span>
      </a>
    </div>
  </div>
</article>`,
  ).join("\n");
}

export function llmsTxt(): string {
  return `# Craft by Aphrody

> Craft (https://craft.aphrody.app/, by Aphrody) is a unified sovereign suite of 14 creative and productivity studios fusing Google Workspace, Microsoft 365, and Adobe Creative Cloud into a single zero-telemetry, local-first browser experience.
> Built with pure Rust WebAssembly (.wasm) and native WebGPU compute/render pipelines.

## Architectural Directives & Privacy
- **WebGPU and Rust WASM Exclusively**: Real-time 60/120 FPS performance via WebGPU render & compute pipelines and compiled Rust engines. No WebGL, no legacy canvas fallbacks.
- **Zero Telemetry & Local-First**: Private data persistence via the Origin Private File System (OPFS). No user analytics, no behavioral logging, no cloud lock-in.
- **Ecosystem Parity**: Complete replacement of proprietary creative and office suites without subscriptions or mandatory accounts.
- **Sovereign Mascot**: Byron Love (Aphrodi) official sovereign AI mascot and Aphrody brand crest.

## The 14 Studios

### Document & Office
${STUDIOS.filter(([, , , cat]) => cat === "work")
  .map(
    ([path, name, summary, , label, parity]) =>
      `- **${name}** (${label} · *${parity}*): [Launch](${BASE_URL}/${path}/) — ${summary}`,
  )
  .join("\n")}

### Visual & Graphic
${STUDIOS.filter(([, , , cat]) => cat === "visual")
  .map(
    ([path, name, summary, , label, parity]) =>
      `- **${name}** (${label} · *${parity}*): [Launch](${BASE_URL}/${path}/) — ${summary}`,
  )
  .join("\n")}

### Motion, Audio & 3D
${STUDIOS.filter(([, , , cat]) => cat === "motion")
  .map(
    ([path, name, summary, , label, parity]) =>
      `- **${name}** (${label} · *${parity}*): [Launch](${BASE_URL}/${path}/) — ${summary}`,
  )
  .join("\n")}

## Repository & Open Source
- Source code: https://github.com/aphrody-labs/bun-os
- Bun OS WebAssembly and WebGPU studio targets in \`apps/\` and \`crates/\`
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
  "byron-mascot.svg",
  "byron-avatar.png",
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

  // Copy Byron Love (Aphrodi) official sovereign mascot artwork
  const byronDir = join(root, "assets/aphrody/ai/byron");
  await cp(join(byronDir, "byron_icon.svg"), join(release, "byron-mascot.svg"));
  await cp(join(byronDir, "byron_icon_128.png"), join(release, "byron-avatar.png"));

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
        display: "standalone",
        background_color: bg,
        theme_color: bg,
        icons: [
          { src: "/aphrody-icon.png", sizes: "64x64", type: "image/png" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/byron-avatar.png", sizes: "128x128", type: "image/png" },
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
