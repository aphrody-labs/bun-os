import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { binary, media, type EditStack } from "./index";

// Valid PNG built by hand so the test needs no binary fixture.
function png(w: number, h: number, rgba: (x: number, y: number) => number[]): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(rgba(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const z = deflateSync(raw);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", z),
    chunk("IEND", new Uint8Array()),
  ]);
}

let available = true;
try {
  binary();
} catch {
  available = false;
}

test.skipIf(!available)("probe, render, proxy cache and handoff through the Rust core", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aphrody-media-"));
  try {
    const file = join(dir, "in.png");
    await Bun.write(file, png(64, 48, (x, y) => [x * 4, y * 5, 128, 255]));

    const meta = await media.probe(file);
    expect([meta.width, meta.height, meta.format]).toEqual([64, 48, "png"]);

    const stack: EditStack = {
      ops: [{ op: "resize", w: 32, h: 24, filter: "lanczos3" }, { op: "invert" }],
    };
    const out = join(dir, "out.png");
    expect(await media.render(file, stack, out)).toMatchObject({ width: 32, height: 24 });
    expect((await media.probe(out)).width).toBe(32);

    const cache = join(dir, "cache");
    expect((await media.proxy(file, stack, cache, 16)).hit).toBe(false);
    expect((await media.proxy(file, stack, cache, 16)).hit).toBe(true);

    const inbox = join(dir, "inbox");
    await media.send(inbox, "photocraft", "effectcraft", file, stack, [10, 20]);
    expect(await media.receive(inbox, "filmcraft")).toBeNull();
    const h = await media.receive(inbox, "effectcraft");
    expect(h?.from).toBe("photocraft");
    expect(h?.frames).toEqual([10, 20]);
    expect(h?.stack).toEqual(stack);
    expect(await media.receive(inbox, "effectcraft")).toBeNull();

    await expect(
      media.render(file, { ops: [{ op: "ai", kind: "upscale", params: "{}" }] }, join(dir, "x.png")),
    ).rejects.toThrow(/no backend/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
