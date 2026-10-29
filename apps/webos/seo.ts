// SPDX-License-Identifier: Apache-2.0
// SEO for the Web OS: robots.txt, sitemap.xml, llms.txt, llms-full.txt, one static landing page per app
// (dist/a/<id>/index.html), the share image, the noscript fallback and the UI sounds.
import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ORIGIN, PATHS } from "./paths";

const root = resolve(import.meta.dir, "../..");
const SITE = "Aphrody Bun OS";
const TAGLINE =
  "Aphrody Bun OS in the browser: desktop shell, file explorer, terminal, browser and Bun Engine, with games and creative apps that install and run offline.";

interface CatalogLike {
  generated?: string;
  counts?: { apps: number; packages: number; crates: number };
}
interface Item {
  id: string;
  name: string;
  description: string;
  kind: "builtin" | "package";
  category: string;
  version?: string;
  license?: string;
  size?: number;
  threads?: boolean;
}

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const ld = (o: unknown) => JSON.stringify(o).replaceAll("<", "\\u003c");
const mb = (n: number) => `${(n / 1e6).toFixed(n > 1e7 ? 0 : 1)} MB`;

/** Built-in apps live in src/main.ts (DOM code, not importable at build time): read id, name and desc from the source. */
async function builtins(): Promise<Item[]> {
  const src = await Bun.file(join(import.meta.dir, "src/main.ts")).text();
  const out: Item[] = [];
  const re =
    /id: "([\w-]+)",\s*name: "([^"]+)",[\s\S]*?desc: "([^"]+)",\s*group: "(\w+)"/g;
  for (const m of src.matchAll(re))
    out.push({
      id: m[1]!,
      name: m[2]!,
      description: m[3]!,
      kind: "builtin",
      category: m[4]!,
    });
  return out;
}

async function packages(dist: string): Promise<Item[]> {
  const f = Bun.file(join(dist, "registry.json"));
  if (!(await f.exists())) return [];
  const reg = (await f.json()) as { packages: any[] };
  return reg.packages.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    kind: "package" as const,
    category: p.category ?? "apps",
    version: p.version,
    license: p.license,
    size: p.size,
    threads: p.threads,
  }));
}

const SCHEMA_CATEGORY: Record<string, string> = {
  games: "GameApplication",
  create: "MultimediaApplication",
  core: "UtilitiesApplication",
  advanced: "DeveloperApplication",
};

function features(i: Item): string[] {
  const f: string[] = [];
  if (i.kind === "builtin") f.push("Included with Bun OS, nothing to install.");
  else {
    f.push(
      "Installs from the App Store into your browser with a SHA-256 verified download.",
    );
    f.push("Works offline after the first launch.");
    if (i.size) f.push(`Download size about ${mb(i.size)}.`);
    if (i.threads) f.push("Uses several threads (cross-origin isolated).");
    if (i.license) f.push(`License: ${i.license}.`);
  }
  f.push("Runs entirely in your browser; your files stay on your device.");
  return f;
}

function landing(i: Item): string {
  const url = `${ORIGIN}/a/${i.id}/`;
  const open = `/?app=${encodeURIComponent(i.id)}`;
  const title = `${i.name} · ${SITE}`;
  const desc = `${i.description} Runs in your browser on ${SITE}.`;
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: i.name,
    description: i.description,
    url,
    image: `${ORIGIN}/og-image.png`,
    applicationCategory: SCHEMA_CATEGORY[i.category] ?? "MultimediaApplication",
    operatingSystem: "Any (web browser)",
    ...(i.version ? { softwareVersion: i.version } : {}),
    ...(i.license
      ? { license: `https://spdx.org/licenses/${i.license.split(" ")[0]}` }
      : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isPartOf: { "@type": "WebApplication", name: SITE, url: `${ORIGIN}/` },
    publisher: { "@type": "Organization", name: "Aphrody", url: ORIGIN },
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#11131d">
<meta name="color-scheme" content="light dark">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/32.png">
<link rel="apple-touch-icon" href="/brand/256.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ORIGIN}/og-image.png">
<script type="application/ld+json">${ld(jsonld)}</script>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:2rem 1.25rem;background:#fef7ff;color:#1d1b20}
a.open{display:inline-block;margin:.5rem 0 1.5rem;padding:.7rem 1.4rem;border-radius:2rem;background:#6750a4;color:#fff;text-decoration:none;font-weight:600}
nav a{color:#6750a4}img{border-radius:22%}
@media(prefers-color-scheme:dark){body{background:#141218;color:#e6e0e9}nav a{color:#d0bcff}}</style>
</head><body>
<header><nav aria-label="Site"><a href="/">${SITE}</a></nav></header>
<main>
<img src="/brand/128.png" alt="" width="64" height="64">
<h1>${esc(i.name)}</h1>
<p>${esc(i.description)}</p>
<p><a class="open" href="${open}">Open ${esc(i.name)} in Bun OS</a></p>
<h2>Features</h2>
<ul>${features(i)
    .map((f) => `<li>${esc(f)}</li>`)
    .join("")}</ul>
<p>${SITE} is a desktop that runs in your browser: windows, workspaces, files, terminal and apps. <a href="/llms.txt">Full app list</a>.</p>
</main></body></html>
`;
}

function noscript(items: Item[]): string {
  const li = (i: Item) =>
    `<li><a href="/a/${i.id}/">${esc(i.name)}</a>: ${esc(i.description)}</li>`;
  const group = (t: string, l: Item[]) =>
    l.length ? `<h2>${t}</h2><ul>${l.map(li).join("")}</ul>` : "";
  return `<main><h1>${SITE}</h1><p>${esc(TAGLINE)} This desktop needs JavaScript to run.</p>${group(
    "Built-in apps",
    items.filter((i) => i.kind === "builtin"),
  )}${group(
    "Installable apps",
    items.filter((i) => i.kind === "package"),
  )}</main>`;
}

/** The 1200x630 share image is a committed desktop capture (public/og-image.png); the logo is the fallback. */
async function ogImage(dist: string) {
  if (await Bun.file(join(dist, "og-image.png")).exists())
    return "desktop capture";
  const logo = join(root, "apps/aphrody-app/icons/icon.png");
  await cp(logo, join(dist, "og-image.png"));
  return "logo";
}

async function sounds(dist: string) {
  const dir = join(dist, "sounds");
  await mkdir(dir, { recursive: true });
  // Spacedrive UI sounds (packages/assets, FSL-1.1-ALv2): the license text travels with them.
  for (const f of ["pairing", "copy", "job-done"])
    for (const ext of ["ogg", "mp3"])
      await cp(
        join(root, "packages/assets/sounds", `${f}.${ext}`),
        join(dir, `${f}.${ext}`),
      );
  await cp(
    join(root, "LICENSE-APACHE"),
    join(dir, "LICENSE.apache"),
  );
  await Bun.write(
    join(dir, "NOTICE.txt"),
    "UI sounds (pairing, copy, job-done) come from @aphrody/assets, the Spacedrive @sd/assets set,\nlicensed FSL-1.1-ALv2 (see LICENSE.spacedrive).\n",
  );
}

export async function buildSeo(dist: string, catalog: CatalogLike) {
  const items = [...(await builtins()), ...(await packages(dist))];
  const day = (catalog.generated ?? new Date().toISOString()).slice(0, 10);

  for (const i of items) {
    await mkdir(join(dist, "a", i.id), { recursive: true });
    await Bun.write(join(dist, "a", i.id, "index.html"), landing(i));
  }

  const urls = [
    `${ORIGIN}/`,
    ...Object.keys(PATHS)
      .filter((path) => path !== "/")
      .map((path) => `${ORIGIN}${path}`),
    ...items.map((i) => `${ORIGIN}/a/${i.id}/`),
  ];
  await Bun.write(
    join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map(
        (u, n) =>
          `<url><loc>${u}</loc><lastmod>${day}</lastmod><priority>${n ? "0.6" : "1.0"}</priority></url>`,
      )
      .join("\n")}\n</urlset>\n`,
  );
  await Bun.write(
    join(dist, "robots.txt"),
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /v1/\nDisallow: /mcp\nDisallow: /vm/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
  );

  const line = (i: Item) =>
    `- [${i.name}](${ORIGIN}/a/${i.id}/): ${i.description}`;
  const section = (t: string, l: Item[]) =>
    l.length ? [`## ${t}`, "", ...l.map(line), ""] : [];
  const b = items.filter((i) => i.kind === "builtin");
  const p = items.filter((i) => i.kind === "package");
  await Bun.write(
    join(dist, "llms.txt"),
    [
      `# ${SITE}`,
      "",
      `> ${TAGLINE}`,
      "",
      ...(catalog.counts
        ? [
            `The workspace catalog lists ${catalog.counts.apps} apps, ${catalog.counts.packages} packages and ${catalog.counts.crates} crates (${ORIGIN}/api/catalog).`,
            "",
          ]
        : []),
      ...section("Built-in apps", b),
      ...section("Installable apps", p),
      "## Optional",
      "",
      `- [Full description of every app](${ORIGIN}/llms-full.txt)`,
      `- [Catalog (JSON)](${ORIGIN}/api/catalog)`,
      `- [Sitemap](${ORIGIN}/sitemap.xml)`,
      "",
    ].join("\n"),
  );
  await Bun.write(
    join(dist, "llms-full.txt"),
    [
      `# ${SITE}`,
      "",
      TAGLINE,
      "",
      ...items.flatMap((i) => [
        `## ${i.name}`,
        `URL: ${ORIGIN}/a/${i.id}/`,
        `Open: ${ORIGIN}/?app=${i.id}`,
        `Type: ${i.kind === "builtin" ? "built-in app" : "installable app"}, ${i.category}${i.version ? `, version ${i.version}` : ""}`,
        "",
        i.description,
        "",
        ...features(i).map((f) => `- ${f}`),
        "",
      ]),
    ].join("\n"),
  );

  const og = await ogImage(dist);
  await sounds(dist);

  const index = Bun.file(join(dist, "index.html"));
  const html = await index.text();
  await Bun.write(index, html.replace("<!--seo:noscript-->", noscript(items)));
  console.log(
    `seo: ${urls.length} urls, ${items.length} landing pages, og-image ${og}`,
  );
}
