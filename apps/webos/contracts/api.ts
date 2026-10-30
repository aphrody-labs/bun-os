// SPDX-License-Identifier: Apache-2.0
// Typed HTTP contract of the WebOS Bun service (ADR-002). Client, service and native consumers import these
// types; handlers return them and callers parse into them, so a route has one definition.

export interface HealthCheck {
  ok: boolean;
  detail?: string;
}

/** GET /api/health: 200 when every check is ok, 503 otherwise. The deploy gate and the activator probe this. */
export interface HealthResponse {
  ok: boolean;
  service: "aphrody-webos";
  sourceCommit: string | null;
  uptimeSeconds: number;
  time: string;
  inventory: { total: number; counts: Record<string, number> } | null;
  checks: Record<"assets" | "objects" | "inventory", HealthCheck>;
}

/** One JSON line per request on stdout (journald): the structured log record. */
export interface RequestLog {
  ts: string;
  id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** Routes of the contract; the value is the response type. Extend here before adding a handler. */
export interface ApiRoutes {
  "GET /api/health": HealthResponse;
}
