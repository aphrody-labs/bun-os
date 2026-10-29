import { join } from "node:path";
import { assertRuntime, loadConfig, repositoryRoot, resolveBunExecutable, runNative } from "@aphrody/bun-workspace";
import { buildDesktop, desktopRoot } from "./build.ts";

const command = process.argv[2];
if (command !== "dev" && command !== "build") {
  console.error("Usage: bun native.ts dev|build");
  process.exit(2);
}
const config = await loadConfig(repositoryRoot);
assertRuntime(config);
const bun = await resolveBunExecutable(config, { root: repositoryRoot });
const aphrody = Bun.which("aphrody");
if (!aphrody) throw new Error("Install the native Aphrody CLI before running the desktop.");
const output = await buildDesktop();
const nativeConfig =
  command === "dev"
    ? {
        plugins: {
          aphrody: {
            bun: {
              sidecar: null,
              entry: join(output, "server.js"),
              binary: bun,
              cwd: repositoryRoot,
              hot: true,
              env: { APHRODY_ROOT: repositoryRoot },
            },
          },
        },
        bundle: { externalBin: [] },
      }
    : {};

if (command === "build") {
  const rust = Bun.spawn({
    cmd: ["rustc", "-vV"],
    stdout: "pipe",
    stderr: "inherit",
    timeout: 15_000,
    windowsHide: true,
  });
  const version = await new Response(rust.stdout).text();
  if ((await rust.exited) !== 0) throw new Error("Unable to detect the native Rust target.");
  const triple = version.match(/^host:\s*(\S+)/m)?.[1];
  if (!triple) throw new Error("rustc -vV did not report a native target.");
  const filename = "aphrody-server-" + triple + (process.platform === "win32" ? ".exe" : "");
  const backend = await Bun.build({
    entrypoints: [join(desktopRoot, "server.ts")],
    target: "bun",
    minify: true,
    compile: {
      outfile: join(output, "native", filename),
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadPackageJson: false,
    },
  });
  if (!backend.success) throw new AggregateError(backend.logs, "Bun sidecar compilation failed");
}
const argv = [aphrody, "tauri", command, "--config", JSON.stringify(nativeConfig), "--", "--locked", "--jobs", "1"];
process.exitCode = await runNative(config, argv, {
  root: repositoryRoot,
  cwd: desktopRoot,
  timeoutMs: command === "dev" ? 43_200_000 : 3_600_000,
  serialize: command === "build",
  env: { APHRODY_ROOT: repositoryRoot },
});
