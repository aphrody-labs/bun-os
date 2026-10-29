// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { ShakeDetector } from "./shake";

/** Deterministic noise in [-1, 1] so the trajectories are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

interface Pt {
  x: number;
  y: number;
  t: number;
}

/** Pointer events at ~60 Hz with timestamp jitter and 1 px sensor noise, around (x0, y0). */
function trajectory(
  durationMs: number,
  at: (ms: number) => { x: number; y: number },
  x0 = 600,
  y0 = 400,
  seed = 7,
): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  for (let ms = 0; ms <= durationMs; ms += 16.7 + r() * 3) {
    const p = at(ms);
    out.push({ x: x0 + p.x + r(), y: y0 + p.y + r(), t: 1000 + ms });
  }
  return out;
}

const triggers = (points: Pt[], d = new ShakeDetector()) => points.filter(p => d.push(p.x, p.y, p.t)).length;

describe("shake gesture", () => {
  test("a horizontal wiggle (7 Hz, +-70 px) triggers once", () => {
    const pts = trajectory(1000, ms => ({ x: 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), y: 0 }));
    expect(triggers(pts)).toBe(1);
  });

  test("a vertical wiggle triggers", () => {
    const pts = trajectory(1000, ms => ({ x: 0, y: 60 * Math.sin((2 * Math.PI * 6 * ms) / 1000) }));
    expect(triggers(pts)).toBe(1);
  });

  test("a diagonal wiggle with hand drift triggers", () => {
    const pts = trajectory(1000, ms => ({
      x: 55 * Math.sin((2 * Math.PI * 7 * ms) / 1000) + ms * 0.02,
      y: 25 * Math.sin((2 * Math.PI * 7 * ms) / 1000),
    }));
    expect(triggers(pts)).toBe(1);
  });

  test("the first trigger ends the gesture: it does not fire again during the cooldown", () => {
    const pts = trajectory(1400, ms => ({ x: 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), y: 0 }));
    expect(triggers(pts)).toBe(1);
  });

  test("it can trigger again after the cooldown", () => {
    const d = new ShakeDetector();
    const first = trajectory(900, ms => ({ x: 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), y: 0 }));
    const second = trajectory(900, ms => ({ x: 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), y: 0 }), 600, 400, 11).map(
      p => ({ ...p, t: p.t + 5000 }),
    );
    expect(triggers(first, d) + triggers(second, d)).toBe(2);
  });

  test("a deliberate move across the screen does not trigger", () => {
    const pts = trajectory(700, ms => ({ x: (ms / 700) ** 2 * 900, y: (ms / 700) * 200 }));
    expect(triggers(pts)).toBe(0);
  });

  test("a slow side-to-side sweep (1 Hz) does not trigger", () => {
    const pts = trajectory(4000, ms => ({ x: 120 * Math.sin((2 * Math.PI * ms) / 1000), y: 0 }));
    expect(triggers(pts)).toBe(0);
  });

  test("hand tremor (6 px at 10 Hz) does not trigger", () => {
    const pts = trajectory(2000, ms => ({ x: 6 * Math.sin((2 * Math.PI * 10 * ms) / 1000), y: 0 }));
    expect(triggers(pts)).toBe(0);
  });

  test("a fast circle does not trigger", () => {
    const pts = trajectory(1000, ms => ({
      x: 70 * Math.cos((2 * Math.PI * 5 * ms) / 1000),
      y: 70 * Math.sin((2 * Math.PI * 5 * ms) / 1000),
    }));
    expect(triggers(pts)).toBe(0);
  });

  test("a single flick out and back (two reversals at most) does not trigger", () => {
    const pts = trajectory(500, ms => ({ x: ms < 250 ? ms * 0.8 : (500 - ms) * 0.8, y: 0 }));
    expect(triggers(pts)).toBe(0);
  });

  test("a pause between strokes longer than the window does not trigger", () => {
    const d = new ShakeDetector();
    let fired = 0;
    // Two strokes, 1.5 s apart: never four reversals within 800 ms.
    for (const base of [0, 1500]) {
      for (const p of trajectory(400, ms => ({ x: 60 * Math.sin((2 * Math.PI * 3 * ms) / 1000), y: 0 }))) {
        if (d.push(p.x, p.y, p.t + base)) fired++;
      }
    }
    expect(fired).toBe(0);
  });
});
