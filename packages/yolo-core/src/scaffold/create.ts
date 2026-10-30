/**
 * `yolo create <dir>`: scaffolds an Aphrody stack project from the versioned templates in
 * Material (layers and versions are described by its templates/stack.toml).
 *
 *   yolo create my-app [--with web|react,desktop] [--framework hono|elysia] [--yolo-path <checkout>]
 *
 * The composition is Bun's: `bun create aphrody/<template>[+<template>...] <dir>` (the former Bun fork,
 * src/js/eval/toolchain.ts) applies the layers in order, substitutes `__NAME__`, `__IDENT__` and
 * `__YOLO__`, renames `gitignore` and refuses two templates of one `exclusive` group. The templates
 * remain with their Material and Bun owners.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface StackTemplate {
  readonly path: string;
  readonly description: string;
  readonly required?: boolean;
  readonly exclusive?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly dev_dependencies?: Readonly<Record<string, string>>;
  readonly curated?: string;
}

export interface StackManifest {
  readonly meta: Readonly<Record<string, string>>;
  readonly layer: Readonly<Record<string, Record<string, unknown>>>;
  readonly template: Readonly<Record<string, StackTemplate>>;
}

/** Source checkouts consume the integrated templates; installed distributions retain their asset layout. */
export function templatesRoot(rootDir: string): string {
  if (!existsSync(join(rootDir, "Cargo.toml"))) return resolve(rootDir, "m3/templates");
  return join(rootDir, "packages/m3-templates");
}

export async function loadStack(rootDir: string): Promise<StackManifest> {
  return Bun.TOML.parse(await Bun.file(join(templatesRoot(rootDir), "stack.toml")).text()) as StackManifest;
}

function walk(dir: string, base = dir, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, acc);
    else acc.push(abs.slice(base.length + 1).replaceAll("\\", "/"));
  }
  return acc;
}

export function toIdent(name: string): string {
  const ident = name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z_]/.test(ident) ? ident : `app_${ident}`;
}

export interface CreateOptions {
  readonly rootDir: string;
  readonly target: string;
  readonly name: string;
  readonly features: readonly string[];
  readonly yoloPath: string;
}

/**
 * The template layers as `bun create` reads them: packages/m3-templates, overlaid with the files of the layers whose
 * canonical source is packages/m3-templates of the OS (the web, react and spa pages).
 */
function stageTemplates(rootDir: string): { dir: string; cleanup(): void } {
  const own = templatesRoot(rootDir);
  const web = join(rootDir, "packages/m3-templates");
  if (!existsSync(web)) return { dir: own, cleanup() {} };
  const staged = mkdtempSync(join(tmpdir(), "yolo-create-templates-"));
  const dir = join(staged, "m3", "templates");
  cpSync(own, dir, { recursive: true });
  cpSync(web, dir, { recursive: true });
  return {
    dir,
    cleanup: () => rmSync(staged, { recursive: true, force: true }),
  };
}

/** Writes the project with `bun create aphrody/...` and returns the relative paths of the files created. */
export async function createProject(options: CreateOptions): Promise<string[]> {
  const templates = stageTemplates(options.rootDir);
  try {
    return await createFromTemplates(options, templates.dir);
  } finally {
    templates.cleanup();
  }
}

async function createFromTemplates(options: CreateOptions, templatesDir: string): Promise<string[]> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "create",
      `aphrody/${options.features.join("+")}`,
      options.target,
      "--name",
      options.name,
      "--templates",
      templatesDir,
      "--aphrody",
      options.yoloPath,
    ],
    {
      windowsHide: true,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(stderr.replace(/^error: /, "").trim() || `bun create exited with ${exitCode}`);
  }
  return walk(options.target).toSorted();
}

const HELP = `\x1b[1myolo create\x1b[0m <dir> — scaffold an Aphrody stack project

  --with web,desktop        Features on top of the base server (default: web; react replaces web)
  --framework hono|elysia   Add a framework variant of the HTTP surface (src/alt/)
  --name <name>             Package name (default: the directory name)
  --yolo-path <dir>         Yolo checkout the project links to (default: this checkout)
  --list                    Show the available templates and layers`;

export async function runCreateCommand(args: readonly string[], rootDir: string = process.cwd()): Promise<number> {
  const positional: string[] = [];
  let features: string[] = ["web"];
  let framework: string | undefined;
  let name: string | undefined;
  let yoloPath = rootDir;
  let list = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    if (arg === "--with") features = value().split(",").filter(Boolean);
    else if (arg === "--framework") framework = value();
    else if (arg === "--name") name = value();
    else if (arg === "--yolo-path") yoloPath = resolve(value());
    else if (arg === "--list") list = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      return 0;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }

  if (list) {
    const stack = await loadStack(rootDir);
    console.log(
      `\x1b[1m${stack.meta["name"]}\x1b[0m (Bun ${stack.meta["bun"]}, runtime ABI ${stack.meta["runtime_abi"]})`,
    );
    for (const [id, t] of Object.entries(stack.template)) {
      console.log(`  ${id.padEnd(8)} ${t.required ? "(always) " : "         "}${t.description}`);
    }
    for (const [id, layer] of Object.entries(stack.layer)) {
      console.log(`  layer ${id.padEnd(9)} ${String(layer["plan"]).padEnd(3)} ${layer["status"]}`);
    }
    return 0;
  }
  const dir = positional[0];
  if (dir === undefined) {
    console.log(HELP);
    return 1;
  }
  if (framework !== undefined) features.push(framework);
  const target = resolve(process.cwd(), dir);
  const files = await createProject({
    rootDir,
    target,
    name: name ?? basename(target),
    features,
    yoloPath,
  });
  console.log(
    `\x1b[1mCreated ${basename(target)}\x1b[0m (${files.length} files, features: base, ${features.join(", ")})`,
  );
  console.log(`\n  cd ${dir}\n  bun install\n  bun run dev`);
  return 0;
}
