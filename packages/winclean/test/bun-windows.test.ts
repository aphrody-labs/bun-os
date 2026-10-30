// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { callBunWindows, type BunWindowsApi } from "../src/bun-windows";

const fake = {
  version: {
    productName: "Windows 11 Pro",
    edition: "Professional",
    displayVersion: "26H2",
    build: 28000,
    ubr: 123,
    installationType: "Client",
    nativeArch: "x64",
  },
  systemInfo: { computerName: "PC", userName: "user" },
  registry: {
    get: () => ({ type: "REG_DWORD", value: 2 }),
    list: () => ({
      keys: ["Child"],
      values: [{ name: "Mode", type: "REG_DWORD", value: 2 }],
    }),
    set: () => {},
    deleteValue: () => true,
    deleteKey: () => true,
  },
  services: {
    list: () => [{ name: "EventLog", displayName: "Windows Event Log", state: "running" }],
    get: () => ({ startType: "auto" }),
    start: () => {},
    stop: () => {},
  },
  clipboard: { readText: () => "text", writeText: () => {} },
  storage: {
    drives: () => [
      {
        root: "C:\\",
        type: "fixed",
        totalBytes: 10,
        freeBytes: 4,
        availableBytes: 3,
      },
    ],
  },
  memory: {
    status: () => ({
      memoryLoad: 50,
      totalPhysical: 10,
      availablePhysical: 5,
      totalPageFile: 20,
      availablePageFile: 10,
      totalVirtual: 30,
      availableVirtual: 15,
    }),
  },
} satisfies BunWindowsApi;

test("adapts the Windows host registry, service and system DTOs", async () => {
  expect(await callBunWindows("get_registry_value", { path: "HKCU:\\Software", name: "Mode" }, fake)).toEqual({
    handled: true,
    value: {
      Path: "HKCU:\\Software",
      Name: "Mode",
      Type: "DWORD",
      Data: "0x2",
      Value: 2,
    },
  });
  expect((await callBunWindows("list_services", {}, fake)).value).toEqual({
    Count: 1,
    Services: [
      {
        Name: "EventLog",
        DisplayName: "Windows Event Log",
        Status: "Running",
        StartType: "auto",
      },
    ],
  });
  expect((await callBunWindows("get_disk_info", {}, fake)).value).toEqual({
    Count: 1,
    Disks: [
      {
        Root: "C:\\",
        DriveType: "Fixed",
        TotalBytes: 10,
        FreeBytes: 4,
        AvailableBytes: 3,
      },
    ],
  });
  expect((await callBunWindows("get_os_info", {}, fake)).value).toMatchObject({
    ProductName: "Windows 11 Pro",
    BuildNumber: "28000",
    MachineName: "PC",
  });
});

test("leaves product-only tools on the Aphrody kernel", async () => {
  expect(await callBunWindows("computer_observe", {}, fake)).toEqual({
    handled: false,
  });
});
