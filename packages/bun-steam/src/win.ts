// Windows registry, process list and fixed disks for the Steam owner, on upstream Bun: reg.exe, tasklist.exe and
// PowerShell for the registry and processes, bun:ffi (kernel32) for disks. Every function throws on non-Windows hosts.
import { dlopen, FFIType, ptr } from "bun:ffi";

export type RegistryType = "REG_SZ" | "REG_EXPAND_SZ" | "REG_DWORD" | "REG_QWORD" | "REG_MULTI_SZ" | "REG_BINARY" | string;

export interface RegistryValue {
  name: string;
  type: RegistryType;
  value: string | number;
}

export interface RegistryListing {
  keys: string[];
  values: RegistryValue[];
}

function run(command: string, args: string[]): string {
  if (process.platform !== "win32") throw new Error("Windows only");
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  if (result.exitCode !== 0) throw new Error(`${command} exited with ${result.exitCode}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

function parseValue(type: string, data: string): string | number {
  if (type === "REG_DWORD") return Number.parseInt(data, 16);
  if (type === "REG_QWORD") return Number(BigInt(data));
  return data;
}

const VALUE_LINE = /^ {4}(.*?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/;

/** Direct subkeys and values of a registry key (`HKCU\Software\...`), as `reg query` lists them. */
function list(path: string): RegistryListing {
  const out = run("reg", ["query", path]);
  const keys: string[] = [];
  const values: RegistryValue[] = [];
  const prefix = path.replace(/^HKCU\\/i, "HKEY_CURRENT_USER\\").replace(/^HKLM\\/i, "HKEY_LOCAL_MACHINE\\");
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = VALUE_LINE.exec(line);
    if (value) {
      const [, name, type, data = ""] = value;
      values.push({ name: name === "(Default)" ? "" : name!, type: type!, value: parseValue(type!, data) });
    } else if (line.toUpperCase().startsWith(`${prefix.toUpperCase()}\\`)) {
      keys.push(line.slice(prefix.length + 1));
    }
  }
  return { keys, values };
}

export const registry = {
  list,
  /** One value of a key, or null when the key or value does not exist. */
  get(path: string, name: string): { type: RegistryType; value: string | number } | null {
    try {
      const found = list(path).values.find(entry => entry.name.toLowerCase() === name.toLowerCase());
      return found ? { type: found.type, value: found.value } : null;
    } catch {
      return null;
    }
  },
  set(path: string, name: string, value: string | number, type: "REG_SZ" | "REG_DWORD" = "REG_SZ"): void {
    run("reg", ["add", path, "/v", name, "/t", type, "/d", String(value), "/f"]);
  },
};

export interface ProcessInfo {
  pid: number;
  ppid?: number;
  name: string;
  path?: string;
}

export const processes = {
  /** Running processes: image name and pid (tasklist), with parent and path when `detail` is set (CIM). */
  list(options: { detail?: boolean } = {}): ProcessInfo[] {
    if (options.detail) {
      const json = run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress",
      ]).trim();
      const rows = json ? (JSON.parse(json) as unknown) : [];
      return (Array.isArray(rows) ? rows : [rows]).map(
        (row: { ProcessId: number; ParentProcessId: number; Name: string; ExecutablePath: string | null }) => ({
          pid: row.ProcessId,
          ppid: row.ParentProcessId,
          name: row.Name,
          path: row.ExecutablePath ?? undefined,
        }),
      );
    }
    return run("tasklist", ["/fo", "csv", "/nh"])
      .split(/\r?\n/)
      .flatMap(line => {
        const match = /^"([^"]*)","(\d+)"/.exec(line);
        return match ? [{ name: match[1]!, pid: Number(match[2]) }] : [];
      });
  },
};

export interface Drive {
  root: string;
  type: "fixed" | "removable" | "remote" | "cdrom" | "ramdisk" | "unknown";
  totalBytes: number;
  availableBytes: number;
}

const DRIVE_TYPES: Record<number, Drive["type"]> = {
  2: "removable",
  3: "fixed",
  4: "remote",
  5: "cdrom",
  6: "ramdisk",
};

let kernel32: ReturnType<typeof loadKernel32> | undefined;

function loadKernel32() {
  return dlopen("kernel32.dll", {
    GetLogicalDrives: { args: [], returns: FFIType.u32 },
    GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
    GetDiskFreeSpaceExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  }).symbols;
}

export const storage = {
  /** Logical drives with their type and capacity. */
  drives(): Drive[] {
    if (process.platform !== "win32") throw new Error("Windows only");
    kernel32 ??= loadKernel32();
    const mask = kernel32.GetLogicalDrives();
    const drives: Drive[] = [];
    for (let i = 0; i < 26; i++) {
      if (!(mask & (1 << i))) continue;
      const root = `${String.fromCharCode(65 + i)}:\\`;
      const wide = Buffer.from(`${root}\0`, "utf16le");
      const type = DRIVE_TYPES[kernel32.GetDriveTypeW(ptr(wide))] ?? "unknown";
      const available = new BigUint64Array(1);
      const total = new BigUint64Array(1);
      const free = new BigUint64Array(1);
      const ok = kernel32.GetDiskFreeSpaceExW(ptr(wide), ptr(available), ptr(total), ptr(free));
      drives.push({ root, type, totalBytes: ok ? Number(total[0]) : 0, availableBytes: ok ? Number(available[0]) : 0 });
    }
    return drives;
  },
};
