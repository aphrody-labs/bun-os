// SPDX-License-Identifier: Apache-2.0
// /api/store/*: read-only JSON of the Store, generated on the VPS into STORE_ROOT (store/cli.ts). Public through the
// API gateway as https://api.aphrody.com/v1/store/ (infra/fleet/api.toml); contract in docs/ops/API.md.
import { join } from "node:path";
import { apiContract, defineApi, problem } from "../../../packages/bun-os-platform/src/api/index.ts";

const root = () => Bun.env.WEBOS_STORE ?? join(Bun.env.HOME ?? "/root", "apps/webos/store");
const FORMATS = ["pacman", "apk", "flatpak", "npm", "cargo", "android", "winget", "apt", "appstream"] as const;
const FORMAT = new RegExp(`^(${FORMATS.join("|")})$`);

/** The Store route table: the single source of its OpenAPI document. */
export const storeSpec = defineApi(
  {
    service: "store",
    title: "Bun OS Store",
    version: "1.4.7",
    description:
      "Read-only Store data: the unified catalog over pacman, apk, flatpak, npm, cargo, Android, winget, apt and AppStream, its qualification results, one index per format, and a winget REST source.",
  },
  {
    "GET /catalog": {
      summary: "Store catalog",
      tags: ["catalog"],
      responses: { 200: { description: "Unified catalog" }, 404: { description: "Not generated yet" } },
    },
    "GET /qualification": {
      summary: "Qualification results",
      description: "Last install/run qualification of every package format.",
      tags: ["catalog"],
      responses: { 200: { description: "Qualification report" }, 404: { description: "Not generated yet" } },
    },
    "GET /index/{format}": {
      summary: "Package index of one format",
      tags: ["catalog"],
      params: [
        { name: "format", in: "path", description: "Package format", schema: { type: "string", enum: [...FORMATS] } },
      ],
      responses: { 200: { description: "Index entries" }, 404: { description: "Unknown format or not generated" } },
    },
    "GET /winget/information": {
      summary: "winget REST source information",
      tags: ["winget"],
      errorFormat: "winget",
      responses: { 200: { description: "Source information (winget-cli-restsource)" } },
    },
    "POST /winget/manifestSearch": {
      summary: "winget manifest search",
      tags: ["winget"],
      errorFormat: "winget",
      body: { description: "winget ManifestSearchRequest" },
      responses: {
        200: { description: "Matching packages" },
        204: { description: "No match" },
        400: { description: "Invalid JSON", type: "application/json" },
      },
    },
    "GET /winget/packageManifests/{id}": {
      summary: "winget package manifest",
      tags: ["winget"],
      errorFormat: "winget",
      params: [{ name: "Version", in: "query", description: "Only this package version" }],
      responses: {
        200: { description: "Package manifests" },
        204: { description: "No such version" },
        404: { description: "Package not found", type: "application/json" },
      },
    },
  },
);

const contract = apiContract(storeSpec, {
  base: "/api/store",
  checks: async () => ({
    catalog: { ok: await Bun.file(join(root(), "catalog.json")).exists(), detail: "catalog.json generated" },
  }),
});

export async function storeApi(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/store/")) return undefined;
  const standard = await contract(request);
  if (standard) return standard;
  const headers = {
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
  };
  // winget REST source (manifestSearch is a POST in the winget-cli-restsource protocol).
  if (url.pathname.startsWith("/api/store/winget/")) {
    const { wingetApi } = await import("./winget");
    return wingetApi(request, root(), url.pathname.slice("/api/store/winget/".length).replace(/\/$/, ""));
  }
  if (request.method !== "GET" && request.method !== "HEAD")
    return problem(405, undefined, `${request.method} is not supported`, {
      headers: { ...headers, allow: "GET, HEAD" },
    });
  const rest = url.pathname.slice("/api/store/".length).replace(/\/$/, "");
  let file: string | undefined;
  if (rest === "catalog") file = "catalog.json";
  else if (rest === "qualification") file = "qualification.json";
  else if (rest.startsWith("index/") && FORMAT.test(rest.slice(6))) file = `${rest}.json`;
  if (!file) return problem(404, undefined, "No such store resource", { headers, instance: url.pathname });
  const body = Bun.file(join(root(), file));
  if (!(await body.exists())) return problem(404, undefined, "Not generated yet", { headers, instance: url.pathname });
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}
