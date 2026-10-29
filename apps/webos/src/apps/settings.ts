// SPDX-License-Identifier: Apache-2.0
// Settings: every shell preference of prefs.ts, applied live. Sections have deep links (/settings/<section>),
// a search across every row, and export/import of the whole configuration as a JSON file. Controls bind to one
// preference each and follow changes made elsewhere (quick settings, another tab, an import).
import {
  schemeFromSeed,
  type SchemeVariant,
} from "@aphrody/m3-tokens/dynamic-color";
import { formatBytes, formatDate, formatTime, locale } from "../appearance";
import { h, icon } from "../dom";
import { bindingsOf, chordKbd, suspendKeys } from "../keys";
import { announce, notify, requestSystemNotifications } from "../notify";
import { HOME, webos } from "../os";
import {
  BAR_ITEMS,
  DEFAULT_WALLPAPER,
  FILE_TYPES,
  prefs,
  type BarItem,
  type BarZone,
  type ColorToken,
  type PrefKey,
  type PrefMap,
  type WallpaperSpec,
} from "../prefs";
import {
  ACTIONS,
  GROUPS,
  chordOf,
  chordLabel,
  familyOf,
  isModifierCode,
  validChord,
} from "../shortcuts";
import { playSound, type SoundName } from "../sounds";
import { SEEDS, THEMES } from "../themes";
import {
  WALLPAPER_DIR,
  forgetPicture,
  loadPicture,
  paintWallpaper,
} from "../wallpaper";

declare const __WEBOS_BUILD__: string | undefined;

export interface LaunchEntry {
  id: string;
  name: string;
  icon: string;
}

/** What Settings needs from the shell. */
export interface SettingsHost {
  /** Every launchable app (built-ins, installed packages, web apps), from the live catalog. */
  apps(): LaunchEntry[];
  appIcon(id: string, icon: string): HTMLElement;
  workspace(): number;
  /** Called with the section shown, for the /settings/<section> address. */
  onSection(id: SectionId): void;
  openShortcuts(): void;
}

export const SECTIONS = [
  { id: "appearance", name: "Appearance", glyph: "palette" },
  { id: "wallpaper", name: "Wallpaper", glyph: "wallpaper" },
  { id: "desktop", name: "Desktop and windows", glyph: "desktop_windows" },
  { id: "keyboard", name: "Keyboard", glyph: "keyboard" },
  { id: "region", name: "Language and region", glyph: "language" },
  { id: "accessibility", name: "Accessibility", glyph: "accessibility_new" },
  { id: "notifications", name: "Notifications", glyph: "notifications" },
  { id: "sound", name: "Sound", glyph: "volume_up" },
  { id: "privacy", name: "Privacy and storage", glyph: "shield" },
  { id: "about", name: "About", glyph: "info" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];
export const isSection = (s: string | undefined): s is SectionId =>
  SECTIONS.some((x) => x.id === s);

/** Material Symbols ligature. */
function sym(glyph: string) {
  const s = h("span", {
    class: "mi material-symbols-rounded",
    "aria-hidden": "true",
  });
  s.textContent = glyph;
  return s;
}

interface Acc<T> {
  get(): T;
  set(v: T): void;
  /** Preferences whose change re-syncs the control. */
  watch: PrefKey[];
}
const acc = <K extends PrefKey>(key: K): Acc<PrefMap[K]> => ({
  get: () => prefs.get(key),
  set: (v) => prefs.set(key, v),
  watch: [key],
});
/** One field of an object-valued preference. */
function fieldOf<K extends PrefKey, F extends keyof PrefMap[K]>(
  key: K,
  field: F,
): Acc<PrefMap[K][F]> {
  return {
    get: () => prefs.get(key)[field],
    set: (v) =>
      prefs.set(key, {
        ...(prefs.get(key) as object),
        [field]: v,
      } as unknown as PrefMap[K]),
    watch: [key],
  };
}

/** A searchable setting row. */
interface Row {
  label: string;
  keywords: string;
  el: HTMLElement;
}

const ROLE_TOKENS = [
  "primary",
  "secondary",
  "tertiary",
  "primary-container",
  "secondary-container",
  "tertiary-container",
  "surface",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "inverse-surface",
  "error",
];
const roleName = (t: string) =>
  t[0]!.toUpperCase() + t.slice(1).replaceAll("-", " ");

const VARIANTS: [SchemeVariant, string][] = [
  ["tonalSpot", "Tonal spot"],
  ["vibrant", "Vibrant"],
  ["expressive", "Expressive"],
  ["fidelity", "Fidelity"],
  ["content", "Content"],
  ["neutral", "Neutral"],
  ["monochrome", "Monochrome"],
];

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;

export function settingsApp(
  root: HTMLElement,
  host: SettingsHost,
  start: SectionId = "appearance",
) {
  let disposers: (() => void)[] = [];
  const dispose = () => {
    for (const d of disposers) d();
    disposers = [];
  };
  /** Re-run `sync` whenever one of the watched preferences changes while the control is shown. */
  const watch = (keys: PrefKey[], sync: () => void) => {
    for (const k of keys) disposers.push(prefs.subscribe(k, sync));
    sync();
  };

  // Controls --------------------------------------------------------------------------------------
  const switchCtl = (
    a: Acc<boolean>,
    label: string,
    onChange?: (on: boolean) => void,
  ) => {
    const b = h(
      "button",
      { class: "sw", role: "switch", "aria-label": label },
      h("span", { class: "switch" }),
    );
    b.addEventListener("click", () => {
      a.set(!a.get());
      onChange?.(a.get());
    });
    watch(a.watch, () => b.setAttribute("aria-checked", String(a.get())));
    return b;
  };
  const textCtl = (a: Acc<string>, label: string, opts: { password?: boolean; placeholder?: string } = {}) => {
    const input = h("input", {
      class: "fld",
      type: opts.password ? "password" : "text",
      "aria-label": label,
      placeholder: opts.placeholder,
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    input.addEventListener("change", () => a.set(input.value.trim()));
    watch(a.watch, () => {
      if (document.activeElement !== input) input.value = a.get();
    });
    return input;
  };
  const segCtl = <T extends string>(
    a: Acc<T>,
    label: string,
    options: [T, string, string?][],
  ) => {
    const g = h("div", {
      class: "seg",
      role: "radiogroup",
      "aria-label": label,
    });
    const buttons = options.map(([v, text, glyph]) =>
      h(
        "button",
        { class: "segb", role: "radio", onclick: () => a.set(v) },
        glyph ? sym(glyph) : null,
        text,
      ),
    );
    g.append(...buttons);
    g.addEventListener("keydown", (e) => {
      const i = options.findIndex(([v]) => v === a.get());
      const step =
        e.key === "ArrowRight" || e.key === "ArrowDown"
          ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowUp"
            ? -1
            : 0;
      if (!step) return;
      e.preventDefault();
      const next = (i + step + options.length) % options.length;
      a.set(options[next]![0]);
      buttons[next]!.focus();
    });
    watch(a.watch, () =>
      buttons.forEach((b, i) => {
        const on = options[i]![0] === a.get();
        b.setAttribute("aria-checked", String(on));
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      }),
    );
    return g;
  };
  const selectCtl = <T extends string>(
    a: Acc<T>,
    label: string,
    options: [T, string][],
  ) => {
    const s = h("select", {
      class: "sselect",
      "aria-label": label,
    }) as HTMLSelectElement;
    s.append(...options.map(([v, text]) => h("option", { value: v }, text)));
    s.addEventListener("change", () => a.set(s.value as T));
    watch(a.watch, () => (s.value = a.get()));
    return s;
  };
  const rangeCtl = (
    a: Acc<number>,
    label: string,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
  ) => {
    const input = h("input", {
      type: "range",
      min,
      max,
      step,
      "aria-label": label,
    }) as HTMLInputElement;
    const out = h("output", { class: "srange-out" });
    input.addEventListener("input", () => {
      a.set(Number(input.value));
      out.textContent = fmt(Number(input.value));
    });
    watch(a.watch, () => {
      input.value = String(a.get());
      out.textContent = fmt(a.get());
      input.setAttribute("aria-valuetext", fmt(a.get()));
    });
    return h("div", { class: "srange" }, input, out);
  };
  const colorCtl = (a: Acc<string>, label: string) => {
    const input = h("input", {
      type: "color",
      class: "scolor",
      "aria-label": label,
    }) as HTMLInputElement;
    input.addEventListener("input", () => a.set(input.value));
    watch(a.watch, () => (input.value = a.get()));
    return input;
  };
  /** An M3 role or a custom colour. */
  const tokenCtl = (a: Acc<ColorToken>, label: string) => {
    const s = h("select", {
      class: "sselect",
      "aria-label": label,
    }) as HTMLSelectElement;
    s.append(
      ...ROLE_TOKENS.map((t) => h("option", { value: t }, roleName(t))),
      h("option", { value: "#" }, "Custom colour"),
    );
    const pick = h("input", {
      type: "color",
      class: "scolor",
      "aria-label": `${label}, custom colour`,
    }) as HTMLInputElement;
    const chip = h("span", { class: "stoken-chip", "aria-hidden": "true" });
    s.addEventListener("change", () =>
      a.set(s.value === "#" ? pick.value : s.value),
    );
    pick.addEventListener("input", () => a.set(pick.value));
    watch(a.watch, () => {
      const v = a.get();
      const custom = v.startsWith("#");
      s.value = custom ? "#" : v;
      pick.hidden = !custom;
      if (custom) pick.value = v;
      chip.style.background = custom ? v : `var(--md-sys-color-${v})`;
    });
    return h("span", { class: "stoken" }, chip, s, pick);
  };
  const button = (label: string, onclick: () => void, tonal = true) =>
    h("button", { class: tonal ? "btn tonal" : "btn", onclick }, label);

  // Rows ------------------------------------------------------------------------------------------
  let rows: Row[] = [];
  const row = (
    label: string,
    hint: string | null,
    control: HTMLElement | null,
    keywords = "",
  ) => {
    const el = h(
      "div",
      { class: "srow" },
      h(
        "div",
        { class: "srow-text" },
        h("strong", {}, label),
        hint ? h("span", { class: "muted" }, hint) : null,
      ),
      control ? h("div", { class: "srow-ctl" }, control) : null,
    );
    rows.push({
      label,
      keywords: `${label} ${hint ?? ""} ${keywords}`.toLowerCase(),
      el,
    });
    return el;
  };
  /** A full-width block (theme cards, lists) that still takes part in search. */
  const block = (label: string, content: HTMLElement, keywords = "") => {
    const el = h("div", { class: "sblock" }, content);
    rows.push({ label, keywords: `${label} ${keywords}`.toLowerCase(), el });
    return el;
  };
  const group = (title: string, ...children: (HTMLElement | null)[]) =>
    h("section", { class: "sgroup" }, h("h3", {}, title), ...children);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Appearance ------------------------------------------------------------------------------------
  function appearance(): HTMLElement[] {
    const themeId = acc("theme.id");
    const card = (
      id: string,
      name: string,
      mood: string,
      preview: [string, string, string, string],
    ) => {
      const [bg, surface, a, b] = preview;
      const el = h(
        "button",
        { class: "theme-card", role: "radio", onclick: () => themeId.set(id) },
        h(
          "span",
          {
            class: "theme-preview",
            style: `--a:${a};--b:${b};--bg:${bg};--s:${surface}`,
            "aria-hidden": "true",
          },
          h("span", { class: "tp-bar" }),
          h("span", { class: "tp-win" }),
          h("span", { class: "tp-win two" }),
        ),
        h("span", { class: "theme-name" }, name),
        h("span", { class: "theme-mood" }, mood),
      );
      watch(["theme.id"], () =>
        el.setAttribute("aria-checked", String(themeId.get() === id)),
      );
      return el;
    };
    /** Preview colours of a seed scheme, in the current light or dark mode. */
    const seedPreview = (
      seed: string,
      variant: SchemeVariant,
    ): [string, string, string, string] => {
      const dark =
        document.documentElement.dataset.theme === "dark" ||
        (!document.documentElement.dataset.theme &&
          matchMedia("(prefers-color-scheme: dark)").matches);
      const r = schemeFromSeed(seed, { dark, variant });
      const role = (n: string) => r[`--md-sys-color-${n}`] ?? seed;
      return [
        role("surface"),
        role("surface-container-highest"),
        role("primary"),
        role("tertiary"),
      ];
    };
    const cards = h("div", {
      class: "theme-cards",
      role: "radiogroup",
      "aria-label": "Theme",
    });
    watch(["theme.custom", "theme.seed", "theme.variant", "theme.mode"], () =>
      cards.replaceChildren(
        ...THEMES.map((t) => card(t.id, t.name, t.mood, t.preview)),
        card(
          "seed",
          "Your colour",
          "Material You from the colour below",
          seedPreview(prefs.get("theme.seed"), prefs.get("theme.variant")),
        ),
        ...prefs
          .get("theme.custom")
          .map((t) =>
            card(
              `custom:${t.id}`,
              t.name,
              "Saved theme",
              seedPreview(t.seed, t.variant),
            ),
          ),
      ),
    );

    const seedAcc: Acc<string> = {
      get: () => prefs.get("theme.seed"),
      set: (v) =>
        prefs.setMany([
          ["theme.seed", v],
          ["theme.id", "seed"],
        ]),
      watch: ["theme.seed"],
    };
    const hexField = h("input", {
      class: "fld shex",
      "aria-label": "Seed colour, hex",
      spellcheck: "false",
      maxlength: 7,
    }) as HTMLInputElement;
    hexField.addEventListener("change", () => {
      const v = hexField.value.trim();
      if (/^#?[\da-f]{6}$/i.test(v))
        seedAcc.set((v.startsWith("#") ? v : `#${v}`).toLowerCase());
      else hexField.value = prefs.get("theme.seed");
    });
    watch(["theme.seed"], () => (hexField.value = prefs.get("theme.seed")));
    const swatches = h(
      "div",
      { class: "swatches" },
      ...SEEDS.map(([name, hex]) => {
        const b = h("button", {
          class: "swatch",
          "aria-label": name,
          "data-tip": name,
          style: `background:${hex}`,
          onclick: () => seedAcc.set(hex),
        });
        watch(["theme.seed", "theme.id"], () =>
          b.setAttribute(
            "aria-pressed",
            String(
              prefs.get("theme.id") === "seed" &&
                prefs.get("theme.seed") === hex,
            ),
          ),
        );
        return b;
      }),
    );

    const custom = h("div", { class: "slist" });
    watch(["theme.custom", "theme.id"], () =>
      custom.replaceChildren(
        ...prefs.get("theme.custom").map((t) =>
          h(
            "div",
            { class: "slist-item" },
            h("span", {
              class: "stoken-chip",
              style: `background:${t.seed}`,
              "aria-hidden": "true",
            }),
            h("span", { class: "grow" }, t.name),
            h(
              "span",
              { class: "muted" },
              VARIANTS.find(([v]) => v === t.variant)?.[1] ?? t.variant,
            ),
            h(
              "button",
              {
                class: "tbtn",
                "aria-label": `Delete theme ${t.name}`,
                "data-tip": "Delete",
                onclick: () => {
                  const next = prefs
                    .get("theme.custom")
                    .filter((x) => x.id !== t.id);
                  prefs.setMany([
                    ["theme.custom", next],
                    ...(prefs.get("theme.id") === `custom:${t.id}`
                      ? ([["theme.id", "seed"]] as [PrefKey, unknown][])
                      : []),
                  ]);
                },
              },
              icon("trash"),
            ),
          ),
        ),
      ),
    );
    const nameField = h("input", {
      class: "fld",
      placeholder: "Theme name",
      "aria-label": "New theme name",
      maxlength: 60,
    }) as HTMLInputElement;
    const save = button("Save current colours", () => {
      const name =
        nameField.value.trim() ||
        `Theme ${prefs.get("theme.custom").length + 1}`;
      const id = crypto.randomUUID().slice(0, 8);
      prefs.setMany([
        [
          "theme.custom",
          [
            ...prefs.get("theme.custom"),
            {
              id,
              name,
              seed: prefs.get("theme.seed"),
              variant: prefs.get("theme.variant"),
              contrast: prefs.get("theme.contrast"),
            },
          ],
        ],
        ["theme.id", `custom:${id}`],
      ]);
      nameField.value = "";
      announce(`Theme ${name} saved`);
    });

    const contrastFmt = (v: number) =>
      v <= -0.5
        ? "Reduced"
        : v < 0.25
          ? "Standard"
          : v < 0.75
            ? "Medium"
            : "High";
    return [
      group(
        "Theme",
        block(
          "Theme",
          cards,
          "colour scheme omarchy night mocha campfire rose custom",
        ),
        row(
          "Mode",
          "Light, dark, or follow the system",
          segCtl(acc("theme.mode"), "Mode", [
            ["auto", "Automatic", "brightness_auto"],
            ["light", "Light", "light_mode"],
            ["dark", "Dark", "dark_mode"],
          ]),
          "dark light auto night",
        ),
      ),
      group(
        "Your colour",
        row(
          "Seed colour",
          "Material You builds every role from this colour",
          h(
            "span",
            { class: "sinline" },
            colorCtl(seedAcc, "Seed colour"),
            hexField,
          ),
          "dynamic color seed picker hex",
        ),
        block("Preset colours", swatches, "seed presets swatches"),
        row(
          "Scheme style",
          "How far the palette strays from the seed",
          selectCtl(acc("theme.variant"), "Scheme style", VARIANTS),
          "variant tonal vibrant expressive",
        ),
        row(
          "Contrast",
          "Applies to every theme",
          rangeCtl(acc("theme.contrast"), "Contrast", -1, 1, 0.25, contrastFmt),
          "contrast level",
        ),
        row(
          "Save as a theme",
          "Keep these colours as one of your themes",
          h("span", { class: "sinline" }, nameField, save),
          "custom theme save",
        ),
        block("Saved themes", custom, "custom themes delete"),
      ),
      group(
        "Text and shape",
        row(
          "Font",
          "Google Sans Flex, Roboto Flex or a monospace face",
          selectCtl(acc("type.family"), "Font", [
            ["google-sans-flex", "Google Sans Flex"],
            ["roboto-flex", "Roboto Flex"],
            ["google-sans-code", "Google Sans Code (mono)"],
            ["roboto-mono", "Roboto Mono"],
            ["system", "System font"],
          ]),
          "typeface typography",
        ),
        row(
          "Text size",
          null,
          rangeCtl(acc("type.scale"), "Text size", 0.8, 1.4, 0.05, pct),
          "font size scale zoom",
        ),
        row(
          "Corner radius",
          "From square to very round",
          rangeCtl(acc("shape.radius"), "Corner radius", 0, 2, 0.1, pct),
          "rounded corners shape",
        ),
        row(
          "Density",
          "Spacing and control size",
          segCtl(acc("layout.density"), "Density", [
            ["compact", "Compact"],
            ["standard", "Standard"],
            ["comfortable", "Comfortable"],
          ]),
          "spacing padding",
        ),
      ),
      group(
        "Effects",
        row(
          "Motion",
          "Animations of windows, menus and themes",
          segCtl(acc("motion.mode"), "Motion", [
            ["system", "System"],
            ["reduced", "Reduced"],
            ["normal", "Normal"],
          ]),
          "animation reduce motion",
        ),
        row(
          "Transparency",
          "Bar, dock and panels",
          rangeCtl(
            acc("surface.transparency"),
            "Transparency",
            0,
            0.8,
            0.02,
            pct,
          ),
          "glass translucent opacity",
        ),
        row(
          "Blur",
          "Behind translucent surfaces",
          rangeCtl(acc("surface.blur"), "Blur", 0, 48, 1, (v) => `${v} px`),
          "backdrop blur glass",
        ),
      ),
    ];
  }

  // Wallpaper -------------------------------------------------------------------------------------
  let wpTarget = 0; // 0: every workspace, n: workspace n
  function wallpaper(): HTMLElement[] {
    const spec = (): WallpaperSpec =>
      (wpTarget && prefs.get("wallpaper.workspaces")[wpTarget]) ||
      prefs.get("wallpaper.default");
    const setSpec = (next: WallpaperSpec) => {
      if (!wpTarget) prefs.set("wallpaper.default", next);
      else
        prefs.set("wallpaper.workspaces", {
          ...prefs.get("wallpaper.workspaces"),
          [wpTarget]: next,
        });
    };
    const keys: PrefKey[] = ["wallpaper.default", "wallpaper.workspaces"];
    const f = <F extends keyof WallpaperSpec>(
      field: F,
    ): Acc<WallpaperSpec[F]> => ({
      get: () => spec()[field],
      set: (v) => setSpec({ ...spec(), [field]: v }),
      watch: keys,
    });
    const at = <T>(field: "glows" | "gradient", i: number): Acc<T> => ({
      get: () => spec()[field][i] as T,
      set: (v) => {
        const list = [...spec()[field]];
        list[i] = v as string;
        setSpec({ ...spec(), [field]: list });
      },
      watch: keys,
    });

    const target = h("select", {
      class: "sselect",
      "aria-label": "Wallpaper applies to",
    }) as HTMLSelectElement;
    const fillTargets = () =>
      target.replaceChildren(
        h("option", { value: "0" }, "Every workspace"),
        ...Array.from({ length: prefs.get("workspaces.count") }, (_, i) =>
          h(
            "option",
            { value: String(i + 1) },
            `Workspace ${i + 1}${i + 1 === host.workspace() ? ", current" : ""}${prefs.get("wallpaper.workspaces")[i + 1] ? " (own wallpaper)" : ""}`,
          ),
        ),
      );
    const useDefault = button("Use the default here", () => {
      const next = { ...prefs.get("wallpaper.workspaces") };
      delete next[wpTarget];
      prefs.set("wallpaper.workspaces", next);
    });
    target.addEventListener("change", () => {
      wpTarget = Number(target.value);
      render();
    });
    watch(["workspaces.count", "wallpaper.workspaces"], () => {
      fillTargets();
      target.value = String(wpTarget);
      useDefault.hidden =
        !wpTarget || !prefs.get("wallpaper.workspaces")[wpTarget];
    });

    const preview = h("canvas", {
      class: "wp-preview",
      "aria-label": "Wallpaper preview",
      role: "img",
    }) as HTMLCanvasElement;
    let previewGen = 0;
    const drawPreview = () => {
      const mine = ++previewGen;
      const s = spec();
      void (
        s.kind === "image" && s.image
          ? loadPicture(s.image)
          : Promise.resolve(undefined)
      ).then((bitmap) => {
        if (mine === previewGen && preview.isConnected)
          paintWallpaper(
            preview,
            s.kind === "image" && !bitmap ? { ...s, kind: "contour" } : s,
            bitmap,
          );
      });
    };
    watch(
      [
        ...keys,
        "theme.id",
        "theme.seed",
        "theme.mode",
        "theme.variant",
        "theme.contrast",
      ],
      () => requestAnimationFrame(drawPreview),
    );

    const kind = spec().kind;
    const seedField = h("input", {
      class: "fld snum",
      type: "number",
      min: 0,
      max: 4294967295,
      "aria-label": "Terrain seed",
    }) as HTMLInputElement;
    seedField.addEventListener("change", () =>
      f("seed").set(Math.abs(Math.round(Number(seedField.value) || 0)) >>> 0),
    );
    watch(keys, () => (seedField.value = String(spec().seed)));

    const pictureList = h("select", {
      class: "sselect",
      "aria-label": "Picture",
    }) as HTMLSelectElement;
    const pictureStatus = h("span", { class: "muted" });
    const scanPictures = async () => {
      const os = await webos();
      const found: string[] = [];
      const walk = (dir: string, depth: number) => {
        let entries: { name: string; kind: string }[];
        try {
          entries = JSON.parse(os.fs.list(dir)) as {
            name: string;
            kind: string;
          }[];
        } catch {
          // An unreadable folder is skipped.
          return;
        }
        for (const e of entries) {
          const p = `${dir}/${e.name}`;
          if (e.kind === "dir" && depth < 4 && !e.name.startsWith("."))
            walk(p, depth + 1);
          else if (e.kind === "file" && IMAGE_EXT.test(e.name)) found.push(p);
        }
      };
      walk(HOME, 0);
      const current = spec().image;
      if (current && !found.includes(current)) found.unshift(current);
      pictureList.replaceChildren(
        h(
          "option",
          { value: "" },
          found.length ? "Choose a picture" : "No pictures in your files yet",
        ),
        ...found.map((p) =>
          h("option", { value: p }, p.replace(`${HOME}/`, "")),
        ),
      );
      pictureList.value = current;
    };
    pictureList.addEventListener("change", () => {
      if (pictureList.value)
        setSpec({ ...spec(), kind: "image", image: pictureList.value });
    });
    const upload = h("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
    }) as HTMLInputElement;
    upload.addEventListener("change", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      pictureStatus.textContent = "Saving the picture to your files…";
      const os = await webos();
      for (const dir of [`${HOME}/Pictures`, WALLPAPER_DIR])
        try {
          os.fs.stat(dir);
        } catch {
          os.fs.mkdir(dir);
        }
      const path = `${WALLPAPER_DIR}/${file.name.replace(/[/\\]/g, "_")}`;
      os.fs.write(path, new Uint8Array(await file.arrayBuffer()));
      await os.flush();
      forgetPicture(path);
      pictureStatus.textContent = `Saved as ${path.replace(`${HOME}/`, "")}`;
      setSpec({ ...spec(), kind: "image", image: path });
      void scanPictures();
    });

    const kindRows: Record<WallpaperSpec["kind"], HTMLElement[]> = {
      contour: [
        row(
          "Terrain",
          "Each number draws a different landscape",
          h(
            "span",
            { class: "sinline" },
            seedField,
            button("Shuffle", () =>
              f("seed").set(Math.floor(Math.random() * 0xffffffff)),
            ),
          ),
          "seed random generate",
        ),
        row(
          "Line density",
          "Contour lines across the height range",
          rangeCtl(f("levels"), "Line density", 4, 64, 1, (v) => `${v} lines`),
          "levels contour",
        ),
        row(
          "First glow",
          null,
          tokenCtl(at("glows", 0), "First glow colour"),
          "colour",
        ),
        row(
          "Second glow",
          null,
          tokenCtl(at("glows", 1), "Second glow colour"),
          "colour",
        ),
        row(
          "Third glow",
          null,
          tokenCtl(at("glows", 2), "Third glow colour"),
          "colour",
        ),
        row(
          "Lines",
          null,
          tokenCtl(f("lines"), "Line colour"),
          "colour contour",
        ),
      ],
      solid: [
        row(
          "Colour",
          null,
          tokenCtl(f("solid"), "Wallpaper colour"),
          "solid fill",
        ),
      ],
      gradient: [
        row(
          "From",
          null,
          tokenCtl(at("gradient", 0), "Gradient start colour"),
          "gradient",
        ),
        row(
          "To",
          null,
          tokenCtl(at("gradient", 1), "Gradient end colour"),
          "gradient",
        ),
        row(
          "Angle",
          null,
          rangeCtl(f("angle"), "Gradient angle", 0, 360, 5, (v) => `${v}°`),
          "direction",
        ),
      ],
      image: [
        row(
          "Picture",
          "Any picture in your files (OPFS)",
          h(
            "span",
            { class: "sinline" },
            pictureList,
            button("Upload…", () => upload.click()),
            upload,
          ),
          "image photo upload file",
        ),
        block("Picture status", pictureStatus),
        row(
          "Fit",
          null,
          segCtl(f("fit"), "Fit", [
            ["cover", "Fill"],
            ["contain", "Fit"],
          ]),
          "cover contain",
        ),
        row(
          "Dim",
          "Darken the picture for legible windows",
          rangeCtl(f("dim"), "Dim", 0, 0.7, 0.05, pct),
          "darken overlay",
        ),
      ],
    };
    if (kind === "image") void scanPictures();
    const kindAcc: Acc<WallpaperSpec["kind"]> = {
      get: () => spec().kind,
      set: (v) => {
        setSpec({ ...spec(), kind: v });
        render();
      },
      watch: keys,
    };
    return [
      group(
        "Wallpaper",
        block("Preview", h("div", { class: "wp-stage" }, preview)),
        row(
          "Applies to",
          "Give a workspace its own wallpaper",
          h("span", { class: "sinline" }, target, useDefault),
          "per workspace",
        ),
        row(
          "Style",
          null,
          segCtl(kindAcc, "Wallpaper style", [
            ["contour", "Contour map", "landscape"],
            ["solid", "Solid", "format_color_fill"],
            ["gradient", "Gradient", "gradient"],
            ["image", "Picture", "image"],
          ]),
          "kind type",
        ),
        ...kindRows[kind],
        row(
          "Restore",
          null,
          button("Default wallpaper", () => setSpec({ ...DEFAULT_WALLPAPER })),
          "reset",
        ),
      ),
    ];
  }

  // Desktop ---------------------------------------------------------------------------------------
  /** Ordered app picker for the dock and the desktop icons. */
  const appList = (key: "dock.pinned" | "desktop.apps", label: string) => {
    const list = h("div", { class: "slist" });
    const add = h("select", {
      class: "sselect",
      "aria-label": `Add an app to ${label}`,
    }) as HTMLSelectElement;
    add.addEventListener("change", () => {
      if (add.value) prefs.set(key, [...prefs.get(key), add.value]);
    });
    watch([key], () => {
      const apps = host.apps();
      const ids = prefs.get(key);
      const byId = new Map(apps.map((a) => [a.id, a]));
      const move = (i: number, d: number) => {
        const next = [...ids];
        [next[i], next[i + d]] = [next[i + d]!, next[i]!];
        prefs.set(key, next);
      };
      list.replaceChildren(
        ...ids.map((id, i) => {
          const app = byId.get(id);
          return h(
            "div",
            { class: "slist-item" },
            host.appIcon(id, app?.icon ?? "app"),
            h("span", { class: "grow" }, app?.name ?? `${id} (not installed)`),
            h(
              "button",
              {
                class: "tbtn",
                "aria-label": `Move ${app?.name ?? id} up`,
                disabled: i === 0,
                onclick: () => move(i, -1),
              },
              sym("arrow_upward"),
            ),
            h(
              "button",
              {
                class: "tbtn",
                "aria-label": `Move ${app?.name ?? id} down`,
                disabled: i === ids.length - 1,
                onclick: () => move(i, 1),
              },
              sym("arrow_downward"),
            ),
            h(
              "button",
              {
                class: "tbtn",
                "aria-label": `Remove ${app?.name ?? id}`,
                onclick: () =>
                  prefs.set(
                    key,
                    ids.filter((x) => x !== id),
                  ),
              },
              icon("close"),
            ),
          );
        }),
      );
      add.replaceChildren(
        h("option", { value: "" }, "Add an app…"),
        ...apps
          .filter((a) => !ids.includes(a.id))
          .map((a) => h("option", { value: a.id }, a.name)),
      );
      add.value = "";
    });
    return h("div", { class: "sapps" }, list, add);
  };

  function desktop(): HTMLElement[] {
    const zones: [BarZone, string][] = [
      ["left", "Left"],
      ["center", "Centre"],
      ["right", "Right"],
      ["hidden", "Hidden"],
    ];
    const ITEM_NAMES: Record<BarItem, string> = {
      launcher: "Launcher button",
      workspaces: "Workspaces",
      active: "Active window name",
      clock: "Clock",
      layout: "Layout button",
      search: "Search button",
      status: "Status and quick settings",
      settings: "Settings button",
    };
    const apps = host.apps();
    const appOptions: [string, string][] = [
      ["editor", "Text editor"],
      ...apps.map((a) => [a.id, a.name] as [string, string]),
    ];
    return [
      group(
        "Top bar",
        row(
          "Position",
          null,
          segCtl(acc("bar.position"), "Bar position", [
            ["top", "Top"],
            ["bottom", "Bottom"],
          ]),
          "panel waybar",
        ),
        ...BAR_ITEMS.map((item) =>
          row(
            ITEM_NAMES[item],
            null,
            selectCtl(
              fieldOf("bar.items", item),
              `${ITEM_NAMES[item]} position`,
              zones,
            ),
            "bar contents item",
          ),
        ),
      ),
      group(
        "Clock",
        row(
          "Hour format",
          null,
          segCtl(acc("clock.hourCycle"), "Hour format", [
            ["auto", "Region"],
            ["h12", "12-hour"],
            ["h23", "24-hour"],
          ]),
          "time 12 24",
        ),
        row(
          "Show seconds",
          null,
          switchCtl(acc("clock.seconds"), "Show seconds"),
          "time",
        ),
        row(
          "Date in the bar",
          null,
          segCtl(acc("clock.date"), "Date in the bar", [
            ["none", "None"],
            ["short", "Short"],
            ["long", "Long"],
          ]),
          "day month",
        ),
      ),
      group(
        "Dock",
        row(
          "Position",
          null,
          segCtl(acc("dock.position"), "Dock position", [
            ["bottom", "Bottom"],
            ["left", "Left"],
            ["right", "Right"],
          ]),
          "taskbar",
        ),
        row(
          "Icon size",
          null,
          rangeCtl(
            acc("dock.size"),
            "Dock icon size",
            32,
            72,
            2,
            (v) => `${v} px`,
          ),
          "dock size",
        ),
        row(
          "Hide automatically",
          "Shows when the pointer reaches the edge",
          switchCtl(acc("dock.autohide"), "Hide the dock automatically"),
          "autohide",
        ),
        block(
          "Pinned apps",
          h(
            "div",
            {},
            h("strong", { class: "slabel" }, "Pinned apps"),
            appList("dock.pinned", "the dock"),
          ),
          "dock pinned favourites",
        ),
      ),
      group(
        "Desktop",
        row(
          "Desktop icons",
          "App shortcuts on the desktop",
          switchCtl(acc("desktop.icons"), "Desktop icons"),
          "icons shortcuts",
        ),
        block(
          "Desktop apps",
          h(
            "div",
            {},
            h("strong", { class: "slabel" }, "Apps on the desktop"),
            appList("desktop.apps", "the desktop"),
          ),
          "desktop icons apps",
        ),
        row(
          "Workspaces",
          null,
          rangeCtl(
            acc("workspaces.count"),
            "Number of workspaces",
            1,
            10,
            1,
            (v) => String(v),
          ),
          "virtual desktops count",
        ),
      ),
      group(
        "Assistant",
        row(
          "Shake to ask",
          "Wiggle the pointer to open the assistant",
          switchCtl(acc("assistant.enabled"), "Shake to ask"),
          "assistant ai ask shake wiggle",
        ),
        row(
          "Model",
          "Local llama.cpp server, or a hosted API with your own key",
          segCtl(acc("assistant.backend"), "Assistant backend", [
            ["llama", "Local", "memory"],
            ["hosted", "Hosted", "cloud"],
          ]),
          "assistant model llama.cpp local hosted api",
        ),
        row(
          "API URL",
          "OpenAI-compatible root, e.g. http://127.0.0.1:8080/v1",
          textCtl(acc("assistant.baseUrl"), "Assistant API URL"),
          "assistant url endpoint",
        ),
        row(
          "Model name",
          "Sent with every request",
          textCtl(acc("assistant.model"), "Assistant model name"),
          "assistant model name",
        ),
        row(
          "API key",
          "Only for a hosted API; stored in this browser, never sent anywhere else",
          textCtl(acc("assistant.apiKey"), "Assistant API key", { password: true }),
          "assistant api key token",
        ),
      ),
      group(
        "Windows",
        row(
          "Default layout",
          "For workspaces you have not changed",
          segCtl(acc("windows.tiling"), "Default layout", [
            ["dwindle", "Tiled", "dashboard"],
            ["master", "Master", "vertical_split"],
            ["scrolling", "Columns", "view_column"],
            ["floating", "Floating", "filter_none"],
          ]),
          "tiling dwindle master scrolling",
        ),
        row(
          "Gaps",
          "Between tiled windows",
          rangeCtl(
            acc("windows.gap"),
            "Window gaps",
            0,
            32,
            1,
            (v) => `${v} px`,
          ),
          "spacing gap",
        ),
        row(
          "Borders",
          "Accent border of windows",
          rangeCtl(
            acc("windows.border"),
            "Window border width",
            0,
            6,
            1,
            (v) => (v ? `${v} px` : "None"),
          ),
          "outline border",
        ),
      ),
      group(
        "Default apps",
        ...FILE_TYPES.map((t) =>
          row(
            t.label,
            t.exts.slice(0, 6).join(", "),
            selectCtl(
              fieldOf("files.openWith", t.id),
              `Open ${t.label} with`,
              appOptions,
            ),
            "file types open with default",
          ),
        ),
      ),
    ];
  }

  // Keyboard --------------------------------------------------------------------------------------
  let recordingStop: (() => void) | undefined;
  function keyboard(): HTMLElement[] {
    disposers.push(() => recordingStop?.());
    const status = h("p", { class: "muted", role: "status" });
    const setBindings = (id: string, chords: string[]) => {
      const all = { ...prefs.get("keys.bindings") };
      const action = ACTIONS.find((a) => a.id === id)!;
      if (JSON.stringify(chords) === JSON.stringify(action.keys))
        delete all[id];
      else all[id] = chords;
      prefs.set("keys.bindings", all);
    };
    const record = (id: string, append: boolean, chip: HTMLElement) => {
      recordingStop?.();
      const action = ACTIONS.find((a) => a.id === id)!;
      chip.classList.add("recording");
      status.textContent = action.family
        ? `Press the modifiers with any ${action.family === "Digit" ? "digit" : "arrow"} for “${action.label}”. Esc cancels.`
        : `Press the new shortcut for “${action.label}”. Esc cancels.`;
      suspendKeys(true);
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isModifierCode(e.code)) return;
        if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey)
          return stop("Cancelled.");
        let chord: string;
        if (action.family) {
          const fam = familyOf(e.code);
          if (fam?.family !== action.family)
            return void (status.textContent = `Use a ${action.family === "Digit" ? "digit" : "arrow"} key with the modifiers.`);
          chord = chordOf(e, action.family);
        } else chord = chordOf(e);
        if (!validChord(chord))
          return void (status.textContent = `${chordLabel(chord)} needs Ctrl, Alt or Meta, so typing never triggers it.`);
        // A chord belongs to one action: take it away from any other.
        const all = { ...prefs.get("keys.bindings") };
        const taken: string[] = [];
        for (const other of ACTIONS) {
          if (other.id === id) continue;
          const chords = bindingsOf(other);
          if (chords.includes(chord)) {
            all[other.id] = chords.filter((c) => c !== chord);
            taken.push(other.label);
          }
        }
        prefs.set("keys.bindings", all);
        const mine = bindingsOf(action);
        setBindings(
          id,
          append ? [...mine.filter((c) => c !== chord), chord] : [chord],
        );
        stop(
          `${action.label}: ${chordLabel(chord)}${taken.length ? `, removed from ${taken.join(", ")}` : ""}.`,
        );
      };
      const stop = (message: string) => {
        window.removeEventListener("keydown", onKey, true);
        suspendKeys(false);
        chip.classList.remove("recording");
        status.textContent = message;
        announce(message);
        recordingStop = undefined;
      };
      window.addEventListener("keydown", onKey, true);
      recordingStop = () => stop("");
    };
    const actionRow = (id: string) => {
      const a = ACTIONS.find((x) => x.id === id)!;
      const chips = h("span", { class: "chords" });
      watch(["keys.bindings"], () => {
        const chords = bindingsOf(a);
        chips.replaceChildren(
          ...chords.map((c) =>
            h(
              "span",
              { class: "chordchip" },
              chordKbd(c),
              h(
                "button",
                {
                  class: "chip-x",
                  "aria-label": `Remove ${chordLabel(c)} from ${a.label}`,
                  onclick: () =>
                    setBindings(
                      id,
                      chords.filter((x) => x !== c),
                    ),
                },
                icon("close"),
              ),
            ),
          ),
          ...(chords.length ? [] : [h("span", { class: "muted" }, "Not set")]),
        );
      });
      const controls = h(
        "span",
        { class: "sinline" },
        chips,
        h(
          "button",
          {
            class: "tbtn",
            "aria-label": `Change the shortcut of ${a.label}`,
            "data-tip": "Change",
            onclick: () => record(id, false, chips),
          },
          sym("edit"),
        ),
        h(
          "button",
          {
            class: "tbtn",
            "aria-label": `Add a shortcut to ${a.label}`,
            "data-tip": "Add",
            onclick: () => record(id, true, chips),
          },
          sym("add"),
        ),
        h(
          "button",
          {
            class: "tbtn",
            "aria-label": `Reset ${a.label}`,
            "data-tip": "Reset",
            onclick: () => setBindings(id, a.keys),
          },
          sym("restart_alt"),
        ),
      );
      return row(
        a.label,
        null,
        controls,
        `${a.group} shortcut ${a.keys.map(chordLabel).join(" ")}`,
      );
    };
    return [
      group(
        "Shortcuts",
        block("Shortcut help", status),
        row(
          "Shortcuts sheet",
          "Every shortcut on one page",
          h(
            "span",
            { class: "sinline" },
            button("Open sheet", host.openShortcuts),
            button("Reset all", () => prefs.reset("keys.bindings")),
          ),
          "help cheat sheet reset",
        ),
      ),
      ...GROUPS.map((g) =>
        group(
          g,
          ...ACTIONS.filter((a) => a.group === g).map((a) => actionRow(a.id)),
        ),
      ),
    ];
  }

  // Language and region ---------------------------------------------------------------------------
  function region(): HTMLElement[] {
    const localeField = h("input", {
      class: "fld",
      list: "settings-locales",
      spellcheck: "false",
      "aria-label": "Language tag",
    }) as HTMLInputElement;
    const names = new Intl.DisplayNames([navigator.language], {
      type: "language",
    });
    const datalist = h(
      "datalist",
      { id: "settings-locales" },
      ...[...new Set([...navigator.languages, navigator.language])].map((l) =>
        h("option", { value: l }, names.of(l) ?? l),
      ),
    );
    const localeName = h("span", { class: "muted" });
    localeField.addEventListener("change", () => {
      const v = localeField.value.trim();
      if (!v || v === "auto") prefs.set("region.locale", "auto");
      else if (
        !prefs.set("region.locale", v) &&
        prefs.get("region.locale") !== v
      )
        localeName.textContent = `“${v}” is not a language tag (try en-GB, fr-FR, ja-JP).`;
    });
    watch(["region.locale"], () => {
      const l = prefs.get("region.locale");
      localeField.value = l === "auto" ? "" : l;
      localeField.placeholder = `Browser language (${navigator.language})`;
      localeName.textContent = names.of(locale()) ?? locale();
    });
    const zones =
      (
        Intl as { supportedValuesOf?: (k: string) => string[] }
      ).supportedValuesOf?.("timeZone") ?? [];
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const preview = h("p", { class: "spreview" });
    watch(
      [
        "region.locale",
        "region.timeZone",
        "region.dateStyle",
        "clock.hourCycle",
        "clock.seconds",
      ],
      () => {
        const now = new Date();
        preview.textContent = `${formatDate(now)} · ${formatTime(now)} · ${new Intl.NumberFormat(locale()).format(1234567.89)} · ${formatBytes(3.5e9)}`;
      },
    );
    return [
      group(
        "Language and region",
        row(
          "Formats",
          "Dates, times and numbers; the interface stays in English",
          h("span", { class: "sinline" }, localeField, datalist),
          "locale language intl",
        ),
        block("Locale name", localeName),
        row(
          "Time zone",
          null,
          selectCtl(acc("region.timeZone"), "Time zone", [
            ["auto", `Automatic (${here})`],
            ...zones.map(
              (z) => [z, z.replaceAll("_", " ")] as [string, string],
            ),
          ]),
          "timezone tz",
        ),
        row(
          "Date style",
          null,
          selectCtl(acc("region.dateStyle"), "Date style", [
            ["short", "Short"],
            ["medium", "Medium"],
            ["long", "Long"],
            ["full", "Full"],
          ]),
          "date format",
        ),
        row(
          "Hour format",
          null,
          segCtl(acc("clock.hourCycle"), "Hour format", [
            ["auto", "Region"],
            ["h12", "12-hour"],
            ["h23", "24-hour"],
          ]),
          "time 12 24 clock",
        ),
        block("Preview", preview, "example"),
      ),
    ];
  }

  // Accessibility ---------------------------------------------------------------------------------
  function accessibility(): HTMLElement[] {
    return [
      group(
        "Vision",
        row(
          "High contrast",
          "Maximum M3 contrast and stronger outlines",
          switchCtl(acc("a11y.highContrast"), "High contrast"),
          "contrast",
        ),
        row(
          "Focus ring",
          "Outline of the focused control",
          rangeCtl(
            acc("a11y.focusRing"),
            "Focus ring width",
            1,
            8,
            1,
            (v) => `${v} px`,
          ),
          "keyboard focus outline",
        ),
        row(
          "Text size",
          null,
          rangeCtl(acc("type.scale"), "Text size", 0.8, 1.4, 0.05, pct),
          "font zoom",
        ),
      ),
      group(
        "Interaction",
        row(
          "Larger targets",
          "Controls at least 44 pixels",
          switchCtl(acc("a11y.largeTargets"), "Larger targets"),
          "touch size buttons",
        ),
        row(
          "Motion",
          null,
          segCtl(acc("motion.mode"), "Motion", [
            ["system", "System"],
            ["reduced", "Reduced"],
            ["normal", "Normal"],
          ]),
          "animation",
        ),
        row(
          "Screen reader hints",
          "Announce windows, workspaces and changes",
          switchCtl(acc("a11y.announce"), "Screen reader hints"),
          "aria live announce",
        ),
      ),
    ];
  }

  // Notifications ---------------------------------------------------------------------------------
  function notifications(): HTMLElement[] {
    const permission = h("span", { class: "muted" });
    const showPermission = () => {
      const p =
        "Notification" in window ? Notification.permission : "unsupported";
      permission.textContent =
        p === "granted"
          ? "Allowed by the browser"
          : p === "denied"
            ? "Blocked in the browser site settings"
            : p === "unsupported"
              ? "Not supported by this browser"
              : "The browser will ask";
    };
    showPermission();
    return [
      group(
        "Notifications",
        row(
          "Notifications",
          "Messages from apps",
          switchCtl(acc("notify.enabled"), "Notifications"),
          "alerts toasts",
        ),
        row(
          "Do not disturb",
          "Silence every notification for now",
          switchCtl(acc("notify.dnd"), "Do not disturb"),
          "dnd quiet",
        ),
        row(
          "System notifications",
          "When this tab is in the background",
          h(
            "span",
            { class: "sinline" },
            permission,
            switchCtl(acc("notify.system"), "System notifications", (on) => {
              if (on) void requestSystemNotifications().then(showPermission);
            }),
          ),
          "os browser permission",
        ),
        row(
          "Duration",
          "Time on screen",
          rangeCtl(
            acc("notify.duration"),
            "Notification duration",
            2,
            30,
            1,
            (v) => `${v} s`,
          ),
          "timeout",
        ),
        row(
          "Try it",
          null,
          button("Send a test notification", () =>
            notify({
              title: "Test notification",
              body: "Notifications work as configured.",
              icon: "info",
            }),
          ),
          "test",
        ),
      ),
    ];
  }

  // Sound -----------------------------------------------------------------------------------------
  function sound(): HTMLElement[] {
    const cue = (name: SoundName, label: string) =>
      row(
        label,
        null,
        h(
          "span",
          { class: "sinline" },
          h(
            "button",
            {
              class: "tbtn",
              "aria-label": `Play ${label}`,
              "data-tip": "Play",
              onclick: () => playSound(name, true),
            },
            sym("play_arrow"),
          ),
          switchCtl(fieldOf("sound.events", name), label),
        ),
        "cue event",
      );
    return [
      group(
        "Sound",
        row(
          "System sounds",
          "Cues of the shell",
          switchCtl(acc("sound.enabled"), "System sounds"),
          "audio mute",
        ),
        row(
          "Volume",
          null,
          rangeCtl(acc("sound.volume"), "Volume", 0, 1, 0.05, pct),
          "loudness",
        ),
        cue("open", "Window opens"),
        cue("close", "Window closes"),
        cue("notify", "Notification"),
      ),
    ];
  }

  // Privacy ---------------------------------------------------------------------------------------
  const confirmDialog = (
    title: string,
    body: string,
    action: string,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const dialog = document.createElement("md-dialog") as HTMLElement & {
        show(): void;
        close(): void;
      };
      let answer = false;
      const done = (v: boolean) => {
        answer = v;
        dialog.close();
      };
      dialog.append(
        h("div", { slot: "headline" }, title),
        h("div", { slot: "content" }, body),
        h(
          "button",
          { slot: "actions", class: "dlg-text", onclick: () => done(false) },
          "Cancel",
        ),
        h(
          "button",
          { slot: "actions", class: "btn", onclick: () => done(true) },
          action,
        ),
      );
      dialog.addEventListener("closed", () => {
        resolve(answer);
        dialog.remove();
      });
      document.body.append(dialog);
      dialog.show();
    });

  function privacy(): HTMLElement[] {
    const usage = h("div", { class: "susage" });
    const persisted = h("span", { class: "muted" });
    const refresh = async () => {
      const est = (await navigator.storage?.estimate?.()) as
        | (StorageEstimate & { usageDetails?: Record<string, number> })
        | undefined;
      if (!est?.quota) {
        usage.replaceChildren(
          h(
            "span",
            { class: "muted" },
            "This browser does not report storage use.",
          ),
        );
        return;
      }
      const used = est.usage ?? 0;
      const details = Object.entries(est.usageDetails ?? {}).filter(
        ([, n]) => n > 0,
      );
      const NAMES: Record<string, string> = {
        indexedDB: "Settings and app data",
        caches: "Offline apps",
        fileSystem: "Your files (OPFS)",
        serviceWorkerRegistrations: "Service worker",
      };
      usage.replaceChildren(
        h(
          "div",
          {},
          `${formatBytes(used)} of ${formatBytes(est.quota)} used on this device`,
        ),
        h("progress", {
          max: est.quota,
          value: used,
          "aria-label": "Storage used",
        }),
        ...details.map(([k, n]) =>
          h("div", { class: "muted" }, `${NAMES[k] ?? k}: ${formatBytes(n)}`),
        ),
      );
      const kept = await navigator.storage?.persisted?.();
      persisted.textContent = kept
        ? "The browser keeps your data"
        : "The browser may clear data when space runs low";
    };
    void refresh();

    const exportFile = () => {
      const blob = new Blob([JSON.stringify(prefs.export(), null, 2)], {
        type: "application/json",
      });
      const a = h("a", {
        href: URL.createObjectURL(blob),
        download: `bun-os-settings-${new Date().toISOString().slice(0, 10)}.json`,
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const importStatus = h("span", { class: "muted", role: "status" });
    const importInput = h("input", {
      type: "file",
      accept: "application/json,.json",
      hidden: true,
    }) as HTMLInputElement;
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const { applied, skipped } = prefs.import(
          JSON.parse(await file.text()),
        );
        importStatus.textContent = `${applied} settings changed${skipped.length ? `, ${skipped.length} skipped (${skipped.slice(0, 3).join(", ")})` : ""}.`;
      } catch (error) {
        importStatus.textContent =
          error instanceof Error ? error.message : String(error);
      }
      importInput.value = "";
    });

    const wipeFiles = async () => {
      const dir = await navigator.storage.getDirectory();
      for await (const name of (
        dir as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
      ).keys())
        await dir.removeEntry(name, { recursive: true }).catch(() => {});
    };
    const wipeCaches = async () => {
      for (const k of await caches.keys()) await caches.delete(k);
    };
    return [
      group(
        "Storage",
        block("Storage use", usage, "quota estimate space"),
        row(
          "Keep my data",
          "Ask the browser not to clear it automatically",
          h(
            "span",
            { class: "sinline" },
            persisted,
            button(
              "Keep",
              () => void navigator.storage?.persist?.().then(refresh),
            ),
          ),
          "persist persistent",
        ),
      ),
      group(
        "Backup",
        row(
          "Export settings",
          "Every setting as a JSON file",
          button("Export", exportFile),
          "backup download json",
        ),
        row(
          "Import settings",
          "Replace every setting from a file",
          h(
            "span",
            { class: "sinline" },
            importStatus,
            button("Import…", () => importInput.click()),
            importInput,
          ),
          "restore upload json",
        ),
      ),
      group(
        "Clear data",
        row(
          "Reset settings",
          "Every setting back to its default",
          button("Reset", async () => {
            if (
              await confirmDialog(
                "Reset every setting?",
                "Theme, wallpaper, desktop, shortcuts and every other setting return to their defaults.",
                "Reset",
              )
            )
              prefs.reset();
          }),
          "defaults",
        ),
        row(
          "Offline apps",
          "Cached app files; they download again when needed",
          button("Clear", async () => {
            await wipeCaches();
            void refresh();
            announce("Offline app cache cleared");
          }),
          "cache",
        ),
        row(
          "Your files",
          "Delete every file of the WebOS file system",
          button("Delete files", async () => {
            if (
              await confirmDialog(
                "Delete every file?",
                "Your home folder, documents and projects on this device are erased. This cannot be undone.",
                "Delete",
              )
            ) {
              await wipeFiles();
              location.reload();
            }
          }),
          "opfs erase",
        ),
        row(
          "Everything",
          "Files, settings, installed apps and caches",
          button("Erase all", async () => {
            if (
              !(await confirmDialog(
                "Erase everything on this device?",
                "Bun OS starts again as on a first visit. This cannot be undone.",
                "Erase",
              ))
            )
              return;
            await Promise.allSettled([
              wipeFiles(),
              wipeCaches(),
              navigator.serviceWorker
                ?.getRegistrations()
                .then((rs) => Promise.all(rs.map((r) => r.unregister()))),
            ]);
            indexedDB.deleteDatabase("aphrody-webos");
            localStorage.clear();
            location.reload();
          }),
          "wipe factory reset",
        ),
      ),
    ];
  }

  // About -----------------------------------------------------------------------------------------
  function about(): HTMLElement[] {
    let build: Record<string, string> = {};
    try {
      build = JSON.parse(
        typeof __WEBOS_BUILD__ === "string" ? __WEBOS_BUILD__ : "{}",
      ) as Record<string, string>;
    } catch {
      // A build without identity (development) shows defaults.
    }
    const kv = h("dl", { class: "kv" });
    const put = (k: string, v: string | Node) =>
      kv.append(h("dt", {}, k), h("dd", {}, v));
    const commit = build.commit ?? "development build";
    put("Version", `Bun OS ${build.version ?? "dev"}`);
    put(
      "Build",
      /^[\da-f]{7,40}$/.test(commit)
        ? h(
            "a",
            {
              href: `https://github.com/aphrody-labs/bun-os/commit/${commit}`,
              target: "_blank",
              rel: "noopener",
            },
            commit.slice(0, 12),
          )
        : commit,
    );
    if (build.built)
      put(
        "Built",
        formatDate(new Date(build.built)) +
          " " +
          formatTime(new Date(build.built), false),
      );
    for (const [k, label] of [
      ["bun", "Bun (build)"],
      ["materialWeb", "Material Web"],
      ["m3Tokens", "M3 tokens"],
      ["colorUtils", "Material colour utilities"],
      ["webosWasm", "WebOS file system"],
    ] as const)
      if (build[k]) put(label, build[k]!);
    put(
      "Browser",
      navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 100),
    );
    put("Cores", String(navigator.hardwareConcurrency ?? "n/a"));
    put(
      "Settings storage",
      prefs.persistent
        ? "IndexedDB, synced across tabs"
        : "This page only (storage blocked)",
    );
    void webos().then(
      (os) =>
        put(
          "File system",
          `${os.version}, ${os.persistent ? "saved in OPFS" : "in memory (another tab holds the files)"}`,
        ),
      () => put("File system", "unavailable"),
    );
    void fetch("/api/health")
      .then((r) => r.json() as Promise<{ colo?: string }>)
      .then((j) => j.colo && put("Edge location", j.colo))
      .catch(() => {});
    return [
      group(
        "About this system",
        block("About", kv, "version build commit browser"),
      ),
    ];
  }

  const BUILDERS: Record<SectionId, () => HTMLElement[]> = {
    appearance,
    wallpaper,
    desktop,
    keyboard,
    region,
    accessibility,
    notifications,
    sound,
    privacy,
    about,
  };

  // Shell -----------------------------------------------------------------------------------------
  let current: SectionId = start;
  const search = h("input", {
    class: "ssearch",
    type: "search",
    placeholder: "Search settings",
    "aria-label": "Search settings",
    autocomplete: "off",
  }) as HTMLInputElement;
  const nav = h("nav", { class: "snav", "aria-label": "Settings sections" });
  const pane = h("div", { class: "spane", tabindex: -1 });
  const navButtons = SECTIONS.map((s) =>
    h(
      "button",
      {
        class: "snav-item",
        "data-section": s.id,
        onclick: () => show(s.id, true),
      },
      sym(s.glyph),
      h("span", {}, s.name),
    ),
  );
  nav.append(...navButtons);

  function render() {
    dispose();
    rows = [];
    const q = search.value.trim().toLowerCase();
    if (q) {
      const found: HTMLElement[] = [];
      for (const s of SECTIONS) {
        rows = [];
        BUILDERS[s.id]();
        const hits = rows.filter((r) =>
          q.split(/\s+/).every((w) => r.keywords.includes(w)),
        );
        if (hits.length)
          found.push(
            h("h2", { class: "shead" }, s.name),
            ...hits.map((r) => r.el),
          );
      }
      pane.replaceChildren(
        ...(found.length
          ? found
          : [
              h(
                "p",
                { class: "muted sempty" },
                `No setting matches “${search.value.trim()}”.`,
              ),
            ]),
      );
      for (const b of navButtons) b.removeAttribute("aria-current");
      return;
    }
    const section = SECTIONS.find((s) => s.id === current)!;
    pane.replaceChildren(
      h("h2", { class: "shead" }, section.name),
      ...BUILDERS[current](),
    );
    for (const b of navButtons)
      if (b.dataset.section === current) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
  }
  function show(id: SectionId, focus = false) {
    current = id;
    if (search.value) search.value = "";
    render();
    host.onSection(id);
    if (focus) pane.focus({ preventScroll: true });
    pane.scrollTop = 0;
  }
  search.addEventListener("input", render);
  // Lists of apps follow installs and the workspace count follows the window manager.
  const view = h(
    "div",
    { class: "settings2" },
    h(
      "aside",
      { class: "sside" },
      h("label", { class: "ssearch-wrap" }, sym("search"), search),
      nav,
    ),
    pane,
  );
  root.append(view);
  render();
  return {
    show,
    /** Re-render after the app catalog changed (installs, web apps). */
    refresh: () => view.isConnected && render(),
    dispose,
  };
}
