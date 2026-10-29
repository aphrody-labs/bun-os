// SPDX-License-Identifier: Apache-2.0
import type { ChatMessage, GenerateStats } from "./engine";
import type { GemmaBackend } from "./worker-client";

export const GEMMA_WEB_MODEL_ID = "gemma-4-e2b-it-web";

export interface ChatCompletionRequest {
  model?: string;
  messages: { role: string; content: string | { type: string; text?: string }[] }[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  seed?: number;
  stop?: string | string[];
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: { index: 0; delta: { role?: "assistant"; content?: string }; finish_reason: string | null }[];
  usage?: Usage;
}
export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: { index: 0; message: { role: "assistant"; content: string }; finish_reason: string }[];
  usage: Usage;
}
interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function flatten(m: ChatCompletionRequest["messages"][number]): ChatMessage {
  const role = m.role === "assistant" || m.role === "system" ? m.role : "user";
  const content = typeof m.content === "string" ? m.content : m.content.map(p => p.text ?? "").join("");
  return { role, content };
}
const finishOf = (s: GenerateStats) => (s.finishReason === "abort" ? "stop" : s.finishReason);
const usageOf = (s: GenerateStats): Usage => ({
  prompt_tokens: s.promptTokens,
  completion_tokens: s.completionTokens,
  total_tokens: s.promptTokens + s.completionTokens,
});

/** OpenAI Chat Completions on top of a Gemma backend: `create`, SSE `fetch` and `/v1/models`. */
export class GemmaOpenAI {
  readonly model: string;
  constructor(
    private readonly backend: GemmaBackend,
    model: string = GEMMA_WEB_MODEL_ID,
  ) {
    this.model = model;
  }

  readonly chat = {
    completions: {
      create: ((req: ChatCompletionRequest & { signal?: AbortSignal }) => {
        return req.stream ? this.#stream(req) : this.#complete(req);
      }) as {
        (req: ChatCompletionRequest & { stream: true; signal?: AbortSignal }): AsyncGenerator<ChatCompletionChunk>;
        (req: ChatCompletionRequest & { stream?: false; signal?: AbortSignal }): Promise<ChatCompletion>;
      },
    },
  };

  #opts(req: ChatCompletionRequest & { signal?: AbortSignal }) {
    const stop = typeof req.stop === "string" ? [req.stop] : req.stop;
    return {
      messages: req.messages.map(flatten),
      maxTokens: req.max_completion_tokens ?? req.max_tokens ?? 256,
      temperature: req.temperature,
      topP: req.top_p,
      topK: req.top_k,
      seed: req.seed,
      stop,
      signal: req.signal,
    };
  }

  async #complete(req: ChatCompletionRequest & { signal?: AbortSignal }): Promise<ChatCompletion> {
    const it = this.backend.generate(this.#opts(req));
    let text = "";
    for (;;) {
      const r = await it.next();
      if (r.done)
        return {
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: this.model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finishOf(r.value) }],
          usage: usageOf(r.value),
        };
      text += r.value;
    }
  }

  async *#stream(req: ChatCompletionRequest & { signal?: AbortSignal }): AsyncGenerator<ChatCompletionChunk> {
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: "chat.completion.chunk" as const, created, model: this.model };
    yield { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] };
    const it = this.backend.generate(this.#opts(req));
    for (;;) {
      const r = await it.next();
      if (r.done) {
        yield {
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: finishOf(r.value) }],
          usage: usageOf(r.value),
        };
        return;
      }
      yield { ...base, choices: [{ index: 0, delta: { content: r.value }, finish_reason: null }] };
    }
  }

  /**
   * A `fetch` replacement for OpenAI-compatible clients: pass it as `fetch` (or serve it from a
   * Service Worker) and POST /v1/chat/completions is answered in-page, as JSON or `text/event-stream`.
   */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path.endsWith("/models"))
      return Response.json({ object: "list", data: [{ id: this.model, object: "model", owned_by: "google" }] });
    if (req.method !== "POST" || !path.endsWith("/chat/completions"))
      return Response.json({ error: { message: `unsupported ${req.method} ${path}` } }, { status: 404 });
    const body = (await req.json()) as ChatCompletionRequest;
    const signal = req.signal;
    if (!body.stream) return Response.json(await this.#complete({ ...body, signal }));
    const enc = new TextEncoder();
    const gen = this.#stream({ ...body, signal });
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        const r = await gen.next();
        if (r.done) {
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctl.close();
        } else ctl.enqueue(enc.encode(`data: ${JSON.stringify(r.value)}\n\n`));
      },
      async cancel() {
        await gen.return(undefined);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  };
}
