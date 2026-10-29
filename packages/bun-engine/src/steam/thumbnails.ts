// Real artwork for the Steam shortcuts, never generated: libretro-thumbnails (boxart, title
// screen, in-game snap, logo) matched to the game's libretro-database title, and Bun's own logo
// for the Bun Engine entry. A slot without real art stays empty so Steam keeps its default.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Game } from "../frontend/library";
import { repoRoot, usrRoot } from "../usr";

/** Paths of real image files for each Steam artwork slot. */
export interface Artwork {
  /** Portrait capsule `<id>p.png`: Named_Boxarts. */
  portrait?: string;
  /** Wide capsule `<id>.png`: Named_Titles. */
  wide?: string;
  /** Hero `<id>_hero.png`: Named_Snaps. */
  hero?: string;
  /** Logo `<id>_logo.png`: Named_Logos. */
  logo?: string;
  /** Icon `<id>_icon.png`. */
  icon?: string;
}

const SERVER = "https://thumbnails.libretro.com";
const KINDS = {
  portrait: "Named_Boxarts",
  wide: "Named_Titles",
  hero: "Named_Snaps",
  logo: "Named_Logos",
} as const;
const LISTING_TTL_MS = 7 * 86_400_000;

const cacheRoot = () => join(usrRoot(), "var", "cache", "bep", "thumbnails");

/** libretro-thumbnails file name of a title: &, *, /, :, backtick, <, >, ?, backslash, | and " become `_`. */
export const thumbnailName = (title: string) => title.replace(/[&*/:`<>?\\|"]/g, "_");

/** The Bun Engine press-kit art of this repository (assets/presskit). */
export function bunEngineArt(): Artwork {
  const assets = join(repoRoot, "assets", "presskit");
  const pick = (name: string) => {
    const path = join(assets, name);
    return existsSync(path) ? path : undefined;
  };
  return { icon: pick("logo-square.png"), logo: pick("logo@4x.png") };
}

/** File names of one playlist/kind: a local libretro-thumbnails tree or the server listing. */
async function listing(playlist: string, kind: string, local?: string): Promise<string[]> {
  if (local) {
    const dir = join(local, playlist, kind);
    return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(".png")) : [];
  }
  const cache = join(cacheRoot(), playlist, `${kind}.json`);
  if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < LISTING_TTL_MS) return Bun.file(cache).json();
  const res = await fetch(`${SERVER}/${encodeURIComponent(playlist)}/${kind}/`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return [];
  const names = [...(await res.text()).matchAll(/href="([^"?/]+\.png)"/g)].map(m => decodeURIComponent(m[1]!));
  mkdirSync(join(cacheRoot(), playlist), { recursive: true });
  await Bun.write(cache, JSON.stringify(names));
  return names;
}

/**
 * The thumbnail of `title`: the exact name, else the entries of the same base title (before the
 * first tag) ranked by how many of the title's No-Intro tags they share.
 */
export function matchThumbnail(title: string, names: string[]): string | undefined {
  const exact = `${thumbnailName(title)}.png`;
  if (names.includes(exact)) return exact;
  const base = thumbnailName(title.split(" (")[0]!).trim();
  const tags = [...title.matchAll(/\([^)]*\)/g)].map(m => m[0]);
  let best: { name: string; score: number } | undefined;
  for (const name of names) {
    if (name !== `${base}.png` && !name.startsWith(`${base} (`)) continue;
    const score = tags.filter(tag => name.includes(thumbnailName(tag))).length;
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name;
}

async function fetchThumbnail(
  playlist: string,
  kind: string,
  name: string,
  local?: string,
): Promise<string | undefined> {
  if (local) return join(local, playlist, kind, name);
  const path = join(cacheRoot(), playlist, kind, name);
  if (existsSync(path)) return path;
  const res = await fetch(`${SERVER}/${encodeURIComponent(playlist)}/${kind}/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return undefined;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Only real PNG files are kept.
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  mkdirSync(join(cacheRoot(), playlist, kind), { recursive: true });
  await Bun.write(path, bytes);
  return path;
}

/** Real libretro artwork of a library game matched through its libretro-database entry. */
export async function libretroArt(game: Game, local?: string): Promise<Artwork> {
  if (!game.dat || !game.title) return {};
  const playlist = basename(game.dat).replace(/\.dat$/i, "");
  const art: Artwork = {};
  for (const [slot, kind] of Object.entries(KINDS) as [keyof typeof KINDS, string][]) {
    const name = matchThumbnail(game.title, await listing(playlist, kind, local));
    if (name) art[slot] = await fetchThumbnail(playlist, kind, name, local);
  }
  return art;
}
