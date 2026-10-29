import { dirname, join } from "node:path";
import frontend from "../web/app/index.html";
import { frontendRoutes } from "./frontend/api";
import { consolePlugins, formatPlugins } from "./plugins";

const root = join(import.meta.dir, "..", "..", "..");
const cargo = join(root, "scripts", "aphrody", "build", "rust", "cargo-serial.ts");

export const compileTargets = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-windows-x64",
  "bun-windows-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
] as const;

export type CompileTarget = (typeof compileTargets)[number];

export interface CompileWorkspaceOptions {
  target?: CompileTarget;
  outfile?: string;
  bytecodeOrder?: string | string[];
}

export interface WorkspaceServerOptions {
  hostname?: string;
  port?: number;
}

export function isCompileTarget(value: string | undefined): value is CompileTarget {
  return compileTargets.includes(value as CompileTarget);
}

async function run(command: string[], cwd = root): Promise<number> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

export async function buildWorkspace(release = false): Promise<number> {
  const args = ["bun", cargo, "--msvc", "build"];
  if (release) args.push("--release");
  return run(args);
}

export async function testWorkspace(): Promise<number> {
  const bunTests = await run(["bun", "test", "./test"]);
  if (bunTests !== 0) return bunTests;
  return run(["bun", cargo, "--msvc", "test", "--workspace"]);
}

export async function compileWorkspace(options: CompileWorkspaceOptions = {}): Promise<number> {
  const extension = options.target?.startsWith("bun-windows-") || process.platform === "win32" ? ".exe" : "";
  const outfile = join(root, options.outfile ?? join("build", "bin", `bun-engine${extension}`));
  await Bun.$`mkdir -p ${dirname(outfile)}`.quiet();

  const result = await Bun.build({
    entrypoints: [join(root, "packages", "bun-engine", "src", "cli.ts")],
    compile: {
      ...(options.target ? { target: options.target as never } : {}),
      outfile,
      assets: [join(root, "packages", "bun-engine", "web", "app"), join(root, "packages", "bun-engine", "config")],
      execArgv: ["--smol"],
      autoloadTsconfig: false,
      autoloadPackageJson: false,
      autoloadDotenv: false,
      autoloadBunfig: false,
      ...(options.bytecodeOrder ? { bytecodeOrder: options.bytecodeOrder } : {}),
    },
    bytecode: true,
    minify: true,
    sourcemap: "linked",
    plugins: [...consolePlugins, ...formatPlugins],
    define: { BUN_ENGINE_VERSION: JSON.stringify("0.1.0") },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return 1;
  }
  console.log(result.outputs[0]?.path ?? outfile);
  return 0;
}

export async function compilePackageManager(outfile = join("build", "bin", "bep.exe")): Promise<number> {
  const output = join(root, outfile);
  await Bun.$`mkdir -p ${dirname(output)}`.quiet();
  const result = await Bun.build({
    entrypoints: [join(root, "packages", "bun-engine", "src", "bep.ts")],
    compile: { outfile: output, autoloadDotenv: false, autoloadBunfig: false },
    bytecode: true,
    minify: true,
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return 1;
  }
  console.log(result.outputs[0]?.path ?? output);
  return 0;
}

export function createWorkspaceServer(options: WorkspaceServerOptions = {}): Bun.Server<undefined> {
  const port = options.port ?? Number.parseInt(Bun.env.BUN_ENGINE_WEB_PORT ?? "50080", 10);
  const hostname = options.hostname ?? Bun.env.BUN_ENGINE_WEB_HOST ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`invalid Bun Engine web port: ${port}`);
  }
  const manifest = Bun.file(join(root, "packages", "bun-engine", "config", "workspace.json"));
  return Bun.serve({
    hostname,
    port,
    development: Bun.env.BUN_ENGINE_WEB_DEV === "1",
    routes: {
      "/": frontend,
      ...frontendRoutes(),
      "/api/workspace": () =>
        new Response(manifest, {
          headers: { "content-type": "application/json" },
        }),
    },
  });
}

/** `bun-engine web`: the frontend server alone (`bun-engine frontend` also opens a window). */
export async function serveWorkspace(): Promise<never> {
  const server = createWorkspaceServer();
  console.log(`bun-engine web: ${server.url}`);
  await new Promise(() => {});
  throw new Error("unreachable");
}
