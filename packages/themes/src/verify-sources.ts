#!/usr/bin/env bun
// Re-fetches the vendor sources (network) and compares them with tokens/*.tokens.json:
//   Apple HIG color.md (system colors) and typography.md (Large and macOS text styles),
//   WinUI Common_themeresources_any.xaml (Light and Dark dictionaries).
// Run by hand or in CI with network; unit tests never touch the network.
import { join } from "node:path";

const tok = async (f: string) =>
  JSON.parse(await Bun.file(join(import.meta.dir, "..", "tokens", f)).text());
const hex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
let bad = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(
      `MISMATCH ${what}: tokens=${JSON.stringify(want)} vendor=${JSON.stringify(got)}`,
    );
    bad++;
  }
};

// Apple colors: "![R-255,G-56,B-60](colors-unified-red-light.png)" cells of the SwiftUI table.
const hig = await (
  await fetch(
    "https://developer.apple.com/design/human-interface-guidelines/color.md",
  )
).text();
const apple = await tok("apple-glass.tokens.json");
const vendor: Record<string, { light: string; dark: string }> = {};
for (const m of hig.matchAll(
  /^\|(Red|Orange|Yellow|Green|Blue|Purple|Pink)\s*\|[^|]*\|!\[R-(\d+),G-(\d+),B-(\d+)\][^|]*\|!\[R-(\d+),G-(\d+),B-(\d+)\]/gm,
)) {
  vendor[m[1]!.toLowerCase()] = {
    light: hex(+m[2]!, +m[3]!, +m[4]!),
    dark: hex(+m[5]!, +m[6]!, +m[7]!),
  };
}
if (Object.keys(vendor).length !== 7)
  throw new Error(`HIG table not parsed: ${Object.keys(vendor)}`);
for (const [k, v] of Object.entries(vendor)) {
  eq(`apple accent ${k} light`, v.light, apple.accent[k].$value);
  eq(`apple accent ${k} dark`, v.dark, apple.accentDark[k].$value);
}
const typo = await (
  await fetch(
    "https://developer.apple.com/design/human-interface-guidelines/typography.md",
  )
).text();
const rows = (start: string, end: string) => {
  const i = typo.indexOf(start);
  const part = typo.slice(i, typo.indexOf(end, i));
  const out: Record<string, [number, number]> = {};
  for (const m of part.matchAll(
    /\|\s*(Large Title|Title 1|Title 2|Title 3|Headline|Body|Callout|Subhead(?:line)?|Footnote|Caption 1|Caption 2)\s*\|[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g,
  ))
    out[m[1]!] = [+m[2]!, +m[3]!];
  return out;
};
const names: Record<string, string> = {
  "Large Title": "largeTitle",
  "Title 1": "title1",
  "Title 2": "title2",
  "Title 3": "title3",
  Headline: "headline",
  Body: "body",
  Callout: "callout",
  Subhead: "subhead",
  Subheadline: "subhead",
  Footnote: "footnote",
  "Caption 1": "caption1",
  "Caption 2": "caption2",
};
for (const [label, start, end, key] of [
  ["ios", "#### Large (default)", "**xLarge:**", "ramp"],
  ["mac", "### macOS built-in text styles", "### tvOS built-in", "rampMac"],
] as const) {
  const v = rows(start, end);
  if (Object.keys(v).length < 11)
    throw new Error(`HIG ${label} typography not parsed`);
  for (const [n, [size, line]] of Object.entries(v))
    eq(
      `apple ${label} ${n}`,
      [size, line],
      [
        apple.typography[key][names[n]!].size,
        apple.typography[key][names[n]!].line,
      ],
    );
}

// WinUI: <Color x:Key="TextFillColorPrimary">#E4000000</Color> inside the Light then Dark ThemeDictionary (the file lists Dark first).
const xaml = await (
  await fetch(
    "https://raw.githubusercontent.com/microsoft/microsoft-ui-xaml/main/controls/dev/CommonStyles/Common_themeresources_any.xaml",
  )
).text();
const dicts = xaml.split(/<ResourceDictionary x:Key="/).slice(1);
const pick = (name: string) => dicts.find((d) => d.startsWith(name))!;
const fl = await tok("fluent-win11.tokens.json");
const map: Record<string, string> = {
  bg: "SolidBackgroundFillColorBase",
  bgAlt: "SolidBackgroundFillColorSecondary",
  surface: "SolidBackgroundFillColorTertiary",
  surfaceRaised: "SolidBackgroundFillColorQuarternary",
  layer: "LayerFillColorDefault",
  fg: "TextFillColorPrimary",
  fgMuted: "TextFillColorSecondary",
  fgSubtle: "TextFillColorTertiary",
  fgDisabled: "TextFillColorDisabled",
  border: "ControlStrokeColorDefault",
  borderStrong: "ControlStrongStrokeColorDefault",
  divider: "DividerStrokeColorDefault",
  control: "ControlFillColorDefault",
  controlHover: "ControlFillColorSecondary",
  controlPressed: "ControlFillColorTertiary",
  onAccent: "TextOnAccentFillColorPrimary",
  danger: "SystemFillColorCritical",
  warning: "SystemFillColorCaution",
  success: "SystemFillColorSuccess",
  focus: "FocusStrokeColorOuter",
};
const argb = (s: string) =>
  (s.length === 9 ? `#${s.slice(3)}${s.slice(1, 3)}` : s).toUpperCase();
for (const scheme of ["Light", "Dark"]) {
  const d = pick(scheme === "Dark" ? "Default" : "Light");
  for (const [slot, key] of Object.entries(map)) {
    const m = new RegExp(`<Color x:Key="${key}">(#[0-9A-Fa-f]+)</Color>`).exec(
      d,
    );
    if (!m) throw new Error(`${scheme}/${key} missing`);
    eq(
      `fluent ${scheme}.${slot} (${key})`,
      argb(m[1]!),
      fl.color[scheme.toLowerCase()][slot].$value.toUpperCase(),
    );
  }
}
console.log(
  bad
    ? `${bad} mismatches`
    : "vendor sources match the tokens (Apple HIG colors + type, WinUI Light/Dark)",
);
process.exit(bad ? 1 : 0);
