// SPDX-License-Identifier: Apache-2.0
// The Windows host behind the WinClean compatibility tools, on upstream Bun: reg.exe, PowerShell and sc.exe through
// Bun.spawnSync, and bun:ffi (kernel32) for drives and memory. Synchronous on purpose, like the BunWindowsApi it fills.
import { hostname, userInfo } from "node:os";
import type { BunWindowsApi } from "./bun-windows";
import * as nativeRegistry from "@aphrody/windows/registry";
import * as win32 from "@aphrody/windows/win32";
import * as shell from "@aphrody/windows/shell";

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

function drives() {
  return win32.volumes().map(v => ({
    root: v.root,
    type: v.type,
    totalBytes: Number(v.totalBytes),
    freeBytes: Number(v.freeBytes),
    availableBytes: Number(v.availableBytes),
  }));
}

function memoryStatus(): Record<string, number> {
  const m = win32.memory();
  return {
    memoryLoad: m.loadPercent,
    totalPhysical: Number(m.totalPhys),
    availablePhysical: Number(m.availPhys),
    totalPageFile: Number(m.totalPageFile),
    availablePageFile: Number(m.availPageFile),
    totalVirtual: Number(m.totalVirtual),
    availableVirtual: Number(m.availVirtual),
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

export const isElevated = (): boolean => win32.isElevated();

/** The current user's profile and local application data folders. */
export const knownFolder = (name: "Profile" | "LocalAppData"): string => shell.knownFolder(name);

/** Running processes (image name and pid), from tasklist. */
export const processes = (): Array<{ pid: number; name: string }> =>
  win32.processes().map(({ pid, name }) => ({ pid, name }));

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
