/** CMake: detect, install (winget/pacman/apt or the checksum-verified Kitware release) and configure/build argument builders. */
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { which } from "./_shared.ts";
import { toolProvider } from "./_tool.ts";
import type { GithubToolSpec } from "./_github.ts";

const CMAKE_OS = { win32: "windows", linux: "linux", darwin: "macos" } as const;

export const cmakeRelease: GithubToolSpec = {
  id: "cmake",
  repo: "Kitware/CMake",
  binary: "cmake",
  asset(tag, platform, arch) {
    const v = tag.replace(/^v/, "");
    if (platform === "darwin") return `cmake-${v}-macos-universal.tar.gz`;
    const cpu = arch === "arm64" ? (platform === "win32" ? "arm64" : "aarch64") : arch === "x64" ? "x86_64" : undefined;
    if (!cpu) return undefined;
    return `cmake-${v}-${CMAKE_OS[platform]}-${cpu}.${platform === "win32" ? "zip" : "tar.gz"}`;
  },
};

export const cmakeProvider = toolProvider({
  id: "cmake",
  description: "CMake build-system generator",
  binary: "cmake",
  versionArgs: ["--version"],
  packages: { winget: "Kitware.CMake", pacman: "cmake", apt: "cmake", dnf: "cmake", apk: "cmake", brew: "cmake" },
  github: cmakeRelease,
});

export type CmakeGenerator =
  "Ninja" | "Ninja Multi-Config" | "NMake Makefiles" | "Unix Makefiles" | "MinGW Makefiles" | (string & {});

/** Ninja when it is available, else NMake (MSVC environment) or MinGW Makefiles on Windows, else Unix Makefiles. */
export function chooseGenerator(platform: string, has: (cmd: string) => boolean = c => !!which(c)): CmakeGenerator {
  if (has("ninja")) return "Ninja";
  return platform === "win32" ? (has("nmake") ? "NMake Makefiles" : "MinGW Makefiles") : "Unix Makefiles";
}

export interface ConfigureOptions {
  source: string;
  build: string;
  generator?: CmakeGenerator;
  buildType?: string;
  toolchainFile?: string;
  compileCommands?: boolean;
  defines?: Record<string, string | boolean | number>;
  cc?: string;
  cxx?: string;
}

/** `cmake -S <src> -B <build> -G <gen> -D...`; `CMAKE_EXPORT_COMPILE_COMMANDS=ON` by default for clangd. */
export function configureArgs(
  o: ConfigureOptions,
  platform: string = process.platform,
  has?: (cmd: string) => boolean,
): string[] {
  const args = ["-S", o.source, "-B", o.build, "-G", o.generator ?? chooseGenerator(platform, has)];
  const defs: Record<string, string | boolean | number> = { ...o.defines };
  if (o.buildType) defs.CMAKE_BUILD_TYPE = o.buildType;
  if (o.toolchainFile) defs.CMAKE_TOOLCHAIN_FILE = o.toolchainFile;
  if (o.compileCommands ?? true) defs.CMAKE_EXPORT_COMPILE_COMMANDS = true;
  if (o.cc) defs.CMAKE_C_COMPILER = o.cc;
  if (o.cxx) defs.CMAKE_CXX_COMPILER = o.cxx;
  for (const [k, v] of Object.entries(defs)) args.push(`-D${k}=${typeof v === "boolean" ? (v ? "ON" : "OFF") : v}`);
  return args;
}

export function buildArgs(o: { build: string; target?: string; config?: string; jobs?: number }): string[] {
  const args = ["--build", o.build];
  if (o.config) args.push("--config", o.config);
  if (o.target) args.push("--target", o.target);
  if (o.jobs) args.push("--parallel", String(o.jobs));
  return args;
}

export function installArgs(o: { build: string; prefix?: string; config?: string }): string[] {
  const args = ["--install", o.build];
  if (o.config) args.push("--config", o.config);
  if (o.prefix) args.push("--prefix", o.prefix);
  return args;
}

/** `CMAKE_PREFIX_PATH` made of the prefixes that exist. */
export function prefixEnv(prefixes: string[], exists: (p: string) => boolean = existsSync): Record<string, string> {
  const present = prefixes.filter(exists);
  return present.length ? { CMAKE_PREFIX_PATH: present.join(delimiter) } : {};
}
