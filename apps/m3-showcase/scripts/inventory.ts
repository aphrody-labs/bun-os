#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Writes packages/app-ui/src/material/generated/inventory.json: every package and app of the monorepo (name, version, description, entry
// points, location, whether it is in the Bun workspace). The showcase serves it from its own API (`/api/packages`)
// and its pages read the same data. A test checks the committed file is current: run `bun run inventory` after a
// version or description change.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
export const ROOT = resolve(here, "../../..");
export const OUT = join(here, "../../../packages/app-ui/src/material/generated/inventory.json");

export interface InventoryEntry {
  name: string;
  version: string;
  description: string;
  /** Path relative to the repository. */
  dir: string;
  kind: "package" | "app";
  /** In the Bun workspace (installed and linked) or a host-bound member outside it. */
  workspace: boolean;
  private: boolean;
  /** Number of `exports` entries (0 when the package declares `main` only). */
  exports: number;
  bin: string[];
}

function workspacePatterns(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  return Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
}

/** The inventory, sorted by name. */
export function collect(root: string = ROOT): InventoryEntry[] {
  const patterns = workspacePatterns(root);
  const included = patterns.filter(pattern => !pattern.startsWith("!"));
  const excluded = patterns.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1));
  const matches = (pattern: string, path: string) => new Bun.Glob(pattern).match(path);
  const entries: InventoryEntry[] = [];
  for (const [kind, base] of [
    ["package", "packages"],
    ["app", "apps"],
  ] as const) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).toSorted()) {
      const file = join(dir, name, "package.json");
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as {
        name: string;
        version?: string;
        description?: string;
        private?: boolean;
        exports?: Record<string, unknown> | string;
        bin?: string | Record<string, string>;
      };
      if (!manifest.name) continue; // a manifest without a name is not a package (e.g. a template stub)
      const rel = `${base}/${name}`;
      const exported = manifest.exports;
      entries.push({
        name: manifest.name,
        version: manifest.version ?? "0.0.0",
        description: (manifest.description ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
        dir: rel,
        kind,
        workspace: included.some(pattern => matches(pattern, rel)) && !excluded.some(pattern => matches(pattern, rel)),
        private: manifest.private === true,
        exports: typeof exported === "object" && exported ? Object.keys(exported).length : exported ? 1 : 0,
        bin: typeof manifest.bin === "string" ? [manifest.name] : Object.keys(manifest.bin ?? {}),
      });
    }
  }
  return entries.toSorted((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const entries = collect();
  await Bun.write(OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`inventory: ${entries.length} packages and apps -> ${OUT}`);
}
