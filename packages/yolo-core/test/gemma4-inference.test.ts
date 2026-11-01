// SPDX-License-Identifier: Apache-2.0
/** Local HTTP fixtures qualify transport, never model weights or inference quality. */
import { afterEach, describe, expect, it } from "bun:test";
import { InferenceError, UnifiedInferenceEngine } from "../src/gemma4/index";

const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function listen(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return new URL("v1", server.url).href;
}
const json = (content: unknown, status = 200) => Response.json(content, { status });
const reply = (content = "real provider fixture") => ({
  model: "provider-revision",
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
});
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const terminal = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const sse = (body: BodyInit) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
async function collect(iterator: AsyncIterable<string>) {
  let text = "";
  for await (const chunk of iterator) text += chunk;
  return text;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Real configured inference HTTP transport", () => {
  for (const backend of ["local", "jan", "openai"] as const) {
    it(`sends ${backend} messages to the actual configured provider without simulation`, async () => {
      const requests: Record<string, unknown>[] = [];
      const endpointUrl = listen(async request => {
        expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
        expect(request.headers.get("authorization")).toBe("Bearer public-test-fixture");
        requests.push((await request.json()) as Record<string, unknown>);
        return json(reply("<thought>provider trace</thought>\nactual answer<end_of_turn>"));
      });
      const engine = new UnifiedInferenceEngine("native-model-id", {
        endpointUrl,
        apiKey: "public-test-fixture",
      });
      const result = await engine.infer({
        prompt: "Q",
        backend,
        history: [{ role: "model", content: "Earlier" }],
        systemPrompt: "System",
        temperature: 0.25,
        topP: 0.8,
        maxTokens: 30,
      });
      expect(requests).toEqual([
        {
          model: "native-model-id",
          messages: [
            { role: "system", content: "System" },
            { role: "assistant", content: "Earlier" },
            { role: "user", content: "Q" },
          ],
          temperature: 0.25,
          top_p: 0.8,
          max_tokens: 30,
          stream: false,
        },
      ]);
      expect(result.text).toBe("actual answer");
      expect(result.thought).toBe("provider trace");
      expect(result.model).toBe("provider-revision");
      expect(result.backend).toBe(backend);
      expect(result.usage).toEqual({
        promptTokensEst: 12,
        completionTokensEst: 3,
        totalTokensEst: 15,
        source: "provider",
      });
    });
  }

  it("preserves provider reasoning and labels missing usage as estimates", async () => {
    const endpointUrl = listen(() =>
      json({
        choices: [
          {
            message: {
              content: "Answer",
              reasoning_content: "provider metadata",
            },
          },
        ],
      }),
    );
    const result = await new UnifiedInferenceEngine("provider-only-model", {
      endpointUrl,
    }).infer({
      prompt: "Q",
    });
    expect(result.model).toBe("provider-only-model");
    expect(result.thought).toBe("provider metadata");
    expect(result.usage.source).toBe("estimate");
  });

  it("rejects invalid request values before contacting a provider", async () => {
    let requests = 0;
    const endpointUrl = listen(() => {
      requests++;
      return json(reply());
    });
    const engine = new UnifiedInferenceEngine("fixture", { endpointUrl });
    await Promise.all(
      [
        { prompt: " " },
        { temperature: -1 },
        { temperature: NaN },
        { topP: 0 },
        { topP: 2 },
        { maxTokens: 0 },
        { maxTokens: 1.5 },
        { thought: "prefill" },
        { history: [{ role: "user" as const, content: "Q", imageCount: 1 }] },
        {
          history: [{ role: "assistant" as const, content: "A", thought: "prefill" }],
        },
        { timeoutMs: 0 },
        { maxResponseBytes: 0 },
      ].map(patch => expect(engine.infer({ prompt: "Q", ...patch })).rejects.toThrow()),
    );
    await Promise.all(
      ["invalid URL", "file:///tmp/model", "http://user:password@127.0.0.1/v1"].map(url =>
        expect(engine.infer({ prompt: "Q", endpointUrl: url })).rejects.toThrow(),
      ),
    );
    expect(requests).toBe(0);
  });

  it("propagates HTTP errors instead of fabricating a successful local response", async () => {
    await Promise.all(
      [400, 404, 500].map(async status => {
        const engine = new UnifiedInferenceEngine("fixture", {
          endpointUrl: listen(() => json({ error: "fixture failure" }, status)),
        });
        try {
          await engine.infer({ prompt: "Q" });
          throw new Error("expected provider failure");
        } catch (error) {
          expect(error).toBeInstanceOf(InferenceError);
          expect((error as InferenceError).status).toBe(status);
        }
      }),
    );
  });

  it("rejects malformed and oversized responses", async () => {
    const malformed = [
      "not JSON",
      {},
      { choices: [] },
      { choices: [{ message: { content: null } }] },
      {
        ...reply(),
        usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 },
      },
    ];
    await Promise.all(
      malformed.map(response => {
        const endpointUrl = listen(() => (typeof response === "string" ? new Response(response) : json(response)));
        return expect(
          new UnifiedInferenceEngine("fixture", { endpointUrl }).infer({
            prompt: "Q",
          }),
        ).rejects.toThrow();
      }),
    );
    const endpointUrl = listen(() => json(reply("x".repeat(1000))));
    await expect(
      new UnifiedInferenceEngine("fixture", {
        endpointUrl,
        maxResponseBytes: 100,
      }).infer({
        prompt: "Q",
      }),
    ).rejects.toThrow("maxResponseBytes");
  });

  it("streams the first visible token before the response ends, including fragmented UTF-8 and tags", async () => {
    const release = deferred();
    const encoder = new TextEncoder();
    const endpointUrl = listen(() =>
      sse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(event("  Hel")));
            void release.promise.then(() => {
              const rest = encoder.encode(
                event("lo <th") + event("ought>hidden</th") + event("ought>🌍<end_of_") + event("turn>  ") + terminal,
              );
              for (let offset = 0; offset < rest.length; offset += 3)
                controller.enqueue(rest.slice(offset, offset + 3));
              controller.close();
              return;
            });
          },
        }),
      ),
    );
    const iterator = new UnifiedInferenceEngine("fixture", {
      endpointUrl,
    }).stream({ prompt: "Q" });
    try {
      const first = await Promise.race([
        iterator.next(),
        Bun.sleep(1000).then(() => {
          throw new Error("First token waited for EOF");
        }),
      ]);
      expect(first.value).toBe("Hel");
      expect(first.done).toBe(false);
      release.resolve();
      expect(first.value + (await collect(iterator))).toBe("Hello 🌍");
    } finally {
      release.resolve();
      await iterator.return(undefined);
    }
  });

  it("accepts CRLF, multiline data, comments and provider usage-only records", async () => {
    const body =
      ': keepalive\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"A"}}]}\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":1}}\r\n\r\n' +
      terminal;
    const endpointUrl = listen(() => sse(body));
    expect(
      await collect(
        new UnifiedInferenceEngine("fixture", { endpointUrl }).stream({
          prompt: "Q",
        }),
      ),
    ).toBe("A");
  });

  it("bounds each SSE event while allowing many small events in one HTTP chunk", async () => {
    const endpointUrl = listen(() => sse(event("a").repeat(20) + terminal));
    expect(
      await collect(
        new UnifiedInferenceEngine("fixture", {
          endpointUrl,
          maxResponseBytes: 100,
        }).stream({
          prompt: "Q",
        }),
      ),
    ).toBe("a".repeat(20));
    const large = listen(() => sse(event("x".repeat(200)) + terminal));
    await expect(
      collect(
        new UnifiedInferenceEngine("fixture", {
          endpointUrl: large,
          maxResponseBytes: 100,
        }).stream({ prompt: "Q" }),
      ),
    ).rejects.toThrow("maxResponseBytes");
  });

  it("rejects truncated, malformed and provider-error streams", async () => {
    await Promise.all(
      [
        event("partial"),
        "data: invalid\n\n",
        'data: {"error":{"message":"fixture"}}\n\n',
        'data: {"choices":[{"delta":{"content":3}}]}\n\n',
      ].map(body => {
        const endpointUrl = listen(() => sse(body));
        return expect(
          collect(
            new UnifiedInferenceEngine("fixture", { endpointUrl }).stream({
              prompt: "Q",
            }),
          ),
        ).rejects.toThrow();
      }),
    );
    const endpointUrl = listen(() => json(reply()));
    await expect(
      collect(
        new UnifiedInferenceEngine("fixture", { endpointUrl }).stream({
          prompt: "Q",
        }),
      ),
    ).rejects.toThrow("text/event-stream");
  });

  it("enforces timeout and combines engine/request cancellation lifetimes", async () => {
    const blocked = deferred();
    const endpointUrl = listen(async () => {
      await blocked.promise;
      return json(reply());
    });
    try {
      await expect(
        new UnifiedInferenceEngine("fixture", {
          endpointUrl,
          timeoutMs: 25,
        }).infer({
          prompt: "Q",
        }),
      ).rejects.toThrow();
      const lifetime = new AbortController();
      const caller = new AbortController();
      const pending = new UnifiedInferenceEngine("fixture", {
        endpointUrl,
        signal: lifetime.signal,
      }).infer({ prompt: "Q", signal: caller.signal });
      lifetime.abort(new Error("engine stopped"));
      await expect(pending).rejects.toThrow("engine stopped");
      caller.abort(new Error("caller stopped"));
      await expect(
        new UnifiedInferenceEngine("fixture", { endpointUrl }).infer({
          prompt: "Q",
          signal: caller.signal,
        }),
      ).rejects.toThrow("caller stopped");
    } finally {
      blocked.resolve();
    }
  });

  it("cancels the upstream stream when the consumer ends early", async () => {
    const cancelled = deferred();
    const endpointUrl = listen(() =>
      sse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event("first")));
          },
          cancel() {
            cancelled.resolve();
          },
        }),
      ),
    );
    const iterator = new UnifiedInferenceEngine("fixture", {
      endpointUrl,
    }).stream({ prompt: "Q" });
    expect((await iterator.next()).value).toBe("first");
    await iterator.return(undefined);
    await Promise.race([
      cancelled.promise,
      Bun.sleep(1000).then(() => {
        throw new Error("Upstream stream was not cancelled");
      }),
    ]);
  });

  it("aborts an active SSE read without fabricating its remaining response", async () => {
    const endpointUrl = listen(() =>
      sse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event("first")));
          },
        }),
      ),
    );
    const controller = new AbortController();
    const iterator = new UnifiedInferenceEngine("fixture", {
      endpointUrl,
    }).stream({
      prompt: "Q",
      signal: controller.signal,
    });
    expect((await iterator.next()).value).toBe("first");
    const pending = iterator.next();
    controller.abort(new Error("cancel stream"));
    await expect(pending).rejects.toThrow();
  });

  it("uses real provider embeddings with requested dimensions and model identity", async () => {
    const endpointUrl = listen(async request => {
      expect(new URL(request.url).pathname).toBe("/v1/embeddings");
      expect(await request.json()).toEqual({
        model: "actual-embedding-model",
        input: "text",
        encoding_format: "float",
        dimensions: 3,
      });
      return json({ data: [{ index: 0, embedding: [0.25, -0.5, 1] }] });
    });
    const result = await new UnifiedInferenceEngine("chat-model", {
      endpointUrl: `${endpointUrl}/chat/completions`,
    }).embed("text", { model: "actual-embedding-model", dimensions: 3 });
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([0.25, -0.5, 1]);
  });

  it("reports unsupported or invalid embeddings without a synthetic fallback", async () => {
    const unsupported = listen(() => json({ error: "unsupported" }, 404));
    await expect(new UnifiedInferenceEngine("fixture", { endpointUrl: unsupported }).embed("text")).rejects.toThrow(
      "HTTP 404",
    );
    await Promise.all(
      [[], [null, 0, 0], [1e99, 0, 0], [1, 2]].map(vector => {
        const endpointUrl = listen(() => json({ data: [{ embedding: vector }] }));
        return expect(
          new UnifiedInferenceEngine("fixture", { endpointUrl }).embed("text", {
            dimensions: 3,
          }),
        ).rejects.toThrow();
      }),
    );
  });
});
