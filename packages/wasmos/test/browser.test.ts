import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compositorWasm } from "../src/build-compositor.ts";

// Headless Chromium through playwright-core. Set WASMOS_CHROME to a chrome/chromium executable; otherwise the
// test is skipped (it never downloads a browser).
const chrome = process.env.WASMOS_CHROME ?? ["/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);

test.skipIf(!chrome || !existsSync(compositorWasm))("compositor frame is identical on canvas 2D (and WebGPU when present)", async () => {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "browser/page.ts")], target: "browser", format: "esm" });
  expect(built.success).toBe(true);
  const js = await built.outputs[0]!.text();
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/") return new Response(Bun.file(join(import.meta.dir, "browser/index.html")));
      if (p === "/page.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
      if (p === "/compositor.wasm") return new Response(Bun.file(compositorWasm), { headers: { "content-type": "application/wasm" } });
      return new Response("not found", { status: 404 });
    },
  });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}/`);
    await page.waitForFunction(() => (window as any).__result !== undefined, undefined, { timeout: 60_000 });
    const r: any = await page.evaluate(() => (window as any).__result);
    console.log(JSON.stringify(r));
    expect(r.error).toBeUndefined();
    expect(r.canvas.bg).toEqual([0x1c, 0x1b, 0x1f, 255]);
    expect(r.canvas.title).toEqual([0x67, 0x50, 0xa4, 255]);
    expect(r.canvas.red).toEqual([0xe5, 0x39, 0x35, 255]);
    expect(r.canvas.blue).toEqual([0x1e, 0x88, 0xe5, 255]);
    if (r.webgpu.available) expect(r.webgpu.identical).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120_000);
