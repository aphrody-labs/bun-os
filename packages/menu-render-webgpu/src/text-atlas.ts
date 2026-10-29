/**
 * Texte → texture (MVP) pour le renderer WebGPU.
 *
 * Stratégie MVP : un canvas2d par label. `fillText` avec la police du jeu (`nie_main`,
 * `nie_bold`, …, @font-face injectée comme dans `<GameMenu>`), fallback sans-serif. Le
 * canvas obtenu est uploadé en texture via `copyExternalImageToTexture`.
 *
 * Phase 2 (fidélité — IMPLÉMENTÉE dans `glyph-atlas.ts`) : l'atlas de glyphes RÉEL du jeu
 * (`font_def.png` 4096×2048 + `font_metrics.json`) est porté côté WebGPU avec le contour
 * 8-tap exact de `2d_font_outline.pfxo`. Le renderer route le texte vers cet atlas quand
 * un `FontAtlasConfig` est fourni à `create()` ; CE module (canvas2d) reste le **fallback**
 * quand l'atlas n'est pas disponible (asset manquant / config absente).
 *
 * Ce module est pur DOM/Canvas2D (aucune API GPU) : testable en jsdom pour la logique de
 * dimensionnement ; le rendu réel des glyphes exige un navigateur.
 */

import type { MenuText } from "@aphrody/menu-render";

/** Résultat du rendu d'un label : un canvas prêt à uploader + ses dimensions px. */
export interface TextBitmap {
  /** Source uploadable via `device.queue.copyExternalImageToTexture`. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  /** Décalage X (px) du coin haut-gauche du quad selon l'alignement. */
  offsetX: number;
}

const TEXT_PADDING = 2;
const LINE_HEIGHT_FACTOR = 1.2;
const DPR_CAP = 3;

const createCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const cssFont = (text: MenuText): string => `${text.size}px "${text.font}", "Noto Sans JP", sans-serif`;

/**
 * Mesure puis rend un `MenuText` (ou une valeur override) dans un canvas2d.
 *
 * @param text       Réglage de texte du MenuObject (police, taille, couleur, align).
 * @param value      Valeur à afficher (override Lua ou `text.value`).
 * @param dpr        devicePixelRatio (le canvas est suréchantillonné pour rester net).
 * @returns          `null` si la valeur est vide ou si le contexte 2D est indisponible.
 */
export function renderTextBitmap(text: MenuText, value: string, dpr = 1): TextBitmap | null {
  if (value.length === 0) {
    return null;
  }
  const scale = Math.max(1, Math.min(DPR_CAP, dpr));

  // 1er passage : mesure (canvas minimal).
  const probe = createCanvas(1, 1);
  const pctx = probe.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!pctx) {
    return null;
  }
  pctx.font = cssFont(text);
  const metrics = pctx.measureText(value);
  const textW = Math.ceil(metrics.width) + TEXT_PADDING * 2;
  const textH = Math.ceil(text.size * LINE_HEIGHT_FACTOR) + TEXT_PADDING * 2;

  const canvas = createCanvas(Math.ceil(textW * scale), Math.ceil(textH * scale));
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return null;
  }
  ctx.scale(scale, scale);
  ctx.font = cssFont(text);
  ctx.fillStyle = text.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(value, TEXT_PADDING, textH / 2);

  // Décalage horizontal selon l'alignement : le pivot du MenuObject reste son anchor,
  // mais le quad texte doit être recentré/aligné par rapport à sa largeur.
  let offsetX = 0;
  if (text.align === "center") {
    offsetX = -textW / 2;
  } else if (text.align === "right") {
    offsetX = -textW;
  }

  return { canvas, width: textW, height: textH, offsetX };
}

/** Clé de cache d'un label (texte + style). Mémoïse les textures texte inchangées. */
export function textCacheKey(text: MenuText, value: string): string {
  return `${text.font}|${text.size}|${text.color}|${text.align}|${value}`;
}
