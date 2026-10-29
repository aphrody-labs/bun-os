// SPDX-License-Identifier: Apache-2.0
// What an app declares for m3-bun, next to its `m3.config.ts`:
//
//   import { defineM3Config } from "@aphrody/m3/config";
//   import { defineM3Bun } from "@aphrody/m3-bun/config";
//   export default defineM3Config({ entry: "src/index.html", theme: { seed: "#6750a4" } });
//   export const bun = defineM3Bun({ api: "src/api.ts", port: 3000, deploy: { domain: "showcase.example.com" } });
//
// `bun` is optional; every field has a default derived from `package.json` and `m3.config.ts`.
import { loadM3Config, type ResolvedM3Config } from "@aphrody/m3/config";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { slug } from "./util.ts";

/** `bun build --compile` targets, without the `bun-` prefix. */
export const COMPILE_TARGETS = [
  "linux-x64",
  "linux-x64-baseline",
  "linux-x64-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "windows-x64",
  "windows-x64-baseline",
  "darwin-x64",
  "darwin-arm64",
] as const;
export type CompileTargetName = (typeof COMPILE_TARGETS)[number];

export interface M3BunDeploy {
  /** Directory the targets are generated into (default `deploy`). */
  out?: string;
  /** Public host name (nginx, Fly, Coolify, Cloudflare routes). */
  domain?: string;
  /** Container image reference (default `ghcr.io/aphrody-labs/<name>`). */
  image?: string;
  /** Install namespace under `~/apps` and `/etc` for systemd (default `aphrody`). */
  namespace?: string;
  /** Unprivileged account of the systemd unit (default `ubuntu`, the yolo host convention). */
  user?: string;
  /** Fly.io primary region (default `cdg`). */
  region?: string;
}

export interface M3BunConfig {
  /** App name (default: `package.json` name without scope). */
  name?: string;
  /** Version supplied by the product owning an embedded module. */
  version?: string;
  /** API module, relative to the config file: its default export is the routes. */
  api?: string;
  /** Port of the server (default 3000; `PORT` overrides at run time). */
  port?: number;
  /** UI build output directory (default: `outdir` of `m3.config.ts`, else `dist`). */
  outdir?: string;
  /** Minification of `m3-bun build`: `none`, `basic` (whitespace and syntax) or `full` (default, with identifiers). */
  minify?: "none" | "basic" | "full";
  /** Code splitting of the UI build (default true): dynamically imported pages become content-hashed chunks. */
  splitting?: boolean;
  /** Content-Security-Policy of the file server, or `false` to omit it. */
  csp?: string | false;
  /** Record every `m3-bun build` in a graph registry (SQLite): `true` for `.m3-bun/graph.sqlite`, or its path relative to the config. */
  graph?: boolean | string;
  compile?: {
    /** Default target of `m3-bun compile` (default: the host). */
    target?: CompileTargetName;
    /** Output file (default `<outdir>/<name>`; `.exe` is added for Windows). */
    outfile?: string;
    /** Embed JavaScriptCore bytecode for a faster start (default true; the executable grows by about 1.5 MB). */
    bytecode?: boolean;
    /** Windows executable metadata. */
    windows?: {
      icon?: string;
      title?: string;
      publisher?: string;
      version?: string;
      description?: string;
      copyright?: string;
      hideConsole?: boolean;
    };
  };
  deploy?: M3BunDeploy;
}

/** Identity helper that types the `bun` export of `m3.config.ts`. */
export function defineM3Bun(config: M3BunConfig): M3BunConfig {
  return config;
}

export interface M3App {
  dir: string;
  name: string;
  version: string;
  /** The resolved `m3.config.ts`. */
  m3: ResolvedM3Config;
  bun: M3BunConfig;
  /** Absolute path of the API module, if any. */
  api?: string;
  port: number;
  /** Absolute path of the UI build directory. */
  outdir: string;
  minify: "none" | "basic" | "full";
}

const MINIFY = new Set(["none", "basic", "full"]);

/** Load `m3.config.ts` and its optional `bun` export from `dir` and resolve every default. */
export async function loadApp(dir: string = process.cwd(), configFile?: string): Promise<M3App> {
  const m3 = await loadM3Config(dir, configFile);
  const mod = (await import(pathToFileURL(m3.file ?? join(m3.dir, "m3.config.ts")).href)) as {
    bun?: M3BunConfig;
  };
  const bun = mod.bun ?? {};
  if (bun.minify !== undefined && !MINIFY.has(bun.minify))
    throw new Error(`m3-bun: minify must be none, basic or full, got ${String(bun.minify)}`);
  const manifestFile = join(m3.dir, "package.json");
  const manifest = existsSync(manifestFile)
    ? (JSON.parse(readFileSync(manifestFile, "utf8")) as {
        name?: string;
        version?: string;
      })
    : {};
  const api = bun.api ? resolve(m3.dir, bun.api) : undefined;
  if (api && !existsSync(api)) throw new Error(`m3-bun: api module not found: ${api}`);
  return {
    dir: m3.dir,
    name: slug(bun.name ?? manifest.name ?? basename(m3.dir)),
    version: bun.version ?? manifest.version ?? "0.0.0",
    m3,
    bun,
    ...(api ? { api } : {}),
    port: bun.port ?? m3.port ?? 3000,
    outdir: resolve(m3.dir, bun.outdir ?? m3.outdir),
    minify: bun.minify ?? "full",
  };
}

/** The `bun build --compile` target string for a friendly name or the host. */
export function compileTarget(name: CompileTargetName | undefined): Bun.Build.CompileTarget | undefined {
  if (!name) return undefined;
  if (!(COMPILE_TARGETS as readonly string[]).includes(name))
    throw new Error(`m3-bun: unknown compile target ${name} (${COMPILE_TARGETS.join(", ")})`);
  return `bun-${name}` as Bun.Build.CompileTarget;
}

/** Walk up from `start` to the directory holding a `package.json` with `workspaces`. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, "package.json");
    if (existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown }).workspaces) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
