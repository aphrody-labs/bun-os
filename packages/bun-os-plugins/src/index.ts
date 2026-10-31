// SPDX-License-Identifier: MIT
/**
 * The Bun OS plugin registry: every Bun OS runtime plugin, including the features migrated from the
 * aphrody-labs/bun fork, listed once and registered together by `./preload` (root `bunfig.toml`).
 *
 * Each owner package exports `./bun-plugin`, a `defineBunOsPlugin()` value whose `setup` only
 * registers lazy module forwarders, so loading the whole registry stays cheap.
 */
import chromium from "@aphrody/chromium/bun-plugin";
import google from "@aphrody/google/bun-plugin";
import compat from "./compat/plugin.ts";
import type { BunOsPlugin } from "./define.ts";

export { defineBunOsPlugin, targetPath, type BunOsPlugin, type BunOsPluginSpec } from "./define.ts";

export const plugins: readonly BunOsPlugin[] = [google, chromium, compat];

let registered = false;

/** Register every plugin with the runtime once (`Bun.plugin`). */
export function registerAll(): void {
  if (registered) return;
  registered = true;
  for (const plugin of plugins) Bun.plugin(plugin);
}

export interface InventoryRow {
  plugin: string;
  kind: "module" | "global" | "bin";
  name: string;
  replaces: string[];
}

/** Specifier, global and bin inventory, owner by owner. */
export function inventory(): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const { spec } of plugins) {
    const replaces = spec.replaces ?? [];
    for (const name of Object.keys(spec.modules ?? {})) rows.push({ plugin: spec.name, kind: "module", name, replaces });
    for (const name of Object.keys(spec.globals ?? {})) rows.push({ plugin: spec.name, kind: "global", name, replaces });
    for (const name of Object.keys(spec.bins ?? {})) rows.push({ plugin: spec.name, kind: "bin", name, replaces });
  }
  return rows;
}
