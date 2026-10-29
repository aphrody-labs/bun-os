// SPDX-License-Identifier: Apache-2.0
// Builds dist/: the bundled shell, the OPFS file-system wasm, the M3 tokens and the workspace catalog.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { themeCss } from "./src/themes";
import { buildPackages } from "./packages";
import { buildSeo } from "./seo";
import { stageVm } from "./vm";
import { buildDocs } from "./docs";
import { stageWorkspace, stageWorkspaceCatalogs } from "./workspace";
import { stageGamesContent } from "./games-content";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";
import { APPS, ROUTES, appPath, type MemberKind } from "./src/config";

const root = resolve(import.meta.dir, "../..");
const dist = join(import.meta.dir, "dist");

interface Entry {
  id: string;
  d: string;
  k?: string;
}

/** How a monorepo app runs in the desktop (src/apps/member.ts renders the non-web kinds). */
interface AppEntry extends Entry {
  run: MemberKind;
  opens?: string;
  related?: string;
  artifact?: string;
  readme?: boolean;
}

const tomlDesc = (text: string) => {
  const line = text.split("\n").find((l) => l.startsWith("description"));
  const start = line?.indexOf('"') ?? -1;
  const end = line?.lastIndexOf('"') ?? -1;
  return line && end > start
    ? line
        .slice(start + 1, end)
        .split(String.fromCharCode(92, 34))
        .join('"')
    : "";
};

async function scan(
  dir: string,
  read: (path: string) => Promise<{ d: string; k?: string } | undefined>,
) {
  const tracked = Bun.spawnSync(["git", "ls-files", "--", dir], { cwd: root });
  if (tracked.exitCode !== 0)
    throw new Error(
      `Could not list tracked ${dir} sources for the product catalog`,
    );
  const trackedChildren = new Set(
    new TextDecoder()
      .decode(tracked.stdout)
      .split("\n")
      .filter(Boolean)
      .map((path) => path.split("/")[1]),
  );
  const out: Entry[] = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    if (
      !e.isDirectory() ||
      e.name.startsWith(".") ||
      !trackedChildren.has(e.name)
    )
      continue;
    const meta = await read(join(root, dir, e.name));
    if (meta) out.push({ id: e.name, ...meta });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Every tracked member of apps/ is an app of the desktop; its manifests only refine the description and kind.
const capabilities = allAppCapabilities();
/** Craft family of a member: pdfcraft, pdfcraft-web and pdfcraft-cli all belong to the pdfcraft capability. */
const familyOf = (id: string) => {
  const base = id.replace(/(-web-app|-web|-cli|-server|_native)$/, "");
  return capabilities.find((capability) => capability.libraryId === base);
};
const readmes = new Map<string, string>();
const scanned = await scan("apps", async (p) => {
  const pkg = Bun.file(join(p, "package.json"));
  const cargo = Bun.file(join(p, "Cargo.toml"));
  const html = Bun.file(join(p, "index.html"));
  const trunk = Bun.file(join(p, "Trunk.toml"));
  let d = "";
  if (await pkg.exists()) d = (await pkg.json()).description ?? "";
  if (!d && (await cargo.exists())) d = tomlDesc(await cargo.text());
  const kind =
    (await html.exists()) || (await trunk.exists())
      ? "web"
      : (await pkg.exists())
        ? "js"
        : (await cargo.exists())
          ? "native"
          : "source";
  const readme = join(p, "README.md");
  if (await Bun.file(readme).exists()) readmes.set(p, readme);
  return { d, k: kind };
});
const apps: AppEntry[] = scanned.map((entry) => {
  const config = APPS.members[entry.id] ?? {};
  const family = familyOf(entry.id);
  const run: MemberKind =
    config.kind ??
    (entry.id.endsWith("-cli")
      ? "cli"
      : entry.id.endsWith("-server")
        ? "server"
        : entry.id.endsWith("-web") && family?.webosPackageId
          ? "web"
          : "native");
  const opens =
    config.opens ?? (run === "web" ? family?.webosPackageId : undefined);
  const related =
    config.related ??
    (opens ? undefined : (family?.webosPackageId ?? (family && "creative")));
  return {
    ...entry,
    d: config.desc ?? (entry.d || family?.description || ""),
    run,
    ...(opens ? { opens } : {}),
    ...(related ? { related } : {}),
    ...(config.artifact ? { artifact: config.artifact } : {}),
    ...(readmes.has(join(root, "apps", entry.id)) ? { readme: true } : {}),
  };
});
for (const id of Object.keys(APPS.members))
  if (!apps.some((entry) => entry.id === id))
    throw new Error(
      `apps.json declares ${id}, which is not a tracked apps/ member`,
    );

const packages = await scan("packages", async (p) => {
  const pkg = Bun.file(join(p, "package.json"));
  if (!(await pkg.exists())) return undefined;
  const j = await pkg.json();
  return { d: j.description ?? "" };
});

const crates = await scan("crates", async (p) => {
  const cargo = Bun.file(join(p, "Cargo.toml"));
  if (!(await cargo.exists())) return undefined;
  return { d: tomlDesc(await cargo.text()) };
});

// Application identities (docs/APP-DOMAINS.md): canonical host, library alias and the aphrody.com path that
// both redirect to, all derived from the capability catalog and infra/config/routes.catalog.json.
const hosts: Record<
  string,
  { name: string; host: string; alias: string; path?: string; app?: string }
> = {};
for (const capability of capabilities) {
  const host = `app-${capability.id}`;
  const route = Object.entries(ROUTES.hosts).find(
    ([name]) => name.split(".")[0] === host,
  )?.[1];
  const app = route?.path ? ROUTES.apps[route.path] : undefined;
  hosts[capability.libraryId] = {
    name: capability.title,
    host,
    alias: capability.libraryId,
    ...(route?.path ? { path: route.path } : {}),
    ...(app ? { app } : {}),
  };
  if (capability.webosPackageId && !appPath(capability.webosPackageId))
    throw new Error(
      `${capability.webosPackageId} has no deep-link path in routes.catalog.json`,
    );
}

const catalog = {
  generated: new Date().toISOString(),
  counts: {
    apps: apps.length,
    packages: packages.length,
    crates: crates.length,
  },
  apps,
  packages,
  crates,
  hosts,
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "wasm"), { recursive: true });

// The default desktop theme paints before the shell script runs; Settings swaps it at runtime.
const tokens = [
  await Bun.file(join(root, "packages/m3-tokens/src/m3-tokens.css")).text(),
  await Bun.file(join(root, "packages/m3-tokens/src/expressive.css")).text(),
  themeCss("aphrody"),
].join("\n");
await Bun.write(join(dist, "m3.css"), tokens);

// Build identity for Settings > About: commit, time and the versions of the shell's direct libraries.
const commit =
  process.env.WEBOS_COMMIT ??
  new TextDecoder()
    .decode(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout)
    .trim();
const versionOf = async (path: string) => {
  const file = Bun.file(join(root, path, "package.json"));
  return (await file.exists()) ? String((await file.json()).version) : "";
};
const buildInfo = {
  commit: commit || "unknown",
  built: new Date().toISOString(),
  version: await versionOf("apps/webos"),
  bun: Bun.version,
  materialWeb: await versionOf("node_modules/@aphrody/material-web"),
  m3Tokens: await versionOf("packages/m3-tokens"),
  colorUtils: await versionOf(
    "node_modules/@material/material-color-utilities",
  ),
  webosWasm: await versionOf("packages/webos-wasm"),
};

const result = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "src/main.ts"),
    join(import.meta.dir, "src/sw.ts"),
    join(import.meta.dir, "src/boot.ts"),
  ],
  outdir: dist,
  target: "browser",
  minify: true,
  // Lit and other packages ship a dev build unless NODE_ENV is production at bundle time
  define: {
    "process.env.NODE_ENV": '"production"',
    __WEBOS_BUILD__: JSON.stringify(JSON.stringify(buildInfo)),
  },
  sourcemap: "none",
  naming: "[name].js",
  splitting: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const wasmDir = join(root, "packages/webos-wasm/wasm");
await cp(
  join(wasmDir, "aphrody_webos_wasm_bg.wasm"),
  join(dist, "wasm/aphrody_webos_wasm_bg.wasm"),
);
// fend (MIT): the Calculator engine, instantiated by apps/calculator via apps/fend.ts.
await cp(join(root, "node_modules/fend-wasm/fend_wasm_bg.wasm"), join(dist, "wasm/fend_wasm_bg.wasm"));
await cp(join(root, "LICENSE-APACHE"), join(dist, "wasm/LICENSE-APACHE"));
// @aphrody/m3-fonts: Google Sans Flex / Code, Roboto Flex / Mono (Settings > Font) and the full Material Symbols
// Rounded font (catalog apps name any icon, so not the default subset of fonts-symbols.css).
const fontSrc = join(root, "packages/m3-fonts/fonts");
await mkdir(join(dist, "fonts"), { recursive: true });
for (const [from, to] of [
  ["web/GoogleSansFlex-latin.woff2", "GoogleSansFlex-latin.woff2"],
  ["web/GoogleSansCode-latin.woff2", "GoogleSansCode-latin.woff2"],
  ["web/RobotoFlex-latin.woff2", "RobotoFlex-latin.woff2"],
  ["web/RobotoMono-latin.woff2", "RobotoMono-latin.woff2"],
  ["web/RobotoMono-Italic-latin.woff2", "RobotoMono-Italic-latin.woff2"],
  [
    "upstream/material-symbols/material-symbols-rounded.woff2",
    "material-symbols-rounded.woff2",
  ],
])
  await cp(join(fontSrc, from!), join(dist, "fonts", to!));
const faces = (
  await Bun.file(join(root, "packages/m3-fonts/src/fonts.css")).text()
)
  .split("@font-face")
  .filter((f) =>
    /Google Sans (Flex|Code)|Roboto (Flex|Mono)/.test(f.split("}")[0]!),
  );
const symbols = (
  await Bun.file(join(root, "packages/m3-fonts/src/fonts-symbols-full.css")).text()
)
  .split("@font-face")
  .filter((f) => f.includes("Rounded"));
await Bun.write(
  join(dist, "fonts.css"),
  [...faces, ...symbols]
    .map((f) => "@font-face" + f.split("}")[0] + "}")
    .join(String.fromCharCode(10))
    .replaceAll("../fonts/web/", "/fonts/")
    .replaceAll("../fonts/upstream/material-symbols/", "/fonts/"),
);
// Brand: the Aphrody logo of apps/aphrody-app; file and device icons: packages/assets (SpaceUI/Spacedrive set).
await mkdir(join(dist, "brand"), { recursive: true });
await mkdir(join(dist, "icons"), { recursive: true });
for (const [from, to] of [
  ["apps/aphrody-app/icons/16x16.png", "16.png"],
  ["apps/aphrody-app/icons/32x32.png", "32.png"],
  ["apps/aphrody-app/icons/64x64.png", "64.png"],
  ["apps/aphrody-app/icons/128x128.png", "128.png"],
  ["apps/aphrody-app/icons/256x256.png", "256.png"],
  ["apps/aphrody-app/icons/icon.png", "1024.png"],
  ["apps/aphrody-app/icons/icon.ico", "favicon.ico"],
])
  await cp(join(root, from!), join(dist, "brand", to!));
const FILE_ICONS = [
  "Folder",
  "FolderGrey",
  "Document",
  "Document_pdf",
  "Document_doc",
  "Document_xls",
  "Text",
  "Text_txt",
  "Image",
  "Video",
  "Movie",
  "Audio",
  "Archive",
  "Application",
  "Terminal",
  "Database",
  "Package",
  "Game",
  "Home",
  "Drive",
  "HDD",
  "Trash",
  "Globe",
  "Server",
  "Link",
  "Key",
  "Lock",
  "Search",
  "Undefined",
  "Screenshot",
  "Book",
  "Collection",
  "Encrypted",
  "Devices",
  "Laptop",
  "Storage",
  "Widget",
  "Compute",
  "Node",
  "Mesh",
  "Album",
  "Scrapbook",
  "Tags",
  "Sync",
];
for (const name of FILE_ICONS)
  await cp(
    join(root, "packages/assets/icons", name + ".png"),
    join(dist, "icons", name + ".png"),
  );
const shortcut = (name: string, app: string, description: string) => ({
  name,
  short_name: name,
  description,
  url: appPath(app) ?? `/?app=${app}`,
  icons: [{ src: "/brand/192.png", sizes: "192x192", type: "image/png" }],
});
await Bun.write(
  join(dist, "manifest.webmanifest"),
  JSON.stringify({
    id: "/",
    name: "Aphrody Bun OS",
    short_name: "Bun OS",
    description:
      "A tiling desktop in your browser: files, terminal, browser, games and creative apps that work offline.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#11131d",
    theme_color: "#11131d",
    categories: ["productivity", "utilities", "developer"],
    icons: [
      {
        src: "/brand/192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      shortcut("Files", "files", "Your files, saved in this browser"),
      shortcut("Terminal", "terminal", "Command line in WebAssembly"),
      shortcut("Browser", "browser", "Browse the web in tabs"),
      shortcut("Apps", "apps", "Install games and creative apps"),
    ],
    screenshots: [
      {
        src: "/screens/wide.webp",
        sizes: "1475x812",
        type: "image/webp",
        form_factor: "wide",
        label: "Bun OS desktop with the welcome card, top bar and dock",
      },
      {
        src: "/screens/narrow.webp",
        sizes: "780x1688",
        type: "image/webp",
        form_factor: "narrow",
        label: "Bun OS home screen on a phone",
      },
    ],
  }),
);
// Shared sheet plus one sheet per app (src/apps/*.css), served as one file.
const sheets = [
  join(import.meta.dir, "src/styles.css"),
  ...(await readdir(join(import.meta.dir, "src/apps")))
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => join(import.meta.dir, "src/apps", f)),
];
await Bun.write(
  join(dist, "styles.css"),
  (await Promise.all(sheets.map((s) => Bun.file(s).text()))).join(
    String.fromCharCode(10),
  ),
);
await cp(join(import.meta.dir, "src/index.html"), join(dist, "index.html"));
await cp(join(import.meta.dir, "public"), dist, { recursive: true });
await stageWorkspace(dist, root);
await stageWorkspaceCatalogs(dist, root);
await Bun.write(join(dist, "catalog.json"), JSON.stringify(catalog));
// Member READMEs for the member window (src/apps/member.ts); served from /readme/<member>.md.
for (const [dir, file] of readmes)
  await Bun.write(join(dist, "readme", `${basename(dir)}.md`), Bun.file(file));
await stageVm(dist);
const docs = await buildDocs(dist);
console.log(
  `docs: ${Object.entries(docs)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}`,
);
const built = await buildPackages(dist);
await stageGamesContent(dist);
await buildSeo(dist, catalog);
console.log(`packages: ${built.map((p) => p.id).join(", ") || "none"}`);
console.log(
  `webos: ${apps.length} apps, ${packages.length} packages, ${crates.length} crates`,
);
