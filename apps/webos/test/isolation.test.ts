// SPDX-License-Identifier: Apache-2.0
// Chromium check of the shell's cross-origin isolation (COOP same-origin + COEP credentialless): the page becomes
// isolated (SharedArrayBuffer available), third-party images still load, and a Browser-app style sandboxed frame
// only renders when its document carries the same headers (what `services/isolation.ts` adds to /api/browse).
//
// Needs a Chrome/Chromium (WASMOS_CHROME or a standard install) and playwright-core; skipped otherwise.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ISOLATION, isolated } from "../services/isolation";

const chrome =
  process.env.WASMOS_CHROME ??
  [
    "/usr/bin/google-chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);

let shell: ReturnType<typeof Bun.serve>;
let thirdParty: ReturnType<typeof Bun.serve>;
// 1x1 PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

beforeAll(() => {
  thirdParty = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(PNG, { headers: { "content-type": "image/png" } }), // no CORP header
  });
  shell = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/")
        return isolated(
          new Response(
            `<!doctype html><meta charset=utf-8>
<img id=remote src="http://localhost:${thirdParty.port}/pixel.png">
<iframe id=with sandbox="allow-scripts" src="/api/browse?isolated=1"></iframe>
<iframe id=without sandbox="allow-scripts" src="/api/browse?isolated=0"></iframe>
<script>window.frames_seen = new Set(); addEventListener("message", e => frames_seen.add(e.data));</script>`,
            { headers: { "content-type": "text/html" } },
          ),
        );
      if (url.pathname === "/api/browse") {
        const page = new Response(
          `<!doctype html><script>parent.postMessage("frame-${url.searchParams.get("isolated")}", "*")</script>`,
          {
            headers: {
              "content-type": "text/html",
              "content-security-policy": "sandbox allow-scripts",
            },
          },
        );
        return url.searchParams.get("isolated") === "1" ? isolated(page) : page;
      }
      return new Response("nf", { status: 404 });
    },
  });
});
afterAll(() => {
  shell.stop(true);
  thirdParty.stop(true);
});

test.skipIf(!chrome)(
  "the shell is cross-origin isolated, keeps third-party images, and renders frames that carry the isolation headers",
  async () => {
    expect(ISOLATION["cross-origin-embedder-policy"]).toBe("credentialless");
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${shell.port}/`);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({
        isolated: crossOriginIsolated,
        sab: typeof SharedArrayBuffer === "function",
        image: (document.getElementById("remote") as HTMLImageElement)
          .naturalWidth,
        frames: [...(window as any).frames_seen],
      }));
      expect(r.isolated).toBe(true);
      expect(r.sab).toBe(true);
      expect(r.image).toBe(1); // credentialless: the third-party image is not blocked
      expect(r.frames).toContain("frame-1"); // the isolated frame rendered
      expect(r.frames).not.toContain("frame-0"); // a frame without COEP is blocked by the embedder policy
    } finally {
      await browser.close();
    }
  },
  60_000,
);
