#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the play.aphrody.app release on this workstation (no build runs on the VPS):
 *
 *   dist/server.js                       Bun server bundle (target bun)
 *   dist/public/                         client (Bun.build HTML entry + M3 plugin), hashed /assets/
 *   dist/public/stream-client/index.html the unchanged packages/bun-gamestream client
 *   dist/public/catalog.json, roms/      public catalog: Bun Engine systems + free ROM packs only
 *   dist/public/emulation/               dist/web-emulation/<core>/ when published (else empty)
 *   dist/public/assets/art/              libretro-thumbnails and Systematic icons (scripts/art.ts)
 *   dist/nginx/engine.conf               nginx engine template (infra/config/host/nginx/play)
 *   dist/packages/bun-engine/plugins/    data files the bundled Bun Engine frontend reads
 *
 * Usage: bun apps/play/scripts/build.ts
 */
import type { BunPlugin } from "bun";
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { m3Plugin } from "@aphrody/m3/plugin";
import { isPrivatePath } from "../../../packages/bun-engine/src/owned/guard";
import { ArtBuilder, displayTitle } from "./art";

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");
const dist = join(app, "dist");
const publicDir = join(dist, "public");
const naming = {
  chunk: "assets/[name]-[hash].[ext]",
  asset: "assets/[name]-[hash].[ext]",
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

function check(
  result: Awaited<ReturnType<typeof Bun.build>>,
  what: string,
): void {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`${what} build failed`);
  }
}

// ---------------------------------------------------------------- client
const theme = m3Plugin({ theme: { seed: "#6750a4", variant: "tonalSpot" } });
check(
  await Bun.build({
    entrypoints: [join(app, "src", "client", "index.html")],
    outdir: publicDir,
    naming: { entry: "[name].[ext]", ...naming },
    publicPath: "/",
    target: "browser",
    minify: true,
    sourcemap: "none",
    plugins: [theme],
  }),
  "client",
);
check(
  await Bun.build({
    entrypoints: [
      join(repo, "packages", "bun-gamestream", "src", "client", "index.html"),
    ],
    outdir: publicDir,
    naming: { entry: "stream-client/[name].[ext]", ...naming },
    publicPath: "/",
    target: "browser",
    minify: true,
  }),
  "gamestream client",
);

// ---------------------------------------------------------------- catalog (free packs only)
interface SystemDefinition {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  dats: string[];
  native?: { machine: string };
}
const consoles = join(repo, "packages", "bun-engine", "plugins", "consoles");
const { systems } = JSON.parse(
  readFileSync(join(consoles, "systems.json"), "utf8"),
) as {
  systems: SystemDefinition[];
};
const { packs } = JSON.parse(
  readFileSync(join(consoles, "roms.json"), "utf8"),
) as {
  packs: { id: string; kind: string; license: string }[];
};
const packById = new Map(packs.map((pack) => [pack.id, pack]));
const libraryDb = join(repo, "usr", "var", "lib", "bep", "library.db");
const rows = existsSync(libraryDb)
  ? (new Database(libraryDb, { readonly: true })
      .query(
        "SELECT system, path, name, title, size, md5, source, description, dat FROM games WHERE source LIKE 'free:%' AND md5 IS NOT NULL ORDER BY system, COALESCE(title, name)",
      )
      .all() as {
      system: string;
      path: string;
      name: string;
      title: string | null;
      size: number;
      md5: string;
      source: string;
      description: string | null;
      dat: string | null;
    }[])
  : [];
const art = new ArtBuilder(join(app, ".cache"), publicDir);
const playlistOf = (dat: string) => basename(dat).replace(/\.dat$/, "");
mkdirSync(join(publicDir, "roms"), { recursive: true });
const games = [];
for (const row of rows) {
  if (!existsSync(row.path)) continue;
  // Only free ROMs are published; the owner's private dump store never is.
  if (isPrivatePath(row.path))
    throw new Error(`refusing to publish a private dump: ${row.path}`);
  const rom = `/roms/${row.md5}${extname(row.path).toLowerCase()}`;
  cpSync(row.path, join(publicDir, rom));
  const pack = packById.get(row.source.slice("free:".length));
  // A DAT title when the library matched one; else the first line of the pack's own notes.
  const notesTitle = row.description?.split("\n")[0]?.trim();
  const title = row.title
    ? displayTitle(row.title)
    : notesTitle && notesTitle.length <= 40 && !/[.:]$/.test(notesTitle)
      ? notesTitle
      : row.name;
  let capsule = null;
  let hero = null;
  if (row.title && row.dat) {
    const playlist = playlistOf(row.dat);
    const [boxart, snap, titleScreen] = await Promise.all(
      (["boxart", "snap", "title"] as const).map((kind) =>
        art.thumbnail(playlist, row.title!, kind, row.md5),
      ),
    );
    capsule = boxart ?? titleScreen ?? snap;
    hero = snap ?? titleScreen;
  }
  games.push({
    id: row.md5,
    system: row.system,
    title,
    size: row.size,
    rom,
    source: pack?.id ?? row.source,
    kind: pack?.kind ?? "homebrew",
    license: pack?.license ?? null,
    art: { capsule, hero },
  });
}
const counts = new Map<string, number>();
for (const game of games)
  counts.set(game.system, (counts.get(game.system) ?? 0) + 1);
const catalogSystems = [];
for (const system of systems) {
  // Systematic icons are named after libretro playlists: the system's DATs, else "<maker> - <name>".
  const names = [
    ...system.dats.map(playlistOf),
    `${system.manufacturer} - ${system.name}`,
  ];
  const icon = await art.systemIcon(names, system.id);
  catalogSystems.push({
    id: system.id,
    name: system.name,
    manufacturer: system.manufacturer,
    year: system.year,
    native: system.native?.machine ?? null,
    games: counts.get(system.id) ?? 0,
    icon: icon?.image ?? null,
  });
}
await Bun.write(
  join(publicDir, "catalog.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    systems: catalogSystems,
    games,
  }),
);

// ---------------------------------------------------------------- web emulation cores
// Only real cores published by the web emulation owner; none means "no core published yet".
const emulation = join(repo, "dist", "web-emulation");
if (existsSync(emulation))
  cpSync(emulation, join(publicDir, "emulation"), { recursive: true });
else mkdirSync(join(publicDir, "emulation"), { recursive: true });

// ---------------------------------------------------------------- server
/** The bundled Bun Engine modules resolve their data next to their own source: PLAY_ROOT mirrors it. */
const releasePaths: BunPlugin = {
  name: "play-release-paths",
  setup(build) {
    build.onLoad(
      {
        filter:
          /[\\/]packages[\\/](bun-engine|bun-os-platform|bun-loaders)[\\/].*\.ts$/,
      },
      async (args) => {
        const dir = relative(repo, dirname(args.path)).replaceAll("\\", "/");
        const file = `${dir}/${basename(args.path)}`;
        const contents = (await Bun.file(args.path).text())
          .replaceAll(
            "import.meta.dir",
            `(process.env.PLAY_ROOT + ${JSON.stringify(`/${dir}`)})`,
          )
          .replaceAll(
            "import.meta.url",
            `Bun.pathToFileURL(process.env.PLAY_ROOT + ${JSON.stringify(`/${file}`)}).href`,
          );
        return { contents, loader: "ts" };
      },
    );
  },
};
check(
  await Bun.build({
    entrypoints: [join(app, "src", "server", "main.ts")],
    outdir: dist,
    naming: "server.js",
    target: "bun",
    minify: { syntax: true, whitespace: true },
    plugins: [releasePaths],
  }),
  "server",
);
cpSync(consoles, join(dist, "packages", "bun-engine", "plugins", "consoles"), {
  recursive: true,
});
// Platform paths resolve beside their original module, including after bundling.
for (const directory of ["locales", "themes", "plugins"]) {
  cpSync(
    join(repo, "packages", "bun-os-platform", directory),
    join(dist, "packages", "bun-os-platform", directory),
    { recursive: true },
  );
}
// Built-ins and their lazy capability owners are loaded by path, outside the server graph.
// Preserve manifest entry paths, emitting self-contained Bun JavaScript at each one.
for (const entry of [
  "packages/bun-os-platform/plugins/bun-engine/index.ts",
  "packages/bun-os-platform/plugins/bun-loaders/index.ts",
  "packages/bun-engine/src/formats/index.ts",
  "packages/bun-engine/src/plugins/consoles.ts",
  "packages/bun-loaders/src/index.ts",
]) {
  check(
    await Bun.build({
      entrypoints: [join(repo, entry)],
      outdir: dirname(join(dist, entry)),
      naming: basename(entry),
      target: "bun",
      minify: { syntax: true, whitespace: true },
      plugins: [releasePaths],
    }),
    entry,
  );
}
mkdirSync(join(dist, "nginx"), { recursive: true });
cpSync(
  join(repo, "infra", "config", "host", "nginx", "play", "engine.conf"),
  join(dist, "nginx", "engine.conf"),
);

const size = (path: string) => Bun.file(path).size;
console.log(
  JSON.stringify(
    {
      dist,
      server: size(join(dist, "server.js")),
      games: games.length,
      systems: systems.length,
      emulation: existsSync(emulation)
        ? "dist/web-emulation"
        : "none published",
      avif: art.avif,
      art: games.filter((game) => game.art.capsule).length,
      systemIcons: catalogSystems.filter((system) => system.icon).length,
    },
    null,
    2,
  ),
);
