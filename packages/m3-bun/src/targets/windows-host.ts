// SPDX-License-Identifier: Apache-2.0
// The few Windows facts the windows target reads, on upstream Bun: @aphrody/winreg, bun:ffi (shell32) and sc.exe.
import * as registry from "@aphrody/winreg";
import { dlopen, FFIType } from "bun:ffi";
import { release } from "node:os";

export { registry };

const SHELL_FOLDERS = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`;
const CURRENT_VERSION = String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`;
const SERVICES = String.raw`HKLM\SYSTEM\CurrentControlSet\Services`;

export function isElevated(): boolean {
  return dlopen("shell32.dll", { IsUserAnAdmin: { args: [], returns: FFIType.bool } }).symbols.IsUserAnAdmin();
}

/** The per-user or machine folder of a shell location. */
export function knownFolder(name: "ProgramFiles" | "StartMenu" | "Desktop"): string {
  if (name === "ProgramFiles") return process.env.ProgramFiles ?? "C:\\Program Files";
  const value = registry.get(SHELL_FOLDERS, name === "StartMenu" ? "Start Menu" : "Desktop")?.value;
  if (typeof value !== "string" || value === "") throw new Error(`shell folder ${name} is not registered`);
  return value;
}

export function version(): { major: number; minor: number; build: number; productName?: string } {
  const [major = 0, minor = 0, build = 0] = release().split(".").map(Number);
  const productName = registry.get(CURRENT_VERSION, "ProductName")?.value;
  return { major, minor, build, ...(typeof productName === "string" ? { productName } : {}) };
}

const START_TYPES = ["boot", "system", "auto", "manual", "disabled"];

/** A service registration and its current state; null when the service does not exist. */
export const services = {
  get(name: string): { state: string; startType: string; binaryPath: string } | null {
    const key = `${SERVICES}\\${name}`;
    const entries = registry.list(key)?.values;
    if (!entries) return null;
    const value = (entry: string) => entries.find(item => item.name.toLowerCase() === entry.toLowerCase())?.value;
    const query = Bun.spawnSync(["sc", "query", name], { stdout: "pipe", stderr: "ignore", windowsHide: true });
    const state = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(query.stdout.toString())?.[1];
    return {
      state: state ? state.toLowerCase().replaceAll("_", "-") : "unknown",
      startType: START_TYPES[Number(value("Start"))] ?? "unknown",
      binaryPath: String(value("ImagePath") ?? ""),
    };
  },
};
