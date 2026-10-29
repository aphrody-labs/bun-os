// Renderer WebGPU 2D pixel-perfect du menu IEVR + wrapper React avec fallback DOM.

export {
  WebGpuMenuRenderer,
  buildDrawList,
  buildGlyphInstances,
  hexToRgba01,
  FLOATS_PER_GLYPH,
  assetUrl,
  parseHexColor,
  computeLetterbox,
  mapWithConcurrency,
  fetchWithRetry,
  SPRITE_FETCH_CONCURRENCY,
  SPRITE_FETCH_RETRIES,
  CANVAS_SIZE,
} from "./renderer";
export type { DrawItem, FontAtlasConfig } from "./renderer";

export {
  decodeFontMetrics,
  parseFontMetrics,
  layoutText,
  measureText,
  glyphUV,
  sjisCodeToUnicode,
  computeOutlinePixel,
  OUTLINE_OFFSETS,
} from "./glyph-atlas";
export type { Glyph, GlyphAtlas, GlyphQuad, GlyphUV, AtlasInfo, TextLayout, RawFontMetrics, Rgba } from "./glyph-atlas";

export { blendForDrawType, projectOrtho, DRAW_TYPES } from "./blend";
export type { BlendState, BlendComponent } from "./blend";

export { renderTextBitmap, textCacheKey } from "./text-atlas";
export type { TextBitmap } from "./text-atlas";

export { GameMenuGpu, shouldUseWebGpu } from "./game-menu-gpu";
export type { GameMenuGpuProps } from "./game-menu-gpu";

// Ré-export du contrat (provenant de @aphrody/menu-render) pour confort.
export type {
  MenuLayout,
  MenuObject,
  MenuObjectOverride,
  MenuTransform,
  MenuSprite,
  MenuText,
} from "@aphrody/menu-render";

// NB : AvatarRenderer3d / cpk-loader importent nie-wasm (glue wasm-pack qui require 'fs')
// → casse le bundle navigateur Turbopack d'azalee. Ils ne sont PAS ré-exportés par l'index
// (aucun consommateur externe) ; importer directement le sous-module si besoin (et rebuild
// nie-wasm en --target web pour le navigateur). GameMenuGpu/renderer n'en dépendent pas.
// export { AvatarRenderer3d } from "./avatar-renderer-3d";
// export type { AvatarPart, GeometryData } from "./avatar-renderer-3d";
