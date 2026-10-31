// SPDX-License-Identifier: MIT
/**
 * The Bun OS runtime plugin contract.
 *
 * Every Bun OS capability, and every addition migrated from the aphrody-labs/bun fork, is a Bun
 * plugin: a `BunPlugin` whose `setup(build)` registers virtual modules with `build.module()`. Upstream
 * Bun canary accepts any specifier there, `bun:`-prefixed ones included, so code written for the
 * fork keeps importing `bun:google`, `bun:chromium` and the rest unchanged once the registry
 * (`@aphrody/bun-os-plugins/preload`) is preloaded from the root `bunfig.toml`.
 *
 * A module entry forwards the specifier to a real ESM file of the owner package. The file is loaded
 * lazily, on the first import of the specifier, so preloading every plugin costs nothing. Target
 * files export the fork's named API plus a default export (the fork modules used
 * `export default { ... }`).
 *
 * A global entry defines a lazy property on `Bun` or `globalThis` (`Bun.Video`), resolved by a
 * synchronous `require()` of the owner file on first read.
 */
import type { BunPlugin, PluginBuilder } from "bun";
import { fileURLToPath } from "node:url";

export type ModuleTarget = string | URL;

export interface BunOsPluginSpec {
  /** Plugin name, the owner package name (`@aphrody/google`). */
  name: string;
  /** Virtual module specifier to the owner file that implements it. */
  modules?: Record<string, ModuleTarget>;
  /** Lazy globals: `"Bun.Video"` or `"globalThis.X"` to the owner file; the default export is the value. */
  globals?: Record<string, ModuleTarget>;
  /** CLI bins the owner package provides (documentation and `bun-os-plugins list`). */
  bins?: Record<string, ModuleTarget>;
  /** Fork feature this plugin replaces (`bun:google`, `bun mcp`), for the inventory. */
  replaces?: string[];
  /** Extra setup after the module and global registrations. */
  setup?: (build: PluginBuilder) => void | Promise<void>;
}

export interface BunOsPlugin extends BunPlugin {
  spec: BunOsPluginSpec;
}

export function targetPath(target: ModuleTarget): string {
  if (target instanceof URL) return fileURLToPath(target);
  return target.startsWith("file:") ? fileURLToPath(target) : target;
}

function forwarder(path: string): string {
  const p = JSON.stringify(path.replaceAll("\\", "/"));
  return `export * from ${p};\nexport { default } from ${p};\n`;
}

function defineLazyGlobal(name: string, path: string): void {
  const [root, ...rest] = name.split(".");
  const key = rest.pop();
  if (!key) throw new Error(`bun-os-plugins: global ${name} needs an owner object (Bun.X or globalThis.X)`);
  let owner: Record<string, unknown> = root === "Bun" ? (Bun as unknown as Record<string, unknown>) : globalThis;
  for (const part of rest) owner = owner[part] as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(owner, key)) return;
  Object.defineProperty(owner, key, {
    configurable: true,
    enumerable: false,
    get() {
      const mod = require(path) as { default?: unknown };
      const value = mod.default ?? mod;
      Object.defineProperty(owner, key, { configurable: true, enumerable: false, writable: true, value });
      return value;
    },
  });
}

export function defineBunOsPlugin(spec: BunOsPluginSpec): BunOsPlugin {
  return {
    name: spec.name,
    spec,
    target: "bun",
    async setup(build) {
      for (const [specifier, target] of Object.entries(spec.modules ?? {})) {
        const contents = forwarder(targetPath(target));
        build.module(specifier, () => ({ contents, loader: "js" }));
      }
      for (const [name, target] of Object.entries(spec.globals ?? {})) defineLazyGlobal(name, targetPath(target));
      await spec.setup?.(build);
    },
  };
}
