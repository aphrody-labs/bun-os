import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLibraryPath } from "@aphrody/runtime-sdk";
import { startServer } from "../src/server.ts";

describe("react feature: bundling", () => {
  it("bundles the HTML entry with React and the Material 3 components, without a plugin", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "react-bundle-"));
    try {
      const result = await Bun.build({
        entrypoints: [join(import.meta.dir, "../src/web/index.html")],
        outdir,
      });
      // @aphrody/m3-theme/tokens.css also carries its Tailwind v4 `@theme inline` aliases, which plain CSS skips.
      expect(result.logs.map(String).filter(log => !log.includes("'@theme'"))).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.outputs.some(output => output.path.endsWith(".css"))).toBe(true);
      const scripts = result.outputs.filter(output => output.path.endsWith(".js"));
      expect(scripts.length).toBeGreaterThan(0);
      const code = (await Promise.all(scripts.map(script => script.text()))).join("\n");
      for (const tag of ["md-filled-button", "md-text-button", "md-outlined-text-field", "md-linear-progress"]) {
        expect(code).toContain(tag);
      }
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});

(existsSync(defaultLibraryPath()) ? describe : describe.skip)("react feature: server", () => {
  it("serves the React page and its script at /", async () => {
    const { server, db } = startServer({ port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const response = await fetch(`${base}/`);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("<title>__NAME__</title>");
      expect(html).toContain('<div id="root"></div>');
      const src = /<script[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
      expect(src).toBeDefined();
      const script = await fetch(new URL(src as string, base));
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("javascript");
    } finally {
      await server.stop(true);
      db.close();
    }
  });
});
