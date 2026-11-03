import { expect, test } from "bun:test";
// The browser runtime is plain JavaScript and does not publish TypeScript declarations.
// @ts-expect-error JavaScript module without declarations
import { bottomScreenPoint } from "../web-emulation/runtime/touch.js";

function point(width: number, height: number, x: number, y: number, system: string) {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) } as HTMLCanvasElement;
  const event = { clientX: x, clientY: y } as PointerEvent;
  return bottomScreenPoint(canvas, event, system);
}

test("DS touch maps letterboxed bottom-screen pixels and rejects other regions", () => {
  expect(point(512, 768, 160, 716, "nds")).toEqual({ x: 80, y: 166 });
  expect(point(800, 800, 400, 600, "nds")).toEqual({ x: 128, y: 96 });
  expect(point(512, 768, 100, 383, "nds")).toBeNull();
  expect(point(512, 768, 512, 500, "nds")).toBeNull();
});

test("3DS touch respects the narrower centered bottom screen", () => {
  expect(point(800, 960, 80, 480, "3ds")).toEqual({ x: 0, y: 0 });
  expect(point(800, 960, 719, 959, "3ds")).toEqual({ x: 319, y: 239 });
  expect(point(800, 960, 79, 600, "3ds")).toBeNull();
});

test("hidden or unsupported canvases do not generate invalid touch coordinates", () => {
  expect(point(0, 0, 0, 0, "nds")).toBeNull();
  expect(point(512, 768, 100, 500, "unknown")).toBeNull();
});
