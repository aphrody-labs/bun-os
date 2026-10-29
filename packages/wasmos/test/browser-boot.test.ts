import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Boots the same container2wasm image in headless Chromium (Web Worker + browser_wasi_shim). Needs both the
// artifact (WASMOS_ALPINE_WASM) and a browser (WASMOS_CHROME). Skipped otherwise.
const wasm = process.env.WASMOS_ALPINE_WASM ?? "";
const chrome =
  process.env.WASMOS_CHROME ??
  ["/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);

// SharedArrayBuffer (Atomics.wait in poll_oneoff) needs cross-origin isolation.
const ISO = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };

test.skipIf(!wasm || !existsSync(wasm) || !chrome)(
  "Alpine x86_64 boots in headless Chromium and prints uname -a",
  async () => {
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, "browser/boot-worker.ts")],
      target: "browser",
      format: "esm",
    });
    expect(built.success).toBe(true);
    const js = await built.outputs[0]!.text();
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/")
          return new Response(Bun.file(join(import.meta.dir, "browser/boot.html")), {
            headers: { ...ISO, "content-type": "text/html" },
          });
        if (p === "/boot-worker.js")
          return new Response(js, { headers: { ...ISO, "content-type": "text/javascript" } });
        if (p === "/alpine.wasm")
          return new Response(Bun.file(wasm), { headers: { ...ISO, "content-type": "application/wasm" } });
        return new Response("not found", { status: 404 });
      },
    });
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      page.on("console", m => console.log("[page]", m.text()));
      page.on("pageerror", e => console.log("[pageerror]", String(e)));
      const args = encodeURIComponent(JSON.stringify(["sh", "-c", "dmesg | head -n 3; uname -a; apk --version"]));
      await page.goto(`http://localhost:${server.port}/?args=${args}`);
      await page.waitForFunction(() => (window as any).__boot !== undefined, undefined, {
        timeout: 1_500_000,
        polling: 2000,
      });
      const r: any = await page.evaluate(() => (window as any).__boot);
      await Bun.write(process.env.WASMOS_BROWSER_BOOT_LOG ?? "serial-browser.log", r.out ?? "");
      console.log(JSON.stringify({ ms: r.ms, code: r.code, error: r.error }));
      console.log(r.out);
      expect(r.error).toBeUndefined();
      expect(r.out).toMatch(/Linux version 6\.\d+/);
      expect(r.out).toMatch(/^Linux \S+ 6\.\d+\S* .* x86_64 Linux/m);
      expect(r.out).toMatch(/apk-tools \d/);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  1_600_000,
);
