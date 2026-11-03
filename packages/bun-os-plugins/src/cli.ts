#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// bun-os-plugins list [--json] | check | commands [--json]: the registry inventory, an import of every module
// specifier, and where each fork CLI command (`bunos <name>`) resolves on this host.
import { existsSync } from "node:fs";
import { FORK_COMMANDS, resolveArgv } from "./commands/index.ts";
import { targetPath } from "./define.ts";
import { inventory, plugins, registerAll } from "./index.ts";

const [command = "list", ...rest] = process.argv.slice(2);

if (command === "list") {
  const rows = inventory();
  if (rest.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else
    for (const r of rows)
      console.log(
        `${r.kind.padEnd(6)} ${r.name.padEnd(28)} ${r.plugin}${r.replaces.length ? `  (fork: ${r.replaces.join(", ")})` : ""}`,
      );
} else if (command === "check") {
  registerAll();
  let failed = 0;
  for (const r of inventory()) {
    try {
      if (r.kind === "bin") {
        const spec = plugins.find(p => p.spec.name === r.plugin)!.spec;
        const path = targetPath(spec.bins![r.name]!);
        if (!existsSync(path)) throw new Error(`missing ${path}`);
        console.log(`ok     ${r.name.padEnd(28)} bin`);
        continue;
      }
      const value =
        r.kind === "module"
          ? await import(r.name)
          : r.name
              .split(".")
              .reduce<any>((o, k) => (k === "Bun" ? Bun : k === "globalThis" ? globalThis : o?.[k]), globalThis);
      const keys = value && typeof value === "object" ? Object.keys(value).length : typeof value;
      console.log(`ok     ${r.name.padEnd(28)} ${keys}`);
    } catch (error) {
      failed++;
      console.log(`FAIL   ${r.name.padEnd(28)} ${(error as Error).message.split("\n")[0]}`);
    }
  }
  process.exit(failed ? 1 : 0);
} else if (command === "commands") {
  const rows = Object.entries(FORK_COMMANDS).map(([name, c]) => {
    const resolved = resolveArgv(name, []);
    const status =
      "error" in resolved
        ? `unavailable: ${resolved.error}`
        : "module" in resolved
          ? "in-process"
          : resolved.argv.join(" ");
    return { name: `bunos ${name}`, fork: c.fork, owner: c.owner, status };
  });
  if (rest.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else
    for (const r of rows)
      console.log(`${r.name.padEnd(20)} ${r.fork.padEnd(20)} ${r.owner}\n${"".padEnd(20)} ${r.status}`);
} else {
  console.error("usage: bun-os-plugins list [--json] | check | commands [--json]");
  process.exit(2);
}
