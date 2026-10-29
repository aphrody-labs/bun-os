// SPDX-License-Identifier: MIT
// Collect "our pins" from the repository: WSL/distro package lists, Arch lock files, PKGBUILD dependency arrays.
import { Glob } from "bun";
import { join, relative } from "node:path";
import { parsePkgbuild } from "./pkgbuild.ts";
import type { Pin } from "./query.ts";
import { parseDep } from "./version.ts";

/** One name per line; "#" starts a comment; blank lines ignored. */
export function parsePackageList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/\s+#.*$/, "").trim())
    .filter(l => l !== "" && !l.startsWith("#"));
}

export interface CollectOptions {
  /** Package list globs relative to root. */
  lists?: string[];
  locks?: string[];
  pkgbuilds?: string[];
}

export const DEFAULT_COLLECT: Required<CollectOptions> = {
  lists: ["factory/wsl/packages.*", "factory/images/*/candidate.packages"],
  locks: ["factory/arch/locks/*.json"],
  pkgbuilds: ["factory/bunos/pkgbuilds/*/PKGBUILD", "factory/usr/pkgs/*/PKGBUILD"],
};

async function files(root: string, patterns: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of patterns) for await (const f of new Glob(p).scan({ cwd: root, onlyFiles: true })) out.push(f.replaceAll("\\", "/"));
  return out.sort();
}

/** Gather pins; names are de-duplicated per (name, version, origin). */
export async function collectPins(root: string, options: CollectOptions = {}): Promise<Pin[]> {
  const o = { ...DEFAULT_COLLECT, ...options };
  const pins: Pin[] = [];
  for (const f of await files(root, o.lists)) {
    const text = await Bun.file(join(root, f)).text();
    for (const name of parsePackageList(text)) pins.push({ name, origin: f });
  }
  for (const f of await files(root, o.locks)) {
    const lock = (await Bun.file(join(root, f)).json()) as { packages?: { name: string; version: string }[] };
    for (const p of lock.packages ?? []) pins.push({ name: p.name, version: p.version, origin: f });
  }
  for (const f of await files(root, o.pkgbuilds)) {
    const facts = parsePkgbuild(await Bun.file(join(root, f)).text());
    for (const key of ["depends", "makedepends", "checkdepends", "optdepends"]) {
      for (const raw of facts.arrays[key] ?? []) {
        const d = parseDep(raw);
        // Unresolved shell expansions cannot name a package.
        if (d.name && !d.name.includes("$")) pins.push({ name: d.name, origin: f });
      }
    }
  }
  const seen = new Set<string>();
  return pins.filter(p => {
    const k = `${p.name}\0${p.version ?? ""}\0${p.origin ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function relativeOrigin(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/");
}
