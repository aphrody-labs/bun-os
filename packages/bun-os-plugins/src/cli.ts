#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// bun-os-plugins list [--json] | check: the registry inventory, and an import of every module specifier.
import { inventory, registerAll } from "./index.ts";

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
    if (r.kind === "bin") continue;
    try {
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
} else {
  console.error("usage: bun-os-plugins list [--json] | check");
  process.exit(2);
}
