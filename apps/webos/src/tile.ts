// SPDX-License-Identifier: Apache-2.0
// Pure tiling geometry of the window manager (Hyprland-style layouts): no DOM, unit-tested in tile.test.ts.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Hyprland "dwindle": each window takes half of the remaining area, split along its longer side, and the rest recurses
 * into the other half. `n` rectangles tile `area` with `gap` between them.
 */
export function dwindleRects(n: number, area: Rect, gap: number): Rect[] {
  const out: Rect[] = [];
  let r = area;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(r);
      break;
    }
    if (r.w >= r.h) {
      const w = (r.w - gap) / 2;
      out.push({ ...r, w });
      r = { x: r.x + w + gap, y: r.y, w, h: r.h };
    } else {
      const h = (r.h - gap) / 2;
      out.push({ ...r, h });
      r = { x: r.x, y: r.y + h + gap, w: r.w, h };
    }
  }
  return out;
}

/**
 * Hyprland "master": the first window is the master on the left (`ratio` of the width), the others stack in equal rows
 * on the right. With a single window it takes the whole area.
 */
export function masterRects(n: number, area: Rect, gap: number, ratio = 0.55): Rect[] {
  if (n <= 0) return [];
  if (n === 1) return [area];
  const masterW = (area.w - gap) * Math.min(0.9, Math.max(0.1, ratio));
  const stackX = area.x + masterW + gap;
  const stackW = area.w - masterW - gap;
  const rowH = (area.h - gap * (n - 2)) / (n - 1);
  const out: Rect[] = [{ x: area.x, y: area.y, w: masterW, h: area.h }];
  for (let i = 0; i < n - 1; i++) out.push({ x: stackX, y: area.y + i * (rowH + gap), w: stackW, h: rowH });
  return out;
}

/** Centred columns of `colRatio` of the width; the focused column is centred and its neighbours peek in. */
export function scrollingRects(n: number, area: Rect, gap: number, focused: number, colRatio = 0.7): Rect[] {
  const colW = n === 1 ? area.w : area.w * colRatio;
  const start = area.x + (area.w - colW) / 2 - Math.max(0, focused) * (colW + gap);
  return Array.from({ length: n }, (_, i) => ({ x: start + i * (colW + gap), y: area.y, w: colW, h: area.h }));
}
