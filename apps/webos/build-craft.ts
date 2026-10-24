// SPDX-License-Identifier: Apache-2.0
// Compiles the Craft browser apps (egui/eframe, wasm32) and lays them out as installable packages in
// out/craft/<id>/. Cargo runs once for all apps so shared dependencies compile one time; the pinned
// wasm-bindgen and Binaryen of the web-emulation lock produce and shrink the modules.
//   bun build-craft.ts [id ...]
import { cp } from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadConfig, runNative } from "@aphrody/bun-workspace";
import { listLibraries } from "@aphrody/bun-workspace/libraries";

if (process.platform !== "linux")
  throw new Error("Build Craft WebAssembly apps on the Linux VPS factory.");

const root = resolve(import.meta.dir, "../..");
const fontRoot = resolve(Bun.env.CRAFT_FONTS_DIR ?? root);
const fontNotices = new Map<string, string>();
/** Entries of fonts/manifest.txt, for the apps that fetch fonts at run time instead of embedding them. */
const manifestFonts: {
  family: string;
  style: string;
  path: string;
  notice: string;
  hash: string;
}[] = [];
for (const manifest of ["fonts/manifest.txt", "fonts/latin-manifest.txt"]) {
  const text = await Bun.file(join(fontRoot, manifest)).text();
  fontNotices.set(manifest, text);
  for (const line of text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))) {
    const fields = line.split(" | ").map((field) => field.trim());
    const [path, notice, hash] = [fields[2], fields[5], fields[6]];
    for (const value of [path, notice])
      if (!value || value.split(/[\\/]/).some((part) => !part || part === ".."))
        throw new Error(`${manifest}: invalid font or notice path`);
    const bytes = await Bun.file(join(fontRoot, path!)).bytes();
    if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== hash)
      throw new Error(`${path}: font content does not match its manifest`);
    fontNotices.set(notice!, await Bun.file(join(fontRoot, notice!)).text());
    if (manifest === "fonts/manifest.txt")
      manifestFonts.push({
        family: fields[0]!,
        style: fields[1]!,
        path: path!,
        notice: notice!,
        hash: hash!,
      });
  }
}
const out = join(import.meta.dir, "out/craft");
const work = join(root, "build/web-craft");
const lock = JSON.parse(
  await Bun.file(
    join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json"),
  ).text(),
);

interface Craft {
  id: string;
  crate: string;
  glyph: string;
  /** Library crates ship their own static page in apps/<crate>/web/ instead of a Trunk index.html. */
  web?: boolean;
  /**
   * Fonts the page fetches next to itself: "manifest" serves fonts/manifest.txt and every file it
   * lists (photocraft-web's served fonts); a single face is copied under the name the page requests
   * (lightcraft-web, as crates/lightcraft-xtask/src/web.rs bundles it); a list file names the faces
   * fetched from fonts/<first 16 hex digits of the sha256>/<file> with their notice beside them
   * (vectorcraft-web, as `cargo xtask web-fonts` copies crates/vectorcraft-text/web-fonts.txt).
   */
  servedFonts?:
    | "manifest"
    | { list: string }
    | { family: string; style: string; file: string; notice: string };
  /** Other files of apps/<crate>/ the hand-written page loads (lightcraft-web's render worker). */
  files?: string[];
}
const ALL: Craft[] = [
  {
    id: "pdf",
    crate: "pdfcraft-web",
    glyph: "PDF",
  },
  {
    id: "word",
    crate: "wordcraft-web",
    glyph: "Doc",
  },
  {
    id: "grid",
    crate: "gridcraft-web",
    glyph: "Tbl",
  },
  {
    id: "deck",
    crate: "deckcraft-web",
    glyph: "Sld",
  },
  {
    id: "photo",
    crate: "photocraft-web",
    glyph: "Img",
    servedFonts: "manifest",
  },
  {
    id: "vector",
    crate: "vectorcraft-web",
    glyph: "Vec",
    servedFonts: { list: "crates/vectorcraft-text/web-fonts.txt" },
  },
  {
    id: "design",
    crate: "designcraft-web",
    glyph: "Lay",
  },
  {
    id: "fig",
    crate: "figcraft-web",
    glyph: "UI",
  },
  {
    id: "sound",
    crate: "soundcraft-web",
    glyph: "Aud",
  },
  {
    id: "cad",
    crate: "cadcraft-web",
    glyph: "CAD",
  },
  {
    id: "film",
    crate: "filmcraft-web",
    glyph: "Vid",
    web: true,
  },
  {
    id: "effect",
    crate: "effectcraft-web",
    glyph: "FX",
    web: true,
  },
  {
    id: "light",
    crate: "lightcraft-web",
    glyph: "Lgt",
    files: ["worker.js"],
    servedFonts: {
      family: "Noto Sans CJK SC",
      style: "Regular",
      file: "lightcraft_zh_hans.otf",
      notice: "OFL-noto-sans-cjk-sc.txt",
    },
  },
];
const wanted = Bun.argv.slice(2);
const unknown = wanted.filter((id) => !ALL.some((app) => app.id === id));
if (unknown.length)
  throw new Error(`Unknown Craft app IDs: ${unknown.join(", ")}`);
const apps = wanted.length ? ALL.filter((a) => wanted.includes(a.id)) : ALL;
const config = await loadConfig();
const configuredLibraries = new Map(
  listLibraries(config).map((library) => [library.id, library]),
);
for (const app of apps) {
  const libraryId = app.crate.replace(/-web$/, "");
  const library = configuredLibraries.get(libraryId);
  if (!library)
    throw new Error(
      `${app.crate} has no configured Aphrody library owner (${libraryId}).`,
    );
  if (library.capability.webosPackageId !== `craft-${app.id}`)
    throw new Error(
      `${libraryId} must map to craft-${app.id} in the common capability catalog.`,
    );
}

async function run(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(`${cmd.slice(0, 4).join(" ")} exited with ${code}`);
}

function prepareTrunkHtml(source: string, app: Craft, bin: string): string {
  let hasRustLink = false;
  const html = source.replace(/<link\b[^>]*\bdata-trunk\b[^>]*>/gi, (tag) => {
    const rel = /\brel="([^"]+)"/i.exec(tag)?.[1];
    if (rel === "rust") {
      hasRustLink = true;
      return `<script type="module">import init from "./${bin}.js"; await init({ module_or_path: "./${bin}_bg.wasm" });</script>`;
    }
    if (rel === "css") return '<link rel="stylesheet" href="./theme.css" />';
    if (rel === "icon") return '<link rel="icon" href="./aphrody-icon.png" />';
    if (rel === "copy-file") return "";
    throw new Error(`${app.crate}: unsupported Trunk asset ${tag}`);
  });
  if (!hasRustLink)
    throw new Error(`${app.crate}: no Trunk rust link found in index.html`);
  return html;
}

function findFile(dir: string, name: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
}

async function tool(
  name: "wasm-bindgen" | "binaryen",
  exe: string,
): Promise<string> {
  const pin = {
    version: lock.tools[name].version,
    ...lock.tools[name].platforms[`${process.platform}-${process.arch}`],
  };
  const dir = join(work, "tools", `${name}-${pin.version}`);
  const found = existsSync(dir) ? findFile(dir, exe) : undefined;
  if (found) return found;
  mkdirSync(dir, { recursive: true });
  const bytes = await (await fetch(pin.url)).bytes();
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error(`${name}: sha256 does not match the lock`);
  await new Bun.Archive(bytes).extract(dir);
  return findFile(dir, exe)!;
}

// Explicit feature list: --all-features also enables compact imports, which browsers cannot load.
const FEATURES = [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
  "--enable-simd",
];
const buildCode = await runNative(
  config,
  [
    "cargo",
    "build",
    "--locked",
    "--jobs",
    "4",
    "--target",
    "wasm32-unknown-unknown",
    "--profile",
    "web-craft",
    ...apps.flatMap((a) => ["-p", a.crate]),
  ],
  {
    cwd: root,
    runtimePolicy: "development",
    timeoutMs: 1_800_000,
    env: {
      CARGO_BUILD_JOBS: "4",
      CRAFT_FONTS_DIR: fontRoot,
      CRAFT_FONTS_REQUIRED: "1",
    },
  },
);
if (buildCode !== 0)
  throw new Error(`Craft Cargo build exited with ${buildCode}`);

// runNative owns this shared Cargo target directory.
const targetDir = join(root, "target");
const bindgen = await tool("wasm-bindgen", "wasm-bindgen");
const wasmOpt = await tool("binaryen", "wasm-opt");
const shellDir = join(work, "m3-shell");
await run(["bun", "scripts/craft-web-shell.ts", apps[0]!.crate, shellDir]);
if (wanted.length) {
  // A package-qualified build replaces only those packages; the other studios stay installable.
  for (const app of apps)
    rmSync(join(out, app.id), { recursive: true, force: true });
} else {
  rmSync(out, { recursive: true, force: true });
}
const index: {
  id: string;
  name: string;
  glyph: string;
  description: string;
  version: string;
}[] = [];
if (wanted.length) {
  const catalog = Bun.file(join(out, "index.json"));
  if (await catalog.exists()) {
    try {
      const previous = (await catalog.json()) as typeof index;
      const selected = new Set(apps.map((app) => app.id));
      index.push(...previous.filter((entry) => !selected.has(entry.id)));
    } catch {
      throw new Error(
        "Existing Craft catalog is invalid; refusing to replace it with a partial catalog.",
      );
    }
  }
}
for (const app of apps) {
  const bin = app.crate.replaceAll("-", "_");
  const release = join(targetDir, "wasm32-unknown-unknown/web-craft");
  // With a split build directory cargo writes the final artifact under release/build/<package>/<hash>/out.
  const raw =
    [`${bin}.wasm`, `${app.crate}.wasm`]
      .map((n) => join(release, n))
      .find(existsSync) ??
    findFile(join(release, "build"), `${bin}.wasm`) ??
    join(release, `${bin}.wasm`);
  if (!existsSync(raw))
    throw new Error(`${app.crate}: ${raw} was not produced`);
  const dest = join(out, app.id);
  mkdirSync(dest, { recursive: true });
  await run([
    bindgen,
    "--target",
    "web",
    "--out-dir",
    dest,
    "--out-name",
    bin,
    "--no-typescript",
    raw,
  ]);
  const bound = join(dest, `${bin}_bg.wasm`);
  await run([
    wasmOpt,
    "-Oz",
    ...FEATURES,
    "--strip-debug",
    "--strip-producers",
    bound,
    "-o",
    bound,
  ]);
  if (app.web) {
    await cp(join(root, "apps", app.crate, "web"), dest, { recursive: true });
    if (app.id === "effect") {
      for (const size of [256, 512]) {
        await cp(
          join(
            root,
            `assets/effectcraft/app-icon/hicolor/${size}x${size}/apps/ai.storyteller.effectcraft.png`,
          ),
          join(dest, `icon-${size}.png`),
        );
        await cp(
          join(
            root,
            `assets/effectcraft/app-icon/hicolor/${size}x${size}/apps/ai.storyteller.effectcraft.png.attribution`,
          ),
          join(dest, `icon-${size}.png.attribution`),
        );
      }
    }
  } else if (
    !(await Bun.file(join(root, "apps", app.crate, "Trunk.toml")).exists()) &&
    (
      await Bun.file(join(root, "apps", app.crate, "index.html")).text()
    ).includes('from "./' + bin + '.js"')
  ) {
    // Hand-written page: it imports ./<bin>.js itself, so ship the page unchanged.
    await Bun.write(
      join(dest, "index.html"),
      await Bun.file(join(root, "apps", app.crate, "index.html")).text(),
    );
    const web = join(root, "apps", app.crate, "web");
    if (existsSync(web)) await cp(web, dest, { recursive: true });
    for (const file of app.files ?? [])
      await cp(join(root, "apps", app.crate, file), join(dest, file));
  } else {
    // Trunk's <link data-trunk rel="rust"> becomes the module loader.
    const src = await Bun.file(
      join(root, "apps", app.crate, "index.html"),
    ).text();
    const html = prepareTrunkHtml(src, app, bin);
    await Bun.write(join(dest, "index.html"), html);
  }
  await cp(join(shellDir, "theme.css"), join(dest, "theme.css"));
  await cp(join(shellDir, "aphrody-icon.png"), join(dest, "aphrody-icon.png"));
  for (const [path, text] of fontNotices)
    await Bun.write(join(dest, "licenses", path), text);
  if (app.servedFonts === "manifest") {
    await cp(
      join(fontRoot, "fonts/manifest.txt"),
      join(dest, "fonts/manifest.txt"),
    );
    for (const font of manifestFonts)
      for (const path of [font.path, font.notice])
        await cp(join(fontRoot, path), join(dest, path));
  } else if (app.servedFonts && "list" in app.servedFonts) {
    // Faces the checkout lacks stay out, as build.rs leaves them out of WEB_FONTS.
    const list = await Bun.file(join(root, app.servedFonts.list)).text();
    for (const line of list.split(/\r?\n/).map((entry) => entry.trim())) {
      if (!line || line.startsWith("#")) continue;
      const [, family, style] = line.split(" | ").map((field) => field.trim());
      const font = manifestFonts.find(
        (entry) => entry.family === family && entry.style === style,
      );
      if (!font) continue;
      const folder = join(dest, "fonts", font.hash.slice(0, 16));
      await cp(join(fontRoot, font.path), join(folder, basename(font.path)));
      await cp(
        join(fontRoot, font.notice),
        join(folder, basename(font.notice)),
      );
    }
  } else if (app.servedFonts) {
    const { family, style, file, notice } = app.servedFonts;
    const font = manifestFonts.find(
      (entry) => entry.family === family && entry.style === style,
    );
    if (!font)
      throw new Error(
        `${app.crate}: fonts/manifest.txt lacks ${family} ${style}`,
      );
    await cp(join(fontRoot, font.path), join(dest, file));
    await cp(join(fontRoot, font.notice), join(dest, notice));
  }
  // A page's service worker precaches the package: fill in its file list and a version hashed from
  // the files, as the app's own `cargo xtask web` does (effectcraft-web's sw.js).
  const worker = Bun.file(join(dest, "sw.js"));
  if (
    (await worker.exists()) &&
    (await worker.text()).includes("__EC_FILES__")
  ) {
    const files = (
      await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dest }))
    )
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => file !== "sw.js")
      .sort();
    const version = new Bun.CryptoHasher("sha256");
    for (const file of files)
      version.update(file).update(await Bun.file(join(dest, file)).bytes());
    await Bun.write(
      worker,
      (await worker.text())
        .replace("__EC_VERSION__", version.digest("hex").slice(0, 16))
        .replace(
          "__EC_FILES__",
          JSON.stringify(["./", ...files.map((file) => `./${file}`)]),
        ),
    );
  }
  const cargo = await Bun.file(
    join(root, "apps", app.crate, "Cargo.toml"),
  ).text();
  const owner = configuredLibraries.get(app.crate.replace(/-web$/, ""));
  if (!owner)
    throw new Error(`${app.crate} lost its configured Aphrody library owner.`);
  index.push({
    id: app.id,
    name: owner.capability.title,
    glyph: app.glyph,
    description: owner.capability.description,
    version: /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? "0.0.0",
  });
  console.log(`${app.id}: ${(Bun.file(bound).size / 1048576).toFixed(1)} MB`);
}
index.sort(
  (a, b) =>
    ALL.findIndex((app) => app.id === a.id) -
    ALL.findIndex((app) => app.id === b.id),
);
await Bun.write(join(out, "index.json"), JSON.stringify(index));
