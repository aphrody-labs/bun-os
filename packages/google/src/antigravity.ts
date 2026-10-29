// SPDX-License-Identifier: Apache-2.0
import { createClient, googleRuntime, type GoogleClientOptions, type GoogleRuntime } from "./client.ts";
import type { AntigravityCredentialProvider } from "./credentials.ts";

export interface AntigravityServicesOptions extends GoogleClientOptions {
  runtime?: GoogleRuntime;
  authMethod?: string;
  /** Injectable abortable backoff for deterministic local tests. */
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface AntigravityModel {
  name?: string;
  displayName?: string;
  description?: string;
  capabilities?: unknown;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function retryDelay(body: unknown): number | undefined {
  const error = (body as { error?: { details?: { "@type"?: string; retryDelay?: string }[]; message?: string } })
    ?.error;
  for (const detail of error?.details ?? []) {
    if (detail["@type"]?.endsWith("RetryInfo") && typeof detail.retryDelay === "string") {
      const value = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
      if (value) return Math.ceil(Number(value[1]));
    }
  }
  const value = /reset after (\d+)s/.exec(error?.message ?? "");
  return value ? Number(value[1]) : undefined;
}

async function json(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new Error("Google response is invalid JSON");
  }
}

function promptBody(prompt: string) {
  if (typeof prompt !== "string") throw new TypeError("Google prompt must be a string");
  return { contents: [{ role: "user", parts: [{ text: prompt }] }] };
}

function modelId(model: string): string {
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model))
    throw new TypeError("Google model must be a bare model ID");
  return model;
}

function modelInfo(value: unknown, fallbackName?: string): AntigravityModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Google model response is invalid");
  const info = value as Record<string, unknown>;
  const result: AntigravityModel = {};
  for (const field of ["name", "displayName", "description"] as const) {
    if (info[field] === undefined || info[field] === null) continue;
    if (typeof info[field] !== "string") throw new Error("Google model response is invalid");
    result[field] = info[field];
  }
  if (result.name === undefined && fallbackName !== undefined) result.name = fallbackName;
  if (info.capabilities !== undefined && info.capabilities !== null) result.capabilities = info.capabilities;
  return result;
}

/** Faithful Antigravity Cloud Code / regional Vertex contracts from the transferred Rust SDK. */
export function createAntigravityServices(options: AntigravityServicesOptions) {
  const runtime = options.runtime ?? googleRuntime();
  if (!/^[a-z][a-z0-9-]*$/.test(runtime.location)) throw new TypeError("Google location is invalid");
  const prod = options.baseURL ?? "https://cloudcode-pa.googleapis.com/";
  const daily = options.baseURL ?? "https://daily-cloudcode-pa.googleapis.com/";
  const vertex = options.baseURL ?? `https://${runtime.location}-aiplatform.googleapis.com/`;
  const transport = options.fetch ?? globalThis.fetch;

  async function request(
    baseURL: string | URL,
    path: string,
    body: unknown,
    signal?: AbortSignal,
    retry = false,
    stream = false,
    method: "GET" | "POST" = "POST",
  ): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      let delay: number | undefined;
      const client = createClient({
        baseURL,
        credentialProvider: options.credentialProvider,
        fetch: async (input, init) => {
          const authMethod =
            options.authMethod ??
            (options.credentialProvider as AntigravityCredentialProvider).authMethod ??
            "consumer";
          if (!/^[A-Za-z0-9_-]+$/.test(authMethod)) throw new Error("Google auth method is invalid");
          const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
          const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "x86" : process.arch;
          const headers = new Headers(init?.headers);
          headers.set(
            "user-agent",
            `antigravity/cli/1.1.27 (aidev_client; os_type=${os}; arch=${arch}; auth_method=${authMethod})`,
          );
          const response = await transport(input, { ...init, headers });
          status = response.status;
          if (retry && status === 429) {
            try {
              delay = retryDelay(await response.clone().json());
            } catch {
              /* Server errors remain redacted. */
            }
          }
          return response;
        },
      });
      try {
        return await client.request(path.startsWith("v1internal:") ? `./${path}` : path, {
          method,
          headers: {
            "content-type": "application/json",
            ...(stream ? { accept: "text/event-stream" } : {}),
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (!retry || status !== 429 || attempt >= 3) throw error;
        await (options.wait ?? wait)(Math.min((delay ?? 2 ** attempt) + 1, 65) * 1000, signal);
        signal?.throwIfAborted();
      }
    }
  }

  async function resolveProject(signal?: AbortSignal): Promise<string> {
    const result = await json(
      await request(prod, "v1internal:loadCodeAssist", { metadata: { ideType: "ANTIGRAVITY" } }, signal, true),
    );
    return typeof result?.cloudaicompanionProject === "string" ? result.cloudaicompanionProject : runtime.project;
  }

  return {
    async whoami(signal?: AbortSignal): Promise<{ name?: string; email?: string; picture?: string }> {
      const profile = await json(
        await request(
          options.baseURL ?? "https://www.googleapis.com/",
          "oauth2/v2/userinfo",
          undefined,
          signal,
          false,
          false,
          "GET",
        ),
      );
      return { name: profile.name, email: profile.email, picture: profile.picture };
    },
    async models(signal?: AbortSignal): Promise<AntigravityModel[]> {
      const result = await json(await request(prod, "v1internal:fetchAvailableModels", {}, signal, true));
      const values = result?.models;
      if (values === undefined) return [];
      if (Array.isArray(values)) return values.map(value => modelInfo(value));
      if (!values || typeof values !== "object") throw new Error("Google model response is invalid");
      return Object.keys(values)
        .sort()
        .map(name => modelInfo(values[name], name));
    },
    async generate(prompt: string, model = "gemini-2.5-flash", signal?: AbortSignal): Promise<unknown> {
      const path = `v1/projects/${encodeURIComponent(runtime.project)}/locations/${runtime.location}/publishers/google/models/${modelId(model)}:generateContent`;
      return json(await request(vertex, path, promptBody(prompt), signal));
    },
    stream(prompt: string, model = "gemini-2.5-flash", signal?: AbortSignal): ReadableStream<string> {
      const body = promptBody(prompt);
      modelId(model);
      const cancelled = new AbortController();
      const combined = signal ? AbortSignal.any([signal, cancelled.signal]) : cancelled.signal;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      let ended = false;

      function text(event: string): string | undefined {
        const payload = event
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trim())
          .join("\n");
        if (!payload || payload === "[DONE]") return;
        let result: any;
        try {
          result = JSON.parse(payload);
        } catch {
          throw new Error("Google stream contains invalid JSON");
        }
        const content = (result?.response ?? result)?.candidates?.[0]?.content;
        return (
          content?.parts
            ?.filter((part: { text?: unknown }) => typeof part.text === "string")
            .map((part: { text: string }) => part.text)
            .join("") || undefined
        );
      }

      return new ReadableStream<string>({
        async start() {
          const project = await resolveProject(combined);
          const response = await request(
            daily,
            "v1internal:streamGenerateContent?alt=sse",
            { model, project, request: body },
            combined,
            false,
            true,
          );
          if (!response.body) throw new Error("Google stream has no response body");
          if (combined.aborted) {
            await response.body.cancel();
            combined.throwIfAborted();
          }
          reader = response.body.getReader();
        },
        async pull(controller) {
          try {
            while (true) {
              combined.throwIfAborted();
              const boundary = /\r\n\r\n|\n\n/.exec(buffer);
              if (boundary || ended) {
                const event = boundary ? buffer.slice(0, boundary.index) : buffer;
                buffer = boundary ? buffer.slice(boundary.index + boundary[0].length) : "";
                const value = text(event);
                if (value !== undefined) {
                  controller.enqueue(value);
                  return;
                }
                if (ended && !buffer) {
                  reader?.releaseLock();
                  controller.close();
                  return;
                }
                continue;
              }
              const next = await reader!.read();
              if (next.done) {
                ended = true;
                buffer += decoder.decode();
              } else buffer += decoder.decode(next.value, { stream: true });
            }
          } catch {
            await reader?.cancel().catch(() => {});
            reader?.releaseLock();
            controller.error(combined.aborted ? combined.reason : new Error("Google stream decoding failed"));
          }
        },
        async cancel(reason) {
          cancelled.abort(reason);
          await reader?.cancel(reason);
          reader?.releaseLock();
        },
      });
    },
  };
}
