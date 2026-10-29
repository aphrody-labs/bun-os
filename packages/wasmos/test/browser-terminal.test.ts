// SPDX-License-Identifier: Apache-2.0
// An interactive shell in the browser: Alpine (Bochs + Linux in wasm) in a Web Worker, keystrokes through a
// SharedArrayBuffer ring, output rendered by Rio VT (WebTerminal), driven by headless Chromium.
//
//   WASMOS_ALPINE_WASM  the container2wasm image        WASMOS_CHROME   a Chromium/Chrome executable
//   WASMOS_RIO_WEB      wasm-bindgen --target web output of crates/aphrody-shell-web
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const wasm = process.env.WASMOS_ALPINE_WASM ?? "";
const rioWeb = process.env.WASMOS_RIO_WEB ?? "";
const chrome =
  process.env.WASMOS_CHROME ??
  ["/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const ISO = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };

test.skipIf(!wasm || !existsSync(wasm) || !rioWeb || !existsSync(rioWeb) || !chrome)(
  "type uname and ls into the browser terminal; Rio VT shows the real Alpine output",
  async () => {
    const build = async (entry: string) => {
      const r = await Bun.build({
        entrypoints: [join(import.meta.dir, entry)],
        target: "browser",
        format: "esm",
        external: ["/rio/*"], // served at runtime from WASMOS_RIO_WEB
      });
      expect(r.success).toBe(true);
      return r.outputs[0]!.text();
    };
    const worker = await build("browser/guest-worker.ts");
    const page = await build("browser/term-page.ts");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        const h = (type: string) => ({ ...ISO, "content-type": type });
        if (p === "/")
          return new Response('<!doctype html><meta charset=utf-8><script type="module" src="/page.js"></script>', {
            headers: h("text/html"),
          });
        if (p === "/page.js") return new Response(page, { headers: h("text/javascript") });
        if (p === "/guest-worker.js") return new Response(worker, { headers: h("text/javascript") });
        if (p === "/alpine.wasm") return new Response(Bun.file(wasm), { headers: h("application/wasm") });
        if (p.startsWith("/rio/")) {
          const f = Bun.file(join(rioWeb, p.slice(5)));
          return new Response(f, { headers: h(p.endsWith(".wasm") ? "application/wasm" : "text/javascript") });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
      const pageHandle = await browser.newPage();
      pageHandle.on("pageerror", e => console.log("[pageerror]", String(e)));
      pageHandle.on("console", m => console.log("[page]", m.text()));
      await pageHandle.goto(`http://localhost:${server.port}/`);
      const screen = () => pageHandle.evaluate(() => window.__term?.screen() ?? "");
      const waitFor = async (re: RegExp, ms: number) => {
        const deadline = Date.now() + ms;
        let s = "";
        while (Date.now() < deadline) {
          s = await screen();
          if (re.test(s)) return s;
          const err = await pageHandle.evaluate(() => window.__term?.error);
          if (err) throw new Error(err);
          await Bun.sleep(500);
        }
        throw new Error(`timeout waiting for ${re}; screen:\n${s}`);
      };
      // Booting prints the kernel banner and ends at a shell prompt ("# ").
      await waitFor(/#\s*$/m, 600_000);
      await pageHandle.evaluate(() => window.__term.type("uname -sm\n"));
      const after = await waitFor(/^Linux x86_64\s*$/m, 120_000);
      await pageHandle.evaluate(() => window.__term.type("ls /\n"));
      const ls = await waitFor(/(^|\s)home(\s|$)/m, 120_000);
      console.log(
        ls
          .split("\n")
          .filter(l => l.trim())
          .slice(-8)
          .join("\n"),
      );
      expect(after).toContain("uname -sm");
      expect(ls).toMatch(/(^|\s)usr(\s|$)/m);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  1_000_000,
);
