// SPDX-License-Identifier: MIT
// Port of upstream scripts/capture_view_quality.py: measure whether a captured frame is usable at all (near-black,
// wall-filled or flat). The measurement runs in the page's own JavaScript on a 2D canvas the frame is decoded into,
// so the app's WebGL or WebGPU context needs no preserveDrawingBuffer. It records numbers; classify() is the only
// place that turns numbers into a verdict. The two page scripts are upstream's, byte for byte.

/** Tuned on the upstream phase-9 eval frames; gamma-space Rec.709 luma on 0-1. */
export const THRESHOLDS = {
  dark_luma: 0.06,
  near_black_luma_mean: 0.04,
  near_black_dark_fraction: 0.85,
  flat_min_fraction: 0.3,
  flat_luma_gap: 0.25,
  wall_min_fraction: 0.2,
  wall_column_std: 0.03,
  low_contrast_luma_std: 0.04,
  grid_cols: 32,
  grid_rows: 18,
};

export const MEASURE_JS = "async ({dataUrl, t, region}) => {\n  const image = new Image();\n  image.src = dataUrl;\n  await image.decode();\n  const iw = image.naturalWidth, ih = image.naturalHeight;\n  if (!iw || !ih) throw new Error('empty frame');\n  const x0 = region ? Math.max(0, Math.round(region.x)) : 0;\n  const y0 = region ? Math.max(0, Math.round(region.y)) : 0;\n  const w = Math.max(1, Math.min(iw - x0, region ? Math.round(region.width) : iw));\n  const h = Math.max(1, Math.min(ih - y0, region ? Math.round(region.height) : ih));\n  const canvas = document.createElement('canvas');\n  canvas.width = iw; canvas.height = ih;\n  const ctx = canvas.getContext('2d', {willReadFrequently: true});\n  ctx.drawImage(image, 0, 0);\n  const px = ctx.getImageData(x0, y0, w, h).data;\n  const CX = t.grid_cols, CY = t.grid_rows, N = CX * CY;\n  const sums = new Float64Array(N), counts = new Float64Array(N);\n  let sum = 0, sumsq = 0, dark = 0;\n  for (let y = 0; y < h; y++) {\n    const row = Math.min(CY - 1, (y * CY / h) | 0) * CX;\n    for (let x = 0; x < w; x++) {\n      const i = (y * w + x) * 4;\n      const luma = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;\n      sum += luma; sumsq += luma * luma;\n      if (luma < t.dark_luma) dark++;\n      const k = row + Math.min(CX - 1, (x * CX / w) | 0);\n      sums[k] += luma; counts[k]++;\n    }\n  }\n  const n = w * h, mean = sum / n;\n  const cell = new Float64Array(N);\n  for (let k = 0; k < N; k++) cell[k] = counts[k] ? sums[k] / counts[k] : 0;\n  const median = Array.from(cell).sort((a, b) => a - b)[N >> 1];\n  // Largest 4-connected block of cells more than flat_luma_gap off the median, on either side:\n  // a lit wall at the near plane, or an unlit one across a bright frame.\n  let best = [];\n  for (const sign of [1, -1]) {\n    const off = (k) => sign > 0 ? cell[k] >= median + t.flat_luma_gap\n                                : cell[k] <= median - t.flat_luma_gap;\n    const seen = new Uint8Array(N);\n    for (let start = 0; start < N; start++) {\n      if (seen[start] || !off(start)) continue;\n      const stack = [start], cluster = [];\n      seen[start] = 1;\n      while (stack.length) {\n        const k = stack.pop(); cluster.push(k);\n        const cx = k % CX, cy = (k / CX) | 0;\n        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {\n          if (nx < 0 || ny < 0 || nx >= CX || ny >= CY) continue;\n          const j = ny * CX + nx;\n          if (!seen[j] && off(j)) { seen[j] = 1; stack.push(j); }\n        }\n      }\n      if (cluster.length > best.length) best = cluster;\n    }\n  }\n  const inCluster = new Uint8Array(N);\n  for (const k of best) inCluster[k] = 1;\n  let clusterSum = 0, restSum = 0, restCount = 0;\n  for (let k = 0; k < N; k++) {\n    if (inCluster[k]) clusterSum += cell[k]; else { restSum += cell[k]; restCount++; }\n  }\n  // Longest run of adjacent columns with no vertical structure, and how far that band sits\n  // from the columns around it: the signature of a wall standing across the near plane.\n  const colMean = [], colFlat = [];\n  for (let cx = 0; cx < CX; cx++) {\n    let s = 0, q = 0;\n    for (let cy = 0; cy < CY; cy++) { const v = cell[cy * CX + cx]; s += v; q += v * v; }\n    const m = s / CY;\n    colMean.push(m);\n    colFlat.push(Math.sqrt(Math.max(0, q / CY - m * m)) < t.wall_column_std);\n  }\n  let band = {length: 0, start: 0}, run = 0;\n  for (let cx = 0; cx < CX; cx++) {\n    run = colFlat[cx] ? run + 1 : 0;\n    if (run > band.length) band = {length: run, start: cx - run + 1};\n  }\n  let bandSum = 0, outSum = 0, outCount = 0;\n  for (let cx = 0; cx < CX; cx++) {\n    if (cx >= band.start && cx < band.start + band.length) bandSum += colMean[cx];\n    else { outSum += colMean[cx]; outCount++; }\n  }\n  const r = (v) => Math.round(v * 10000) / 10000;\n  return {\n    region: {x: x0, y: y0, width: w, height: h},\n    wall_fraction: r(band.length / CX),\n    wall_columns: band.length,\n    wall_luma: band.length ? r(bandSum / band.length) : null,\n    wall_rest_luma: outCount ? r(outSum / outCount) : null,\n    luma_mean: r(mean),\n    luma_std: r(Math.sqrt(Math.max(0, sumsq / n - mean * mean))),\n    luma_median_cell: r(median),\n    dark_fraction: r(dark / n),\n    flat_fraction: r(best.length / N),\n    flat_cells: best.length,\n    flat_luma: best.length ? r(clusterSum / best.length) : null,\n    rest_luma: restCount ? r(restSum / restCount) : null\n  };\n}";

export const CANVAS_REGION_JS = "() => {\n  const canvases = document.querySelectorAll('canvas');\n  if (canvases.length !== 1) return null;\n  const r = canvases[0].getBoundingClientRect();\n  return r.width >= 64 && r.height >= 64\n    ? {x: r.x, y: r.y, width: r.width, height: r.height} : null;\n}";

export type Thresholds = typeof THRESHOLDS;

export interface FrameStats {
  luma_mean: number;
  luma_std: number;
  dark_fraction: number;
  flat_fraction: number;
  flat_luma: number | null;
  rest_luma: number | null;
  wall_fraction?: number;
  wall_luma?: number | null;
  wall_rest_luma?: number | null;
  [key: string]: unknown;
}

export interface ViewQuality {
  measured: boolean;
  usable: boolean | null;
  reason: string;
  error?: string;
  [key: string]: unknown;
}

/** How far a measured region sits from the rest of the frame; 0 when there is no region. */
function gap(stats: FrameStats, key: keyof FrameStats, restKey: keyof FrameStats): number {
  const region = stats[key] as number | null | undefined;
  const rest = stats[restKey] as number | null | undefined;
  return region != null && rest != null ? Math.abs(region - rest) : 0;
}

/** [usable, reason] for one frame's numbers, in order of severity. */
export function classify(stats: FrameStats, t: Thresholds = THRESHOLDS): [boolean, string] {
  if (stats.luma_mean < t.near_black_luma_mean || stats.dark_fraction > t.near_black_dark_fraction) return [false, "near-black"];
  const block = stats.flat_fraction > t.flat_min_fraction && gap(stats, "flat_luma", "rest_luma") > t.flat_luma_gap;
  const wall = (stats.wall_fraction ?? 0) > t.wall_min_fraction && gap(stats, "wall_luma", "wall_rest_luma") > t.flat_luma_gap;
  if (block || wall) return [false, "flat-occluder"];
  if (stats.luma_std < t.low_contrast_luma_std) return [false, "low-contrast"];
  return [true, "usable"];
}

/** A page that can evaluate an expression and hand back its JSON value. */
export interface Evaluator {
  evaluate<T>(expression: string): Promise<T>;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The single scene canvas' rect in CSS pixels, or null when the page has not exactly one. */
export async function canvasRegion(page: Evaluator): Promise<Region | null> {
  try {
    return await page.evaluate<Region | null>(`(${CANVAS_REGION_JS})()`);
  } catch {
    return null;
  }
}

/** Measure one PNG frame in the page. Never throws: a failure is logged, not fatal. */
export async function measurePng(page: Evaluator, png: Uint8Array, region: Region | null = null, t: Thresholds = THRESHOLDS): Promise<ViewQuality> {
  const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  try {
    const stats = await page.evaluate<FrameStats>(`(${MEASURE_JS})(${JSON.stringify({ dataUrl, t, region })})`);
    const [usable, reason] = classify(stats, t);
    return { ...stats, measured: true, usable, reason };
  } catch (error) {
    return { measured: false, usable: null, reason: "not-measured", error: String((error as Error).message ?? error).slice(0, 200) };
  }
}

/** Names of the captured views the measurement flagged, in capture order. */
export function unusable(views: { name: string; view_quality?: ViewQuality }[]): string[] {
  return views.filter(v => v.view_quality?.usable === false).map(v => v.name);
}
