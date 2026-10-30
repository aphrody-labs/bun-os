import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../process.ts";
import { mingwBinDirs } from "./mingw.ts";
import {
  compareVersions,
  type Context,
  type Detection,
  type InstallPlan,
  type Platform,
  type Provider,
} from "./types.ts";

export interface ToolSpec {
  id: string;
  description: string;
  platforms?: Platform[];
  /** Executable names, first match on PATH or in `dirs` wins. */
  bins: string[];
  /** Extra directories searched after PATH (well-known install locations). */
  dirs?: string[];
  versionArgs?: string[];
  versionRegex?: RegExp;
  winget?: string;
  apt?: string;
  pacman?: string;
  brew?: string;
  cargoInstall?: string;
  /** Set when there is no unattended installer. */
  manual?: string;
}

export const WINGET_FLAGS = [
  "--exact",
  "--silent",
  "--accept-package-agreements",
  "--accept-source-agreements",
  "--disable-interactivity",
];

/** Package-manager command that installs a tool without prompting, or a manual note. */
export function installPlanFor(spec: ToolSpec, platform: Platform): InstallPlan {
  if (platform === "win32" && spec.winget)
    return { commands: [["winget", "install", "--id", spec.winget, ...WINGET_FLAGS]] };
  if (platform === "linux" && spec.pacman)
    return { commands: [["sudo", "pacman", "-S", "--needed", "--noconfirm", spec.pacman]] };
  if (platform === "linux" && spec.apt)
    return { commands: [["sudo", "apt-get", "install", "-y", "--no-install-recommends", spec.apt]] };
  if (platform === "darwin" && spec.brew) return { commands: [["brew", "install", spec.brew]] };
  if (spec.cargoInstall) return { commands: [["cargo", "install", "--locked", spec.cargoInstall]] };
  return { commands: [], manual: spec.manual ?? `Install ${spec.id} with your system package manager.` };
}

export function findBinary(spec: Pick<ToolSpec, "bins" | "dirs">, platform: Platform): string | null {
  for (const bin of spec.bins) {
    const found = Bun.which(bin);
    if (found) return found;
  }
  const suffixes = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of spec.dirs ?? [])
    for (const bin of spec.bins)
      for (const suffix of suffixes) {
        const path = join(dir, bin + suffix);
        if (existsSync(path)) return path;
      }
  return null;
}

export async function readPin(ctx: Context, id: string): Promise<string | undefined> {
  try {
    const file = Bun.file(join(ctx.root, "buncc.toolchain.json"));
    if (!(await file.exists())) return undefined;
    const data = (await file.json()) as { tools?: Record<string, { min?: string }> };
    return data.tools?.[id]?.min;
  } catch {
    return undefined;
  }
}

export function tool(spec: ToolSpec): Provider {
  const platforms = spec.platforms ?? ["win32", "linux", "darwin"];
  return {
    id: spec.id,
    description: spec.description,
    platforms,
    async detect(ctx): Promise<Detection> {
      const path = findBinary(spec, ctx.platform);
      if (!path) {
        const plan = installPlanFor(spec, ctx.platform);
        return { found: false, fixHint: plan.commands[0]?.join(" ") ?? plan.manual };
      }
      let version: string | undefined;
      if (spec.versionArgs) {
        const result = await run([path, ...spec.versionArgs], { output: "capture", timeoutMs: 20_000 });
        if (result.code === 0 || result.stdout) {
          version = (spec.versionRegex ?? /(\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?)/).exec(result.stdout + result.stderr)?.[1];
        } else
          return {
            found: false,
            path,
            notes: [`${path} failed to run (${result.code}): ${result.stderr.trim().slice(0, 200)}`],
          };
      }
      const pin = await readPin(ctx, spec.id);
      const notes: string[] = [];
      if (pin && version && compareVersions(version, pin) < 0) notes.push(`older than the pinned minimum ${pin}`);
      return { found: true, path, version, notes };
    },
    install: () => installPlanFor(spec, hostPlatform()),
    async env(ctx) {
      const path = findBinary(spec, ctx.platform);
      if (!path) return {};
      const dir = path.replace(/[\\/][^\\/]*$/, "");
      const separator = ctx.platform === "win32" ? ";" : ":";
      const pathKey = Object.keys(ctx.env).find(key => key.toLowerCase() === "path") ?? "PATH";
      const current = ctx.env[pathKey] ?? "";
      return current.split(separator).includes(dir) ? {} : { [pathKey]: `${dir}${separator}${current}` };
    },
    pin: ctx => readPin(ctx, spec.id),
  };
}

function hostPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

const programFiles = Bun.env.ProgramFiles ?? "C:\\Program Files";

export const toolSpecs: ToolSpec[] = [
  {
    id: "winget",
    description: "Windows Package Manager, used for unattended installs on Windows",
    platforms: ["win32"],
    bins: ["winget"],
    versionArgs: ["--version"],
    manual: "Install App Installer from the Microsoft Store.",
  },
  {
    id: "cmake",
    description: "CMake build generator",
    bins: ["cmake"],
    versionArgs: ["--version"],
    winget: "Kitware.CMake",
    apt: "cmake",
    pacman: "cmake",
    brew: "cmake",
  },
  {
    id: "ninja",
    description: "Ninja build runner",
    bins: ["ninja"],
    versionArgs: ["--version"],
    winget: "Ninja-build.Ninja",
    apt: "ninja-build",
    pacman: "ninja",
    brew: "ninja",
  },
  {
    id: "make",
    description: "GNU make",
    bins: ["make", "gmake", "mingw32-make"],
    versionArgs: ["--version"],
    winget: "ezwinports.make",
    apt: "make",
    pacman: "make",
    brew: "make",
  },
  {
    id: "clang",
    description: "LLVM clang and clang-cl",
    bins: ["clang"],
    dirs: [join(programFiles, "LLVM", "bin")],
    versionArgs: ["--version"],
    winget: "LLVM.LLVM",
    apt: "clang",
    pacman: "clang",
    brew: "llvm",
  },
  {
    id: "clang-cl",
    description: "clang with the MSVC command line",
    platforms: ["win32"],
    bins: ["clang-cl"],
    dirs: [join(programFiles, "LLVM", "bin")],
    versionArgs: ["--version"],
    winget: "LLVM.LLVM",
  },
  {
    id: "lld",
    description: "LLVM linker (lld, lld-link) and llvm-ar",
    bins: ["lld-link", "ld.lld", "lld"],
    dirs: [join(programFiles, "LLVM", "bin")],
    versionArgs: ["--version"],
    winget: "LLVM.LLVM",
    apt: "lld",
    pacman: "lld",
    brew: "lld",
  },
  {
    id: "clangd",
    description: "clangd, the C/C++ language server (the C LSP)",
    bins: ["clangd"],
    dirs: [join(programFiles, "LLVM", "bin")],
    versionArgs: ["--version"],
    winget: "LLVM.LLVM",
    apt: "clangd",
    pacman: "clang",
    brew: "llvm",
  },
  {
    id: "gcc",
    description: "GNU C compiler (Windows: the buncc mingw provider)",
    bins: ["gcc"],
    dirs: mingwBinDirs(),
    versionArgs: ["--version"],
    apt: "gcc",
    pacman: "gcc",
    brew: "gcc",
    manual: "Windows: buncc install mingw --run (llvm-mingw, checksum verified; no MSYS2 needed)",
  },
  {
    id: "g++",
    description: "GNU C++ compiler",
    bins: ["g++"],
    dirs: mingwBinDirs(),
    versionArgs: ["--version"],
    manual: "Windows: buncc install mingw --run",
    apt: "g++",
    pacman: "gcc",
    brew: "gcc",
  },
  {
    id: "protoc",
    description: "Protocol Buffers compiler (prost-build, tonic)",
    bins: ["protoc"],
    versionArgs: ["--version"],
    winget: "Google.Protobuf",
    apt: "protobuf-compiler",
    pacman: "protobuf",
    brew: "protobuf",
  },
  {
    id: "sccache",
    description: "Compiler cache for rustc and cc",
    bins: ["sccache"],
    versionArgs: ["--version"],
    winget: "Mozilla.sccache",
    pacman: "sccache",
    brew: "sccache",
    cargoInstall: "sccache",
  },
  {
    id: "rustup",
    description: "Rust toolchain installer",
    bins: ["rustup"],
    versionArgs: ["--version"],
    winget: "Rustlang.Rustup",
    brew: "rustup",
    manual: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
  },
  {
    id: "cargo-xwin",
    description: "Cross-compile to windows-msvc from Linux or macOS with the xwin SDK",
    platforms: ["linux", "darwin"],
    bins: ["cargo-xwin"],
    versionArgs: ["--version"],
    cargoInstall: "cargo-xwin",
  },
  {
    id: "cargo-zigbuild",
    description: "Cross-compile with zig as linker (glibc version targets)",
    bins: ["cargo-zigbuild"],
    versionArgs: ["--version"],
    cargoInstall: "cargo-zigbuild",
  },
  {
    id: "zig",
    description: "zig cc for glibc symbol-version targets",
    bins: ["zig"],
    versionArgs: ["version"],
    winget: "zig.zig",
    brew: "zig",
    pacman: "zig",
  },
  {
    id: "mold",
    description: "Fast linker for Linux",
    platforms: ["linux"],
    bins: ["mold"],
    versionArgs: ["--version"],
    pacman: "mold",
    apt: "mold",
  },
  {
    id: "gn",
    description: "Chromium GN meta-build (from depot_tools)",
    bins: ["gn"],
    versionArgs: ["--version"],
    manual: "git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git and add it to PATH",
  },
  {
    id: "depot_tools",
    description: "Chromium depot_tools (gn, ninja, gclient)",
    bins: ["gclient"],
    manual: "git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git and add it to PATH",
  },
  {
    id: "dotnet",
    description: ".NET SDK for NativeAOT publish",
    bins: ["dotnet"],
    versionArgs: ["--version"],
    winget: "Microsoft.DotNet.SDK.10",
    apt: "dotnet-sdk-10.0",
    pacman: "dotnet-sdk",
    brew: "dotnet-sdk",
  },
  {
    id: "makeappx",
    description: "Windows SDK MakeAppx (appx/msix packaging)",
    platforms: ["win32"],
    bins: ["makeappx"],
    winget: "Microsoft.WindowsSDK.10.0.26100",
    manual: "Install the Windows 10/11 SDK.",
  },
  {
    id: "signtool",
    description: "Windows SDK SignTool (code signing)",
    platforms: ["win32"],
    bins: ["signtool"],
    winget: "Microsoft.WindowsSDK.10.0.26100",
    manual: "Install the Windows 10/11 SDK.",
  },
  {
    id: "wix",
    description: "WiX Toolset v4+ (msi)",
    platforms: ["win32"],
    bins: ["wix"],
    manual: "dotnet tool install --global wix",
  },
  {
    id: "iscc",
    description: "Inno Setup compiler (exe installer)",
    platforms: ["win32"],
    bins: ["iscc"],
    dirs: [join(Bun.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Inno Setup 6")],
    winget: "JRSoftware.InnoSetup",
  },
  {
    id: "makensis",
    description: "NSIS compiler (exe installer)",
    platforms: ["win32"],
    bins: ["makensis"],
    dirs: [join(Bun.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "NSIS")],
    winget: "NSIS.NSIS",
  },
  {
    id: "readelf",
    description: "binutils readelf (glibc symbol-version check)",
    bins: ["readelf", "llvm-readelf"],
    dirs: [join(programFiles, "LLVM", "bin")],
    versionArgs: ["--version"],
    apt: "binutils",
    pacman: "binutils",
  },
];

export const toolProviders: Provider[] = toolSpecs.map(tool);
