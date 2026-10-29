// SPDX-License-Identifier: 0BSD
/**
 * Theme templating, after Omarchy's bin/omarchy-theme-set-templates (omacom/omarchy 84782475aeb8): one
 * `colors.toml` per theme, `*.tpl` templates rendered into the theme output, tokens
 *   {{ key }}  {{ key_strip }} (no #)  {{ key_rgb }} (r,g,b)  {{ mix[_strip|_rgb] a b N% }}
 * where `a`/`b` are keys or #hex colours and mix is the linear interpolation int(a*(1-t)+b*t+0.5)
 * (N > 1 is a percentage). Unknown tokens are left as they are. A file the theme ships itself is never
 * overwritten by a template; user templates (userTemplates) shadow package templates of the same name.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Colors = Record<string, string>;

export function parseColors(toml: string): Colors {
  const table = Bun.TOML.parse(toml) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(table).filter(([, v]) => typeof v === "string")) as Colors;
}

const HEX = /^#?([0-9a-f]{6})$/i;
const toRgb = (hex: string): [number, number, number] => {
  const m = hex.match(HEX);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");

export function mix(a: string, b: string, amount: number): string {
  const t = amount > 1 ? amount / 100 : amount;
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((v, i) => Math.trunc(v * (1 - t) + y[i]! * t + 0.5)));
}

const form = (value: string, suffix: string): string | undefined => {
  if (suffix === "") return value;
  if (suffix === "_strip") return value.replace(/^#/, "");
  if (suffix === "_rgb") return HEX.test(value) ? toRgb(value).join(",") : undefined;
  return undefined;
};

export function render(template: string, colors: Colors): string {
  const colour = (ref: string) => colors[ref] ?? ref;
  return template.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (token, body: string) => {
    const parts = body.split(/\s+/);
    const m = parts[0]!.match(/^mix(_strip|_rgb)?$/);
    if (m) {
      if (parts.length !== 4 || !/^\d+(\.\d+)?%?$/.test(parts[3]!)) return token;
      const out = mix(colour(parts[1]!), colour(parts[2]!), parseFloat(parts[3]!));
      return form(out, m[1] ?? "") ?? token;
    }
    if (parts.length !== 1) return token;
    const key = parts[0]!;
    if (colors[key] !== undefined) return colors[key]!;
    const suffixed = key.match(/^(.+?)(_strip|_rgb)$/);
    const base = suffixed ? colors[suffixed[1]!] : undefined;
    return base !== undefined ? (form(base, suffixed![2]!) ?? token) : token;
  });
}

export interface ThemeRender {
  name: string;
  files: string[];
}

/**
 * Render `<themesDir>/<name>` into `out`: copy the theme's own files, then render every template from
 * `userTemplates` first and `templates` second into names the theme does not already ship.
 */
export async function renderTheme(options: {
  themesDir: string;
  name: string;
  templates: string;
  userTemplates?: string;
  out: string;
}): Promise<ThemeRender> {
  const name = options.name
    .replace(/<[^>]*>/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!name || name.startsWith(".") || name.includes("/")) throw new Error(`invalid theme name: ${options.name}`);
  const themeDir = join(options.themesDir, name);
  if (!existsSync(join(themeDir, "colors.toml"))) throw new Error(`theme ${name}: colors.toml missing`);
  const colors = parseColors(await readFile(join(themeDir, "colors.toml"), "utf8"));
  await mkdir(options.out, { recursive: true });
  const written = new Set<string>();
  for (const f of await readdir(themeDir)) {
    if (f.endsWith(".tpl")) continue;
    await writeFile(join(options.out, f), await readFile(join(themeDir, f)));
    written.add(f);
  }
  for (const dir of [options.userTemplates, options.templates]) {
    if (!dir || !existsSync(dir)) continue;
    for (const f of (await readdir(dir)).filter(x => x.endsWith(".tpl"))) {
      const target = f.slice(0, -4);
      if (written.has(target)) continue;
      await writeFile(join(options.out, target), render(await readFile(join(dir, f), "utf8"), colors));
      written.add(target);
    }
  }
  return { name, files: [...written].sort() };
}
