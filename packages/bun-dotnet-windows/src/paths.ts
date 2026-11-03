// SPDX-License-Identifier: MIT
/**
 * Where the native artifacts of @aphrody/bun-dotnet-windows live, first match wins:
 *   1. BUNOS_DOTNET_WINDOWS_DIR (one directory holding everything, the install layout)
 *   2. %SystemRoot%\BunOS\dotnet-windows (install/install.ps1, the shipped layout)
 *   3. beside the running executable (a `bun build --compile` bin installed next to the libraries)
 *   4. <checkout>/target/bun-dotnet-windows (scripts/build.ts output, the build layout)
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Layout {
  /** bunos_windows.dll (C# Native AOT). */
  native: string;
  /** bunos_win_cpp.dll (C++). */
  cpp: string;
  /** BunOs.Pwsh.dll + .runtimeconfig.json (bun:dotnet hosted). */
  pwshHost: string;
  /** PSHOME built from vendor/powershell. */
  pshome: string;
  /** Where the layout was found. */
  root: string;
  kind: "env" | "installed" | "exe" | "build";
}

function installed(root: string, kind: Layout["kind"]): Layout {
  return {
    native: join(root, "bunos_windows.dll"),
    cpp: join(root, "bunos_win_cpp.dll"),
    pwshHost: join(root, "BunOs.Pwsh.dll"),
    pshome: join(root, "pshome"),
    root,
    kind,
  };
}

function build(root: string): Layout {
  return {
    native: join(root, "native", "bunos_windows.dll"),
    cpp: join(root, "cpp", "bunos_win_cpp.dll"),
    pwshHost: join(root, "pwsh-host", "BunOs.Pwsh.dll"),
    pshome: join(root, "pwsh-fxdependent"),
    root,
    kind: "build",
  };
}

/** The checkout this package lives in (BUNOS_REPO overrides). */
export function checkoutRoot(): string {
  return process.env.BUNOS_REPO || resolve(import.meta.dir, "..", "..", "..");
}

let cached: Layout | undefined;

export function layout(): Layout {
  if (cached) return cached;
  const candidates: Layout[] = [];
  if (process.env.BUNOS_DOTNET_WINDOWS_DIR) candidates.push(installed(process.env.BUNOS_DOTNET_WINDOWS_DIR, "env"));
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  candidates.push(installed(join(systemRoot, "BunOS", "dotnet-windows"), "installed"));
  candidates.push(installed(dirname(process.execPath), "exe"));
  candidates.push(build(join(checkoutRoot(), "target", "bun-dotnet-windows")));
  cached = candidates.find(c => existsSync(c.native)) ?? candidates.at(-1)!;
  return cached;
}

/** Install/build hint for error messages. */
export const BUILD_HINT =
  "build with `bun packages/bun-dotnet-windows/scripts/build.ts` and install with `sudo.exe pwsh -NoProfile -File packages/bun-dotnet-windows/install/install.ps1 install`";
