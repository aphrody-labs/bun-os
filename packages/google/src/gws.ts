// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/google - Google Workspace CLI (`gws`) Native Core Integration for Bun OS.
 *
 * Provides:
 * 1. Runtime Google API Discovery (`discovery.googleapis.com`)
 * 2. Dynamic Command Executor (`gws <service> <resource> <method> [flags...]`)
 * 3. Structured JSON / Table Output Formatter
 * 4. Model Context Protocol (MCP) Server for Antigravity & LLM agents (`gws mcp`)
 * 5. Bun OS Token Broker & OAuth Integration
 */

export interface GwsOptions {
  service?: string;
  resource?: string;
  method?: string;
  params?: Record<string, string | number | boolean>;
  body?: unknown;
  format?: "json" | "yaml" | "table" | "raw";
  token?: () => Promise<string> | string;
  tokenBrokerUrl?: string;
}

export interface ApiDiscoveryDoc {
  id: string;
  name: string;
  version: string;
  title: string;
  description: string;
  rootUrl: string;
  servicePath: string;
  resources?: Record<string, ApiResource>;
}

export interface ApiResource {
  methods?: Record<string, ApiMethod>;
  resources?: Record<string, ApiResource>;
}

export interface ApiMethod {
  id: string;
  path: string;
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  description?: string;
  parameters?: Record<string, { type: string; required?: boolean; description?: string }>;
  request?: { $ref: string };
  response?: { $ref: string };
}

const DISCOVERY_CACHE = new Map<string, ApiDiscoveryDoc>();

/**
 * Fetch and cache the Google Discovery Document for a given Google Workspace API.
 * e.g., service: "drive", version: "v3"
 */
export async function getDiscoveryDoc(service: string, version?: string): Promise<ApiDiscoveryDoc> {
  const v = version ?? defaultVersion(service);
  const key = `${service}:${v}`;
  if (DISCOVERY_CACHE.has(key)) return DISCOVERY_CACHE.get(key)!;

  const url = `https://www.googleapis.com/discovery/v1/apis/${service}/${v}/rest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Discovery error for ${key}: ${res.status} ${res.statusText}`);

  const doc = (await res.json()) as ApiDiscoveryDoc;
  DISCOVERY_CACHE.set(key, doc);
  return doc;
}

function defaultVersion(service: string): string {
  switch (service.toLowerCase()) {
    case "drive":
      return "v3";
    case "docs":
    case "slides":
      return "v1";
    case "sheets":
      return "v4";
    case "gmail":
      return "v1";
    case "calendar":
      return "v3";
    case "chat":
      return "v1";
    case "admin":
      return "directory_v1";
    case "tasks":
      return "v1";
    case "people":
      return "v1";
    default:
      return "v1";
  }
}

/**
 * Resolve an authorization token using either a custom provider, the Bun OS backend
 * broker (`/api/google/token`), or environment credentials.
 */
export async function resolveAuthToken(options?: GwsOptions): Promise<string> {
  if (options?.token) return await options.token();

  // 1. Check Bun OS backend broker
  const brokerUrl = options?.tokenBrokerUrl ?? Bun.env.BUN_GOOGLE_TOKEN_BROKER ?? "http://127.0.0.1:8790/api/google/token";
  try {
    const res = await fetch(brokerUrl, {
      headers: {
        authorization: `Bearer ${Bun.env.APHRODY_ADMIN_TOKEN ?? ""}`,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { access_token?: string };
      if (data.access_token) return data.access_token;
    }
  } catch {
    // Broker not active or unauthorized; fall back
  }

  // 2. Check environment tokens
  const envToken = Bun.env.GOOGLE_OAUTH_TOKEN ?? Bun.env.GWS_TOKEN ?? Bun.env.GOOGLE_ACCESS_TOKEN;
  if (envToken) return envToken;

  throw new Error("No Google authorization token available. Authenticate via Bun OS token broker or set GOOGLE_OAUTH_TOKEN.");
}

/**
 * Execute a dynamic Google Workspace command.
 */
export async function executeGwsCommand(
  serviceName: string,
  resourceName: string,
  methodName: string,
  params: Record<string, any> = {},
  options: GwsOptions = {},
): Promise<unknown> {
  const doc = await getDiscoveryDoc(serviceName);
  const resource = doc.resources?.[resourceName];
  if (!resource) throw new Error(`Unknown resource '${resourceName}' on Google Workspace service '${serviceName}'`);

  const method = resource.methods?.[methodName];
  if (!method) throw new Error(`Unknown method '${methodName}' on '${serviceName}.${resourceName}'`);

  const token = await resolveAuthToken(options);

  // Substitute path parameters
  let path = method.path;
  const queryParams = new URLSearchParams();
  const bodyPayload: Record<string, any> = { ...options.body };

  for (const [k, v] of Object.entries(params)) {
    const placeholder = `{${k}}`;
    const placeholderPlus = `{+${k}}`;
    if (path.includes(placeholder)) {
      path = path.replaceAll(placeholder, encodeURIComponent(String(v)));
    } else if (path.includes(placeholderPlus)) {
      path = path.replaceAll(placeholderPlus, String(v));
    } else if (method.httpMethod === "GET" || method.httpMethod === "DELETE") {
      queryParams.set(k, String(v));
    } else {
      bodyPayload[k] = v;
    }
  }

  const base = doc.rootUrl.endsWith("/") ? doc.rootUrl : `${doc.rootUrl}/`;
  const fullUrl = new URL(`${doc.servicePath}${path}`, base);
  for (const [qk, qv] of queryParams) {
    fullUrl.searchParams.set(qk, qv);
  }

  const reqInit: RequestInit = {
    method: method.httpMethod,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  };

  if (method.httpMethod !== "GET" && method.httpMethod !== "DELETE" && Object.keys(bodyPayload).length > 0) {
    reqInit.body = JSON.stringify(bodyPayload);
    (reqInit.headers as Record<string, string>)["content-type"] = "application/json";
  }

  const res = await fetch(fullUrl, reqInit);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Workspace API error (${res.status} ${res.statusText}): ${errorText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }
  return await res.text();
}

/**
 * Start a native Model Context Protocol (MCP) server for Google Workspace over Stdio.
 * Exposes Drive, Docs, Sheets, Slides, Gmail, and Calendar tools directly to AI agents.
 */
export async function startGwsMcpServer(): Promise<void> {
  const tools = [
    {
      name: "gws_drive_list",
      description: "List or search files in Google Drive",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Drive search query (e.g. name contains 'notes')" },
          pageSize: { type: "number", description: "Max results to return (default 20)" },
        },
      },
    },
    {
      name: "gws_docs_get",
      description: "Read a Google Docs document structure and text",
      inputSchema: {
        type: "object",
        properties: {
          documentId: { type: "string", description: "Google Docs Document ID" },
        },
        required: ["documentId"],
      },
    },
    {
      name: "gws_sheets_get_values",
      description: "Read cell values from a Google Sheets spreadsheet",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string", description: "Google Sheets ID" },
          range: { type: "string", description: "A1 notation range (e.g. Sheet1!A1:D10)" },
        },
        required: ["spreadsheetId", "range"],
      },
    },
    {
      name: "gws_api_execute",
      description: "Execute any dynamic Google Workspace API call via gws discovery",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service name (drive, docs, sheets, slides, gmail, calendar)" },
          resource: { type: "string", description: "Resource name (e.g. files, documents, messages)" },
          method: { type: "string", description: "Method name (e.g. list, get, create, export)" },
          params: { type: "object", description: "Query and path parameters" },
        },
        required: ["service", "resource", "method"],
      },
    },
  ];

  // Process standard JSON-RPC input over stdin
  for await (const line of console) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.method === "tools/list") {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }));
      } else if (msg.method === "tools/call") {
        const { name, arguments: args } = msg.params;
        let result: unknown;
        if (name === "gws_drive_list") {
          result = await executeGwsCommand("drive", "files", "list", args);
        } else if (name === "gws_docs_get") {
          result = await executeGwsCommand("docs", "documents", "get", args);
        } else if (name === "gws_sheets_get_values") {
          result = await executeGwsCommand("sheets", "spreadsheets.values", "get", args);
        } else if (name === "gws_api_execute") {
          result = await executeGwsCommand(args.service, args.resource, args.method, args.params ?? {});
        } else {
          throw new Error(`Tool not found: ${name}`);
        }
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        }));
      } else if (msg.method === "initialize") {
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "bun-os-gws-mcp", version: "1.4.7" },
            capabilities: { tools: {} },
          },
        }));
      }
    } catch (err: any) {
      console.error("GWS MCP Error:", err.message);
    }
  }
}
