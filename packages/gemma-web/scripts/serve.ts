// SPDX-License-Identifier: Apache-2.0
// Static server: dist/web at /, model files at /model/* (HTTP Range supported), COOP/COEP for threaded wasm.
import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

export interface ServeOptions {
  dist: string;
  modelDir?: string | undefined;
  port?: number;
}

const HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
};

export function serve(o: ServeOptions) {
  return Bun.serve({
    port: o.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      let base = resolve(o.dist);
      let rel = decodeURIComponent(url.pathname);
      if (rel.startsWith("/model/") && o.modelDir) {
        base = resolve(o.modelDir);
        rel = rel.slice("/model".length);
      }
      if (rel === "/") rel = "/index.html";
      const p = normalize(join(base, rel));
      if (!p.startsWith(base) || !existsSync(p)) return new Response("not found", { status: 404, headers: HEADERS });
      const file = Bun.file(p);
      const range = req.headers.get("range");
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(file.size - 1, m[2] ? Number(m[2]) : file.size - 1);
          return new Response(file.slice(start, end + 1), {
            status: 206,
            headers: {
              ...HEADERS,
              "content-range": `bytes ${start}-${end}/${file.size}`,
              "accept-ranges": "bytes",
              "content-type": file.type,
            },
          });
        }
      }
      return new Response(file, { headers: { ...HEADERS, "accept-ranges": "bytes" } });
    },
  });
}

if (import.meta.main) {
  const s = serve({
    dist: join(import.meta.dir, "..", "dist", "web"),
    modelDir: process.env["GEMMA_MODEL_DIR"],
    port: Number(process.env["PORT"] ?? 8099),
  });
  console.log(`http://localhost:${s.port}/`);
}
