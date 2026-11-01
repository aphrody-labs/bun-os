import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, ToolExecutionContext, TOOLS } from "../src/tools/registry";
import { callTool } from "../src/tools/host";
import { NativeRedisClient } from "../src/redis/client";
import { createApiServer } from "../src/server/http";
import { buildOpenApiSpec } from "../src/server/openapi";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-core-transport-"));
  const redis = new NativeRedisClient({ offline: true });
  const context = new ToolExecutionContext({ redisClient: redis });
  return {
    root,
    context,
    cleanup() {
      context.close();
      redis.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("shared native tool transports", () => {
  it("retrieves actual indexed records over MCP and HTTP without fake embeddings", async () => {
    const f = fixture();
    const server = createApiServer({
      port: 0,
      rootDir: f.root,
      toolContext: f.context,
    });
    try {
      await f.context.vectorStore("docs").upsert("native", new Float32Array([1, 0]), { category: "bun" });
      await f.context.vectorStore("docs").upsert("other", new Float32Array([0, 1]), { category: "python" });
      await f.context.trainDb("examples").addInstruction({
        id: "one",
        instruction: "hello",
        output: "world",
        split: "val",
      });
      const response = await callTool(
        "yolo_vector_search",
        { namespace: "docs", queryVector: [1, 0], filter: { category: "bun" } },
        f.root,
        f.context,
      );
      expect(JSON.parse(response.content[0]!.text).results).toEqual([
        { id: "native", score: 1, metadata: { category: "bun" } },
      ]);
      const stats = await fetch(`http://127.0.0.1:${server.port}/api/tools/call`, {
        method: "POST",
        body: JSON.stringify({
          name: "yolo_traindb_stats",
          arguments: { dataset: "examples" },
        }),
      });
      expect(stats.status).toBe(200);
      expect((await stats.json()).totalCount).toBe(1);
      await expect(
        executeTool("yolo_vector_search", { query: "native", namespace: "docs" }, f.root, f.context),
      ).rejects.toThrow("No embedding provider");
    } finally {
      await server.stop(true);
      f.cleanup();
    }
  });

  it("uses an explicitly supplied embedding provider", async () => {
    const redis = new NativeRedisClient({ offline: true });
    const context = new ToolExecutionContext({
      redisClient: redis,
      embed: async text => {
        expect(text).toBe("question");
        return new Float32Array([1, 0]);
      },
    });
    try {
      await context.vectorStore().upsert("answer", new Float32Array([1, 0]));
      const result = (await executeTool("yolo_vector_search", { query: "question" }, ".", context)) as {
        results: Array<{ id: string }>;
      };
      expect(result.results[0]?.id).toBe("answer");
    } finally {
      context.close();
      redis.close();
    }
  });

  it("rejects invalid tool arguments", async () => {
    const f = fixture();
    try {
      await Promise.all(
        [{ parallel: 0 }, { parallel: 1.5 }, { parallel: Infinity }, { path: [] }, { unknown: true }].map(args =>
          expect(executeTool("yolo_scan", args, f.root, f.context)).rejects.toThrow(),
        ),
      );
      await expect(executeTool("yolo_verify", { only: "missing-gate" }, f.root, f.context)).rejects.toThrow(
        "Unknown gates",
      );
      const result = await callTool("yolo_status", { unknown: true }, f.root, f.context);
      expect(result.isError).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  it("serves the canonical schema and contains paths across all HTTP routes", async () => {
    const f = fixture();
    const external = mkdtempSync(join(tmpdir(), "yolo-core-outside-"));
    writeFileSync(join(external, "private.ts"), "export const secret = 1;");
    symlinkSync(external, join(f.root, "escape"));
    const server = createApiServer({
      port: 0,
      rootDir: f.root,
      toolContext: f.context,
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const spec = await (await fetch(`${base}/api/openapi.json`)).json();
      expect(spec).toEqual(buildOpenApiSpec(spec.info.version, Bun.version));
      expect(spec.paths["/api/tools/call"].post.requestBody.content["application/json"].schema.oneOf.length).toBe(
        TOOLS.length,
      );
      await Promise.all(
        ["{", "null", "[]", '{"parallel":0}'].map(async body =>
          expect((await fetch(`${base}/api/scan`, { method: "POST", body })).status).toBe(400),
        ),
      );
      await Promise.all(
        ["yolo_scan", "yolo_parse", "yolo_host_space"].map(async name => {
          const args = name === "yolo_host_space" ? { dir: "escape" } : { path: "escape/private.ts" };
          const response = await fetch(`${base}/api/tools/call`, {
            method: "POST",
            body: JSON.stringify({ name, arguments: args }),
          });
          expect(response.status).toBe(400);
          expect((await response.json()).error).toContain("Path traversal denied");
        }),
      );
      expect((await fetch(`${base}/api/parse`, { method: "POST", body: "{}" })).status).toBe(400);
      expect((await fetch(`${base}/api/bench?iterations=NaN`)).status).toBe(400);
      const cors = await fetch(`${base}/health`, {
        headers: { Origin: "http://localhost:3000@evil.example" },
      });
      expect(cors.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await server.stop(true);
      f.cleanup();
      rmSync(external, { recursive: true, force: true });
    }
  });
});
