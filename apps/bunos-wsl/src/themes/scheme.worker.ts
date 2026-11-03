/**
 * Scheme worker: derives the light and dark schemes of a seed with the canonical Material 3 engine
 * (crates/libm3-wasm through @aphrody/m3-tokens/wasm). The engine module is compiled synchronously,
 * which browsers only allow off the main thread for a module of this size.
 */

import { materialWasm } from "@aphrody/m3-tokens/wasm";
import type { SchemeProperties, SchemeSeed } from "./types";

export interface SchemeRequest extends SchemeSeed {
  id: number;
}

export type SchemeReply =
  | { id: number; ok: true; light: SchemeProperties; dark: SchemeProperties }
  | { id: number; ok: false; error: string };

const ROLE_LINE = /^\s*(--md-(?:sys|ext)-color-[a-z-]+):\s*(#[\da-f]{6});$/gm;

function properties(sheet: string): SchemeProperties {
  return Object.fromEntries([...sheet.matchAll(ROLE_LINE)].map((match) => [match[1], match[2]]));
}

function derive({ seed, variant, contrastLevel }: SchemeSeed): { light: SchemeProperties; dark: SchemeProperties } {
  const engine = materialWasm();
  const variantIndex = engine.variantNames.indexOf(variant);
  if (variantIndex < 0) throw new RangeError(`Unknown scheme variant ${variant}`);
  if (!/^#[\da-f]{6}$/i.test(seed)) throw new RangeError(`Seed must be #rrggbb, got ${seed}`);
  const argb = (0xff000000 | Number.parseInt(seed.slice(1), 16)) >>> 0;
  return {
    light: properties(engine.applyDynamicColor(argb, variantIndex, contrastLevel, "light")),
    dark: properties(engine.applyDynamicColor(argb, variantIndex, contrastLevel, "dark")),
  };
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SchemeRequest>) => void) | null;
  postMessage(reply: SchemeReply): void;
};

scope.onmessage = (event) => {
  const { id, ...seed } = event.data;
  try {
    scope.postMessage({ id, ok: true, ...derive(seed) });
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
