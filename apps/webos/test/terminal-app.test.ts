// SPDX-License-Identifier: Apache-2.0
// The real Terminal app in headless Chromium: it boots the Alpine guest (streamed into OPFS on the first start, loaded
// from the cache on the second), you type into it, and Rio VT shows what the guest's shell printed.
//
//   WEBOS_WASM_DIR      wasm-bindgen output of crates/aphrody-webos-wasm (aphrody_webos_wasm.js + _bg.wasm), also
//                       copied to packages/webos-wasm/wasm so the `#webos-wasm-glue` import resolves
//   WASMOS_ALPINE_WASM  the container2wasm image        WASMOS_CHROME  a Chrome/Chromium executable
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isolated } from "../services/isolation";

const glueDir = process.env.WEBOS_WASM_DIR ?? "";
const alpine = process.env.WASMOS_ALPINE_WASM ?? "";
const chrome =
  process.env.WASMOS_CHROME ??
  [
    "/usr/bin/google-chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
const ready =
  !!glueDir &&
  existsSync(join(glueDir, "aphrody_webos_wasm_bg.wasm")) &&
  !!alpine &&
  existsSync(alpine) &&
  !!chrome;

test.skipIf(!ready)(
  "type uname into the Terminal app: first boot downloads and caches the image, second boot reads the cache",
  async () => {
    const root = join(import.meta.dir, "../../..");
    const entry = join(import.meta.dir, "terminal-app-entry.ts");
    await Bun.write(
      entry,
      'import { terminalApp } from "../src/apps/terminal";\nvoid terminalApp(document.body);\n',
    );
    const bundle = async (path: string) => {
      const r = await Bun.build({
        entrypoints: [path],
        target: "browser",
        format: "esm",
        root,
      });
      if (!r.success) throw new Error(r.logs.join("\n"));
      return r.outputs[0]!.text();
    };
    const page = await bundle(entry);
    const worker = await bundle(
      join(root, "packages/webos-wasm/src/guest-worker.ts"),
    );
    const size = Bun.file(alpine).size;
    let imageGets = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        const js = (body: string) =>
          isolated(
            new Response(body, {
              headers: { "content-type": "text/javascript" },
            }),
          );
        if (p === "/")
          return isolated(
            new Response(
              '<!doctype html><meta charset=utf-8><body style="background:#111">',
              { headers: { "content-type": "text/html" } },
            ),
          );
        if (p === "/page.js") return js(page);
        if (p === "/guest-worker.js") return js(worker);
        if (p === "/wasm/aphrody_webos_wasm_bg.wasm")
          return isolated(
            new Response(
              Bun.file(join(glueDir, "aphrody_webos_wasm_bg.wasm")),
              { headers: { "content-type": "application/wasm" } },
            ),
          );
        if (p === "/vm/alpine-x86_64.wasm") {
          if (req.method === "GET") imageGets++;
          return isolated(
            new Response(req.method === "HEAD" ? null : Bun.file(alpine), {
              headers: {
                "content-type": "application/wasm",
                etag: '"test-1"',
                "content-length": String(size),
              },
            }),
          );
        }
        return new Response("nf", { status: 404 });
      },
    });
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext();
      const open = async () => {
        const p = await context.newPage();
        p.on("pageerror", (e) => console.log("[pageerror]", String(e)));
        await p
          .setContent(
            '<!doctype html><script type="module" src="/page.js"></script>',
            { waitUntil: "commit" },
          )
          .catch(() => {});
        await p.goto(`http://localhost:${server.port}/`);
        await p.addScriptTag({ type: "module", url: "/page.js" });
        return p;
      };
      const screen = (p: Awaited<ReturnType<typeof open>>) =>
        p.locator(".tm-screen").innerText();
      const until = async (
        p: Awaited<ReturnType<typeof open>>,
        re: RegExp,
        ms: number,
      ) => {
        const deadline = Date.now() + ms;
        let s = "";
        while (Date.now() < deadline) {
          s = await screen(p).catch(() => "");
          if (re.test(s)) return s;
          await Bun.sleep(500);
        }
        throw new Error(
          `timeout waiting for ${re}\n${s}\nstatus: ${await p
            .locator(".tm-status")
            .innerText()
            .catch(() => "")}`,
        );
      };

      const first = await open();
      await until(first, /#\s*$/m, 600_000);
      await first.locator(".tm-sink").focus();
      await first.keyboard.type("uname -sm");
      await first.keyboard.press("Enter");
      const out = await until(first, /^Linux x86_64\s*$/m, 120_000);
      expect(out).toContain("uname -sm");
      expect(imageGets).toBe(1);
      await first.close();

      const second = await open();
      await until(second, /#\s*$/m, 600_000);
      expect(imageGets).toBe(1); // served from OPFS this time
      await second.close();
    } finally {
      await browser.close();
      server.stop(true);
      await Bun.file(entry).delete();
    }
  },
  1_800_000,
);
