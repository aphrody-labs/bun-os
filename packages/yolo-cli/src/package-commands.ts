/**
 * `yolo ops|workspace|optimize|update|google|doc-ai|forge|m3`: the command lines of the Bun owner packages,
 * folded into yolo. Each command imports its owner's CLI module in-process and returns the runner's exit status;
 * the owners keep their code. Internal packages no longer publish a binary of their own; the npm-published m3
 * packages keep theirs for external consumers, and the repository calls them through `yolo m3 <tool>`.
 *
 * The module path is computed, so a compiled yolo does not bundle the owners (and their dependencies): it loads
 * them from the Aphrody checkout at run time.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findCheckout, isCompiled } from "./home";

export interface PackageRunner {
  /** Owner CLI module, relative to the checkout root. */
  readonly module: string;
  /** Exported runner `(argv: string[]) => number | Promise<number>`. */
  readonly run: string;
  /** One-line description for `yolo help`. */
  readonly summary: string;
  /**
   * A successful run may leave a server or a watcher running (`m3 dev`, `m3 bun serve`, `forge watch`): yolo then
   * lets the process live on its handles and ends it only on failure. Other commands end the process on return.
   */
  readonly keepAlive?: boolean;
  /** Standalone owner CLI with no import-safe runner. */
  readonly script?: boolean;
}

export interface PackageCommand extends PackageRunner {
  /**
   * Tools selected by the first argument (`yolo m3 next dev`). Any other first argument, or none, goes to the
   * command's own runner. Tool names never shadow a command of that runner (tested).
   */
  readonly tools?: Readonly<Record<string, PackageRunner>>;
}

/** `yolo m3 <tool>`: the CLIs of the m3 packages besides the framework's own `m3` (their npm `bin` in brackets). */
export const M3_TOOLS = {
  next: {
    module: "packages/m3-next/bin/m3-next.ts",
    run: "runM3Next",
    summary:
      "Next.js 16 on Bun, Turbopack workers included: dev | build | start [next args] [m3-next, runner from @aphrody/next-bun]",
  },
  bun: {
    module: "packages/m3-bun/src/cli.ts",
    run: "runCli",
    summary: "Build, serve, compile, package and deploy configs of an M3 app [m3-bun]",
    keepAlive: true,
  },
  "os-themes": {
    module: "packages/m3-os-themes/src/cli.ts",
    run: "runOsThemes",
    summary: "M3 OS themes: install | generate | uninstall (dry-run unless --apply) [m3-os-themes]",
  },
  "next-migrate": {
    module: "packages/m3-next-migrate/src/cli.ts",
    run: "runNextMigrate",
    summary:
      "Next.js 16 migration, codemods (next16 and tailwind4 from @aphrody/next-bun, plus mui) and pages-hints [m3-next-migrate, next-migrate]",
  },
  "svg-to-ico": {
    module: "packages/material-design-icons/scripts/svg-to-ico.ts",
    run: "runSvgToIco",
    summary: "Material Symbol or SVG to Tauri icons (ico, icns, PNG) [m3-svg-to-ico]",
  },
  "web-to-tauri": {
    module: "packages/web-to-tauri/src/cli.ts",
    run: "runWebToTauri",
    summary: "Website or bundle to a Tauri 3 app: probe | plan | convert | parity [web-to-tauri]",
  },
  scaffold: {
    module: "packages/scaffold/src/cli.ts",
    run: "runScaffold",
    script: true,
    summary: "The single project scaffolder: list | example | new [aphrody-scaffold]",
  },
} as const satisfies Record<string, PackageRunner>;

export const PACKAGE_COMMANDS = {
  ops: {
    module: "packages/bun-workspace/src/automation/ops.ts",
    run: "runOps",
    summary: "Workspace operations (gates, docs, build factory, audits); other commands go to aphrody-infra",
  },
  workspace: {
    module: "packages/bun-workspace/src/automation/cli.ts",
    run: "runWorkspace",
    summary: "optimize | plugins | code-edit; other commands go to aphrody-infra unchanged",
  },
  optimize: {
    module: "packages/bun-workspace/src/automation/optimize.ts",
    run: "runOptimize",
    summary: "Run the optimize-workspace skill through `aphrody exec` (--print previews it)",
  },
  update: {
    module: "packages/update/src/cli.ts",
    run: "runUpdate",
    summary: "Tool pins, dependencies, Cargo lock, user systemd units, upstream sources",
  },
  google: {
    module: "packages/google/src/cli.ts",
    run: "runGoogle",
    summary: "Google Drive projection and Fonts proxy (Gemini runtime: aphrody google)",
  },
  "doc-ai": {
    module: "packages/doc-ai/src/cli.ts",
    run: "main",
    summary: "Translate Markdown, generate Lit API guides, sync docs/",
  },
  forge: {
    module: "packages/yolo-cli/src/cli/forge/main.ts",
    run: "runForge",
    summary: "Build the aphrody-labs/bun fork: doctor | bootstrap | build | watch | status | unit",
    keepAlive: true,
  },
  m3: {
    module: "packages/m3/src/cli.ts",
    run: "runCli",
    summary: "M3 framework CLI (dev, build, compile, desktop, tokens, check, new) and the m3 package tools",
    keepAlive: true,
    tools: M3_TOOLS,
  },
} as const satisfies Record<string, PackageCommand>;

export type PackageCommandName = keyof typeof PACKAGE_COMMANDS;

export function isPackageCommand(name: string): name is PackageCommandName {
  return Object.hasOwn(PACKAGE_COMMANDS, name);
}

export interface ResolvedPackageCommand extends PackageRunner {
  /** `m3` or `m3 next`: the yolo command line that selected this runner, for messages. */
  readonly label: string;
  /** Arguments passed to the runner (the tool name removed). */
  readonly args: string[];
  /** The tools of the command, when the command's own runner was selected. */
  readonly tools?: Readonly<Record<string, PackageRunner>>;
}

/** The runner `yolo <name> ...args` reaches: a tool when the first argument names one, else the command's own. */
export function resolvePackageCommand(name: string, args: readonly string[]): ResolvedPackageCommand | undefined {
  if (!isPackageCommand(name)) return undefined;
  const command: PackageCommand = PACKAGE_COMMANDS[name];
  const [first, ...rest] = args;
  if (command.tools && first !== undefined && Object.hasOwn(command.tools, first)) {
    return { ...command.tools[first]!, label: `${name} ${first}`, args: rest };
  }
  return { ...command, label: name, args: [...args] };
}

/**
 * Resolve the selected Bun OS checkout before explicit compatibility owners.
 */
export function packageRoot(cwd: string = process.cwd()): string {
  if (process.env.BUN_OS_ROOT?.trim()) return resolve(process.env.BUN_OS_ROOT);
  let candidate = resolve(cwd);
  for (;;) {
    if (
      existsSync(join(candidate, "sources.lock.json")) &&
      existsSync(join(candidate, "packages/bun-workspace/src/automation/ops.ts"))
    )
      return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  if (!isCompiled()) return resolve(import.meta.dir, "../../..");
  const legacy = process.env.YOLO_APHRODY_ROOT?.trim();
  const owner = legacy ? resolve(legacy) : findCheckout(cwd);
  if (owner) return owner;
  throw new Error("Bun OS workspace not found; configure BUN_OS_ROOT explicitly");
}

type NativeJobTransport = (
  request: {
    config: string;
    server: string;
    tool: string;
    arguments: Record<string, unknown>;
  },
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<unknown>;
type Runner = (argv: string[], ports?: { nativeJobTransport: NativeJobTransport }) => number | Promise<number>;

/** Resolve the native owner only when qualification is explicitly applied. */
async function nativeJobPort(root: string): Promise<{
  nativeJobTransport: NativeJobTransport;
  close: () => void;
}> {
  const pipelinePath = join(root, "packages/interop/native/src/pipeline.ts");
  const enginePath = join(root, "packages/interop/native/src/engine.ts");
  const pipeline = (await import(pathToFileURL(pipelinePath).href)) as {
    mcpTool?: NativeJobTransport;
  };
  const engine = (await import(pathToFileURL(enginePath).href)) as {
    close?: () => void;
  };
  if (typeof pipeline.mcpTool !== "function" || typeof engine.close !== "function")
    throw new Error("Native jobs qualification requires the canonical pipeline SDK");
  return { nativeJobTransport: pipeline.mcpTool, close: engine.close };
}

const isHelpRequest = (args: readonly string[]): boolean =>
  args.length === 0 || (args.length === 1 && ["help", "--help", "-h"].includes(args[0]!));

/** Runs `yolo <name> ...args` in-process and returns the exit status. */
export async function runPackageCommand(
  name: string,
  args: readonly string[],
  root: string = packageRoot(),
): Promise<number> {
  const resolved = resolvePackageCommand(name, args);
  if (resolved === undefined) {
    console.error(`yolo: ${name} is not a package command`);
    return 2;
  }
  const { label, module, run, tools } = resolved;
  const path = join(root, module);
  if (name !== "forge" && !existsSync(path)) {
    console.error(
      `yolo ${label}: ${module} is missing under ${root}; run inside an Aphrody checkout or set YOLO_APHRODY_ROOT`,
    );
    return 127;
  }
  if (resolved.script) {
    return await Bun.spawn([process.execPath, path, ...resolved.args], {
      cwd: root,
      windowsHide: true,
      stdio: ["inherit", "inherit", "inherit"],
    }).exited;
  }
  const owner = (
    name === "forge" ? await import("./cli/forge/main.ts") : await import(pathToFileURL(path).href)
  ) as Record<string, unknown>;
  const runner = owner[run];
  if (typeof runner !== "function") {
    console.error(`yolo ${label}: ${module} does not export ${run}()`);
    return 70;
  }
  let status: number;
  let native: Awaited<ReturnType<typeof nativeJobPort>> | undefined;
  try {
    const rootOption = resolved.args.indexOf("--root");
    const updateArgs = resolved.args.filter(
      (arg, index) => !(arg === "--root" || (rootOption >= 0 && index === rootOption + 1)),
    );
    if (
      name === "update" &&
      updateArgs[0] === "systemd" &&
      updateArgs[1] === "jobs-clients" &&
      updateArgs.includes("--qualify") &&
      updateArgs.includes("--apply")
    )
      native = await nativeJobPort(root);
    const returned = await (runner as Runner)(resolved.args, native);
    status = typeof returned === "number" ? returned : 0;
  } catch (error) {
    console.error(`yolo ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    native?.close();
  }
  if (status === 0 && tools && isHelpRequest(resolved.args)) {
    console.log(`\nTools (yolo ${name} <tool> ...):`);
    for (const [tool, { summary }] of Object.entries(tools)) console.log(`  ${tool.padEnd(14)} ${summary}`);
  }
  return status;
}
