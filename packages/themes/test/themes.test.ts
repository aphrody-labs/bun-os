import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { outputs } from "../src/build.ts";
import { apca, parseHex, wcag } from "../src/color.ts";
import { COLORS, META, SLOTS, THEME_IDS } from "../src/generated.ts";
import {
  applyTheme,
  bootScript,
  createThemeController,
  normalize,
  STORAGE_KEY,
  TAURI_EVENT,
} from "../src/runtime.ts";
import {
  EXPRESSIVE_SPRINGS,
  TYPE_BASE,
} from "../../m3-tokens/src/expressive.ts";

describe("generated outputs", () => {
  test("committed files are exactly what the generator produces", async () => {
    for (const [path, text] of Object.entries(await outputs())) {
      expect(await Bun.file(path).text(), path).toBe(text);
    }
  });

  test("css snapshot: apple dark default block and accent override", async () => {
    const css = (
      await Bun.file(import.meta.dir + "/../generated/themes.css").text()
    ).replaceAll("\r\n", "\n");
    const pick = (sel: string) =>
      css.slice(
        css.indexOf(sel + " {"),
        css.indexOf("}\n", css.indexOf(sel + " {")) + 2,
      );
    expect(pick('[data-theme="apple"][data-scheme="dark"]')).toMatchSnapshot();
    expect(
      pick(
        '[data-theme="fluent"]:not([data-scheme="dark"])[data-accent="orange"]',
      ),
    ).toMatchSnapshot();
    expect(pick('[data-theme="m3"]')).toMatchSnapshot();
  });

  test("rust snapshot: one palette", async () => {
    const rs = (
      await Bun.file(
        import.meta.dir + "/../../../crates/aphrody-themes/src/generated.rs",
      ).text()
    ).replaceAll("\r\n", "\n");
    const i = rs.indexOf("static FLUENT_DARK_BLUE");
    expect(rs.slice(i, rs.indexOf("};", i) + 2)).toMatchSnapshot();
  });

  test("every theme x scheme x accent defines every slot as a valid color", () => {
    for (const t of THEME_IDS)
      for (const s of ["light", "dark"] as const) {
        expect(Object.keys(COLORS[t][s]).sort()).toEqual(
          [...META[t].accents].sort(),
        );
        for (const [a, c] of Object.entries(COLORS[t][s]))
          for (const k of SLOTS)
            expect(() => parseHex(c[k]), `${t}/${s}/${a}/${k}`).not.toThrow();
      }
  });

  test("window effects name only tauri WindowEffect variants", async () => {
    const known = new Set([
      "mica",
      "micaDark",
      "micaLight",
      "tabbed",
      "tabbedDark",
      "tabbedLight",
      "blur",
      "acrylic",
      "liquidGlassRegular",
      "liquidGlassClear",
      "appearanceBased",
      "titlebar",
      "selection",
      "menu",
      "popover",
      "sidebar",
      "headerView",
      "sheet",
      "windowBackground",
      "hudWindow",
      "fullScreenUI",
      "tooltip",
      "contentBackground",
      "underWindowBackground",
      "underPageBackground",
    ]);
    const w = JSON.parse(
      await Bun.file(import.meta.dir + "/../generated/window-effects.json").text(),
    );
    for (const id of THEME_IDS)
      for (const os of ["windows", "macos", "other"])
        for (const e of w[id][os].effects)
          expect(known.has(e), `${id}/${os}/${e}`).toBe(true);
    expect(w.fluent.windows.effects).toEqual(["mica"]);
    expect(w.apple.macos.effects).toEqual([
      "liquidGlassRegular",
      "underWindowBackground",
    ]);
    expect(w.m3.windows.effects).toEqual([]);
  });
});

describe("vendor parity", () => {
  test("m3 type scale and springs mirror @aphrody/m3-tokens", () => {
    for (const [k, b] of Object.entries(TYPE_BASE))
      expect(META.m3.ramp[k]).toEqual({
        size: parseFloat(b.size) * 16,
        line: parseFloat(b.lineHeight) * 16,
        weight: b.weight,
      });
  });
  test("m3 springs and shape match m3-tokens", async () => {
    const t = JSON.parse(
      await Bun.file(
        import.meta.dir + "/../tokens/m3-googlebook.tokens.json",
      ).text(),
    );
    expect(t.motion.springs).toEqual(EXPRESSIVE_SPRINGS);
    const css = await Bun.file(
      import.meta.dir + "/../../m3-tokens/src/m3-tokens.css",
    ).text();
    for (const [k, name] of [
      ["sm", "small"],
      ["md", "medium"],
      ["lg", "large"],
      ["xl", "extra-large"],
    ] as const) {
      expect(css).toContain(
        `--md-sys-shape-corner-${name}: ${META.m3.shape[k]}px;`,
      );
    }
  });
  test("windows 11 default accent is the measured palette (light uses Dark1, dark uses Light2)", () => {
    expect(COLORS.fluent.light.blue!.accent).toBe("#0067C0");
    expect(COLORS.fluent.dark.blue!.accent).toBe("#4CC2FF");
  });
  test("apple blue is the HIG iOS 26+ system blue", () => {
    expect(COLORS.apple.light.blue!.accent).toBe("#0088FF");
    expect(COLORS.apple.dark.blue!.accent).toBe("#0091FF");
  });
  test("fluent tokens keep the 8px window and 4px control radii of Microsoft Learn", () => {
    expect(META.fluent.shape.control).toBe(4);
    expect(META.fluent.shape.container).toBe(8);
  });
});

// Floors are measured (see docs/THEMES.md); none of the vendor colors was changed to pass them.
describe("contrast (WCAG 2.x, APCA)", () => {
  const all = THEME_IDS.flatMap((t) =>
    (["light", "dark"] as const).flatMap((s) =>
      Object.entries(COLORS[t][s]).map(([a, c]) => ({ t, s, a, c })),
    ),
  );
  test("primary text on every background and surface: WCAG >= 7 and |APCA Lc| >= 75", () => {
    for (const { t, s, a, c } of all) {
      for (const bg of [c.bg, c.bgAlt, c.surface, c.surfaceRaised]) {
        expect(wcag(c.fg, bg), `${t}/${s}/${a} fg`).toBeGreaterThanOrEqual(7);
        expect(
          Math.abs(apca(c.fg, bg)),
          `${t}/${s}/${a} apca`,
        ).toBeGreaterThanOrEqual(75);
      }
    }
  });
  test("secondary text on bg >= 3 everywhere, >= 4.5 for m3 and fluent", () => {
    for (const { t, s, a, c } of all) {
      const r = wcag(c.fgMuted, c.bg);
      expect(r, `${t}/${s}/${a}`).toBeGreaterThanOrEqual(
        t === "apple" ? 3 : 4.5,
      );
    }
  });
  test("text on accent: m3 and fluent >= 4.5 on every accent", () => {
    for (const { t, s, a, c } of all)
      if (t !== "apple")
        expect(
          wcag(c.onAccent, c.accent),
          `${t}/${s}/${a}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
  test("apple text on accent: measured vendor colors, floor 1.4, blue >= 3.2 (HIG publishes an increased-contrast set for the rest)", () => {
    for (const { t, s, a, c } of all) {
      if (t !== "apple") continue;
      const r = wcag(c.onAccent, c.accent);
      expect(r, `${s}/${a}`).toBeGreaterThanOrEqual(1.4);
      if (a === "blue") expect(r).toBeGreaterThanOrEqual(3.2);
    }
  });
  test("accent against its background: >= 3 (WCAG 1.4.11) for m3 and fluent default accents", () => {
    for (const t of ["m3", "fluent"] as const)
      for (const s of ["light", "dark"] as const) {
        const c = COLORS[t][s][META[t].defaultAccent]!;
        expect(wcag(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
      }
  });
});

function env() {
  const win = new Window({ url: "https://shell.test/" });
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  let dark = false;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  return {
    win,
    root: win.document.documentElement as unknown as HTMLElement,
    storage,
    media,
    setDark(v: boolean) {
      dark = v;
      for (const f of listeners) f();
    },
    store,
  };
}

describe("runtime", () => {
  test("normalize rejects garbage and keeps a valid accent per theme", () => {
    expect(normalize({ theme: "nope", scheme: "x", accent: 3 })).toEqual({
      theme: "m3",
      scheme: "auto",
      accent: "purple",
      transparency: null,
    });
    expect(
      normalize({ theme: "apple", accent: "purple", transparency: 7 }),
    ).toMatchObject({ theme: "apple", accent: "purple", transparency: 1 });
    expect(normalize({ theme: "apple", accent: "teal" }).accent).toBe("blue");
  });

  test("applyTheme sets the data attributes, glass slider and theme-color", () => {
    const e = env();
    const scheme = applyTheme(
      { theme: "apple", scheme: "auto", accent: "pink", transparency: 0 },
      true,
      e.root,
    );
    expect(scheme).toBe("dark");
    expect(e.root.dataset.theme).toBe("apple");
    expect(e.root.dataset.scheme).toBe("dark");
    expect(e.root.dataset.accent).toBe("pink");
    expect(e.root.dataset.controls).toBe("traffic-lights");
    expect(e.root.style.getPropertyValue("--t-glass-opacity")).toBe("0.04");
    expect(
      e.win.document
        .querySelector('meta[name="theme-color"]')!
        .getAttribute("content"),
    ).toBe("#000000");
    applyTheme(
      { theme: "fluent", scheme: "light", accent: "blue", transparency: null },
      true,
      e.root,
    );
    expect(e.root.dataset.accent).toBeUndefined();
    expect(e.root.style.getPropertyValue("--t-glass-opacity")).toBe("");
    expect(e.root.dataset.controls).toBe("caption");
  });

  test("auto follows the system scheme live, explicit scheme does not", () => {
    const e = env();
    const c = createThemeController({
      root: e.root,
      storage: e.storage,
      media: e.media,
      tauri: null,
      channel: "t-auto",
    });
    expect(e.root.dataset.scheme).toBe("light");
    e.setDark(true);
    expect(e.root.dataset.scheme).toBe("dark");
    c.set({ scheme: "light" });
    e.setDark(false);
    e.setDark(true);
    expect(e.root.dataset.scheme).toBe("light");
    c.dispose();
  });

  test("selection persists and is restored", () => {
    const e = env();
    const a = createThemeController({
      root: e.root,
      storage: e.storage,
      media: e.media,
      tauri: null,
      channel: "t-persist",
    });
    a.set({ theme: "fluent", accent: "green", scheme: "dark" });
    a.dispose();
    expect(JSON.parse(e.store.get(STORAGE_KEY)!)).toEqual({
      theme: "fluent",
      scheme: "dark",
      accent: "green",
      transparency: null,
    });
    const e2 = env();
    e2.store.set(STORAGE_KEY, e.store.get(STORAGE_KEY)!);
    const b = createThemeController({
      root: e2.root,
      storage: e2.storage,
      media: e2.media,
      tauri: null,
      channel: "t-persist",
    });
    expect(e2.root.dataset.theme).toBe("fluent");
    expect(e2.root.dataset.accent).toBe("green");
    b.dispose();
  });

  test("BroadcastChannel: a change in one app re-themes another live", async () => {
    const shell = env(),
      app = env();
    const a = createThemeController({
      root: shell.root,
      storage: shell.storage,
      media: shell.media,
      tauri: null,
      channel: "t-sync",
    });
    const b = createThemeController({
      root: app.root,
      storage: app.storage,
      media: app.media,
      tauri: null,
      channel: "t-sync",
    });
    const seen = new Promise<void>((res) =>
      b.subscribe((s) => s.theme === "apple" && res()),
    );
    a.set({ theme: "apple", scheme: "dark", accent: "orange" });
    await Promise.race([
      seen,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("no broadcast within 2s")), 2000),
      ),
    ]);
    expect(app.root.dataset.theme).toBe("apple");
    expect(app.root.dataset.scheme).toBe("dark");
    expect(app.root.dataset.accent).toBe("orange");
    a.dispose();
    b.dispose();
  });

  test("Tauri bridge: set emits the event, an incoming event applies", () => {
    const e = env();
    const emitted: unknown[] = [];
    let cb: ((x: { payload: unknown }) => void) | undefined;
    const tauri = {
      emit: (ev: string, p: unknown) => void emitted.push([ev, p]),
      listen: (ev: string, f: (x: { payload: unknown }) => void) => {
        expect(ev).toBe(TAURI_EVENT);
        cb = f;
      },
    };
    const c = createThemeController({
      root: e.root,
      storage: e.storage,
      media: e.media,
      tauri,
      channel: "t-tauri",
    });
    c.set({ theme: "apple" });
    expect(emitted).toEqual([
      [
        TAURI_EVENT,
        {
          theme: "apple",
          scheme: "auto",
          accent: "purple",
          transparency: null,
        },
      ],
    ]);
    cb!({
      payload: {
        theme: "fluent",
        scheme: "dark",
        accent: "red",
        transparency: null,
      },
    });
    expect(e.root.dataset.theme).toBe("fluent");
    expect(e.root.dataset.accent).toBe("red");
    c.dispose();
  });

  test("boot script applies the stored theme before the controller exists", () => {
    const win = new Window({ url: "https://shell.test/" });
    win.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: "apple", scheme: "dark", accent: "green" }),
    );
    win.eval(bootScript());
    const d = win.document.documentElement;
    expect([
      d.dataset.theme,
      d.dataset.scheme,
      d.dataset.accent,
      d.dataset.controls,
    ]).toEqual(["apple", "dark", "green", "traffic-lights"]);
  });
});
