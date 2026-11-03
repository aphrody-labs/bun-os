// The Fluent 2 brand ramp of Bun OS, taken from the Material 3 primary tonal palette of the canonical engine
// (crates/aphrody-m3-tokens through @aphrody/m3-tokens/wasm). No colour maths happens here: the palette is the seed hue
// at the chroma the engine gave the scheme's primary role, every tone is rendered by the engine, and the ramp is
// rejected unless it reproduces every primary-palette role of the engine's light and dark schemes.
import { PET_COLORS } from "@aphrody/identity/pet";
import { materialWasm } from "@aphrody/m3-tokens/wasm";

/** The product seed (`aphrody_identity::design::pet_seed_hex()`). */
export const PRODUCT_SEED: string = PET_COLORS.seed;

/** Fluent brand step -> M3 tone. Fluent's light theme fills with step 80 and its dark theme draws with step 100; they land
 * on M3 primary (tone 40) and the dark-scheme readable range, so both skins share one accent. */
export const BRAND_TONES = {
  10: 5,
  20: 10,
  30: 15,
  40: 20,
  50: 25,
  60: 30,
  70: 35,
  80: 40,
  90: 50,
  100: 60,
  110: 70,
  120: 80,
  130: 85,
  140: 90,
  150: 95,
  160: 98,
} as const;

export type BrandRamp = Record<keyof typeof BRAND_TONES, string>;

const toHex = (argb: number) => `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;

/** Scheme roles drawn from the primary tonal palette, checked against the ramp's palette. */
const PRIMARY_ROLES = ["primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary"] as const;

/** The primary tonal palette of `seed` (Tonal Spot, standard contrast) at the Fluent brand steps. */
export function brandRamp(seed: string): BrandRamp {
  const m3 = materialWasm();
  const variant = m3.variantNames.indexOf("tonal-spot");
  const argb = (0xff000000 | Number.parseInt(seed.slice(1), 16)) >>> 0;
  const role = (name: string, mode: "light" | "dark") => {
    const index = m3.roleNames.indexOf(name);
    if (variant < 0 || index < 0) throw new Error(`canonical engine lacks tonal-spot or the ${name} role`);
    return m3.seedColor(argb, variant, 0, mode, index);
  };
  const hue = m3.hct(argb).hue;
  const chroma = Math.round(m3.hct(role("primary", "light")).chroma);
  for (const mode of ["light", "dark"] as const) {
    for (const name of PRIMARY_ROLES) {
      const expected = role(name, mode);
      const tone = Math.round(m3.hct(expected).tone);
      if (toHex(m3.hctToArgb(hue, chroma, tone)) !== toHex(expected))
        throw new Error(`${name} (${mode}) of ${seed} is not on the primary palette hue ${hue} chroma ${chroma}`);
    }
  }
  const ramp = {} as BrandRamp;
  for (const [step, tone] of Object.entries(BRAND_TONES))
    ramp[Number(step) as keyof BrandRamp] = toHex(m3.hctToArgb(hue, chroma, tone));
  return ramp;
}
