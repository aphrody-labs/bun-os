// SPDX-License-Identifier: Apache-2.0
// The compositor forwards its pointer stream to the injected recogniser; no wasm module is needed for this.
import { expect, test } from "bun:test";
import { ShakeDetector } from "../../../apps/webos/src/assistant/shake.ts";
import { Compositor, type CompositorExports } from "../src/compositor.ts";

const stub = { init() {} } as unknown as CompositorExports;

function wiggle(c: Compositor, from: number) {
  for (let ms = 0; ms <= 700; ms += 16)
    c.pointerMove(320 + 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), 200, from + ms);
}

test("a shake of the pointer over the framebuffer notifies listeners once", () => {
  const c = new Compositor(stub, 640, 400);
  c.useShakeGesture(new ShakeDetector());
  const seen: { x: number; y: number }[] = [];
  c.onShake(at => seen.push(at));
  wiggle(c, 1000);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.y).toBe(200);
});

test("ordinary pointer movement does not notify; unsubscribing stops notifications", () => {
  const c = new Compositor(stub, 640, 400);
  c.useShakeGesture(new ShakeDetector());
  let n = 0;
  const off = c.onShake(() => n++);
  for (let ms = 0; ms <= 700; ms += 16) c.pointerMove(50 + ms * 0.7, 50 + ms * 0.2, ms);
  expect(n).toBe(0);
  off();
  wiggle(c, 5000);
  expect(n).toBe(0);
});

test("without a recogniser the pointer stream is ignored", () => {
  const c = new Compositor(stub, 640, 400);
  let n = 0;
  c.onShake(() => n++);
  wiggle(c, 1000);
  expect(n).toBe(0);
});
