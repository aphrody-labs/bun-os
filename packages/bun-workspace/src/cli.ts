#!/usr/bin/env bun
import {
  cargoModule,
  inspectRuntime,
  inspectSourceCoverage,
  listModuleStatus,
  loadConfig,
  repositoryRoot,
  resolveBunExecutable,
  runModule,
  syncModules,
  type ModuleStatus,
} from "./index.ts";

const help = `Aphrody Bun 1.4.4

  aphrody-bun doctor [--json]       Development runtime, tools and pinned library sources
  aphrody-bun list [--json]         Library source catalog
  aphrody-bun status [--json]       Revisions and local changes
  aphrody-bun sync                 Initialize pinned sources from a clean checkout
  aphrody-bun run <id> [args...]    Run an explicit headless engine CLI
  aphrody-bun check <id>            Check a native library owner
  aphrody-bun build <id>            Build a native library owner in release mode
  aphrody-bun git doctor|setup|profile|clone|status|prune|measure|generate   Git at monorepo scale (docs/MONOREPO-SCALE.md)

Native builds are serialized. Release and application builds enforce their target-specific Bun pin.`;

function moduleState(module: ModuleStatus): string {
  if (module.error) return "error";
  if (!module.pointerMatches) return "index differs";
  if (!module.initialized) return "not initialized";
  if (!module.revisionMatches) return "revision differs";
  if (!module.clean) return "modified";
  return module.sourceKind === "workspace" ? "workspace, clean" : "pinned, clean";
}

async function main(): Promise<number> {
  const [action = "help", ...args] = Bun.argv.slice(2);
  if (["help", "--help", "-h"].includes(action)) {
    console.log(help);
    return 0;
  }
  const config = await loadConfig();
  const json = args.includes("--json");
  switch (action) {
    case "list": {
      if (args.some(arg => arg !== "--json")) throw new Error("Usage: aphrody-bun list [--json]");
      if (json) console.log(JSON.stringify(config.modules, null, 2));
      else
        for (const module of config.modules)
          console.log(`${module.id.padEnd(14)} ${(module.role ?? "shared").padEnd(7)} ${module.description}`);
      return 0;
    }
    case "status": {
      if (args.some(arg => arg !== "--json")) throw new Error("Usage: aphrody-bun status [--json]");
      const modules = await listModuleStatus(config);
      if (json) console.log(JSON.stringify(modules, null, 2));
      else
        for (const module of modules) {
          const state = moduleState(module);
          console.log(`${module.id.padEnd(14)} ${state}${module.error ? ` : ${module.error}` : ""}`);
        }
      return modules.some(
        module =>
          module.error || !module.pointerMatches || (module.initialized && (!module.revisionMatches || !module.clean)),
      )
        ? 1
        : 0;
    }
    case "doctor": {
      if (args.some(arg => arg !== "--json")) throw new Error("Usage: aphrody-bun doctor [--json]");
      // The installed runtime is a development tool; release receipts remain
      // pinned to the target-specific distribution revision below.
      const runtime = inspectRuntime(config, undefined, true);
      const externalBun = await resolveBunExecutable(config, {
        runtimePolicy: "development",
      }).then(
        executable => ({ executable, error: null }),
        (error: unknown) => ({
          executable: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const tools = {
        bun: externalBun.executable,
        git: Bun.which("git"),
        cargo: Bun.which("cargo"),
        rustc: Bun.which("rustc"),
        powershell: process.platform === "win32" ? (Bun.which("pwsh") ?? Bun.which("powershell")) : null,
        flock: process.platform !== "win32" ? Bun.which("flock") : null,
      };
      const modules = await listModuleStatus(config);
      const coverage = await inspectSourceCoverage(config);
      const sourceFailures = modules.filter(
        module =>
          module.error ||
          !module.pointerMatches ||
          (module.sourceKind === "submodule" && !module.initialized) ||
          (module.sourceKind === "submodule" && !module.revisionMatches),
      );
      const ok =
        runtime.recognizedFork &&
        runtime.versionMatches &&
        Boolean(tools.bun && tools.git && tools.cargo && tools.rustc) &&
        Boolean(process.platform === "win32" ? tools.powershell : tools.flock) &&
        sourceFailures.length === 0 &&
        coverage.every(
          module => !module.errors.length && !module.missingWorkspaceMembers.length && !module.missingTargets.length,
        );
      const report = {
        ok,
        root: repositoryRoot,
        platform: process.platform,
        architecture: process.arch,
        runtime,
        externalBun,
        tools,
        modules,
        sourceFailures: sourceFailures.map(module => ({
          id: module.id,
          path: module.path,
          error: module.error,
          initialized: module.initialized,
          pointerMatches: module.pointerMatches,
          revisionMatches: module.revisionMatches,
        })),
        coverage,
      };
      if (json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `Bun ${runtime.version}+${runtime.revision}: ${runtime.recognizedFork && runtime.versionMatches ? "supported development fork" : "runtime differs"}`,
        );
        console.log(`Git/Cargo/Rust: ${tools.git && tools.cargo && tools.rustc ? "available" : "tool missing"}`);
        console.log(`Native Bun: ${externalBun.executable ? "verified" : externalBun.error}`);
        console.log(
          `Library sources: ${modules.filter(module => module.initialized && module.pointerMatches && module.revisionMatches && module.clean).length}/${modules.length} pinned, clean`,
        );
        const dirty = modules.filter(module => module.initialized && module.clean === false);
        console.log(
          `Dirty sources: ${dirty.length ? dirty.map(module => module.id).join(", ") : "none"} (reported; not modified)`,
        );
        for (const module of sourceFailures) {
          console.error(
            `Source pin: ${module.id}: ${module.error ?? (!module.initialized ? "not initialized" : "pin differs")}`,
          );
        }
        console.log(
          `Implementation: ${coverage.reduce((sum, module) => sum + module.cargoPackages, 0)} Cargo packages; ${coverage.reduce((sum, module) => sum + module.rustSources, 0)} Rust sources; ${coverage.reduce((sum, module) => sum + module.typescriptSources, 0)} TypeScript sources`,
        );
        for (const module of coverage) {
          for (const issue of [...module.errors, ...module.missingWorkspaceMembers, ...module.missingTargets]) {
            console.error(`Source coverage: ${module.id}: ${issue}`);
          }
        }
      }
      return ok ? 0 : 1;
    }
    case "git":
      return (await import("./git-cli.ts")).gitCommand(args);
    case "sync":
      if (args.length) throw new Error("Usage: aphrody-bun sync");
      await syncModules(config);
      console.log("Sources initialized at catalog revisions.");
      return 0;
    case "run": {
      const [id, ...moduleArgs] = args;
      if (!id) throw new Error("Usage: aphrody-bun run <id> [args...]");
      return runModule(config, id, moduleArgs[0] === "--" ? moduleArgs.slice(1) : moduleArgs);
    }
    case "check":
    case "build": {
      if (args.length !== 1) throw new Error(`Usage: aphrody-bun ${action} <id>`);
      return cargoModule(config, args[0]!, action);
    }
    default:
      throw new Error(`Unknown command: ${action}\n${help}`);
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
