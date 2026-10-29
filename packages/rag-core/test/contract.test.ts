// SPDX-License-Identifier: Apache-2.0
// One contract, run against every backend that is built: the facade must behave identically.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRagCore, type RagCore } from "../src/core";

const root = join(import.meta.dir, "..");
const wasmFile = join(root, "../../infra/cli-wasm/wasm/aphrody_command_wasm_bg.wasm");
const ffiPath = process.env.APHRODY_RAG_LIBRARY;

const backends: [string, () => Promise<RagCore>][] = [];
if (existsSync(wasmFile)) {
  backends.push([
    "wasm",
    async () => {
      const { loadRagWasmSync } = await import("../src/wasm");
      return loadRagWasmSync(readFileSync(wasmFile));
    },
  ]);
}
if (ffiPath && existsSync(ffiPath)) {
  backends.push(["ffi", async () => (await import("../src/ffi")).openRagFfi(ffiPath)]);
}

test("at least one backend is built (bun run build:wasm, APHRODY_RAG_LIBRARY)", () => {
  expect(backends.length).toBeGreaterThan(0);
});

const f32 = (...v: number[]) => new Float32Array(v);
const hit = (url: string) => ({ title: "t", url, snippet: "s", score: 1 });

for (const [name, load] of backends) {
  describe(name, () => {
    let rag: RagCore;
    test("loads and reports its manifest", async () => {
      rag = await load();
      expect(rag.manifest.abi).toBe(1);
      expect(rag.manifest.json.length).toBeGreaterThan(20);
    });

    test("chunking: rust, markdown, prose, JS/TS", () => {
      const rs = rag.chunk("a.rs", 'fn greet() {\n    println!("hi");\n}\n');
      expect(rs[0]?.symbol).toBe("greet");
      expect(rs[0]?.hash).toHaveLength(64);
      expect(rag.chunk("a.md", "# A\n\ntext one.\n\n## B\n\ntext two.\n").length).toBeGreaterThan(0);
      expect(rag.chunk("a.txt", "Hello world. Second one.")[0]?.kind).toBe("prose");
      const ts = rag.chunk("a.ts", "export function add(a: number, b: number) {\n  return a + b;\n}\n");
      expect(ts.length).toBeGreaterThan(0);
      expect(
        rag.chunk("a.md", "é".repeat(40), {
          max_chars: 10,
          length_unit: "bytes",
        }).length,
      ).toBeGreaterThan(0);
    });

    test("text helpers", () => {
      expect(rag.detectLanguage("x.tsx")).toBe("type_script");
      expect(rag.normalizeNewlines("a\r\nb")).toBe("a\nb");
      expect(rag.measure("a😀", "utf16")).toBe(3);
      expect(rag.splitSentences("One. Two! Three?")).toHaveLength(3);
    });

    test("fusion", () => {
      expect(rag.rrf([["a", "b"], ["b"]])[0]?.id).toBe("b");
      expect(
        rag.rrf([
          [1, 2, 3],
          [3, 2, 9],
        ])[0]?.id,
      ).toBe(3);
      expect(
        rag.rrfWeighted([
          { ids: ["a"], weight: 2 },
          { ids: ["b"], weight: 1 },
        ])[0]?.id,
      ).toBe("a");
      expect(
        rag.fuseScores(
          [
            {
              items: [
                { id: "a", score: 2 },
                { id: "b", score: 1 },
              ],
              weight: 1,
            },
            {
              items: [
                { id: "b", score: 5 },
                { id: "c", score: 0 },
              ],
              weight: 1,
            },
          ],
          "min_max",
        ),
      ).toHaveLength(3);
      expect(
        rag.applySourceWeights({
          candidates: [
            { id: 1, source_id: "x", score: 1 },
            { id: 2, source_id: "y", score: 0.9 },
          ],
          weights: [{ source_id: "y", weight: 2 }],
          topN: 1,
        })[0]?.id,
      ).toBe(2);
      expect(
        rag.mmr(
          [
            { id: "a", embedding: [1, 0], score: 1 },
            { id: "b", embedding: [1, 0], score: 0.9 },
            { id: "c", embedding: [0, 1], score: 0.8 },
          ],
          0.5,
          2,
        ),
      ).toEqual(["a", "c"]);
      expect(rag.minmaxNormalize([1, 3])).toEqual([0, 1]);
      expect(rag.mergeTopK([[{ index: 5, score: 0.5 }], [{ index: 1, score: 0.9 }]], 1)[0]?.index).toBe(1);
    });

    test("retrieval eval harness", () => {
      const gold = rag.evalParseGold('// c\n{"q":"x","expectUrl":["/a"],"tags":["t"]}\nbad\n');
      expect(gold).toHaveLength(1);
      const results = [hit("/zzz"), hit("https://example.org/a/")];
      const c = gold[0]!;
      expect(rag.evalNormalizeUrl("https://example.org/A/")).toBe("/a");
      expect(rag.evalMatchesUrl("/a/b", "/a")).toBe(true);
      expect(rag.evalMatchesUrl("/ab", "/a")).toBe(false);
      expect(rag.evalIsHit(hit("/a"), c)).toBe(true);
      expect(rag.evalFirstHitRank(results, c)).toBe(2);
      expect(rag.evalNdcgAtK(results, c)).toBeGreaterThan(0);
      const run = rag.evalRunCase(c, results, "hybrid", 12);
      const agg = rag.evalAggregate([run]);
      expect(agg.recall["5"]).toBe(1);
      expect(rag.evalAggregateByTag([run]).t).toBeDefined();
      expect(rag.evalGateCheck("recall@5>=0.8", agg).ok).toBe(true);
      expect(rag.evalGateCheck("recall@1>=0.8", agg).ok).toBe(false);
      const report = rag.evalReport("c", [run]);
      expect(rag.evalCompare(report, report).mrr.delta).toBe(0);
      expect(() => rag.evalCompare(report, rag.evalReport("d", [run]))).toThrow("condition mismatch");
      expect(rag.evalQuantile([1, 2, 3, 4], 0.5)).toBe(3);
      expect(rag.evalLatencyStats([10]).p95_ms).toBe(10);
    });

    test("errors surface as exceptions", () => {
      expect(() => rag.chunk("a.rs", "x", { profile: "nope" as never })).toThrow("unknown options profile");
      expect(() => rag.normalizeF32(f32(1, 2, 3), 2)).toThrow(RangeError);
      expect(() => rag.evalGateCheck("wat", { cases: 0, recall: {}, mrr: 0, ndcg: 0 })).toThrow("invalid gate");
    });

    test("dense vectors", () => {
      const v = f32(3, 4, 0, 2);
      const n = rag.normalizeF32(v, 2);
      expect(n[0]).toBeCloseTo(0.6, 6);
      expect(Array.from(rag.similaritiesF32(v, v, 2))).toEqual([25, 8, 8, 4]);
      expect(Array.from(rag.meanF32(v, 2))).toEqual([1.5, 3]);
      expect(Array.from(rag.squaredDistancesF32(v, f32(0, 0), 2))).toEqual([25, 4]);
      expect(rag.dotF32(f32(1, 2), f32(3, 4))).toBe(11);
      expect(rag.cosineF32(f32(1, 0), f32(1, 0))).toBeCloseTo(1, 6);
      expect(rag.l2NormalizeF32(f32(3, 4), 2)[1]).toBeCloseTo(0.8, 6);
      const d = new Float64Array([3, 4]);
      expect(rag.normalizeF64(d, 2)[0]).toBeCloseTo(0.6, 12);
      expect(Array.from(rag.meanF64(d, 2))).toEqual([3, 4]);
      expect(Array.from(rag.similaritiesF64(d, d, 2))).toEqual([25]);
      expect(Array.from(rag.squaredDistancesF64(d, d, 2))).toEqual([0]);
      expect(rag.updateCentersF64(d, [0], d, 2)).toHaveLength(2);
      // a view with a non-zero byteOffset into a larger buffer must be read at its own offset
      const shifted = new Float32Array(new Float32Array([9, 9, 1, 0]).buffer, 8, 2);
      expect(rag.dotF32(shifted, f32(1, 0))).toBe(1);
    });

    test("top-k scans, int8 and shard merge", () => {
      const matrix = f32(1, 0, 0, 1, 0.7, 0.7);
      const top = rag.topKCosineF32(f32(1, 0), matrix, 2, 2);
      expect(top.map(h => h.index)).toEqual([0, 2]);
      expect(rag.topKDotF32(f32(1, 0), f32(1, 0, 0, 1), 2, 1)[0]?.index).toBe(0);
      const unit = [f32(1, 0), f32(0, 1)].map(r => rag.quantizeI8(r));
      const codes = new Int8Array([...unit[0]!.codes, ...unit[1]!.codes]);
      const scales = f32(unit[0]!.scale, unit[1]!.scale);
      expect(rag.topKI8(f32(1, 0), codes, scales, 2, 1)[0]?.index).toBe(0);
      expect(rag.mergeTopK([top.slice(0, 1), top.slice(1)], 2)).toHaveLength(2);
    });

    test("large batch round-trips beyond the scratch size", () => {
      const rows = 300;
      const width = 64;
      const data = new Float32Array(rows * width).map((_, i) => (i % 7) + 1);
      expect(rag.similaritiesF32(data, data, width)).toHaveLength(rows * rows);
      const text = "Phrase de test. ".repeat(20_000);
      expect(rag.chunk("big.txt", text).length).toBeGreaterThan(10);
    });
  });
}

test.skipIf(!existsSync(wasmFile))("loadRagWasm instantiates from bytes (async path)", async () => {
  const { loadRagWasm } = await import("../src/wasm");
  const rag = await loadRagWasm(readFileSync(wasmFile));
  expect(rag.chunk("a.rs", "fn f() {}\n")[0]?.symbol).toBe("f");
});

describe("facade drift", () => {
  test("the facade covers every operation of the manifest", async () => {
    const [name, load] = backends[0] ?? [];
    if (!name || !load) return;
    const rag = await load();
    const source = readFileSync(join(root, "src/core.ts"), "utf8");
    const listed = new Set([...source.matchAll(/(?:json<.*?>|vec)\(\s*"([a-z0-9_]+)"/g)].map(m => m[1]));
    for (const op of [...rag.manifest.json, ...rag.manifest.vec])
      expect(listed.has(op.name), `facade lacks operation ${op.name}`).toBe(true);
    for (const op of listed) {
      expect(
        [...rag.manifest.json, ...rag.manifest.vec].some(o => o.name === op),
        `facade names unknown ${op}`,
      ).toBe(true);
    }
  });

  test("the transport object is the only coupling", () => {
    expect(typeof createRagCore).toBe("function");
  });
});
