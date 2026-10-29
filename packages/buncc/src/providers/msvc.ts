import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffEnv, parseEnvDump, type Env } from "../env.ts";
import { cacheDir } from "../lock.ts";
import { run } from "../process.ts";
import { findVisualStudio, VC_TOOLS_COMPONENT, type VsInstance } from "./msvc-layout.ts";
import type { Context, Detection, InstallPlan, Provider } from "./types.ts";

export { findVisualStudio };

export type Arch = "x64" | "x86" | "arm64";

/** `vcvarsall.bat` architecture argument: `x64` on an x64 host, `x64_arm64` to cross. */
export function vcvarsArch(target: Arch, host: Arch = "x64"): string {
  if (target === host) return target;
  return `${host}_${target}`;
}

export interface VcvarsRequest {
  arch: string;
  /** vcvars_ver, for example 14.44. */
  toolset?: string;
  /** Windows SDK version, for example 10.0.26100.0. */
  sdk?: string;
  uwp?: boolean;
}

/** Arguments after vcvarsall.bat. Order follows the documented `vcvarsall [platform_type] [winsdk_version] [-vcvars_ver=...]`. */
export function vcvarsArguments(request: VcvarsRequest): string[] {
  const args = [request.arch];
  if (request.uwp) args.push("uwp");
  if (request.sdk) args.push(request.sdk);
  if (request.toolset) args.push(`-vcvars_ver=${request.toolset}`);
  return args;
}

export function vcvarsCacheKey(vcvarsall: string, mtimeMs: number, request: VcvarsRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([vcvarsall.toLowerCase(), Math.floor(mtimeMs), vcvarsArguments(request)]))
    .digest("hex")
    .slice(0, 20);
}

/** The batch file that enters the developer environment and prints it. */
export function vcvarsBatch(vcvarsall: string, request: VcvarsRequest): string {
  return [
    "@echo off",
    `call "${vcvarsall}" ${vcvarsArguments(request).join(" ")} >nul 2>&1`,
    "if errorlevel 1 exit /b 1",
    "set",
    "",
  ].join("\r\n");
}

/**
 * Environment variables that vcvarsall adds or changes, cached on disk by (vcvarsall path, mtime, arguments) so
 * the 1-2 second batch run happens once per toolchain update, not once per cargo call.
 */
export async function captureVcvars(
  instance: VsInstance,
  request: VcvarsRequest,
  base: Env = Bun.env,
): Promise<{ env: Record<string, string>; cached: boolean }> {
  const vcvarsall = join(instance.path, "VC", "Auxiliary", "Build", "vcvarsall.bat");
  if (!existsSync(vcvarsall)) throw new Error(`vcvarsall.bat missing: ${vcvarsall}`);
  const key = vcvarsCacheKey(vcvarsall, statSync(vcvarsall).mtimeMs, request);
  const dir = join(cacheDir(), "vcvars");
  const file = join(dir, `${key}.json`);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      if (cached.INCLUDE || cached.Include) return { env: cached, cached: true };
    } catch {}
  }
  mkdirSync(dir, { recursive: true });
  const batch = join(dir, `${key}.cmd`);
  writeFileSync(batch, vcvarsBatch(vcvarsall, request));
  const result = await run([batch], { output: "capture", timeoutMs: 120_000, env: base });
  if (result.code !== 0) throw new Error(`vcvarsall ${vcvarsArguments(request).join(" ")} failed (${result.code}).`);
  const env = diffEnv(base, parseEnvDump(result.stdout));
  writeFileSync(file, JSON.stringify(env));
  return { env, cached: false };
}

async function version(instance: VsInstance): Promise<string | undefined> {
  const file = join(instance.path, "VC", "Auxiliary", "Build", "Microsoft.VCToolsVersion.default.txt");
  try {
    return (await Bun.file(file).text()).trim();
  } catch {
    return undefined;
  }
}

export const msvc: Provider = {
  id: "msvc",
  description: "MSVC C++ toolset and Windows SDK, found with vswhere and entered with vcvarsall",
  platforms: ["win32"],
  async detect(ctx: Context): Promise<Detection> {
    if (ctx.platform !== "win32")
      return { found: false, notes: ["MSVC exists only on Windows; use cargo-xwin to cross-compile."] };
    const instance = await findVisualStudio(ctx.env);
    if (!instance)
      return {
        found: false,
        fixHint: `winget install --id Microsoft.VisualStudio.BuildTools --exact --silent --override "--add ${VC_TOOLS_COMPONENT} --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --quiet --wait"`,
      };
    return {
      found: true,
      path: instance.path,
      version: await version(instance),
      notes: [instance.displayName],
    };
  },
  install(): InstallPlan {
    return {
      commands: [
        [
          "winget",
          "install",
          "--id",
          "Microsoft.VisualStudio.BuildTools",
          "--exact",
          "--silent",
          "--accept-package-agreements",
          "--accept-source-agreements",
          "--disable-interactivity",
          "--override",
          `--add ${VC_TOOLS_COMPONENT} --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --quiet --wait --norestart`,
        ],
      ],
    };
  },
  async env(ctx: Context) {
    const instance = await findVisualStudio(ctx.env);
    if (!instance) return {};
    return (await captureVcvars(instance, { arch: "x64" }, ctx.env)).env;
  },
};
