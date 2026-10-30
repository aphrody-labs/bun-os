// SPDX-License-Identifier: MIT
import { authenticateRequest, jsonReply, validatePublicOrigin } from "./transport.ts";

export interface ProductCatalog {
  schemaVersion: 1;
  product: "Aphrody / Bun";
  version: string;
  observedAt: string;
  sourceRevision: string;
  sources: {
    id: string;
    path: string;
    repository: string;
    revision: string;
    license: string | null;
  }[];
  apps: {
    id: string;
    kind: string;
    hostname: string | null;
    qualification: Record<string, boolean>;
  }[];
}
export const apiOwners = {
  server: "@aphrody/bun-app-host",
  catalog: "@aphrody/bun-workspace",
  artifacts: "@aphrody/bun-artifacts",
  infrastructure: "Aphrody Infra",
  secrets: "Aphrody Infra protected stores",
} as const;

/** Read-only product API. The snapshot does not imply live native qualification. */
export function productHandler(
  catalog: ProductCatalog,
  token: string,
  options: { publicOrigin?: string } = {},
): (request: Request) => Response {
  if (token.length < 32) throw new Error("Inject the application token from its protected store.");
  const publicOrigin = validatePublicOrigin(options.publicOrigin);
  return request => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/healthz")
      return jsonReply({
        status: "ready",
        product: catalog.product,
        version: catalog.version,
      });
    const denied = authenticateRequest(request, token, { publicOrigin });
    if (denied) return denied;
    if (request.method !== "GET") return jsonReply({ error: "Method not allowed." }, 405);
    switch (path) {
      case "/api/v1/sources":
        return jsonReply({
          observedAt: catalog.observedAt,
          revision: catalog.sourceRevision,
          sources: catalog.sources,
        });
      case "/api/v1/apps":
        return jsonReply({
          observedAt: catalog.observedAt,
          apps: catalog.apps,
        });
      case "/api/v1/owners":
        return jsonReply(apiOwners);
      case "/api/v1/status":
        return jsonReply({
          product: catalog.product,
          version: catalog.version,
          process: "ready",
          catalog: {
            observedAt: catalog.observedAt,
            sourceRevision: catalog.sourceRevision,
            mode: "embedded-snapshot",
          },
          runtime: {
            version: Bun.version,
            revision: Bun.revision,
            platform: process.platform,
            arch: process.arch,
          },
          owners: apiOwners,
        });
      default:
        return jsonReply({ error: "Not found." }, 404);
    }
  };
}

export function startProduct(
  catalog: ProductCatalog,
  options: {
    port?: number;
    hostname?: string;
    token?: string;
    publicOrigin?: string;
  } = {},
) {
  const port = options.port ?? Number(Bun.env.PORT ?? 3000);
  const hostname = options.hostname ?? Bun.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid product port.");
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) throw new Error("Invalid product bind address.");
  const token = options.token ?? Bun.env.APHRODY_APP_TOKEN;
  if (!token) throw new Error("Inject the application token from its protected store.");
  return Bun.serve({
    port,
    hostname,
    maxRequestBodySize: 1048576,
    idleTimeout: 60,
    fetch: productHandler(catalog, token, {
      publicOrigin: options.publicOrigin ?? Bun.env.APHRODY_APP_ORIGIN,
    }),
  });
}
