#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { benchCompile, formatBench } from "./build/bench.ts";
import { bundleArgs, compileArgs, type CompileOptions } from "./build/bun.ts";
import { prepareEnv, runCargo, writeShims } from "./cargo.ts";
import { runDriver, writeCompileDatabase, type DriverKind } from "./driver.ts";
import { cacheDir } from "./lock.ts";
import { packagePlan, storePlan, type AppIdentity, type PackageFormat } from "./packaging/index.ts";
import {
  affectedCrates,
  aotBlockers,
  changedFiles,
  jobLimit,
  layerCrates,
  loadComponents,
  loadGraph,
  systemBudget,
} from "./plan.ts";
import { getProfile, profiles } from "./profiles.ts";
import { applicable, getProvider, makeContext } from "./providers/index.ts";
import { run } from "./process.ts";
import { cargoArgs, type CargoAction } from "./tasks.ts";
import { desktopCommand } from "./desktop/index.ts";
import { posixCommand, wineCommand } from "./posix-cli.ts";
import { ensureManaged, isManaged } from "./providers/ensure.ts";
import { shMain } from "./sh.ts";

const USAGE = `buncc: Bun C Compiler, toolchain manager and workspace builder

Driver (use as CC / CXX / AR):  buncc cc|c++|ar|link <compiler arguments>
Toolchains:   doctor [--repo (repository checks only)] [--all] | install <provider> [--run] | env <provider|all> [--shims] | which <tool> | pin
Workspace:    plan [--affected[=base]] [-p crate] | check|build|test|clippy|fmt [-p crate ...] [--affected[=base]] [--jobs N] [--release] [-- extra]
C LSP:        lsp [--out dir]          merge the driver's compile log into compile_commands.json and write .clangd
Build:        bundle <entry...> [--minify] [--splitting] | compile <entry> --outfile f [--aot] [--target bun-linux-x64] | aot <entry> --outfile f | wasm ...
Package:      package <msix|appx|msi|exe|zip> --dir d --out o --name N --publisher P ... | sign ... | store <package>
Profiles:     profile list|show|apply <id> [--run] | bench aot-bun <entry>
Linux desktop: linux closure|pins|sysroot|cross|build|container|hello <gnome-shell|mutter|gtk4|libadwaita|kwin|plasma-workspace|qtbase|...>   (buncc linux help)
Dotnet:       dotnet pins|install|env|doctor|publish -r <rid> [--aot] | pwsh   upstream .NET SDK + PowerShell on Linux, pinned (docs/DOTNET-LINUX.md)
Desktop:      desktop doctor|plan|fetch|build|env|pack|bench   GTK4/libadwaita, Qt6, KDE Frameworks on Windows (docs/BUNCC-DESKTOP.md)
POSIX:        sh [-c script | file]       Bun Shell (cross-platform); env posix --ensure adds pinned uutils/busybox/ripgrep shims
              install posix|mingw|msys2|wine|proton [--run] | posix doctor|smoke|uninstall <msys2|mingw|gnuwin32|cygwin|all> [--yes]
C env:        c doctor|env|sysroot|targets|build|test   (catalog factory/c/c-env.json, docs/BUNOS-C.md)
Wine:         wine run <exe> [args] | wine prefix <name> [--dxvk --vkd3d] | wine doctor   (Linux and macOS hosts)

Nothing is signed, published or licence-accepted unless you pass --run and the command says so. Default is a dry run for install/package/profile apply.`;

const argv = Bun.argv.slice(2);
const [command = "help", ...rest] = argv;

function flag(name: string): string | undefined {
  const index = rest.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index < 0) return undefined;
  const arg = rest[index]!;
  if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1);
  const next = rest[index + 1];
  return next && !next.startsWith("-") ? next : "true";
}
const has = (name: string) => flag(name) !== undefined;
function values(short: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === short && rest[i + 1]) out.push(rest[++i]!);
  return out;
}
const positional = (): string[] => {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--") break;
    if (arg === "-p") i++;
    else if (
      arg.startsWith("--") &&
      !arg.includes("=") &&
      ["out", "outfile", "dir", "target", "name", "publisher", "base", "jobs", "affected"].includes(arg.slice(2))
    )
      i++;
    else if (!arg.startsWith("-")) out.push(arg);
  }
  return out;
};

/** Repository root: nearest ancestor of the current directory that holds a Cargo.toml and a package.json. */
function findRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "Cargo.toml")) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

function printSteps(
  steps: { title: string; command?: string[]; writes?: { path: string }[]; needsApproval?: boolean }[],
) {
  for (const step of steps) {
    console.log(`- ${step.title}${step.needsApproval ? "  [needs explicit owner approval]" : ""}`);
    if (step.command) console.log(`    ${step.command.join(" ")}`);
    for (const write of step.writes ?? []) console.log(`    write ${write.path}`);
  }
}

async function selectCrates(root: string): Promise<{ packages: string[]; note: string }> {
  const explicit = values("-p");
  const affected = flag("affected");
  if (explicit.length) return { packages: explicit, note: "explicit -p" };
  if (!affected) return { packages: [], note: "whole workspace" };
  const base = affected === "true" ? "origin/os" : affected;
  const graph = await loadGraph(root);
  const result = affectedCrates(graph, await changedFiles(root, base));
  if (result.all) return { packages: [], note: `whole workspace (${result.reason})` };
  return { packages: result.crates, note: `affected vs ${base}: ${result.reason}` };
}

/** Repository checks (pins, generated documents, component manifest, one owner per capability); each prints its own summary. */
async function repoDoctor(root: string): Promise<number> {
  let failures = 0;
  console.log("--- repository consistency");
  for (const script of [
    "generate-components.ts --check",
    "check-components.ts",
    "generate-map.ts --check",
    "consistency.ts",
  ]) {
    const [file, ...args] = script.split(" ");
    const result = await run([process.execPath, join(root, "factory", "bunos", file!), ...args], {
      cwd: root,
      output: "inherit",
    });
    if (result.code !== 0) failures++;
  }
  return failures;
}

/** The other doctors of the repository, run as sub-commands of the one doctor (list: factory/bunos/architecture.json "doctors"). */
async function subDoctors(root: string): Promise<number> {
  let failures = 0;
  const file = join(root, "factory", "bunos", "architecture.json");
  const doctors: Record<string, string> = existsSync(file) ? ((await Bun.file(file).json()).doctors ?? {}) : {};
  for (const command of Object.values(doctors)) {
    console.log(`--- ${command}`);
    const [, ...argv] = command.split(" ");
    const result = await run([process.execPath, ...argv], { cwd: root, output: "inherit", timeoutMs: 300_000 });
    if (result.code !== 0) failures++;
  }
  return failures;
}

async function main(): Promise<number> {
  const root = findRoot();
  const cli = import.meta.path;
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    case "cc":
    case "c++":
    case "ar":
    case "link": {
      const result = await runDriver(command as DriverKind, rest);
      if (result.translation?.unknown.length)
        console.error(`buncc: unknown flags passed through: ${result.translation.unknown.join(" ")}`);
      return result.code;
    }
    case "doctor": {
      if (has("repo") && !has("all")) return (await repoDoctor(root)) ? 1 : 0;
      const ctx = makeContext(root);
      let failures = 0;
      const required = new Set(["rust", ctx.platform === "win32" ? "msvc" : "clang"]);
      for (const provider of applicable(ctx)) {
        const detection = await provider.detect(ctx);
        const mark = detection.found ? "ok " : required.has(provider.id) ? "ERR" : "-- ";
        if (!detection.found && required.has(provider.id)) failures++;
        const pin = await provider.pin?.(ctx);
        console.log(
          `${mark} ${provider.id.padEnd(15)} ${(detection.version ?? "").slice(0, 60).padEnd(40)} ${detection.path ?? ""}${pin ? `  (pin ${pin})` : ""}`,
        );
        for (const note of detection.notes ?? []) console.log(`      ${note}`);
        if (!detection.found && detection.fixHint) console.log(`      fix: ${detection.fixHint}`);
      }
      const prepared = await prepareEnv(Bun.env);
      for (const note of prepared.notes) console.log(`env: ${note}`);
      const blockers = aotBlockers(await loadComponents(root));
      for (const blocker of blockers)
        console.log(
          `AOT: ${blocker.id} cannot run in a bun compile --aot executable (${blocker.registration?.join(", ") ?? "aot:false"})`,
        );
      console.log(
        "WiX: buncc never accepts the OSMF EULA. If `wix` is installed, run `wix eula accept wix7` yourself before `buncc package msi`.",
      );
      if (has("all")) failures += await repoDoctor(root);
      if (has("all")) failures += await subDoctors(root);
      return failures ? 1 : 0;
    }
    case "sh":
      return shMain(rest);
    case "desktop":
      return desktopCommand(rest, root);
    case "posix":
      return posixCommand(rest, root);
    case "wine":
      return wineCommand(rest, root);
    case "linux":
      return (await import("./linux-target/cli.ts")).linuxMain(rest, root);
    case "dotnet":
    case "pwsh":
      return (await import("./dotnet-linux/cli.ts")).dotnetLinuxMain(rest, root, command);
    case "c":
      return (await import("./c/index.ts")).cCommand(rest);
    case "install": {
      if (isManaged(rest[0] ?? "")) {
        for (const line of await ensureManaged(rest[0] as never, !has("run"))) console.log(line);
        if (!has("run")) console.log("dry run: pass --run to download");
        return 0;
      }
      const provider = getProvider(rest[0] ?? "");
      const plan = provider.install(makeContext(root));
      if (plan.manual) console.log(`manual: ${plan.manual}`);
      for (const cmd of plan.commands) console.log(cmd.join(" "));
      if (!has("run")) return 0;
      for (const cmd of plan.commands) {
        const result = await run(cmd, { output: "inherit" });
        if (result.code !== 0) return result.code;
      }
      return 0;
    }
    case "env": {
      const ctx = makeContext(root);
      if (has("ensure") && isManaged(rest[0] ?? ""))
        for (const line of await ensureManaged(rest[0] as never, false)) console.error(line);
      const selected = rest[0] === "all" || !rest[0] ? applicable(ctx) : [getProvider(rest[0])];
      const merged: Record<string, string> = {};
      for (const provider of selected) Object.assign(merged, await provider.env(ctx));
      if (has("shims")) {
        const shims = writeShims(cli);
        Object.assign(merged, { CC: shims.cc, CXX: shims.cxx, AR: shims.ar });
      }
      console.log(JSON.stringify(merged, null, 2));
      return 0;
    }
    case "which": {
      const path = Bun.which(rest[0] ?? "");
      console.log(path ?? "not found");
      return path ? 0 : 1;
    }
    case "pin": {
      const ctx = makeContext(root);
      for (const provider of providersWithPins()) console.log(`${provider.id}: ${(await provider.pin?.(ctx)) ?? "-"}`);
      return 0;
    }
    case "plan": {
      const graph = await loadGraph(root);
      const selection = await selectCrates(root);
      const layers = layerCrates(graph, selection.packages.length ? selection.packages : undefined);
      const budget = systemBudget();
      console.log(`selection: ${selection.note}`);
      console.log(`jobs: ${jobLimit()} (cores ${budget.cores}, free ${(budget.freeBytes / 1024 ** 3).toFixed(1)} GiB)`);
      if (layers.cycle.length) console.log(`cycle among: ${layers.cycle.join(", ")}`);
      layers.layers.forEach((layer, index) =>
        console.log(`layer ${index}: ${layer.length} crate(s)${has("verbose") ? " " + layer.join(" ") : ""}`),
      );
      return layers.cycle.length ? 1 : 0;
    }
    case "check":
    case "build":
    case "test":
    case "clippy":
    case "fmt": {
      const selection = await selectCrates(root);
      const dash = rest.indexOf("--");
      const args = cargoArgs(command as CargoAction, {
        packages: selection.packages,
        release: has("release"),
        jobs: flag("jobs") ? Number(flag("jobs")) : undefined,
        extra: dash >= 0 ? rest.slice(dash + 1) : undefined,
      });
      console.error(`buncc: ${selection.note}: cargo ${args.join(" ")}`);
      if (selection.note.startsWith("affected") && selection.packages.length === 0) {
        console.error("buncc: nothing affected");
        return 0;
      }
      return (await runCargo(args, { root, driver: has("driver") })).code;
    }
    case "exec": {
      const dash = rest.indexOf("--");
      return (await runCargo(dash >= 0 ? rest.slice(dash + 1) : rest, { root })).code;
    }
    case "lsp": {
      const out = resolve(flag("out") ?? root);
      const log = Bun.env.BUNCC_COMPILE_COMMANDS ?? join(cacheDir(), "compile-commands.jsonl");
      const count = writeCompileDatabase(log, join(out, "compile_commands.json"));
      writeFileSync(join(out, ".clangd"), `CompileFlags:\n  CompilationDatabase: ${out.replaceAll("\\", "/")}\n`);
      console.log(
        `${count} entries from ${log}. Build with BUNCC_COMPILE_COMMANDS=${log} and CC=buncc shims (buncc env --shims) to fill it. clangd: ${Bun.which("clangd") ?? "not installed (buncc install clangd)"}`,
      );
      return 0;
    }
    case "bundle": {
      const args = bundleArgs({
        entry: positional(),
        outdir: flag("out") ?? "dist",
        minify: has("minify"),
        splitting: has("splitting"),
        target: (flag("target") as "bun") ?? "bun",
      });
      console.error(`buncc: bun ${args.join(" ")}`);
      return (await run([process.execPath, ...args], { output: "inherit" })).code;
    }
    case "compile":
    case "aot": {
      const options: CompileOptions = {
        entry: positional()[0] ?? "./index.ts",
        outfile: flag("outfile") ?? "./app",
        aot: command === "aot" || has("aot"),
        aotAllowCodeFromDisk: has("aot-allow-code-from-disk"),
        target: flag("target"),
        minify: has("minify"),
        bytecode: has("bytecode"),
      };
      const args = compileArgs(options);
      console.error(`buncc: bun ${args.join(" ")}`);
      return (await run([process.execPath, ...args], { output: "inherit" })).code;
    }
    case "wasm": {
      const module = join(root, "packages", "wasm", "src", "buncc.ts");
      if (!existsSync(module)) {
        console.error("buncc wasm: packages/wasm/src/buncc.ts is not in this checkout yet.");
        return 2;
      }
      const imported = (await import(module)) as {
        default?: (args: string[]) => Promise<number> | number;
        main?: (args: string[]) => Promise<number> | number;
      };
      const entry = imported.main ?? imported.default;
      if (!entry) throw new Error("packages/wasm/src/buncc.ts must export main(args) or a default function.");
      return await entry(rest);
    }
    case "package": {
      const format = (rest[0] ?? "zip") as PackageFormat;
      const app: AppIdentity = {
        name: flag("name") ?? "Aphrody.App",
        publisher: flag("publisher") ?? "CN=Aphrody",
        displayName: flag("display-name") ?? flag("name") ?? "App",
        publisherDisplayName: flag("publisher-name") ?? "Aphrody",
        version: flag("version") ?? "1.0.0",
        executable: flag("exe") ?? "app.exe",
      };
      const plan = packagePlan(format, app, flag("dir") ?? "dist", flag("out") ?? "out");
      console.log(`format ${plan.format}; tools: ${plan.requires.join(", ") || "none"}`);
      printSteps(plan.steps);
      if (!has("run")) return 0;
      for (const step of plan.steps) {
        if (step.needsApproval) {
          console.error(
            `buncc: step "${step.title}" needs your explicit approval; run it yourself: ${step.command?.join(" ")}`,
          );
          return 3;
        }
        for (const write of step.writes ?? []) writeFileSync(write.path, write.content);
        if (step.command && (await run(step.command, { output: "inherit" })).code !== 0 && !step.optional) return 1;
      }
      return 0;
    }
    case "sign":
      console.log(
        "buncc sign never signs by default. Sign AFTER `bun build --compile` (Bun strips Authenticode when it rewrites the exe). Commands:",
      );
      console.log("  signtool sign /fd SHA256 /sha1 <thumbprint> /tr <timestamp-url> /td SHA256 <file>");
      console.log(
        "  signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <Azure.CodeSigning.Dlib.dll> /dmdf <metadata.json> <file>",
      );
      return 0;
    case "store":
      printSteps(storePlan(rest[0] ?? "out/app.msix"));
      console.log(
        "The Store re-signs an MSIX only: submit an MSIX unsigned, but MSI and EXE installers must already be signed. Publishing always needs your explicit approval.",
      );
      return 0;
    case "profile": {
      const [sub = "list", id] = rest;
      if (sub === "list") {
        for (const profile of Object.values(profiles))
          console.log(`${profile.id.padEnd(14)} ${profile.axis}: ${profile.summary}`);
        return 0;
      }
      const profile = getProfile(id ?? "");
      const steps = profile.steps({
        entry: positional()[2],
        outfile: flag("outfile"),
        source: flag("source"),
        project: flag("project"),
        rid: flag("rid"),
        target: flag("target"),
      });
      if (sub === "show" || !has("run")) {
        console.log(`${profile.axis}\nrequires: ${profile.requires.join(", ") || "none"}`);
        for (const source of profile.sources) console.log(`source: ${source}`);
        for (const item of profile.unmeasured) console.log(`unmeasured: ${item}`);
        printSteps(steps);
        return 0;
      }
      for (const step of steps) {
        console.error(`buncc: ${step.title}`);
        const [program, ...args] = step.command;
        const result = await run(
          [program === "buncc" ? process.execPath : program!, ...(program === "buncc" ? [cli] : []), ...args],
          { output: "inherit" },
        );
        if (result.code !== 0) return result.code;
      }
      return 0;
    }
    case "bench": {
      const entry = positional()[1] ?? "./index.ts";
      const rows = [
        await benchCompile("compile", entry, "bench-plain", {}),
        await benchCompile("compile --aot", entry, "bench-aot", { aot: true }),
        await benchCompile("aot --minify", entry, "bench-aot-min", { aot: true, minify: true }),
      ];
      console.log(formatBench(rows));
      return rows.every(row => row.ok) ? 0 : 1;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function providersWithPins() {
  const ctx = makeContext(findRoot());
  return applicable(ctx).filter(provider => provider.pin);
}

process.exitCode = await main();
