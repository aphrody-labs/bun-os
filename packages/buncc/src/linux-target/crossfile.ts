/**
 * Cross-compilation files for Linux targets: Meson cross file and CMake toolchain file driven by clang + lld
 * (or `zig cc`) against an Arch-package sysroot. Pure string generation.
 */
export type LinuxArch = "x86_64" | "aarch64";
export type Compiler = "clang" | "zig";

export interface Triple {
  arch: LinuxArch;
  /** clang/LLVM triple. */
  llvm: string;
  /** Meson `cpu_family`. */
  family: string;
  /** zig target triple. */
  zig: string;
}

export function parseTriple(input: string): Triple {
  const s = input.toLowerCase();
  if (/^(x86_64|amd64|x64)(-|$)/.test(s) || s === "linux-x64" || s === "bun-linux-x64")
    return { arch: "x86_64", llvm: "x86_64-unknown-linux-gnu", family: "x86_64", zig: "x86_64-linux-gnu" };
  if (/^(aarch64|arm64)(-|$)/.test(s) || s === "linux-arm64" || s === "bun-linux-aarch64")
    return { arch: "aarch64", llvm: "aarch64-unknown-linux-gnu", family: "aarch64", zig: "aarch64-linux-gnu" };
  throw new Error(`unsupported Linux target "${input}" (x86_64 or aarch64)`);
}

export interface CrossOptions {
  triple: Triple;
  /** Absolute sysroot directory. */
  sysroot: string;
  compiler?: Compiler;
  /** Directory holding clang/lld/llvm-ar (omit to use PATH). */
  llvmBin?: string;
  /** GCC runtime dir inside the sysroot (crtbeginS.o, libgcc.a), for example <sysroot>/usr/lib/gcc/x86_64-pc-linux-gnu/16.2.1. */
  gccInstallDir?: string;
  /** Host program that runs target binaries (qemu-aarch64 -L sysroot); omitted when none can run. */
  exeWrapper?: string[];
  /** pkg-config search dirs relative to the sysroot. */
  pkgConfigDirs?: string[];
  prefix?: string;
}

const fwd = (p: string) => p.replace(/\\/g, "/");
const list = (xs: string[]) => `[${xs.map(x => `'${x.replace(/'/g, "\\'")}'`).join(", ")}]`;

export const DEFAULT_PKGCONFIG_DIRS = ["usr/lib/pkgconfig", "usr/share/pkgconfig"];

/** Compiler arguments common to the C and C++ drivers. */
export function targetFlags(o: CrossOptions): string[] {
  const sysroot = fwd(o.sysroot);
  if (o.compiler === "zig") return ["-target", o.triple.zig, `--sysroot=${sysroot}`];
  const flags = [`--target=${o.triple.llvm}`, `--sysroot=${sysroot}`];
  if (o.gccInstallDir) flags.push(`--gcc-install-dir=${fwd(o.gccInstallDir)}`);
  return flags;
}

/** Linker-only arguments (without the target flags). */
export function linkOnlyFlags(o: CrossOptions): string[] {
  if (o.compiler === "zig") return [];
  return [
    "-fuse-ld=lld",
    "-Wl,--as-needed",
    `-Wl,-rpath-link=${fwd(o.sysroot)}/usr/lib`,
    "-Wl,--allow-shlib-undefined",
  ];
}

function tool(o: CrossOptions, name: string): string[] {
  const dir = o.llvmBin ? fwd(o.llvmBin).replace(/\/$/, "") + "/" : "";
  if (o.compiler === "zig") {
    const map: Record<string, string[]> = {
      cc: ["zig", "cc"],
      cxx: ["zig", "c++"],
      ar: ["zig", "ar"],
      ranlib: ["zig", "ranlib"],
    };
    return map[name] ?? [name];
  }
  const map: Record<string, string> = {
    cc: "clang",
    cxx: "clang++",
    ar: "llvm-ar",
    ranlib: "llvm-ranlib",
    strip: "llvm-strip",
    objcopy: "llvm-objcopy",
    nm: "llvm-nm",
  };
  return [dir + (map[name] ?? name)];
}

const pcPath = (o: CrossOptions, sep: string) =>
  (o.pkgConfigDirs ?? DEFAULT_PKGCONFIG_DIRS).map(d => `${fwd(o.sysroot)}/${d}`).join(sep);

/** Meson cross file (https://mesonbuild.com/Cross-compilation.html). */
export function mesonCrossFile(o: CrossOptions): string {
  const sysroot = fwd(o.sysroot);
  const args = targetFlags(o);
  const link = [...args, ...linkOnlyFlags(o)];
  const pcDirs = pcPath(o, ",").split(",");
  const lines = [
    "[binaries]",
    `c = ${list(tool(o, "cc"))}`,
    `cpp = ${list(tool(o, "cxx"))}`,
    `ar = ${list(tool(o, "ar"))}`,
    `ranlib = ${list(tool(o, "ranlib"))}`,
  ];
  if (o.compiler !== "zig")
    lines.push(
      `strip = ${list(tool(o, "strip"))}`,
      `objcopy = ${list(tool(o, "objcopy"))}`,
      `nm = ${list(tool(o, "nm"))}`,
      "c_ld = 'lld'",
      "cpp_ld = 'lld'",
    );
  lines.push("pkg-config = 'pkgconf'");
  if (o.exeWrapper?.length) lines.push(`exe_wrapper = ${list(o.exeWrapper)}`);
  lines.push(
    "",
    "[built-in options]",
    `c_args = ${list(args)}`,
    `cpp_args = ${list(args)}`,
    `c_link_args = ${list(link)}`,
    `cpp_link_args = ${list(link)}`,
    `prefix = '${o.prefix ?? "/usr"}'`,
    `pkg_config_path = ${list(pcDirs)}`,
    "",
    "[properties]",
    `sys_root = '${sysroot}'`,
    `needs_exe_wrapper = ${o.exeWrapper?.length ? "false" : "true"}`,
    `pkg_config_libdir = ${list(pcDirs)}`,
    "",
    "[host_machine]",
    "system = 'linux'",
    `cpu_family = '${o.triple.family}'`,
    `cpu = '${o.triple.arch}'`,
    "endian = 'little'",
    "",
  );
  return lines.join("\n");
}

/** Meson native file: build-machine compilers for `native: true` targets (generators), so Meson never probes cl/icl. */
export function mesonNativeFile(o: Pick<CrossOptions, "llvmBin">): string {
  const dir = o.llvmBin ? fwd(o.llvmBin).replace(/\/$/, "") + "/" : "";
  return ["[binaries]", `c = ['${dir}clang']`, `cpp = ['${dir}clang++']`, `ar = ['${dir}llvm-ar']`, ""].join("\n");
}

/** CMake toolchain file (https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html#cross-compiling). */
export function cmakeToolchain(o: CrossOptions): string {
  const sysroot = fwd(o.sysroot);
  const cc = tool(o, "cc");
  const cxx = tool(o, "cxx");
  const flags = targetFlags(o).join(" ");
  const link = [...targetFlags(o), ...linkOnlyFlags(o)].join(" ");
  const l = [
    "set(CMAKE_SYSTEM_NAME Linux)",
    `set(CMAKE_SYSTEM_PROCESSOR ${o.triple.arch})`,
    `set(CMAKE_SYSROOT "${sysroot}")`,
    `set(CMAKE_FIND_ROOT_PATH "${sysroot}")`,
    "set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)",
    "set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)",
    "set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)",
    "set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)",
    "set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)",
  ];
  if (o.compiler === "zig") {
    l.push(`set(CMAKE_C_COMPILER "${cc[0]}")`, `set(CMAKE_C_COMPILER_ARG1 "${cc.slice(1).join(" ")}")`);
    l.push(`set(CMAKE_CXX_COMPILER "${cxx[0]}")`, `set(CMAKE_CXX_COMPILER_ARG1 "${cxx.slice(1).join(" ")}")`);
  } else {
    l.push(`set(CMAKE_C_COMPILER "${cc[0]}")`, `set(CMAKE_CXX_COMPILER "${cxx[0]}")`);
    l.push(
      `set(CMAKE_AR "${tool(o, "ar")[0]}" CACHE FILEPATH "")`,
      `set(CMAKE_RANLIB "${tool(o, "ranlib")[0]}" CACHE FILEPATH "")`,
    );
    l.push(`set(CMAKE_C_COMPILER_TARGET ${o.triple.llvm})`, `set(CMAKE_CXX_COMPILER_TARGET ${o.triple.llvm})`);
  }
  l.push(
    `set(CMAKE_C_FLAGS_INIT "${flags}")`,
    `set(CMAKE_CXX_FLAGS_INIT "${flags}")`,
    `set(CMAKE_EXE_LINKER_FLAGS_INIT "${link}")`,
    `set(CMAKE_SHARED_LINKER_FLAGS_INIT "${link}")`,
    `set(CMAKE_MODULE_LINKER_FLAGS_INIT "${link}")`,
    `set(ENV{PKG_CONFIG_LIBDIR} "${pcPath(o, ":")}")`,
    `set(ENV{PKG_CONFIG_SYSROOT_DIR} "${sysroot}")`,
  );
  if (o.exeWrapper?.length) l.push(`set(CMAKE_CROSSCOMPILING_EMULATOR "${o.exeWrapper.join(";")}")`);
  return l.join("\n") + "\n";
}

/** Environment for pkg-config in a cross build (path separator of the host). */
export function pkgConfigEnv(
  o: CrossOptions,
  hostSep = process.platform === "win32" ? ";" : ":",
): Record<string, string> {
  return { PKG_CONFIG_LIBDIR: pcPath(o, hostSep), PKG_CONFIG_SYSROOT_DIR: fwd(o.sysroot) };
}
