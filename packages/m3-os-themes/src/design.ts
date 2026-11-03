// SPDX-License-Identifier: Apache-2.0
// `m3-os-themes design`: the end-to-end Bun OS design artifact, built on the build host from the pinned forks.
//
//   wallpaper (SVG/PNG) --bunos-design seed--> source colour --bunos-design theme--> native M3 export (49 roles x 2)
//     -> OS themes (Windows, GNOME/GTK, COSMIC, Chromium), app themes (web CSS, Rio, nushell, Omarchy palette)
//     -> window chrome (spec, caption-button artwork, GTK/Hyprland/COSMIC/Windows parameters)
//     -> icons (Material Symbols fork -> Windows .ico + resource DLL + mapping, freedesktop theme)
//     -> fonts (google/fonts fork: Google Sans Flex, Roboto Flex/Serif/Mono, Noto; Material Symbols) + fontconfig
//     -> receipt.json (sha256 + size of every file, inputs, pins)
//
//   bun packages/m3-os-themes/src/cli.ts design --out <dir> [--wallpaper <svg|png>] [--seed <hex>] [--bin <bunos-design>]
//     [--no-dll] [--no-catalogue]
// Runs on Linux (vps): the DLL step needs llvm-rc and lld-link.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { generateCssSheet, generateRio, staticTokens } from "./apps.ts";
import {
  BUTTONS,
  BUTTON_STATES,
  GEOMETRY,
  chromeSpec,
  composite,
  cosmicTk,
  gtkChromeCss,
  gtkSettings,
  harmonize,
  hyprlandChrome,
  trafficLightSvg,
  win11Chrome,
  type ChromeSpec,
} from "./chrome.ts";
import { allModes } from "./color.ts";
import { themeBundle } from "./cosmic.ts";
import { FONTS, ansiFromRoles, fontconfigConf, nushellTheme, omarchyColors } from "./desktops.ts";
import { generate } from "./generate.ts";
import { gtkCss } from "./gnome.ts";
import { ICONS, compose, indexTheme, type IconDef, type Palette } from "./icons.ts";
import type { Mode, Roles, ThemeInput } from "./types.ts";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const SYMBOLS = join(ROOT, "vendor/material-design-icons");
const GOOGLE_FONTS = join(ROOT, "vendor/fonts");
const ICON_THEME = "Aphrody-M3";
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 256];
const XDG_SIZES = [16, 24, 32, 48, 64, 128, 256];
const MODES: readonly Mode[] = ["light", "dark"];

interface Job {
  svg: string;
  small?: string;
  ico?: string;
  sizes?: number[];
  png?: { size: number; height?: number; out: string }[];
  text?: boolean;
}

function sh(cmd: string[], cwd?: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString().trim() || r.stdout.toString().trim()}`);
  return r.stdout.toString().trim();
}

class Out {
  constructor(readonly dir: string) {}
  path(rel: string): string {
    const p = join(this.dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    return p;
  }
  write(rel: string, content: string | Uint8Array): void {
    writeFileSync(this.path(rel), content);
  }
  json(rel: string, value: unknown): void {
    this.write(rel, `${JSON.stringify(value, null, 2)}\n`);
  }
  copy(src: string, rel: string): void {
    copyFileSync(src, this.path(rel));
  }
}

function symbolSvg(name: string): string {
  const base = join(SYMBOLS, "symbols/web", name, "materialsymbolsrounded");
  for (const f of [`${name}_fill1_24px.svg`, `${name}_24px.svg`]) if (existsSync(join(base, f))) return readFileSync(join(base, f), "utf8");
  throw new Error(`Material Symbol "${name}" (rounded) is not materialised in vendor/material-design-icons`);
}

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  // eslint-disable-next-line unicorn/no-array-sort -- fresh array, ES2022 lib target.
  return out.sort();
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const gitHead = (dir: string) => {
  try {
    return sh(["git", "-C", dir, "rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
};

// ---------------------------------------------------------------------------------------------------- chrome preview

/** A spec render of one window on a wallpaper: chrome only, content is neutral placeholder blocks. */
function previewSvg(spec: ChromeSpec, mode: Mode, wallpaperHref: string, label: string, roles: Roles): string {
  const m = spec[mode];
  const W = 1280;
  const H = 800;
  const win = { x: 160, y: 110, w: 960, h: 580 };
  const tb = GEOMETRY.titlebarHeight;
  const { hit, gap, inset } = GEOMETRY.button;
  const btn = (i: number, b: (typeof BUTTONS)[number], state: "normal" | "hover" | "inactive") =>
    `<g transform="translate(${win.x + inset - (hit - GEOMETRY.button.diameter) / 2 + i * (GEOMETRY.button.diameter + gap)} ${win.y + (tb - hit) / 2})">${trafficLightSvg(m, b, state).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>`;
  const back = { x: 90, y: 60, w: 760, h: 460 };
  const bar = composite(m.titlebar.color, m.titlebar.alpha, mode === "dark" ? "#20183f" : "#6a4bb0");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity="${mode === "dark" ? 0.5 : 0.25}"/><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="${mode === "dark" ? 0.36 : 0.14}"/></filter>
<clipPath id="wc"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${GEOMETRY.radius}"/></clipPath>
<clipPath id="bc"><rect x="${back.x}" y="${back.y}" width="${back.w}" height="${back.h}" rx="${GEOMETRY.radius}"/></clipPath></defs>
<image href="${wallpaperHref}" xlink:href="${wallpaperHref}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
<g filter="url(#sh)" opacity="0.96"><rect x="${back.x}" y="${back.y}" width="${back.w}" height="${back.h}" rx="${GEOMETRY.radius}" fill="${roles["surface"]}"/></g>
<g clip-path="url(#bc)"><rect x="${back.x}" y="${back.y}" width="${back.w}" height="${tb}" fill="${bar}"/></g>
${[0, 1, 2].map(i => `<g transform="translate(${back.x - win.x} ${back.y - win.y})">${btn(i, BUTTONS[i]!, "inactive")}</g>`).join("")}
<g filter="url(#sh)"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${GEOMETRY.radius}" fill="${roles["surface"]}"/></g>
<g clip-path="url(#wc)">
<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${tb}" fill="${bar}"/>
<rect x="${win.x}" y="${win.y + tb}" width="220" height="${win.h - tb}" fill="${composite(m.sidebar.color, m.sidebar.alpha, roles["surface"]!)}"/>
<rect x="${win.x}" y="${win.y + tb - 1}" width="${win.w}" height="1" fill="${m.border}"/>
${[0, 1, 2, 3, 4].map(i => `<rect x="${win.x + 16}" y="${win.y + tb + 20 + i * 44}" width="188" height="32" rx="16" fill="${i === 1 ? roles["secondaryContainer"] : "none"}"/><rect x="${win.x + 32}" y="${win.y + tb + 32 + i * 44}" width="${90 + ((i * 37) % 60)}" height="8" rx="4" fill="${roles["onSurfaceVariant"]}" opacity="0.6"/>`).join("")}
${[0, 1, 2].map(i => `<rect x="${win.x + 252}" y="${win.y + tb + 24 + i * 150}" width="${win.w - 284}" height="130" rx="${GEOMETRY.radius}" fill="${roles["surfaceContainerLow"]}"/>`).join("")}
<rect x="${win.x + win.w - 150}" y="${win.y + win.h - 76}" width="120" height="56" rx="16" fill="${roles["primaryContainer"]}"/>
</g>
<rect x="${win.x + win.w / 2 - 70}" y="${win.y + tb / 2 - 5}" width="140" height="10" rx="5" fill="${m.title}" opacity="0.85"/>
${btn(0, "close", "hover")}${btn(1, "minimize", "hover")}${btn(2, "zoom", "hover")}
<text x="24" y="${H - 22}" font-family="Google Sans Flex, Roboto Flex, sans-serif" font-size="18" fill="#ffffff" opacity="0.9">${label} · ${mode} · spec render (bunos-design)</text>
</svg>`;
}

// ------------------------------------------------------------------------------------------------------------ main

export interface DesignOptions {
  out: string;
  wallpaper?: string;
  seed?: string;
  bin: string;
  dll: boolean;
  catalogue: boolean;
}

export function runDesign(o: DesignOptions): string[] {
  const log: string[] = [];
  const out = new Out(resolve(o.out));
  if (existsSync(out.dir)) rmSync(out.dir, { recursive: true, force: true });
  mkdirSync(out.dir, { recursive: true });
  const work = join(out.dir, ".work");
  mkdirSync(work, { recursive: true });
  const render = (jobs: Job[], name: string) => {
    const p = join(work, `${name}.json`);
    writeFileSync(p, JSON.stringify({ jobs }));
    log.push(sh([o.bin, "render", p]));
  };

  // 1. Wallpaper -> seed -> native theme.
  const wallSrc = resolve(o.wallpaper ?? join(import.meta.dir, "..", "assets", "wallpaper-bunos-dusk.svg"));
  let wallPng = wallSrc;
  if (wallSrc.endsWith(".svg")) {
    const svg = readFileSync(wallSrc, "utf8");
    out.write("wallpaper/bunos-dusk.svg", svg);
    render(
      [
        {
          svg,
          png: [
            { size: 3840, height: 2160, out: out.path("wallpaper/bunos-dusk-3840x2160.png") },
            { size: 1920, height: 1080, out: out.path("wallpaper/bunos-dusk-1920x1080.png") },
          ],
        },
      ],
      "wallpaper",
    );
    wallPng = join(out.dir, "wallpaper/bunos-dusk-1920x1080.png");
  }
  const seed = o.seed ?? sh([o.bin, "seed", wallPng]);
  const native = parseNativeThemeExport(JSON.parse(sh([o.bin, "theme", "--seed", seed, "--variant", "tonal-spot"])));
  const input: ThemeInput = { name: "BunOS", seed, variant: "tonalSpot", contrastLevel: 0, nativeTheme: native, mode: "auto" };
  out.json("theme/native-theme.json", native);
  log.push(`seed ${seed} from ${relative(ROOT, wallSrc)}`);
  const [light, dark] = allModes(input);
  const roles: Record<Mode, Roles> = { light: light!.roles, dark: dark!.roles };
  const tokens = staticTokens();
  const fontBrand = "Google Sans Flex";
  const fontMono = "Google Sans Code";

  // 2. OS themes (existing generators) and app themes.
  for (const f of generate(input)) out.write(`os/${f.path}`, f.content);
  const css = generateCssSheet(input, tokens);
  out.write("webos/bunos-m3.css", css);
  out.write("rio/bunos-m3.toml", generateRio(input));

  // 3. Window chrome.
  const spec = chromeSpec(input);
  out.json("chrome/spec.json", spec);
  const chromeJobs: Job[] = [];
  for (const mode of MODES) {
    for (const b of BUTTONS)
      for (const s of BUTTON_STATES) {
        const svg = trafficLightSvg(spec[mode], b, s);
        const rel = `chrome/buttons/${mode}/${b}-${s}`;
        out.write(`${rel}.svg`, svg);
        chromeJobs.push({ svg, png: [24, 30, 36, 48].map(px => ({ size: px, out: out.path(`${rel}@${px}.png`) })) });
      }
    out.json(`windows/bunos-win11-chrome.${mode}.json`, win11Chrome(spec, mode));
    out.write(`hyprland/bunos-m3-${mode}.conf`, hyprlandChrome(spec, mode, fontBrand));
    out.write(
      `webos/chrome-${mode}.css`,
      `/* Bun OS window chrome tokens (${mode}) for the WebOS site: generated by m3-os-themes design. */\n:root${mode === "dark" ? '[data-theme="dark"], :root.dark' : ""} {\n${[
        ["--bunos-chrome-radius", `${GEOMETRY.radius}px`],
        ["--bunos-chrome-titlebar-height", `${GEOMETRY.titlebarHeight}px`],
        ["--bunos-chrome-titlebar-bg", `color-mix(in srgb, ${spec[mode].titlebar.color} ${Math.round(spec[mode].titlebar.alpha * 100)}%, transparent)`],
        ["--bunos-chrome-titlebar-blur", `${spec[mode].titlebar.blur}px`],
        ["--bunos-chrome-sidebar-bg", `color-mix(in srgb, ${spec[mode].sidebar.color} ${Math.round(spec[mode].sidebar.alpha * 100)}%, transparent)`],
        ["--bunos-chrome-title", spec[mode].title],
        ["--bunos-chrome-border", spec[mode].border],
        ["--bunos-chrome-shadow", spec[mode].shadow.active],
        ["--bunos-chrome-shadow-inactive", spec[mode].shadow.inactive],
        ["--bunos-chrome-focus", spec[mode].focusRing],
        ...BUTTONS.flatMap(b => [
          [`--bunos-chrome-${b}`, spec[mode].buttons[b].fill],
          [`--bunos-chrome-${b}-glyph`, spec[mode].buttons[b].glyph],
        ]),
        ["--bunos-chrome-inactive", spec[mode].inactive.fill],
        ["--bunos-chrome-inactive-border", spec[mode].inactive.border],
      ]
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n")}\n}\n@media (prefers-reduced-transparency: reduce), (forced-colors: active) {\n  :root { --bunos-chrome-titlebar-bg: ${spec[mode].titlebar.color}; --bunos-chrome-sidebar-bg: ${spec[mode].sidebar.color}; --bunos-chrome-titlebar-blur: 0px; }\n}\n`,
    );
  }
  out.write("webos/motion.css", `/* M3 Expressive motion tokens: generated by m3-os-themes design. */\n:root {\n${(["fast", "default", "slow"] as const)
    .flatMap(k => [
      `  --bunos-motion-spatial-${k}: ${spec.motion.spatial[k].ms}ms cubic-bezier(${spec.motion.spatial[k].bezier.join(", ")});`,
      `  --bunos-motion-effects-${k}: ${spec.motion.effects[k].ms}ms cubic-bezier(${spec.motion.effects[k].bezier.join(", ")});`,
    ])
    .join("\n")}\n  --bunos-motion-exit-ratio: ${spec.motion.exitRatio};\n}\n@media (prefers-reduced-motion: reduce) {\n  :root { ${(["fast", "default", "slow"] as const).map(k => `--bunos-motion-spatial-${k}: 0ms linear; --bunos-motion-effects-${k}: 0ms linear;`).join(" ")} }\n}\n`);

  // GTK (GTK 3 + GTK 4/libadwaita): M3 named colours + chrome; settings put the buttons on the left.
  const gtkBase = `gtk/BunOS-M3`;
  out.write(`${gtkBase}/index.theme`, `[Desktop Entry]\nType=X-GNOME-Metatheme\nName=BunOS-M3\nComment=Bun OS Material 3 with traffic-light window controls\nEncoding=UTF-8\n\n[X-GNOME-Metatheme]\nGtkTheme=BunOS-M3\nIconTheme=${ICON_THEME}\nCursorTheme=Adwaita\nButtonLayout=close,minimize,maximize:menu\n`);
  for (const v of [3, 4] as const) {
    out.write(`${gtkBase}/gtk-${v}.0/gtk.css`, `${gtkCss(roles.light, v)}\n${gtkChromeCss(spec, "light", v)}`);
    out.write(`${gtkBase}/gtk-${v}.0/gtk-dark.css`, `${gtkCss(roles.dark, v)}\n${gtkChromeCss(spec, "dark", v)}`);
    out.write(`${gtkBase}/gtk-${v}.0/settings.ini`, gtkSettings(fontBrand, ICON_THEME, true));
  }
  out.write(
    "gtk/gsettings.sh",
    `#!/bin/sh\n# Bun OS GNOME settings: macOS button order, M3 fonts, icon theme. Generated by m3-os-themes design.\ngsettings set org.gnome.desktop.wm.preferences button-layout 'close,minimize,maximize:appmenu'\ngsettings set org.gnome.desktop.interface font-name '${fontBrand} 11'\ngsettings set org.gnome.desktop.interface document-font-name '${fontBrand} 11'\ngsettings set org.gnome.desktop.interface monospace-font-name '${fontMono} 11'\ngsettings set org.gnome.desktop.wm.preferences titlebar-font '${fontBrand} Semi-Bold 11'\ngsettings set org.gnome.desktop.interface icon-theme '${ICON_THEME}'\ngsettings set org.gnome.desktop.interface gtk-theme 'BunOS-M3'\n`,
  );

  // COSMIC: theme bundles + toolkit config (fonts, icon theme).
  for (const mode of MODES) out.write(`cosmic/BunOS-M3-${mode}.ron`, themeBundle(roles[mode], mode, "BunOS-M3"));
  for (const [k, v] of Object.entries(cosmicTk(fontBrand, fontMono, ICON_THEME))) out.write(`cosmic/com.system76.CosmicTk/v1/${k}`, v);
  const patch = join(import.meta.dir, "..", "patches", "libcosmic-window-controls-start.patch");
  if (existsSync(patch)) out.copy(patch, "cosmic/libcosmic-window-controls-start.patch");

  // Omarchy-format theme dir consumed by bunos-theme (Hyprland/Omarchy, COSMIC, GNOME) + nushell.
  const h = (c: string) => harmonize(c, roles.dark["primary"]!);
  const ansi = ansiFromRoles(roles.dark, { red: roles.dark["error"]!, green: h("#8fd694"), yellow: h("#f0c674") });
  const om = "omarchy/bunos-m3";
  out.write(`${om}/colors.toml`, omarchyColors(roles.dark, ansi));
  out.write(`${om}/hyprland.conf`, hyprlandChrome(spec, "dark", fontBrand));
  out.write(`${om}/icons.theme`, `${ICON_THEME}\n`);
  out.write(`${om}/rio.toml`, generateRio(input));
  out.write(`${om}/gtk.css`, `${gtkCss(roles.dark, 4)}\n${gtkChromeCss(spec, "dark", 4)}`);
  out.write(`${om}/cosmic.ron`, themeBundle(roles.dark, "dark", "bunos-m3"));
  out.write(`nushell/bunos-m3.nu`, nushellTheme(roles.dark, ansi));

  // 4. Icons.
  const palette = (r: Roles): Palette => ({ primary: r["primary"]!, secondary: r["secondary"]!, tertiary: r["tertiary"]!, neutral: r["outline"]! });
  const iconJobs: Job[] = [];
  const winMap: Record<string, unknown>[] = [];
  const xdgSeen = new Set<string>();
  for (const mode of MODES) {
    const dark = mode === "dark";
    const theme = dark ? `${ICON_THEME}-Dark` : ICON_THEME;
    for (const def of ICONS) {
      const c = compose(def, symbolSvg(def.symbol), palette(roles[mode]), dark);
      const xdgPng = (def.xdg ?? []).flatMap(n => XDG_SIZES.map(s => ({ size: s, out: out.path(`icons/freedesktop/${theme}/${s}x${s}/${n.split("/")[0]}/${n.split("/")[1]}.png`) })));
      for (const n of def.xdg ?? []) {
        const [ctx, name] = n.split("/") as [string, string];
        out.write(`icons/freedesktop/${theme}/scalable/${ctx}/${name}.svg`, c.svg);
        out.write(`icons/freedesktop/${theme}/symbolic/${ctx}/${name}-symbolic.svg`, c.symbolic);
        xdgSeen.add(ctx);
      }
      const job: Job = { svg: c.svg, small: c.small, png: def.kind === "glyph" ? [] : xdgPng };
      if (def.kind !== "glyph") {
        job.ico = out.path(`icons/windows/ico/${mode}/${def.id}.ico`);
        job.sizes = ICO_SIZES;
        out.write(`icons/windows/svg/${mode}/${def.id}.svg`, c.svg);
      }
      iconJobs.push(job);
    }
  }
  // Full-colour caption buttons for toolkits that draw them from the icon theme (COSMIC with the start-side patch):
  // glyphs always visible there, since a static icon cannot switch on hover.
  for (const mode of MODES) {
    const theme = mode === "dark" ? `${ICON_THEME}-Dark` : ICON_THEME;
    const art: Record<string, string> = {
      "window-close": trafficLightSvg(spec[mode], "close", "hover"),
      "window-minimize": trafficLightSvg(spec[mode], "minimize", "hover"),
      "window-maximize": trafficLightSvg(spec[mode], "zoom", "hover"),
      "window-restore": trafficLightSvg(spec[mode], "zoom", "hover"),
    };
    for (const [name, svg] of Object.entries(art)) out.write(`icons/freedesktop/${theme}/scalable/actions/${name}.svg`, svg);
    xdgSeen.add("actions");
  }
  render(iconJobs, "icons");
  // Windows mapping: resource ordinals (light 100+, dark 1100+), shell indices, known folders, extensions, drives, apps.
  const winIcons = ICONS.filter(d => d.kind !== "glyph");
  winIcons.forEach((d: IconDef, i) => winMap.push({ id: d.id, label: d.label, kind: d.kind, symbol: d.symbol, ordinal: { light: 100 + i, dark: 1100 + i }, ...d.win }));
  out.json("icons/windows/icon-theme.json", {
    schema: 1,
    dll: "%SystemRoot%\\BunOS\\icons\\bunos-icons.dll",
    reference: "<dll>,-<ordinal>",
    apply: {
      shellIcons: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons  <index> = <dll>,-<ordinal>",
      knownFolders: "desktop.ini [.ShellClassInfo] IconResource=<dll>,-<ordinal> in the folder (attrib +s +h desktop.ini, +r folder)",
      fileTypes: "HKLM\\SOFTWARE\\Classes\\<ProgID>\\DefaultIcon (default) = <dll>,-<ordinal>; never override a ProgID another app owns",
      drives: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\<Letter>\\DefaultIcon",
      apps: "Start / taskbar shortcuts (.lnk IconLocation) and AppUserModelID RelaunchIconResource",
      refresh: "SHChangeNotify(SHCNE_ASSOCCHANGED); ie4uinit.exe -show",
    },
    icons: winMap,
  });
  for (const theme of [ICON_THEME, `${ICON_THEME}-Dark`]) {
    // eslint-disable-next-line unicorn/no-array-sort -- fresh array, ES2022 lib target.
    const ctxs = [...xdgSeen].sort();
    const darkTheme = theme.endsWith("Dark");
    out.write(`icons/freedesktop/${theme}/index.theme`, indexTheme(theme, `Material Symbols (rounded, filled) composed with the Bun OS M3 roles${darkTheme ? ", dark" : ""}`, XDG_SIZES, darkTheme ? ctxs : [...ctxs, ...(o.catalogue ? ["material"] : [])], darkTheme ? `${ICON_THEME},Cosmic,Adwaita,hicolor` : undefined));
  }
  if (o.catalogue) {
    // The whole catalogue as symbolic SVGs (Rounded, weight 400, fill 0 and 1), for apps that look up Material names.
    let n = 0;
    for (const name of readdirSync(join(SYMBOLS, "symbols/web"))) {
      const dir = join(SYMBOLS, "symbols/web", name, "materialsymbolsrounded");
      for (const [f, suffix] of [[`${name}_24px.svg`, ""], [`${name}_fill1_24px.svg`, "-fill"]] as const) {
        if (!existsSync(join(dir, f))) continue;
        const svg = readFileSync(join(dir, f), "utf8").replace("<svg ", '<svg fill="#bebebe" ');
        out.write(`icons/freedesktop/${ICON_THEME}/symbolic/material/${name}${suffix}-symbolic.svg`, svg);
        n++;
      }
    }
    log.push(`catalogue: ${n} symbolic SVGs`);
  }
  out.copy(join(SYMBOLS, "LICENSE"), "icons/LICENSE-material-symbols.txt");
  out.write(
    "icons/NOTICE.txt",
    `Bun OS icons are composed from Material Symbols (Rounded, weight 400), Copyright Google LLC, licensed under the\nApache License 2.0 (LICENSE-material-symbols.txt), from the aphrody-labs/material-design-icons fork at\n${gitHead(SYMBOLS)}. Shapes, colours and composition: Bun OS (aphrody-dev), Apache-2.0.\n`,
  );

  // Windows resource DLL (icons only): light ordinals 100+, dark 1100+.
  if (o.dll) {
    const rc = [
      "// Bun OS icon resources: generated by m3-os-themes design. Icons only, no code.",
      ...winIcons.flatMap((d, i) => [`${100 + i} ICON "ico/light/${d.id}.ico"`, `${1100 + i} ICON "ico/dark/${d.id}.ico"`]),
      `1 VERSIONINFO\nFILEVERSION 1,4,7,0\nPRODUCTVERSION 1,4,7,0\nFILEOS 0x40004\nFILETYPE 0x2\nBEGIN\n  BLOCK "StringFileInfo"\n  BEGIN\n    BLOCK "040904B0"\n    BEGIN\n      VALUE "CompanyName", "aphrody-dev"\n      VALUE "FileDescription", "Bun OS icons (Material Symbols, Apache-2.0)"\n      VALUE "FileVersion", "1.4.7"\n      VALUE "InternalName", "bunos-icons"\n      VALUE "LegalCopyright", "Material Symbols (c) Google LLC, Apache-2.0; composition (c) aphrody-dev"\n      VALUE "OriginalFilename", "bunos-icons.dll"\n      VALUE "ProductName", "Bun OS"\n      VALUE "ProductVersion", "1.4.7"\n    END\n  END\n  BLOCK "VarFileInfo"\n  BEGIN\n    VALUE "Translation", 0x409, 1200\n  END\nEND`,
    ].join("\n");
    const winDir = join(out.dir, "icons/windows");
    writeFileSync(join(winDir, "bunos-icons.rc"), `${rc}\n`);
    sh(["llvm-rc", "/fo", join(work, "bunos-icons.res"), "bunos-icons.rc"], winDir);
    sh(["lld-link", "/dll", "/noentry", "/machine:x64", "/nodefaultlib", "/release", `/out:${join(winDir, "bunos-icons.dll")}`, join(work, "bunos-icons.res")]);
    log.push(`dll: ${winIcons.length * 2} icon groups`);
  }

  // Previews (spec renders) for every desktop.
  const wallHref = `data:image/png;base64,${readFileSync(wallPng).toString("base64")}`;
  const previews: Job[] = [];
  for (const mode of MODES)
    for (const label of ["Windows 11", "GNOME (GTK 4)", "COSMIC", "Hyprland"]) {
      const slug = label.split(" ")[0]!.toLowerCase();
      const svg = previewSvg(spec, mode, wallHref, label, roles[mode]);
      previews.push({ svg, text: true, png: [{ size: 1280, height: 800, out: out.path(`previews/${slug}-${mode}.png`) }] });
    }
  render(chromeJobs, "chrome");
  render(previews, "previews");

  // 5. Fonts.
  const fontRows: Record<string, unknown>[] = [];
  for (const f of FONTS) {
    const src = join(f.source === "google-fonts" ? GOOGLE_FONTS : SYMBOLS, f.path);
    if (!existsSync(src)) throw new Error(`font source missing: ${src}`);
    out.copy(src, `fonts/${f.file}`);
    fontRows.push({ ...f, sha256: sha256(src), bytes: statSync(src).size });
  }
  for (const d of new Set(FONTS.filter(f => f.source === "google-fonts").map(f => f.path.split("/")[1]!)))
    out.copy(join(GOOGLE_FONTS, "ofl", d, "OFL.txt"), `fonts/licenses/${d}-OFL.txt`);
  out.copy(join(SYMBOLS, "LICENSE"), "fonts/licenses/materialsymbols-LICENSE.txt");
  out.json("fonts/fonts.json", { schema: 1, googleFonts: gitHead(GOOGLE_FONTS), materialSymbols: gitHead(SYMBOLS), fonts: fontRows });
  out.write("fonts/fontconfig/60-bunos-m3.conf", fontconfigConf());

  // 6. Receipt.
  rmSync(work, { recursive: true, force: true });
  const list = files(out.dir).map(p => ({ path: relative(out.dir, p).replaceAll("\\", "/"), sha256: sha256(p), bytes: statSync(p).size }));
  const receipt = {
    schema: 1,
    kind: "bunos-design",
    commit: gitHead(ROOT),
    created: new Date().toISOString(),
    inputs: { seed, wallpaper: relative(ROOT, wallSrc), variant: "tonalSpot", materialSymbols: gitHead(SYMBOLS), googleFonts: gitHead(GOOGLE_FONTS) },
    counts: {
      files: list.length,
      ico: list.filter(f => f.path.endsWith(".ico")).length,
      png: list.filter(f => f.path.endsWith(".png")).length,
      svg: list.filter(f => f.path.endsWith(".svg")).length,
      fonts: FONTS.length,
    },
    checks: { light: spec.light.checks, dark: spec.dark.checks },
    files: list,
  };
  out.json("receipt.json", receipt);
  log.push(`receipt: ${list.length} files (${receipt.counts.ico} ico, ${receipt.counts.png} png, ${receipt.counts.svg} svg, ${FONTS.length} fonts)`);
  const failed = [...spec.light.checks, ...spec.dark.checks].filter(c => !c.pass);
  for (const c of failed) log.push(`CHECK FAILED: ${c.name} ${c.ratio} < ${c.min}`);
  return log;
}

/** Verify a design artifact against its receipt; returns the mismatches. */
export function verifyDesign(dir: string): string[] {
  const receipt = JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")) as { files: { path: string; sha256: string }[] };
  return receipt.files.filter(f => !existsSync(join(dir, f.path)) || sha256(join(dir, f.path)) !== f.sha256).map(f => f.path);
}
