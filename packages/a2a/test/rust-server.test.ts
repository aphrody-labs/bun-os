// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- readiness polling and stream consumers are sequential. */
/**
 * Conformance of the client against the real Rust A2A server (`aphrody a2a serve`, crates
 * `aphrody-a2a-server` and `aphrody-a2a-coord`), run in dry-run mode so no peer CLI is invoked.
 * Skipped when the `aphrody` binary is not on PATH.
 *
 * Divergences of the installed binary from the A2A 1.0 specification are asserted loosely and
 * marked "DIVERGENCE". The two error-code ones are fixed in the Rust sources (aphrody-a2a and
 * aphrody-a2a-server, `Unreleased` changelog entries); tighten them once the binary is rebuilt.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  A2AClient,
  A2AError,
  JsonRpcTransport,
  collectStream,
  responseText,
  sendMessageRequest,
  type SupportedBinding,
} from "../src/index.ts";
import { LegacyBridge } from "../src/legacy.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const binary = Bun.which("aphrody");

async function freePort(): Promise<number> {
  const probe = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(""),
  });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

async function waitReady(url: string, process: { exitCode: number | null }): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`aphrody a2a serve exited with ${process.exitCode}`);
    try {
      if ((await fetch(`${url}/ping`)).ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  throw new Error("aphrody a2a serve did not become ready");
}

describe.skipIf(!binary || !existsSync(join(repoRoot, "ai.json")))(
  "Rust A2A server (aphrody a2a serve, dry run)",
  () => {
    let dir: string;
    let server: ReturnType<typeof Bun.spawn>;
    let url: string;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "a2a-rust-"));
      copyFileSync(join(repoRoot, "ai.json"), join(dir, "ai.json"));
      const port = await freePort();
      url = `http://127.0.0.1:${port}`;
      server = Bun.spawn([binary as string, "a2a", "serve", "--bind", `127.0.0.1:${port}`], {
        windowsHide: true,
        cwd: dir,
        env: {
          ...process.env,
          APHRODY_A2A_DRY_RUN: "1",
          COORD_DIR: join(dir, ".coord"),
        },
        stdout: "ignore",
        stderr: "ignore",
      });
      await waitReady(url, server);
    }, 30_000);

    afterAll(async () => {
      server?.kill();
      if (server) await server.exited;
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    test("the card is discoverable and declares the JSON-RPC 1.0 interface", async () => {
      const client = await A2AClient.connect(url);
      expect(client.card?.name).toBe("aphrody");
      expect(client.binding).toBe("JSONRPC");
      expect(client.card?.supportedInterfaces[0]?.protocolVersion).toBe("1.0");
      expect(client.capabilities.streaming).toBe(true);
      expect(client.card?.skills.length).toBeGreaterThan(0);
    });

    describe.each<SupportedBinding>(["JSONRPC", "HTTP+JSON"])("%s binding", binding => {
      // The REST routes are served at the root, next to the JSON-RPC endpoint: build the client by URL.
      const make = () => new A2AClient({ url, binding });

      test("sendMessage routes by the @peer prefix and returns a completed task", async () => {
        const response = await make().sendMessage("@claude: hello from the TypeScript client");
        expect(response.task?.status.state).toBe("TASK_STATE_COMPLETED");
        expect(response.task?.metadata?.aphrody_peer).toBe("claude");
        expect(responseText(response)).toContain("[dry-run] would invoke claude");
        expect(response.task?.history?.[0]?.parts[0]?.text).toBe("@claude: hello from the TypeScript client");
      });

      test("getTask and listTasks see the task; an unknown id is TASK_NOT_FOUND", async () => {
        const client = make();
        const { task } = await client.sendMessage("@claude: list me");
        expect((await client.getTask(task!.id)).id).toBe(task!.id);
        const page = await client.listTasks({
          pageSize: 100,
          status: "TASK_STATE_COMPLETED",
        });
        expect(page.tasks.some(t => t.id === task!.id)).toBe(true);
        expect(page.totalSize).toBeGreaterThanOrEqual(1);
        const missing = (await client.getTask("no-such-task").catch((e: unknown) => e)) as A2AError;
        expect(missing).toBeInstanceOf(A2AError);
        expect(missing.reason).toBe("TASK_NOT_FOUND");
        expect(missing.domain).toBe("a2a-protocol.org");
      });

      test("cancelTask on a finished task is TASK_NOT_CANCELABLE", async () => {
        const client = make();
        const { task } = await client.sendMessage("@claude: cancel me");
        const error = (await client.cancelTask(task!.id).catch((e: unknown) => e)) as A2AError;
        expect(error.reason).toBe("TASK_NOT_CANCELABLE");
        expect(error.code).toBe(-32002);
      });

      test("sendStreamingMessage ends on the completed task", async () => {
        const final = await collectStream(make().sendStreamingMessage("@claude: stream"));
        expect(final?.task?.status.state).toBe("TASK_STATE_COMPLETED");
        expect(responseText(final!)).toContain("[dry-run]");
      });

      test("subscribeToTask on a finished task is refused", async () => {
        const client = make();
        const { task } = await client.sendMessage("@claude: subscribe");
        const refused = (await (async () => {
          for await (const _ of client.subscribeToTask(task!.id));
        })().catch((e: unknown) => e)) as A2AError;
        expect(refused).toBeInstanceOf(A2AError);
        // DIVERGENCE (installed binary): the spec requires UNSUPPORTED_OPERATION for a terminal
        // task; binaries built before the fix answer TASK_NOT_FOUND.
        expect(["UNSUPPORTED_OPERATION", "TASK_NOT_FOUND"]).toContain(refused.reason as string);
      });

      test("push notifications are declared unsupported", async () => {
        const client = make();
        const { task } = await client.sendMessage("@claude: push");
        const error = (await client
          .createPushNotificationConfig({
            taskId: task!.id,
            url: "https://hooks.example/a2a",
          })
          .catch((e: unknown) => e)) as A2AError;
        expect(error.reason).toBe("PUSH_NOTIFICATION_NOT_SUPPORTED");
      });

      test("the extended card is not configured", async () => {
        const error = (await make()
          .getExtendedAgentCard()
          .catch((e: unknown) => e)) as A2AError;
        expect(error).toBeInstanceOf(A2AError);
        // DIVERGENCE (installed binary): the spec code is -32007 EXTENDED_AGENT_CARD_NOT_CONFIGURED;
        // binaries built before the fix send -32004 UNSUPPORTED_OPERATION.
        expect([-32007, -32004]).toContain(error.code);
      });
    });

    test("an unknown or pre-1.0 JSON-RPC method is METHOD_NOT_FOUND", async () => {
      const transport = new JsonRpcTransport({ url });
      const error = (await transport.call("message/send" as never, {} as never).catch((e: unknown) => e)) as A2AError;
      expect(error.code).toBe(-32601);
      expect(error.reason).toBe("METHOD_NOT_FOUND");
    });

    test("the legacy bridge turns a pre-1.0 message/send into SendMessage and back", async () => {
      const bridge = new LegacyBridge(await A2AClient.connect(url));
      const reply = await bridge.handle({
        jsonrpc: "2.0",
        id: "legacy-1",
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: "@claude: legacy hello" }],
          },
        },
      });
      if (!("result" in reply)) throw new Error(`unexpected error: ${JSON.stringify(reply)}`);
      const task = reply.result as {
        kind: string;
        id: string;
        status: { state: string };
        history: { role: string }[];
      };
      expect(reply.id).toBe("legacy-1");
      expect(task.kind).toBe("task");
      expect(task.status.state).toBe("completed");
      expect(task.history[0]?.role).toBe("user");

      const fetched = await bridge.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: task.id },
      });
      expect("result" in fetched && (fetched.result as { id: string }).id).toBe(task.id);
      const missing = await bridge.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "tasks/get",
        params: { id: "nope" },
      });
      expect("error" in missing && missing.error.code).toBe(-32001);

      const events = [];
      for await (const event of bridge.handleStream({
        jsonrpc: "2.0",
        id: 4,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: "@claude: legacy stream" }],
          },
        },
      })) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);
      expect(events.every(e => "result" in e)).toBe(true);
    });

    test("sendMessageRequest options reach the executor as request metadata", async () => {
      const client = new A2AClient({ url });
      const response = await client.sendMessage(
        sendMessageRequest("anything", {
          requestMetadata: { aphrody_peer: "agy" },
        }),
      );
      expect(response.task?.metadata?.aphrody_peer).toBe("agy");
    });
  },
);
