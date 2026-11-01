// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { NativeRedisClient } from "../src/redis/client";
import { RedisTrainDb } from "../src/redis/traindb";
import { RedisVectorStore } from "../src/redis/vector";

describe("Native Bun Redis Vector & Train DB", () => {
  it("serializes and deserializes Float32 vectors without precision loss", () => {
    const orig = new Float32Array([0.123456, -0.654321, 1.0, 0.0, -1.0]);
    const serialized = RedisVectorStore.serializeVector(orig);
    expect(typeof serialized).toBe("string");

    const deserialized = RedisVectorStore.deserializeVector(serialized);
    expect(deserialized.length).toBe(orig.length);
    for (let i = 0; i < orig.length; i++) {
      expect(deserialized[i]).toBeCloseTo(orig[i]!, 6);
    }
  });

  it("performs vector indexing and similarity search in RedisVectorStore", async () => {
    const client = new NativeRedisClient({ offline: true });
    const store = new RedisVectorStore(client, "test_codebase");

    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([0.8, 0.6, 0]);
    const vec3 = new Float32Array([0, 0, 1]);

    await store.upsert("doc1", vec1, {
      category: "ml",
      title: "Gemma4 Architecture",
    });
    await store.upsert("doc2", vec2, {
      category: "ml",
      title: "Attention Mechanism",
    });
    await store.upsert("doc3", vec3, {
      category: "database",
      title: "Audit Logging",
    });

    expect(await store.count()).toBe(3);

    // Query with ML topic
    const queryVec = vec2;
    const results = await store.query(queryVec, 2);

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe("doc2");
    expect(results[0]?.score).toBeCloseTo(1.0, 5);

    // Filtered search
    const filtered = await store.query(queryVec, 5, { category: "database" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.id).toBe("doc3");

    // Delete
    expect(await store.delete("doc3")).toBe(true);
    expect(await store.count()).toBe(2);

    // Cleanup
    await store.clear();
    expect(await store.count()).toBe(0);
  });

  it("stores and manages instruction and triple records in RedisTrainDb", async () => {
    const client = new NativeRedisClient({ offline: true });
    const trainDb = new RedisTrainDb(client, "gemma4_finetune");

    // Add instruction tuning sample
    await trainDb.addInstruction({
      id: "inst-1",
      instruction: "Convert natural language query to vector search parameters.",
      input: "Search for Gemma 4 sliding window documentation.",
      output: JSON.stringify({ query: "Gemma 4 sliding window", topK: 5 }),
      thought: "Extract topic and default topK to 5.",
      split: "train",
    });

    // Add contrastive triple sample
    await trainDb.addTriple({
      id: "triple-1",
      query: "Gemma 4 E2B parameter size",
      positive: "Gemma 4 E2B is a 2B parameter dense multimodal model.",
      negative: "Llama 3 is an 8B parameter model from Meta.",
      split: "train",
    });

    const stats = await trainDb.getStats();
    expect(stats.totalCount).toBe(2);
    expect(stats.dataset).toBe("gemma4_finetune");

    const record = await trainDb.getRecord("inst-1");
    expect(record).not.toBeNull();
    expect(record?.instruction).toBe("Convert natural language query to vector search parameters.");

    const list = await trainDb.listRecords(10);
    expect(list.length).toBe(2);

    await trainDb.clear();
    const clearedStats = await trainDb.getStats();
    expect(clearedStats.totalCount).toBe(0);
  });
});
