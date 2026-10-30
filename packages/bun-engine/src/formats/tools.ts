// Discovery of the existing owners the format plugin delegates to: the native Rust `bun-engine`
// inspector, MAME's `unidasm`/`chdman` installed by bep under usr/lib/mame, LLVM and Rizin
// disassemblers, and the Magika bridge of `re`. Works from the source tree and from the
// single-file executable (where import.meta.dir is virtual) by walking up from cwd/execPath.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const exe = process.platform === "win32" ? ".exe" : "";

function isRoot(directory: string): boolean {
  return existsSync(join(directory, "AGENTS.md")) && existsSync(join(directory, "crates"));
}

function walkUp(from: string): string | undefined {
  let directory = resolve(from);
  for (;;) {
    if (isRoot(directory)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

let cachedRoot: string | null | undefined;

/** Bun OS checkout root: BUN_OS_ROOT, the source tree, then ancestors of cwd and the executable. */
export function workspaceRoot(): string | undefined {
  if (cachedRoot !== undefined) return cachedRoot ?? undefined;
  const fromSource = resolve(import.meta.dir, "..", "..", "..", "..");
  const found =
    [Bun.env.BUN_OS_ROOT, Bun.env.BUN_ENGINE_HOME].find(path => path && isRoot(path)) ??
    (isRoot(fromSource) ? fromSource : undefined) ??
    walkUp(process.cwd()) ??
    walkUp(dirname(process.execPath));
  cachedRoot = found ?? null;
  return found;
}

function usrDirectory(): string | undefined {
  if (Bun.env.BEP_ROOT) return resolve(Bun.env.BEP_ROOT);
  const root = workspaceRoot();
  return root ? join(root, "usr") : undefined;
}

function firstFile(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((path): path is string => !!path && existsSync(path));
}

/** Native Rust `bun-engine` (crates/bun-engine-core) that owns `info <rom.nds>`. */
export function nativeEngine(): string | undefined {
  const root = workspaceRoot();
  const name = `bun-engine${exe}`;
  return firstFile([
    Bun.env.BUN_ENGINE_NATIVE,
    "/usr/lib/bun-engine/bun-engine",
    root && join(root, "target", "release", name),
    root && join(root, "target", "debug", name),
  ]);
}

/** A MAME tool (`unidasm`, `chdman`) from the bep-installed usr/lib/mame, or PATH. */
export function mameTool(name: "unidasm" | "chdman"): string | undefined {
  const usr = usrDirectory();
  return firstFile([usr && join(usr, "lib", "mame", `${name}${exe}`)]) ?? Bun.which(name) ?? undefined;
}

export function llvmObjdump(): string | undefined {
  return (
    Bun.which("llvm-objdump") ??
    firstFile([Bun.env.ProgramFiles ? join(Bun.env.ProgramFiles, "LLVM", "bin", "llvm-objdump.exe") : undefined])
  );
}

export function rizinAsm(): string | undefined {
  return Bun.which("rz-asm") ?? undefined;
}

export interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a tool with a hard timeout and captured output. */
export async function runTool(command: string[], timeoutMs = 30_000): Promise<ToolResult> {
  const child = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** `bun-engine info <rom.nds> --json` from the Rust owner; undefined when the binary is absent. */
export async function nativeNdsInfo(path: string): Promise<Record<string, unknown> | undefined> {
  if (Bun.env.BUN_ENGINE_FORMATS_NATIVE === "0") return undefined;
  const engine = nativeEngine();
  if (!engine) return undefined;
  const result = await runTool([engine, "info", path, "--json"], 15_000);
  try {
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Magika content type through the canonical REA bridge. */
export async function magikaIdentify(path: string): Promise<unknown> {
  const root = workspaceRoot();
  if (root) Bun.env.BUN_ENGINE_HOME ??= root;
  try {
    const { identifyWithMagika } = await import("../../../../vendor/rea/src/ml/magika.js");
    return await identifyWithMagika(path);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
