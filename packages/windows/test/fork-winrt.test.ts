// SPDX-License-Identifier: Apache-2.0
// bun:winrt on upstream Bun (src/fork/winrt.ts), ported from the fork's test/js/bun/windows/winrt.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import comDelegate from "../src/fork/com-delegate";
import winrt from "../src/fork/winrt";

const isWindows = process.platform === "win32";

test("WinRT metadata projects enum and interface identities without OS activation", () => {
  const iid = "00112233-4455-6677-8899-aabbccddeeff";
  const projection = winrt.defineNamespace({
    namespace: "Bun.Test.MetadataProjection",
    interfaces: { "Bun.Test.MetadataProjection.IMarker": { iid, methods: [] } },
    classes: {},
    enums: { "Bun.Test.MetadataProjection.Mode": { Off: 0, On: 1 } },
  });
  expect(Object.keys(projection)).toEqual(["namespace", "Mode", "interfaces"]);
  expect(projection.Mode).toEqual({ Off: 0, On: 1 });
  expect(Object.isFrozen(projection.interfaces)).toBe(true);
});

test("validates WinRT GUIDs before crossing the ABI", () => {
  expect(winrt.guid("00112233-4455-6677-8899-aabbccddeeff")).toHaveLength(16);
  expect(winrt.guid("{00112233-4455-6677-8899-AABBCCDDEEFF}")).toHaveLength(16);
  expect(() => winrt.guid("00112233-4455-6677-8899-aabbccddeezz")).toThrow(TypeError);
  expect(() => winrt.guid("{00112233-4455-6677-8899-aabbccddeeff")).toThrow(TypeError);
});

describe.skipIf(!isWindows || process.arch !== "x64")("COM delegate (x86-64 IUnknown stubs)", () => {
  test("QueryInterface, AddRef, Release and Invoke follow COM rules", async () => {
    const { CFunction, read, ptr } = await import("bun:ffi");
    const calls: number[][] = [];
    const iid = "11111111-2222-3333-4444-555555555555";
    const object = comDelegate.delegate(iid, (a, b, c, d) => void calls.push([a, b, c, d]));
    const slot = (i: number) => read.ptr(read.ptr(object as never, 0) as never, i * 8) as never;
    const queryInterface = CFunction({ ptr: slot(0), args: ["ptr", "ptr", "ptr"], returns: "i32" });
    const addRef = CFunction({ ptr: slot(1), args: ["ptr"], returns: "u32" });
    const invoke = CFunction({ ptr: slot(3), args: ["ptr", "u64", "u64", "u64", "u64"], returns: "i32" });
    const out = new BigUint64Array(1);
    for (const known of [iid, "00000000-0000-0000-c000-000000000046", "94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"]) {
      expect(queryInterface(object, ptr(winrt.guid(known)), ptr(out))).toBe(0);
      expect(out[0]).toBe(BigInt(object));
    }
    expect(queryInterface(object, ptr(new Uint8Array(16).fill(7)), ptr(out)) >>> 0).toBe(0x80004002);
    expect(out[0]).toBe(0n);
    expect(comDelegate.release(object)).toBe(3);
    expect(comDelegate.release(object)).toBe(2);
    expect(addRef(object)).toBe(3);
    expect(comDelegate.release(object)).toBe(2);
    expect(comDelegate.release(object)).toBe(1);
    expect(invoke(object, 1n, 2n, 3n, 4n)).toBe(0);
    await Bun.sleep(20);
    expect(calls).toEqual([[1, 2, 3, 4]]);
    const live = comDelegate.live();
    expect(comDelegate.release(object)).toBe(0);
    await Bun.sleep(20);
    expect(comDelegate.live()).toBe(live - 1);
  });
});

describe.skipIf(!isWindows)("bun:winrt", () => {
  test("projects System32 namespaces on demand", () => {
    const { Uri } = winrt.namespace("Windows.Foundation");
    const uri = Uri.CreateUri("https://example.com:8443/a/b?c=1#d");
    expect(uri.Host).toBe("example.com");
    expect(uri.Port).toBe(8443);
    expect(uri.Path).toBe("/a/b");
    expect(uri.runtimeClassName).toBe("Windows.Foundation.Uri");
    // IStringable is not the default interface: bound through QueryInterface.
    expect(uri.ToString()).toBe("https://example.com:8443/a/b?c=1#d");
    expect(() => Uri.CreateUri("not a uri")).toThrow("HRESULT");
  });

  test("IAsyncOperation and IAsyncAction resolve as Promises, IVectorView is iterable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bun-winrt-"));
    try {
      writeFileSync(join(dir, "a.txt"), "a");
      writeFileSync(join(dir, "b.txt"), "b");
      const { StorageFolder } = winrt.namespace("Windows.Storage");
      const operation = StorageFolder.GetFolderFromPathAsync(dir);
      expect(typeof operation.cancel).toBe("function");
      const folder = await operation;
      expect(operation.cancel()).toBeUndefined();
      expect(folder.Path.toLowerCase()).toBe(dir.toLowerCase());

      const files = await folder.GetFilesAsyncOverloadDefaultOptionsStartAndCount();
      expect(files.Size).toBe(2);
      expect([...files].map((file: { Name: string }) => file.Name).sort()).toEqual(["a.txt", "b.txt"]);

      const file = await folder.GetFileAsync("a.txt");
      const stream = await file.OpenReadAsync();
      const { DataReader } = winrt.namespace("Windows.Storage.Streams");
      const input = stream.as("Windows.Storage.Streams.IRandomAccessStream").GetInputStreamAt(0n);
      const reader = DataReader.CreateDataReader(input);
      const load = reader.LoadAsync(1);
      expect(typeof load.cancel).toBe("function");
      expect(await load).toBe(1);
      reader.Close();
      stream.as("Windows.Foundation.IClosable").Close();

      expect(await file.DeleteAsyncOverloadDefaultOptions()).toBeUndefined();
      expect(existsSync(join(dir, "a.txt"))).toBe(false);

      await expect((async () => folder.GetFileAsync("missing.txt"))()).rejects.toThrow("HRESULT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
