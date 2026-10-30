// SPDX-License-Identifier: Apache-2.0
// "Wiggle the pointer to ask": detects a quick back-and-forth pointer shake. Pure (no DOM), fed with pointer samples.
//
// A shake is at least `minReversals` direction reversals along one axis, each separated by `minTravel` pixels of
// movement, inside `windowMs`, fast enough (`minSpeed`) and mostly along that axis (a fast circle has the same extent on
// both axes and is rejected, as are slow waves, tremor and a single flick).

export interface ShakeOptions {
  /** Time window the reversals must fit in (ms). */
  windowMs: number;
  /** Movement between two reversals (px). */
  minTravel: number;
  /** Reversals needed: 4 is two full back-and-forth strokes. */
  minReversals: number;
  /** Average pointer speed over the window (px/s). */
  minSpeed: number;
  /** Largest perpendicular extent relative to the shake axis extent. */
  maxPerpendicular: number;
  /** Silence after a trigger (ms). */
  cooldownMs: number;
}

export const DEFAULT_SHAKE: ShakeOptions = {
  windowMs: 800,
  minTravel: 40,
  minReversals: 4,
  minSpeed: 700,
  maxPerpendicular: 0.6,
  cooldownMs: 1500,
};

interface Sample {
  x: number;
  y: number;
  t: number;
}

class Axis {
  dir: 0 | 1 | -1 = 0;
  ext = 0;
  reversals: number[] = [];
  constructor(private readonly minTravel: number) {}
  reset(v: number) {
    this.dir = 0;
    this.ext = v;
    this.reversals = [];
  }
  push(v: number, t: number) {
    if (this.dir === 0) {
      if (Math.abs(v - this.ext) >= this.minTravel) {
        this.dir = v > this.ext ? 1 : -1;
        this.ext = v;
      }
    } else if (this.dir === 1) {
      if (v > this.ext) this.ext = v;
      else if (this.ext - v >= this.minTravel) {
        this.reversals.push(t);
        this.dir = -1;
        this.ext = v;
      }
    } else if (v < this.ext) this.ext = v;
    else if (v - this.ext >= this.minTravel) {
      this.reversals.push(t);
      this.dir = 1;
      this.ext = v;
    }
  }
}

export class ShakeDetector {
  private samples: Sample[] = [];
  private readonly ax: Axis;
  private readonly ay: Axis;
  private quietUntil = -Infinity;
  private readonly o: ShakeOptions;

  constructor(options: Partial<ShakeOptions> = {}) {
    this.o = { ...DEFAULT_SHAKE, ...options };
    this.ax = new Axis(this.o.minTravel);
    this.ay = new Axis(this.o.minTravel);
  }

  /** Feed one pointer sample (px, ms). Returns true exactly when a shake completes. */
  push(x: number, y: number, t: number): boolean {
    const last = this.samples.at(-1);
    if (!last || t - last.t > this.o.windowMs) {
      // First sample, or the pointer rested longer than the window: a new gesture starts here.
      this.samples = [];
      this.ax.reset(x);
      this.ay.reset(y);
    }
    this.samples.push({ x, y, t });
    // Drop what left the window; the axes forget old reversals the same way.
    const from = t - this.o.windowMs;
    while (this.samples.length > 1 && this.samples[0]!.t < from) this.samples.shift();
    this.ax.push(x, t);
    this.ay.push(y, t);
    this.ax.reversals = this.ax.reversals.filter(r => r >= from);
    this.ay.reversals = this.ay.reversals.filter(r => r >= from);
    if (t < this.quietUntil) return false;
    const horizontal = this.ax.reversals.length >= this.o.minReversals;
    const vertical = this.ay.reversals.length >= this.o.minReversals;
    if (!horizontal && !vertical) return false;
    // Extent along and across the shake, and the path length covered in the window.
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      path = 0;
    for (const [i, s] of this.samples.entries()) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
      if (i > 0) path += Math.hypot(s.x - this.samples[i - 1]!.x, s.y - this.samples[i - 1]!.y);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const main = horizontal && (!vertical || spanX >= spanY) ? spanX : spanY;
    const across = main === spanX ? spanY : spanX;
    const duration = Math.max(1, t - this.samples[0]!.t);
    const speed = (path / duration) * 1000;
    if (across > main * this.o.maxPerpendicular || speed < this.o.minSpeed) return false;
    this.quietUntil = t + this.o.cooldownMs;
    this.ax.reset(x);
    this.ay.reset(y);
    this.samples = [{ x, y, t }];
    return true;
  }
}
