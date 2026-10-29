// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { BunDecisionBridge, type NativeDecisionOptions } from "../src/aphrody/decision/bridge";

const selected =
  process.env.BUN_YOLO_NATIVE_GATE === "1" &&
  process.env.BUN_PYTHON_HOST_LIBRARY &&
  process.env.BUN_PYTHON_LIBPYTHON &&
  process.env.BUN_DECISION_RUNTIME_DIRECTORY &&
  process.env.BUN_YOLO_EXECUTABLE &&
  process.env.BUN_YOLO_REVISION;

async function digest(path: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

test.skipIf(!selected)(
  "one real CPython host delegates sequential scoped decisions to the installed SDK",
  async () => {
    const { Python } = await import("@aphrody/runtime-sdk/python");
    const configuration: NativeDecisionOptions = {
      runtime: {
        directory: process.env.BUN_DECISION_RUNTIME_DIRECTORY!,
        manifestSha256: await digest(
          process.env.BUN_DECISION_RUNTIME_DIRECTORY! + "/manifest.json",
        ),
      },
      bun: {
        executable: process.env.BUN_YOLO_EXECUTABLE!,
        sha256: await digest(process.env.BUN_YOLO_EXECUTABLE!),
        revision: process.env.BUN_YOLO_REVISION!,
      },
    };
    await using python = await Python.async({
      libraryPath: process.env.BUN_PYTHON_HOST_LIBRARY,
      libpython: process.env.BUN_PYTHON_LIBPYTHON,
    });
    expect(await python.eval("__import__('os').getpid()")).toBe(String(process.pid));
    const paths = await python.evalJSON<string[]>(
      "[__import__('bun_yolo').__file__, __import__('yolo_runtime').__file__]",
    );
    expect(
      paths.every((path) => !path.toLowerCase().replaceAll("\\", "/").startsWith("c:/bun/")),
    ).toBe(true);
    async function verifyUsage(usage: null | { input_tokens: number; output_tokens: number }) {
      const provider = {
        kind: "code" as const,
        response: {
          model: "synthetic-fixture",
          usage,
          answers: {
            action: {
              type: "choice",
              choice: "read",
              confidence: 0.6,
              probabilities: { read: 0.6, search: 0.4 },
            },
          },
        },
      };
      await using bridge = new BunDecisionBridge(python, { ...configuration, provider });
      const result = JSON.parse(
        await bridge.decideJson(
          JSON.stringify({
            goal: "Inspect the supplied synthetic catalogue",
            model: "synthetic-fixture",
            minimum_confidence: 0.8,
            deadline_seconds: 5.0,
            actions: [
              { id: "read", description: "Read source" },
              { id: "search", description: "Search graph" },
            ],
          }),
        ),
      );
      expect(result.action_id).toBeNull();
      expect(result.status).toBe("abstained");
      expect(result.confidence).toBe(0.6);
      expect(result.usage).toEqual(usage);
      expect(result.executed).toBe(false);
    }
    await verifyUsage(null);
    await verifyUsage({ input_tokens: 12, output_tokens: 3 });
    expect(await python.eval("__import__('os').getpid()")).toBe(String(process.pid));
    await using wrong = new BunDecisionBridge(python, {
      ...configuration,
      bun: { ...configuration.bun, sha256: "0".repeat(64) },
    });
    let rejected: Error | undefined;
    try {
      await wrong.decideJson(
        JSON.stringify({
          goal: "Synthetic invalid pin",
          model: "synthetic-fixture",
          actions: [
            { id: "read", description: "Read" },
            { id: "search", description: "Search" },
          ],
        }),
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      rejected = error;
    }
    expect(rejected?.message).toContain("ERR_DECISION_ARTIFACT_HASH");
    // The SDK supervisor must stop and join a stalled provider before disposal
    // completes. The fixture uses only loopback and an explicit public test key.
    await python.run("import os\nos.environ['TYPESAFE_API_KEY'] = 'public-fixture-key'\n");
    const release = Promise.withResolvers<Response>();
    let requested = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requested = request.headers.get("authorization") === "Bearer public-fixture-key";
        return release.promise;
      },
    });
    try {
      await using stalled = new BunDecisionBridge(python, {
        ...configuration,
        provider: { kind: "jev", baseURL: server.url.href },
      });
      const started = performance.now();
      const pending = stalled.decideJson(
        JSON.stringify({
          goal: "Synthetic stalled loopback provider",
          model: "synthetic-fixture",
          deadline_seconds: 1.5,
          actions: [
            { id: "read", description: "Read" },
            { id: "search", description: "Search" },
          ],
        }),
      );
      const closing = stalled.close();
      let deadline: Error | undefined;
      try {
        await pending;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        deadline = error;
      }
      await closing;
      expect(requested).toBe(true);
      expect(deadline?.message).toContain("ERR_DECISION_DEADLINE");
      expect(performance.now() - started).toBeLessThan(5000);
      expect(await python.eval("__import__('os').getpid()")).toBe(String(process.pid));
    } finally {
      release.resolve(new Response(null, { status: 499 }));
      await server.stop(true);
    }
  },
  25000,
);
