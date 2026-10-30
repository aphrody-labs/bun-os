// SPDX-License-Identifier: Apache-2.0
// One command registry for Bun OS. Commands are data: a group, a name, a summary and a runner.
// The registry never duplicates logic; it routes to the owner (a script, a package CLI or an in-process module).
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dir, "../..");

export interface Command {
  /** Empty for top-level commands (`bunos doctor`). */
  group: string;
  name: string;
  summary: string;
  /** Arguments synopsis shown by --help, Omarchy style: <required> [optional] [a|b|c]. */
  usage?: string;
  /** Repo-relative file the command runs, verified by `bunos commands --check`. */
  target?: string;
  /** Hidden from the short list; shown with --all. */
  advanced?: boolean;
  /** The underlying owner handles --help itself (including nested commands). */
  passthroughHelp?: boolean;
  run(args: string[]): Promise<number> | number;
}

export interface Group {
  name: string;
  summary: string;
}

export const GROUPS: Group[] = [
  { name: "cargo", summary: "Rust workspace: metadata, format, check, test, serialized cargo" },
  { name: "workspace", summary: "Catalog, assets, manifests and inventories of the Bun OS workspace" },
  { name: "build", summary: "Build apps, packages, images, WebAssembly and releases" },
  { name: "factory", summary: "Distribution factory: plans, graphs, Arch rootfs, images, MSYS2, usr" },
  { name: "docs", summary: "Documentation gates" },
  { name: "desktop", summary: "Bun desktop app" },
  { name: "iecode", summary: "IECODE data, storage, database and web tooling" },
  { name: "rg", summary: "Rose Griffon workspace builds" },
  { name: "nie", summary: "NIE Rust and web builds" },
  { name: "infra", summary: "Hosts, services, deployment, probes and pipelines" },
  { name: "ops", summary: "Workspace operations" },
  { name: "server", summary: "Bun OS product server" },
  {
    name: "tool",
    summary:
      "Every package CLI of the workspace (m3, yolo, bep, steam, android, ...), discovered from package.json bin",
  },
];

const registry: Command[] = [];
export const commands = registry;

export function define(...list: Command[]) {
  for (const c of list) {
    if (registry.some(x => x.group === c.group && x.name === c.name))
      throw new Error(`duplicate command: ${c.group} ${c.name}`.trim());
    registry.push(c);
  }
}

export const abs = (path: string) => join(root, path);

/** Spawn a child with inherited stdio and return its exit code. */
export async function spawn(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

/** Run a repo script (or package CLI) with the current Bun, fixed arguments first, user arguments after. */
export function script(target: string, ...fixed: string[]): Pick<Command, "target" | "run"> {
  return { target, run: args => spawn([process.execPath, abs(target), ...fixed, ...args]) };
}

/** Run a native Bun command (`bun check`, `bun lint`, `bun fmt`) with centrally defined flags. */
export function native(verb: string, ...fixed: string[]): Pick<Command, "run"> {
  return { run: args => spawn([process.execPath, verb, ...fixed, ...args]) };
}

/** Run another bunos command chain in sequence, stopping at the first failure. */
export function sequence(...steps: (() => Promise<number> | number)[]): Pick<Command, "run"> {
  return {
    run: async () => {
      for (const step of steps) {
        const code = await step();
        if (code !== 0) return code;
      }
      return 0;
    },
  };
}

export function find(group: string, name: string): Command | undefined {
  return registry.find(c => c.group === group && c.name === name);
}
