// SPDX-License-Identifier: Apache-2.0
/**
 * Transport of the Aphrody agent service (`crates/aphrody-app-server`): JSON-RPC on /rpc, event
 * streams on /events and /notifications. That service is a private native process
 * (infra/config/application-contracts.json: aphrody.ai.publicProduct false, sessionOwner
 * aphrody-app-server): it runs commands and holds provider sessions on the user's own machine, so no
 * public edge host serves it. This Worker answers the transport itself, in the protocol the Workspace
 * speaks, so every window reports why instead of failing a request.
 */
export const APP_SERVER_PATHS = new Set(["/rpc", "/events", "/notifications"]);

export const APP_SERVER_REASON =
  "Conversations, models and agent tools run in the native Aphrody agent service (aphrody app-server) on your own machine, in the Aphrody desktop app. aphrody.com does not host that service.";

/** JSON-RPC 2.0 "method not found": this host implements none of the agent service's methods. */
const METHOD_NOT_FOUND = -32601;
const MAX_REQUEST_BYTES = 64 * 1024;

export async function appServerResponse(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (new URL(request.url).pathname !== "/rpc")
    return Response.json(
      { error: APP_SERVER_REASON },
      { status: 503, headers },
    );
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, allow: "POST" },
    });
  let id: string | number | null = null;
  let method: string | undefined;
  const text = await request.text();
  if (text.length <= MAX_REQUEST_BYTES) {
    try {
      const body = JSON.parse(text) as { id?: unknown; method?: unknown };
      if (typeof body.id === "string" || typeof body.id === "number")
        id = body.id;
      if (typeof body.method === "string") method = body.method;
    } catch {
      // Unparseable request: answered with a null id, as JSON-RPC prescribes.
    }
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: METHOD_NOT_FOUND,
        message: APP_SERVER_REASON,
        data: { service: "aphrody-app-server", ...(method ? { method } : {}) },
      },
    },
    { headers },
  );
}
