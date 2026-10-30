// SPDX-License-Identifier: Apache-2.0
// Native Bun host for the shared HTTP handler; production uses an immutable release.
import { join, relative, resolve, isAbsolute } from "node:path";
import worker from "./worker/index";
import { nativeAPI } from "./native-api";
import { publicFetch } from "./public-fetch";
import { storeApi } from "./store/api";

const dist = resolve(Bun.env.WEBOS_DIST ?? join(import.meta.dir, "dist"));
const objects = resolve(
  Bun.env.WEBOS_OBJECTS ?? join(import.meta.dir, "../../build/webos-objects"),
);
const apiOrigin = Bun.env.BUN_OS_API_ORIGIN
  ? new URL(Bun.env.BUN_OS_API_ORIGIN)
  : undefined;
if (
  apiOrigin &&
  (!/^https?:$/.test(apiOrigin.protocol) ||
    apiOrigin.username ||
    apiOrigin.password ||
    apiOrigin.pathname !== "/" ||
    apiOrigin.search ||
    apiOrigin.hash)
)
  throw new Error(
    "BUN_OS_API_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.",
  );
const api = {
  async fetch(request: Request): Promise<Response> {
    if (!apiOrigin) return nativeAPI(request);
    const url = new URL(request.url);
    return fetch(
      new Request(new URL(url.pathname + url.search, apiOrigin).href, request),
      { redirect: "manual" },
    );
  },
};
async function objectFile(key: string) {
  if (
    !key ||
    key
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || /[\\:\0]/.test(part),
      )
  )
    throw new Error("Invalid object key");
  const shared = Bun.file(join(objects, key));
  return (await shared.exists())
    ? shared
    : Bun.file(join(import.meta.dir, "objects", key));
}
const vm = {
  async head(key: string) {
    const file = await objectFile(key);
    return (await file.exists())
      ? {
          size: file.size,
          httpEtag: `"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`,
        }
      : null;
  },
  async get(
    key: string,
    options?: { range?: { offset: number; length?: number } },
  ) {
    const file = await objectFile(key);
    if (!(await file.exists())) return null;
    const r = options?.range;
    const slice = r
      ? file.slice(r.offset, r.offset + (r.length ?? file.size - r.offset))
      : file;
    return {
      body: slice.stream(),
      size: file.size,
      httpEtag: `"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`,
    };
  },
};
const assets = {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.some((part) => part === ".." || /[\\:\0]/.test(part)))
      return new Response("Bad path", { status: 400 });
    const path = parts.join("/");
    const candidates = [
      path,
      join(path, "index.html"),
      ...(!parts.at(-1)?.includes(".") ? ["index.html"] : []),
    ];
    for (const candidate of candidates) {
      const full = resolve(dist, candidate);
      const within = relative(dist, full);
      if (within.startsWith("..") || isAbsolute(within))
        return new Response("Bad path", { status: 400 });
      const file = Bun.file(full);
      if (await file.exists()) {
        const etag = `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
        const headers = {
          "content-type": file.type,
          etag,
          "cache-control": "no-cache",
        };
        const matches = request.headers
          .get("if-none-match")
          ?.split(",")
          .some((value) => value.trim() === etag || value.trim() === "*");
        if (matches) return new Response(null, { status: 304, headers });
        return new Response(request.method === "HEAD" ? null : file, {
          headers,
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? Bun.argv[2] ?? 8790),
  hostname: "127.0.0.1",
  maxRequestBodySize: 1024 * 1024,
  idleTimeout: 30,
  fetch: async (request) => {
    const store = await storeApi(request);
    if (store) return store;
    return worker.fetch(request, {
      BROWSE_FETCH: publicFetch,
      ASSETS: assets,
      VM: vm,
      LEGACY: api,
      SOURCE_COMMIT: Bun.env.SOURCE_COMMIT,
    });
  },
});
console.log(`webos: ${server.url}`);
