// SPDX-License-Identifier: Apache-2.0
// Read-only state of a Windows install made by the windows target: shortcuts, the Apps & features entry, the
// WinSW service and the installed executable, read with @aphrody/winreg (registry, known folders), bun:ffi and sc.exe
// (Service Control Manager). Nothing is written.
import { registry } from "./windows-host.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TargetContext } from "./types.ts";

export interface WindowsInspection {
  windows: string;
  elevated: boolean;
  executable: { path: string; exists: boolean };
  shortcuts: {
    startMenu: { path: string; exists: boolean };
    desktop: { path: string; exists: boolean };
  };
  /** `HKCU\...\Uninstall\<name>` (Apps & features), or null when not registered. */
  uninstall: {
    key: string;
    displayName?: string;
    displayVersion?: string;
    installLocation?: string;
  } | null;
  /** The WinSW service, or null when the app is not a service. */
  service: { state: string; startType: string; binaryPath: string } | null;
  /** Installed version equals the context version. */
  upToDate: boolean;
}

export const uninstallKey = (c: Pick<TargetContext, "name">): string =>
  `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${c.name}`;

export const shortcutName = (c: Pick<TargetContext, "name" | "windows">): string => `${c.windows?.title ?? c.name}.lnk`;

/** Where the windows target's scripts put things on this machine, and what is there now. */
export async function inspectWindows(
  c: Pick<TargetContext, "name" | "version" | "windows">,
  installDir?: string,
): Promise<WindowsInspection> {
  const windows = await import("./windows-host.ts");
  if (process.platform !== "win32") throw new Error("m3-bun: inspectWindows runs on Windows only");
  const text = (path: string, name: string) => {
    const value = registry.get(path, name)?.value;
    return typeof value === "string" ? value : undefined;
  };
  const key = uninstallKey(c);
  const displayName = text(key, "DisplayName");
  const displayVersion = text(key, "DisplayVersion");
  const installLocation = text(key, "InstallLocation");
  const dir = installDir ?? installLocation ?? join(windows.knownFolder("ProgramFiles"), c.name);
  const exe = join(dir, `${c.name}.exe`);
  const lnk = shortcutName(c);
  const startMenu = join(windows.knownFolder("StartMenu"), "Programs", lnk);
  const desktop = join(windows.knownFolder("Desktop"), lnk);
  const service = windows.services.get(c.name);
  const version = windows.version();
  return {
    windows: version.productName ?? `${version.major}.${version.minor}.${version.build}`,
    elevated: windows.isElevated(),
    executable: { path: exe, exists: existsSync(exe) },
    shortcuts: {
      startMenu: { path: startMenu, exists: existsSync(startMenu) },
      desktop: { path: desktop, exists: existsSync(desktop) },
    },
    uninstall:
      displayName === undefined && displayVersion === undefined
        ? null
        : {
            key,
            ...(displayName !== undefined ? { displayName } : {}),
            ...(displayVersion !== undefined ? { displayVersion } : {}),
            ...(installLocation !== undefined ? { installLocation } : {}),
          },
    service: service
      ? {
          state: service.state,
          startType: service.startType,
          binaryPath: service.binaryPath,
        }
      : null,
    upToDate: displayVersion === c.version,
  };
}
