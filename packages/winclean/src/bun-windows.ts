// SPDX-License-Identifier: Apache-2.0

type RegistryValue = {
  type: string;
  value: string | string[] | number | bigint | Uint8Array;
};

export interface BunWindowsApi {
  version: Record<string, unknown>;
  systemInfo: Record<string, unknown>;
  registry: {
    get(path: string, name?: string): RegistryValue | null;
    list(path: string): {
      keys: string[];
      values: Array<RegistryValue & { name: string }>;
    } | null;
    set(path: string, name: string, value: string | string[] | number | bigint, type?: string): void;
    deleteValue(path: string, name: string): boolean;
    deleteKey(path: string, options?: { recursive?: boolean }): boolean;
  };
  services: {
    list(): Array<{ name: string; displayName: string; state: string }>;
    get(name: string): { startType: string } | null;
    start(name: string): void;
    stop(name: string): void;
  };
  clipboard: { readText(): string | null; writeText(text: string): void };
  storage: {
    drives(): Array<{
      root: string;
      type: string;
      totalBytes: number;
      freeBytes: number;
      availableBytes: number;
    }>;
  };
  memory: { status(): Record<string, number> };
}

function registryData(value: RegistryValue["value"]): string {
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (value instanceof Uint8Array) return [...value].map(byte => byte.toString(16).padStart(2, "0")).join(" ");
  if (typeof value === "number") return `0x${value.toString(16)}`;
  return value;
}

function registryType(type: string): string {
  return type.startsWith("REG_") ? type.slice(4) : type;
}

function registryValue(value: RegistryValue, name: string) {
  const normalized = typeof value.value === "bigint" ? Number(value.value) : value.value;
  return {
    Name: name || "(default)",
    Type: registryType(value.type),
    Data: registryData(value.value),
    Value: normalized,
  };
}

function registryInput(value: string, type: string): string | string[] | number | bigint {
  switch (type.toLowerCase()) {
    case "dword":
      return Number.parseInt(value, 0);
    case "qword":
      return BigInt(value);
    case "multistring":
      return value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").filter(Boolean);
    default:
      return value;
  }
}

/** Execute WinClean compatibility tools whose stable primitive is a native Windows host (`windows-host.ts`). */
export async function callBunWindows(
  name: string,
  args: Record<string, unknown>,
  injected?: BunWindowsApi,
): Promise<{ handled: boolean; value?: unknown }> {
  if (process.platform !== "win32" && !injected) return { handled: false };
  const windows = injected ?? (await import("./windows-host")).windowsHost();
  const text = (key: string) => String(args[key] ?? "");

  switch (name) {
    case "get_registry_value": {
      const value = windows.registry.get(text("path"), text("name") === "(default)" ? "" : text("name"));
      if (!value) throw new Error("registry value not found");
      return {
        handled: true,
        value: { Path: text("path"), ...registryValue(value, text("name")) },
      };
    }
    case "list_registry_key": {
      const path = text("path");
      const listing = windows.registry.list(path);
      if (!listing) throw new Error("registry key not found");
      return {
        handled: true,
        value: {
          Path: path,
          SubKeys: listing.keys.map(key => `${path.replace(/\\$/, "")}\\${key}`),
          Values: listing.values.map(value => registryValue(value, value.name)),
        },
      };
    }
    case "set_registry_value": {
      const type = text("type") || "String";
      const name = text("name") === "(default)" ? "" : text("name");
      const nativeType = `REG_${type.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
      windows.registry.set(text("path"), name, registryInput(text("value"), type), nativeType);
      return {
        handled: true,
        value: `Set registry value ${text("path")}\\${text("name")}`,
      };
    }
    case "delete_registry_entry": {
      const path = text("path");
      const entry = args.name == null || text("name") === "" ? null : text("name");
      if (entry) windows.registry.deleteValue(path, entry === "(default)" ? "" : entry);
      else windows.registry.deleteKey(path, { recursive: true });
      return {
        handled: true,
        value: `Deleted registry ${entry ? `value ${path}\\${entry}` : `key ${path}`}`,
      };
    }
    case "list_services": {
      const nameFilter = text("nameFilter").toLowerCase();
      const statusFilter = text("statusFilter").toLowerCase();
      const services = windows.services
        .list()
        .filter(service => !nameFilter || service.name.toLowerCase().includes(nameFilter))
        .filter(service => !statusFilter || service.state.replaceAll("-", "").toLowerCase() === statusFilter)
        .map(service => ({
          Name: service.name,
          DisplayName: service.displayName,
          Status: service.state
            .split("-")
            .map(part => part[0]?.toUpperCase() + part.slice(1))
            .join(""),
          StartType: windows.services.get(service.name)?.startType ?? "Unknown",
        }));
      return {
        handled: true,
        value: { Count: services.length, Services: services },
      };
    }
    case "start_service":
    case "stop_service":
    case "restart_service": {
      const service = text("name");
      if (name !== "start_service") windows.services.stop(service);
      if (name !== "stop_service") windows.services.start(service);
      const verb = name === "start_service" ? "Started" : name === "stop_service" ? "Stopped" : "Restarted";
      return { handled: true, value: `${verb} service '${service}'.` };
    }
    case "get_clipboard_text":
      return { handled: true, value: windows.clipboard.readText() ?? "" };
    case "set_clipboard_text": {
      const value = text("text");
      windows.clipboard.writeText(value);
      return {
        handled: true,
        value: `Copied ${[...value].length} characters to the clipboard.`,
      };
    }
    case "get_disk_info": {
      const disks = windows.storage.drives().map(drive => ({
        Root: drive.root,
        DriveType: drive.type[0]?.toUpperCase() + drive.type.slice(1),
        TotalBytes: drive.totalBytes,
        FreeBytes: drive.freeBytes,
        AvailableBytes: drive.availableBytes,
      }));
      return { handled: true, value: { Count: disks.length, Disks: disks } };
    }
    case "get_os_info":
      return {
        handled: true,
        value: {
          ProductName: windows.version.productName,
          EditionId: windows.version.edition,
          DisplayVersion: windows.version.displayVersion,
          BuildNumber: String(windows.version.build),
          Ubr: String(windows.version.ubr),
          InstallationType: windows.version.installationType,
          OsArchitecture: windows.version.nativeArch,
          MachineName: windows.systemInfo.computerName,
          UserName: windows.systemInfo.userName,
        },
      };
    case "get_memory_info": {
      const status = windows.memory.status() as Record<string, number>;
      return {
        handled: true,
        value: {
          MemoryLoadPercent: status.memoryLoad,
          TotalPhysicalBytes: status.totalPhysical,
          AvailablePhysicalBytes: status.availablePhysical,
          TotalPageFileBytes: status.totalPageFile,
          AvailablePageFileBytes: status.availablePageFile,
          TotalVirtualBytes: status.totalVirtual,
          AvailableVirtualBytes: status.availableVirtual,
        },
      };
    }
    default:
      return { handled: false };
  }
}
