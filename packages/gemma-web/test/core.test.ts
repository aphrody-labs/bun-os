// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  GEMMA4_E2B_QAT_MOBILE,
  GemmaOpenAI,
  MemoryStorage,
  ShardStore,
  argmax,
  floatToHalf,
  halfToFloat,
  hubUrl,
  kvBytes,
  mulberry32,
  planBudget,
  sampleToken,
  toFloat32,
  totalBytes,
  type GenerateStats,
} from "../src/index";

describe("sampler", () => {
  const logits = new Float32Array(100).fill(-5);
  logits[7] = 3;
  logits[42] = 2.5;
  logits[9] = 2;
  test("greedy when temperature is 0", () => {
    expect(sampleToken(logits, { temperature: 0 })).toBe(7);
    expect(argmax(logits)).toBe(7);
  });
  test("top-k 1 is greedy at any temperature", () => {
    for (let s = 0; s < 20; s++) expect(sampleToken(logits, { temperature: 2, topK: 1 }, mulberry32(s))).toBe(7);
  });
  test("top-k and top-p restrict the support", () => {
    const seen = new Set<number>();
    const r = mulberry32(3);
    for (let i = 0; i < 400; i++) seen.add(sampleToken(logits, { temperature: 1, topK: 3, topP: 0.95 }, r));
    expect([...seen].every(x => [7, 42, 9].includes(x))).toBe(true);
    expect(seen.has(7)).toBe(true);
    expect(seen.has(42)).toBe(true);
  });
  test("seeded sampling is reproducible", () => {
    const a = Array.from({ length: 30 }, (_, i) => sampleToken(logits, { temperature: 1.3 }, mulberry32(i)));
    const b = Array.from({ length: 30 }, (_, i) => sampleToken(logits, { temperature: 1.3 }, mulberry32(i)));
    expect(a).toEqual(b);
  });
  test("softmax weights match frequencies", () => {
    const two = new Float32Array([0, Math.log(3)]);
    const r = mulberry32(11);
    let ones = 0;
    for (let i = 0; i < 4000; i++) ones += sampleToken(two, { temperature: 1, topP: 1 }, r);
    expect(ones / 4000).toBeGreaterThan(0.72);
    expect(ones / 4000).toBeLessThan(0.78);
  });
});

describe("fp16", () => {
  test("round trip of representable values", () => {
    for (const v of [0, 1, -1, 0.5, 65504, -2.5, 6.103515625e-5, 1 / 1024]) expect(halfToFloat(floatToHalf(v))).toBe(v);
  });
  test("inf and nan", () => {
    expect(halfToFloat(floatToHalf(1e9))).toBe(Infinity);
    expect(halfToFloat(floatToHalf(NaN))).toBeNaN();
  });
  test("toFloat32 widens Uint16 bits", () => {
    expect([...toFloat32(Uint16Array.from([floatToHalf(1.5), floatToHalf(-3)]))]).toEqual([1.5, -3]);
  });
});

describe("ShardStore", () => {
  const body = new Uint8Array(1000).map((_, i) => i % 251);
  const mk = (rangeAware = true) => {
    const calls: string[] = [];
    const f = (async (_u: unknown, init?: RequestInit) => {
      const h = new Headers(init?.headers).get("range");
      calls.push(h ?? "full");
      if (!h || !rangeAware) return new Response(body);
      const [s, e] = h.replace("bytes=", "").split("-").map(Number) as [number, number];
      return new Response(body.slice(s, e + 1), { status: 206 });
    }) as typeof fetch;
    return { f, calls };
  };
  test("downloads in parts, reports progress, reassembles", async () => {
    const { f, calls } = mk();
    const prog: number[] = [];
    const s = new ShardStore({
      url: p => `http://x/${p}`,
      storage: new MemoryStorage(),
      namespace: "n",
      partBytes: 300,
      fetch: f,
      onProgress: p => prog.push(p.loaded),
    });
    s.plan([{ path: "a", bytes: 1000 }]);
    expect([...(await s.get("a", 1000))]).toEqual([...body]);
    expect(calls).toEqual(["bytes=0-299", "bytes=300-599", "bytes=600-899", "bytes=900-999"]);
    expect(prog).toEqual([300, 600, 900, 1000]);
  });
  test("resumes from stored parts and never refetches them", async () => {
    const storage = new MemoryStorage();
    const first = mk();
    const s1 = new ShardStore({ url: p => p, storage, namespace: "n", partBytes: 400, fetch: first.f });
    await s1.get("a", 1000);
    storage.parts.delete("n/a.0001");
    const second = mk();
    const s2 = new ShardStore({ url: p => p, storage, namespace: "n", partBytes: 400, fetch: second.f });
    expect([...(await s2.get("a", 1000))]).toEqual([...body]);
    expect(second.calls).toEqual(["bytes=400-799"]);
  });
  test("falls back when the server ignores Range", async () => {
    const { f } = mk(false);
    const s = new ShardStore({ url: p => p, storage: new MemoryStorage(), namespace: "n", partBytes: 600, fetch: f });
    expect([...(await s.get("a", 1000))]).toEqual([...body]);
  });
  test("rejects a short part", async () => {
    const f = (async () => new Response(new Uint8Array(5), { status: 206 })) as unknown as typeof fetch;
    const s = new ShardStore({ url: p => p, storage: new MemoryStorage(), namespace: "n", fetch: f });
    await expect(s.get("a", 100)).rejects.toThrow(/got 5, expected 100/);
  });
});

describe("catalog and budget", () => {
  test("pinned files stay under 2 GiB each and total ~2.3 GB", () => {
    for (const f of GEMMA4_E2B_QAT_MOBILE.files) expect(f.bytes).toBeLessThan(2 ** 31);
    expect(totalBytes(GEMMA4_E2B_QAT_MOBILE)).toBeGreaterThan(2.2e9);
    expect(totalBytes(GEMMA4_E2B_QAT_MOBILE)).toBeLessThan(2.4e9);
    expect(hubUrl(GEMMA4_E2B_QAT_MOBILE, "config.json")).toContain(GEMMA4_E2B_QAT_MOBILE.revision);
  });
  test("KV bytes scale linearly: 15 own layers, fp16, 1 kv head", () => {
    // 3 full layers (dim 512) + 12 sliding layers (dim 256): 2*1*(3*512+12*256)*2 bytes per token
    expect(kvBytes(1)).toBe(2 * (3 * 512 + 12 * 256) * 2);
    expect(kvBytes(1000)).toBe(kvBytes(1) * 1000);
  });
  test("plan picks webgpu when available and halves context under pressure", () => {
    const ok = planBudget({ webgpu: true, deviceMemoryGiB: 8, crossOriginIsolated: true });
    expect(ok.decoderEp).toBe("webgpu");
    expect(ok.contextTokens).toBe(8192);
    const small = planBudget({ webgpu: true, deviceMemoryGiB: 3, crossOriginIsolated: false });
    expect(small.contextTokens).toBeLessThan(8192);
    expect(small.warnings.join(" ")).toContain("cross-origin");
    const cpu = planBudget({ webgpu: false });
    expect(cpu.decoderEp).toBe("wasm");
    expect(cpu.warnings.join(" ")).toContain("WebGPU unavailable");
  });
});

describe("OpenAI surface", () => {
  const stats: GenerateStats = {
    promptTokens: 4,
    completionTokens: 3,
    ttftMs: 1,
    decodeTps: 2,
    totalMs: 3,
    finishReason: "stop",
  };
  const backend = {
    async *generate(opts: { messages: { role: string; content: string }[] }) {
      yield "Hel";
      yield "lo ";
      yield opts.messages.at(-1)!.content;
      return stats;
    },
  };
  const api = new GemmaOpenAI(backend as never);
  test("non-streaming completion", async () => {
    const r = await api.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    expect(r.choices[0]!.message.content).toBe("Hello x");
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
  });
  test("streaming chunks end with finish_reason and usage", async () => {
    const chunks = [];
    for await (const c of api.chat.completions.create({ messages: [{ role: "user", content: "y" }], stream: true }))
      chunks.push(c);
    expect(chunks[0]!.choices[0]!.delta.role).toBe("assistant");
    expect(chunks.map(c => c.choices[0]!.delta.content ?? "").join("")).toBe("Hello y");
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe("stop");
    expect(chunks.at(-1)!.usage!.total_tokens).toBe(7);
  });
  test("fetch serves SSE and models", async () => {
    const res = await api.fetch("http://local/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "z" }] }], stream: true }),
    });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const datas = text
      .split("\n\n")
      .filter(l => l.startsWith("data: {"))
      .map(l => JSON.parse(l.slice(6)));
    expect(datas.map(d => d.choices[0].delta.content ?? "").join("")).toBe("Hello z");
    const models = await (await api.fetch("http://local/v1/models")).json();
    expect(models.data[0].id).toBe("gemma-4-e2b-it-web");
    expect((await api.fetch("http://local/v1/other", { method: "POST" })).status).toBe(404);
  });
});
