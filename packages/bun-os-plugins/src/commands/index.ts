// SPDX-License-Identifier: MIT
/**
 * The CLI commands of the aphrody-labs/bun fork (`bun <name>`) on unmodified upstream Bun, as `bunos <name>`.
 *
 * Upstream Bun treats an unknown `bun <name>` as a package script or file, so every fork command lives on as a
 * `bunos-<name>` bin of this package (`src/bin/bunos-<name>.ts`), which the Bun OS front door
 * (`packages/bunos-run/src/bunos.ts`) runs for `bunos <name>`. Each command routes to its one Bun OS owner:
 * a module ported into this package, a Bun package script of the checkout, or a native executable built from the
 * checkout (cargo target dirs) or installed on PATH. Nothing is emulated: a missing owner is an error that says
 * how to provide it. The full fork-to-Bun-OS map is docs/bun-engine/FORK-MIGRATION.md.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

export type Route =
  /** In-process module of this package: `run(args)` resolves to the exit code. */
  | { kind: "module"; load: () => Promise<{ run: (args: string[]) => Promise<number> }> }
  /** A Bun script of the checkout, run with this Bun: `bun <script> ...prefix ...args`. */
  | { kind: "script"; script: string; prefix?: string[] }
  /** Native executables, first found wins: cargo outputs of the checkout, then PATH. */
  | { kind: "exec"; candidates: string[][]; build?: string };

export interface ForkCommand {
  /** Fork command line (`bun mcp`). */
  fork: string;
  /** The Bun OS owner that implements it. */
  owner: string;
  route: Route;
  help: string;
}

const devtools = (command: "rename" | "docs" | "parse" | "bench"): Route => ({
  kind: "module",
  load: async () => {
    const { run } = await import("../devtools/devtools.ts");
    return { run: (args: string[]) => run(command, args) };
  },
});

/** `bunos <name>` → owner. Keys are the `bunos-<name>` bin names without the prefix. */
export const FORK_COMMANDS: Record<string, ForkCommand> = {
  rename: {
    fork: "bun rename",
    owner: "@aphrody/bun-os-plugins devtools",
    route: devtools("rename"),
    help: "literal renames across git files, journaled --apply and --restore",
  },
  docs: {
    fork: "bun docs",
    owner: "@aphrody/bun-os-plugins devtools",
    route: devtools("docs"),
    help: "search the Bun documentation (local docs/ or the bun.com index)",
  },
  parse: {
    fork: "bun parse",
    owner: "@aphrody/bun-os-plugins devtools",
    route: devtools("parse"),
    help: "imports and exports of JS/TS files through Bun.Transpiler",
  },
  bench: {
    fork: "bun bench",
    owner: "@aphrody/bun-os-plugins devtools",
    route: devtools("bench"),
    help: "micro-benchmarks of the running Bun",
  },
  n2b: {
    fork: "bun n2b",
    owner: "crates/aphrody-command (aphrody n2b)",
    route: { kind: "exec", candidates: [["n2b"], ["aphrody", "n2b"]], build: "cargo build -p aphrody" },
    help: "Node to Bun migration engine",
  },
  migrate: {
    fork: "bun migrate",
    owner: "crates/aphrody-command (aphrody n2b)",
    route: { kind: "exec", candidates: [["n2b"], ["aphrody", "n2b"]], build: "cargo build -p aphrody" },
    help: "alias of n2b",
  },
  mcp: {
    fork: "bun mcp",
    owner: "crates/aphrody-mcp",
    route: { kind: "exec", candidates: [["aphrody-mcp"], ["aphrody", "mcp"]], build: "cargo build -p aphrody-mcp" },
    help: "the unified Aphrody MCP server",
  },
  "agent-plugin": {
    fork: "bun agent-plugin",
    owner: "packages/bun-workspace automation",
    route: { kind: "script", script: "packages/bun-workspace/src/automation/cli.ts", prefix: ["agent-plugin"] },
    help: "agent plugins, skills and MCP registrations for Claude Code, Codex and Gemini CLI",
  },
  workspace: {
    fork: "bun workspace (bin entry)",
    owner: "packages/bun-workspace automation",
    route: { kind: "script", script: "packages/bun-workspace/src/automation/cli.ts" },
    help: "Bun OS workspace automation",
  },
  lsp: {
    fork: "bun lsp",
    owner: "TypeScript native preview language server",
    route: {
      kind: "exec",
      candidates: [
        ["tsgo", "--lsp", "--stdio"],
        ["typescript-language-server", "--stdio"],
      ],
    },
    help: "TypeScript language server over stdio (the fork's bun_lsp needs the fork engine)",
  },
  wasm: {
    fork: "bun wasm",
    owner: "packages/wasm (@aphrody/wasm)",
    route: { kind: "script", script: "packages/wasm/src/cli.ts" },
    help: "Rust to WebAssembly: build, inspect, validate, optimize, run",
  },
  search: {
    fork: "bun search",
    owner: "crates/bun-os-google (aphrody search)",
    route: { kind: "exec", candidates: [["aphrody", "search"]], build: "cargo build -p aphrody" },
    help: "Google search through the shared Rust SERP client",
  },
  crawl: {
    fork: "bun crawl (bin entry, Bun.Crawl)",
    owner: "crates/aphrody-web (aphrody web crawl)",
    route: { kind: "exec", candidates: [["aphrody", "web", "crawl"]], build: "cargo build -p aphrody" },
    help: "bounded crawl through the shared Rust frontier",
  },
  ssh: {
    fork: "bun ssh",
    owner: "crates/aphrody-ssh (aphrody ssh)",
    route: { kind: "exec", candidates: [["aphrody", "ssh"]], build: "cargo build -p aphrody" },
    help: "operator SSH for configured hosts",
  },
  just: {
    fork: "bun just",
    owner: "just (Rust, packages/buncc provider)",
    route: { kind: "exec", candidates: [["just"]], build: "bun packages/buncc/src/cli.ts install just --run" },
    help: "the just command runner",
  },
  uv: {
    fork: "bun uv",
    owner: "uv (Rust, packages/buncc provider, crates/aphrody-toolchains)",
    route: { kind: "exec", candidates: [["uv"]], build: "bun packages/buncc/src/cli.ts install uv --run" },
    help: "the uv Python package manager",
  },
  msvc: {
    fork: "bun msvc",
    owner: "packages/buncc msvc provider",
    route: { kind: "script", script: "packages/buncc/src/cli.ts", prefix: ["env", "msvc"] },
    help: "MSVC, Windows SDK and vcvars environment without vswhere",
  },
  sh: {
    fork: "bunsh (argv0)",
    owner: "packages/buncc (buncc sh, Bun Shell)",
    route: { kind: "script", script: "packages/buncc/src/cli.ts", prefix: ["sh"] },
    help: "Bun Shell as a system shell",
  },
  plugin: {
    fork: "bun plugin",
    owner: "@aphrody/bun-os-plugins registry",
    route: { kind: "script", script: "packages/bun-os-plugins/src/cli.ts" },
    help: "list and check the Bun OS plugin registry",
  },
  env: {
    fork: "bun env",
    owner: "crates/bun-os-env-cookie (bun-os-env)",
    route: { kind: "exec", candidates: [["bun-os-env"]], build: "cargo build -p bun_env_cookie" },
    help: "read and edit .env files",
  },
  cookie: {
    fork: "bun cookie",
    owner: "crates/bun-os-env-cookie (bun-os-cookie)",
    route: { kind: "exec", candidates: [["bun-os-cookie"]], build: "cargo build -p bun_env_cookie" },
    help: "cookie jars on disk",
  },
  host: {
    fork: "bun host",
    owner: "crates/bun-os-host (bun-os-host)",
    route: { kind: "exec", candidates: [["bun-os-host"]], build: "cargo build -p bun_host" },
    help: "host resource inventory and shared host registry",
  },
};

/** The Bun OS checkout this package lives in. */
export function checkoutRoot(): string {
  return process.env.BUNOS_REPO || join(import.meta.dir, "..", "..", "..", "..");
}

const EXE = process.platform === "win32" ? ".exe" : "";

/** A native executable: the checkout's cargo outputs first (release, then debug), then PATH. */
export function findExecutable(name: string, root = checkoutRoot()): string | null {
  const targets = [process.env.CARGO_TARGET_DIR, join(root, "target")].filter(Boolean) as string[];
  for (const target of targets)
    for (const profile of ["release", "debug"]) {
      const path = join(target, profile, `${name}${EXE}`);
      if (existsSync(path)) return path;
    }
  return Bun.which(name);
}

/** The argv a command runs, or an error message when its owner is not available here. */
export function resolveArgv(
  name: string,
  args: readonly string[],
  root = checkoutRoot(),
): { argv: string[] } | { error: string } | { module: ForkCommand } {
  const command = FORK_COMMANDS[name];
  if (!command) return { error: `unknown fork command '${name}'` };
  const { route } = command;
  if (route.kind === "module") return { module: command };
  if (route.kind === "script") {
    const script = join(root, route.script);
    if (!existsSync(script)) return { error: `${command.owner}: ${route.script} is not in this checkout (${root})` };
    return { argv: [process.execPath, script, ...(route.prefix ?? []), ...args] };
  }
  for (const [exe, ...prefix] of route.candidates) {
    const path = findExecutable(exe!, root);
    if (path) return { argv: [path, ...prefix, ...args] };
  }
  const tried = route.candidates.map(c => c[0]).join(", ");
  return {
    error: `${command.owner}: none of ${tried} is built or on PATH${route.build ? `; build it with \`${route.build}\`` : ""}`,
  };
}

/** Run `bunos <name> ...args` and resolve to its exit code. */
export async function runCommand(name: string, args: string[]): Promise<number> {
  const resolved = resolveArgv(name, args);
  if ("error" in resolved) {
    console.error(`bunos ${name}: ${resolved.error}`);
    return 127;
  }
  if ("module" in resolved) {
    const route = resolved.module.route as Extract<Route, { kind: "module" }>;
    return (await route.load()).run(args);
  }
  const proc = Bun.spawn(resolved.argv, { stdio: ["inherit", "inherit", "inherit"], windowsHide: true });
  return await proc.exited;
}

/** Entry of a `src/bin/bunos-<name>.ts` bin: the command name is the file name. */
export async function binMain(path: string): Promise<never> {
  const name = basename(path)
    .replace(/\.[cm]?[jt]s$/, "")
    .replace(/^bunos-/, "");
  process.exit(await runCommand(name, process.argv.slice(2)));
}

/** `bunos-<name>` bins of this package, `bin` field form. */
export function binTable(): Record<string, string> {
  return Object.fromEntries(Object.keys(FORK_COMMANDS).map(n => [`bunos-${n}`, `./src/bin/bunos-${n}.ts`]));
}
