import { afterAll, expect, test } from "bun:test";
import { deleteKey, deleteValue, get, list, set } from "../src";

const key = String.raw`HKCU:\Software\aphrody-winreg-test-${process.pid}`;

afterAll(() => {
  if (process.platform === "win32") deleteKey(key);
});

test.skipIf(process.platform !== "win32")("values round-trip through every supported type", () => {
  set(key, "Text", "été", "REG_SZ");
  set(key, "Number", 7, "REG_DWORD");
  set(key, "Big", 2n ** 40n, "REG_QWORD");
  set(key, "Many", ["a", "b"], "REG_MULTI_SZ");
  set(key, "Bytes", Uint8Array.of(1, 2, 3), "REG_BINARY");
  set(key, "", "unnamed", "REG_SZ");
  expect(get(key, "Text")).toEqual({ type: "REG_SZ", value: "été" });
  expect(get(key, "number")).toEqual({ type: "REG_DWORD", value: 7 });
  expect(get(key, "Big")).toEqual({ type: "REG_QWORD", value: 2n ** 40n });
  expect(get(key, "Many")).toEqual({ type: "REG_MULTI_SZ", value: ["a", "b"] });
  expect(get(key, "Bytes")).toEqual({ type: "REG_BINARY", value: Uint8Array.of(1, 2, 3) });
  expect(get(key, "")).toEqual({ type: "REG_SZ", value: "unnamed" });
});

test.skipIf(process.platform !== "win32")("list reports subkeys, and delete removes values and keys", () => {
  set(`${key}\\Child`, "x", 1, "REG_DWORD");
  expect(list(key)?.keys).toContain("Child");
  expect(deleteValue(key, "Text")).toBe(true);
  expect(get(key, "Text")).toBeNull();
  expect(deleteKey(`${key}\\Child`)).toBe(true);
  expect(list(`${key}\\Child`)).toBeNull();
});

test.skipIf(process.platform !== "win32")("the registry answers for system keys and missing keys", () => {
  expect(get(String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "CurrentBuild")?.type).toBe("REG_SZ");
  expect(list(String.raw`HKCU\Software\aphrody-no-such-key`)).toBeNull();
});
