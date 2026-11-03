import { expect, test } from "bun:test";
import { pickTheme } from "../src/boot.ts";
import {
  applyNativeTheme,
  detectPlatform,
  effectsFor,
  SHAPE_PRESETS,
  THEME_IDS,
  type ThemeWindow,
} from "../src/index.ts";

function fakeWindow() {
  const calls: unknown[][] = [];
  const win: ThemeWindow = {
    setEffects: async fx => void calls.push(["setEffects", fx]),
    clearEffects: async () => void calls.push(["clearEffects"]),
    setTheme: async t => void calls.push(["setTheme", t]),
  };
  return { win, calls };
}
function fakeDoc() {
  const props: Record<string, string> = {};
  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => void (props[name] = value),
      removeProperty: (name: string) => {
        const old = props[name] ?? "";
        delete props[name];
        return old;
      },
    },
  };
  return { document: { documentElement }, props };
}

test("Windows: Fluent gets Mica, M3 and Apple stay opaque", () => {
  expect(effectsFor("fluent", "windows")?.effects as unknown).toEqual(["mica"]);
  expect(effectsFor("m3", "windows")).toBeNull();
  expect(effectsFor("apple", "windows")).toBeNull();
});

test("macOS maps Apple to Liquid Glass, Linux has no native effect", () => {
  expect(effectsFor("apple", "macos")?.effects as unknown).toEqual(["liquidGlassRegular", "underWindowBackground"]);
  expect(effectsFor("apple", "macos")?.radius).toBe(26);
  for (const id of THEME_IDS) expect(effectsFor(id, "linux")).toBeNull();
});

test("shape presets only use the M3 corner scale and never carry colour", () => {
  const scale = new Set(["0px", "4px", "8px", "12px", "16px", "20px", "28px", "32px", "48px"]);
  for (const preset of Object.values(SHAPE_PRESETS)) {
    for (const value of Object.values(preset)) expect(scale.has(value!)).toBe(true);
  }
});

test("applyNativeTheme sets effects, scheme, skin, shape preset and a transparent root", async () => {
  const { win, calls } = fakeWindow();
  const { document, props } = fakeDoc();
  const applied = await applyNativeTheme("fluent", {
    window: win,
    platform: "windows",
    scheme: "dark",
    opaque: false,
    document,
  });
  expect(applied).toEqual({ theme: "fluent", platform: "windows", effects: ["mica"], native: true });
  expect(calls.map(c => c[0])).toEqual(["setTheme", "setEffects"]);
  expect(document.documentElement.dataset.skin).toBe("fluent");
  expect(props.background).toBe("transparent");
  expect(props["color-scheme"]).toBe("dark");
  expect(props["--md-sys-shape-corner-small"]).toBe("4px");
  expect(props["--md-sys-shape-corner-large"]).toBe("8px");

  await applyNativeTheme("m3", { window: win, platform: "windows", scheme: "dark", opaque: false, document });
  expect(document.documentElement.dataset.skin).toBe("m3");
  expect(props.background).toBeUndefined();
  expect(props["--md-sys-shape-corner-small"]).toBeUndefined();
});

test("reduced transparency, high contrast or forced colours force an opaque window", async () => {
  const { win, calls } = fakeWindow();
  const { document, props } = fakeDoc();
  const applied = await applyNativeTheme("apple", {
    window: win,
    platform: "macos",
    scheme: "light",
    opaque: true,
    document,
  });
  expect(applied.native).toBe(false);
  expect(calls.map(c => c[0])).toEqual(["setTheme", "clearEffects"]);
  expect(props.background).toBeUndefined();
});

test("pickTheme reads ?skin=, then storage, then the platform", () => {
  expect(pickTheme("?skin=apple", "fluent")).toBe("apple");
  expect(pickTheme("", "m3")).toBe("m3");
  expect(pickTheme("?skin=material3", null)).not.toBe("material3" as never);
});

test("detectPlatform reads the user agent", () => {
  expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
});
