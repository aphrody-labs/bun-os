// SPDX-License-Identifier: Apache-2.0
// Aphrody Chat inference gateway: OpenAI-compatible /api/chat/v1/* (chat/completions with SSE, models) in front of
// Vertex AI Gemini (project aphrody, us-central1) through its OpenAI-compatible endpoint. Credentials are the ADC of
// the aphrody-bot service account (/etc/aphrody/google/adc.json, impersonated_service_account); tokens are minted
// here and never reach the client. Loopback only (127.0.0.1:8794) behind nginx /api/chat/.
// Abuse bounds: model allowlist, max_tokens cap, per-client request budget.

const PORT = Number(process.env.PORT ?? 8794);
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "aphrody";
const REGION = process.env.APHRODY_VERTEX_REGION ?? "us-central1";
const ADC = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "/etc/aphrody/google/adc.json";
const MODELS = (process.env.APHRODY_CHAT_MODELS ?? "google/gemini-2.5-flash,google/gemini-2.5-pro").split(",");
const MAX_TOKENS = Number(process.env.APHRODY_CHAT_MAX_TOKENS ?? 4096);
const BUDGET = Number(process.env.APHRODY_CHAT_BUDGET ?? 60); // requests per client per 10 minutes
const UPSTREAM = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/endpoints/openapi`;
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface Token {
  value: string;
  expires: number;
}
type Source =
  | { type: "service_account"; client_email: string; private_key: string; token_uri?: string }
  | { type: "authorized_user"; client_id: string; client_secret: string; refresh_token: string };
interface AdcFile {
  type: string;
  service_account_impersonation_url?: string;
  source_credentials?: Source;
}

const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer)).toString("base64url");

async function sourceToken(source: Source): Promise<Token> {
  let body: URLSearchParams;
  let uri = "https://oauth2.googleapis.com/token";
  if (source.type === "service_account") {
    uri = source.token_uri ?? uri;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: source.client_email, scope: SCOPE, aud: uri, iat: now, exp: now + 3600 }));
    const der = Buffer.from(source.private_key.replace(/-----[^-]+-----|\s/g, ""), "base64");
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
    body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` });
  } else {
    body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: source.client_id,
      client_secret: source.client_secret,
      refresh_token: source.refresh_token,
    });
  }
  const res = await fetch(uri, { method: "POST", body });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`source token: ${json.error_description ?? res.status}`);
  return { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

let cached: Token | undefined;
async function accessToken(): Promise<string> {
  if (cached && cached.expires - Date.now() > 120_000) return cached.value;
  const adc = (await Bun.file(ADC).json()) as AdcFile & Source;
  if (adc.type === "impersonated_service_account") {
    if (!adc.source_credentials || !adc.service_account_impersonation_url) throw new Error("ADC lacks impersonation data");
    const source = await sourceToken(adc.source_credentials);
    const res = await fetch(adc.service_account_impersonation_url, {
      method: "POST",
      headers: { authorization: `Bearer ${source.value}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [SCOPE], lifetime: "3600s" }),
    });
    const json = (await res.json()) as { accessToken?: string; expireTime?: string; error?: { message: string } };
    if (!res.ok || !json.accessToken) throw new Error(`impersonation: ${json.error?.message ?? res.status}`);
    cached = { value: json.accessToken, expires: Date.parse(json.expireTime ?? "") || Date.now() + 3_600_000 };
  } else {
    cached = await sourceToken(adc);
  }
  return cached.value;
}

const budgets = new Map<string, { start: number; n: number }>();
function allowed(client: string): boolean {
  const now = Date.now();
  const b = budgets.get(client);
  if (!b || now - b.start > 600_000) {
    budgets.set(client, { start: now, n: 1 });
    return true;
  }
  return ++b.n <= BUDGET;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const error = (message: string, status: number, type = "invalid_request_error") => json({ error: { message, type } }, status);

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 255,
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/api\/chat/, "");
    if (path === "/v1/models" && request.method === "GET")
      return json({ object: "list", data: MODELS.map((id) => ({ id, object: "model", owned_by: "google" })) });
    if (path === "/healthz") return json({ ok: true, project: PROJECT, region: REGION, models: MODELS });
    if (path !== "/v1/chat/completions") return error("Not found", 404);
    if (request.method !== "POST") return error("Method not allowed", 405);
    const client = request.headers.get("x-real-ip") ?? "local";
    if (!allowed(client)) return error("Request budget exhausted, try again in a few minutes", 429, "rate_limit_error");
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return error("Body must be JSON", 400);
    }
    if (!Array.isArray(body.messages) || !body.messages.length) return error("messages is required", 400);
    // The model id of the client ("local", a llama name, ...) maps to the default Gemini model.
    const model = MODELS.includes(String(body.model)) ? String(body.model) : MODELS[0];
    const forwarded = {
      model,
      messages: body.messages,
      stream: body.stream === true,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS),
    };
    let token: string;
    try {
      token = await accessToken();
    } catch (e) {
      console.error(e);
      return error("Inference credentials are unavailable", 503, "server_error");
    }
    const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(forwarded),
      signal: request.signal,
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`vertex ${upstream.status}: ${text.slice(0, 500)}`);
      return error(`Model backend answered ${upstream.status}`, upstream.status === 429 ? 429 : 502, "server_error");
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? (forwarded.stream ? "text/event-stream" : "application/json"),
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  },
});
console.log(`aphrody chat gateway on 127.0.0.1:${PORT} -> ${UPSTREAM} (${MODELS.join(", ")})`);
