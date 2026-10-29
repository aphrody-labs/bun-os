import { compileArgs } from "./build/bun.ts";
import { aotPublishArgs } from "./providers/dotnet.ts";

export type ProfileId =
  "aot-bun" | "aot-dotnet10" | "aot-dotnet11" | "win32-msvc" | "win32-clang" | "win32-mingw" | "glibc-gnu";

export interface ProfileStep {
  title: string;
  command: string[];
  env?: Record<string, string>;
}

export interface Profile {
  id: ProfileId;
  axis: string;
  summary: string;
  requires: string[];
  /** Facts that were checked against a primary source, with where. */
  sources: string[];
  /** Things the profile cannot promise without a measurement. */
  unmeasured: string[];
  steps(options: ProfileOptions): ProfileStep[];
}

export interface ProfileOptions {
  entry?: string;
  outfile?: string;
  project?: string;
  rid?: string;
  source?: string;
  target?: string;
  minGlibc?: string;
}

const bun = () => process.execPath;

function dotnet(profile: "aot-dotnet10" | "aot-dotnet11"): Profile["steps"] {
  return o => [
    {
      title: "publish NativeAOT (providers/dotnet.ts aotPublishArgs; pin the SDK with writeGlobalJson if wanted)",
      command: [
        "dotnet",
        ...aotPublishArgs({
          profile,
          project: o.project,
          rid: o.rid,
          size: true,
          stripSymbols: true,
          invariantGlobalization: true,
        }),
      ],
    },
  ];
}

export const profiles: Record<ProfileId, Profile> = {
  "aot-bun": {
    id: "aot-bun",
    axis: "Bun AOT",
    summary: "bun build --compile --aot --minify: JavaScript and TypeScript compiled to machine code at build time",
    requires: [],
    sources: [
      "bun build --help (canary 1.4.4): --aot, --aot-allow-code-from-disk, --trim",
      "docs/compiler/aot.mdx: bun compile = bun build --compile --aot",
    ],
    unmeasured: ["size, build time and start-up: run `buncc bench aot-bun <entry>`"],
    steps: o => [
      {
        title: "compile",
        command: [
          bun(),
          ...compileArgs({
            entry: o.entry ?? "./index.ts",
            outfile: o.outfile ?? "./app",
            aot: true,
            minify: true,
            target: o.target,
          }),
        ],
      },
    ],
  },
  "aot-dotnet10": {
    id: "aot-dotnet10",
    axis: ".NET 10 (LTS) NativeAOT",
    summary: "dotnet publish -p:PublishAot=true for a RID, size-optimised, symbols stripped",
    requires: ["dotnet"],
    sources: [
      "Microsoft Learn: Native AOT deployment (PublishAot, IlcOptimizationPreference, StripSymbols)",
      "dotnet/runtime releases: v10.0.13 (2026-10-13)",
    ],
    unmeasured: ["size, build time and start-up"],
    steps: dotnet("aot-dotnet10"),
  },
  "aot-dotnet11": {
    id: "aot-dotnet11",
    axis: ".NET 11 (preview) NativeAOT",
    summary: "same as .NET 10 with net11.0; the SDK must be a .NET 11 preview or RC",
    requires: ["dotnet"],
    sources: ["dotnet/runtime tags: latest is v11.0.0-rc.3.26522.148 (checked with gh api)"],
    unmeasured: [
      "whether the installed SDK is 11.x: `buncc doctor` shows `dotnet --version`",
      "size, build time and start-up",
    ],
    steps: dotnet("aot-dotnet11"),
  },
  "win32-msvc": {
    id: "win32-msvc",
    axis: "C/C++ Win32, MSVC",
    summary: "/O2 /GL /LTCG, static CRT (/MT), /guard:cf, /Z7 or PDB, /Brepro deterministic output, WIN32_WINNT 0x0A00",
    requires: ["msvc"],
    sources: [
      "Microsoft Learn: cl.exe compiler options (/O2, /GL, /MT, /guard:cf, /Brepro)",
      "Microsoft Learn: LINK options (/LTCG, /OPT:REF, /DEBUG:FULL)",
    ],
    unmeasured: ["size and speed delta of /GL /LTCG on this code"],
    steps: o => [
      {
        title: "compile",
        command: [
          "buncc",
          "cc",
          "/nologo",
          "/c",
          "/O2",
          "/GL",
          "/MT",
          "/guard:cf",
          "/Z7",
          "/Brepro",
          "/D_WIN32_WINNT=0x0A00",
          "/DWINVER=0x0A00",
          "/DUNICODE",
          "/D_UNICODE",
          o.source ?? "main.c",
          `/Fo${o.outfile ?? "main"}.obj`,
        ],
      },
      {
        title: "link",
        command: [
          "buncc",
          "link",
          "/nologo",
          "/LTCG",
          "/OPT:REF",
          "/OPT:ICF",
          "/DEBUG:FULL",
          "/Brepro",
          "/GUARD:CF",
          `/OUT:${o.outfile ?? "main"}.exe`,
          `${o.outfile ?? "main"}.obj`,
        ],
      },
    ],
  },
  "win32-clang": {
    id: "win32-clang",
    axis: "C/C++ Win32, clang-cl",
    summary: "clang-cl /O2 -flto=thin, lld-link, same CRT and SDK as MSVC",
    requires: ["msvc", "clang-cl", "lld"],
    sources: ["LLVM clang-cl documentation (MSVC-compatible driver)", "gh api llvm/llvm-project: llvmorg-23.1.4"],
    unmeasured: ["size and speed delta against win32-msvc"],
    steps: o => [
      {
        title: "compile and link",
        command: [
          "clang-cl",
          "/nologo",
          "/O2",
          "-flto=thin",
          "/MT",
          "/guard:cf",
          "/Z7",
          "/D_WIN32_WINNT=0x0A00",
          ...(o.target ? [`--target=${o.target}`] : []),
          o.source ?? "main.c",
          `/Fe${o.outfile ?? "main"}.exe`,
          "/link",
          "/fuse-ld=lld",
          "/OPT:REF",
          "/OPT:ICF",
          "/DEBUG:FULL",
        ],
      },
    ],
  },
  "win32-mingw": {
    id: "win32-mingw",
    axis: "C/C++ Win32, mingw-w64 (GNU ABI)",
    summary:
      "llvm-mingw clang for x86_64-w64-mingw32 or aarch64-w64-mingw32: -O2, static libgcc/libc++, ASLR/DEP/CFG-compatible PE flags, no MSYS2 runtime",
    requires: ["mingw"],
    sources: [
      "gh api mstorsjo/llvm-mingw: 20261020 (x86_64, aarch64, i686, armv7 hosts and targets, UCRT)",
      "Rust platform support: *-pc-windows-gnullvm uses llvm-mingw, *-pc-windows-gnu uses a GCC mingw",
    ],
    unmeasured: [
      "size and speed delta against win32-msvc and win32-clang",
      "aarch64 output was not executed here (no ARM64 Windows host)",
    ],
    steps: o => {
      const triple = o.target?.includes("aarch64") ? "aarch64-w64-mingw32" : "x86_64-w64-mingw32";
      return [
        {
          title: "compile and link (statically linked runtime, no DLL beyond Windows system ones)",
          command: [
            `${triple}-clang`,
            "-O2",
            "-static",
            "-Wl,--dynamicbase,--nxcompat,--high-entropy-va",
            "-D_WIN32_WINNT=0x0A00",
            o.source ?? "main.c",
            "-o",
            `${o.outfile ?? "main"}.exe`,
          ],
        },
      ];
    },
  },
  "glibc-gnu": {
    id: "glibc-gnu",
    axis: "C glibc (Linux gnu)",
    summary:
      "static-pie where possible, hash-style=gnu, relro/now; glibc floor enforced by checking the highest GLIBC_2.x symbol version",
    requires: ["clang", "readelf"],
    sources: [
      "GNU ld documentation: --hash-style, -z relro, -z now",
      "zig cc supports glibc version suffix in -target (x86_64-linux-gnu.2.28)",
    ],
    unmeasured: ["whether the sysroot or zig cc reaches the chosen floor: run the verify step"],
    steps: o => [
      {
        title: "compile and link",
        command: o.target?.includes("gnu.")
          ? [
              "zig",
              "cc",
              "-target",
              o.target,
              "-O2",
              o.source ?? "main.c",
              "-o",
              o.outfile ?? "main",
              "-Wl,--hash-style=gnu",
              "-Wl,-z,relro,-z,now",
            ]
          : [
              "clang",
              ...(o.target ? ["--target=" + o.target] : []),
              "-O2",
              "-fPIE",
              "-pie",
              "-Wl,--hash-style=gnu",
              "-Wl,-z,relro,-z,now",
              o.source ?? "main.c",
              "-o",
              o.outfile ?? "main",
            ],
      },
      { title: "list GLIBC_2.x versions needed", command: ["readelf", "--version-info", o.outfile ?? "main"] },
    ],
  },
};

export function getProfile(id: string): Profile {
  const profile = profiles[id as ProfileId];
  if (!profile) throw new Error(`Unknown profile: ${id}. Known: ${Object.keys(profiles).join(", ")}`);
  return profile;
}

/** Highest GLIBC_2.x version named in `readelf --version-info` / `objdump -T` text. */
export function maxGlibc(text: string): string | null {
  let best: number[] | null = null;
  for (const match of text.matchAll(/GLIBC_(\d+(?:\.\d+)+)/g)) {
    const parts = match[1]!.split(".").map(Number);
    if (!best || compareParts(parts, best) > 0) best = parts;
  }
  return best ? best.join(".") : null;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

export function glibcAtMost(text: string, floor: string): boolean {
  const max = maxGlibc(text);
  if (!max) return true;
  return compareParts(max.split(".").map(Number), floor.split(".").map(Number)) <= 0;
}
