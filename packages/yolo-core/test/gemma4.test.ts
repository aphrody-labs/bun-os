// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
import { describe, expect, it } from "bun:test";
import {
  GEMMA4_CONFIG_PROVENANCE,
  GEMMA4_E2B_CONFIG,
  GEMMA4_MODELS,
  Gemma4ResponseParser,
  UnifiedInferenceEngine,
  computeKVCacheFootprintBytes,
  cosineSimilarity,
  estimateGemma4Memory,
  euclideanDistance,
  formatGemma4ChatPrompt,
  generateDeterministicEmbedding,
  getGemma4Config,
  normalizeL2,
  parseGemma4Response,
  validateGemma4Config,
  type Gemma4Message,
} from "../src/gemma4/index";

describe("Gemma repository profiles and text utilities", () => {
  it("marks profiles unverified and rejects unknown names rather than aliasing E2B", () => {
    expect(GEMMA4_CONFIG_PROVENANCE.status).toBe("unverified");
    expect(getGemma4Config("gemma4_e2b")).toBe(GEMMA4_E2B_CONFIG);
    for (const profile of Object.values(GEMMA4_MODELS)) expect(() => validateGemma4Config(profile)).not.toThrow();
    for (const name of ["unknown-variant", "constructor", "__proto__"])
      expect(() => getGemma4Config(name)).toThrow("Unknown model profile");
    const engine = new UnifiedInferenceEngine("actual-provider-model");
    expect(engine.defaultModel).toBe("actual-provider-model");
    expect(engine.defaultConfig).toBeUndefined();
  });

  it("validates profiles and keeps storage estimates distinct from cache allocation", () => {
    expect(estimateGemma4Memory(GEMMA4_E2B_CONFIG).memoryBytes).toBe(4_000_000_000);
    for (const patch of [
      { numLayers: 0 },
      { numKvHeads: 3 },
      { rmsNormEps: NaN },
      { attentionPattern: [] },
      { attentionPattern: ["invalid"] },
      { topKExperts: 1 },
      { globalRopeProportion: Infinity },
    ]) {
      expect(() =>
        validateGemma4Config({
          ...GEMMA4_E2B_CONFIG,
          ...patch,
        } as typeof GEMMA4_E2B_CONFIG),
      ).toThrow();
    }
    expect(() => estimateGemma4Memory(GEMMA4_E2B_CONFIG, 3 as 2)).toThrow("bytesPerParam");
    const short = computeKVCacheFootprintBytes(GEMMA4_E2B_CONFIG, 1, 512);
    const long = computeKVCacheFootprintBytes(GEMMA4_E2B_CONFIG, 1, 2048);
    expect(short.localBytes).toBe(28 * 512 * 256 * 2 * 2);
    expect(long.localBytes).toBe(short.localBytes);
    expect(long.globalBytes).toBe(7 * 2048 * 256 * 2 * 2);
    const partial = computeKVCacheFootprintBytes({ ...GEMMA4_E2B_CONFIG, numLayers: 7 }, 2, 20, 4);
    expect(partial.localBytes).toBe(6 * 2 * 20 * 256 * 2 * 4);
    expect(partial.globalBytes).toBe(1 * 2 * 20 * 256 * 2 * 4);
    for (const args of [
      [0, 512, 2],
      [1, -1, 2],
      [1, 512, 3],
      [Number.MAX_SAFE_INTEGER, 512, 2],
    ]) {
      expect(() => computeKVCacheFootprintBytes(GEMMA4_E2B_CONFIG, ...(args as [number, number, number]))).toThrow();
    }
  });

  it("formats text conventions and labels media as placeholders", () => {
    const prompt = formatGemma4ChatPrompt([
      { role: "system", content: "System" },
      { role: "user", content: "Question", imageCount: 2 },
      { role: "assistant", content: "Answer", thought: "Trace" },
    ]);
    expect(prompt).toBe(
      "<bos><start_of_turn>user\nSystem\n\n<image><image>\nQuestion<end_of_turn>\n<start_of_turn>model\n<thought>\nTrace\n</thought>\nAnswer<end_of_turn>\n<start_of_turn>model\n",
    );
    expect(
      formatGemma4ChatPrompt([{ role: "user", content: "Q" }], {
        includeBos: false,
        addGenerationPrompt: false,
      }),
    ).toBe("<start_of_turn>user\nQ<end_of_turn>\n");
    for (const message of [
      { role: "invalid", content: "Q" },
      { role: "user", content: 7 },
      { role: "user", content: "Q", imageCount: -1 },
      { role: "user", content: "Q", audioCount: 1.5 },
      { role: "user", content: "Q", imageCount: 1025 },
    ]) {
      expect(() => formatGemma4ChatPrompt([message as Gemma4Message])).toThrow();
    }
    expect(() => formatGemma4ChatPrompt([{ role: "user", content: "x".repeat(1_048_576) }])).toThrow("budget");
  });

  it("keeps full parsing and every possible streaming split coherent", () => {
    const raw = "  Before <thought>first</thought>middle<thought>second</thought> after<end_of_turn><eos>  ";
    const full = parseGemma4Response(raw);
    expect(full).toEqual({
      content: "Before middle after",
      thought: "first\nsecond",
    });
    for (let split = 0; split <= raw.length; split++) {
      const parser = new Gemma4ResponseParser();
      const prefix = parser.push(raw.slice(0, split)) + parser.push(raw.slice(split));
      const final = parser.finish();
      expect(prefix + final.text).toBe(full.content);
      expect(final.thought).toBe(full.thought);
    }
    expect(parseGemma4Response("visible<thought>unfinished")).toEqual({
      content: "visible",
      thought: "unfinished",
    });
    expect(parseGemma4Response("literal <th").content).toBe("literal <th");
    const parser = new Gemma4ResponseParser(false);
    expect(parser.push("<thought>hidden</thought> answer")).toBe("answer");
    expect(parser.finish().thought).toBeNull();
  });

  it("uses finite vector arithmetic and treats tiny nonzero norms accurately", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([-1, -2]))).toBeCloseTo(-1, 12);
    expect(cosineSimilarity(new Float32Array([1e-30]), new Float32Array([1e-30]))).toBe(1);
    expect(cosineSimilarity(new Float32Array([0]), new Float32Array([1]))).toBe(0);
    expect(euclideanDistance(new Float32Array([0, 0]), new Float32Array([3, 4]))).toBe(5);
    expect(normalizeL2(new Float32Array([1e-30]))[0]).toBe(1);
    expect(() => normalizeL2(new Float32Array([NaN]))).toThrow("finite");
    expect(() => cosineSimilarity(new Float32Array(), new Float32Array())).toThrow("non-empty");
    expect(() => euclideanDistance(new Float32Array([1]), new Float32Array([1, 2]))).toThrow("Dimension mismatch");
  });

  it("retains explicitly synthetic deterministic projection without semantic claims", () => {
    const first = generateDeterministicEmbedding("fixture", 16);
    expect(first).toEqual(generateDeterministicEmbedding("fixture", 16));
    expect(cosineSimilarity(first, first)).toBeCloseTo(1);
    expect(first).not.toEqual(generateDeterministicEmbedding("other", 16));
    for (const dim of [0, -1, 1.5, Infinity, 1_048_577])
      expect(() => generateDeterministicEmbedding("fixture", dim)).toThrow("dimension");
  });

  it("requires an explicitly injected handler for the named mock backend", async () => {
    await expect(new UnifiedInferenceEngine().infer({ prompt: "Q", backend: "mock" })).rejects.toThrow(
      "explicitly injected",
    );
    const engine = new UnifiedInferenceEngine("fixture", {
      mock: async () => ({
        text: "test double",
        thought: null,
        model: "fixture",
        backend: "local",
        latencyMs: 0,
        usage: {
          promptTokensEst: 1,
          completionTokensEst: 1,
          totalTokensEst: 2,
        },
      }),
    });
    expect((await engine.infer({ prompt: "Q", backend: "mock" })).backend).toBe("mock");
    const chunks = [];
    for await (const chunk of engine.stream({ prompt: "Q", backend: "mock" })) chunks.push(chunk);
    expect(chunks).toEqual(["test double"]);
  });
});
