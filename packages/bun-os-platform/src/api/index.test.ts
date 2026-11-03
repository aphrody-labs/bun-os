// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { apiContract, checkDocument, defineApi, matchRoute, problem } from "./index.ts";

const api = defineApi(
  { service: "demo", title: "Demo", version: "1.0.0", commit: "abc" },
  {
    "GET /items/{id}": {
      summary: "Item",
      auth: true,
      responses: { 200: { description: "Item" }, 404: { description: "Missing" } },
    },
    "GET /files/{path*}": {
      summary: "File",
      responses: { 200: { description: "Bytes", type: "application/octet-stream" } },
    },
  },
);

describe("api contract", () => {
  test("the document follows the standard", () => {
    expect(checkDocument(api.document, "demo")).toEqual([]);
    const paths = api.document.paths as Record<string, any>;
    expect(paths["/items/{id}"].get.operationId).toBe("getItemsById");
    expect(paths["/items/{id}"].get.responses["404"].content["application/problem+json"]).toBeDefined();
    expect(paths["/files/{path}"].get.parameters[0]).toMatchObject({ name: "path", in: "path", required: true });
    expect(checkDocument({ ...api.document, openapi: "3.0.3" }, "demo")[0]).toContain("3.1");
  });

  test("standard endpoints under the base, other paths fall through", async () => {
    const contract = apiContract(api, { base: "/api", checks: () => ({ db: { ok: false, optional: true } }) });
    const health = (await contract(new Request("http://x/api/health")))!;
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "degraded", service: "demo", commit: "abc" });
    expect((await (await contract(new Request("http://x/api/openapi.json")))!.json()).openapi).toBe("3.1.0");
    expect(await contract(new Request("http://x/api/items/1"))).toBeUndefined();
    expect(await contract(new Request("http://x/health"))).toBeUndefined();
  });

  test("problem+json and route matching", async () => {
    const r = problem(404, undefined, "gone", { instance: "/x" });
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect(await r.json()).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "gone",
      instance: "/x",
    });
    expect(matchRoute(api.routes, "HEAD", "/files/a/b.txt")).toEqual({
      key: "GET /files/{path*}",
      params: { path: "a/b.txt" },
    });
    expect(matchRoute(api.routes, "POST", "/items/1")).toBeUndefined();
  });
});
