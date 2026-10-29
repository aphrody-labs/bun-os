import { expect, test } from "bun:test";
import { applyNativeTheme, detectPlatform, effectsFor, type ThemeWindow } from "../src/index.ts";

function fakeWindow() {
  const calls: unknown[][] = [];
  const win: ThemeWindow = {
    setEffects: async fx => void calls.push(["setEffects", fx]),
    clearEffects: async () => void calls.push(["clearEffects"]),
    setTheme: async t => void calls.push(["setTheme", t]),
  };
  return { win, calls };
}
const fakeDoc = () => ({ documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> } });

test("Windows maps Fluent to Mica and Material 3 to Acrylic", () => {
  expect(effectsFor("fluent", "windows")?.effects as unknown).toEqual(["mica"]);
  expect(effectsFor("material3", "windows")?.effects as unknown).toEqual(["acrylic"]);
  expect(effectsFor("apple", "windows")?.effects as unknown).toEqual(["tabbed"]);
});

test("macOS maps Apple to Liquid Glass, Linux has no native effect", () => {
  expect(effectsFor("apple", "macos")?.effects as unknown).toEqual(["liquidGlassRegular"]);
  expect(effectsFor("apple", "linux")).toBeNull();
});

test("applyNativeTheme sets effects, scheme and a transparent root", async () => {
  const { win, calls } = fakeWindow();
  const document = fakeDoc();
  const applied = await applyNativeTheme("fluent", { window: win, platform: "windows", scheme: "dark", document: document as never });
  expect(applied).toEqual({ theme: "fluent", platform: "windows", effects: ["mica"], native: true });
  expect(calls.map(c => c[0])).toEqual(["setTheme", "setEffects"]);
  expect(document.documentElement.dataset.theme).toBe("fluent");
  expect(document.documentElement.style.background).toBe("transparent");
});

test("applyNativeTheme clears effects where none exist", async () => {
  const { win, calls } = fakeWindow();
  const document = fakeDoc();
  const applied = await applyNativeTheme("apple", { window: win, platform: "linux", scheme: "light", document: document as never });
  expect(applied.native).toBe(false);
  expect(calls.map(c => c[0])).toEqual(["setTheme", "clearEffects"]);
  expect(document.documentElement.style.background).toBe("");
});

test("detectPlatform reads the user agent", () => {
  expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
});
