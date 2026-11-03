// SPDX-License-Identifier: Apache-2.0
// One Material 3 token source for every Bun OS front end.
//
// Colour roles are the Rust ThemeExport (aphrody_m3_tokens::theme) of the product seed, committed as
// generated/theme/bunos-m3.json by `m3-os-themes native-theme` (crates/bunos-design); shape and typescale come from
// @aphrody/m3-tokens/m3-tokens.css, which is generated from crates/aphrody-m3-tokens. From that single input this module
// emits:
//   css      web sheet (`--md-sys-*`, light + dark)
//   compose  Jetpack Compose Material 3 theme plus the Android values/values-night colour resources and launcher colours
//   flutter  Flutter ThemeData (useMaterial3) with the same ColorScheme, TextTheme and corner scale, the web manifest
//            colours and the Linux runner background
//   cosmic   COSMIC ThemeBuilder RON (delegates to cosmic.ts)
//   desktop  the unified image theme dir under factory/ (explicit target only: that tree has its own owner)
// `m3-os-themes apps` writes them into their consumers (APP_CONSUMERS); `--check` reports drift instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { allModes } from "./color.ts";
import { themeBundle } from "./cosmic.ts";
import { ANSI_SIGNAL } from "./desktops.ts";
import type { Mode, Roles, ThemeInput } from "./types.ts";

export type AppTarget = "css" | "compose" | "flutter" | "cosmic" | "desktop";
export const APP_TARGETS: readonly AppTarget[] = ["css", "compose", "flutter", "cosmic", "desktop"];
/** What `apps` regenerates and checks by default: every consumer inside this package's scope (desktop is explicit). */
export const DEFAULT_APP_TARGETS: readonly AppTarget[] = ["css", "compose", "flutter", "cosmic"];

export interface AppFile {
  target: AppTarget;
  /** Repository-relative destination. */
  path: string;
  content: string;
}

/** Where each generated file lives in the checkout. */
export const APP_CONSUMERS = {
  css: "packages/m3-os-themes/generated/bunos-m3.css",
  compose: "apps/bun-android/app/src/main/kotlin/com/aphrody/android/theme/BunOsTokens.kt",
  androidLight: "apps/bun-android/app/src/main/res/values/colors.xml",
  androidDark: "apps/bun-android/app/src/main/res/values-night/colors.xml",
  flutter: "apps/bunos-flutter-store/lib/theme/bunos_tokens.g.dart",
  flutterManifest: "apps/bunos-flutter-store/web/manifest.json",
  flutterLinux: "apps/bunos-flutter-store/linux/runner/bunos_colors.g.h",
  flutterAndroidLight: "apps/bunos-flutter-store/android/app/src/main/res/values/colors.xml",
  flutterAndroidDark: "apps/bunos-flutter-store/android/app/src/main/res/values-night/colors.xml",
  cosmicLight: "packages/m3-os-themes/generated/cosmic/BunOS-light.ron",
  cosmicDark: "packages/m3-os-themes/generated/cosmic/BunOS-dark.ron",
  /** Desktop theme of the unified image (`bunos-theme-set bunos-m3`): COSMIC builder, Rio terminal, metadata. */
  desktop: "factory/desktop/cosmic-session/rootfs/usr/share/bunos/themes/bunos-m3",
} as const;

export const TYPE_STYLES = [
  "display-large",
  "display-medium",
  "display-small",
  "headline-large",
  "headline-medium",
  "headline-small",
  "title-large",
  "title-medium",
  "title-small",
  "body-large",
  "body-medium",
  "body-small",
  "label-large",
  "label-medium",
  "label-small",
] as const;
export type TypeStyle = (typeof TYPE_STYLES)[number];

export interface TypeMetrics {
  /** All in sp/logical px (1rem = 16). */
  size: number;
  lineHeight: number;
  tracking: number;
  weight: number;
}

export interface StaticTokens {
  corners: Record<string, number>;
  type: Record<TypeStyle, TypeMetrics>;
  fontBrand: string;
  fontPlain: string;
}

/** Shape and typescale parsed from the generated m3-tokens.css (Rust crates/aphrody-m3-tokens owns the values). */
export function staticTokens(
  css = readFileSync(Bun.resolveSync("@aphrody/m3-tokens/m3-tokens.css", import.meta.dir), "utf8"),
): StaticTokens {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/--(md-[a-z0-9-]+):\s*([^;]+);/g)) if (!vars.has(m[1]!)) vars.set(m[1]!, m[2]!.trim());
  const need = (k: string): string => {
    const v = vars.get(k);
    if (v === undefined) throw new Error(`m3-tokens.css lacks --${k}`);
    return v;
  };
  const px = (v: string): number => {
    const n = Number.parseFloat(v);
    if (v.endsWith("rem")) return Math.round(n * 16 * 1000) / 1000;
    return n;
  };
  const corners: Record<string, number> = {};
  for (const [k, v] of vars)
    if (k.startsWith("md-sys-shape-corner-")) corners[k.slice("md-sys-shape-corner-".length)] = px(v);
  const type = {} as Record<TypeStyle, TypeMetrics>;
  for (const s of TYPE_STYLES) {
    const p = `md-sys-typescale-${s}`;
    type[s] = {
      size: px(need(`${p}-size`)),
      lineHeight: px(need(`${p}-line-height`)),
      tracking: px(need(`${p}-tracking`)),
      weight: Number(need(`${p}-weight`)),
    };
  }
  const family = (v: string) => /"([^"]+)"/.exec(v)?.[1] ?? "Roboto";
  return {
    corners,
    type,
    fontBrand: family(need("md-ref-typeface-brand")),
    fontPlain: family(need("md-ref-typeface-plain")),
  };
}

const kebab = (camel: string): string => camel.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const camel = (k: string): string => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const header = (input: ThemeInput, comment: string): string =>
  `${comment} GENERATED by @aphrody/m3-os-themes (bun packages/m3-os-themes/src/cli.ts apps). Do not hand-edit.\n` +
  `${comment} Seed ${input.seed.toLowerCase()}, variant ${input.variant ?? "tonalSpot"}, contrast ${input.contrastLevel ?? 0}; colours from the Rust ThemeExport, shape and typescale from crates/aphrody-m3-tokens.\n`;

// ---------------------------------------------------------------------------------------------------------------- CSS

export function generateCssSheet(input: ThemeInput, tokens = staticTokens()): string {
  const [light, dark] = allModes(input);
  const block = (roles: Roles) =>
    Object.entries(roles)
      .map(([k, v]) => `  --md-sys-color-${kebab(k)}: ${v};`)
      .join("\n");
  const corners = Object.entries(tokens.corners)
    .map(([k, v]) => `  --md-sys-shape-corner-${k}: ${v}px;`)
    .join("\n");
  const type = TYPE_STYLES.map(s => {
    const t = tokens.type[s];
    return `  --md-sys-typescale-${s}-size: ${t.size}px;\n  --md-sys-typescale-${s}-line-height: ${t.lineHeight}px;\n  --md-sys-typescale-${s}-weight: ${t.weight};\n  --md-sys-typescale-${s}-tracking: ${t.tracking}px;`;
  }).join("\n");
  const head = header(input, " *").replace(/^ \*/, "/*").replace(/\n$/, "\n */\n");
  return `${head}
:root {
  color-scheme: light dark;
${block(light!.roles)}
${corners}
${type}
}

@media (prefers-color-scheme: dark) {
  :root {
${block(dark!.roles).replaceAll("\n", "\n  ").replace(/^/, "  ")}
  }
}
`;
}

// ------------------------------------------------------------------------------------------------------------ Compose

/** ColorScheme constructor parameters of androidx.compose.material3 1.4 lightColorScheme()/darkColorScheme(). */
export const COMPOSE_ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceTint",
  "inverseSurface",
  "inverseOnSurface",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "outline",
  "outlineVariant",
  "scrim",
  "surfaceBright",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceContainerLow",
  "surfaceContainerLowest",
  "surfaceDim",
] as const;

const argbHex = (hex: string): string => `0xFF${hex.slice(1).toUpperCase()}`;
const num = (n: number): string => `${n}`;

function role(roles: Roles, name: string): string {
  const v = roles[name];
  if (!v) throw new Error(`scheme lacks role ${name}`);
  return v;
}

export function generateCompose(input: ThemeInput, tokens = staticTokens(), pkg = "com.aphrody.android.theme"): string {
  const [light, dark] = allModes(input);
  const scheme = (fn: string, roles: Roles) =>
    `${fn}(\n${COMPOSE_ROLES.map(r => `    ${r} = Color(${argbHex(role(roles, r))}),`).join("\n")}\n)`;
  const styles = TYPE_STYLES.map(s => {
    const t = tokens.type[s];
    const family = s.startsWith("display") || s.startsWith("headline") || s === "title-large" ? "Brand" : "Plain";
    return `    ${camel(s)} = TextStyle(fontFamily = BunOsFonts.${family}, fontWeight = FontWeight(${t.weight}), fontSize = ${num(t.size)}.sp, lineHeight = ${num(t.lineHeight)}.sp, letterSpacing = ${t.tracking < 0 ? `(${num(t.tracking)})` : num(t.tracking)}.sp),`;
  }).join("\n");
  const c = tokens.corners;
  const corner = (k: string) => {
    const v = c[k];
    if (v === undefined) throw new Error(`m3-tokens.css lacks corner ${k}`);
    return v;
  };
  return `${header(input, "//")}package ${pkg}

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Font roles of the Bun OS typescale (${tokens.fontBrand} / ${tokens.fontPlain} on the web; the platform sans on Android). */
object BunOsFonts {
    val Brand: FontFamily = FontFamily.SansSerif
    val Plain: FontFamily = FontFamily.SansSerif
}

val BunOsLightColors: ColorScheme = ${scheme("lightColorScheme", light!.roles)}

val BunOsDarkColors: ColorScheme = ${scheme("darkColorScheme", dark!.roles)}

val BunOsTypography: Typography = Typography(
${styles}
)

/** M3 corner scale in dp. */
object BunOsCorners {
${Object.entries(c)
  .filter(([k]) => k !== "full")
  .map(
    ([k, v]) =>
      `    const val ${camel(k)
        .replace(/^none$/, "None")
        .replace(/^./, ch => ch.toUpperCase())}: Float = ${v}f`,
  )
  .join("\n")}
}

val BunOsShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(${corner("extra-small")}.dp),
    small = RoundedCornerShape(${corner("small")}.dp),
    medium = RoundedCornerShape(${corner("medium")}.dp),
    large = RoundedCornerShape(${corner("large")}.dp),
    extraLarge = RoundedCornerShape(${corner("extra-large")}.dp),
)

/**
 * Bun OS Material 3 theme. On Android 12+ \`dynamic\` follows the wallpaper (Material You); below that, or with
 * \`dynamic = false\`, the generated Bun OS scheme applies. Typography and shapes are always the Bun OS tokens.
 */
@Composable
fun BunOsTheme(
    dark: Boolean = isSystemInDarkTheme(),
    dynamic: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = when {
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        dark -> BunOsDarkColors
        else -> BunOsLightColors
    }
    MaterialTheme(colorScheme = colors, typography = BunOsTypography, shapes = BunOsShapes, content = content)
}
`;
}

// ------------------------------------------------------------------------------------------------------------ Flutter

/** Flutter ColorScheme named parameters (Flutter 3.22+, including the fixed accent roles). */
export const FLUTTER_ROLES: readonly (readonly [string, string])[] = [
  ["primary", "primary"],
  ["onPrimary", "onPrimary"],
  ["primaryContainer", "primaryContainer"],
  ["onPrimaryContainer", "onPrimaryContainer"],
  ["primaryFixed", "primaryFixed"],
  ["primaryFixedDim", "primaryFixedDim"],
  ["onPrimaryFixed", "onPrimaryFixed"],
  ["onPrimaryFixedVariant", "onPrimaryFixedVariant"],
  ["secondary", "secondary"],
  ["onSecondary", "onSecondary"],
  ["secondaryContainer", "secondaryContainer"],
  ["onSecondaryContainer", "onSecondaryContainer"],
  ["secondaryFixed", "secondaryFixed"],
  ["secondaryFixedDim", "secondaryFixedDim"],
  ["onSecondaryFixed", "onSecondaryFixed"],
  ["onSecondaryFixedVariant", "onSecondaryFixedVariant"],
  ["tertiary", "tertiary"],
  ["onTertiary", "onTertiary"],
  ["tertiaryContainer", "tertiaryContainer"],
  ["onTertiaryContainer", "onTertiaryContainer"],
  ["tertiaryFixed", "tertiaryFixed"],
  ["tertiaryFixedDim", "tertiaryFixedDim"],
  ["onTertiaryFixed", "onTertiaryFixed"],
  ["onTertiaryFixedVariant", "onTertiaryFixedVariant"],
  ["error", "error"],
  ["onError", "onError"],
  ["errorContainer", "errorContainer"],
  ["onErrorContainer", "onErrorContainer"],
  ["surface", "surface"],
  ["onSurface", "onSurface"],
  ["surfaceDim", "surfaceDim"],
  ["surfaceBright", "surfaceBright"],
  ["surfaceContainerLowest", "surfaceContainerLowest"],
  ["surfaceContainerLow", "surfaceContainerLow"],
  ["surfaceContainer", "surfaceContainer"],
  ["surfaceContainerHigh", "surfaceContainerHigh"],
  ["surfaceContainerHighest", "surfaceContainerHighest"],
  ["onSurfaceVariant", "onSurfaceVariant"],
  ["outline", "outline"],
  ["outlineVariant", "outlineVariant"],
  ["shadow", "shadow"],
  ["scrim", "scrim"],
  ["inverseSurface", "inverseSurface"],
  ["onInverseSurface", "inverseOnSurface"],
  ["inversePrimary", "inversePrimary"],
  ["surfaceTint", "surfaceTint"],
];

export function generateFlutter(input: ThemeInput, tokens = staticTokens()): string {
  const [light, dark] = allModes(input);
  const scheme = (mode: Mode, roles: Roles) =>
    `ColorScheme(\n  brightness: Brightness.${mode},\n${FLUTTER_ROLES.map(([dart, r]) => `  ${dart}: Color(${argbHex(role(roles, r))}),`).join("\n")}\n)`;
  const dartStyle = (s: TypeStyle) => {
    const t = tokens.type[s];
    const height = Math.round((t.lineHeight / t.size) * 10000) / 10000;
    return `  ${camel(s)}: TextStyle(fontSize: ${num(t.size)}, height: ${height}, fontWeight: FontWeight.w${Math.round(t.weight / 100) * 100}, letterSpacing: ${num(t.tracking)}),`;
  };
  const c = tokens.corners;
  return `${header(input, "//")}// ignore_for_file: lines_longer_than_80_chars
import 'package:flutter/material.dart';

/// Product seed the generated schemes come from (aphrody_identity::design::pet_seed_hex).
const String bunOsSeed = '${input.seed.toLowerCase()}';

/// Bun OS light scheme.
const ColorScheme bunOsLightScheme = ${scheme("light", light!.roles)};

/// Bun OS dark scheme.
const ColorScheme bunOsDarkScheme = ${scheme("dark", dark!.roles)};

/// M3 typescale (sizes in logical pixels).
const TextTheme bunOsTextTheme = TextTheme(
${TYPE_STYLES.map(dartStyle).join("\n")}
);

/// M3 corner scale in logical pixels.
abstract final class BunOsCorners {
${Object.entries(c)
  .filter(([k]) => k !== "full")
  .map(([k, v]) => `  static const double ${camel(k)} = ${v};`)
  .join("\n")}
}

/// Bun OS ThemeData. Pass a platform \`dynamic\` scheme (Material You) to override the generated colours.
ThemeData bunOsTheme(Brightness brightness, {ColorScheme? dynamic}) {
  final scheme = dynamic ?? (brightness == Brightness.dark ? bunOsDarkScheme : bunOsLightScheme);
  final medium = RoundedRectangleBorder(borderRadius: BorderRadius.circular(BunOsCorners.medium));
  final large = RoundedRectangleBorder(borderRadius: BorderRadius.circular(BunOsCorners.large));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    textTheme: bunOsTextTheme.apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface),
    cardTheme: CardThemeData(shape: medium),
    dialogTheme: DialogThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BunOsCorners.extraLarge))),
    navigationBarTheme: NavigationBarThemeData(indicatorShape: const StadiumBorder()),
    floatingActionButtonTheme: FloatingActionButtonThemeData(shape: large),
    chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BunOsCorners.small))),
  );
}
`;
}

// ------------------------------------------------------------------------------------------------------------ desktop

/** Rio terminal palette from the dark M3 roles: ANSI hues are tone-matched accents of the same scheme. */
export function generateRio(input: ThemeInput): string {
  const dark = allModes(input)[1]!.roles;
  const r = (k: string) => role(dark, k);
  return `${header(input, "#")}[colors]
background = "${r("surface")}"
foreground = "${r("onSurface")}"
cursor = "${r("primary")}"
selection-background = "${r("primaryContainer")}"
selection-foreground = "${r("onPrimaryContainer")}"
tabs = "${r("surfaceContainer")}"
tabs-active = "${r("primary")}"
black = "${r("surfaceContainerHigh")}"
red = "${r("error")}"
green = "${ANSI_SIGNAL.green}"
yellow = "${ANSI_SIGNAL.yellow}"
blue = "${r("primary")}"
magenta = "${r("tertiary")}"
cyan = "${r("secondary")}"
white = "${r("onSurfaceVariant")}"
light-black = "${r("outline")}"
light-red = "${r("onErrorContainer")}"
light-green = "${ANSI_SIGNAL.brightGreen}"
light-yellow = "${ANSI_SIGNAL.brightYellow}"
light-blue = "${r("onPrimaryContainer")}"
light-magenta = "${r("onTertiaryContainer")}"
light-cyan = "${r("onSecondaryContainer")}"
light-white = "${r("onSurface")}"
`;
}

// ------------------------------------------------------------------------------------------------ Android resources

/** Role colours the framework theme (values/styles.xml, values-night/styles.xml) and the launcher icon bind. */
export const ANDROID_ROLES = ["primary", "surface", "onSurface", "onSurfaceVariant"] as const;

const snake = (name: string): string => name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

/**
 * `res/values/colors.xml` (light, plus the launcher brand art colours) or `res/values-night/colors.xml` (dark): the
 * framework resource side of the same scheme, so the window, bars and splash follow DayNight before Compose draws.
 */
export function generateAndroidColors(
  input: ThemeInput,
  mode: Mode,
  names: readonly string[] = ANDROID_ROLES,
  launcher = true,
): string {
  const roles = allModes(input)[mode === "dark" ? 1 : 0]!.roles;
  const lines = names.map(r => `    <color name="bunos_${snake(r)}">${role(roles, r).toUpperCase()}</color>`);
  if (launcher && mode === "light")
    lines.push(
      "    <!-- Launcher brand art: the product seed's primary / on-primary pair. -->",
      `    <color name="launcher_background">${role(roles, "primary").toUpperCase()}</color>`,
      `    <color name="launcher_foreground">${role(roles, "onPrimary").toUpperCase()}</color>`,
    );
  const comment = header(input, "  ").trimEnd();
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
${comment}
-->
<resources>
${lines.join("\n")}
</resources>
`;
}

// -------------------------------------------------------------------------------------------- Flutter web and Linux

/** Flutter Android LaunchTheme / NormalTheme window background before the first frame (values{,-night}/styles.xml). */
export const FLUTTER_ANDROID_ROLES = ["surface"] as const;

/** Flutter web manifest: `background_color` = light surface, `theme_color` = light primary of the product seed. */
export function generateFlutterManifest(input: ThemeInput): string {
  const light = allModes(input)[0]!.roles;
  const manifest = {
    name: "Bun OS Store",
    short_name: "Bun OS Store",
    start_url: ".",
    display: "standalone",
    background_color: role(light, "surface"),
    theme_color: role(light, "primary"),
    description: "Bun OS Store and settings, Material 3, Flutter front of the WebOS store API",
    orientation: "portrait-primary",
    prefer_related_applications: false,
    icons: [
      { src: "icons/Icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/Icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icons/Icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "icons/Icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return `${JSON.stringify(manifest, null, 4)}\n`;
}

/** Linux runner: the window background shown before the first Flutter frame (surface, per GTK dark preference). */
export function generateFlutterLinux(input: ThemeInput): string {
  const [light, dark] = allModes(input);
  return `${header(input, "//")}#pragma once

#define BUNOS_SURFACE_LIGHT "${role(light!.roles, "surface")}"
#define BUNOS_SURFACE_DARK "${role(dark!.roles, "surface")}"
`;
}

// ------------------------------------------------------------------------------------------------------------- driver

/** Every app-facing file, from one input. Pure. */
export function generateApps(input: ThemeInput, targets: readonly AppTarget[] = DEFAULT_APP_TARGETS): AppFile[] {
  const tokens = staticTokens();
  const out: AppFile[] = [];
  if (targets.includes("css"))
    out.push({ target: "css", path: APP_CONSUMERS.css, content: generateCssSheet(input, tokens) });
  if (targets.includes("compose")) {
    out.push({ target: "compose", path: APP_CONSUMERS.compose, content: generateCompose(input, tokens) });
    out.push({ target: "compose", path: APP_CONSUMERS.androidLight, content: generateAndroidColors(input, "light") });
    out.push({ target: "compose", path: APP_CONSUMERS.androidDark, content: generateAndroidColors(input, "dark") });
  }
  if (targets.includes("flutter")) {
    out.push({ target: "flutter", path: APP_CONSUMERS.flutter, content: generateFlutter(input, tokens) });
    out.push({ target: "flutter", path: APP_CONSUMERS.flutterManifest, content: generateFlutterManifest(input) });
    out.push({ target: "flutter", path: APP_CONSUMERS.flutterLinux, content: generateFlutterLinux(input) });
    for (const mode of ["light", "dark"] as const)
      out.push({
        target: "flutter",
        path: mode === "light" ? APP_CONSUMERS.flutterAndroidLight : APP_CONSUMERS.flutterAndroidDark,
        content: generateAndroidColors(input, mode, FLUTTER_ANDROID_ROLES, false),
      });
  }
  if (targets.includes("cosmic")) {
    const [light, dark] = allModes(input);
    out.push({
      target: "cosmic",
      path: APP_CONSUMERS.cosmicLight,
      content: themeBundle(light!.roles, "light", input.name),
    });
    out.push({
      target: "cosmic",
      path: APP_CONSUMERS.cosmicDark,
      content: themeBundle(dark!.roles, "dark", input.name),
    });
  }
  if (targets.includes("desktop")) {
    const dark = allModes(input)[1]!;
    const dir = APP_CONSUMERS.desktop;
    out.push({
      target: "desktop",
      path: `${dir}/cosmic.ron`,
      content: `${header(input, "//")}${themeBundle(dark.roles, "dark", "bunos-m3")}`,
    });
    out.push({ target: "desktop", path: `${dir}/rio.toml`, content: generateRio(input) });
    out.push({
      target: "desktop",
      path: `${dir}/theme.json`,
      content: `${JSON.stringify({ name: "bunos-m3", mode: "dark", icons: "Cosmic", backgrounds: [] }, null, 2)}
`,
    });
    out.push({ target: "desktop", path: `${dir}/bunos-m3.css`, content: generateCssSheet(input, tokens) });
  }
  return out;
}

/** The committed Rust ThemeExport of the product seed (`m3-os-themes native-theme` refreshes it). */
export const PRODUCT_THEME_PATH = join(import.meta.dir, "..", "generated", "theme", "bunos-m3.json");
const PRODUCT_THEME = parseNativeThemeExport(JSON.parse(readFileSync(PRODUCT_THEME_PATH, "utf8")));

/** Bun OS default theme input shared by every front end: the product seed and its Rust ThemeExport. */
export const BUNOS_THEME: ThemeInput = {
  name: "BunOS",
  seed: PRODUCT_THEME.seed,
  variant: "tonalSpot",
  contrastLevel: 0,
  nativeTheme: PRODUCT_THEME,
  mode: "auto",
};
