// SPDX-License-Identifier: Apache-2.0
// The client is exercised against a local HTTP server that speaks the llama-server / OpenAI SSE protocol.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BackendError, buildMessages, openAiCompatible } from "./backend";

let server: ReturnType<typeof Bun.serve>;
let base: string;
const seen: { auth: string | null; body: any }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/chat/completions") {
        const body = await request.json();
        seen.push({ auth: request.headers.get("authorization"), body });
        if (request.headers.get("authorization") === "Bearer wrong") return new Response("bad key", { status: 401 });
        const chunks = ["Hel", "lo ", "wor", "ld"];
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode(": keep-alive\n\n"));
            for (const c of chunks) {
              // split one event across two network chunks to check the line buffering
              const line = `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
              controller.enqueue(enc.encode(line.slice(0, 9)));
              await Bun.sleep(1);
              controller.enqueue(enc.encode(line.slice(9)));
            }
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));

const collect = async (gen: AsyncGenerator<string>) => {
  let out = "";
  for await (const piece of gen) out += piece;
  return out;
};

describe("OpenAI-compatible backend", () => {
  test("local llama backend streams the answer without a key", async () => {
    const backend = openAiCompatible({ kind: "llama", baseUrl: base, model: "local" });
    const out = await collect(backend.ask(buildMessages("Say hello", [])));
    expect(out).toBe("Hello world");
    const last = seen.at(-1)!;
    expect(last.auth).toBeNull();
    expect(last.body.stream).toBe(true);
    expect(last.body.model).toBe("local");
    expect(last.body.messages.at(-1)).toEqual({ role: "user", content: "Say hello" });
  });

  test("hosted backend sends the user's key as a bearer token", async () => {
    const backend = openAiCompatible({ kind: "hosted", baseUrl: `${base}/`, model: "m", apiKey: " sk-test " });
    expect(await collect(backend.ask(buildMessages("x", [])))).toBe("Hello world");
    expect(seen.at(-1)!.auth).toBe("Bearer sk-test");
  });

  test("hosted backend without a key refuses before any request", async () => {
    const before = seen.length;
    const backend = openAiCompatible({ kind: "hosted", baseUrl: base, model: "m" });
    await expect(collect(backend.ask([]))).rejects.toBeInstanceOf(BackendError);
    expect(seen.length).toBe(before);
  });

  test("an HTTP error surfaces with its status", async () => {
    const backend = openAiCompatible({ kind: "hosted", baseUrl: base, model: "m", apiKey: "wrong" });
    await expect(collect(backend.ask([]))).rejects.toThrow("401");
  });

  test("aborting stops the stream", async () => {
    const backend = openAiCompatible({ kind: "llama", baseUrl: base, model: "local" });
    const controller = new AbortController();
    const it = backend.ask([], controller.signal);
    await it.next();
    controller.abort();
    await expect(collect(it)).rejects.toBeDefined();
  });
});

describe("prompt with file excerpts", () => {
  test("excerpts name their file and line", () => {
    const [system, user] = buildMessages("what is the plan?", [
      { path: "/home/user/notes/plan.md", line: 12, text: "ship on friday" },
    ]);
    expect(system!.content).toContain("/home/user/notes/plan.md:12");
    expect(system!.content).toContain("ship on friday");
    expect(user!.content).toBe("what is the plan?");
  });
  test("no excerpt, no context section", () => {
    expect(buildMessages("q", [])[0]!.content).not.toContain("Excerpts");
  });
});
