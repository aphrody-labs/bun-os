// SPDX-License-Identifier: Apache-2.0
// Build the desktop webview with the same native M3 bundler used in development.
import { buildM3, TAURI_LAYOUT } from "@aphrody/m3/build";
import { loadM3Config } from "@aphrody/m3/config";
import { m3Bun } from "@aphrody/m3-bun/plugin";
import { m3Plugin } from "@aphrody/m3/plugin";
import { undeclaredDependencies } from "./undeclared-deps";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { findWorkspaceRoot } from "@aphrody/paths";
import { publicFontUrl, renderPublicStylesheet } from "@aphrody/m3-fonts";
import { prunePublicFontCopies } from "./public-assets-package";
import { normalizeAppBase } from "./src/app-base";
import { stageWebOsNotices } from "../webos-wasm/stage-notices";
const WEBOS_WASM_NAME = "aphrody_webos_wasm_bg.wasm";
const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

if (import.meta.main) {
  const workspaceRoot = findWorkspaceRoot(import.meta.dir, process.env);
  const config = await loadM3Config(import.meta.dir);
  const dev = process.argv.includes("--dev");
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: "string" },
      dev: { type: "boolean" },
      "public-assets": { type: "boolean" },
      base: { type: "string" },
    },
  });
  const outdir = resolve(values.out ?? join(import.meta.dir, "dist"));
  const base = normalizeAppBase(values.base ?? "/");
  if (values["public-assets"] && !values.out)
    throw new Error("--public-assets requires an isolated --out artifact directory");
  const assets = values["public-assets"]
    ? ((await Bun.file(join(workspaceRoot, "tools/aphrody/config/public-assets.json")).json()) as {
        schemaVersion: number;
        baseUrl: string;
        localFontFallbacks: string[];
      })
    : undefined;
  if (assets && (assets.schemaVersion !== 1 || assets.baseUrl !== "https://assets.aphrody.app"))
    throw new Error("Unqualified public assets configuration");
  // Bun OS is the single source of truth for every input: the revision is this repository HEAD.
  const bunCheckout = resolve(import.meta.dir, "../..");
  const sourceRevision = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: bunCheckout,
  });
  if (sourceRevision.exitCode !== 0) throw new Error("Canonical Bun checkout must have a source revision");
  const bunRevision = sourceRevision.stdout.toString().trim();
  if (Bun.env.APP_UI_BUN_REVISION && Bun.env.APP_UI_BUN_REVISION !== bunRevision)
    throw new Error("Selected Bun revision must match the canonical checkout HEAD");
  const docsFile = resolve(import.meta.dir, "../../build/docs-catalog.json");
  if (!(await Bun.file(docsFile).exists())) await import("./scripts/docs-catalog.ts");
  if (Bun.env.APP_UI_DOCS_CATALOG && resolve(Bun.env.APP_UI_DOCS_CATALOG) !== resolve(docsFile))
    throw new Error("APP_UI_DOCS_CATALOG must match the canonical Bun transfer receipt");
  // Check both outputs before bundling imports the generated wasm-bindgen glue.
  // This build does not start a competing native compiler implicitly.
  const webosPackage = dirname(dirname(fileURLToPath(import.meta.resolve("@aphrody/webos-wasm"))));
  const webosWasm = join(webosPackage, "wasm", WEBOS_WASM_NAME);
  const webosGlue = join(dirname(webosWasm), "aphrody_webos_wasm.js");
  for (const artifact of [webosGlue, webosWasm]) {
    if (!(await Bun.file(artifact).exists()))
      throw new Error(
        `Missing WebOS build artifact ${artifact}; run bun run --cwd "${dirname(dirname(webosWasm))}" build:wasm through the serialized native build owner before building App UI`,
      );
  }
  await stageWebOsNotices(dirname(webosWasm));
  // SSR uses the same asset resolver as the browser bundle, with no CSS compiler in this process.
  await import("../identity/scripts/sprite.ts");
  const started = performance.now();
  const result = await buildM3({
    entry: config.entry,
    production: !dev,
    define: config.define,
    drop: config.drop,
    minify: config.minify,
    optimizeImports: config.optimizeImports,
    outdir,
    // Browser and native hosts consume the same fixed App UI artifact layout.
    tauri: { uiDist: outdir },
    plugin: false,
    plugins: [m3Bun({ theme: config.theme, root: config.root, configDir: config.dir }), undeclaredDependencies],
    cwd: config.dir,
  });
  // The Rust WebAssembly backend ships next to app.js.
  await Bun.write(join(result.outdir, "wasm", WEBOS_WASM_NAME), Bun.file(webosWasm));
  await Bun.write(join(result.outdir, "wasm", "LICENSE-APACHE"), Bun.file(join(dirname(webosWasm), "LICENSE-APACHE")));
  const bytes = result.outputs.reduce((sum, output) => sum + output.bytes, 0);
  // Preserve the bundler's rewritten script, stylesheet and asset references.
  let shell = (await Bun.file(join(result.outdir, TAURI_LAYOUT.html)).text()).replace(
    '<base href="/"',
    `<base href="${base}"`,
  );
  await Bun.write(join(result.outdir, "index.html"), shell);
  if (values.out) {
    // Web artifacts keep stable file names: version the entry URLs in the no-cache shell so a
    // deployment never pairs a cached app.js (wasm-bindgen glue) with a newer .wasm.
    const hasher = new Bun.CryptoHasher("sha256");
    const parts = await Promise.all(
      ["app.js", "app.css", join("wasm", WEBOS_WASM_NAME)].map(file => Bun.file(join(result.outdir, file)).bytes()),
    );
    for (const part of parts) hasher.update(part);
    const version = hasher.digest("hex").slice(0, 12);
    shell = shell.replace(/(\.\/app\.(?:js|css))"/g, `$1?v=${version}"`);
    await Bun.write(`${result.outdir}/index.html`, shell);
  }
  if (assets) {
    const cssFile = join(result.outdir, "app.css");
    const css = (await Bun.file(cssFile).text()).replace(
      /url\((?:["'])?\.\/fonts\/([^"'()]+\.woff2)(?:["'])?\)/g,
      (_match, file: string) =>
        `url("${assets.localFontFallbacks.includes(file) ? "./fonts/" + file : publicFontUrl(file, assets.baseUrl)}")`,
    );
    await Bun.write(cssFile, css);
    await Bun.write(
      join(result.outdir, "fonts.css"),
      ["core", "jp"]
        .map(sheet => renderPublicStylesheet(assets.baseUrl, sheet as "core" | "jp" | "symbols"))
        .join("\n"),
    );
    await Bun.write(
      join(result.outdir, "public-assets.json"),
      JSON.stringify({ schemaVersion: 1, baseUrl: assets.baseUrl }) + "\n",
    );
    const trimmed = prunePublicFontCopies(
      result.outdir,
      [css, await Bun.file(join(result.outdir, "fonts.css")).text()],
      assets.baseUrl,
    );
    console.log(
      `public fonts: removed ${trimmed.files} duplicate WOFF2 files, ${trimmed.bytes} B; retained declared local glyph fallback`,
    );
  }
  // Register the process-wide CSS resolver only after Bun.build has finished. Keeping a global
  // M3 resolver active while buildM3 installs its composed Tailwind/M3 plugins recurses on app.css.
  Bun.plugin(
    m3Plugin({
      root: config.root,
      configDir: config.dir,
      tailwind: false,
      sass: false,
    }),
  );
  const { ProductSearchHome } = await import("./src/routes/product/ProductSearchHome");
  const home = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ProductSearchHome, {
        publicPreview: true,
        assetBase: assets?.baseUrl,
      }),
    ),
  ).replaceAll(
    /(?<![:\w/\\])(?:[A-Za-z]:[\\/]|\/)[^"<>]*?([\\/])(?:icon-(?:64|128|192)\.png|spritesheet\.webp)/g,
    path => `./fonts/${path.split(/[\\/]/).pop()}`,
  );
  await Promise.all(
    ["icon-64.png", "icon-128.png", "icon-192.png", "spritesheet.webp"].map(async name => {
      const source = join(import.meta.dir, "../identity", name === "spritesheet.webp" ? "dist" : "assets", name);
      await Bun.write(join(result.outdir, "fonts", name), Bun.file(source));
    }),
  );
  const publicHome = shell
    .replace(
      "<title>Aphrody OS</title>",
      '<title>Aphrody — Search, workspace and native OS</title><meta name="description" content="Search the web with Aphrody and explore the shared browser and desktop workspace, documentation, templates and Material 3 components."><link rel="canonical" href="https://aphrody.com/">',
    )
    .replace('<div id="root"></div>', `<div id="root">${home}</div>`);
  await Bun.write(`${result.outdir}/public-home.html`, publicHome);
  const docsBytes = await Bun.file(docsFile).text();
  const docs: Array<{
    id: string;
    title: string;
    summary: string;
    content: string;
  }> = JSON.parse(docsBytes);
  await Bun.write(join(result.outdir, "public-docs.json"), docsBytes);
  await Promise.all(
    docs.map(async article => {
      const prose = Bun.markdown
        .html(article.content)
        .replace(/<h1([^>]*)>/g, '<h1$1 class="text-headline-large">')
        .replace(/<h2([^>]*)>/g, '<h2$1 class="text-headline-small">')
        .replace(/<h3([^>]*)>/g, '<h3$1 class="text-title-large">');
      const document = shell
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(
          "<title>Aphrody OS</title>",
          `<title>${escape(article.title)} — Aphrody</title><meta name="description" content="${escape(article.summary)}"><link rel="canonical" href="https://aphrody.com/docs/${article.id}">`,
        )
        .replace(
          '<div id="root"></div>',
          `<div id="root"><main class="min-h-screen bg-surface p-6 text-on-surface"><nav class="mx-auto mb-8 flex max-w-3xl flex-wrap gap-6"><a class="text-primary underline" href="/">Aphrody</a><a class="text-primary underline" href="/docs">Bun documentation</a><a class="text-primary underline" href="/os">Open Aphrody OS</a></nav><article class="mx-auto max-w-3xl space-y-6 text-body-large">${prose}</article></main></div>`,
        );
      await Bun.write(join(result.outdir, "public-docs", article.id + ".html"), document);
    }),
  );
  console.log(
    `app-ui build: ${result.outputs.length} files, ${bytes} B into ${result.outdir} in ${Math.round(performance.now() - started)} ms`,
  );
}
