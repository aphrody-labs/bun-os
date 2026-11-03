// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/theme.ts — migrate a MUI theme to M3 `--md-sys-*` token CSS (stdout).
 *
 *   bun scripts/theme.ts [theme.json] [--dark dark.json] [--seed #rrggbb]
 *
 * `theme.json` holds the object passed to MUI `createTheme` (palette, typography, shape). Without it
 * the reference MUI light and dark themes are migrated. `--seed` replaces `palette.primary.main`
 * in both modes. Diagnostics go to stderr.
 */
import { MUI_DEFAULT_DARK_THEME, MUI_DEFAULT_THEME, muiThemeToTokens, normalizeHex, type MuiTheme } from "../lib/theme";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(index, 2);
  return value;
};
const usage = "usage: bun scripts/theme.ts [theme.json] [--dark dark.json] [--seed #rrggbb]";
let darkPath: string | undefined;
let seedArg: string | undefined;
try {
  darkPath = option("--dark");
  seedArg = option("--seed");
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(2);
}
if (args.length > 1) {
  console.error(usage);
  process.exit(2);
}
const seed = seedArg === undefined ? undefined : normalizeHex(seedArg);
if (seedArg !== undefined && !seed) {
  console.error(`--seed must be #rgb or #rrggbb, got ${seedArg}`);
  process.exit(2);
}

const read = async (path: string) => (await Bun.file(path).json()) as MuiTheme;
const withSeed = (theme: MuiTheme): MuiTheme =>
  seed ? { ...theme, palette: { ...theme.palette, primary: { ...theme.palette?.primary, main: seed } } } : theme;

const light = args[0] ? await read(args[0]) : MUI_DEFAULT_THEME;
const dark = darkPath ? await read(darkPath) : args[0] ? undefined : MUI_DEFAULT_DARK_THEME;
const { css, lightRoles } = muiThemeToTokens(withSeed(light), { darkTheme: dark && withSeed(dark) });
console.error(`[m3-codemods theme] ${Object.keys(lightRoles).length} colour roles per mode`);
process.stdout.write(css + "\n");
