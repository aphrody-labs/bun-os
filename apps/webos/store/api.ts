// SPDX-License-Identifier: Apache-2.0
// /api/store/*: read-only JSON of the Store, generated on the VPS into STORE_ROOT (store/cli.ts).
import { join } from "node:path";

const root = () => Bun.env.WEBOS_STORE ?? join(Bun.env.HOME ?? "/root", "apps/webos/store");
const FORMAT = /^(pacman|apk|flatpak|npm|cargo|android)$/;

export async function storeApi(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/store/")) return undefined;
  const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" };
  if (request.method !== "GET" && request.method !== "HEAD")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  const rest = url.pathname.slice("/api/store/".length).replace(/\/$/, "");
  let file: string | undefined;
  if (rest === "catalog") file = "catalog.json";
  else if (rest === "qualification") file = "qualification.json";
  else if (rest.startsWith("index/") && FORMAT.test(rest.slice(6))) file = `${rest}.json`;
  if (!file) return Response.json({ error: "No such store resource" }, { status: 404, headers });
  const body = Bun.file(join(root(), file));
  if (!(await body.exists())) return Response.json({ error: "Not generated yet" }, { status: 404, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}
