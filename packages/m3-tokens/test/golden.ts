// SPDX-License-Identifier: Apache-2.0
// Golden output of the canonical engine (crates/aphrody-m3-tokens/tests/fixtures), which the Rust
// parity tests pin bit-for-bit. The wasm build behind ./dynamic-color must reproduce it exactly.
import type { SchemeVariant } from "../src/dynamic-color.ts";

const fixtures = new URL("../../../crates/aphrody-m3-tokens/tests/fixtures/", import.meta.url);

export interface GoldenScheme {
  seed: number;
  variant: string;
  dark: boolean;
  contrast: number;
  roles: Record<string, number>;
}

interface SchemeFixture {
  schemes: GoldenScheme[];
}

const read = async <T>(name: string) => (await Bun.file(new URL(name, fixtures)).json()) as T;

const mcu = await read<SchemeFixture & { hct: number[][]; solve: number[][] }>("mcu.json");
const fidelity = await read<SchemeFixture>("mcu-fidelity.json");

/** Every golden scheme: 7 variants x 8 seeds x 2 modes x 4 contrast levels, plus content and fidelity. */
export const GOLDEN_SCHEMES: readonly GoldenScheme[] = [...mcu.schemes, ...fidelity.schemes];

/** `[argb, hue, chroma, tone]` rows. */
export const GOLDEN_HCT: readonly number[][] = mcu.hct;

/** `[hue, chroma, tone, argb]` rows. */
export const GOLDEN_SOLVE: readonly number[][] = mcu.solve;

/** Identity seed, its ThemeExport for tonal spot at contrast -1, 0, 0.5 and 1. */
export const GOLDEN_PET = await read<{
  seed: string;
  variant: string;
  schemes: { contrast_level: number; light: Record<string, string>; dark: Record<string, string> }[];
}>("mcu-pet.json");

export const GOLDEN_IMAGES = (
  await read<{ images: { name: string; quantized: [number, number][]; sourceColor: number }[] }>("mcu-image.json")
).images;

/** `tonal-spot` -> `tonalSpot`. */
export function camelVariant(name: string): SchemeVariant {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as SchemeVariant;
}

export function hex(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}
