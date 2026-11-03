#!/usr/bin/env bun
/**
 * Local, cross-origin-isolated server for the web emulation artifacts (the headers
 * play.aphrody.app sends): COOP same-origin + COEP credentialless, application/wasm, immutable
 * cache for *.wasm/*.js, no-cache for manifests.
 *
 *   /emulation/...      dist/web-emulation
 *   /api/emulation      dist/web-emulation/index.json
 *   /roms/<pack>/<file> free homebrew from the bep cache (usr/var/cache/bep/roms), read-only
 *   /smoke/             the smoke-test page (smoke.html)
 */
import { join, normalize, resolve, sep } from "node:path";

const here = import.meta.dir;
const root = resolve(here, "../../..");
const dist = join(root, "dist", "web-emulation");
const roms = join(root, "usr", "var", "cache", "bep", "roms");

const types: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function contained(base: string, path: string): string | undefined {
  const full = normalize(join(base, decodeURIComponent(path)));
  return full.startsWith(`${base}${sep}`) ? full : undefined;
}

async function file(path: string | undefined): Promise<Response> {
  if (!path) return new Response("forbidden", { status: 403 });
  const blob = Bun.file(path);
  if (!(await blob.exists())) return new Response("not found", { status: 404 });
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  // Published files live under content-addressed directories (`<core>/<hash>/`), so they can
  // be cached forever; everything else revalidates.
  const immutable = (ext === ".wasm" || ext === ".js") && /[\\/][0-9a-f]{12}[\\/]/.test(path);
  return new Response(blob, {
    headers: {
      "content-type": types[ext] ?? "application/octet-stream",
      "cache-control":
        path.endsWith("manifest.json") || ext === ".json" || ext === ".html"
          ? "no-cache"
          : immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache",
    },
  });
}

export function serve(
  port = Number(Bun.env.PORT ?? 8787),
  options: { privateROM?: { token: string; path: string } } = {},
) {
  if (options.privateROM && !/^[a-f0-9-]{36}$/.test(options.privateROM.token))
    throw new Error("Invalid private ROM route token");
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    // Large local images and WASM files can stall briefly on a busy build host.
    idleTimeout: 120,
    async fetch(request) {
      const url = new URL(request.url);
      let response: Response;
      if (options.privateROM && url.pathname === `/private-rom/${options.privateROM.token}`) {
        if (request.method !== "GET") response = new Response("method not allowed", { status: 405 });
        else
          response = new Response(Bun.file(options.privateROM.path), {
            headers: {
              "content-type": "application/octet-stream",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
      } else if (url.pathname === "/favicon.ico") response = new Response(null, { status: 204 });
      else if (url.pathname === "/api/emulation") response = await file(join(dist, "index.json"));
      else if (url.pathname.startsWith("/emulation/"))
        response = await file(contained(dist, url.pathname.slice("/emulation/".length)));
      else if (url.pathname.startsWith("/roms/"))
        response = await file(contained(roms, url.pathname.slice("/roms/".length)));
      else if (url.pathname === "/smoke/" || url.pathname === "/") response = await file(join(here, "smoke.html"));
      else response = new Response("not found", { status: 404 });
      response.headers.set("cross-origin-opener-policy", "same-origin");
      response.headers.set("cross-origin-embedder-policy", "credentialless");
      response.headers.set("cross-origin-resource-policy", "same-origin");
      return response;
    },
  });
}

if (import.meta.main) {
  const server = serve();
  console.log(`web emulation: ${server.url}smoke/`);
}
