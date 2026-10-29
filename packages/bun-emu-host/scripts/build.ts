#!/usr/bin/env bun
// Build one or more emulator plugins of packages/bun-emu-host:
//   bun packages/bun-emu-host/scripts/build.ts melonds [dolphin ...] [--configure-only] [--jobs N]
// Qt 6 comes from the workspace vcpkg manifest (packages/iecode-cpp, feature
// "emu-host") installed under build/vcpkg_installed; plugins land in
// build/emu-host/bin. Native builds are bounded to 4 jobs by default.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const pkg = resolve(import.meta.dir, "..");
const triplet = "x64-windows-release";
const installRoot = join(root, "build/vcpkg_installed");

// Per-core toolchain, source tree and options. melonDS is a library under this
// package's CMakeLists.txt and needs clang-cl (GCC builtins, __int128); the
// other cores keep their own top-level CMake and get the plugin injected
// (cmake/inject.cmake) through CMAKE_PROJECT_<project>_INCLUDE.
interface CoreBuild {
  cc: string;
  cxx: string;
  /** MSVC toolset; Dolphin's PCH requires Visual Studio 2026 (MSVC 19.51+). */
  toolset?: string;
  source?: string;
  project?: string;
  defines?: string[];
}
const cores: Record<string, CoreBuild> = {
  melonds: { cc: "clang-cl", cxx: "clang-cl" },
  dolphin: {
    cc: "cl",
    cxx: "cl",
    toolset: "14.52",
    source: "vendor/dolphin",
    project: "dolphin-emu",
    defines: [
      "ENABLE_QT=OFF",
      "ENABLE_NOGUI=OFF",
      "ENABLE_CLI_TOOL=OFF",
      "ENABLE_TESTS=OFF",
      "ENABLE_AUTOUPDATE=OFF",
      "ENABLE_ANALYTICS=OFF",
      "USE_DISCORD_PRESENCE=OFF",
      "USE_RETRO_ACHIEVEMENTS=OFF",
      "USE_MGBA=OFF",
      "USE_UPNP=OFF",
      "ENABLE_SDL=OFF",
      "ENABLE_LLVM=OFF",
      "ENCODE_FRAMEDUMPS=OFF",
      "ENABLE_CUBEB=OFF",
    ],
  },
  azahar: {
    cc: "cl",
    cxx: "cl",
    source: "vendor/azahar",
    project: "citra",
    defines: [
      "ENABLE_QT=OFF",
      "ENABLE_SDL2=OFF",
      "ENABLE_TESTS=OFF",
      "ENABLE_ROOM=OFF",
      "ENABLE_WEB_SERVICE=OFF",
      "ENABLE_SCRIPTING=OFF",
      "ENABLE_CUBEB=OFF",
      "ENABLE_OPENAL=OFF",
      "ENABLE_LIBUSB=OFF",
      "ENABLE_OPENGL=OFF",
      "ENABLE_VULKAN=OFF",
      "ENABLE_SOFTWARE_RENDERER=ON",
      "ENABLE_LTO=OFF",
      "CITRA_WARNINGS_AS_ERRORS=OFF",
    ],
  },
  kyty: {
    cc: "cl",
    cxx: "cl",
    source: "vendor/kytyps5",
    project: "Kyty",
    defines: ["BUN_EMU_HOST_QT_GUI=ON"],
  },
};

const args = process.argv.slice(2);
const configureOnly = args.includes("--configure-only");
const jobsIndex = args.indexOf("--jobs");
const jobs = jobsIndex >= 0 ? Number(args[jobsIndex + 1]) : 4;
const selected = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--jobs");
if (!selected.length || selected.some(c => !(c in cores))) {
  console.error(`usage: build.ts <${Object.keys(cores).join("|")}>... [--configure-only] [--jobs N]`);
  process.exit(2);
}

async function run(cmd: string[], env: Record<string, string> = {}) {
  console.error(`$ ${cmd.join(" ")}`);
  // Windows environment names are case-insensitive: overrides replace e.g. Path.
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    for (const existing of Object.keys(merged)) {
      if (existing.toUpperCase() === key.toUpperCase()) delete merged[existing];
    }
    merged[key] = value;
  }
  const proc = Bun.spawn(cmd, {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
    env: merged,
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd[0]} exited with ${code}`);
}

// The MSVC developer environment of a toolset (vcvarsall.bat of the newest Visual Studio, found with vswhere; upstream
// Bun has no `bun msvc`). When that toolset was installed without its C++ standard library and CRT (an unfinished
// Visual Studio install), the headers and import libraries of the default toolset are used with its compiler, so
// objects still link against msvcp140/vcruntime140.
async function msvcEnv(toolset: string): Promise<Record<string, string>> {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  const install = (
    await new Response(
      Bun.spawn([vswhere, "-latest", "-products", "*", "-property", "installationPath"], { stdout: "pipe" }).stdout,
    ).text()
  ).trim();
  if (!install) throw new Error("Visual Studio with the C++ toolset was not found (vswhere)");
  const read = async (t: string) => {
    const vcvars = join(install, "VC", "Auxiliary", "Build", "vcvarsall.bat");
    const out = await new Response(
      Bun.spawn(["cmd.exe", "/d", "/c", `"${vcvars}" x64 -vcvars_ver=${t} >nul && set`], {
        stdout: "pipe",
        windowsVerbatimArguments: true,
      }).stdout,
    ).text();
    const env: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
    }
    return env;
  };
  const env = await read(toolset);
  const first = (list: string) => list.split(";")[0]!;
  if (toolset !== "14.44" && !existsSync(join(first(env.INCLUDE!), "vector"))) {
    const base = await read("14.44");
    console.error(`toolset ${toolset} has no STL/CRT; compiling against ${first(base.INCLUDE!)}`);
    const stl = first(env.INCLUDE!);
    env.INCLUDE = env.INCLUDE!.replace(stl, first(base.INCLUDE!));
    env.EXTERNAL_INCLUDE = (env.EXTERNAL_INCLUDE ?? "").replace(stl, first(base.INCLUDE!));
    env.LIB = env.LIB!.replace(first(env.LIB!), first(base.LIB!));
  }
  return env;
}

await run(
  [
    "vcpkg",
    "install",
    `--x-manifest-root=${join(root, "packages/iecode-cpp")}`,
    "--x-feature=emu-host",
    `--triplet=${triplet}`,
    `--host-triplet=${triplet}`,
    `--x-install-root=${installRoot}`,
  ],
  { VCPKG_MAX_CONCURRENCY: String(jobs), ...(await msvcEnv("14.44")) },
);

for (const core of selected) {
  const { cc, cxx, source, project, toolset, defines = [] } = cores[core]!;
  const env = await msvcEnv(toolset ?? "14.44");
  const dir = join(root, "build/emu-host", core);
  if (!existsSync(join(dir, "CMakeCache.txt")) || configureOnly) {
    await run(
      [
        "cmake",
        "-S",
        source ? join(root, source) : pkg,
        "-B",
        dir,
        "-G",
        "Ninja",
        `-DBUN_EMU_CORE=${core}`,
        "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_TRY_COMPILE_CONFIGURATION=Release",
        `-DCMAKE_C_COMPILER=${cc}`,
        `-DCMAKE_CXX_COMPILER=${cxx}`,
        `-DCMAKE_PREFIX_PATH=${join(installRoot, triplet)}`,
        ...(project ? [`-DCMAKE_PROJECT_${project}_INCLUDE=${join(pkg, "cmake/inject.cmake")}`] : []),
        ...defines.map(d => `-D${d}`),
      ],
      env,
    );
  }
  if (!configureOnly) await run(["cmake", "--build", dir, "-j", String(jobs)], env);
}
