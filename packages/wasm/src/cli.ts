#!/usr/bin/env bun
// aphrody-wasm build|opt|inspect|validate|run|tools
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { build, inspect, optimize, runCommand, validate, type BuildOptions, type OptimizeLevel } from "./index.ts";
import { toolchain } from "./buncc.ts";

const usage = `aphrody-wasm <command>

  build [crate] [--outdir d] [--package p] [--wasi p1|p2] [--target web|bundler|nodejs|...] [--profile p]
        [--opt-level Oz] [--no-opt] [--max-bytes n] [--artifact f] [--features a,b] [--locked]
  opt <in.wasm> [-o out.wasm] [--level Oz] [-g]
  inspect <file.wasm>        imports, exports, features, WASI kind (JSON)
  validate <file.wasm>       exit 0 when WebAssembly.validate accepts it
  run <file.wasm> [args...]  run a WASI command with bun
  tools                      cargo / target / wasm-bindgen / wasm-opt availability and pinned versions`;

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  switch (command) {
    case "build": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          outdir: { type: "string", short: "o" },
          package: { type: "string", short: "p" },
          wasi: { type: "string" },
          target: { type: "string" },
          profile: { type: "string" },
          "opt-level": { type: "string" },
          "no-opt": { type: "boolean" },
          "max-bytes": { type: "string" },
          artifact: { type: "string" },
          features: { type: "string" },
          locked: { type: "boolean" },
          dev: { type: "boolean" },
          name: { type: "string" },
        },
      });
      const options: BuildOptions = {
        crate: positionals[0],
        outdir: values.outdir,
        package: values.package,
        wasi: values.wasi as BuildOptions["wasi"],
        target: values.target as BuildOptions["target"],
        profile: values.dev ? "dev" : values.profile,
        optimize: values["no-opt"] ? false : (values["opt-level"] as OptimizeLevel | undefined),
        maxBytes: values["max-bytes"] ? Number(values["max-bytes"]) : undefined,
        artifact: values.artifact,
        features: values.features?.split(","),
        locked: values.locked,
        name: values.name,
      };
      const result = await build(options);
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    case "opt": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { o: { type: "string", short: "o" }, level: { type: "string" }, g: { type: "boolean", short: "g" } },
      });
      if (!positionals[0]) throw new Error("opt: input file required");
      const result = await optimize(positionals[0], {
        output: values.o,
        level: values.level as OptimizeLevel | undefined,
        debug: values.g,
      });
      console.log(JSON.stringify(result));
      return 0;
    }
    case "inspect": {
      if (!rest[0]) throw new Error("inspect: file required");
      console.log(JSON.stringify(inspect(readFileSync(rest[0])), null, 2));
      return 0;
    }
    case "validate": {
      if (!rest[0]) throw new Error("validate: file required");
      const ok = validate(readFileSync(rest[0]));
      console.log(ok ? "valid" : "invalid");
      return ok ? 0 : 1;
    }
    case "run": {
      if (!rest[0]) throw new Error("run: file required");
      const result = await runCommand(rest[0], { args: rest.slice(1) });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return result.exitCode;
    }
    case "tools": {
      console.log(JSON.stringify(await toolchain(), null, 2));
      return 0;
    }
    default:
      console.error(usage);
      return command ? 2 : 0;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
