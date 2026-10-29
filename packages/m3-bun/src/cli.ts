// SPDX-License-Identifier: Apache-2.0
// The m3-bun command line (`bin/m3-bun.ts`). Commands run in the app directory (the one with `m3.config.ts`).
//
//   m3-bun dev      [--port n] [--no-hmr] [--inspect] [--inspector-ui]   dev server, HMR, UI and API in one process
//   m3-bun build    [--minify none|basic|full] [--dev] [--outdir d] [--json] [--graph[=registry]]
//   m3-bun serve    [--port n] [--host h] [--build]            production server of the build directory
//   m3-bun compile  [--target t] [--outfile f] [--minify l] [--no-build]       one executable
//   m3-bun package  [--target t] [--format tar.gz|zip] [--out d] [--rootfs] [--deploy] [--executable f]
//   m3-bun deploy   <target..|all> [--out d] [--domain h] [--name n] [--port n] [--image r] ...      configs, never applied
//   m3-bun graph    [file] [--registry r] [--json]               recorded builds, or what depends on a file
//   m3-bun targets                                              the deploy targets
//   m3-bun smoke    [executable] [--port n]                     run it (yolo runtime when installed), GET /, /healthz, /api/m3/info
//   m3-bun workspace <build|typecheck|clean> [--only a,b] [--no-cache]          the repository pipeline (scripts/build.ts)
//   m3-bun pack     [package-dir] [--out d]                     build a workspace package and `bun pm pack` it
//   m3-bun lint     [paths..] [--strict] [--fix] [--correctness]     eslint-plugin-m3 rules through bun lint
//   m3-bun migrate  [--icons] [--glob g] [--dry-run] | --next <src> <out> [--m3] [--write]   m3-codemods, m3-next-migrate
//   m3-bun create   <web|app|example> <dir> [--name n] [--target tauri|vite] [--dry-run]   scaffold
//   m3-bun design   "<brief>" [--color c] [--system s] [--validate] [--out d]       m3-design
//   m3-bun og       [--dark] [--engine native|mcu] [--title t] [--subtitle s] [--out f.png|webp]   canvas
//   m3-bun lib      [dir] [--outdir d] [--minify-lib]            m3-config bun-build preset
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildApp, type MinifyLevel } from "./build.ts";
import { compileApp, defaultOutfile } from "./compile.ts";
import { loadDevApi } from "./dev-error.ts";
import { launchInspected, serveInspectorFrontend } from "./dev-inspect.ts";
import type { M3CssEngine } from "./theme-css.ts";
import { createApp, createTemplates } from "./tools-create.ts";
import { designApp } from "./tools-design.ts";
import { buildLibrary } from "./tools-lib.ts";
import { lintApp } from "./tools-lint.ts";
import { migrateApp, migrateNext } from "./tools-migrate.ts";
import { ogImage } from "./tools-og.ts";
import { dependents, graphPath, graphReport } from "./graph.ts";
import { COMPILE_TARGETS, findWorkspaceRoot, loadApp, type CompileTargetName, type M3App } from "./config.ts";
import { packageApp, type ArchiveFormat } from "./package.ts";
import { formatSmoke, smoke } from "./runtime.ts";
import { dirSource, startM3Server } from "./server.ts";
import { TARGETS, contextFor, generateTargets } from "./targets/index.ts";
import { kib } from "./util.ts";

export const COMMANDS = [
  "dev",
  "build",
  "serve",
  "compile",
  "package",
  "deploy",
  "graph",
  "targets",
  "smoke",
  "workspace",
  "pack",
  "lint",
  "migrate",
  "create",
  "design",
  "og",
  "lib",
  "help",
  "version",
] as const;
export type Command = (typeof COMMANDS)[number];

export interface Parsed {
  command: Command;
  positionals: string[];
  flags: Map<string, string | true>;
}

const BOOLEAN = new Set([
  "dev",
  "no-hmr",
  "no-build",
  "build",
  "json",
  "rootfs",
  "deploy",
  "help",
  "version",
  "no-cache",
  "graph",
  "inspect",
  "inspector-ui",
  "strict",
  "fix",
  "correctness",
  "icons",
  "dry-run",
  "next",
  "m3",
  "write",
  "validate",
  "dark",
  "minify-lib",
]);

/** Parse `argv` (without the runtime and script paths). */
export function parseArgs(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let command: Command | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) flags.set(name, arg.slice(eq + 1));
      else if (BOOLEAN.has(name)) flags.set(name, true);
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value`);
        flags.set(name, next);
        i++;
      }
      continue;
    }
    if (arg === "-h") flags.set("help", true);
    else if (arg === "-v") flags.set("version", true);
    else if (command === undefined && (COMMANDS as readonly string[]).includes(arg)) command = arg as Command;
    else positionals.push(arg);
  }
  if (flags.has("help")) command = "help";
  else if (flags.has("version") && command === undefined) command = "version";
  return { command: command ?? "help", positionals, flags };
}

export const USAGE = `m3-bun: build, serve, compile, package and deploy configs for M3 apps

Usage:
  m3-bun dev      [--port <n>] [--no-hmr] [--inspect] [--inspector-ui]
  m3-bun build    [--minify none|basic|full] [--dev] [--outdir <dir>] [--json] [--graph[=<registry>]]
  m3-bun serve    [--port <n>] [--host <h>] [--build]
  m3-bun compile  [--target <t>] [--outfile <file>] [--minify <level>] [--no-build]
  m3-bun package  [--target <t>] [--format tar.gz|zip] [--out <dir>] [--rootfs] [--deploy] [--executable <file>]
  m3-bun deploy   <target..|all> [--out <dir>] [--domain <host>] [--name <n>] [--port <n>] [--image <ref>]
                  [--namespace <ns>] [--user <u>] [--region <r>] [--tls-cert <f> --tls-key <f>] [--http2 directive|listen] [--cli "<cmd>"] [--icon <symbol>]
  m3-bun graph    [file] [--registry <file>] [--json]
  m3-bun targets
  m3-bun smoke    [executable] [--port <n>]
  m3-bun workspace <build|typecheck|clean> [--only a,b] [--no-cache]
  m3-bun pack     [package-dir] [--out <dir>]
  m3-bun lint     [paths..] [--strict] [--fix] [--correctness]
  m3-bun migrate  [--icons] [--glob <g>] [--dry-run]
  m3-bun migrate  --next <source> <target> [--name <n>] [--m3] [--write]
  m3-bun create   <web|app|example> <dir> [--name <n>] [--target tauri|vite] [--dry-run]
  m3-bun design   "<brief>" [--color <hex>] [--system <s>] [--validate] [--out <dir>]
  m3-bun og       [--dark] [--engine native|mcu] [--title <t>] [--subtitle <s>] [--out <file.png|webp>]
  m3-bun lib      [dir] [--outdir <dir>] [--minify-lib]

Compile targets: ${COMPILE_TARGETS.join(", ")}
Deploy targets:  ${TARGETS.map(t => t.id).join(", ")} (generated, never applied)
Commands run in the directory of the app's m3.config.ts.`;

const str = (flags: Map<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name} needs a value`);
  return value;
};

const num = (flags: Map<string, string | true>, name: string): number | undefined => {
  const value = str(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} must be a non-negative integer, got ${value}`);
  return parsed;
};

const level = (flags: Map<string, string | true>): MinifyLevel | undefined => {
  const value = str(flags, "minify");
  if (value === undefined) return undefined;
  if (value !== "none" && value !== "basic" && value !== "full")
    throw new Error(`--minify must be none, basic or full, got ${value}`);
  return value;
};

const target = (flags: Map<string, string | true>): CompileTargetName | undefined => {
  const value = str(flags, "target");
  if (value === undefined) return undefined;
  if (!(COMPILE_TARGETS as readonly string[]).includes(value))
    throw new Error(`--target must be one of ${COMPILE_TARGETS.join(", ")}, got ${value}`);
  return value as CompileTargetName;
};

async function importApi(app: M3App) {
  return app.api ? loadDevApi(app.api) : undefined;
}

/** The m3 plugins Bun may bundle an app's HTML entry with. */
const knownPluginFiles = (): string[] => {
  const files = [join(import.meta.dir, "plugin.ts")];
  try {
    files.push(Bun.resolveSync("@aphrody/m3/plugin", import.meta.dir));
  } catch {
    // @aphrody/m3 is a dependency; a failure here only narrows the match.
  }
  return files;
};

/** `bunfig.toml` must list the plugin (`[serve.static] plugins`) for `Bun.serve`'s HTML bundling to apply it. */
export function bunfigHasPlugin(dir: string): boolean {
  const file = join(dir, "bunfig.toml");
  if (!existsSync(file)) return false;
  const parsed = Bun.TOML.parse(readFileSync(file, "utf8")) as {
    serve?: { static?: { plugins?: unknown } };
  };
  const plugins = parsed.serve?.static?.plugins;
  if (!Array.isArray(plugins)) return false;
  const known = knownPluginFiles();
  return plugins.some(specifier => {
    if (typeof specifier !== "string") return false;
    try {
      return known.includes(Bun.resolveSync(specifier, dir));
    } catch {
      return false;
    }
  });
}

async function run(cmd: string[], cwd: string): Promise<number> {
  console.log(`$ ${cmd.join(" ")}  (${cwd})`);
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

/** Run the CLI; resolves to the exit code (`dev` and `serve` resolve once listening, the server keeps the process alive). */
export async function runCli(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  switch (command) {
    case "help":
      console.log(USAGE);
      return 0;
    case "version": {
      const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
        version: string;
      };
      console.log(manifest.version);
      return 0;
    }
    case "targets": {
      for (const t of TARGETS) console.log(`${t.id.padEnd(12)} ${t.description}`);
      return 0;
    }
    case "dev": {
      if (flags.has("inspect")) {
        const args = argv.filter(a => a !== "--inspect" && a !== "--inspector-ui");
        const inspected = await launchInspected({
          cmd: [process.execPath, join(import.meta.dir, "..", "bin", "m3-bun.ts"), ...args],
          cwd,
          onConsole: entry => console.log(`[${entry.level}] ${entry.text}`),
          onException: e =>
            console.error(`[exception] ${e.name}: ${e.message}${e.frames.map(frame => "\n  " + frame).join("")}`),
        });
        console.log(`m3-bun dev --inspect: inspector ${inspected.inspectorUrl}`);
        if (flags.has("inspector-ui"))
          console.log(`  web inspector ${serveInspectorFrontend({ ws: inspected.inspectorUrl }).url}`);
        return 0;
      }
      const app = await loadApp(cwd);
      if (!bunfigHasPlugin(app.dir)) {
        console.error(
          `m3-bun dev: ${join(app.dir, "bunfig.toml")} must list the plugin so Bun can bundle the HTML entry:\n\n[serve.static]\nplugins = ["@aphrody/m3-bun/plugin"]`,
        );
        return 1;
      }
      const index = (
        (await import(pathToFileURL(app.m3.entry).href)) as {
          default: import("bun").HTMLBundle;
        }
      ).default;
      const api = await importApi(app);
      const port = num(flags, "port");
      const server = startM3Server({
        name: app.name,
        version: app.version,
        index,
        hmr: !flags.has("no-hmr"),
        ...(api ? { api } : {}),
        ...(app.bun.csp !== undefined ? { csp: app.bun.csp } : {}),
        port: port ?? app.port,
      });
      console.log(`m3-bun dev ${app.name}: listening on ${server.url}${app.api ? " (UI + API, one process)" : ""}`);
      return 0;
    }
    case "build": {
      const app = await loadApp(cwd);
      const minify = level(flags);
      const outdir = str(flags, "outdir");
      const graph = flags.get("graph");
      const report = await buildApp({
        app,
        ...(minify ? { minify } : {}),
        ...(outdir ? { outdir } : {}),
        ...(graph !== undefined ? { graph: graph === true ? true : resolve(cwd, graph) } : {}),
        dev: flags.has("dev"),
      });
      if (flags.has("json"))
        console.log(
          JSON.stringify(
            {
              outdir: report.outdir,
              ms: report.ms,
              totalBytes: report.totalBytes,
              totalGzipBytes: report.totalGzipBytes,
              totalZstdBytes: report.totalZstdBytes,
              memory: report.memory,
              warnings: report.warnings,
              manifest: report.manifest,
              ...(report.graph ? { graph: report.graph } : {}),
            },
            null,
            2,
          ),
        );
      else {
        for (const file of report.manifest.files)
          console.log(`  ${file.path.padEnd(34)} ${kib(file.bytes).padStart(11)}  gzip ${kib(file.gzipBytes)}`);
        console.log(
          `m3-bun build ${app.name}@${app.version}: ${report.manifest.files.length} files, ${kib(report.totalBytes)} (${kib(report.totalGzipBytes)} gzip, ${kib(report.totalZstdBytes)} zstd), minify ${report.manifest.minify}, build ${report.manifest.buildId}, ${report.ms} ms -> ${report.outdir}`,
        );
        for (const warning of report.warnings) console.warn(`warning: ${warning}`);
        if (report.graph)
          console.log(
            `  graph ${report.graph.nodes} nodes, ${report.graph.edges} edges, run ${report.graph.runId} -> ${report.graph.path}`,
          );
      }
      return 0;
    }
    case "serve": {
      const app = await loadApp(cwd);
      if (flags.has("build") || !existsSync(join(app.outdir, "index.html"))) await buildApp({ app });
      const api = await importApi(app);
      const port = num(flags, "port");
      const host = str(flags, "host");
      const server = startM3Server({
        name: app.name,
        version: app.version,
        files: dirSource(app.outdir),
        ...(api ? { api } : {}),
        ...(app.bun.csp !== undefined ? { csp: app.bun.csp } : {}),
        port: port ?? app.port,
        ...(host ? { hostname: host } : {}),
      });
      console.log(`m3-bun serve ${app.name}: listening on ${server.url}${app.api ? " (UI + API, one process)" : ""}`);
      return 0;
    }
    case "compile": {
      const app = await loadApp(cwd);
      const t = target(flags);
      const outfile = str(flags, "outfile");
      const minify = level(flags);
      const report = await compileApp({
        app,
        ...(t ? { target: t } : {}),
        ...(outfile ? { outfile } : {}),
        ...(minify ? { minify } : {}),
        build: !flags.has("no-build"),
      });
      console.log(
        `m3-bun compile ${app.name}: ${report.outfile} (${kib(report.bytes)}, ${report.files} embedded files, target ${report.target}, ${report.bytecode ? "bytecode" : "no bytecode"}) in ${report.ms} ms`,
      );
      for (const warning of report.warnings) console.warn(`warning: ${warning}`);
      return 0;
    }
    case "package": {
      const app = await loadApp(cwd);
      const t = target(flags);
      const out = str(flags, "out");
      const format = str(flags, "format") as ArchiveFormat | undefined;
      if (format !== undefined && format !== "tar.gz" && format !== "zip")
        throw new Error(`--format must be tar.gz or zip, got ${format}`);
      const executable = str(flags, "executable");
      const report = await packageApp({
        app,
        ...(t ? { target: t } : {}),
        ...(out ? { out } : {}),
        ...(format ? { format } : {}),
        ...(executable ? { executable } : {}),
        rootfs: flags.has("rootfs"),
        deploy: flags.has("deploy"),
      });
      console.log(
        `m3-bun package: ${report.archive} (${kib(report.bytes)}, ${report.archiver})\n  sha256 ${report.sha256}\n  files ${report.files.join(", ")}`,
      );
      if (report.rootfs)
        console.log(
          `  rootfs ${report.rootfs.dir}: ${kib(report.rootfs.bytes)}, ${report.rootfs.libraries.length} libraries (${report.rootfs.libraries.join(", ")})`,
        );
      return 0;
    }
    case "deploy": {
      const app = await loadApp(cwd);
      const ids = positionals.length > 0 ? positionals : ["all"];
      const out = resolve(cwd, str(flags, "out") ?? app.bun.deploy?.out ?? "deploy");
      const cert = str(flags, "tls-cert");
      const key = str(flags, "tls-key");
      if ((cert === undefined) !== (key === undefined)) throw new Error("--tls-cert and --tls-key go together");
      const domain = str(flags, "domain");
      const image = str(flags, "image");
      const namespace = str(flags, "namespace");
      const user = str(flags, "user");
      const region = str(flags, "region");
      const cli = str(flags, "cli");
      const http2 = str(flags, "http2");
      if (http2 !== undefined && http2 !== "directive" && http2 !== "listen")
        throw new Error(`--http2 must be directive or listen, got ${http2}`);
      const name = str(flags, "name");
      const port = num(flags, "port");
      const icon = str(flags, "icon");
      const context = contextFor(app, {
        ...(icon ? { iconSymbol: icon } : {}),
        ...(domain ? { domain } : {}),
        ...(image ? { image } : {}),
        ...(namespace ? { namespace } : {}),
        ...(user ? { user } : {}),
        ...(region ? { region } : {}),
        ...(cli ? { cli } : {}),
        ...(name ? { name, binary: name } : {}),
        ...(port !== undefined ? { port } : {}),
        ...(cert && key ? { tls: { cert, key } } : {}),
        ...(http2 ? { http2 } : {}),
      });
      const generated = await generateTargets(ids, context, out);
      for (const g of generated) console.log(`${g.id.padEnd(12)} ${g.files.length} files -> ${g.dir}`);
      console.log("generated only: nothing was applied, pushed or reloaded");
      return 0;
    }
    case "graph": {
      const app = await loadApp(cwd);
      const registry = str(flags, "registry");
      const path = registry ? resolve(cwd, registry) : graphPath(app);
      const file = positionals[0];
      if (file === undefined) {
        console.log(await graphReport(app, path));
        return 0;
      }
      const found = await dependents(app, file, path);
      if (flags.has("json")) console.log(JSON.stringify(found, null, 2));
      else for (const node of found) console.log(`${"  ".repeat(node.depth - 1)}${node.label}  (${node.kind})`);
      return 0;
    }
    case "smoke": {
      const app = await loadApp(cwd);
      const executable = resolve(cwd, positionals[0] ?? defaultOutfile(app, undefined));
      if (!existsSync(executable)) throw new Error(`m3-bun smoke: ${executable} does not exist (m3-bun compile first)`);
      const port = num(flags, "port") ?? 38000 + Math.floor(Math.random() * 2000);
      const report = await smoke(executable, port);
      console.log(formatSmoke(report));
      return report.ok ? 0 : 1;
    }
    case "workspace": {
      const root = findWorkspaceRoot(cwd);
      const script = root ? join(root, "scripts", "build.ts") : undefined;
      if (!root || !script || !existsSync(script))
        throw new Error("m3-bun workspace: no scripts/build.ts above the working directory");
      const task = positionals[0] ?? "build";
      const only = str(flags, "only");
      return run(
        ["bun", script, task, ...(only ? ["--only", only] : []), ...(flags.has("no-cache") ? ["--no-cache"] : [])],
        root,
      );
    }
    case "pack": {
      const dir = resolve(cwd, positionals[0] ?? ".");
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name: string;
      };
      const root = findWorkspaceRoot(dir);
      const script = root ? join(root, "scripts", "build.ts") : undefined;
      if (root && script && existsSync(script) && existsSync(join(dir, "build.config.ts"))) {
        const code = await run(["bun", script, "build", "--only", manifest.name, "--no-apps"], root);
        if (code !== 0) return code;
      }
      const out = resolve(cwd, str(flags, "out") ?? "release");
      return run(["bun", "pm", "pack", "--destination", out], dir);
    }
    case "lint": {
      const report = await lintApp({
        dir: cwd,
        ...(positionals.length ? { paths: positionals } : {}),
        preset: flags.has("strict") ? "strict" : "recommended",
        fix: flags.has("fix"),
        correctness: flags.has("correctness"),
      });
      for (const d of report.diagnostics)
        console.log(`${d.file}:${d.line}:${d.column} ${d.severity} ${d.rule}: ${d.message}`);
      console.log(
        `m3-bun lint: ${report.files} files, ${report.rules} rules, ${report.errors} errors, ${report.warnings} warnings`,
      );
      return report.exitCode;
    }
    case "migrate": {
      if (flags.has("next")) {
        const [source, destination] = positionals;
        if (!source || !destination) throw new Error("m3-bun migrate --next <source> <target>");
        const name = str(flags, "name");
        const report = await migrateNext({
          source: resolve(cwd, source),
          target: resolve(cwd, destination),
          ...(name ? { name } : {}),
          m3: flags.has("m3"),
          write: flags.has("write"),
        });
        console.log(
          `m3-bun migrate --next: ${report.migratedFiles} migrated, ${report.unmodifiedFiles} unchanged, ${report.copiedAssets} assets, ${report.skippedFiles.length} skipped${flags.has("write") ? "" : " (dry run)"}`,
        );
        return 0;
      }
      const glob = str(flags, "glob");
      const report = await migrateApp({
        dir: cwd,
        kind: flags.has("icons") ? "icons" : "mui",
        ...(glob ? { glob } : {}),
        dryRun: flags.has("dry-run"),
      });
      for (const file of report.changed)
        console.log(`  ${file.path}${file.diagnostics.length ? ` (${file.diagnostics.length} TODO)` : ""}`);
      console.log(
        `m3-bun migrate: ${report.changed.length}/${report.scanned} files changed${report.dryRun ? " (dry run)" : ""}`,
      );
      return 0;
    }
    case "create": {
      const [template, dir] = positionals;
      if (!template || !dir) throw new Error("m3-bun create <web|app|example> <dir>");
      const templates = await createTemplates();
      const offered = templates.find(candidate => candidate.name === template);
      if (!offered)
        throw new Error(
          `m3-bun create: unknown template ${template} (${templates.map(candidate => candidate.name).join(", ")})`,
        );
      const name = str(flags, "name");
      const t = str(flags, "target");
      if (t !== undefined && t !== "tauri" && t !== "vite") throw new Error(`--target must be tauri or vite, got ${t}`);
      const report = await createApp({
        template: offered.name,
        dir: resolve(cwd, dir),
        ...(name ? { name } : {}),
        ...(t ? { target: t } : {}),
        dryRun: flags.has("dry-run"),
      });
      console.log(
        `m3-bun create ${report.template} ${report.name}: ${report.files.length} files ${report.written ? "->" : "(dry run)"} ${report.dir}`,
      );
      return 0;
    }
    case "design": {
      const prompt = positionals.join(" ");
      if (!prompt) throw new Error(`m3-bun design "<brief>"`);
      const color = str(flags, "color");
      const system = str(flags, "system");
      const out = str(flags, "out");
      const report = await designApp({
        prompt,
        ...(color ? { color } : {}),
        ...(system ? { designSystem: system } : {}),
        validate: flags.has("validate"),
        ...(out ? { out: resolve(cwd, out) } : {}),
      });
      for (const file of report.files) console.log(`  ${file.path.padEnd(34)} ${kib(file.bytes)}`);
      console.log(
        `m3-bun design: seed ${report.seed}, ${report.files.length} files${report.written.length ? `, ${report.written.length} written` : ""}`,
      );
      return 0;
    }
    case "og": {
      const engine = str(flags, "engine");
      if (engine !== undefined && engine !== "native" && engine !== "mcu")
        throw new Error(`--engine must be native or mcu, got ${engine}`);
      const title = str(flags, "title");
      const subtitle = str(flags, "subtitle");
      const out = str(flags, "out");
      const report = await ogImage({
        dir: cwd,
        dark: flags.has("dark"),
        ...(engine ? { engine: engine as M3CssEngine } : {}),
        ...(title ? { title } : {}),
        ...(subtitle ? { subtitle } : {}),
        ...(out ? { out: resolve(cwd, out) } : {}),
      });
      console.log(`m3-bun og: ${report.file} (${report.width}x${report.height}, ${kib(report.bytes)})`);
      return 0;
    }
    case "lib": {
      const outdir = str(flags, "outdir");
      const report = await buildLibrary({
        dir: resolve(cwd, positionals[0] ?? "."),
        ...(outdir ? { outDir: outdir } : {}),
        ...(flags.has("minify-lib") ? { minify: true } : {}),
      });
      for (const log of report.logs) console.error(log);
      for (const file of report.files)
        console.log(`  ${file.path.padEnd(34)} ${kib(file.bytes).padStart(11)}  zstd ${kib(file.zstdBytes)}`);
      console.log(`m3-bun lib: ${report.files.length} files -> ${report.outDir}`);
      return report.success ? 0 : 1;
    }
  }
}
