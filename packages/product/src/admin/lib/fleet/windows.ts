// SPDX-License-Identifier: Apache-2.0
// Windows host facts for the GPU fleet on upstream Bun: node:os, bun:ffi (kernel32, shell32), reg.exe and PowerShell.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { homedir, release } from "node:os";
import { join } from "node:path";

export interface Drive {
  root: string;
  type: string;
  totalBytes: number;
  availableBytes: number;
}

const DRIVE_TYPES: Record<number, string> = { 2: "removable", 3: "fixed", 4: "remote", 5: "cdrom", 6: "ramdisk" };

/** Logical drives with capacity, through kernel32. */
export function drives(): Drive[] {
  const k = dlopen("kernel32.dll", {
    GetLogicalDrives: { args: [], returns: FFIType.u32 },
    GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
    GetDiskFreeSpaceExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  }).symbols;
  const mask = k.GetLogicalDrives();
  const found: Drive[] = [];
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
      availableBytes: ok ? Number(available[0]) : 0,
    });
  }
  return found;
}

export function isElevated(): boolean {
  return dlopen("shell32.dll", { IsUserAnAdmin: { args: [], returns: FFIType.bool } }).symbols.IsUserAnAdmin();
}

/** Windows 11 starts at build 22000. */
export function isWindows11(): boolean {
  return Number(release().split(".")[2] ?? 0) >= 22000;
}

export function knownFolder(name: "LocalAppData" | "ProgramFiles"): string {
  if (name === "ProgramFiles") return process.env.ProgramFiles ?? "C:\\Program Files";
  return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
}

async function capture(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`${argv[0]} exited with ${code}`);
  return out;
}

const SERVICE_STATES: Record<number, string> = { 1: "stopped", 2: "start_pending", 3: "stop_pending", 4: "running", 5: "continue_pending", 6: "pause_pending", 7: "paused" };

/** Services whose name matches `pattern`, with their status. */
export async function services(pattern: RegExp): Promise<{ name: string; status: string }[]> {
  const text = await capture([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Service | Select-Object Name,Status | ConvertTo-Json -Compress",
  ]);
  const rows = JSON.parse(text.trim() || "[]") as { Name: string; Status: number | string }[];
  return (Array.isArray(rows) ? rows : [rows])
    .filter(row => pattern.test(row.Name))
    .map(row => ({ name: row.Name, status: typeof row.Status === "number" ? (SERVICE_STATES[row.Status] ?? String(row.Status)) : String(row.Status).toLowerCase() }));
}

/** WSL registrations from the registry only; this does not start WSL. */
export async function wslDistributions(): Promise<{ name: string; version: number }[]> {
  let text: string;
  try {
    text = await capture(["reg", "query", String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`, "/s"]);
  } catch {
    return [];
  }
  const found: { name: string; version: number }[] = [];
  let current: { name?: string; version?: number } = {};
  const flush = () => {
    if (current.name) found.push({ name: current.name, version: current.version ?? 1 });
    current = {};
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) flush();
    const name = /^\s+DistributionName\s+REG_SZ\s+(.+)$/.exec(line);
    if (name) current.name = name[1]!.trim();
    const version = /^\s+Flags\s+REG_DWORD\s+0x([0-9a-f]+)$/i.exec(line);
    // Flags bit 3 (0x8) marks a WSL 2 registration.
    if (version) current.version = Number.parseInt(version[1]!, 16) & 0x8 ? 2 : 1;
  }
  flush();
  return found;
}
