// SPDX-License-Identifier: Apache-2.0
// The Windows host behind the WinClean compatibility tools, on upstream Bun: reg.exe, PowerShell and sc.exe through
// Bun.spawnSync, and bun:ffi (kernel32) for drives and memory. Synchronous on purpose, like the BunWindowsApi it fills.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import type { BunWindowsApi } from "./bun-windows";
import * as nativeRegistry from "@aphrody/winreg";

function run(command: string, args: string[], input?: string): string {
  const result = Bun.spawnSync([command, ...args], {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed (${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function powershell(script: string): string {
  return run("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`,
  ]);
}

/** PowerShell-style type names (`MultiString` becomes `REG_MULTI_STRING`) mapped to registry types. */
const REG_TYPE_ALIASES: Record<string, string> = {
  REG_STRING: "REG_SZ",
  REG_EXPAND_STRING: "REG_EXPAND_SZ",
  REG_MULTI_STRING: "REG_MULTI_SZ",
};

const SERVICE_STATE: Record<string, string> = {
  Running: "running",
  Stopped: "stopped",
  "Start Pending": "start-pending",
  "Stop Pending": "stop-pending",
  "Continue Pending": "continue-pending",
  "Pause Pending": "pause-pending",
  Paused: "paused",
};

const START_TYPE: Record<string, string> = {
  Auto: "auto",
  Manual: "manual",
  Disabled: "disabled",
  Boot: "boot",
  System: "system",
};

function services(): Array<{ name: string; displayName: string; state: string; startType: string }> {
  const text = powershell(
    "Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode | ConvertTo-Json -Compress",
  ).trim();
  const rows = (text ? JSON.parse(text) : []) as Array<{
    Name: string;
    DisplayName: string;
    State: string;
    StartMode: string;
  }>;
  return (Array.isArray(rows) ? rows : [rows]).map(row => ({
    name: row.Name,
    displayName: row.DisplayName,
    state: SERVICE_STATE[row.State] ?? row.State.toLowerCase().replaceAll(" ", "-"),
    startType: START_TYPE[row.StartMode] ?? row.StartMode.toLowerCase(),
  }));
}

function kernel32() {
  return dlopen("kernel32.dll", {
    GetLogicalDrives: { args: [], returns: FFIType.u32 },
    GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
    GetDiskFreeSpaceExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    GlobalMemoryStatusEx: { args: [FFIType.ptr], returns: FFIType.bool },
  }).symbols;
}

const DRIVE_TYPES: Record<number, string> = { 2: "removable", 3: "fixed", 4: "remote", 5: "cdrom", 6: "ramdisk" };

function drives() {
  const k = kernel32();
  const mask = k.GetLogicalDrives();
  const found = [];
  for (let i = 0; i < 26; i++) {
    if (!(mask & (1 << i))) continue;
    const root = `${String.fromCharCode(65 + i)}:\\`;
    const name = Buffer.from(`${root}\0`, "utf16le");
    const available = new BigUint64Array(1);
    const total = new BigUint64Array(1);
    const free = new BigUint64Array(1);
    const ok = k.GetDiskFreeSpaceExW(ptr(name), ptr(available), ptr(total), ptr(free));
    found.push({
      root,
      type: DRIVE_TYPES[k.GetDriveTypeW(ptr(name))] ?? "unknown",
      totalBytes: ok ? Number(total[0]) : 0,
      freeBytes: ok ? Number(free[0]) : 0,
      availableBytes: ok ? Number(available[0]) : 0,
    });
  }
  return found;
}

function memoryStatus(): Record<string, number> {
  const buffer = new Uint8Array(64);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 64, true);
  if (!kernel32().GlobalMemoryStatusEx(ptr(buffer))) throw new Error("GlobalMemoryStatusEx failed");
  return {
    memoryLoad: view.getUint32(4, true),
    totalPhysical: Number(view.getBigUint64(8, true)),
    availablePhysical: Number(view.getBigUint64(16, true)),
    totalPageFile: Number(view.getBigUint64(24, true)),
    availablePageFile: Number(view.getBigUint64(32, true)),
    totalVirtual: Number(view.getBigUint64(40, true)),
    availableVirtual: Number(view.getBigUint64(48, true)),
  };
}

function versionInfo(): Record<string, unknown> {
  const key = String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`;
  const values = new Map((nativeRegistry.list(key)?.values ?? []).map(entry => [entry.name, entry.value]));
  const text = (name: string) => String(values.get(name) ?? "");
  return {
    productName: text("ProductName"),
    edition: text("EditionID"),
    displayVersion: text("DisplayVersion") || text("ReleaseId"),
    build: text("CurrentBuild") || text("CurrentBuildNumber"),
    ubr: Number(values.get("UBR") ?? 0),
    installationType: text("InstallationType"),
    nativeArch: process.arch === "arm64" ? "arm64" : "x64",
  };
}

export function isElevated(): boolean {
  return dlopen("shell32.dll", { IsUserAnAdmin: { args: [], returns: FFIType.bool } }).symbols.IsUserAnAdmin();
}

/** The current user's profile and local application data folders. */
export function knownFolder(name: "Profile" | "LocalAppData"): string {
  return name === "Profile" ? homedir() : (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"));
}

/** Running processes (image name and pid), from tasklist. */
export function processes(): Array<{ pid: number; name: string }> {
  return run("tasklist", ["/fo", "csv", "/nh"])
    .split(/\r?\n/)
    .flatMap(line => {
      const match = /^"([^"]*)","(\d+)"/.exec(line);
      return match ? [{ name: match[1]!, pid: Number(match[2]) }] : [];
    });
}

/** The BunWindowsApi on this machine; only valid on Windows. */
export function windowsHost(): BunWindowsApi {
  if (process.platform !== "win32") throw new Error("The Windows host is available only on Windows");
  return {
    get version() {
      return versionInfo();
    },
    get systemInfo() {
      return { computerName: hostname(), userName: userInfo().username };
    },
    registry: {
      get: (path, name = "") => nativeRegistry.get(path, name),
      list: nativeRegistry.list,
      set: (path, name, value, type = "REG_SZ") =>
        nativeRegistry.set(path, name, value, REG_TYPE_ALIASES[type] ?? type),
      deleteValue: nativeRegistry.deleteValue,
      deleteKey: nativeRegistry.deleteKey,
    },
    services: {
      list: () => services().map(({ name, displayName, state }) => ({ name, displayName, state })),
      get: name => {
        const found = services().find(service => service.name.toLowerCase() === name.toLowerCase());
        return found ? { startType: found.startType } : null;
      },
      start: name => void run("sc", ["start", name]),
      stop: name => void run("sc", ["stop", name]),
    },
    clipboard: {
      readText: () => powershell("Get-Clipboard -Raw").replace(/\r?\n$/, "") || null,
      writeText: text =>
        void run(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ],
          text,
        ),
    },
    storage: { drives },
    memory: { status: memoryStatus },
  };
}
