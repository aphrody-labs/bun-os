// SPDX-License-Identifier: Apache-2.0
// Colour roles for every emitter come from the Rust owner only: aphrody_m3_tokens::theme::ThemeExport, produced by
// `bunos-design theme` (crates/bunos-design) and validated by @aphrody/m3-tokens/native-theme. No colour maths runs here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nativeThemeColorRoles,
  nativeThemeVariant,
  parseNativeThemeExport,
  type NativeSchemeVariant,
  type NativeThemeExport,
} from "@aphrody/m3-tokens/native-theme";
import type { Mode, Roles, ThemeColors, ThemeInput } from "./types.ts";

const camel = (kebab: string): string => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Theme variants the Rust ThemeRequest accepts, by their camelCase name. */
export const VARIANTS: readonly NativeSchemeVariant[] = [
  "tonalSpot",
  "content",
  "fidelity",
  "expressive",
  "vibrant",
  "neutral",
  "monochrome",
  "rainbow",
  "fruitSalad",
];

/** `#rgb` / `#rrggbb` (case-insensitive, `#` optional) to lowercase `#rrggbb`, or undefined. */
function normalizeSeed(value: string): string | undefined {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map(c => c + c).join("") : m[1]!;
  return `#${h.toLowerCase()}`;
}

/** Validate the theme name and seed; returns the normalised `#rrggbb` seed. */
export function validate(input: ThemeInput): string {
  if (!/^[A-Za-z0-9_-]+$/.test(input.name)) {
    throw new Error(`invalid theme name "${input.name}": use [A-Za-z0-9_-]`);
  }
  const seed = normalizeSeed(input.seed);
  if (!seed) throw new Error(`invalid seed colour "${input.seed}": expected #rrggbb`);
  if (!["light", "dark", "auto"].includes(input.mode)) throw new Error(`invalid theme mode "${input.mode}"`);
  if (
    input.contrastLevel !== undefined &&
    (!Number.isFinite(input.contrastLevel) || input.contrastLevel < -1 || input.contrastLevel > 1)
  )
    throw new RangeError("M3 contrast must be a finite number between -1 and 1");
  if (input.variant !== undefined && !VARIANTS.includes(input.variant))
    throw new Error(`invalid theme variant "${input.variant}"`);
  return seed;
}

const kebabVariant = (v: NativeSchemeVariant): string => v.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/**
 * The Rust ThemeExport for a seed, variant and contrast, from `bunos-design theme` (crates/bunos-design). `bin` defaults
 * to `$BUNOS_DESIGN` or `bunos-design` on PATH; build it with `cargo build -p bunos-design`.
 */
export function rustThemeExport(
  seed: string,
  variant: NativeSchemeVariant = "tonalSpot",
  contrastLevel = 0,
  bin = process.env["BUNOS_DESIGN"] ?? "bunos-design",
): NativeThemeExport {
  return parseNativeThemeExport(JSON.parse(rustThemeExportJson(seed, variant, contrastLevel, bin)));
}

/** The raw `bunos-design theme` JSON (what generated/theme/bunos-m3.json holds byte for byte). */
export function rustThemeExportJson(
  seed: string,
  variant: NativeSchemeVariant = "tonalSpot",
  contrastLevel = 0,
  bin = process.env["BUNOS_DESIGN"] ?? "bunos-design",
): string {
  const cmd = [bin, "theme", "--seed", seed, "--variant", kebabVariant(variant), "--contrast", String(contrastLevel)];
  let r;
  try {
    r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  } catch (e) {
    throw new Error(
      `${bin} is required for the Rust ThemeExport (cargo build -p bunos-design): ${(e as Error).message}`,
    );
  }
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().replaceAll("\r\n", "\n");
}

/** The product seed, `aphrody_identity::design::pet_seed_hex()`, read from its canonical Rust owner. */
export function productSeed(root = join(import.meta.dir, "..", "..", "..")): string {
  const src = readFileSync(join(root, "crates/aphrody-identity/src/design.rs"), "utf8");
  const m = /pub const fn pet_seed_hex\(\)[^{]*\{\s*"(#[\da-f]{6})"/i.exec(src);
  if (!m) throw new Error("crates/aphrody-identity/src/design.rs: pet_seed_hex() not found");
  return m[1]!.toLowerCase();
}

/** Roles are a pure function of the native export and mode. */
const ROLE_CACHE_SIZE = 32;
const roleCache = new Map<string, ThemeColors>();

/**
 * M3 roles for one mode, keyed by camelCase role name, taken unchanged from the Rust ThemeExport in `input.nativeTheme`.
 * The export must match the requested seed, variant and contrast. The result is frozen and memoised.
 */
export function rolesFor(input: ThemeInput, mode: Mode): ThemeColors {
  const seed = validate(input);
  if (input.nativeTheme === undefined)
    throw new Error(
      `Theme "${input.name}" has no Rust ThemeExport: pass --native-theme or build bunos-design (cargo build -p bunos-design)`,
    );
  const native = parseNativeThemeExport(input.nativeTheme);
  if (
    native.seed !== seed ||
    nativeThemeVariant(native) !== (input.variant ?? "tonalSpot") ||
    native.contrast_level !== (input.contrastLevel ?? 0)
  )
    throw new Error("Native theme does not match the requested seed, variant or contrast");
  const key = `${mode}|${JSON.stringify(native)}`;
  const cached = roleCache.get(key);
  if (cached) return cached;
  const roles: Roles = {};
  for (const [k, v] of Object.entries(nativeThemeColorRoles(native, mode === "dark"))) {
    roles[camel(k.replace("--md-sys-color-", ""))] = v.toLowerCase();
  }
  const colors: ThemeColors = Object.freeze({
    mode,
    roles: Object.freeze(roles),
  });
  if (roleCache.size >= ROLE_CACHE_SIZE) roleCache.delete(roleCache.keys().next().value!);
  roleCache.set(key, colors);
  return colors;
}

export const MODES: readonly Mode[] = ["light", "dark"];

export function allModes(input: ThemeInput): ThemeColors[] {
  return MODES.map(m => rolesFor(input, m));
}

export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hex = (n: number): string => n.toString(16).padStart(2, "0");
export const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

/** Windows DWM DWORD for `AccentColor` / `*ColorMenu`: 0xAABBGGRR. */
export function abgr(color: string, alpha = 255): number {
  const [r, g, b] = rgb(color);
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Windows `ColorizationColor` DWORD: 0xAARRGGBB. */
export function argb(color: string, alpha = 255): number {
  const [r, g, b] = rgb(color);
  return ((alpha << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/** sRGB channels as 0..1 floats for RON (rounded to 6 decimals). */
export function unit(color: string): {
  red: string;
  green: string;
  blue: string;
} {
  const [r, g, b] = rgb(color).map(c => (c / 255).toFixed(6));
  return { red: r!, green: g!, blue: b! };
}

export const sanitizeName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, "-");
