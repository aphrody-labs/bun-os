// SPDX-License-Identifier: Apache-2.0
// Runtime entry for the canonical Material 3 engine compiled to WebAssembly (crates/libm3-wasm on
// top of crates/aphrody-m3-tokens). Every colour computed in a browser or in Bun comes from here;
// this module only moves numbers and bytes across the ABI.
import { LIBM3_WASM_BASE64 } from "./libm3-wasm";

/** ABI version this loader speaks (`m3_abi_version`). */
export const MATERIAL_WASM_ABI = 3;

export interface MaterialWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  m3_abi_version: () => number;
  m3_color_count: () => number;
  m3_variant_count: () => number;
  m3_role_name_byte: (role: number, offset: number) => number;
  m3_variant_name_byte: (variant: number, offset: number) => number;
  m3_seed_color: (seed: number, variant: number, contrast: number, mode: number, role: number) => number;
  m3_color: (mode: number, role: number) => number;
  m3_type_size: (role: number) => number;
  m3_shape_radius: (role: number) => number;
  m3_hct_hue: (argb: number) => number;
  m3_hct_chroma: (argb: number) => number;
  m3_hct_tone: (argb: number) => number;
  m3_hct_to_argb: (hue: number, chroma: number, tone: number) => number;
  m3_alloc: (len: number) => number;
  m3_dealloc: (ptr: number, len: number) => void;
  m3_output_ptr: () => number;
  schemeFromSeed: (seed: number, variant: number, contrast: number, mode: number, out: number) => number;
  themeFromImage: (ptr: number, len: number) => number;
  applyDynamicColor: (seed: number, variant: number, contrast: number, mode: number) => number;
}

const FUNCTIONS = [
  "m3_abi_version",
  "m3_color_count",
  "m3_variant_count",
  "m3_role_name_byte",
  "m3_variant_name_byte",
  "m3_seed_color",
  "m3_color",
  "m3_type_size",
  "m3_shape_radius",
  "m3_hct_hue",
  "m3_hct_chroma",
  "m3_hct_tone",
  "m3_hct_to_argb",
  "m3_alloc",
  "m3_dealloc",
  "m3_output_ptr",
  "schemeFromSeed",
  "themeFromImage",
  "applyDynamicColor",
] as const;

export type ThemeMode = "light" | "dark";

/** HCT coordinates of one colour, as computed by the canonical engine. */
export interface HctCoordinates {
  readonly hue: number;
  readonly chroma: number;
  readonly tone: number;
}

export interface MaterialWasm {
  readonly exports: MaterialWasmExports;
  /** Native role names in ABI order (`primary`, `onPrimary`, ...). */
  readonly roleNames: readonly string[];
  /** Native variant names in ABI order (`monochrome`, `tonal-spot`, ...). */
  readonly variantNames: readonly string[];
  /** One role of a seeded scheme as opaque ARGB. */
  seedColor(seed: number, variant: number, contrast: number, mode: ThemeMode, role: number): number;
  /** One role of the baseline scheme as opaque ARGB. */
  color(mode: ThemeMode, role: number): number;
  /** Every role of a seeded scheme as opaque ARGB, in `roleNames` order. */
  schemeFromSeed(seed: number, variant: number, contrast: number, mode: ThemeMode): Uint32Array;
  /** The source colour best suited to a theme, from RGBA8 pixels (`ImageData.data` layout). */
  themeFromImage(rgba: Uint8Array | Uint8ClampedArray): number;
  /** The canonical scheme sheet for one mode: 49 roles plus the extended success and warning roles. */
  applyDynamicColor(seed: number, variant: number, contrast: number, mode: ThemeMode): string;
  hct(argb: number): HctCoordinates;
  hctToArgb(hue: number, chroma: number, tone: number): number;
  typeSize(role: number): number;
  shapeRadius(role: number): number;
}

function checkRequest(seed: number, variant: number, contrast: number, mode: ThemeMode, variants: number): number {
  if (
    (mode !== "light" && mode !== "dark") ||
    !Number.isInteger(seed) ||
    seed < 0xff000000 ||
    seed > 0xffffffff ||
    !Number.isInteger(variant) ||
    variant < 0 ||
    variant >= variants ||
    !Number.isFinite(contrast) ||
    contrast < -1 ||
    contrast > 1
  )
    throw new RangeError("Invalid native Material theme request");
  return mode === "light" ? 0 : 1;
}

function checkArgb(argb: number): number {
  if (!Number.isInteger(argb) || argb < 0 || argb > 0xffffffff) throw new RangeError("Invalid ARGB colour");
  return argb >>> 0;
}

function bind(instance: WebAssembly.Instance): MaterialWasm {
  const exports = instance.exports as MaterialWasmExports;
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error("Missing Material WASM memory");
  for (const name of FUNCTIONS)
    if (typeof exports[name] !== "function") throw new Error(`Missing Material WASM export ${name}`);
  if (
    exports.m3_abi_version() !== MATERIAL_WASM_ABI ||
    exports.m3_color_count() !== 49 ||
    exports.m3_variant_count() !== 9
  )
    throw new Error("Unsupported Material WASM contract");
  const name = (read: (index: number, offset: number) => number, index: number) => {
    const bytes: number[] = [];
    for (let offset = 0; offset < 64; offset++) {
      const byte = read(index, offset);
      if (byte === 0) return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      if (!Number.isInteger(byte) || byte < 1 || byte > 255) throw new Error("Invalid native Material name");
      bytes.push(byte);
    }
    throw new Error("Native Material name exceeds its bound");
  };
  const roleCount = exports.m3_color_count();
  const variantCount = exports.m3_variant_count();
  const roleNames = Object.freeze(
    Array.from({ length: roleCount }, (_, index) => name(exports.m3_role_name_byte, index)),
  );
  const variantNames = Object.freeze(
    Array.from({ length: variantCount }, (_, index) => name(exports.m3_variant_name_byte, index)),
  );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  /** Run `body` with `len` bytes of module memory, released afterwards. */
  const withBuffer = <T>(len: number, body: (ptr: number) => T): T => {
    const ptr = exports.m3_alloc(len) >>> 0;
    if (ptr === 0) throw new RangeError("Material WASM rejected the buffer size");
    try {
      return body(ptr);
    } finally {
      exports.m3_dealloc(ptr, len);
    }
  };
  return Object.freeze({
    exports,
    roleNames,
    variantNames,
    seedColor(seed: number, variant: number, contrast: number, mode: ThemeMode, role: number) {
      const native = checkRequest(seed, variant, contrast, mode, variantCount);
      if (!Number.isInteger(role) || role < 0 || role >= roleCount)
        throw new RangeError("Invalid native Material theme request");
      return exports.m3_seed_color(seed, variant, contrast, native, role) >>> 0;
    },
    color(mode: ThemeMode, role: number) {
      if (mode !== "light" && mode !== "dark") throw new RangeError("Invalid Material theme mode");
      if (!Number.isInteger(role) || role < 0 || role >= roleCount)
        throw new RangeError(`Material color role must be 0..${roleCount - 1}`);
      return exports.m3_color(mode === "light" ? 0 : 1, role) >>> 0;
    },
    schemeFromSeed(seed: number, variant: number, contrast: number, mode: ThemeMode) {
      const native = checkRequest(seed, variant, contrast, mode, variantCount);
      const len = roleCount * 4;
      return withBuffer(len, ptr => {
        if (exports.schemeFromSeed(seed, variant, contrast, native, ptr) !== roleCount)
          throw new RangeError("Invalid native Material theme request");
        return new Uint32Array(exports.memory.buffer.slice(ptr, ptr + len));
      });
    },
    themeFromImage(rgba: Uint8Array | Uint8ClampedArray) {
      if (rgba.length === 0 || rgba.length % 4 !== 0)
        throw new RangeError("Image pixels must be non-empty RGBA8 (four bytes per pixel)");
      return withBuffer(rgba.length, ptr => {
        new Uint8Array(exports.memory.buffer, ptr, rgba.length).set(rgba);
        const argb = exports.themeFromImage(ptr, rgba.length) >>> 0;
        if (argb === 0) throw new RangeError("Material WASM rejected the image pixels");
        return argb;
      });
    },
    applyDynamicColor(seed: number, variant: number, contrast: number, mode: ThemeMode) {
      const native = checkRequest(seed, variant, contrast, mode, variantCount);
      const len = exports.applyDynamicColor(seed, variant, contrast, native) >>> 0;
      if (len === 0) throw new RangeError("Invalid native Material theme request");
      const ptr = exports.m3_output_ptr() >>> 0;
      return decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len));
    },
    hct(argb: number) {
      const value = checkArgb(argb);
      return Object.freeze({
        hue: exports.m3_hct_hue(value),
        chroma: exports.m3_hct_chroma(value),
        tone: exports.m3_hct_tone(value),
      });
    },
    hctToArgb(hue: number, chroma: number, tone: number) {
      if (![hue, chroma, tone].every(Number.isFinite)) throw new RangeError("HCT coordinates must be finite");
      return exports.m3_hct_to_argb(hue, chroma, tone) >>> 0;
    },
    typeSize(role: number) {
      return exports.m3_type_size(role);
    },
    shapeRadius(role: number) {
      return exports.m3_shape_radius(role) >>> 0;
    },
  });
}

/** Load the engine from module bytes served by the host (browser `fetch`, `Bun.file`, ...). */
export async function loadMaterialWasm(bytes: BufferSource): Promise<MaterialWasm> {
  const module = await WebAssembly.compile(bytes);
  return bind(await WebAssembly.instantiate(module, {}));
}

let embedded: MaterialWasm | undefined;

/** The engine compiled from the module bytes shipped in this package, instantiated once. */
export function materialWasm(): MaterialWasm {
  if (embedded) return embedded;
  const bytes = Uint8Array.from(atob(LIBM3_WASM_BASE64), char => char.charCodeAt(0));
  embedded = bind(new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
  return embedded;
}
