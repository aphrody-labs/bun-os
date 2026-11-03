// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3-fonts: typed manifest of the Aphrody M3 typefaces. Paths are relative to this
// package root. The variable TrueType sources (fonts/*.ttf, and fonts/upstream/ fetched and
// hash-checked from fonts.lock.json by `bun scripts/m3/fonts-sync.ts` at the repository root) are subset
// into WOFF2 web fonts under fonts/web by `bun run subset` (fontTools through uv); `src/subsets.json`
// records the produced files and their unicode-range. Four stylesheets are generated:
//   src/fonts.css          Latin core faces + `--aphrody-font-*` stacks (always imported)
//   src/fonts-jp.css       Japanese faces, chunked by unicode-range (fetched block by block)
//   src/fonts-symbols.css  Material Symbols subset: the icons the workspace renders (opt-in;
//                          @aphrody/m3-icons renders SVG), names in src/symbols-subset.json
//   src/fonts-symbols-full.css  the full Material Symbols fonts (opt-in)
// See docs/design/FONTS-AND-ICONS.md.
import subsets from "./subsets.json" with { type: "json" };
import symbolsSubset from "./symbols-subset.json" with { type: "json" };

export type FontRole = "brand" | "plain" | "code" | "icon";
export type FontScript = "latin" | "japanese";
export type FontSheet = "core" | "jp" | "symbols" | "symbols-full";

export interface FontFace {
  family: string;
  file: string;
  format: "truetype" | "woff2";
  weight: [number, number];
  style: "normal" | "italic";
  display: "swap" | "block";
  license: "OFL-1.1" | "Apache-2.0";
  licenseFile: string | null;
  unicodeRange?: string;
  /** `wdth` axis range, emitted as `font-stretch` percentages. */
  stretch?: [number, number];
  /** `slnt` axis range in degrees, emitted as `font-style: oblique`. */
  oblique?: [number, number];
}

export interface FontFamily {
  family: string;
  role: FontRole;
  script: FontScript;
  sheet: FontSheet;
  /** Upstream of the source file. */
  source: string;
  /** Variable TrueType source, relative to the package root (native renderers, re-subsetting). */
  sourceFile: string;
  faces: FontFace[];
}

/** One subsetting job: a variable source font turned into one (Latin) or many (JP) WOFF2 faces. */
export interface SubsetJob {
  id: string;
  /** Source font, relative to the package root. */
  source: string;
  /** Output pattern relative to the package root; `{n}` receives the chunk suffix. */
  out: string;
  /** Inclusive codepoint ranges kept (intersected with the font cmap). */
  ranges: [number, number][];
  /** Japanese: `ranges` form chunk 00, Windows-31J ideographs follow in chunks of `chunk`. */
  japanese?: boolean;
  chunk?: number;
  /** Material Symbols: keep the icons `names` (ligatures, codepoints, every variation axis). */
  symbols?: boolean;
  names?: readonly string[];
  /** Axes instanced at a fixed value before subsetting (fontTools varLib.instancer). Web text faces keep `wght` and `opsz` (what M3 type and `font-optical-sizing: auto` use); the other axes are pinned to their defaults, which cuts the face by an order of magnitude. */
  pin?: Readonly<Record<string, number>>;
}

/** Produced face, as recorded in `src/subsets.json`. */
export interface SubsetFace {
  id: string;
  file: string;
  unicodeRange: string;
  bytes: number;
}

/** Latin core: Basic Latin, Latin-1, Latin Extended A/B, IPA and spacing modifiers, combining
 * marks, Latin Extended Additional (Vietnamese), general punctuation through miscellaneous
 * symbols and arrows (currency, letterlike, number forms, arrows, math, technical, box drawing,
 * geometric shapes), Latin ligatures, BOM and U+FFFD. Greek and Cyrillic fall back to the system. */
export const LATIN_CORE_RANGES: [number, number][] = [
  [0x0000, 0x036f],
  [0x1e00, 0x1eff],
  [0x2000, 0x2bff],
  [0xfb00, 0xfb06],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

/** Japanese chunk 00: CJK symbols and punctuation, kana, kana extensions, enclosed CJK, CJK
 * compatibility and half/full-width forms. Ideographs come in the following chunks. */
export const JAPANESE_BASE_RANGES: [number, number][] = [
  [0x3000, 0x30ff],
  [0x31f0, 0x31ff],
  [0x3200, 0x33ff],
  [0xff00, 0xffef],
];

/** Ideographs per Japanese chunk: one page of text pulls a few chunks, not the whole font. */
export const JAPANESE_CHUNK = 500;

/** Upstream sources pinned in fonts.lock.json and fetched by scripts/m3/fonts-sync.ts (git-ignored). */
export const UPSTREAM_DIR = "fonts/upstream";
const GS = UPSTREAM_DIR;
const MS = `${UPSTREAM_DIR}/material-symbols`;
const SYMBOL_VARIANTS = ["Outlined", "Rounded", "Sharp"] as const;

/** Material Symbols names kept by the default `fonts-symbols.css` subset: the icons the
 * workspace's apps and packages render as font ligatures (`bun run symbols:names`). */
export const SYMBOL_SUBSET_NAMES: readonly string[] = symbolsSubset.names;

export const SUBSET_JOBS: readonly SubsetJob[] = [
  {
    id: "google-sans-flex",
    source: `${GS}/google-sans-flex/GoogleSansFlex-Variable.ttf`,
    out: "fonts/web/GoogleSansFlex-latin.woff2",
    ranges: LATIN_CORE_RANGES,
    pin: { wdth: 100, GRAD: 0, ROND: 0, slnt: 0 },
  },
  {
    id: "google-sans-code",
    source: `${GS}/google-sans-code/GoogleSansCode-Variable.ttf`,
    out: "fonts/web/GoogleSansCode-latin.woff2",
    ranges: LATIN_CORE_RANGES,
  },
  {
    id: "roboto-flex",
    source: "fonts/RobotoFlex-Variable.ttf",
    out: "fonts/web/RobotoFlex-latin.woff2",
    ranges: LATIN_CORE_RANGES,
    pin: { GRAD: 0, wdth: 100, slnt: 0, XOPQ: 96, YOPQ: 79, XTRA: 468, YTUC: 712, YTLC: 514, YTAS: 750, YTDE: -203, YTFI: 738 },
  },
  {
    id: "roboto-mono",
    source: "fonts/RobotoMono-Variable.ttf",
    out: "fonts/web/RobotoMono-latin.woff2",
    ranges: LATIN_CORE_RANGES,
  },
  {
    id: "roboto-mono-italic",
    source: "fonts/RobotoMono-Italic-Variable.ttf",
    out: "fonts/web/RobotoMono-Italic-latin.woff2",
    ranges: LATIN_CORE_RANGES,
  },
  {
    id: "noto-sans-jp",
    source: "fonts/NotoSansJP-Variable.ttf",
    out: "fonts/web/NotoSansJP{n}.woff2",
    ranges: JAPANESE_BASE_RANGES,
    japanese: true,
    chunk: JAPANESE_CHUNK,
  },
  {
    id: "mplus-1-code",
    source: "fonts/MPLUS1Code-Variable.ttf",
    out: "fonts/web/MPLUS1Code{n}.woff2",
    ranges: JAPANESE_BASE_RANGES,
    japanese: true,
    chunk: JAPANESE_CHUNK,
  },
  ...SYMBOL_VARIANTS.map((v): SubsetJob => ({
    id: `material-symbols-${v.toLowerCase()}`,
    source: `${MS}/material-symbols-${v.toLowerCase()}.woff2`,
    out: `fonts/web/MaterialSymbols${v}-subset.woff2`,
    ranges: [],
    symbols: true,
    names: SYMBOL_SUBSET_NAMES,
  })),
];

export const SUBSETS: readonly SubsetFace[] = subsets;

function face(family: string, file: string, licenseFile: string | null, extra: Partial<FontFace> = {}): FontFace {
  return {
    family,
    file,
    format: file.endsWith(".woff2") ? "woff2" : "truetype",
    weight: [100, 900],
    style: "normal",
    display: "swap",
    license: licenseFile ? "OFL-1.1" : "Apache-2.0",
    licenseFile,
    ...extra,
  };
}

/** Faces produced for subset job `id`, each carrying its unicode-range (none before the first
 * `bun run subset`; the package test requires every job to have produced faces). */
function subsetFaces(id: string, family: string, licenseFile: string, extra: Partial<FontFace> = {}): FontFace[] {
  return SUBSETS.filter(s => s.id === id).map(s =>
    face(family, s.file, licenseFile, {
      ...extra,
      unicodeRange: s.unicodeRange,
    }),
  );
}

export const FONTS: readonly FontFamily[] = [
  {
    family: "Google Sans Flex",
    role: "brand",
    script: "latin",
    sheet: "core",
    source: "github.com/google/fonts ofl/googlesansflex (fork aphrody-labs/fonts, vendor/fonts)",
    sourceFile: `${GS}/google-sans-flex/GoogleSansFlex-Variable.ttf`,
    faces: subsetFaces("google-sans-flex", "Google Sans Flex", "fonts/GoogleSansFlex-OFL.txt", {
      weight: [1, 1000],
    }),
  },
  {
    family: "Google Sans Code",
    role: "code",
    script: "latin",
    sheet: "core",
    source: "github.com/google/fonts ofl/googlesanscode (fork aphrody-labs/fonts, vendor/fonts)",
    sourceFile: `${GS}/google-sans-code/GoogleSansCode-Variable.ttf`,
    faces: subsetFaces("google-sans-code", "Google Sans Code", "fonts/GoogleSansCode-OFL.txt", {
      weight: [300, 800],
    }),
  },
  {
    family: "Roboto Flex",
    role: "plain",
    script: "latin",
    sheet: "core",
    source: "github.com/google/fonts ofl/robotoflex",
    sourceFile: "fonts/RobotoFlex-Variable.ttf",
    faces: subsetFaces("roboto-flex", "Roboto Flex", "fonts/RobotoFlex-OFL.txt", {
      weight: [100, 1000],
    }),
  },
  {
    family: "Roboto Mono",
    role: "code",
    script: "latin",
    sheet: "core",
    source: "github.com/google/fonts ofl/robotomono",
    sourceFile: "fonts/RobotoMono-Variable.ttf",
    faces: [
      ...subsetFaces("roboto-mono", "Roboto Mono", "fonts/RobotoMono-OFL.txt", {
        weight: [100, 700],
      }),
      ...subsetFaces("roboto-mono-italic", "Roboto Mono", "fonts/RobotoMono-OFL.txt", {
        weight: [100, 700],
        style: "italic",
      }),
    ],
  },
  {
    family: "Noto Sans JP",
    role: "plain",
    script: "japanese",
    sheet: "jp",
    source: "github.com/google/fonts ofl/notosansjp",
    sourceFile: "fonts/NotoSansJP-Variable.ttf",
    faces: subsetFaces("noto-sans-jp", "Noto Sans JP", "fonts/NotoSansJP-OFL.txt"),
  },
  {
    family: "M PLUS 1 Code",
    role: "code",
    script: "japanese",
    sheet: "jp",
    source: "github.com/google/fonts ofl/mplus1code",
    sourceFile: "fonts/MPLUS1Code-Variable.ttf",
    faces: subsetFaces("mplus-1-code", "M PLUS 1 Code", "fonts/MPLUS1Code-OFL.txt", {
      weight: [100, 700],
    }),
  },
  ...SYMBOL_VARIANTS.map((v): FontFamily => ({
    family: `Material Symbols ${v}`,
    role: "icon",
    script: "latin",
    sheet: "symbols",
    source: "npm material-symbols@0.44.8, subset to SYMBOL_SUBSET_NAMES",
    sourceFile: `${MS}/material-symbols-${v.toLowerCase()}.woff2`,
    // No unicode-range: the face only applies to icon elements, whose ligature text it spells.
    faces: SUBSETS.filter(s => s.id === `material-symbols-${v.toLowerCase()}`).map(s =>
      face(`Material Symbols ${v}`, s.file, null, { weight: [100, 700], display: "block" }),
    ),
  })),
];

/** The full Material Symbols fonts (every icon), served by the opt-in `fonts-symbols-full.css`. */
export const SYMBOLS_FULL: readonly FontFamily[] = SYMBOL_VARIANTS.map((v): FontFamily => {
  const file = `${MS}/material-symbols-${v.toLowerCase()}.woff2`;
  return {
    family: `Material Symbols ${v}`,
    role: "icon",
    script: "latin",
    sheet: "symbols-full",
    source: "npm material-symbols@0.44.8 (the build aphrody crates/ui/bun/icons/material-symbols renders)",
    sourceFile: file,
    faces: [
      face(`Material Symbols ${v}`, file, null, {
        weight: [100, 700],
        display: "block",
      }),
    ],
  };
});

/** Platform faces after the bundled ones: Windows 11 (DirectWrite in WebView2), macOS, then Linux
 * (fontconfig families seen by WebKitGTK). Japanese system faces follow the Latin ones so kana and
 * kanji never pick a Chinese glyph variant when fonts-jp.css is absent or a glyph is missing. */
export const SYSTEM_SANS = `system-ui, "Segoe UI Variable Text", "Segoe UI", -apple-system, "Cantarell", "Noto Sans", "Ubuntu", "DejaVu Sans"`;
export const SYSTEM_SANS_JP = `"Yu Gothic UI", "Meiryo UI", "Hiragino Sans", "Noto Sans CJK JP", "Source Han Sans JP", "IPAexGothic"`;
export const SYSTEM_MONO = `ui-monospace, "Cascadia Mono", "Consolas", "SF Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono"`;
export const SYSTEM_MONO_JP = `"BIZ UDGothic", "MS Gothic", "Noto Sans Mono CJK JP"`;

/** CSS font-family stacks: bundled Latin face, bundled Japanese face (per-glyph fallback), then
 * the platform faces and the generic family. */
export const FONT_STACKS = {
  brand: `"Google Sans Flex", "Roboto Flex", "Noto Sans JP", ${SYSTEM_SANS}, ${SYSTEM_SANS_JP}, sans-serif`,
  plain: `"Roboto Flex", "Noto Sans JP", ${SYSTEM_SANS}, ${SYSTEM_SANS_JP}, sans-serif`,
  code: `"Google Sans Code", "Roboto Mono", "M PLUS 1 Code", ${SYSTEM_MONO}, ${SYSTEM_MONO_JP}, monospace`,
  icon: `"Material Symbols Outlined"`,
} as const satisfies Record<FontRole, string>;

/** Stylesheet file of each sheet, relative to `src/`. */
export const SHEET_FILES = {
  core: "fonts.css",
  jp: "fonts-jp.css",
  symbols: "fonts-symbols.css",
  "symbols-full": "fonts-symbols-full.css",
} as const satisfies Record<FontSheet, string>;

/** Renders the @font-face rules of `sheet` (every sheet but `symbols-full` when omitted); `base` prefixes each file. */
export function fontFaceCss(base = "", sheet?: FontSheet): string {
  return [...FONTS, ...SYMBOLS_FULL]
    .filter(f => (sheet ? f.sheet === sheet : f.sheet !== "symbols-full"))
    .flatMap(f => f.faces)
    .map(x => faceRule(x, `${base}${x.file}`))
    .join("\n\n");
}

/** Renders one @font-face rule for `x`, served from `url`. */
export function faceRule(x: FontFace, url: string): string {
  const style = x.oblique ? `oblique ${x.oblique[0]}deg ${x.oblique[1]}deg` : x.style;
  const lines = [
    `  font-family: "${x.family}";`,
    `  src: url("${url}") format("${x.format}");`,
    `  font-weight: ${x.weight[0]} ${x.weight[1]};`,
  ];
  if (x.stretch) lines.push(`  font-stretch: ${x.stretch[0]}% ${x.stretch[1]}%;`);
  lines.push(`  font-style: ${style};`, `  font-display: ${x.display};`);
  if (x.unicodeRange) lines.push(`  unicode-range: ${x.unicodeRange};`);
  return `@font-face {\n${lines.join("\n")}\n}`;
}

/** The first face declared for `family`; throws when the manifest lacks it. */
export function fontFace(family: string): FontFace {
  const selectedFace = FONTS.find(f => f.family === family)?.faces[0];
  if (!selectedFace) throw new Error(`@aphrody/m3-fonts: unknown family "${family}"`);
  return selectedFace;
}

/** One stylesheet; the core sheet also carries the `--aphrody-font-<role>` custom properties. */
export function renderStylesheet(base = "", sheet: FontSheet = "core"): string {
  const head = `/* SPDX-License-Identifier: Apache-2.0 */\n/* Generated by packages/m3-fonts/scripts/generate.ts; do not edit. */\n`;
  const body = fontFaceCss(base, sheet);
  if (sheet !== "core") return `${head}${body}\n`;
  const vars = Object.entries(FONT_STACKS)
    .map(([k, v]) => `  --aphrody-font-${k}: ${v};`)
    .join("\n");
  return `${head}${body}\n\n:root {\n${vars}\n}\n`;
}

/** Public object layout keeps native/local font paths unchanged and preserves face metadata. */
export function publicFontUrl(file: string, base: string): string {
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Public fonts require an HTTPS base without credentials");
  const name = file.split("/").pop();
  if (!name || !/^[\w.-]+\.woff2$/.test(name)) throw new Error("Invalid public WOFF2 filename");
  return new URL(`m3/fonts/${name}`, url.href.replace(/\/?$/, "/")).href;
}

export function renderPublicStylesheet(base: string, sheet: FontSheet = "core"): string {
  return renderStylesheet("", sheet).replace(
    /url\("([^"\n]+\.woff2)"\)/g,
    (_match, file: string) => `url("${publicFontUrl(file, base)}")`,
  );
}
