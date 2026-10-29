// SPDX-License-Identifier: Apache-2.0 OR MIT
// Webview side of the `aphrody` plugin: the Bun server started by the app (see `plugins > aphrody > bun`).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BunInfo {
  running: boolean;
  pid: number | null;
  port: number | null;
  url: string | null;
  command: string[];
}

export interface BunRequestInit {
  method?: string;
  headers?: Record<string, string> | [string, string][];
  body?: string;
}

export interface BunResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface BunLogLine {
  stream: "stdout" | "stderr";
  line: string;
}

/** State of the Bun server: pid, loopback port and URL. */
export function bunInfo(): Promise<BunInfo> {
  return invoke("plugin:aphrody|bun_info");
}

/** Restarts the Bun server (needs `aphrody:allow-bun-restart`). */
export function bunRestart(): Promise<BunInfo> {
  return invoke("plugin:aphrody|bun_restart");
}

/** Sends an HTTP request to the Bun server over IPC: no CORS, no CSP entry for its port. */
export function bunRequest(path: string, init: BunRequestInit = {}): Promise<BunResponse> {
  const headers = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers ?? {});
  return invoke("plugin:aphrody|bun_request", {
    request: { method: init.method ?? "GET", path, headers, body: init.body ?? null },
  });
}

/** `fetch`-like wrapper of {@link bunRequest} returning a standard `Response`. */
export async function bunFetch(path: string, init: BunRequestInit = {}): Promise<Response> {
  const r = await bunRequest(path, init);
  const nullBody = r.status === 204 || r.status === 304 || (r.status >= 100 && r.status < 200);
  return new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers });
}

/** Output lines of the Bun server. */
export function onBunLog(handler: (line: BunLogLine) => void): Promise<UnlistenFn> {
  return listen<BunLogLine>("aphrody://bun-log", e => handler(e.payload));
}
