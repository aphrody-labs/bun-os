// SPDX-License-Identifier: Apache-2.0
import catalog from "../../../packages/bun-engine/web-emulation/authorized-content.json";

interface Bucket {
  head(key: string): Promise<{ size: number; httpEtag: string } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length?: number } },
  ): Promise<{ body: ReadableStream } | null>;
}
interface Assets {
  fetch(request: Request): Promise<Response>;
}

/** Public, read-only delivery of explicitly published authorized game objects. */
export async function gameContentResponse(
  request: Request,
  assets: Assets,
  bucket: Bucket,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = /^\/games\/content\/([a-z0-9-]+)$/.exec(url.pathname);
  if (!match) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  const pin = catalog.content.find((entry) => entry.id === match[1]);
  if (!pin?.member) return new Response("Not found", { status: 404 });
  const manifestResponse = await assets.fetch(
    new Request(new URL("/games/content.json", url).href),
  );
  if (
    !manifestResponse.ok ||
    !manifestResponse.headers.get("content-type")?.includes("application/json")
  )
    return new Response("Not found", { status: 404 });
  const manifest = (await manifestResponse.json()) as {
    schemaVersion?: number;
    content?: {
      id: string;
      sha256: string;
      bytes: number;
      objectKey: string;
      url: string;
    }[];
  };
  const key = `objects/sha256/${pin.member.sha256}`;
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.content?.some(
      (entry) =>
        entry.id === pin.id &&
        entry.sha256 === pin.member!.sha256 &&
        entry.bytes === pin.member!.bytes &&
        entry.objectKey === key &&
        entry.url === url.pathname,
    )
  )
    return new Response("Not found", { status: 404 });
  const object = await bucket.head(key);
  if (!object || object.size !== pin.member.bytes)
    return new Response("Published content unavailable", { status: 503 });
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "accept-ranges": "bytes",
    "content-length": String(object.size),
    etag: object.httpEtag,
    "cache-control": "public, max-age=3600, must-revalidate",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${pin.output}"`,
  });
  if (request.method === "HEAD") return new Response(null, { headers });
  const ifRange = request.headers.get("if-range");
  const range =
    !ifRange || ifRange === object.httpEtag
      ? request.headers.get("range")
      : null;
  let offset = 0,
    length = object.size;
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parts || (!parts[1] && !parts[2]))
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${object.size}` },
      });
    const suffix = !parts[1];
    offset = suffix
      ? Math.max(0, object.size - Number(parts[2]))
      : Number(parts[1]);
    const end =
      suffix || !parts[2]
        ? object.size - 1
        : Math.min(object.size - 1, Number(parts[2]));
    if (
      ![offset, end].every(Number.isSafeInteger) ||
      offset > end ||
      offset >= object.size ||
      (suffix && Number(parts[2]) === 0)
    )
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${object.size}` },
      });
    length = end - offset + 1;
    headers.set("content-range", `bytes ${offset}-${end}/${object.size}`);
    headers.set("content-length", String(length));
  }
  const body = await bucket.get(
    key,
    range ? { range: { offset, length } } : undefined,
  );
  if (!body)
    return new Response("Published content unavailable", { status: 503 });
  return new Response(body.body, { status: range ? 206 : 200, headers });
}
