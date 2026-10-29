/** LLVM/clang discovery: clang, clang-cl, lld-link, llvm-lib, llvm-ar and the libclang directory bindgen needs. */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  exeSuffix,
  installPlanFor,
  missing,
  parseVersion,
  pathVar,
  pinFromToolchain,
  prependPath,
  probeVersion,
  which,
} from "./_shared.ts";
import { compareVersions, type Context, type Detection, type Platform, type Provider } from "./types.ts";

export const LLVM_TOOLS = [
  "clang",
  "clang++",
  "clang-cl",
  "lld",
  "lld-link",
  "llvm-ar",
  "llvm-lib",
  "llvm-rc",
  "llvm-mt",
  "llvm-dlltool",
  "clangd",
  "clang-format",
] as const;

/** Directories that can hold the LLVM binaries, newest versioned directory first. */
export function llvmBinCandidates(
  platform: Platform,
  env: Record<string, string | undefined> = Bun.env,
  list: (dir: string) => string[] = dir => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
): string[] {
  const out: string[] = [];
  if (env.LLVM_PATH) out.push(join(env.LLVM_PATH, "bin"), env.LLVM_PATH);
  if (env.LIBCLANG_PATH) out.push(env.LIBCLANG_PATH, join(env.LIBCLANG_PATH, "..", "bin"));
  if (platform === "win32") {
    for (const pf of [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"]])
      if (pf) out.push(join(pf, "LLVM", "bin"));
  } else if (platform === "darwin") {
    out.push("/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin");
  } else {
    const numbered = (base: string, re: RegExp, sub: (n: string) => string) =>
      list(base)
        .map(n => ({ n, m: re.exec(n) }))
        .filter(x => x.m)
        .sort((a, b) => Number(b.m![1]) - Number(a.m![1]))
        .map(x => join(base, sub(x.n)));
    out.push(...numbered("/usr/lib", /^llvm-(\d+)$/, n => join(n, "bin")));
    out.push(...numbered("/usr/lib", /^llvm(\d+)$/, n => join(n, "bin")));
    out.push("/usr/lib/llvm/bin", "/usr/local/bin");
  }
  return out;
}

export function findTool(
  tool: string,
  ctx: Pick<Context, "env" | "platform">,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const onPath = which(tool, ctx as Context);
  if (onPath) return onPath;
  for (const dir of llvmBinCandidates(ctx.platform, ctx.env)) {
    const p = join(dir, tool + exeSuffix);
    if (exists(p)) return p;
  }
  return undefined;
}

export async function detectClang(ctx: Context): Promise<Detection> {
  const clang = findTool("clang", ctx);
  if (!clang) {
    const plan = installPlanFor(
      {
        winget: "LLVM.LLVM",
        pacman: ["clang", "lld", "llvm"],
        apt: ["clang", "lld", "llvm"],
        dnf: ["clang", "lld", "llvm"],
        apk: ["clang", "lld", "llvm"],
        brew: "llvm",
      },
      ctx.platform,
    );
    return missing(
      plan.map(c => c.join(" ")).join(" && ") || "install LLVM from https://github.com/llvm/llvm-project/releases",
    );
  }
  const version = await probeVersion(clang, ["--version"], ctx);
  const notes: string[] = [];
  for (const t of ["clang-cl", "lld-link", "llvm-lib"]) {
    const p = findTool(t, ctx);
    if (!p) notes.push(`${t} not found`);
  }
  const pin = await pinFromToolchain(ctx, "clang");
  if (pin && version && compareVersions(version, pin) < 0)
    notes.push(`clang ${version} is older than the pinned ${pin}`);
  return {
    found: true,
    path: clang,
    version: version ? parseVersion(version) : undefined,
    notes: notes.length ? notes : undefined,
  };
}

export const clangProvider: Provider = {
  id: "clang",
  description: "LLVM clang, clang-cl, lld-link and llvm-lib",
  platforms: ["win32", "linux", "darwin"],
  detect: detectClang,
  install(ctx) {
    const commands = installPlanFor(
      {
        winget: "LLVM.LLVM",
        pacman: ["clang", "lld", "llvm"],
        apt: ["clang", "lld", "llvm"],
        dnf: ["clang", "lld", "llvm"],
        apk: ["clang", "lld", "llvm"],
        brew: "llvm",
      },
      ctx.platform,
    );
    return commands.length
      ? { commands }
      : { commands: [], manual: "install LLVM from https://github.com/llvm/llvm-project/releases" };
  },
  async env(ctx) {
    const clang = findTool("clang", ctx);
    if (!clang) return {};
    const bin = dirname(clang);
    const out: Record<string, string> = { PATH: prependPath(pathVar(ctx), [bin]) };
    const libDir = [bin, join(bin, "..", "lib")].find(d =>
      existsSync(
        join(
          d,
          process.platform === "win32"
            ? "libclang.dll"
            : process.platform === "darwin"
              ? "libclang.dylib"
              : "libclang.so",
        ),
      ),
    );
    if (libDir) out.LIBCLANG_PATH = libDir;
    return out;
  },
  pin: ctx => pinFromToolchain(ctx, "clang"),
};

/** `CC`/`CXX` pair for a build: clang-cl flavour when targeting MSVC. */
export function compilerEnv(ctx: Context, flavour: "gnu" | "msvc"): Record<string, string> {
  const cc = findTool(flavour === "msvc" ? "clang-cl" : "clang", ctx);
  const cxx = findTool(flavour === "msvc" ? "clang-cl" : "clang++", ctx);
  const ar = findTool(flavour === "msvc" ? "llvm-lib" : "llvm-ar", ctx);
  const out: Record<string, string> = {};
  if (cc) out.CC = cc;
  if (cxx) out.CXX = cxx;
  if (ar) out.AR = ar;
  return out;
}
