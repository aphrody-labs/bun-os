// SPDX-License-Identifier: MIT
// pacman sync database parser: <repo>.db and <repo>.files are (gzip|zstd) tar archives holding
// "<name>-<version>/desc" (and, in older databases, "depends" and "files") as %KEY% blocks.
import { decompress, readTar } from "./tar.ts";

export interface DbPackage {
  repo: string;
  name: string;
  base: string;
  version: string;
  description: string;
  url: string;
  arch: string;
  filename: string;
  csize: number;
  isize: number;
  sha256: string;
  md5: string;
  pgpsig: string;
  builddate: number;
  packager: string;
  licenses: string[];
  groups: string[];
  depends: string[];
  makedepends: string[];
  checkdepends: string[];
  optdepends: string[];
  provides: string[];
  conflicts: string[];
  replaces: string[];
  files: string[];
}

/** Parse "%KEY%\nvalue\n...\n\n" blocks into key -> lines. */
export function parseKeyBlocks(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let key: string | undefined;
  let lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 2 && line.charCodeAt(0) === 37 /* % */ && line.endsWith("%")) {
      if (key !== undefined) out.set(key, lines);
      key = line.slice(1, -1);
      lines = [];
    } else if (line !== "" && key !== undefined) {
      lines.push(line);
    }
  }
  if (key !== undefined) out.set(key, lines);
  return out;
}

const first = (m: Map<string, string[]>, k: string) => m.get(k)?.[0] ?? "";
const num = (m: Map<string, string[]>, k: string) => {
  const v = Number(first(m, k));
  return Number.isFinite(v) ? v : 0;
};
const list = (m: Map<string, string[]>, k: string) => m.get(k) ?? [];

export interface ParseDbOptions {
  repo: string;
  /** Keep %FILES% lists (only present in <repo>.files). */
  files?: boolean;
}

/** Parse a whole sync database. Throws on corrupt archives and on entries missing %NAME% or %VERSION%. */
export function parseDb(bytes: Uint8Array<ArrayBuffer>, options: ParseDbOptions): DbPackage[] {
  const tar = decompress(bytes);
  const dirs = new Map<string, { desc?: string; depends?: string; files?: string }>();
  const decoder = new TextDecoder();
  for (const entry of readTar(tar)) {
    if (entry.type !== "0" && entry.type !== "\0") continue;
    const slash = entry.name.lastIndexOf("/");
    if (slash < 0) continue;
    const dir = entry.name.slice(0, slash);
    const file = entry.name.slice(slash + 1);
    if (file !== "desc" && file !== "depends" && file !== "files") continue;
    if (file === "files" && !options.files) continue;
    const slot = dirs.get(dir) ?? {};
    slot[file] = decoder.decode(entry.data);
    dirs.set(dir, slot);
  }
  const out: DbPackage[] = [];
  for (const [dir, parts] of dirs) {
    if (parts.desc === undefined) throw new Error(`Corrupt database: ${dir} has no desc.`);
    const m = parseKeyBlocks(parts.desc);
    if (parts.depends) for (const [k, v] of parseKeyBlocks(parts.depends)) if (!m.has(k)) m.set(k, v);
    const name = first(m, "NAME");
    const version = first(m, "VERSION");
    if (!name || !version) throw new Error(`Corrupt database: ${dir} lacks %NAME% or %VERSION%.`);
    const files = parts.files ? list(parseKeyBlocks(parts.files), "FILES") : [];
    out.push({
      repo: options.repo,
      name,
      base: first(m, "BASE") || name,
      version,
      description: first(m, "DESC"),
      url: first(m, "URL"),
      arch: first(m, "ARCH"),
      filename: first(m, "FILENAME"),
      csize: num(m, "CSIZE"),
      isize: num(m, "ISIZE"),
      sha256: first(m, "SHA256SUM"),
      md5: first(m, "MD5SUM"),
      pgpsig: first(m, "PGPSIG"),
      builddate: num(m, "BUILDDATE"),
      packager: first(m, "PACKAGER"),
      licenses: list(m, "LICENSE"),
      groups: list(m, "GROUPS"),
      depends: list(m, "DEPENDS"),
      makedepends: list(m, "MAKEDEPENDS"),
      checkdepends: list(m, "CHECKDEPENDS"),
      optdepends: list(m, "OPTDEPENDS"),
      provides: list(m, "PROVIDES"),
      conflicts: list(m, "CONFLICTS"),
      replaces: list(m, "REPLACES"),
      files,
    });
  }
  return out;
}
