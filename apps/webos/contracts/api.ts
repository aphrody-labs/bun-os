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

// Session gateway (services/wayland.ts, loopback 8793 behind nginx /api/wayland/; aliases /api/session/*). Auth: bearer
// token in Authorization or the WebSocket subprotocol "bearer.<token>". These types are the wire of that gateway.

/** One Hyprland toplevel (hyprctl clients -j subset). */
export interface SessionClient {
  address: string;
  class: string;
  title: string;
  pid?: number;
  at: [number, number];
  size: [number, number];
  workspace: { id: number };
}

export interface SessionStatus {
  version: string;
  monitors: unknown[];
  workspaces: unknown[];
  streams: number;
  /** Launcher id -> installed on the host. */
  launchers: Record<string, boolean>;
}

export interface SessionLaunchRequest {
  /** Launcher id (an AppManifest wayland.appId); argv is resolved by the gateway, never by the client. */
  app: string;
  args?: string[];
}
export type SessionLaunchResponse =
  | { address: string; class: string; pid?: number }
  | { error: "unknown-app" | "not-installed" | "no-window"; app?: string };

/** Client -> gateway messages on WS /api/wayland/stream?window=<address|root>&fps=<n> (server sends binary JPEG frames). */
export type SessionInput =
  | { t: "pointer"; x: number; y: number; mask: number }
  | { t: "key"; keysym: number; down: boolean }
  | { t: "clipboard"; text: string }
  | { t: "workspace"; id: number }
  | { t: "resize"; width: number; height: number };
/** Gateway -> client text messages on the stream socket. */
export type SessionEvent = { t: "clipboard"; text: string };

/** Routes of the contract; the value is the response type. Extend here before adding a handler. */
export interface ApiRoutes {
  "GET /api/health": HealthResponse;
  "GET /api/wayland/health": { ok: boolean; session: boolean };
  "GET /api/wayland/status": SessionStatus;
  "GET /api/wayland/clients": SessionClient[];
  "POST /api/wayland/launch": SessionLaunchResponse;
  "POST /api/wayland/focus": { out: string };
  "POST /api/wayland/close": { out: string };
  "POST /api/wayland/workspace": { out: string };
  "POST /api/wayland/resize": { out: string };
}

/** Typed client call: the path and method select the response type. */
export async function api<K extends keyof ApiRoutes>(
  route: K,
  init: { body?: unknown; token?: string; base?: string } = {},
): Promise<ApiRoutes[K]> {
  const [method, path] = route.split(" ") as [string, string];
  const response = await fetch((init.base ?? "") + path, {
    method,
    headers: {
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return (await response.json()) as ApiRoutes[K];
}
