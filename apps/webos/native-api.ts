// SPDX-License-Identifier: Apache-2.0
// Reuse the public source API with native PostgreSQL; credentials stay on the VPS.
import { publicSiteAPI } from "./site/site-api";
import {
  PUBLIC_BUN_TOOLS,
  publicBunToolRequest,
} from "./site/public-tools";

let database: Bun.SQL | undefined;
async function siteRead(request: Request) {
  if (!database) {
    const path = Bun.env.WEBOS_DATABASE_URL_FILE;
    if (!path)
      return Response.json(
        { error: "Public site database unavailable" },
        { status: 503 },
      );
    const url = (await Bun.file(path).text()).trim();
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
      throw new Error("Production source database must be local to the VPS");
    database = new Bun.SQL(url, {
      max: 4,
      idleTimeout: 30,
      connectionTimeout: 5,
    });
  }
  return publicSiteAPI(request, {
    async query<T extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ): Promise<T[]> {
      return (await database!.unsafe(text, [...parameters])) as T[];
    },
  });
}

export async function nativeAPI(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/site/")) return siteRead(request);
  if (url.pathname === "/v1/models")
    return Response.json({ object: "list", data: [] });
  if (url.pathname === "/mcp") {
    if (request.method !== "POST")
      return Response.json(
        { error: { code: "method_not_allowed" } },
        { status: 405 },
      );
    const origin = request.headers.get("origin");
    if (
      origin &&
      !["https://aphrody.com", "https://aphrody.app"].includes(origin)
    )
      return Response.json(
        { error: { code: "invalid_origin" } },
        { status: 403 },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return new Response("Expected JSON", { status: 415 });
    let body: {
      id?: string | number;
      jsonrpc?: string;
      method?: string;
      params?: { name?: string; arguments?: unknown };
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string")
      return Response.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    if (body.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize")
      return reply({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "aphrody-bun", version: "1.4.4" },
      });
    if (body.method === "ping") return reply({});
    if (body.method === "tools/list")
      return reply({
        tools: PUBLIC_BUN_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: "object",
            properties: tool.properties,
            required: tool.required,
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        })),
      });
    if (body.method === "tools/call") {
      let query: Request;
      try {
        query = publicBunToolRequest(
          String(body.params?.name),
          body.params?.arguments ?? {},
          "https://aphrody.com",
        );
      } catch {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "Invalid public tool request" },
        });
      }
      const response = await siteRead(query);
      return reply({
        content: [{ type: "text", text: await response.text() }],
        isError: !response.ok,
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Method not found" },
    });
  }
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/yolo/"))
    return Response.json(
      {
        error: {
          code: "native_origin_unqualified",
          message: "The Bun decision origin is not qualified",
        },
      },
      { status: 503 },
    );
  return new Response("Not found", { status: 404 });
}
