#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos pwsh`: PowerShell 7 (vendor/powershell build). `-c <script>` / `<file.ps1>` run in process (bun:pwsh) and
// print the output objects as JSON; `--spawn` uses pwsh.exe instead; no script starts the interactive pwsh.exe.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as pwsh from "../pwsh.ts";

const USAGE = `bunos pwsh [-c <script> | <file.ps1>] [--depth <n>] [--json] [--spawn] [--fresh]
bunos pwsh version
bunos pwsh                  interactive pwsh.exe (source build, else PATH)`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    command: { type: "string", short: "c" },
    depth: { type: "string" },
    json: { type: "boolean" },
    spawn: { type: "boolean" },
    fresh: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

async function main(): Promise<number> {
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals[0] === "version") {
    console.log(JSON.stringify(await pwsh.start(), null, 2));
    return 0;
  }
  const script = values.command ?? (positionals[0] ? readFileSync(positionals[0], "utf8") : undefined);
  if (script === undefined) {
    const exe = pwsh.executable();
    if (!exe) throw new Error("no pwsh executable");
    const proc = Bun.spawn([exe, "-NoLogo", ...positionals.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  const depth = values.depth ? Number(values.depth) : undefined;
  if (values.spawn) {
    const result = await pwsh.spawn(script, { depth });
    if (result.stderr) process.stderr.write(result.stderr);
    console.log(JSON.stringify(result.output, null, values.json ? 0 : 2));
    return result.exitCode;
  }
  const result = await pwsh.evaluate(script, { depth, fresh: values.fresh });
  if (values.json) {
    console.log(JSON.stringify(result));
  } else {
    for (const item of result.output) console.log(typeof item === "string" ? item : JSON.stringify(item, null, 2));
    for (const warning of result.warnings) console.error(`WARNING: ${warning}`);
    for (const error of result.errors) console.error(`ERROR: ${error}`);
  }
  return result.hadErrors ? 1 : 0;
}

// No top-level await: `bun build --compile --bytecode` emits CommonJS.
main().then(
  code => process.exit(code),
  (error: unknown) => {
    console.error(`bunos pwsh: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
