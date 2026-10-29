// SPDX-License-Identifier: Apache-2.0
// bunos <command> [args...]: the single entry point of Bun OS (command center, groups, discovery).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import "./commands.ts";
import { abs, commands, define, GROUPS, root, spawn, type Command } from "./registry.ts";

interface ToolBin {
  bin: string;
  pkg: string;
  target: string;
}

/** Every `bin` of every workspace package: the `tool` group is discovered, never hard-coded. */
async function discoverTools(): Promise<ToolBin[]> {
  const out: ToolBin[] = [];
  const workspace = (await Bun.file(join(root, "package.json")).json()) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const members = Array.isArray(workspace.workspaces) ? workspace.workspaces : (workspace.workspaces?.packages ?? []);
  const manifests = new Set<string>();
  for (const member of members) {
    for await (const file of new Bun.Glob(`${member.replace(/\/$/, "")}/package.json`).scan({ cwd: root }))
      manifests.add(file.replaceAll("\\", "/"));
  }
  for (const file of [...manifests].sort()) {
    let json: { name?: string; bin?: string | Record<string, string> };
    try {
      json = await Bun.file(join(root, file)).json();
    } catch {
      continue;
    }
    if (!json.bin) continue;
    const packageName = json.name?.split("/").pop() ?? dirname(file).split("/").pop()!;
    const entries = typeof json.bin === "string" ? { [packageName]: json.bin } : json.bin;
    for (const [bin, path] of Object.entries(entries)) {
      out.push({ bin, pkg: dirname(file), target: join(dirname(file), path).replaceAll("\\", "/") });
    }
  }
  return out.sort((a, b) => a.bin.localeCompare(b.bin));
}

function registerTools(tools: ToolBin[]) {
  for (const t of tools) {
    const existing = commands.find(command => command.group === "tool" && command.name === t.bin);
    if (existing?.target === t.target) continue;
    define({
      group: "tool",
      name: t.bin,
      summary: `${t.pkg}`,
      target: t.target,
      advanced: true,
      run: args => spawn([process.execPath, abs(t.target), ...args]),
    });
  }
}

/** Commands of the abandoned Aphrody Bun fork. The runtime is now unmodified upstream Bun, which has none of them. */
const REMOVED: Record<string, string> = {
  mcp: "the fork's native MCP server; upstream Bun has no `bun mcp`.",
  "agent-plugin": "the fork's agent plugin installer; upstream Bun has no `bun agent-plugin`.",
  n2b: "the fork's Node.js migration tool; upstream Bun has no `bun n2b`. Use `bun check` and `bun lint`.",
  wasm: "the fork's WebAssembly toolchain; upstream Bun has no `bun wasm`. For the portable libm3 library use `bunos build wasm`.",
};

const label = (c: Command) => `${c.group ? `${c.group} ` : ""}${c.name}`;
const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - s.length));

function centerHelp(all: boolean) {
  const top = commands.filter(c => !c.group && (all || !c.advanced));
  console.log(
    "bunos: Bun OS command center\n\nUsage: bunos <command> [args...]\n       bunos <group> <command> [args...]\n",
  );
  console.log("Commands");
  for (const c of top) console.log(`  ${pad(c.name, 14)}${c.summary}`);
  console.log(`  ${pad("commands", 14)}List every command [--all] [--json] [--check]`);
  console.log("\nGroups");
  for (const g of GROUPS) {
    const n = commands.filter(c => c.group === g.name).length;
    if (n) console.log(`  ${pad(g.name, 14)}${g.summary} (${n})`);
  }
  console.log("\nbunos <group> --help lists a group; bunos <group> <command> --help shows one command.");
}

function groupHelp(name: string) {
  const g = GROUPS.find(x => x.name === name);
  console.log(`bunos ${name}: ${g?.summary ?? ""}\n`);
  for (const c of commands.filter(x => x.group === name))
    console.log(`  ${pad(c.name + (c.usage ? ` ${c.usage}` : ""), 44)}${c.summary}`);
}

function commandHelp(c: Command) {
  console.log(
    `bunos ${label(c)}${c.usage ? ` ${c.usage}` : ""}\n\n${c.summary}${c.target ? `\nOwner: ${c.target}` : ""}`,
  );
}

/** Verify that every command target exists and report duplicate routes and scripts that bypass bunos. */
async function check(): Promise<number> {
  const problems: string[] = [];
  const notices: string[] = [];
  for (const c of commands) {
    if (!c.target || existsSync(abs(c.target))) continue;
    // Package bins that point into dist/ exist only after that package is built.
    if (c.target.includes("/dist/")) notices.push(`built output not present yet: ${label(c)} -> ${c.target}`);
    else problems.push(`missing target: ${label(c)} -> ${c.target}`);
  }
  const byTarget = new Map<string, string[]>();
  for (const c of commands) {
    if (c.group === "tool" && c.target) byTarget.set(c.target, [...(byTarget.get(c.target) ?? []), c.name]);
  }
  const duplicates = [...byTarget].filter(([, names]) => names.length > 1);
  for (const [target, names] of duplicates) notices.push(`one owner, several names: ${names.join(", ")} -> ${target}`);
  const pkg = (await Bun.file(join(root, "package.json")).json()) as { scripts?: Record<string, string> };
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (!/^bun src\/cli\.ts( |$)/.test(cmd))
      problems.push(`package.json script "${name}" does not route through bunos: ${cmd.slice(0, 80)}`);
  }
  for (const n of notices) console.log(`note: ${n}`);
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
    return 1;
  }
  console.log(`ok: ${commands.length} commands, ${GROUPS.length} groups`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  registerTools(await discoverTools());
  const [first, second, ...rest] = argv;
  const wantsHelp = (a: string[]) => a.includes("--help") || a.includes("-h");

  if (!first || first === "help" || first === "--help" || first === "-h") {
    centerHelp(argv.includes("--all"));
    return 0;
  }
  if (first === "commands") {
    const flags = argv.slice(1);
    if (flags.includes("--check")) return check();
    const list = commands.filter(c => flags.includes("--all") || !c.advanced);
    if (flags.includes("--json")) {
      console.log(
        JSON.stringify(
          list.map(({ group, name, summary, usage, target, advanced }) => ({
            group,
            name,
            summary,
            usage,
            target,
            advanced: !!advanced,
          })),
          null,
          2,
        ),
      );
    } else {
      for (const c of list) console.log(`${pad(label(c), 32)}${c.summary}`);
    }
    return 0;
  }

  const top = commands.find(c => !c.group && c.name === first);
  if (top) {
    if (!top.passthroughHelp && wantsHelp([second ?? "", ...rest])) return (commandHelp(top), 0);
    return await top.run(argv.slice(1));
  }
  const group = GROUPS.find(g => g.name === first);
  if (!group) {
    if (Object.hasOwn(REMOVED, first)) {
      console.error(
        `bunos ${first} was removed: ${REMOVED[first]} Upstream commands: bun check, bun lint, bun fmt, bun compile (see bun --help).`,
      );
      return 2;
    }
    console.error(`Unknown command "${first}". Run bunos for the command center.`);
    return 2;
  }
  if (!second || second === "--help" || second === "-h") {
    groupHelp(first);
    return 0;
  }
  const command = commands.find(c => c.group === first && c.name === second);
  if (!command) {
    console.error(`Unknown command "${first} ${second}". Run bunos ${first} --help.`);
    return 2;
  }
  if (rest.length === 1 && wantsHelp(rest) && command.group !== "tool") return (commandHelp(command), 0);
  return await command.run(rest);
}
