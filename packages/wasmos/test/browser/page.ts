import { Client, Compositor } from "../../src/compositor.ts";

declare global {
  interface Window { __result: unknown }
}
const out: Record<string, unknown> = {};
try {
  const c = await Compositor.load("/compositor.wasm", 640, 400);
  const client = new Client(c);
  const g = client.connect();
  client.window(g, 200, 100, 0xffe53935, "red");
  client.window(g, 160, 80, 0xff1e88e5, "blue");
  const fb = c.frame();
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(fb), 640, 400), 0, 0);
  const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  out.canvas = { bg: px(5, 5), title: px(30, 30), red: px(30, 60), blue: px(100, 100) };

  // WebGPU round trip of the same framebuffer: upload as rgba8unorm texture, copy back, compare.
  const gpu = (navigator as any).gpu;
  const adapter = gpu ? await gpu.requestAdapter() : null;
  if (!adapter) out.webgpu = { available: false };
  else {
    const dev = await adapter.requestDevice();
    const tex = dev.createTexture({ size: [640, 400], format: "rgba8unorm", usage: 0x01 | 0x02 | 0x04 | 0x10 }); // COPY_SRC|COPY_DST|TEXTURE_BINDING|... 
    dev.queue.writeTexture({ texture: tex }, fb, { bytesPerRow: 640 * 4 }, [640, 400]);
    const buf = dev.createBuffer({ size: 640 * 4 * 400, usage: 0x01 | 0x08 }); // MAP_READ|COPY_DST
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 640 * 4 }, [640, 400]);
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(1);
    const back = new Uint8Array(buf.getMappedRange());
    let same = true;
    for (let i = 0; i < back.length; i++) if (back[i] !== fb[i]) { same = false; break; }
    out.webgpu = { available: true, info: adapter.info?.description ?? adapter.info?.vendor ?? "", identical: same };
  }
} catch (e) {
  out.error = String(e);
}
window.__result = out;
