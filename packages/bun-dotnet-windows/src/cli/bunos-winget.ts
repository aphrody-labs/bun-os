#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos winget`: winget through its COM API in process (bun:winget), structured output (--json) or a table.
import { parseArgs } from "node:util";
import * as winget from "../winget.ts";

const USAGE = `bunos winget <command> [options]

  search <query>        catalog search (id, name, moniker, tags)
  list [query]          installed packages (--upgradable: only those with an update)
  show <id>             package details and versions
  install <id>          silent install (--version, --scope user|machine, --location, --force)
  upgrade <id>|--all    upgrade one package or every upgradable one
  uninstall <id>        silent uninstall
  sources               configured sources
  status                activation route (out-of-process, manual, in-process)

  --source <name>  --limit <n>  --json`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    source: { type: "string" },
    limit: { type: "string" },
    version: { type: "string" },
    scope: { type: "string" },
    location: { type: "string" },
    force: { type: "boolean" },
    all: { type: "boolean" },
    upgradable: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, ...rest] = positionals;
const limit = values.limit ? Number(values.limit) : undefined;
const source = values.source;

function table(rows: winget.WingetPackage[]): void {
  const cols = [
    ["Name", (r: winget.WingetPackage) => r.name],
    ["Id", r => r.id],
    ["Installed", r => r.installedVersion ?? ""],
    ["Available", r => (r.updateAvailable || !r.installed ? (r.version ?? "") : "")],
    ["Source", r => r.source ?? ""],
  ] as const;
  const widths = cols.map(([h, f]) => Math.min(48, Math.max(h.length, ...rows.map(r => f(r).length))));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.slice(0, widths[i]).padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  console.log(line(cols.map(([h]) => h)));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(cols.map(([, f]) => f(row))));
}

function progress(p: winget.WingetProgress): void {
  if (values.json) return;
  const pct = p.installationProgress ?? p.uninstallationProgress ?? p.downloadProgress;
  process.stderr.write(`\r${p.action} ${p.state}${pct !== undefined ? ` ${Math.round(pct * 100)}%` : ""}      `);
}

function print(value: unknown, rows?: winget.WingetPackage[]): void {
  if (values.json || !rows) console.log(JSON.stringify(value, null, values.json ? 0 : 2));
  else table(rows);
}

async function main(): Promise<number> {
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const options = { source, limit };
  const install = {
    source,
    version: values.version,
    scope: values.scope as "user" | "machine" | undefined,
    location: values.location,
    force: values.force,
    onProgress: progress,
  };
  switch (command) {
    case "search": {
      if (!rest[0]) throw new Error("search needs a query");
      const rows = await winget.search(rest.join(" "), options);
      print(rows, rows);
      return 0;
    }
    case "list": {
      const rows = await winget.list({ ...options, query: rest[0], upgradable: values.upgradable });
      print(rows, rows);
      return 0;
    }
    case "show":
      print(await winget.show(rest[0] ?? "", { source }));
      return 0;
    case "install":
    case "uninstall": {
      if (!rest[0]) throw new Error(`${command} needs a package id`);
      const result =
        command === "install" ? await winget.install(rest[0], install) : await winget.uninstall(rest[0], install);
      process.stderr.write("\n");
      print(result);
      return result.ok ? 0 : 1;
    }
    case "upgrade": {
      const ids = values.all ? (await winget.list({ source, upgradable: true })).map(p => p.id) : rest;
      if (ids.length === 0) throw new Error("upgrade needs a package id or --all");
      let failed = 0;
      for (const id of ids) {
        const result = await winget.upgrade(id, install);
        process.stderr.write("\n");
        print(result);
        if (!result.ok) failed++;
      }
      return failed ? 1 : 0;
    }
    case "sources":
      print(await winget.sources());
      return 0;
    case "status":
      print(winget.status());
      return 0;
    default:
      console.error(`bunos winget: unknown command '${command}'\n\n${USAGE}`);
      return 2;
  }
}

// No top-level await: `bun build --compile --bytecode` emits CommonJS.
main().then(
  code => process.exit(code),
  (error: unknown) => {
    console.error(`bunos winget: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
