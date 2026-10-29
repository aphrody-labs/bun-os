/**
 * WebGpuMenuRenderer — renderer WebGPU 2D pixel-perfect d'un écran de menu IEVR.
 *
 * - Un quad texturé instancié par sprite, projection ortho 1280×720 (origine haut-gauche).
 * - Sampler **nearest** (pixel-perfect), **premultiplied alpha** (canvas + textures).
 * - Blend par `drawType` (0 over / 1 additive / 2 multiply), z-order **painter** par
 *   `drawPriority` (tri croissant = dessiné en dernier au-dessus).
 * - Textures via `createImageBitmap` → `device.queue.copyExternalImageToTexture`.
 * - Texte (MVP) : canvas2d → texture (`text-atlas.ts`).
 *
 * Le placement reproduit `objectStyle` du DOM `<GameMenu>` : pivot = (x,y), décalage
 * `-anchor*size`, scale puis rotate(rot rad).
 *
 * La logique pure (construction de la draw-list, application des overrides) est exposée
 * via `buildDrawList`/`applyOverrides` pour la vérification headless ; le rendu GPU réel
 * exige un navigateur.
 */

import type { MenuLayout, MenuObject, MenuObjectOverride, MenuText } from "@aphrody/menu-render";
import { blendForDrawType } from "./blend";
import { renderTextBitmap, textCacheKey, type TextBitmap } from "./text-atlas";
import { type GlyphAtlas, layoutText, parseFontMetrics } from "./glyph-atlas";

/* ── Atlas de police (rendu de glyphes pixel-perfect) ───────────────────────── */

/**
 * Configuration d'un atlas de glyphes pour le rendu de texte pixel-perfect.
 * Si fourni à `create()`, le texte du menu est rendu via l'atlas du jeu (+ contour
 * 8-tap) au lieu du fallback `canvas2d.fillText`.
 */
export interface FontAtlasConfig {
  /** URL du `font_metrics.json` (décodé en `GlyphAtlas`). */
  metricsUrl: string;
  /** URL du PNG d'atlas page 0 (`font_def`, 4096×2048). */
  atlasUrl: string;
  /** URL optionnelle de la page 1 (gaiji). */
  gaijiUrl?: string;
  /** Couleur de contour par défaut (hex CSS). Défaut : noir (`#000000`). */
  outlineColor?: string;
  /** Demi-largeur du contour en px à 1280×720. Défaut : 1.5. */
  outlineWidthPx?: number;
}

const CANVAS_W = 1280;
const CANVAS_H = 720;
const DEFAULT_SPRITE_W = 256;
const DEFAULT_SPRITE_H = 64;

// 18 floats / instance : pos(2) size(2) scale(2) anchor(2) rotOp(2) uvRect(4) tint(4).
const FLOATS_PER_INSTANCE = 18;
const BYTES_PER_FLOAT = 4;
const INSTANCE_STRIDE = FLOATS_PER_INSTANCE * BYTES_PER_FLOAT;

/* ── helpers d'URL (miroir de game-menu.tsx) ─────────────────────────────────── */

/** Construit l'URL d'un asset depuis assetBase + pngUrl (évite le double slash). */
export function assetUrl(assetBase: string, pngUrl: string): string {
  let base = assetBase;
  if (assetBase.endsWith("/")) {
    base = assetBase.slice(0, -1);
  }
  let path = pngUrl;
  if (!pngUrl.startsWith("/")) {
    path = `/${pngUrl}`;
  }
  return `${base}${path}`;
}

/* ── chargement réseau (concurrence bornée + retry) ──────────────────────────── */

/**
 * Nombre max de fetches de sprites simultanés. Le CDN retombe sur un décodeur g4tx→png
 * **live** (iecode-cdn) quand le PNG n'est pas dans le dump ; ce décodeur (~8.6s/g4tx à
 * froid) **sature sous burst** (mesuré : 7/12 requêtes parallèles échouent). On borne donc
 * la concurrence pour étaler la charge plutôt que de noyer le décodeur.
 */
export const SPRITE_FETCH_CONCURRENCY = 6;

/** Nombre de tentatives supplémentaires sur échec transitoire (404 décode-à-froid / réseau). */
export const SPRITE_FETCH_RETRIES = 2;

/** Délais de backoff (ms) entre tentatives — index = numéro de retry (0-based). */
const SPRITE_RETRY_BACKOFF_MS = [200, 600];

/** Attente non bloquante (no-op si pas de timer, ex. environnement de test). */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Applique `worker` à chaque élément de `items` avec une concurrence bornée à `limit`.
 *
 * Une simple file partagée : `limit` "runners" tirent le prochain index tant qu'il en reste.
 * Évite de lancer N fetches d'un coup (qui noient le décodeur live du CDN). Les rejets
 * individuels sont absorbés par le `worker` (qui ne doit pas throw) ; on `await` la fin de
 * tous les runners.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const max = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) {
        return;
      }
      await worker(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: max }, () => runner()));
}

/**
 * `fetch` avec retries sur échec transitoire (statut non-OK ou erreur réseau).
 *
 * Le « 404 » du CDN est le plus souvent un **décodage g4tx→png à froid qui a timeout**
 * (≈8.6s), pas un vrai miss : une 2ᵉ requête tombe sur le décode désormais chaud et réussit.
 * On retente donc `retries` fois avec un petit backoff avant d'abandonner. Retourne la
 * dernière `Response` (OK ou non) ou `null` si toutes les tentatives ont jeté une erreur réseau.
 */
export async function fetchWithRetry(url: string, retries: number): Promise<Response | null> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res;
      }
      lastResponse = res;
    } catch {
      lastResponse = null;
    }
    if (attempt < retries) {
      await delay(
        SPRITE_RETRY_BACKOFF_MS[attempt] ?? SPRITE_RETRY_BACKOFF_MS[SPRITE_RETRY_BACKOFF_MS.length - 1] ?? 600,
      );
    }
  }
  return lastResponse;
}

/* ── draw-list (logique pure, testable headless) ─────────────────────────────── */

/** Un item de dessin : ce qu'il faut pour émettre une instance. */
export interface DrawItem {
  name: string;
  drawPriority: number;
  drawType: number;
  /** Position du pivot (px canvas). */
  x: number;
  y: number;
  /** Taille du quad (px). */
  w: number;
  h: number;
  scaleX: number;
  scaleY: number;
  rot: number;
  anchorX: number;
  anchorY: number;
  /** Opacité 0..1 (primitive.alpha ou 1). */
  opacity: number;
  /** Source de texture : un sprite PNG, un texte, ou une primitive (couleur unie). */
  kind: "sprite" | "text" | "primitive";
  /** URL du PNG (kind=sprite). */
  pngUrl?: string;
  /** Réglage texte (kind=text). */
  text?: MenuText;
  /** Valeur texte résolue (override ou statique) (kind=text). */
  textValue?: string;
  /** Couleur de remplissage hex (kind=primitive). */
  primitiveColor?: string;
}

const spriteSize = (obj: MenuObject): { w: number; h: number } => {
  if (obj.sprite) {
    return { w: obj.sprite.w, h: obj.sprite.h };
  }
  if (obj.primitive) {
    return { w: obj.primitive.w, h: obj.primitive.h };
  }
  return { w: DEFAULT_SPRITE_W, h: DEFAULT_SPRITE_H };
};

/**
 * Construit la liste ordonnée (painter) d'items à dessiner pour un layout + overrides.
 *
 * - `override.visible === false` → l'objet est **omis** (pas d'instance).
 * - `override.text ?? String(override.number)` remplace la valeur texte.
 * - Tri stable par `drawPriority` croissant (haute priorité = au-dessus = dernière).
 *
 * Pur : aucune dépendance GPU. C'est le cœur testé en headless.
 */
/** Langue d'affichage du texte de menu (clé de `MenuText.localized`). */
export type MenuLang = "fr" | "en" | "ja";

/**
 * Libellé d'un node texte pour la langue demandée : `localized[lang]` si présent
 * (layouts post-traités par `resolve-menu-text.ts`), sinon repli sur `value` (qui
 * est déjà le libellé FR par défaut pour les layouts non encore enrichis).
 */
export function localizedTextValue(text: MenuText, lang: MenuLang): string {
  return text.localized?.[lang] ?? text.value;
}

export function buildDrawList(
  layout: MenuLayout,
  overrides: Record<string, MenuObjectOverride> = {},
  lang: MenuLang = "fr",
): DrawItem[] {
  const items: DrawItem[] = [];

  for (const obj of layout.objects) {
    const ov = overrides[obj.name];
    if (ov?.visible === false) {
      continue;
    }

    const { w, h } = spriteSize(obj);
    const base = {
      name: obj.name,
      drawPriority: obj.drawPriority,
      drawType: obj.drawType,
      x: obj.transform.x,
      y: obj.transform.y,
      w,
      h,
      scaleX: obj.transform.scaleX,
      scaleY: obj.transform.scaleY,
      rot: obj.transform.rot,
      anchorX: obj.transform.anchorX,
      anchorY: obj.transform.anchorY,
    };

    if (obj.sprite) {
      items.push({ ...base, opacity: 1, kind: "sprite", pngUrl: obj.sprite.pngUrl });
    } else if (obj.text) {
      const liveText = ov?.text ?? (ov?.number !== undefined ? String(ov.number) : localizedTextValue(obj.text, lang));
      items.push({
        ...base,
        opacity: 1,
        kind: "text",
        text: obj.text,
        textValue: liveText,
      });
    } else if (obj.primitive) {
      items.push({
        ...base,
        opacity: obj.primitive.alpha,
        kind: "primitive",
        primitiveColor: obj.primitive.color,
      });
    }
  }

  // Tri painter stable par drawPriority croissant.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.drawPriority - b.item.drawPriority || a.i - b.i)
    .map(e => e.item);
}

/* ── instances de glyphes (logique pure, testable headless) ──────────────────── */

// 26 floats / instance de glyphe :
//   pos(2) size(2) scale(2) anchor(2) rot+pad(2) uvRect(4) fill(4) outline(4) outlineP(4)
export const FLOATS_PER_GLYPH = 26;
const GLYPH_STRIDE = FLOATS_PER_GLYPH * BYTES_PER_FLOAT;

/** Couleur normalisée 0..1 (rgba) depuis un hex CSS (#rgb/#rrggbb), alpha = 1. */
export function hexToRgba01(hex: string): [number, number, number, number] {
  const [r, g, b] = parseHexColor(hex);
  return [r / 255, g / 255, b / 255, 1];
}

/**
 * Construit le tableau d'instances de glyphes (floats empaquetés) d'un label texte.
 *
 * Chaque glyphe devient une instance positionnée par `layoutText`. La géométrie suit
 * le même modèle que les sprites (pivot = `item.x/y`, décalage `-anchor*size`, scale,
 * rotation). L'anchor du quad de glyphe est (0,0) : le coin haut-gauche du glyphe est
 * placé à la position calculée, additionnée au pivot du MenuObject selon son align.
 *
 * Le contour est ON par défaut (le texte de menu IEVR a un liseré sombre systématique).
 *
 * Pur : aucune dépendance GPU. Retourne aussi les `pages` (0/1) parallèles aux instances
 * pour router la bonne texture d'atlas.
 */
export function buildGlyphInstances(
  item: DrawItem,
  atlas: GlyphAtlas,
  opts: {
    atlasW: number;
    atlasH: number;
    outlineColor: [number, number, number, number];
    outlineWidthPx: number;
  },
): { data: Float32Array; pages: number[] } {
  const text = item.text;
  if (!text || !item.textValue) {
    return { data: new Float32Array(0), pages: [] };
  }
  const fill = hexToRgba01(text.color);
  const layout = layoutText(atlas, item.textValue, text.size, text.align);
  const n = layout.quads.length;
  const data = new Float32Array(n * FLOATS_PER_GLYPH);
  const pages: number[] = [];

  // Contour : demi-largeur en UV (px atlas → UV). On échantillonne l'atlas à la taille
  // native, donc le rayon en UV = outlineWidthPx (en px atlas natif) / dimension atlas.
  const ringU = opts.outlineWidthPx / opts.atlasW;
  const ringV = opts.outlineWidthPx / opts.atlasH;
  // On utilise une demi-largeur isotrope moyenne en U (atlas quasi 2:1, on prend U).
  const ringW = ringU;

  for (let i = 0; i < n; i++) {
    const q = layout.quads[i]!;
    const o = i * FLOATS_PER_GLYPH;
    // Position du quad de glyphe : pivot du MenuObject + position de layout (la ligne
    // est placée à partir du pivot ; l'anchorY du MenuObject centre verticalement le
    // label sur son pivot, comme le canvas2d "middle").
    data[o + 0] = item.x + q.x;
    data[o + 1] = item.y + q.y - layout.height * item.anchorY;
    data[o + 2] = q.w; // size.x
    data[o + 3] = q.h; // size.y
    data[o + 4] = item.scaleX;
    data[o + 5] = item.scaleY;
    data[o + 6] = 0; // anchor.x — glyphe ancré au coin haut-gauche
    data[o + 7] = 0; // anchor.y
    data[o + 8] = item.rot;
    data[o + 9] = 0; // pad
    data[o + 10] = q.uv.u0;
    data[o + 11] = q.uv.v0;
    data[o + 12] = q.uv.u1;
    data[o + 13] = q.uv.v1;
    data[o + 14] = fill[0];
    data[o + 15] = fill[1];
    data[o + 16] = fill[2];
    data[o + 17] = fill[3];
    data[o + 18] = opts.outlineColor[0];
    data[o + 19] = opts.outlineColor[1];
    data[o + 20] = opts.outlineColor[2];
    data[o + 21] = opts.outlineColor[3];
    data[o + 22] = ringW; // demi-largeur de contour en UV
    data[o + 23] = ringU; // pas de texel U
    data[o + 24] = ringV; // pas de texel V
    data[o + 25] = item.opacity; // opacité d'instance
    pages.push(q.page);
  }

  return { data, pages };
}

/* ── conversion hex → RGBA premultiplié (primitives) ─────────────────────────── */

/** Parse un hex CSS (#rgb/#rrggbb) en [r,g,b] 0..255. */
export function parseHexColor(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map(c => c + c)
      .join("");
  }
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) {
    return [255, 255, 255];
  }
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/* ── renderer GPU ────────────────────────────────────────────────────────────── */

interface TexEntry {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

/** Source WGSL injectée au build (Bun importe le .wgsl comme texte via `with { type: "text" }`). */
import { shaderSource } from "./shaders";

export class WebGpuMenuRenderer {
  private readonly device: GPUDevice;
  private readonly ctx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly layout: MenuLayout;
  private readonly assetBase: string;

  private readonly globalsBuffer: GPUBuffer;
  private readonly globalsBindGroup: GPUBindGroup;
  private readonly texBindGroupLayout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private readonly pipelines: Map<number, GPURenderPipeline> = new Map();
  private readonly shaderModule: GPUShaderModule;
  private readonly pipelineLayout: GPUPipelineLayout;

  /** Atlas de glyphes (si configuré) : métriques décodées + textures de pages. */
  private fontAtlas: GlyphAtlas | null = null;
  private fontAtlasConfig: FontAtlasConfig | null = null;
  private atlasPages: Map<number, TexEntry> = new Map();
  private glyphPipeline: GPURenderPipeline | null = null;
  private glyphInstanceBuffer: GPUBuffer | null = null;
  private glyphInstanceCapacity = 0;
  private outlineColor01: [number, number, number, number] = [0, 0, 0, 1];
  private outlineWidthPx = 1.5;

  /** Textures de sprites par pngUrl. */
  private readonly spriteTextures: Map<string, TexEntry> = new Map();
  /** Textures de texte par clé de cache. */
  private readonly textTextures: Map<string, { entry: TexEntry; bmp: TextBitmap }> = new Map();
  /** Texture blanche 1×1 pour les primitives (teintées via l'instance). */
  private whiteTexture!: TexEntry;
  /** Buffer d'instances réutilisé entre frames (évite une alloc GPU par item/frame). */
  private instanceBuffer: GPUBuffer | null = null;
  /** Capacité courante du buffer d'instances (en nombre d'instances). */
  private instanceCapacity = 0;

  private overrides: Record<string, MenuObjectOverride> = {};
  private lang: MenuLang = "fr";
  private destroyed = false;
  private dpr = 1;

  private constructor(
    device: GPUDevice,
    ctx: GPUCanvasContext,
    format: GPUTextureFormat,
    layout: MenuLayout,
    assetBase: string,
  ) {
    this.device = device;
    this.ctx = ctx;
    this.format = format;
    this.layout = layout;
    this.assetBase = assetBase;

    const shaderModule = device.createShaderModule({ code: shaderSource });
    this.shaderModule = shaderModule;

    this.sampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
    });

    // group 0 : globals (uniform)
    const globalsLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    // group 1 : texture + sampler
    this.texBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [globalsLayout, this.texBindGroupLayout],
    });
    this.pipelineLayout = pipelineLayout;

    // Description du vertex buffer d'instance (slot 0 = instance, step-mode 'instance').
    const instanceBufferLayout: GPUVertexBufferLayout = {
      arrayStride: INSTANCE_STRIDE,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" }, // pos
        { shaderLocation: 1, offset: 8, format: "float32x2" }, // size
        { shaderLocation: 2, offset: 16, format: "float32x2" }, // scale
        { shaderLocation: 3, offset: 24, format: "float32x2" }, // anchor
        { shaderLocation: 4, offset: 32, format: "float32x2" }, // rot, opacity
        { shaderLocation: 5, offset: 40, format: "float32x4" }, // uvRect
        { shaderLocation: 6, offset: 56, format: "float32x4" }, // tint (premultiplié)
      ],
    };

    // Un pipeline par drawType (blend différent).
    for (const dt of [0, 1, 2]) {
      const blend = blendForDrawType(dt) as unknown as GPUBlendState;
      this.pipelines.set(
        dt,
        device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: "vs", buffers: [instanceBufferLayout] },
          fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format, blend }] },
          primitive: { topology: "triangle-strip" },
        }),
      );
    }

    // globals uniform : vec2 canvas + vec2 pad = 16 bytes.
    this.globalsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.globalsBuffer, 0, new Float32Array([CANVAS_W, CANVAS_H, 0, 0]));
    this.globalsBindGroup = device.createBindGroup({
      layout: globalsLayout,
      entries: [{ binding: 0, resource: { buffer: this.globalsBuffer } }],
    });
  }

  /** Crée et initialise le renderer (adapter/device/contexte, textures du layout). */
  static async create(
    canvas: HTMLCanvasElement,
    layout: MenuLayout,
    assetBase: string,
    fontAtlas?: FontAtlasConfig,
  ): Promise<WebGpuMenuRenderer> {
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new Error("WebGPU indisponible (navigator.gpu absent)");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Aucun adaptateur WebGPU");
    }
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext("webgpu");
    if (!ctx) {
      throw new Error("Contexte 'webgpu' indisponible sur le canvas");
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });

    const r = new WebGpuMenuRenderer(device, ctx, format, layout, assetBase);
    r.createWhiteTexture();
    await r.loadTextures();
    if (fontAtlas) {
      await r.loadFontAtlas(fontAtlas);
    }
    return r;
  }

  /**
   * Charge l'atlas de glyphes du jeu (métriques + textures de pages) et construit le
   * pipeline de rendu de glyphes (atlas + contour 8-tap). En cas d'échec (404 / décodage),
   * le rendu texte retombe sur le fallback `canvas2d` (ne casse rien).
   */
  private async loadFontAtlas(cfg: FontAtlasConfig): Promise<void> {
    try {
      const metricsText = await (await fetch(cfg.metricsUrl)).text();
      this.fontAtlas = parseFontMetrics(metricsText);
      this.fontAtlasConfig = cfg;
      this.outlineColor01 = hexToRgba01(cfg.outlineColor ?? "#000000");
      this.outlineWidthPx = cfg.outlineWidthPx ?? 1.5;

      await this.loadAtlasPage(0, cfg.atlasUrl);
      if (cfg.gaijiUrl) {
        await this.loadAtlasPage(1, cfg.gaijiUrl);
      }
      this.glyphPipeline = this.createGlyphPipeline();
    } catch (error) {
      console.warn(`[menu-webgpu] atlas de police ignoré (${String(error)}) — fallback canvas2d`);
      this.fontAtlas = null;
      this.fontAtlasConfig = null;
    }
  }

  /** Charge une page d'atlas PNG en texture GPU (premultiplied, nearest). */
  private async loadAtlasPage(page: number, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`atlas page ${page} HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const entry = this.uploadBitmap(bmp, bmp.width, bmp.height);
    bmp.close();
    this.atlasPages.set(page, entry);
  }

  /** Construit le pipeline de glyphes (vs_glyph/fs_glyph) — blend "over" prémultiplié. */
  private createGlyphPipeline(): GPURenderPipeline {
    const glyphInstanceLayout: GPUVertexBufferLayout = {
      arrayStride: GLYPH_STRIDE,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" }, // pos
        { shaderLocation: 1, offset: 8, format: "float32x2" }, // size
        { shaderLocation: 2, offset: 16, format: "float32x2" }, // scale
        { shaderLocation: 3, offset: 24, format: "float32x2" }, // anchor
        { shaderLocation: 4, offset: 32, format: "float32x2" }, // rot, pad
        { shaderLocation: 5, offset: 40, format: "float32x4" }, // uvRect
        { shaderLocation: 6, offset: 56, format: "float32x4" }, // fillColor
        { shaderLocation: 7, offset: 72, format: "float32x4" }, // outlineColor
        { shaderLocation: 8, offset: 88, format: "float32x4" }, // outlineP
      ],
    };
    const blend = blendForDrawType(0) as unknown as GPUBlendState;
    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: "vs_glyph", buffers: [glyphInstanceLayout] },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fs_glyph",
        targets: [{ format: this.format, blend }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  /** Crée une texture blanche 1×1 (primitives teintées par l'instance). */
  private createWhiteTexture(): void {
    const texture = this.device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.writeTexture({ texture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
    const view = texture.createView();
    this.whiteTexture = {
      texture,
      view,
      width: 1,
      height: 1,
      bindGroup: this.device.createBindGroup({
        layout: this.texBindGroupLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.sampler },
        ],
      }),
    };
  }

  /** Charge toutes les textures de sprites référencées par le layout. */
  private async loadTextures(): Promise<void> {
    const urls = new Set<string>();
    for (const obj of this.layout.objects) {
      if (obj.sprite) {
        urls.add(obj.sprite.pngUrl);
      }
    }
    // Concurrence bornée : ne pas lancer N fetches d'un coup (le décodeur live du CDN
    // sature sous burst). Pool de `SPRITE_FETCH_CONCURRENCY` requêtes simultanées max.
    await mapWithConcurrency([...urls], SPRITE_FETCH_CONCURRENCY, pngUrl => this.loadSpriteTexture(pngUrl));
  }

  private async loadSpriteTexture(pngUrl: string): Promise<void> {
    // Tolérance aux assets manquants : un sprite absent (404 / réseau / décodage) est
    // ignoré (warn) plutôt que de faire échouer toute l'init WebGPU — l'objet
    // correspondant est simplement omis au rendu (cf. `resolveItem` → null). Le menu
    // reste affichable en WebGPU avec un asset partiel (utile en dev sans CDN complet).
    //
    // Le « 404 » du CDN est le plus souvent un décodage g4tx→png à froid qui a timeout
    // (≈8.6s), pas un vrai miss : on retente (`fetchWithRetry`) avant d'abandonner.
    const url = assetUrl(this.assetBase, pngUrl);
    try {
      const res = await fetchWithRetry(url, SPRITE_FETCH_RETRIES);
      if (!res) {
        console.warn(`[menu-webgpu] sprite ignoré (réseau) : ${url}`);
        return;
      }
      if (!res.ok) {
        console.warn(`[menu-webgpu] sprite ignoré (${res.status}) : ${url}`);
        return;
      }
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob, {
        premultiplyAlpha: "premultiply",
        colorSpaceConversion: "none",
      });
      const entry = this.uploadBitmap(bmp, bmp.width, bmp.height);
      bmp.close();
      this.spriteTextures.set(pngUrl, entry);
    } catch (error) {
      console.warn(`[menu-webgpu] sprite ignoré (${String(error)}) : ${url}`);
    }
  }

  /** Upload d'un ImageBitmap/canvas vers une texture GPU + bind group. */
  private uploadBitmap(
    source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
    width: number,
    height: number,
  ): TexEntry {
    const texture = this.device.createTexture({
      size: [width, height, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source }, { texture }, [width, height]);
    const view = texture.createView();
    return {
      texture,
      view,
      width,
      height,
      bindGroup: this.device.createBindGroup({
        layout: this.texBindGroupLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.sampler },
        ],
      }),
    };
  }

  /** Récupère (ou crée) la texture d'un label texte, mémoïsée par clé. */
  private getTextTexture(text: MenuText, value: string): { entry: TexEntry; bmp: TextBitmap } | null {
    const key = textCacheKey(text, value);
    const cached = this.textTextures.get(key);
    if (cached) {
      return cached;
    }
    const bmp = renderTextBitmap(text, value, this.dpr);
    if (!bmp) {
      return null;
    }
    const entry = this.uploadBitmap(bmp.canvas, bmp.canvas.width, bmp.canvas.height);
    const out = { entry, bmp };
    this.textTextures.set(key, out);
    return out;
  }

  /** Met à jour les overrides Lua (visibilité/texte/nombre par nom d'objet). */
  setOverrides(o: Record<string, MenuObjectOverride>): void {
    this.overrides = o;
  }

  /** Change la langue d'affichage du texte (`localized[lang]`, repli `value`). */
  setLang(lang: MenuLang): void {
    this.lang = lang;
    this.textTextures.clear();
  }

  /** Reconfigure le canvas pour une taille CSS + devicePixelRatio (letterbox géré en amont). */
  resize(cssW: number, cssH: number, dpr: number): void {
    if (this.destroyed) {
      return;
    }
    this.dpr = dpr;
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    // La reconfiguration du contexte est implicite (même device/format) ;
    // les textures texte dépendantes du dpr seront recréées au prochain render.
    this.textTextures.clear();
  }

  /** Le texte doit-il être rendu via l'atlas de glyphes (vs fallback canvas2d) ? */
  private useGlyphAtlas(): boolean {
    return this.fontAtlas !== null && this.glyphPipeline !== null && this.atlasPages.has(0);
  }

  /** Dessine une frame (painter z-order par drawPriority). */
  render(): void {
    if (this.destroyed) {
      return;
    }
    const items = buildDrawList(this.layout, this.overrides, this.lang);
    const useGlyphs = this.useGlyphAtlas();

    // Buffer A : instances "standard" (sprite / primitive / texte fallback canvas2d).
    // Buffer B : instances de glyphes (texte via atlas). Les deux sont remplis dans
    // l'ordre painter ; on émet une commande de dessin ordonnée (`order`) qui pointe
    // soit vers A (pipeline drawType), soit vers un RUN de glyphes dans B.
    const stdResolved: Array<{ entry: TexEntry; drawType: number }> = [];
    const packed = new Float32Array(items.length * FLOATS_PER_INSTANCE);
    const glyphChunks: number[] = [];
    const glyphData: Float32Array[] = [];
    const glyphPages: number[][] = [];
    // Commandes ordonnées : { kind: 'std', idx } | { kind: 'glyph', chunk }
    const order: Array<{ kind: "std"; idx: number } | { kind: "glyph"; chunk: number }> = [];

    for (const item of items) {
      if (useGlyphs && item.kind === "text" && item.text && item.textValue && this.fontAtlas) {
        const built = buildGlyphInstances(item, this.fontAtlas, {
          atlasW: this.fontAtlas.info.atlasW,
          atlasH: this.fontAtlas.info.atlasH,
          outlineColor: this.outlineColor01,
          outlineWidthPx: this.outlineWidthPx,
        });
        if (built.pages.length === 0) {
          continue;
        }
        const chunk = glyphData.length;
        glyphData.push(built.data);
        glyphPages.push(built.pages);
        glyphChunks.push(built.pages.length);
        order.push({ kind: "glyph", chunk });
        continue;
      }
      const r = this.resolveItem(item);
      if (!r) {
        continue;
      }
      packed.set(r.data, stdResolved.length * FLOATS_PER_INSTANCE);
      order.push({ kind: "std", idx: stdResolved.length });
      stdResolved.push({ entry: r.entry, drawType: item.drawType });
    }

    const buffer = this.ensureInstanceBuffer(stdResolved.length);
    if (buffer && stdResolved.length > 0) {
      this.device.queue.writeBuffer(buffer, 0, packed, 0, stdResolved.length * FLOATS_PER_INSTANCE);
    }

    // Empaquetage des glyphes (un seul buffer, offsets de base par chunk).
    const totalGlyphs = glyphChunks.reduce((a, b) => a + b, 0);
    const chunkBase: number[] = [];
    let glyphBuffer: GPUBuffer | null = null;
    if (totalGlyphs > 0) {
      const allGlyphs = new Float32Array(totalGlyphs * FLOATS_PER_GLYPH);
      let base = 0;
      for (let c = 0; c < glyphData.length; c++) {
        allGlyphs.set(glyphData[c]!, base * FLOATS_PER_GLYPH);
        chunkBase.push(base);
        base += glyphChunks[c]!;
      }
      glyphBuffer = this.ensureGlyphBuffer(totalGlyphs);
      if (glyphBuffer) {
        this.device.queue.writeBuffer(glyphBuffer, 0, allGlyphs, 0, totalGlyphs * FLOATS_PER_GLYPH);
      }
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setBindGroup(0, this.globalsBindGroup);

    for (const cmd of order) {
      if (cmd.kind === "std") {
        if (!buffer) {
          continue;
        }
        const r = stdResolved[cmd.idx]!;
        const pipeline = this.pipelines.get(r.drawType) ?? this.pipelines.get(0);
        if (!pipeline) {
          continue;
        }
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, buffer);
        pass.setBindGroup(1, r.entry.bindGroup);
        pass.draw(4, 1, 0, cmd.idx);
      } else {
        if (!glyphBuffer || !this.glyphPipeline) {
          continue;
        }
        const base = chunkBase[cmd.chunk]!;
        const pages = glyphPages[cmd.chunk]!;
        pass.setPipeline(this.glyphPipeline);
        pass.setVertexBuffer(0, glyphBuffer);
        // Un draw par glyphe (la page d'atlas — et donc la texture — peut différer).
        for (let g = 0; g < pages.length; g++) {
          const pageEntry = this.atlasPages.get(pages[g]!) ?? this.atlasPages.get(0);
          if (!pageEntry) {
            continue;
          }
          pass.setBindGroup(1, pageEntry.bindGroup);
          pass.draw(4, 1, 0, base + g);
        }
      }
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Garantit un buffer d'instances de glyphes d'au moins `count` instances. */
  private ensureGlyphBuffer(count: number): GPUBuffer | null {
    if (count <= 0) {
      return this.glyphInstanceBuffer;
    }
    if (this.glyphInstanceBuffer && this.glyphInstanceCapacity >= count) {
      return this.glyphInstanceBuffer;
    }
    this.glyphInstanceBuffer?.destroy();
    let cap = Math.max(64, this.glyphInstanceCapacity || 64);
    while (cap < count) {
      cap *= 2;
    }
    this.glyphInstanceBuffer = this.device.createBuffer({
      size: cap * GLYPH_STRIDE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.glyphInstanceCapacity = cap;
    return this.glyphInstanceBuffer;
  }

  /**
   * Garantit un buffer d'instances d'au moins `count` instances. Grandit par puissances de
   * 2 (limite les réallocations) et réutilise le même buffer tant qu'il est assez grand.
   */
  private ensureInstanceBuffer(count: number): GPUBuffer | null {
    if (count <= 0) {
      return this.instanceBuffer;
    }
    if (this.instanceBuffer && this.instanceCapacity >= count) {
      return this.instanceBuffer;
    }
    this.instanceBuffer?.destroy();
    let cap = Math.max(16, this.instanceCapacity || 16);
    while (cap < count) {
      cap *= 2;
    }
    this.instanceBuffer = this.device.createBuffer({
      size: cap * INSTANCE_STRIDE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.instanceCapacity = cap;
    return this.instanceBuffer;
  }

  /** Résout un DrawItem en (texture, données d'instance Float32Array). */
  private resolveItem(item: DrawItem): { entry: TexEntry; data: Float32Array } | null {
    let entry: TexEntry;
    let w = item.w;
    let h = item.h;
    let offsetX = 0;
    // Multiplicateur de couleur par instance (premultiplié). Neutre (1,1,1,1) pour
    // sprite/text — leur transparence passe par l'opacité d'instance ; pour les
    // primitives il porte la couleur de remplissage premultipliée.
    const tint = new Float32Array([1, 1, 1, 1]);

    if (item.kind === "sprite") {
      const e = this.spriteTextures.get(item.pngUrl ?? "");
      if (!e) {
        return null;
      }
      entry = e;
    } else if (item.kind === "text" && item.text && item.textValue) {
      const t = this.getTextTexture(item.text, item.textValue);
      if (!t) {
        return null;
      }
      entry = t.entry;
      w = t.bmp.width;
      h = t.bmp.height;
      offsetX = t.bmp.offsetX;
    } else if (item.kind === "primitive") {
      entry = this.whiteTexture;
      const [r, g, b] = parseHexColor(item.primitiveColor ?? "#ffffff");
      // premultiplié : rgb × alpha.
      tint[0] = (r / 255) * item.opacity;
      tint[1] = (g / 255) * item.opacity;
      tint[2] = (b / 255) * item.opacity;
      tint[3] = item.opacity;
    } else {
      return null;
    }

    // Pour les primitives, l'opacité est déjà repliée dans `tint` (premultiplié) et la
    // texture blanche est modulée par `tint` → l'opacité d'instance reste 1 (pas de
    // double multiplication). Pour sprite/text, `tint` vaut (1,1,1,1) et l'opacité
    // d'instance porte la transparence.
    const opacityInstance = item.kind === "primitive" ? 1 : item.opacity;
    // 18 floats : pos(2) size(2) scale(2) anchor(2) rotOp(2) uvRect(4) tint(4).
    const data = new Float32Array([
      item.x + offsetX,
      item.y,
      w,
      h,
      item.scaleX,
      item.scaleY,
      item.anchorX,
      item.anchorY,
      item.rot,
      opacityInstance,
      0,
      0,
      1,
      1,
      tint[0]!,
      tint[1]!,
      tint[2]!,
      tint[3]!,
    ]);

    return { entry, data };
  }

  /** Libère les ressources GPU. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const e of this.spriteTextures.values()) {
      e.texture.destroy();
    }
    for (const t of this.textTextures.values()) {
      t.entry.texture.destroy();
    }
    this.whiteTexture?.texture.destroy();
    for (const p of this.atlasPages.values()) {
      p.texture.destroy();
    }
    this.atlasPages.clear();
    this.globalsBuffer.destroy();
    this.instanceBuffer?.destroy();
    this.instanceBuffer = null;
    this.instanceCapacity = 0;
    this.glyphInstanceBuffer?.destroy();
    this.glyphInstanceBuffer = null;
    this.glyphInstanceCapacity = 0;
    this.spriteTextures.clear();
    this.textTextures.clear();
  }
}

/** Largeur/hauteur du canvas de référence (export pour la route/letterbox). */
export const CANVAS_SIZE = { w: CANVAS_W, h: CANVAS_H } as const;

/**
 * Calcule la zone 16:9 max centrée (letterbox) pour un conteneur donné.
 * Pur — utilisé par le wrapper React et testable.
 */
export function computeLetterbox(
  containerW: number,
  containerH: number,
): { cssW: number; cssH: number; scale: number } {
  const scale = Math.min(containerW / CANVAS_W, containerH / CANVAS_H);
  return { cssW: CANVAS_W * scale, cssH: CANVAS_H * scale, scale };
}
