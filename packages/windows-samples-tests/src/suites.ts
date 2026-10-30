/** Registry of our own implementations: how each is built and run. Row cells in manifest/coverage.json refer to these ids. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { repoRoot, resolveDotnet, runDotnet } from "./dotnet.ts";
import { cargo, cl, exec } from "./native.ts";

export type Lang = "cpp" | "cs" | "rust" | "bun";
export interface RunResult {
  ok: boolean;
  output: string;
}
export interface Impl {
  id: string;
  lang: Lang;
  /** Directory (repo-relative) holding the sources. */
  dir: string;
  /** What the implementation exercises, shown in docs. */
  scope: string;
  /** Needs a window or user interaction: built but only run in CI/manual. */
  interactive?: boolean;
  build(): Promise<{ ok: boolean; log: string }>;
  run?(): Promise<RunResult>;
}

const win = join(repoRoot, "examples", "windows");
export const outDir = join(win, ".out");
mkdirSync(outDir, { recursive: true });
const norm = (p: string) => p.replace(/\\/g, "/");
const okBuild = (r: { code: number; out: string }) => ({ ok: r.code === 0, log: r.out.slice(-600) });

async function spawnRun(argv: string[], cwd = repoRoot): Promise<{ code: number; text: string }> {
  const r = await exec(argv, cwd);
  return { code: r.code, text: r.out.replace(/\r\n/g, "\n") };
}

// ---- xaml-static: parse WinUI Gallery pages ---------------------------------------------------------------------------
export const GALLERY_ROOT = join(repoRoot, "vendor/microsoft/WinUI-Gallery/WinUIGallery/Samples");
export const xamlListFile = join(outDir, "xaml-list.txt");
export function writeXamlList(pages: string[]) {
  writeFileSync(xamlListFile, pages.map(norm).join("\n") + "\n");
}
const xs = (sub: string) => join(win, "xaml-static", sub);
const xamlRun = (argv: string[]) => async (): Promise<RunResult> => {
  const r = await spawnRun([...argv, norm(xamlListFile)]);
  return { ok: r.code === 0 && r.text.length > 0, output: r.text };
};

// ---- d3d12-headless ----------------------------------------------------------------------------------------------------
const dh = (sub: string) => join(win, "d3d12-headless", sub);
const okLine = async (argv: string[]): Promise<RunResult> => {
  const r = await spawnRun(argv);
  return { ok: r.code === 0 && r.text.trim().startsWith("OK 0,51,102,255"), output: r.text.trim() };
};
const hello = async (exe: string[]): Promise<RunResult> => {
  const r = await spawnRun(exe);
  return { ok: r.code === 0 && r.text.trim() === "Hello, World!", output: r.text.trim() };
};

function callAdd(dll: string): RunResult {
  try {
    const lib = dlopen(dll, { add: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    const v = lib.symbols.add(2, 3);
    lib.close();
    return { ok: v === 5, output: String(v) };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

const csBuild = (dir: string, out: string) => async () => {
  const d = resolveDotnet(dir);
  if (!d) return { ok: false, log: "dotnet SDK from global.json not found" };
  const r = await runDotnet(d, ["build", "-c", "Release", "-o", out, "--nologo"], dir);
  return { ok: r.code === 0, log: (r.stdout + r.stderr).slice(-400) };
};

export const IMPLS: Impl[] = [
  {
    id: "xaml-static-cpp",
    lang: "cpp",
    dir: "examples/windows/xaml-static/cpp",
    scope: "static XAML scan (root element, element count)",
    build: async () =>
      okBuild(
        await cl(xs("cpp"), [
          "main.cpp",
          `/Fe:${norm(outDir)}/xaml-static-cpp.exe`,
          `/Fo:${norm(outDir)}/xaml-static-cpp.obj`,
        ]),
      ),
    run: xamlRun([join(outDir, "xaml-static-cpp.exe")]),
  },
  {
    id: "xaml-static-cs",
    lang: "cs",
    dir: "examples/windows/xaml-static/cs",
    scope: "static XAML scan with XmlReader (also proves well-formedness)",
    build: csBuild(xs("cs"), join(outDir, "xaml-static-cs")),
    run: async () => {
      const d = resolveDotnet(xs("cs"))!;
      const r = await runDotnet(d, [join(outDir, "xaml-static-cs", "xaml-static.dll"), norm(xamlListFile)], repoRoot);
      return { ok: r.code === 0 && r.stdout.length > 0, output: r.stdout.replace(/\r\n/g, "\n") };
    },
  },
  {
    id: "xaml-static-rust",
    lang: "rust",
    dir: "examples/windows/xaml-static/rust",
    scope: "static XAML scan (std only)",
    build: async () =>
      okBuild(await cargo(xs("rust"), ["build", "--release", "--target-dir", join(outDir, "target-xaml-rust")])),
    run: xamlRun([join(outDir, "target-xaml-rust", "release", "xaml-static.exe")]),
  },
  {
    id: "xaml-static-bun",
    lang: "bun",
    dir: "examples/windows/xaml-static/bun",
    scope: "static XAML scan in Bun (reference output)",
    build: async () => ({ ok: true, log: "interpreted" }),
    run: xamlRun([process.execPath, xs("bun/main.ts")]),
  },

  {
    id: "d3d12-headless-cpp",
    lang: "cpp",
    dir: "examples/windows/d3d12-headless/cpp",
    scope: "WARP device, queue, list, fence, RT clear, readback (no window, no swapchain)",
    build: async () =>
      okBuild(
        await cl(dh("cpp"), [
          "main.cpp",
          `/Fe:${norm(outDir)}/d3d12-cpp.exe`,
          `/Fo:${norm(outDir)}/d3d12-cpp.obj`,
          "d3d12.lib",
          "dxgi.lib",
        ]),
      ),
    run: () => okLine([join(outDir, "d3d12-cpp.exe")]),
  },
  {
    id: "d3d12-headless-cs",
    lang: "cs",
    dir: "examples/windows/d3d12-headless/cs",
    scope: "same, C# with CsWin32 (unsafe COM structs)",
    build: csBuild(dh("cs"), join(outDir, "d3d12-cs")),
    run: () => okLine([join(outDir, "d3d12-cs", "d3d12-headless.exe")]),
  },
  {
    id: "d3d12-headless-rust",
    lang: "rust",
    dir: "examples/windows/d3d12-headless/rust",
    scope: "same, Rust with windows 0.62.2",
    build: async () =>
      okBuild(await cargo(dh("rust"), ["build", "--release", "--target-dir", join(outDir, "target-d3d12-rust")])),
    run: () => okLine([join(outDir, "target-d3d12-rust", "release", "d3d12-headless.exe")]),
  },
  {
    id: "d3d12-headless-bun",
    lang: "bun",
    dir: "examples/windows/d3d12-headless/bun",
    scope: "same, raw COM vtable calls through bun:ffi",
    build: async () => ({ ok: true, log: "interpreted" }),
    run: () => okLine([process.execPath, dh("bun/main.ts")]),
  },

  {
    id: "hello-cpp",
    lang: "cpp",
    dir: "examples/windows/hello/cpp",
    scope: "console hello, dynamic CRT",
    build: async () =>
      okBuild(
        await cl(join(win, "hello/cpp"), [
          "main.cpp",
          "/MD",
          `/Fe:${norm(outDir)}/hello-cpp.exe`,
          `/Fo:${norm(outDir)}/hello-cpp.obj`,
        ]),
      ),
    run: () => hello([join(outDir, "hello-cpp.exe")]),
  },
  {
    id: "hello-rust",
    lang: "rust",
    dir: "examples/windows/hello/rust",
    scope: "console hello, dev profile",
    build: async () =>
      okBuild(await cargo(join(win, "hello/rust"), ["build", "--target-dir", join(outDir, "target-hello-rust")])),
    run: () => hello([join(outDir, "target-hello-rust", "debug", "hello.exe")]),
  },
  {
    id: "hello-bun",
    lang: "bun",
    dir: "examples/windows/hello/bun",
    scope: "console hello, bun run",
    build: async () => ({ ok: true, log: "interpreted" }),
    run: () => hello([process.execPath, join(win, "hello/bun/main.ts")]),
  },
  {
    id: "hello-aot-cpp",
    lang: "cpp",
    dir: "examples/windows/hello/cpp",
    scope: "native release exe, static CRT (NativeAOT analog)",
    build: async () =>
      okBuild(
        await cl(join(win, "hello/cpp"), [
          "main.cpp",
          "/MT",
          "/O1",
          `/Fe:${norm(outDir)}/hello-aot-cpp.exe`,
          `/Fo:${norm(outDir)}/hello-aot-cpp.obj`,
        ]),
      ),
    run: () => hello([join(outDir, "hello-aot-cpp.exe")]),
  },
  {
    id: "hello-aot-rust",
    lang: "rust",
    dir: "examples/windows/hello/rust",
    scope: "release exe, LTO, size-optimised, stripped",
    build: async () =>
      okBuild(
        await cargo(join(win, "hello/rust"), ["build", "--release", "--target-dir", join(outDir, "target-hello-rust")]),
      ),
    run: () => hello([join(outDir, "target-hello-rust", "release", "hello.exe")]),
  },
  {
    id: "hello-aot-bun",
    lang: "bun",
    dir: "examples/windows/hello/bun",
    scope: "bun build --compile standalone executable",
    build: async () =>
      okBuild(
        await exec(
          [
            process.execPath,
            "build",
            "--compile",
            join(win, "hello/bun/main.ts"),
            "--outfile",
            join(outDir, "hello-aot-bun.exe"),
          ],
          repoRoot,
        ),
      ),
    run: () => hello([join(outDir, "hello-aot-bun.exe")]),
  },

  {
    id: "libadd-cpp",
    lang: "cpp",
    dir: "examples/windows/libadd/cpp",
    scope: "DLL exporting add(), called through bun:ffi",
    build: async () =>
      okBuild(
        await cl(join(win, "libadd/cpp"), [
          "add.cpp",
          "/LD",
          `/Fe:${norm(outDir)}/libadd-cpp.dll`,
          `/Fo:${norm(outDir)}/libadd-cpp.obj`,
        ]),
      ),
    run: async () => callAdd(join(outDir, "libadd-cpp.dll")),
  },
  {
    id: "libadd-rust",
    lang: "rust",
    dir: "examples/windows/libadd/rust",
    scope: "cdylib exporting add(), called through bun:ffi",
    build: async () =>
      okBuild(
        await cargo(join(win, "libadd/rust"), [
          "build",
          "--release",
          "--target-dir",
          join(outDir, "target-libadd-rust"),
        ]),
      ),
    run: async () => callAdd(join(outDir, "target-libadd-rust", "release", "libadd.dll")),
  },
  {
    id: "libadd-bun",
    lang: "bun",
    dir: "examples/windows/libadd/bun",
    scope: "TypeScript module exporting add()",
    build: async () => ({ ok: true, log: "interpreted" }),
    run: async () => {
      const r = await spawnRun([process.execPath, join(win, "libadd/bun/lib.ts")]);
      return { ok: r.code === 0 && r.text.trim() === "5", output: r.text.trim() };
    },
  },
];

export const implById = (id: string) => IMPLS.find(i => i.id === id);
