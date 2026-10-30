// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { dwindleRects, masterRects, scrollingRects, type Rect } from "./tile";

const area: Rect = { x: 0, y: 0, w: 1000, h: 600 };
const gap = 10;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, outer: Rect) =>
  r.x >= outer.x - 1e-9 && r.y >= outer.y - 1e-9 && r.x + r.w <= outer.x + outer.w + 1e-9 && r.y + r.h <= outer.y + outer.h + 1e-9;

describe("dwindle", () => {
  test("one window takes the whole area", () => {
    expect(dwindleRects(1, area, gap)).toEqual([area]);
  });
  test("two windows split the longer side", () => {
    const [a, b] = dwindleRects(2, area, gap);
    expect(a).toEqual({ x: 0, y: 0, w: 495, h: 600 });
    expect(b).toEqual({ x: 505, y: 0, w: 495, h: 600 });
  });
  test("the remainder alternates the split direction", () => {
    const rects = dwindleRects(3, area, gap);
    expect(rects[1]).toEqual({ x: 505, y: 0, w: 495, h: 295 });
    expect(rects[2]).toEqual({ x: 505, y: 305, w: 495, h: 295 });
  });
  test("rectangles never overlap and stay inside the area", () => {
    for (let n = 1; n <= 9; n++) {
      const rects = dwindleRects(n, area, gap);
      expect(rects).toHaveLength(n);
      for (const [i, r] of rects.entries()) {
        expect(inside(r, area)).toBe(true);
        for (const other of rects.slice(i + 1)) expect(overlap(r, other)).toBe(false);
      }
    }
  });
});

describe("master", () => {
  test("no window, no rectangle", () => {
    expect(masterRects(0, area, gap)).toEqual([]);
  });
  test("one window takes the whole area", () => {
    expect(masterRects(1, area, gap)).toEqual([area]);
  });
  test("the master is full height on the left, the stack is split in equal rows on the right", () => {
    const [m, s1, s2, s3] = masterRects(4, area, gap, 0.5);
    expect(m).toEqual({ x: 0, y: 0, w: 495, h: 600 });
    expect(s1!.x).toBe(505);
    expect(s1!.w).toBe(495);
    expect(s1!.h).toBeCloseTo((600 - 2 * gap) / 3);
    expect(s2!.y).toBeCloseTo(s1!.y + s1!.h + gap);
    expect(s3!.y + s3!.h).toBeCloseTo(600);
  });
  test("the ratio is clamped so neither column disappears", () => {
    expect(masterRects(2, area, gap, 5)[0]!.w).toBeCloseTo(990 * 0.9);
    expect(masterRects(2, area, gap, -1)[0]!.w).toBeCloseTo(990 * 0.1);
  });
  test("rectangles never overlap and stay inside the area", () => {
    for (let n = 1; n <= 9; n++) {
      const rects = masterRects(n, area, gap);
      for (const [i, r] of rects.entries()) {
        expect(inside(r, area)).toBe(true);
        for (const other of rects.slice(i + 1)) expect(overlap(r, other)).toBe(false);
      }
    }
  });
});

describe("scrolling", () => {
  test("a single column is full width", () => {
    expect(scrollingRects(1, area, gap, 0)).toEqual([{ ...area }]);
  });
  test("the focused column is centred", () => {
    const rects = scrollingRects(3, area, gap, 1);
    const r = rects[1]!;
    expect(r.x + r.w / 2).toBeCloseTo(area.x + area.w / 2);
    expect(rects[0]!.x + rects[0]!.w + gap).toBeCloseTo(r.x);
  });
});
