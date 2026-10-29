#!/usr/bin/env bun
import { basename, join } from "node:path";
import { policyFor } from "./catalog";
import { loadConsoleReferences, validateConsoleReferences } from "./console/references";
import { runFormats } from "./formats/cli";
import { runFrontend, runLibrary } from "./frontend/cli";
import { launch, trace } from "./launcher";
import { runNative } from "./nds/cli";
import { probeHost } from "./probe";
import { runShell } from "./shell";
import { buildWorkspace, compileWorkspace, isCompileTarget, serveWorkspace, testWorkspace } from "./workspace";

async function serveRetroArchCli(args: string[]): Promise<void> {
  const { parseArgs } = await import("node:util");
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      core: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      frames: { type: "string" },
      profile: { type: "string" },
    },
  });
  // a bare id is a bep core: its file and BIOS directory come from usr/lib/libretro
  let core = values.core;
  let config: Record<string, string> | undefined;
  if (core && core === basename(core)) {
    const { coreSettings, libretroDir } = await import("./libretro");
    config = await coreSettings(core);
    const ext = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
    core = join(libretroDir(), `${core}_libretro.${ext}`);
  }
  if (values.frames) {
    const { RetroArch } = await import("./libretroarch");
    using ra = RetroArch.open({ core, content: positionals[0], config });
    let frames = 0;
    for (; frames < Number(values.frames) && ra.iterate(); frames++);
    const frame = ra.frame();
    console.log(
      JSON.stringify({
        frames,
        status: ra.status(),
        frame: frame && { ...frame, data: undefined, serial: String(frame.serial) },
      }),
    );
    process.exitCode = frames ? 0 : 1;
    return;
  }
  const { serveRetroArch } = await import("./libretroarch-serve");
  const { url, stop } = serveRetroArch({
    core,
    content: positionals[0],
    config,
    port: values.port ? Number(values.port) : 0,
    hostname: values.host,
    profile: values.profile,
  });
  console.log(`RetroArch at ${url}`);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const [command = "probe", appId, target, sources] = process.argv.slice(2);
  if (command === "probe") console.log(JSON.stringify(await probeHost(), null, 2));
  else if (command === "build") process.exitCode = await buildWorkspace(appId === "--release");
  else if (command === "test") process.exitCode = await testWorkspace();
  else if (command === "references") {
    const references = await loadConsoleReferences();
    const errors = await validateConsoleReferences(references);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(JSON.stringify(references, null, 2));
  } else if (command === "formats") process.exitCode = await runFormats(process.argv.slice(3));
  else if (command === "ds") {
    // Managed DS/3DS readers (Kuriimu2, SPICA, pk3DS) hosted through hostfxr (bun:ffi).
    const { main } = await import("@bun-os/ds-dotnet/cli");
    process.exitCode = main(process.argv.slice(3));
  } else if (command === "3ds" && appId === "cia") {
    // CIA management on top of our Azahar fork; keys come from the owner, never bundled.
    const { ciaMain } = await import("./ctr/cia");
    process.exitCode = await ciaMain(process.argv.slice(4));
  } else if (command === "3ds" && (appId === "patches" || appId === "addons" || appId === "homebrew")) {
    const { communityMain } = await import("./ctr/community");
    process.exitCode = await communityMain(appId, process.argv.slice(4));
  } else if (command === "nds:info" && appId)
    process.exitCode = await runNative(["info", appId, ...(target ? [target] : [])]);
  else if (command === "run" && appId) process.exitCode = await runNative(process.argv.slice(2));
  else if (command === "recompile") {
    // One owner: static recompilation lives in `re` (bun-re pipeline over these engine cores).
    const { recompileMain } = await import("@bun-os/re/pipeline");
    process.exitCode = await recompileMain(process.argv.slice(3));
  } else if (command === "compile") {
    const compileTarget = isCompileTarget(appId) ? appId : undefined;
    if (appId && !compileTarget && appId.startsWith("bun-"))
      throw new TypeError(`unsupported compile target: ${appId}`);
    process.exitCode = await compileWorkspace({
      target: compileTarget,
      outfile: compileTarget ? target : appId,
      bytecodeOrder: (compileTarget ? sources : target)?.split(","),
    });
  } else if (command === "web") await serveWorkspace();
  else if (command === "frontend") process.exitCode = await runFrontend(process.argv.slice(3));
  else if (command === "shell") process.exitCode = await runShell(process.argv.slice(3));
  else if (command === "library") process.exitCode = await runLibrary(process.argv.slice(3));
  else if (command === "qualify" && appId) console.log(JSON.stringify(policyFor(appId), null, 2));
  else if (command === "launch" && appId) process.exitCode = await launch(appId);
  else if (command === "trace" && appId) process.exitCode = await trace(appId);
  else if (command === "retroarch") await serveRetroArchCli(process.argv.slice(3));
  else {
    throw new Error(
      "reverse engineering (Replica, Ghidra, Magika, pipeline) lives in `re`.\nusage: bun-engine build [--release] | compile [bun-<os>-<arch>] [outfile] [bytecode-order] | test | web | shell [--session|status|install-session] | frontend [--port N] [--no-window] [--screenshot PNG] | library <scan|systems|games|routes|sources|add|default|bios|launch|check> | probe | references | formats <identify|header|sections|files|disasm|stream|compile> ... | 3ds cia <status|info|verify|decrypt|install> ... (CIA management over our Azahar fork) | 3ds patches <list|apply> | 3ds addons <list|install> | 3ds homebrew <build|install|run> (Azahar user-dir tooling) | ds <build|plugins|identify|list|extract|extract-all|png|h3d|exefs> ... (managed DS/3DS formats over hostfxr) | nds:info <rom.nds> [--json] | run <nds|3ds|switch|gba|nes|psx|wii|gc|arm|x86|linux> <image> [--headless] [--bios FILE] [--frames N] [--out DIR] | recompile <image> --target <exe|wasm> [--out DIR] (same as `re recompile`) | retroarch [--core ID|FILE] [--port N] [--frames N] [content] (libretroarch over WebGPU in the browser) | qualify <appid> | launch <appid> | trace <appid>",
    );
  }
}

void main();
