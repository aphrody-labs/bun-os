import { beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client, Compositor } from "../src/compositor.ts";

const wasm = join(import.meta.dir, "../compositor/target/wasm32-unknown-unknown/release/wasmos_compositor.wasm");

beforeAll(() => {
  if (!existsSync(wasm)) {
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), "build-compositor"], { stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) throw new Error("build-compositor failed");
  }
});

test("two Wayland clients render to the framebuffer with correct stacking", async () => {
  const c = await Compositor.load(await Bun.file(wasm).bytes(), 640, 400);
  const client = new Client(c);
  const g = client.connect();
  expect(g.formats).toBe(2);

  const a = client.window(g, 200, 100, 0xffe53935, "red");
  // frame callback fired and buffer released on commit
  expect(a.events.some(e => e.id === a.buffer && e.op === 0)).toBe(true);
  const b = client.window(g, 160, 80, 0xff1e88e5, "blue");
  expect(b.events.some(e => e.op === 0 && e.id !== b.buffer)).toBe(true);
  expect(c.x.window_count()).toBe(2);

  const fb = c.frame();
  const bg = [0x1c, 0x1b, 0x1f, 255];
  expect(c.pixel(fb, 5, 5)).toEqual(bg);
  expect(c.pixel(fb, 30, 200)).toEqual(bg);
  // window 1 at (24,24): title bar primary, content red, border
  expect(c.pixel(fb, 30, 30)).toEqual([0x67, 0x50, 0xa4, 255]);
  expect(c.pixel(fb, 30, 60)).toEqual([0xe5, 0x39, 0x35, 255]);
  expect(c.pixel(fb, 23, 60)).toEqual([0xd0, 0xbc, 0xff, 255]);
  // window 2 at (80,72) is on top of window 1 where they overlap
  expect(c.pixel(fb, 100, 100)).toEqual([0x1e, 0x88, 0xe5, 255]);
  expect(c.pixel(fb, 100, 80)).toEqual([0x67, 0x50, 0xa4, 255]);
  // red still visible where blue does not cover it
  expect(c.pixel(fb, 40, 140)).toEqual([0xe5, 0x39, 0x35, 255]);
  // exact pixel count of each colour
  let red = 0, blue = 0;
  for (let i = 0; i < fb.length; i += 4) {
    if (fb[i] === 0xe5 && fb[i + 1] === 0x39 && fb[i + 2] === 0x35) red++;
    if (fb[i] === 0x1e && fb[i + 1] === 0x88 && fb[i + 2] === 0xe5) blue++;
  }
  expect(blue).toBe(160 * 80);
  expect(red).toBe(200 * 100 - overlap());
});

// window 2 content rect (80,96)-(240,176); window 2 border/title also cover window 1; compute covered red pixels.
function overlap() {
  // red content: x 24..224, y 48..148. Window 2 outer box (border included): x 79..241, y 71..177.
  const x0 = Math.max(24, 79), x1 = Math.min(224, 241), y0 = Math.max(48, 71), y1 = Math.min(148, 177);
  return (x1 - x0) * (y1 - y0);
}

test("malformed and truncated messages do not trap", async () => {
  const c = await Compositor.load(await Bun.file(wasm).bytes(), 64, 64);
  expect(c.send(new Uint8Array([1, 0, 0, 0, 0, 0, 4, 0]))).toBe(0); // size < 8
  expect(c.send(new Uint8Array([99, 0, 0, 0, 0, 0, 8, 0]))).toBe(1); // unknown object ignored
  expect(c.frame().length).toBe(64 * 64 * 4);
});
