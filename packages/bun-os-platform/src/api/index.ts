// SPDX-License-Identifier: Apache-2.0
/**
 * The Bun OS HTTP API contract for Bun services (docs/ops/API.md): one typed route table per service is the single
 * source of its OpenAPI 3.1 document, and `apiContract()` answers the standard endpoints every service exposes:
 *
 *   GET <base>/openapi.json   OpenAPI 3.1 document generated from the route table
 *   GET <base>/health         { status, service, version, commit, channel, uptimeSeconds, checks? }
 *   GET <base>/ready          same shape, 503 until every required dependency answers (only with `ready`)
 *
 * Errors are `application/problem+json` (RFC 9457) through `problem()`. Paths in the table are relative to the
 * public base `https://api.aphrody.com/v1/<service>`; `base` is where the service itself mounts them.
 *
 *   const api = defineApi({ service: "store", title: "Bun OS Store", version }, {
 *     "GET /catalog": { summary: "Store catalog", tags: ["catalog"] },
 *   });
 *   const contract = apiContract(api, { base: "/api/store" });
 *   Bun.serve({ fetch: async req => (await contract(req)) ?? handle(req) });
 */

export type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Schema = Record<string, unknown>;

export interface Param {
  name: string;
  in: "path" | "query" | "header";
  description?: string;
  required?: boolean;
  schema?: Schema;
}

export interface Content {
  description: string;
  /** Media type; `application/json` by default. */
  type?: string;
  schema?: Schema;
}

export interface Operation {
  summary: string;
  description?: string;
  tags?: string[];
  /** Requires the bearer token of the account service (or the service's own scoped token). */
  auth?: boolean;
  /** Parameters; path parameters are derived from `{name}` segments unless declared here. */
  params?: Param[];
  body?: Content & { required?: boolean };
  /** Success and documented error responses; `200: application/json` when omitted. */
  responses?: Record<number, Content>;
  /** Long-lived responses: Server-Sent Events or a WebSocket upgrade. */
  stream?: "sse" | "websocket";
  deprecated?: boolean;
  /**
   * Protocol-compatible surfaces (OpenAI, A2A JSON-RPC, MCP) keep their protocol's error body instead of
   * problem+json; the exception is recorded as `x-error-format`.
   */
  errorFormat?: "openai" | "jsonrpc" | "mcp" | "winget" | "text";
  /** Stable id; derived from the method and path when omitted. */
  operationId?: string;
}

export interface ServiceInfo {
  /** Gateway name: the `<service>` of `/v1/<service>/` in infra/fleet/api.toml. */
  service: string;
  title: string;
  version: string;
  description?: string;
  /** Source commit of the running release; defaults to APHRODY_COMMIT (set by the release bundle). */
  commit?: string | null;
  /** Release channel (stable, canary, ...); defaults to APHRODY_CHANNEL. */
  channel?: string | null;
}

export type Routes = Record<string, Operation>;

export interface Api {
  info: ServiceInfo;
  routes: Routes;
  /** The OpenAPI 3.1 document, built once. */
  document: Record<string, unknown>;
}

export interface Check {
  ok: boolean;
  /** An optional check that fails degrades the service instead of taking it down. */
  optional?: boolean;
  detail?: string;
}

export const API_ORIGIN = "https://api.aphrody.com";
const startedAt = Date.now();

const PROBLEM_SCHEMA: Schema = {
  type: "object",
  description: "RFC 9457 problem details",
  required: ["type", "title", "status"],
  properties: {
    type: { type: "string", format: "uri-reference", default: "about:blank" },
    title: { type: "string" },
    status: { type: "integer", minimum: 100, maximum: 599 },
    detail: { type: "string" },
    instance: { type: "string", format: "uri-reference" },
  },
};

const CHECK_SCHEMA: Schema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" }, optional: { type: "boolean" }, detail: { type: "string" } },
};

const HEALTH_SCHEMA: Schema = {
  type: "object",
  required: ["status", "service", "version"],
  properties: {
    status: { type: "string", enum: ["ok", "degraded", "down"] },
    service: { type: "string" },
    version: { type: "string" },
    commit: { type: ["string", "null"] },
    channel: { type: ["string", "null"] },
    uptimeSeconds: { type: "integer", minimum: 0 },
    checks: { type: "object", additionalProperties: { $ref: "#/components/schemas/Check" } },
  },
};

const problemContent = { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } };

function operationId(method: string, path: string): string {
  const words = path
    .split("/")
    .filter(Boolean)
    .map(part => part.replace(/^\{(.+?)\*?\}$/, "by-$1"))
    .join("-")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return [method.toLowerCase(), ...words.map(w => w[0]!.toUpperCase() + w.slice(1))].join("") || method.toLowerCase();
}

function standardRoutes(ready: boolean): Routes {
  const health: Content = {
    description: "Service health",
    type: "application/json",
    schema: { $ref: "#/components/schemas/Health" },
  };
  const routes: Routes = {
    "GET /health": {
      summary: "Health",
      description: "Liveness and version of the running release; 503 when a required check fails.",
      tags: ["contract"],
      responses: { 200: health, 503: health },
      operationId: "getHealth",
    },
    "GET /openapi.json": {
      summary: "OpenAPI document",
      description: "This document (OpenAPI 3.1).",
      tags: ["contract"],
      responses: { 200: { description: "OpenAPI 3.1 document", schema: { type: "object" } } },
      operationId: "getOpenapi",
    },
  };
  if (ready)
    routes["GET /ready"] = {
      summary: "Readiness",
      description: "503 until every required dependency answers.",
      tags: ["contract"],
      responses: { 200: health, 503: health },
      operationId: "getReady",
    };
  return routes;
}

/** Build the OpenAPI 3.1 document of a route table. */
export function openapiDocument(info: ServiceInfo, routes: Routes, options: { ready?: boolean } = {}) {
  const all = { ...standardRoutes(!!options.ready), ...routes };
  const paths: Record<string, Record<string, unknown>> = {};
  let secured = false;
  for (const [key, op] of Object.entries(all)) {
    const [method, rawPath] = key.split(/\s+/, 2) as [string, string];
    if (!rawPath?.startsWith("/")) throw new Error(`api: route key must be "<METHOD> /path", got ${key}`);
    const path = rawPath.replace(/\{([^}]+?)\*\}/g, "{$1}");
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
      name: m[1]!,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const declared = (op.params ?? []).map(p => ({
      ...p,
      ...(p.in === "path" ? { required: true } : {}),
      schema: p.schema ?? { type: "string" },
    }));
    const params = [...pathParams.filter(p => !declared.some(d => d.in === "path" && d.name === p.name)), ...declared];
    const responses: Record<string, unknown> = {};
    for (const [status, content] of Object.entries(op.responses ?? { 200: { description: "OK" } })) {
      const type =
        content.type ??
        (op.stream === "sse" && Number(status) < 300
          ? "text/event-stream"
          : Number(status) >= 400
            ? ""
            : "application/json");
      responses[status] = {
        description: content.description,
        ...(type ? { content: { [type]: { schema: content.schema ?? {} } } } : { content: problemContent }),
      };
    }
    if (op.stream === "websocket" && !responses["101"]) responses["101"] = { description: "WebSocket upgrade" };
    if (op.auth && !responses["401"]) responses["401"] = { $ref: "#/components/responses/Unauthorized" };
    responses.default ??= { $ref: "#/components/responses/Problem" };
    if (op.auth) secured = true;
    (paths[path] ??= {})[method.toLowerCase()] = {
      operationId: op.operationId ?? operationId(method, path),
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      tags: op.tags ?? [info.service],
      ...(params.length ? { parameters: params } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: op.body.required ?? true,
              description: op.body.description,
              content: { [op.body.type ?? "application/json"]: { schema: op.body.schema ?? {} } },
            },
          }
        : {}),
      responses,
      ...(op.auth ? { security: [{ bearer: [] }] } : {}),
      ...(op.deprecated ? { deprecated: true } : {}),
      ...(op.stream ? { "x-stream": op.stream } : {}),
      ...(op.errorFormat ? { "x-error-format": op.errorFormat } : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: info.title,
      version: info.version,
      ...(info.description ? { description: info.description } : {}),
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: `${API_ORIGIN}/v1/${info.service}`, description: "Bun OS API gateway" }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      schemas: { Problem: PROBLEM_SCHEMA, Health: HEALTH_SCHEMA, Check: CHECK_SCHEMA },
      responses: {
        Problem: { description: "Error", content: problemContent },
        Unauthorized: { description: "Missing or invalid bearer token", content: problemContent },
      },
      ...(secured ? { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } } : {}),
    },
    "x-service": info.service,
  };
}

/** Declare a service: its identity and route table, and the document generated from them. */
export function defineApi(info: ServiceInfo, routes: Routes, options: { ready?: boolean } = {}): Api {
  const resolved: ServiceInfo = {
    ...info,
    commit: info.commit ?? process.env.APHRODY_COMMIT ?? null,
    channel: info.channel ?? process.env.APHRODY_CHANNEL ?? null,
  };
  return { info: resolved, routes, document: openapiDocument(resolved, routes, options) };
}

/** An RFC 9457 problem response. */
export function problem(
  status: number,
  title?: string,
  detail?: string,
  init: { type?: string; instance?: string; headers?: HeadersInit; extra?: Record<string, unknown> } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/problem+json");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(
    JSON.stringify({
      type: init.type ?? "about:blank",
      title: title ?? STATUS_TITLES[status] ?? "Error",
      status,
      ...(detail ? { detail } : {}),
      ...(init.instance ? { instance: init.instance } : {}),
      ...init.extra,
    }),
    { status, headers },
  );
}

const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** The standard health body; extra fields are additive. */
export function healthBody(info: ServiceInfo, checks?: Record<string, Check>, extra: Record<string, unknown> = {}) {
  const failed = Object.values(checks ?? {}).filter(c => !c.ok);
  const status = failed.some(c => !c.optional) ? "down" : failed.length ? "degraded" : "ok";
  return {
    status,
    service: info.service,
    version: info.version,
    commit: info.commit ?? process.env.APHRODY_COMMIT ?? null,
    channel: info.channel ?? process.env.APHRODY_CHANNEL ?? null,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    ...(checks ? { checks } : {}),
    ...extra,
  } as const;
}

export function healthResponse(
  info: ServiceInfo,
  checks?: Record<string, Check>,
  extra?: Record<string, unknown>,
  head = false,
): Response {
  const body = healthBody(info, checks, extra);
  return new Response(head ? null : JSON.stringify(body), {
    status: body.status === "down" ? 503 : 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export interface ContractOptions {
  /** Where the service mounts its public paths, e.g. `/api/store`; empty for the root. Several mounts allowed. */
  base?: string | string[];
  /** Dependency checks reported by /health. */
  checks?: () => Record<string, Check> | Promise<Record<string, Check>>;
  /** Readiness checks; enables /ready. */
  ready?: () => Record<string, Check> | Promise<Record<string, Check>>;
  /** Extra fields of the health body (kept for existing consumers). */
  extra?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Answer the standard endpoints (`/openapi.json`, `/health`, `/ready`) under `base`; `undefined` for any other
 * request so the caller's own routing continues.
 */
export function apiContract(api: Api, options: ContractOptions = {}) {
  const bases = [options.base ?? ""].flat().map(b => b.replace(/\/+$/, ""));
  const document = JSON.stringify(api.document);
  return async (request: Request): Promise<Response | undefined> => {
    if (request.method !== "GET" && request.method !== "HEAD") return;
    const path = new URL(request.url).pathname;
    const base = bases.find(b => !b || path.startsWith(`${b}/`));
    if (base === undefined) return;
    const rest = path.slice(base.length);
    const head = request.method === "HEAD";
    if (rest === "/openapi.json")
      return new Response(head ? null : document, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
          "x-content-type-options": "nosniff",
        },
      });
    if (rest === "/health") return healthResponse(api.info, await options.checks?.(), await options.extra?.(), head);
    if (rest === "/ready" && options.ready) return healthResponse(api.info, await options.ready(), undefined, head);
  };
}

/** Match `method path` against the route table; returns the route key and its path parameters. */
export function matchRoute(
  routes: Routes,
  method: string,
  path: string,
): { key: string; params: Record<string, string> } | undefined {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(/\s+/, 2) as [string, string];
    if (m !== method && !(m === "GET" && method === "HEAD")) continue;
    const names: string[] = [];
    const source = pattern
      .split(/(\{[^}]+\})/)
      .map(part => {
        const p = /^\{([^}]+?)(\*)?\}$/.exec(part);
        if (!p) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(p[1]!);
        return p[2] ? "(.+)" : "([^/]+)";
      })
      .join("");
    const found = new RegExp(`^${source}$`).exec(path);
    if (found)
      return {
        key,
        params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(found[i + 1]!)])),
      };
  }
}

/** Violations of the standard in an OpenAPI document (empty when it conforms). */
export function checkDocument(doc: unknown, service?: string): string[] {
  const out: string[] = [];
  const d = doc as Record<string, any>;
  if (!d || typeof d !== "object") return ["not a JSON object"];
  if (typeof d.openapi !== "string" || !d.openapi.startsWith("3.1."))
    out.push(`openapi must be 3.1.x, got ${d.openapi}`);
  if (!d.info?.title) out.push("info.title missing");
  if (!d.info?.version) out.push("info.version missing");
  const server = d.servers?.[0]?.url as string | undefined;
  const expected = service ? `${API_ORIGIN}/v1/${service}` : undefined;
  if (!server) out.push("servers[0].url missing");
  else if (expected && server !== expected) out.push(`servers[0].url must be ${expected}, got ${server}`);
  else if (!/\/v\d+\/[a-z0-9-]+$/.test(server)) out.push(`servers[0].url must be a versioned base path, got ${server}`);
  const paths = (d.paths ?? {}) as Record<string, Record<string, any>>;
  if (!paths["/health"]?.get) out.push("GET /health missing");
  if (!paths["/openapi.json"]?.get) out.push("GET /openapi.json missing");
  const health = paths["/health"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
  if (paths["/health"]?.get && health !== "#/components/schemas/Health")
    out.push("GET /health must answer the standard Health schema");
  if (!d.components?.schemas?.Problem) out.push("components.schemas.Problem missing");
  const ids = new Set<string>();
  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith("/")) out.push(`path ${path} must start with /`);
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(method)) continue;
      const where = `${method.toUpperCase()} ${path}`;
      if (!op.operationId) out.push(`${where}: operationId missing`);
      else if (ids.has(op.operationId)) out.push(`${where}: duplicate operationId ${op.operationId}`);
      else ids.add(op.operationId);
      if (!op.summary) out.push(`${where}: summary missing`);
      if (!op.responses || !Object.keys(op.responses).length) out.push(`${where}: responses missing`);
      for (const [status, r] of Object.entries(op.responses ?? {}) as [string, any][]) {
        if ((Number(status) < 400 && status !== "default") || path === "/health" || path === "/ready") continue;
        const content = r.$ref ? null : r.content;
        if (content && !content["application/problem+json"] && !op["x-error-format"])
          out.push(`${where}: ${status} must be application/problem+json (or declare x-error-format)`);
      }
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]))
        if (!op.parameters?.some((p: any) => p.in === "path" && p.name === name))
          out.push(`${where}: path parameter ${name} undeclared`);
    }
  }
  return out;
}
