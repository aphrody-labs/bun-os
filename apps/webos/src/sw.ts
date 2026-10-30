// SPDX-License-Identifier: Apache-2.0
// Offline shell and installed app packages.
// - The desktop shell (HTML, script, styles, fonts, icons, file-system wasm) is precached on install and
//   served network-first, so every online visit gets the newest build and an offline visit still boots.
// - Installed app packages are served from their own Cache Storage entries (see pkg.ts).
declare const self: ServiceWorkerGlobalScope;

declare const __SHELL_CHUNKS__: string | undefined;
/** Hashed app chunks of the shell build (build.ts), precached so every app opens offline. */
const CHUNKS: string[] =
  typeof __SHELL_CHUNKS__ === "string" ? JSON.parse(__SHELL_CHUNKS__) : [];

const SHELL = "shell-v3";
const SHELL_FILES = [
  "/",
  "/main.js",
  "/boot.js",
  "/styles.css",
  "/m3.css",
  "/fonts.css",
  "/fonts/GoogleSansFlex-latin.woff2",
  "/fonts/material-symbols-rounded.woff2",
  "/brand/32.png",
  "/brand/64.png",
  "/brand/192.png",
  "/manifest.webmanifest",
  "/wasm/aphrody_webos_wasm_bg.wasm",
];
const SHELL_PATHS = new Set(SHELL_FILES);
const PRECACHE = [...SHELL_FILES, ...CHUNKS];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One missing file must not block installation of the rest.
      await Promise.all(
        PRECACHE.map((path) =>
          cache.add(new Request(path, { cache: "reload" })).catch(() => {}),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("shell-") && name !== SHELL)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);

/** Network first; refresh the cached copy on success, fall back to it offline. */
async function shell(request: Request, key: string): Promise<Response> {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic")
      await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(key)) ?? (await cache.match("/"));
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Desktop navigations (/, /pdf, /film ...) all boot the same shell document.
  if (
    request.mode === "navigate" &&
    !url.pathname.startsWith("/apps/") &&
    !url.pathname.startsWith("/workspace") &&
    !url.pathname.startsWith("/a/") &&
    !url.pathname.startsWith("/play")
  ) {
    event.respondWith(shell(request, "/"));
    return;
  }
  // Chunk names carry a content hash: cache first, they never change.
  if (url.pathname.startsWith("/chunks/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(url.pathname, response.clone());
        return response;
      })(),
    );
    return;
  }
  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(shell(request, url.pathname));
    return;
  }

  if (!url.pathname.startsWith("/apps/")) return;
  // Package updates must reach the network to verify the newly published bytes.
  if (request.cache === "no-store" || request.cache === "reload") return;
  const id = url.pathname.split("/")[2];
  if (!id) return;
  event.respondWith(
    (async () => {
      // A staging cache contains an incomplete transaction and must never serve an app.
      const name = `pkg:${id}`;
      const hit = (await caches.has(name))
        ? await (
            await caches.open(name)
          ).match(url.pathname, { ignoreSearch: true })
        : undefined;
      return hit ?? fetch(request);
    })(),
  );
});
