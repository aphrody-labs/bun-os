/**
 * Tests de la **logique pure** du renderer WebGPU (aucun GPU réel, headless-safe) :
 *   - projection ortho 1280×720 ;
 *   - construction de la draw-list (layout → items ordonnés painter) ;
 *   - application des overrides (visibilité, texte, nombre) ;
 *   - table de blend par drawType ;
 *   - décision de fallback `shouldUseWebGpu`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { MenuLayout, MenuObject } from "@aphrody/menu-render";
import {
  buildDrawList,
  buildGlyphInstances,
  computeLetterbox,
  type DrawItem,
  fetchWithRetry,
  FLOATS_PER_GLYPH,
  hexToRgba01,
  mapWithConcurrency,
  parseHexColor,
} from "./renderer";
import { decodeFontMetrics, type RawFontMetrics } from "./glyph-atlas";
import { blendForDrawType, projectOrtho } from "./blend";
import { shouldUseWebGpu } from "./game-menu-gpu";

const atlasFixture = decodeFontMetrics(
  JSON.parse(
    await Bun.file(new URL("../test/fixtures/font_metrics_ascii.json", import.meta.url)).text(),
  ) as RawFontMetrics,
);

const obj = (over: Partial<MenuObject> & { name: string }): MenuObject => ({
  parent: null,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rot: 0, anchorX: 0.5, anchorY: 0.5 },
  drawPriority: 0,
  drawType: 0,
  camera: "menu",
  sprite: null,
  text: null,
  anim: null,
  primitive: null,
  charModel: null,
  ...over,
});

const layout = (objects: MenuObject[]): MenuLayout => ({
  screen: "test",
  locale: "fr",
  canvas: { w: 1280, h: 720 },
  objects,
});

describe("projectOrtho", () => {
  test("coin haut-gauche (0,0) → (-1, 1)", () => {
    expect(projectOrtho(0, 0, 1280, 720)).toEqual({ x: -1, y: 1 });
  });
  test("coin bas-droit (1280,720) → (1, -1)", () => {
    expect(projectOrtho(1280, 720, 1280, 720)).toEqual({ x: 1, y: -1 });
  });
  test("centre (640,360) → (0, 0)", () => {
    expect(projectOrtho(640, 360, 1280, 720)).toEqual({ x: 0, y: 0 });
  });
});

describe("blendForDrawType", () => {
  test("0 = alpha over (premultiplied)", () => {
    const b = blendForDrawType(0);
    expect(b.color.srcFactor).toBe("one");
    expect(b.color.dstFactor).toBe("one-minus-src-alpha");
  });
  test("1 = additive", () => {
    const b = blendForDrawType(1);
    expect(b.color.srcFactor).toBe("one");
    expect(b.color.dstFactor).toBe("one");
  });
  test("2 = multiply", () => {
    const b = blendForDrawType(2);
    expect(b.color.srcFactor).toBe("dst");
    expect(b.color.dstFactor).toBe("zero");
  });
  test("inconnu → over", () => {
    expect(blendForDrawType(99).color.dstFactor).toBe("one-minus-src-alpha");
  });
});

describe("buildDrawList", () => {
  test("trie par drawPriority croissant (painter)", () => {
    const l = layout([
      obj({
        name: "top",
        drawPriority: 10,
        sprite: { logicalPath: "a", pngUrl: "/a.png", w: 1, h: 1 },
      }),
      obj({
        name: "bg",
        drawPriority: 0,
        sprite: { logicalPath: "b", pngUrl: "/b.png", w: 1, h: 1 },
      }),
    ]);
    const list = buildDrawList(l);
    expect(list.map(d => d.name)).toEqual(["bg", "top"]);
  });

  test("ignore les objets sans sprite/text/primitive", () => {
    const l = layout([obj({ name: "empty" })]);
    expect(buildDrawList(l)).toHaveLength(0);
  });

  test("override visible:false omet l'instance", () => {
    const l = layout([obj({ name: "s", sprite: { logicalPath: "a", pngUrl: "/a.png", w: 1, h: 1 } })]);
    expect(buildDrawList(l, { s: { visible: false } })).toHaveLength(0);
    expect(buildDrawList(l, { s: { visible: true } })).toHaveLength(1);
  });

  test("override text remplace la valeur statique", () => {
    const l = layout([
      obj({
        name: "label",
        text: {
          key: "k",
          keyHash: 0,
          value: "STATIC",
          font: "nie_main",
          size: 20,
          color: "#fff",
          align: "center",
        },
      }),
    ]);
    const item = buildDrawList(l, { label: { text: "LIVE" } })[0];
    expect(item?.kind).toBe("text");
    expect(item?.textValue).toBe("LIVE");
  });

  test("override number → texte numérique", () => {
    const l = layout([
      obj({
        name: "n",
        text: {
          key: "k",
          keyHash: 0,
          value: "0",
          font: "nie_main",
          size: 20,
          color: "#fff",
          align: "left",
        },
      }),
    ]);
    expect(buildDrawList(l, { n: { number: 42 } })[0]?.textValue).toBe("42");
  });

  test("primitive porte alpha + couleur", () => {
    const l = layout([
      obj({
        name: "dim",
        primitive: { type: "rect", w: 1280, h: 720, color: "#000000", alpha: 0.35 },
      }),
    ]);
    const item = buildDrawList(l)[0];
    expect(item?.kind).toBe("primitive");
    expect(item?.opacity).toBe(0.35);
    expect(item?.primitiveColor).toBe("#000000");
  });

  test("tri stable pour priorités égales (ordre du layout)", () => {
    const l = layout([
      obj({
        name: "first",
        drawPriority: 5,
        sprite: { logicalPath: "a", pngUrl: "/a.png", w: 1, h: 1 },
      }),
      obj({
        name: "second",
        drawPriority: 5,
        sprite: { logicalPath: "b", pngUrl: "/b.png", w: 1, h: 1 },
      }),
    ]);
    expect(buildDrawList(l).map(d => d.name)).toEqual(["first", "second"]);
  });
});

describe("parseHexColor", () => {
  test("#rrggbb", () => {
    expect(parseHexColor("#ff8000")).toEqual([255, 128, 0]);
  });
  test("#rgb", () => {
    expect(parseHexColor("#f00")).toEqual([255, 0, 0]);
  });
  test("invalide → blanc", () => {
    expect(parseHexColor("nope")).toEqual([255, 255, 255]);
  });
});

describe("computeLetterbox", () => {
  test("16:9 exact (2560×1440) → scale 2", () => {
    const { scale, cssW, cssH } = computeLetterbox(2560, 1440);
    expect(scale).toBe(2);
    expect(cssW).toBe(2560);
    expect(cssH).toBe(1440);
  });
  test("conteneur plus large que 16:9 → contraint par la hauteur", () => {
    const { scale } = computeLetterbox(4000, 720);
    expect(scale).toBe(1); // 720/720
  });
});

describe("hexToRgba01", () => {
  test("#000000 → [0,0,0,1]", () => {
    expect(hexToRgba01("#000000")).toEqual([0, 0, 0, 1]);
  });
  test("#ff8000 → [1, 128/255, 0, 1]", () => {
    const [r, g, b, a] = hexToRgba01("#ff8000");
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(128 / 255, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(a).toBe(1);
  });
});

describe("buildGlyphInstances", () => {
  const textItem = (value: string, over: Partial<DrawItem> = {}): DrawItem => ({
    name: "label",
    drawPriority: 0,
    drawType: 0,
    x: 100,
    y: 50,
    w: 0,
    h: 0,
    scaleX: 1,
    scaleY: 1,
    rot: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
    kind: "text",
    text: {
      key: "k",
      keyHash: 0,
      value,
      font: "nie_main",
      size: 71,
      color: "#00ff00",
      align: "left",
    },
    textValue: value,
    ...over,
  });

  const opts = {
    atlasW: atlasFixture.info.atlasW,
    atlasH: atlasFixture.info.atlasH,
    outlineColor: [0, 0, 0, 1] as [number, number, number, number],
    outlineWidthPx: 2,
  };

  test("un bloc d'instances de 26 floats par glyphe à encre", () => {
    const { data, pages } = buildGlyphInstances(textItem("AB"), atlasFixture, opts);
    expect(pages).toHaveLength(2);
    expect(data.length).toBe(2 * FLOATS_PER_GLYPH);
  });

  test("fillColor de l'instance = couleur du texte (vert)", () => {
    const { data } = buildGlyphInstances(textItem("A"), atlasFixture, opts);
    // offsets 14..17 = fillColor rgba
    expect(data[14]).toBeCloseTo(0, 6);
    expect(data[15]).toBeCloseTo(1, 6);
    expect(data[16]).toBeCloseTo(0, 6);
    expect(data[17]).toBeCloseTo(1, 6);
  });

  test("outlineColor de l'instance = noir", () => {
    const { data } = buildGlyphInstances(textItem("A"), atlasFixture, opts);
    // offsets 18..21 = outlineColor rgba
    expect(data[18]).toBeCloseTo(0, 6);
    expect(data[21]).toBeCloseTo(1, 6);
  });

  test("position X du glyphe = pivot + bearingX (align left)", () => {
    const { data } = buildGlyphInstances(textItem("A", { x: 100 }), atlasFixture, opts);
    const a = atlasFixture.glyphs.get(0x41)!;
    // offset 0 = pos.x = item.x + quad.x ; quad.x(A, left) = bearingX(A)
    expect(data[0]).toBeCloseTo(100 + a.bearingX, 6);
  });

  test("rayon de contour (UV) = outlineWidthPx / atlasW", () => {
    const { data } = buildGlyphInstances(textItem("A"), atlasFixture, opts);
    // offset 22 = ringW (demi-largeur de contour en UV)
    expect(data[22]).toBeCloseTo(2 / atlasFixture.info.atlasW, 8);
  });

  test("UV du glyphe (offsets 10..13) = rectangle atlas de 'A'", () => {
    const { data } = buildGlyphInstances(textItem("A"), atlasFixture, opts);
    const a = atlasFixture.glyphs.get(0x41)!;
    expect(data[10]).toBeCloseTo(a.x / 4096, 6);
    expect(data[11]).toBeCloseTo(a.y / 2048, 6);
    expect(data[12]).toBeCloseTo((a.x + a.w) / 4096, 6);
    expect(data[13]).toBeCloseTo((a.y + 71) / 2048, 6);
  });

  test("texte vide → aucune instance", () => {
    const { data, pages } = buildGlyphInstances(textItem(""), atlasFixture, opts);
    expect(pages).toHaveLength(0);
    expect(data.length).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  test("traite tous les éléments dans l'ordre, jamais plus de `limit` en vol", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(items, 6, async n => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  test("limite ramenée à la taille de la liste (pas de runner vide)", async () => {
    let count = 0;
    await mapWithConcurrency([1, 2], 50, async () => {
      count += 1;
    });
    expect(count).toBe(2);
  });

  test("liste vide → no-op", async () => {
    await expect(mapWithConcurrency([], 6, async () => {})).resolves.toBeUndefined();
  });
});

describe("fetchWithRetry", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("retourne la réponse OK sans retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("http://x/a.png", 2);
    expect(res?.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test("retente sur 404 puis réussit (décode-à-froid chaud à la 2ᵉ)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls < 2 ? new Response("", { status: 404 }) : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("http://x/a.png", 2);
    expect(res?.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("épuise les retries puis renvoie la dernière réponse non-OK", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("http://x/a.png", 2);
    expect(res?.ok).toBe(false);
    expect(res?.status).toBe(404);
    expect(calls).toBe(3); // 1 + 2 retries
  });

  test("erreur réseau persistante → null", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("http://x/a.png", 2);
    expect(res).toBeNull();
    expect(calls).toBe(3);
  });
});

describe("shouldUseWebGpu", () => {
  test("forceFallback gagne toujours", () => {
    expect(shouldUseWebGpu(true, true)).toBe(false);
  });
  test("sans GPU → false", () => {
    expect(shouldUseWebGpu(false, false)).toBe(false);
  });
  test("GPU dispo + pas de force → true", () => {
    expect(shouldUseWebGpu(false, true)).toBe(true);
  });
});
