#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * Build of @aphrody/bun-dotnet-windows (Windows only: Native AOT and MSVC cannot cross-compile from Linux).
 *
 *   bun packages/bun-dotnet-windows/scripts/build.ts [all|winmd|native|pwsh|pwsh-host|cpp|bins] [--tfm net11.0]
 *
 * Steps, outputs under <checkout>/target/bun-dotnet-windows/:
 *   winmd      midl /winrt: vendor/winget-cli PackageManager.idl -> winmd/Microsoft.Management.Deployment.winmd
 *   native     dotnet publish -c Release (Native AOT): native/bunos_windows.dll (+ .lib, .pdb)
 *   pwsh       Start-PSBuild of vendor/powershell (fxdependent-win-desktop, .NET 11): pwsh-fxdependent/
 *   pwsh-host  dotnet publish of pwsh/BunOs.Pwsh.csproj against that PSHOME: pwsh-host/BunOs.Pwsh.dll
 *   cpp        cmake + ninja + cl (C++/WinRT, WIL, DirectX-Headers): cpp/bunos_win_cpp.dll
 *   bins       bun build --compile --bytecode: bin/bunos-winget.exe, bin/bunos-pwsh.exe
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, win32 } from "node:path";

const pkg = resolve(import.meta.dir, "..");
const root = resolve(pkg, "..", "..");
export const out = join(root, "target", "bun-dotnet-windows");
const argv = process.argv.slice(2);
const tfmFlag = argv.indexOf("--tfm");
const tfm = tfmFlag >= 0 ? argv[tfmFlag + 1]! : "net10.0";
const steps = argv.filter((a, i) => !a.startsWith("--") && (tfmFlag < 0 || i !== tfmFlag + 1));

function die(message: string): never {
  console.error(`bun-dotnet-windows build: ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") die("Windows only (Native AOT and MSVC do not cross-compile from Linux)");

/** The newest Windows SDK that has midl and the union metadata. */
function windowsSdk(): { version: string; bin: string; union: string; include: string } {
  const kits = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10");
  const versions = readdirSync(join(kits, "UnionMetadata"))
    .filter(v => /^\d+\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(kits, "bin", v, "x64", "midl.exe")))
    .sort((a, b) => Bun.semver.order(a.split(".").slice(0, 3).join("."), b.split(".").slice(0, 3).join(".")));
  const version = versions.at(-1) ?? die(`no Windows SDK with midl.exe under ${kits}`);
  return {
    version,
    bin: join(kits, "bin", version, "x64"),
    union: join(kits, "UnionMetadata", version),
    include: join(kits, "Include", version),
  };
}

let msvcEnv: Record<string, string> | undefined;
/** vcvars64 environment from the buncc MSVC provider (no vswhere, cached). */
function msvc(): Record<string, string> {
  if (msvcEnv) return msvcEnv;
  const r = Bun.spawnSync([process.execPath, join(root, "packages/buncc/src/cli.ts"), "env", "msvc"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) die("bun packages/buncc/src/cli.ts env msvc failed");
  const vars = JSON.parse(r.stdout.toString()) as Record<string, string>;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k.toLowerCase() !== "path") env[k] = v;
  for (const [k, v] of Object.entries(vars)) if (k.toLowerCase() !== "path") env[k] = v;
  env.PATH = vars.path ?? vars.Path ?? vars.PATH ?? process.env.PATH ?? "";
  return (msvcEnv = env);
}

/** The user-local .NET root (dotnet-install), holding .NET 10 LTS and the .NET 11 SDK. */
export function dotnetRoot(): string {
  const local = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet");
  if (process.env.DOTNET_ROOT && existsSync(join(process.env.DOTNET_ROOT, "dotnet.exe")))
    return process.env.DOTNET_ROOT;
  if (existsSync(join(local, "dotnet.exe"))) return local;
  return "C:\\Program Files\\dotnet";
}

function dotnetEnv(): Record<string, string> {
  const env = { ...msvc() };
  const dn = dotnetRoot();
  env.DOTNET_ROOT = dn;
  env.PATH = `${dn};${env.PATH}`;
  env.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
  env.DOTNET_NOLOGO = "1";
  env.DOTNET_MULTILEVEL_LOOKUP = "0";
  return env;
}

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}): void {
  console.log(`$ ${cmd.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const r = Bun.spawnSync(cmd, { cwd: options.cwd, env: options.env, stdio: ["ignore", "inherit", "inherit"] });
  if (r.exitCode !== 0) die(`${cmd[0]} exited with ${r.exitCode}`);
}

const winmd = join(out, "winmd", "Microsoft.Management.Deployment.winmd");

function buildWinmd(): void {
  const sdk = windowsSdk();
  const idlDir = join(root, "vendor", "winget-cli", "src", "Microsoft.Management.Deployment");
  if (!existsSync(join(idlDir, "PackageManager.idl")))
    die("vendor/winget-cli is not checked out (git submodule update --init vendor/winget-cli)");
  mkdirSync(join(out, "winmd"), { recursive: true });
  // midl wants backslash paths and the IDL relative to its working directory.
  run(
    [
      join(sdk.bin, "midl.exe"),
      "/nologo",
      "/winrt",
      "/W1",
      "/nomidl",
      "/h",
      "nul",
      "/metadata_dir",
      win32.normalize(sdk.union),
      "/reference",
      win32.join(sdk.union, "Windows.winmd"),
      "/winmd",
      win32.normalize(winmd),
      "PackageManager.idl",
    ],
    { cwd: idlDir, env: msvc() },
  );
}

function buildNative(): void {
  if (!existsSync(winmd)) buildWinmd();
  const dest = join(out, tfm === "net10.0" ? "native" : `native-${tfm}`);
  run(
    [
      join(dotnetRoot(), "dotnet.exe"),
      "publish",
      join(pkg, "native", "BunOs.Windows.Native.csproj"),
      "-c",
      "Release",
      "-r",
      "win-x64",
      `-p:BunOsTfm=${tfm}`,
      `-p:BunOsWinmd=${winmd}`,
      `-p:BaseIntermediateOutputPath=${join(out, "obj", `native-${tfm}`)}\\`,
      `-p:BaseOutputPath=${join(out, "bin-obj", `native-${tfm}`)}\\`,
      "-o",
      dest,
    ],
    { env: dotnetEnv() },
  );
}

const pshome = join(out, "pwsh-fxdependent");

function buildPwsh(): void {
  const script = join(out, "build-pwsh.ps1");
  mkdirSync(out, { recursive: true });
  // Start-PSBuild is PowerShell's own build entry (vendor/powershell/build.psm1); its SDK pin is global.json.
  const body = [
    "$ErrorActionPreference = 'Stop'",
    `$env:DOTNET_ROOT = '${dotnetRoot()}'`,
    '$env:PATH = "$env:DOTNET_ROOT;$env:PATH"',
    "$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'",
    `Set-Location '${join(root, "vendor", "powershell")}'`,
    "Import-Module ./build.psm1 -Force",
    `Start-PSBuild -Configuration Release -Runtime fxdependent-win-desktop -UseNuGetOrg -Output '${pshome}' -ReleaseTag v7.7.0-preview.5`,
  ].join("\n");
  Bun.write(script, body);
  run(["pwsh", "-NoProfile", "-File", script]);
}

function buildPwshHost(): void {
  if (!existsSync(join(pshome, "System.Management.Automation.dll"))) buildPwsh();
  run(
    [
      join(dotnetRoot(), "dotnet.exe"),
      "publish",
      join(pkg, "pwsh", "BunOs.Pwsh.csproj"),
      "-c",
      "Release",
      `-p:BunOsPsHome=${pshome}\\`,
      `-p:BaseIntermediateOutputPath=${join(out, "obj", "pwsh-host")}\\`,
      `-p:BaseOutputPath=${join(out, "bin-obj", "pwsh-host")}\\`,
      "-o",
      join(out, "pwsh-host"),
    ],
    { env: dotnetEnv() },
  );
}

/** A real ninja.exe (depot_tools ships a wrapper script under the same name). */
function ninja(env: Record<string, string>): string {
  for (const dir of env.PATH!.split(";")) {
    const exe = join(dir, "ninja.exe");
    if (dir && !/depot_tools/i.test(dir) && existsSync(exe)) return exe;
  }
  return die("no ninja.exe on PATH (Visual Studio CMake tools or winget Ninja-build.Ninja)");
}

function buildCpp(): void {
  if (!existsSync(winmd)) buildWinmd();
  const sdk = windowsSdk();
  const build = join(out, "obj", "cpp");
  const projection = join(out, "cppwinrt");
  // C++/WinRT projection of the Windows SDK and of the winget API, generated from metadata.
  run([join(sdk.bin, "cppwinrt.exe"), "-input", sdk.version, "-input", winmd, "-output", projection, "-optimize"], {
    env: msvc(),
  });
  run(
    [
      "cmake",
      "-S",
      join(pkg, "cpp"),
      "-B",
      build,
      "-G",
      "Ninja",
      `-DCMAKE_MAKE_PROGRAM=${ninja(msvc())}`,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DCMAKE_C_COMPILER=cl",
      "-DCMAKE_CXX_COMPILER=cl",
      `-DBUNOS_CPPWINRT=${projection}`,
      `-DBUNOS_VENDOR=${join(root, "vendor")}`,
      `-DBUNOS_WINMD=${winmd}`,
      `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${join(out, "cpp")}`,
    ],
    { env: msvc() },
  );
  run(["cmake", "--build", build, "--config", "Release"], { env: msvc() });
}

function buildBins(): void {
  mkdirSync(join(out, "bin"), { recursive: true });
  for (const name of ["bunos-winget", "bunos-pwsh"]) {
    run([
      process.execPath,
      "build",
      "--compile",
      "--bytecode",
      "--minify",
      "--target=bun-windows-x64",
      join(pkg, "src", "cli", `${name}.ts`),
      "--outfile",
      join(out, "bin", `${name}.exe`),
    ]);
  }
}

const table: Record<string, () => void> = {
  winmd: buildWinmd,
  native: buildNative,
  pwsh: buildPwsh,
  "pwsh-host": buildPwshHost,
  cpp: buildCpp,
  bins: buildBins,
};

if (import.meta.main) {
  const wanted = steps.length === 0 || steps.includes("all") ? ["winmd", "native", "pwsh-host", "cpp", "bins"] : steps;
  for (const step of wanted) (table[step] ?? die(`unknown step '${step}'`))();
}
