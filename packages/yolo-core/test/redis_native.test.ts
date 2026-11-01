// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeRedisClient, RedisUnavailableError } from "../src/redis/client";
import { RedisTrainDb } from "../src/redis/traindb";
import { RedisVectorStore } from "../src/redis/vector";

describe("Redis offline invariants", () => {
  it("copies vectors/metadata and applies stable ties, own-property filters and pagination", async () => {
    const client = new NativeRedisClient({ offline: true });
    const store = new RedisVectorStore(client, "offline");
    const vector = new Float32Array([1, 0]);
    const metadata = { group: "safe" };
    await store.upsert("b", vector, metadata);
    await store.upsert("a", vector, { group: "safe" });
    vector[0] = -1;
    metadata.group = "changed";
    const results = await store.query(new Float32Array([1, 0]), 2, {
      group: "safe",
    });
    expect(results.map(result => result.id)).toEqual(["a", "b"]);
    expect(results[1]?.score).toBe(1);
    results[1]!.metadata.group = "leaked";
    expect((await store.query(new Float32Array([1, 0]), 2))[1]?.metadata.group).toBe("safe");
    expect(await store.query(new Float32Array([1, 0]), 3, { toString: "inherited" })).toEqual([]);
    expect(await store.query(new Float32Array([1, 0]), 0)).toEqual([]);
    expect(store.persistenceState.pendingWrites).toBe(2);

    const db = new RedisTrainDb(client, "offline");
    const nested = { quality: { approved: true } };
    await db.addInstruction({
      id: "b",
      instruction: "B",
      output: "B",
      metadata: nested,
    });
    await db.addInstruction({ id: "a", instruction: "A", output: "A" });
    nested.quality.approved = false;
    expect((await db.listRecords(1, 1))[0]?.id).toBe("b");
    const record = (await db.getRecord("b"))!;
    (record.metadata as typeof nested).quality.approved = false;
    expect((await db.getRecord("b"))?.metadata).toEqual({
      quality: { approved: true },
    });
    expect(await db.delete("missing")).toBe(false);
    expect(await db.delete("a")).toBe(true);
    expect((await db.getStats()).totalCount).toBe(1);
  });

  it("rejects malformed vectors, dimensions, namespaces, records and pagination", async () => {
    const client = new NativeRedisClient({ offline: true });
    const store = new RedisVectorStore(client);
    for (const vector of [
      new Float32Array(),
      new Float32Array([0, 0]),
      new Float32Array([NaN]),
      new Float32Array([Infinity]),
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- chaque écriture modifie l'état de dimension du store : l'ordre séquentiel est ce qui est testé
      await expect(store.upsert("bad", vector)).rejects.toThrow();
    }
    await store.upsert("valid", new Float32Array([1, 0]));
    await expect(store.upsert("bad", new Float32Array([1]))).rejects.toThrow("dimensions");
    await expect(store.query(new Float32Array([1]))).rejects.toThrow("dimensions");
    await Promise.all(
      [-1, 1.5, NaN, Infinity].map(topK => expect(store.query(new Float32Array([1, 0]), topK)).rejects.toThrow()),
    );
    await expect(store.upsert("", new Float32Array([1, 0]))).rejects.toThrow("ID");
    await expect(
      store.upsert("bad", new Float32Array([1, 0]), {
        nested: 4,
      } as unknown as Record<string, string>),
    ).rejects.toThrow("strings");
    expect(() => new RedisVectorStore(client, "unsafe:namespace")).toThrow("namespace");
    expect(() => new RedisTrainDb(client, "unsafe:dataset")).toThrow("namespace");
    expect(() => new RedisVectorStore(client, "safe", { dimensions: 0 })).toThrow("dimensions");
    for (const value of ["", "@@@=", "AAAA", "A==="]) expect(() => RedisVectorStore.deserializeVector(value)).toThrow();
    const db = new RedisTrainDb(client);
    await expect(
      db.addInstruction({
        id: "bad",
        instruction: "i",
        output: "o",
        split: "invalid" as "train",
      }),
    ).rejects.toThrow("split");
    await expect(db.listRecords(-1)).rejects.toThrow("limit");
    await expect(db.listRecords(1, 0.5)).rejects.toThrow("offset");
    await expect(
      db.addInstruction({
        id: "bad",
        instruction: "i",
        output: "o",
        metadata: { bigint: 1n },
      }),
    ).rejects.toThrow();
    await Promise.all(
      [NaN, Infinity, undefined, () => "dropped", new Date()].map(unsupported =>
        expect(
          db.addInstruction({
            id: "bad",
            instruction: "i",
            output: "o",
            metadata: { unsupported },
          }),
        ).rejects.toThrow("metadata"),
      ),
    );
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(
      db.addInstruction({
        id: "bad",
        instruction: "i",
        output: "o",
        metadata: cycle,
      }),
    ).rejects.toThrow("cycles");
    expect((await db.getStats()).totalCount).toBe(0);
  });

  it("serializes concurrent dimension changes and resets only unconfigured dimensions on clear", async () => {
    const store = new RedisVectorStore(new NativeRedisClient({ offline: true }));
    const results = await Promise.allSettled([
      store.upsert("a", new Float32Array([1, 0])),
      store.upsert("b", new Float32Array([1, 0, 0])),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await store.count()).toBe(1);
    await store.clear();
    await store.upsert("b", new Float32Array([1, 0, 0]));
    expect(store.dimensions).toBe(3);
    const fixed = new RedisVectorStore(new NativeRedisClient({ offline: true }), "fixed", {
      dimensions: 2,
    });
    await fixed.clear();
    await expect(fixed.upsert("b", new Float32Array([1, 0, 0]))).rejects.toThrow("dimensions");
  });

  it("bounds stalled native operations and leaves explicit offline clients disconnected", async () => {
    const stalled = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const client = new NativeRedisClient({
      hostname: "127.0.0.1",
      port: stalled.port,
      timeoutMs: 40,
    });
    try {
      const started = performance.now();
      await expect(client.ping()).rejects.toBeInstanceOf(RedisUnavailableError);
      expect(performance.now() - started).toBeLessThan(1_000);
      const store = new RedisVectorStore(client, "stalled");
      await store.upsert("pending", new Float32Array([1]));
      expect(store.persistenceState.pendingWrites).toBe(1);
      await expect(new NativeRedisClient({ offline: true }).connect()).rejects.toBeInstanceOf(RedisUnavailableError);
    } finally {
      client.close();
      stalled.stop(true);
    }
  });
});

// This suite owns an ephemeral loopback server and temporary directory. Never use 6379.
describe.skipIf(Bun.which("redis-server") === null)("Native Bun Redis persistence (isolated server)", () => {
  let server: ReturnType<typeof Bun.spawn>;
  let directory: string;
  let port: number;
  const clients: NativeRedisClient[] = [];
  const createClient = () => {
    const client = new NativeRedisClient({
      hostname: "127.0.0.1",
      port,
      timeoutMs: 500,
    });
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "yolo-redis-test-"));
    const reservation = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    port = reservation.port;
    reservation.stop(true);
    server = Bun.spawn(
      [
        Bun.which("redis-server")!,
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--save",
        "",
        "--appendonly",
        "no",
        "--dir",
        directory,
      ],
      { windowsHide: true, stdout: "ignore", stderr: "ignore" },
    );
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const client = createClient();
      try {
        // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel du démarrage du serveur possédé : une requête à la fois jusqu'au PONG
        if ((await client.ping()) === "PONG") return;
      } catch {
        /* The owned server may still be starting. */
      } finally {
        client.close();
      }
      // oxlint-disable-next-line no-await-in-loop -- pause entre deux sondages de démarrage (boucle de polling volontairement séquentielle)
      await Bun.sleep(25);
    }
    throw new Error("Isolated Redis server failed to start");
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    if (server) {
      server.kill("SIGTERM");
      await server.exited;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("lazily persists to native Redis and survives fresh vector/training store instances", async () => {
    const writer = createClient();
    expect(writer.isConnected).toBe(false);
    const vectors = new RedisVectorStore(writer, "persist");
    await vectors.upsert("x", new Float32Array([2, 0]), { kind: "code" });
    await vectors.upsert("y", new Float32Array([0, 3]), { kind: "doc" });
    expect(writer.isConnected).toBe(true);
    expect(vectors.persistenceState.pendingWrites).toBe(0);
    const reader = new RedisVectorStore(createClient(), "persist");
    expect(await reader.count()).toBe(2);
    expect(reader.dimensions).toBe(2);
    expect((await reader.query(new Float32Array([1, 0]), 2))[0]?.id).toBe("x");
    expect((await reader.query(new Float32Array([1, 0]), 2, { kind: "doc" })).map(result => result.id)).toEqual(["y"]);
    expect(await writer.get(vectors.dimensionKey)).toBe("2");

    const db = new RedisTrainDb(writer, "persist");
    await db.addInstruction({
      id: "b",
      instruction: "i",
      output: "o",
      split: "train",
    });
    await db.addTriple({
      id: "a",
      query: "q",
      positive: "p",
      negative: "n",
      split: "val",
    });
    const fresh = new RedisTrainDb(createClient(), "persist");
    expect((await fresh.getStats()).totalCount).toBe(2);
    expect(await fresh.getStats()).toEqual({
      totalCount: 2,
      dataset: "persist",
      instructionCount: 1,
      tripleCount: 1,
      splitCounts: { train: 1, val: 1, test: 0, unspecified: 0 },
    });
    expect((await fresh.listRecords(1))[0]?.id).toBe("a");
    expect((await fresh.getRecord("b"))?.instruction).toBe("i");
    expect((await writer.hgetall(vectors.keyPrefix + "x")).id).toBe("x");
    expect(await writer.scard(db.indexKey)).toBe(2);
  });

  it("merges cached Redis documents with offline writes/tombstones and reconnects without resurrection", async () => {
    const client = createClient();
    const store = new RedisVectorStore(client, "overlay");
    await store.upsert("kept", new Float32Array([1, 0]));
    await store.upsert("removed", new Float32Array([0, 1]));
    expect(await store.count()).toBe(2);
    client.close();
    await store.upsert("pending", new Float32Array([1, 1]), {
      stage: "offline",
    });
    expect(await store.delete("removed")).toBe(true);
    expect((await store.query(new Float32Array([1, 0]), 5)).map(result => result.id)).toEqual(["kept", "pending"]);
    expect(store.persistenceState.pendingWrites).toBe(2);
    await client.connect();
    expect((await store.sync()).pendingWrites).toBe(0);
    const fresh = new RedisVectorStore(createClient(), "overlay");
    expect(await fresh.count()).toBe(2);
    expect((await fresh.query(new Float32Array([1, 0]), 5)).map(result => result.id)).toEqual(["kept", "pending"]);
    expect(await client.get(store.dimensionKey)).toBe("2");
  });

  it("persists an offline clear before new writes, preserves other namespaces and resets dimensions", async () => {
    const client = createClient();
    const store = new RedisVectorStore(client, "clear");
    const other = new RedisVectorStore(client, "other");
    await store.upsert("old", new Float32Array([1, 0]));
    await other.upsert("keep", new Float32Array([1]));
    client.close();
    await store.clear();
    expect(await store.count()).toBe(0);
    expect(store.persistenceState.clearPending).toBe(true);
    await store.upsert("new", new Float32Array([1, 0, 0]));
    await client.connect();
    expect(await store.sync()).toEqual({
      connected: true,
      pendingWrites: 0,
      clearPending: false,
    });
    const fresh = new RedisVectorStore(createClient(), "clear");
    expect(await fresh.count()).toBe(1);
    expect(fresh.dimensions).toBe(3);
    expect(await other.count()).toBe(1);
    expect(await client.hget(store.keyPrefix + "old", "vec")).toBeNull();
  });

  it("training snapshots reflect external deletion and retain offline updates/clear", async () => {
    const client = createClient();
    const remote = createClient();
    const db = new RedisTrainDb(client, "overlay");
    await db.addInstruction({
      id: "a",
      instruction: "original",
      output: "o",
    });
    await db.addInstruction({ id: "b", instruction: "removed", output: "o" });
    expect((await db.getRecord("b"))?.instruction).toBe("removed");
    await remote.del(db.keyPrefix + "b");
    expect(await db.getRecord("b")).toBeNull();
    expect((await db.getStats()).totalCount).toBe(1); // Orphan index IDs do not inflate records.
    client.close();
    await db.addInstruction({
      id: "a",
      instruction: "offline",
      output: "changed",
    });
    await db.addTriple({ id: "c", query: "q", positive: "p", negative: "n" });
    await client.connect();
    await db.sync();
    const fresh = new RedisTrainDb(createClient(), "overlay");
    expect((await fresh.getRecord("a"))?.instruction).toBe("offline");
    expect((await fresh.getStats()).totalCount).toBe(2);
    client.close();
    await db.clear();
    await db.addInstruction({
      id: "replacement",
      instruction: "new",
      output: "o",
    });
    await client.connect();
    await db.sync();
    expect((await fresh.listRecords()).map(record => record.id)).toEqual(["replacement"]);
  });

  it("rejects cross-client/legacy dimensions and wrong Redis key types without partial writes", async () => {
    const client = createClient();
    const store = new RedisVectorStore(client, "dimension_guard");
    await store.upsert("valid", new Float32Array([1, 0]));
    const wrong = new RedisVectorStore(createClient(), "dimension_guard");
    await expect(wrong.upsert("rejected", new Float32Array([1, 0, 0]))).rejects.toThrow("dimensions");
    expect(wrong.persistenceState.pendingWrites).toBe(0);
    expect(await client.hget(store.keyPrefix + "rejected", "vec")).toBeNull();
    expect(await client.scard(store.indexKey)).toBe(1);

    const legacy = new RedisVectorStore(client, "legacy");
    await client.hset(legacy.keyPrefix + "old", {
      id: "old",
      vec: RedisVectorStore.serializeVector(new Float32Array([1, 0])),
      meta: "{}",
    });
    await client.sadd(legacy.indexKey, "old");
    await expect(legacy.upsert("rejected", new Float32Array([1]))).rejects.toThrow("dimensions");
    expect(await legacy.count()).toBe(1);
    await legacy.upsert("new", new Float32Array([0, 1]));
    expect(await client.get(legacy.dimensionKey)).toBe("2");

    const corruptIndex = new RedisTrainDb(client, "wrongtype");
    await client.set(corruptIndex.indexKey, "protected-marker");
    await expect(
      corruptIndex.addInstruction({
        id: "never",
        instruction: "i",
        output: "o",
      }),
    ).rejects.toThrow("index");
    expect(await client.get(corruptIndex.keyPrefix + "never")).toBeNull();
    expect(await client.get(corruptIndex.indexKey)).toBe("protected-marker");
    expect(corruptIndex.persistenceState.pendingWrites).toBe(0);
    await expect(client.hgetall(corruptIndex.indexKey)).rejects.toThrow("WRONGTYPE");
  });

  it("surfaces corrupt persisted documents instead of returning stale memory", async () => {
    const client = createClient();
    const vectors = new RedisVectorStore(client, "corrupt");
    await vectors.upsert("x", new Float32Array([1]));
    await client.hset(vectors.keyPrefix + "x", "vec", "garbage");
    await expect(vectors.query(new Float32Array([1]))).rejects.toThrow("base64");
    const db = new RedisTrainDb(client, "corrupt");
    await db.addInstruction({ id: "x", instruction: "i", output: "o" });
    await client.set(db.keyPrefix + "x", "not json");
    await expect(db.getRecord("x")).rejects.toThrow();
  });
});
