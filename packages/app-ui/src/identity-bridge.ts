// SPDX-License-Identifier: Apache-2.0
/**
 * Typed client for the Aphrody pet and pixel-perfect commands of the retired `aphrody-app` desktop (engine: `crates/aphrody-identity`)
 * (`crates/ui/app/src/identity.rs`, moved from the retired Inacord host).
 *
 * Argument and field names are the wire contract of those commands; Tauri maps the
 * camelCase keys below onto the snake_case Rust parameters.
 */

import { invoke as tauriInvoke } from "./web-runtime";

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface PetState {
  nom: string;
  atlas: [number, number];
  grille: [number, number];
  animations: string[];
  frames_verifiees: number;
  ok: boolean;
  erreurs: string[];
}

export interface PaletteColor {
  part_pct: number;
  hex: string;
  oklch: string;
  teinte_deg: number;
}

export interface Measurement {
  source_largeur: number;
  source_hauteur: number;
  boite: [number, number, number, number];
  largeur: number;
  hauteur: number;
  ratio: number;
  remplissage_pct: number;
  part_image_pct: number;
  trait_pct: number;
  angle_gauche_deg: number;
  angle_droit_deg: number;
  bord_droiture: number;
  angles_exploitables: boolean;
  palette: PaletteColor[];
}

export interface Comparison {
  ssim: number;
  pixels_dans_tolerance_pct: number;
  tolerance: number;
  identique: boolean;
}

export interface SpriteSheet {
  largeur: number;
  hauteur: number;
  sprites: number;
  png_b64: string;
  css: string;
  svg: string;
  json: string;
}

/** Mask applied before measuring: alpha threshold, dark threshold, or hue window. */
export type MaskMode = "alpha" | "sombre" | "teinte";

export interface MeasureOptions {
  paletteSize?: number;
  bounds?: [number, number, number, number];
  mode?: MaskMode;
  threshold?: number;
  hueMin?: number;
  hueMax?: number;
  saturation?: number;
}

export function createIdentityBridge(invoke: Invoke = tauriInvoke) {
  return {
    petState: () => invoke<PetState>("aphrody_pet_etat"),
    petFramePngBase64: (animation: string, index: number) =>
      invoke<string>("aphrody_pet_frame_png_b64", { animation, index }),
    measure: (path: string, options: MeasureOptions = {}) =>
      invoke<Measurement>("aphrody_pixel_mesurer", {
        chemin: path,
        k: options.paletteSize ?? null,
        boite: options.bounds ?? null,
        mode: options.mode ?? "alpha",
        seuil: options.threshold ?? null,
        teinteMin: options.hueMin ?? null,
        teinteMax: options.hueMax ?? null,
        saturation: options.saturation ?? null,
      }),
    paletteCss: (path: string, prefix: string, paletteSize?: number) =>
      invoke<string>("aphrody_pixel_tokens_css", {
        chemin: path,
        prefixe: prefix,
        k: paletteSize ?? null,
      }),
    compare: (a: string, b: string, tolerance?: number) =>
      invoke<Comparison>("aphrody_pixel_comparer", {
        a,
        b,
        tolerance: tolerance ?? null,
      }),
    vectorize: (
      path: string,
      options: {
        paletteSize?: number;
        tolerance?: number;
        mode?: MaskMode;
        threshold?: number;
      } = {},
    ) =>
      invoke<string>("aphrody_pixel_vectoriser", {
        chemin: path,
        k: options.paletteSize ?? null,
        tolerance: options.tolerance ?? null,
        mode: options.mode ?? "alpha",
        seuil: options.threshold ?? null,
      }),
    spriteSheet: (paths: string[], name: string, columns?: number) =>
      invoke<SpriteSheet>("aphrody_pixel_planche", {
        chemins: paths,
        colonnes: columns ?? null,
        nom: name,
      }),
  };
}

export type IdentityBridge = ReturnType<typeof createIdentityBridge>;
