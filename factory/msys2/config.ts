export type Msys2DesktopABI =
  "msys-x64" | "ucrt64-x64" | "clang64-x64" | "clangarm64-arm64" | "msvc-x64" | "msvc-arm64";

export const msys2DesktopConfig = {
  schemaVersion: 1,
  sourceRoot: "vendor",
  sourceRegistry: "vendor/sources.json",
  owner: "Existing cym Bun CLI + root factory/process/Cargo/artifact owners",
  runtime: "oven-sh/bun",
  defaultABI: "msvc-x64" as Msys2DesktopABI,
  cymSource: "msys2-packages/cachyos-msys2/cym.ts",
  protectedHomeImport: false,
  automaticInstall: false,
  linuxPackageInstallationOnWindows: false,
} as const;

/** Distinct link/runtime contracts; common UCRT alone does not establish C++ or Rust ABI compatibility. */
export const desktopABIs = {
  "msys-x64": {
    architecture: "x64",
    environment: "MSYS",
    prefix: "/usr",
    cRuntime: "MSYS2/Cygwin",
    cppRuntime: "libstdc++",
    rustTarget: null,
    productTarget: null,
    packagePrefix: "",
    role: "POSIX build/administration tools, not the Bun native Desktop application ABI",
  },
  "ucrt64-x64": {
    architecture: "x64",
    environment: "UCRT64",
    prefix: "/ucrt64",
    cRuntime: "UCRT",
    cppRuntime: "libstdc++",
    rustTarget: null,
    productTarget: "windows-x64",
    packagePrefix: "mingw-w64-ucrt-x86_64-",
    role: "MinGW native Windows C ABI; Rust standard library/toolchain requires its own qualification",
  },
  "clang64-x64": {
    architecture: "x64",
    environment: "CLANG64",
    prefix: "/clang64",
    cRuntime: "UCRT",
    cppRuntime: "libc++",
    rustTarget: null,
    productTarget: "windows-x64",
    packagePrefix: "mingw-w64-clang-x86_64-",
    role: "LLVM/MinGW Windows ABI; do not link its C++ libraries into an MSVC target by assumption",
  },
  "clangarm64-arm64": {
    architecture: "arm64",
    environment: "CLANGARM64",
    prefix: "/clangarm64",
    cRuntime: "UCRT",
    cppRuntime: "libc++",
    rustTarget: null,
    productTarget: "windows-arm64",
    packagePrefix: "mingw-w64-clang-aarch64-",
    role: "Separate native Windows ARM64 toolchain and artifact target",
  },
  "msvc-x64": {
    architecture: "x64",
    environment: "MSVC",
    prefix: null,
    cRuntime: "UCRT",
    cppRuntime: "MSVC",
    rustTarget: "x86_64-pc-windows-msvc",
    productTarget: "windows-x64",
    packagePrefix: null,
    role: "Existing Bun native Windows runtime and serialized Rust Desktop owner",
  },
  "msvc-arm64": {
    architecture: "arm64",
    environment: "MSVC",
    prefix: null,
    cRuntime: "UCRT",
    cppRuntime: "MSVC",
    rustTarget: "aarch64-pc-windows-msvc",
    productTarget: "windows-arm64",
    packagePrefix: null,
    role: "Explicit cross/native Windows ARM64 runtime and serialized Rust target",
  },
} as const satisfies Record<Msys2DesktopABI, object>;

export const desktopSourceCapabilities = [
  {
    id: "msys2-packages",
    role: "Native MSYS package recipes and existing cym implementation",
  },
  {
    id: "mingw-packages",
    role: "Native Windows MinGW/UCRT/LLVM package recipes",
  },
  { id: "msys2-runtime", role: "MSYS/Cygwin POSIX runtime source" },
  {
    id: "wgpu",
    role: "Existing graphics library; Windows backend/artifact qualification separate",
  },
  { id: "winit", role: "Existing Windows window/input/event integration" },
  { id: "bevy", role: "Existing engine source; no second engine workspace" },
] as const;
