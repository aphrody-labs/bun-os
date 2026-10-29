// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { A2AClient, A2A_METHODS, TASK_STATE_VALUES, type StreamResponse } from "../src/index.ts";
import {
  A2A_03_PROFILE,
  LEGACY_METHODS,
  LegacyBridge,
  HUB_PROFILE,
  downgradeMessage,
  downgradePart,
  downgradeSendResponse,
  downgradeStreamResponse,
  downgradeTask,
  legacyStateToTaskState,
  taskStateToLegacy,
  upgradeMessage,
  upgradePart,
  upgradePushConfig,
  upgradeRequest,
  type LegacyRpcResponse,
} from "../src/legacy.ts";
import { startFakeAgent, type FakeAgent } from "./fake-agent.ts";

describe("method table", () => {
  test("every legacy method maps to a method of the 1.0 service", () => {
    for (const target of Object.values(LEGACY_METHODS)) {
      expect(target === "agent/card" || (A2A_METHODS as readonly string[]).includes(target)).toBe(true);
    }
    expect(LEGACY_METHODS["message/send"]).toBe("SendMessage");
    expect(LEGACY_METHODS["message/stream"]).toBe("SendStreamingMessage");
    expect(LEGACY_METHODS["tasks/resubscribe"]).toBe("SubscribeToTask");
    expect(LEGACY_METHODS["tasks/update"]).toBe("SendMessage");
  });
});

describe("task states", () => {
  test("legacy spellings and 1.0 names map both ways", () => {
    for (const state of TASK_STATE_VALUES) {
      for (const style of ["kebab", "snake"] as const) {
        expect(legacyStateToTaskState(taskStateToLegacy(state, style))).toBe(state);
      }
    }
    expect(taskStateToLegacy("TASK_STATE_INPUT_REQUIRED", "kebab")).toBe("input-required");
    expect(taskStateToLegacy("TASK_STATE_INPUT_REQUIRED", "snake")).toBe("input_required");
    expect(taskStateToLegacy("TASK_STATE_UNSPECIFIED")).toBe("unknown");
    expect(legacyStateToTaskState("cancelled")).toBe("TASK_STATE_CANCELED");
    expect(legacyStateToTaskState("TASK_STATE_WORKING")).toBe("TASK_STATE_WORKING");
    expect(legacyStateToTaskState("bogus")).toBe("TASK_STATE_UNSPECIFIED");
    expect(legacyStateToTaskState(undefined)).toBe("TASK_STATE_UNSPECIFIED");
  });
});

describe("parts and messages", () => {
  test("kind and type discriminators both upgrade", () => {
    expect(upgradePart({ kind: "text", text: "a" })).toEqual({ text: "a" });
    expect(upgradePart({ type: "text", text: "b", metadata: { m: 1 } })).toEqual({
      text: "b",
      metadata: { m: 1 },
    });
    expect(upgradePart({ type: "data", data: { x: 1 } })).toEqual({
      data: { x: 1 },
      mediaType: "application/json",
    });
    expect(
      upgradePart({
        kind: "file",
        file: { name: "a.png", mimeType: "image/png", bytes: "AAEC" },
      }),
    ).toEqual({
      raw: "AAEC",
      filename: "a.png",
      mediaType: "image/png",
    });
    expect(
      upgradePart({
        kind: "file",
        file: { uri: "https://x/y.pdf", mimeType: "application/pdf" },
      }),
    ).toEqual({
      url: "https://x/y.pdf",
      mediaType: "application/pdf",
    });
    expect(upgradePart({ text: "already 1.0" })).toEqual({
      text: "already 1.0",
    });
  });

  test("malformed parts are rejected", () => {
    expect(() => upgradePart("text")).toThrow(TypeError);
    expect(() => upgradePart({ kind: "video" })).toThrow(/unsupported part kind/);
    expect(() => upgradePart({ kind: "file", file: {} })).toThrow(/bytes or a uri/);
    expect(() => upgradePart({ text: "a", url: "b" })).toThrow(/exactly one/);
  });

  test("roles, ids and routing fields upgrade", () => {
    const message = upgradeMessage(
      {
        role: "agent",
        parts: [{ kind: "text", text: "hi" }],
        taskId: "t1",
        contextId: "c1",
        metadata: { k: "v" },
      },
      { newMessageId: () => "generated" },
    );
    expect(message).toEqual({
      messageId: "generated",
      role: "ROLE_AGENT",
      parts: [{ text: "hi" }],
      taskId: "t1",
      contextId: "c1",
      metadata: { k: "v" },
    });
    expect(
      upgradeMessage({
        role: "system",
        parts: [{ type: "text", text: "s" }],
        messageId: "m",
      }),
    ).toMatchObject({
      role: "ROLE_USER",
      metadata: { legacyRole: "system" },
    });
    expect(() => upgradeMessage({ role: "user", parts: [] })).toThrow(/must not be empty/);
  });

  test("push configs: schemes[] becomes a single scheme", () => {
    expect(
      upgradePushConfig(
        {
          id: "c",
          url: "https://h",
          token: "t",
          authentication: { schemes: ["Bearer", "Basic"], credentials: "x" },
        },
        "task-1",
      ),
    ).toEqual({
      id: "c",
      url: "https://h",
      token: "t",
      taskId: "task-1",
      authentication: { scheme: "Bearer", credentials: "x" },
    });
    expect(() => upgradePushConfig({})).toThrow(/url is required/);
  });
});

describe("request upgrade", () => {
  test("message/send with a message and a 0.3 configuration", () => {
    const call = upgradeRequest("message/send", {
      message: {
        role: "user",
        parts: [{ kind: "text", text: "go" }],
        messageId: "m1",
      },
      configuration: {
        acceptedOutputModes: ["text/plain"],
        historyLength: 3,
        blocking: false,
        pushNotificationConfig: {
          url: "https://h",
          authentication: { schemes: ["Bearer"], credentials: "c" },
        },
      },
      metadata: { trace: "1" },
    });
    expect(call.method).toBe("SendMessage");
    expect(call.params).toEqual({
      message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: "go" }] },
      configuration: {
        acceptedOutputModes: ["text/plain"],
        historyLength: 3,
        returnImmediately: true,
        taskPushNotificationConfig: {
          url: "https://h",
          authentication: { scheme: "Bearer", credentials: "c" },
        },
      },
      metadata: { trace: "1" },
    });
  });

  test("the flat fleet form carries target, sourceAgent and yolo as metadata", () => {
    const call = upgradeRequest(
      "message/send",
      {
        target: "codex",
        sourceAgent: "site-agent",
        instruction: "run it",
        yolo: true,
        data: { a: 1 },
      },
      {
        newMessageId: () => "id",
        peerForTarget: t => (t === "codex" ? "codex" : undefined),
      },
    );
    expect(call.params).toEqual({
      message: {
        messageId: "id",
        role: "ROLE_USER",
        parts: [{ text: "run it" }, { data: { a: 1 }, mediaType: "application/json" }],
      },
      metadata: {
        target: "codex",
        sourceAgent: "site-agent",
        yolo: true,
        aphrody_peer: "codex",
      },
    });
    expect(upgradeRequest("message/send", { target: "rag", instruction: "x" }).params).not.toHaveProperty(
      "metadata.aphrody_peer",
    );
    expect(() => upgradeRequest("message/send", {})).toThrow(/instruction is required/);
  });

  test("hub message metadata (targetAgent, sourceAgent, yolo) is lifted to the request", () => {
    const call = upgradeRequest("message/send", {
      message: {
        role: "user",
        parts: [{ type: "text", text: "x" }],
        metadata: { targetAgent: "ocr", sourceAgent: "bot", yolo: false },
      },
    });
    expect((call.params as { metadata: unknown }).metadata).toEqual({
      target: "ocr",
      sourceAgent: "bot",
      yolo: false,
    });
  });

  test("tasks/update becomes an agent message bound to the task", () => {
    const call = upgradeRequest(
      "tasks/update",
      {
        taskId: "t9",
        sourceAgent: "worker",
        status: "input_required",
        verdict: "INCOMPLET",
        text: "need more",
        data: { q: 1 },
        artifacts: [
          { name: "report", type: "markdown", content: "# R" },
          { name: "blob", type: "json", data: { z: 1 } },
          { name: "src", type: "code", content: "fn main() {}" },
          { name: "dump", type: "file", uri: "file:///d" },
        ],
      },
      { newMessageId: () => "u1" },
    );
    expect(call.method).toBe("SendMessage");
    expect(call.params).toEqual({
      message: {
        messageId: "u1",
        role: "ROLE_AGENT",
        taskId: "t9",
        parts: [
          { text: "need more" },
          { data: { q: 1 }, mediaType: "application/json" },
          {
            text: "# R",
            mediaType: "text/markdown",
            metadata: { artifactName: "report" },
          },
          {
            data: { z: 1 },
            mediaType: "application/json",
            metadata: { artifactName: "blob" },
          },
          {
            text: "fn main() {}",
            mediaType: "text/plain",
            metadata: { artifactName: "src", artifactType: "code" },
          },
          { url: "file:///d", metadata: { artifactName: "dump" } },
        ],
        metadata: {
          legacyMethod: "tasks/update",
          sourceAgent: "worker",
          status: "input-required",
          verdict: "INCOMPLET",
        },
      },
    });
    expect(() => upgradeRequest("tasks/update", { status: "completed" })).toThrow(/Missing taskId/);
  });

  test("task methods upgrade their identifiers and filters", () => {
    expect(upgradeRequest("tasks/get", { taskId: "a", historyLength: 2 }).params).toEqual({
      id: "a",
      historyLength: 2,
    });
    expect(upgradeRequest("tasks/get", { id: "a" }).params).toEqual({
      id: "a",
    });
    expect(upgradeRequest("tasks/cancel", { id: "a" })).toMatchObject({
      method: "CancelTask",
      params: { id: "a" },
    });
    expect(upgradeRequest("tasks/resubscribe", { id: "a" })).toMatchObject({
      method: "SubscribeToTask",
    });
    expect(upgradeRequest("tasks/list", { status: "working", pageSize: 5 }).params).toEqual({
      status: "TASK_STATE_WORKING",
      pageSize: 5,
    });
    expect(() => upgradeRequest("tasks/get", {})).toThrow(/Missing taskId/);
    expect(() => upgradeRequest("tasks/nope", {})).toThrow(RangeError);
  });

  test("push config methods", () => {
    expect(
      upgradeRequest("tasks/pushNotificationConfig/set", {
        taskId: "t",
        pushNotificationConfig: { url: "https://h", id: "c" },
      }),
    ).toMatchObject({
      method: "CreateTaskPushNotificationConfig",
      params: { taskId: "t", id: "c", url: "https://h" },
    });
    expect(
      upgradeRequest("tasks/pushNotificationConfig/get", {
        id: "t",
        pushNotificationConfigId: "c",
      }).params,
    ).toEqual({ taskId: "t", id: "c" });
    expect(
      upgradeRequest("tasks/pushNotificationConfig/delete", {
        taskId: "t",
        id: "c",
      }).params,
    ).toEqual({ taskId: "t", id: "c" });
    expect(upgradeRequest("tasks/pushNotificationConfig/list", { id: "t" }).params).toEqual({
      taskId: "t",
    });
  });
});

describe("response downgrade", () => {
  const task = {
    id: "t1",
    contextId: "c1",
    status: {
      state: "TASK_STATE_INPUT_REQUIRED",
      message: {
        messageId: "m",
        role: "ROLE_AGENT",
        parts: [{ text: "more?" }],
      },
    },
    artifacts: [
      {
        artifactId: "a1",
        name: "out",
        parts: [
          { text: "body" },
          { data: { k: 1 } },
          {
            raw: "AAEC",
            filename: "f.bin",
            mediaType: "application/octet-stream",
          },
        ],
      },
    ],
    history: [{ messageId: "u", role: "ROLE_USER", parts: [{ text: "q" }] }],
    metadata: { verdict: "FAIT" },
  } as const;

  test("A2A 0.3 profile: kind discriminators and kebab states", () => {
    const legacy = downgradeTask(task as never) as any;
    expect(legacy.kind).toBe("task");
    expect(legacy.status.state).toBe("input-required");
    expect(legacy.status.message).toMatchObject({
      kind: "message",
      role: "agent",
      parts: [{ kind: "text", text: "more?" }],
    });
    expect(legacy.artifacts[0].parts).toEqual([
      { kind: "text", text: "body" },
      { kind: "data", data: { k: 1 } },
      {
        kind: "file",
        file: {
          bytes: "AAEC",
          name: "f.bin",
          mimeType: "application/octet-stream",
        },
      },
    ]);
    expect(legacy.history[0].role).toBe("user");
  });

  test("Hub profile: type discriminators and snake states", () => {
    const legacy = downgradeTask(task as never, HUB_PROFILE) as any;
    expect(legacy.kind).toBeUndefined();
    expect(legacy.status.state).toBe("input_required");
    expect(legacy.artifacts[0].parts[0]).toEqual({
      type: "text",
      text: "body",
    });
  });

  test("non-object data parts are wrapped, system role survives", () => {
    expect(downgradePart({ data: [1, 2] })).toEqual({
      kind: "data",
      data: { value: [1, 2] },
    });
    expect(
      downgradeMessage({
        messageId: "m",
        role: "ROLE_USER",
        parts: [{ text: "x" }],
        metadata: { legacyRole: "system" },
      }),
    ).toMatchObject({ role: "system" });
  });

  test("stream events become status-update and artifact-update with a final flag", () => {
    const status = downgradeStreamResponse({
      statusUpdate: {
        taskId: "t",
        contextId: "c",
        status: { state: "TASK_STATE_COMPLETED" },
      },
    }) as any;
    expect(status).toMatchObject({
      kind: "status-update",
      taskId: "t",
      final: true,
      status: { state: "completed" },
    });
    const working = downgradeStreamResponse({
      statusUpdate: {
        taskId: "t",
        contextId: "c",
        status: { state: "TASK_STATE_WORKING" },
      },
    }) as any;
    expect(working.final).toBe(false);
    const artifact = downgradeStreamResponse(
      {
        artifactUpdate: {
          taskId: "t",
          contextId: "c",
          artifact: { artifactId: "a", parts: [{ text: "x" }] },
          append: true,
          lastChunk: true,
        },
      },
      HUB_PROFILE,
    ) as any;
    expect(artifact).toMatchObject({
      type: "artifact-update",
      append: true,
      lastChunk: true,
    });
    expect(() => downgradeStreamResponse({} as StreamResponse)).toThrow(TypeError);
  });

  test("send results: the task itself (0.3) or the hub's { taskId, status, response }", () => {
    const response = { task: task as never };
    expect((downgradeSendResponse(response, A2A_03_PROFILE) as any).kind).toBe("task");
    const hub = downgradeSendResponse(response, HUB_PROFILE) as any;
    expect(hub).toMatchObject({
      taskId: "t1",
      status: "input_required",
      verdict: "FAIT",
    });
    expect(hub.response.parts).toEqual([
      { type: "text", text: "body" },
      { type: "data", data: { k: 1 } },
    ]);
    expect(
      downgradeSendResponse({
        message: {
          messageId: "m",
          role: "ROLE_AGENT",
          parts: [{ text: "hi" }],
        },
      }) as any,
    ).toMatchObject({ kind: "message", role: "agent" });
  });
});

const request = (method: string, params: unknown, id: string | number = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
const ok = (response: LegacyRpcResponse): any => {
  if (!("result" in response)) throw new Error(`expected a result, got ${JSON.stringify(response)}`);
  return response.result;
};
const failure = (response: LegacyRpcResponse) => {
  if (!("error" in response)) throw new Error(`expected an error, got ${JSON.stringify(response)}`);
  return response.error;
};

describe("LegacyBridge over a 1.0 agent", () => {
  let agent: FakeAgent;
  let bridge: LegacyBridge;
  let hub: LegacyBridge;
  beforeAll(async () => {
    agent = startFakeAgent();
    const client = await A2AClient.connect(agent.url);
    bridge = new LegacyBridge(client);
    hub = new LegacyBridge(client, { profile: HUB_PROFILE });
  });
  afterAll(() => agent.stop());

  test("message/send is served by SendMessage and answered with a 0.3 task", async () => {
    const before = agent.requests.length;
    const reply = await bridge.handle(
      request("message/send", { message: { role: "user", parts: [{ kind: "text", text: "hello" }] } }, "abc"),
    );
    expect(reply.id).toBe("abc");
    const task = ok(reply);
    expect(task).toMatchObject({
      kind: "task",
      status: { state: "completed" },
    });
    expect(task.artifacts[0].parts[0]).toEqual({
      kind: "text",
      text: "echo: hello",
      mediaType: undefined,
    });
    const sent = agent.requests.slice(before).find(r => r.method === "POST")!;
    expect((sent.body as any).method).toBe("SendMessage");
    expect((sent.body as any).params.message.role).toBe("ROLE_USER");
    expect(sent.headers.get("a2a-version")).toBe("1.0");
  });

  test("the hub profile answers { taskId, status, response }", async () => {
    const reply = ok(
      await hub.handle(
        request("message/send", {
          target: "rag",
          sourceAgent: "site",
          instruction: "ask",
        }),
      ),
    );
    expect(reply.status).toBe("completed");
    expect(reply.taskId).toBeTruthy();
    expect(reply.response.parts[0]).toEqual({
      type: "text",
      text: "echo: ask",
    });
    expect(reply.task.id).toBe(reply.taskId);
  });

  test("a direct agent message answers a message", async () => {
    const reply = ok(
      await bridge.handle(
        request("message/send", {
          message: { role: "user", parts: [{ kind: "text", text: "message" }] },
        }),
      ),
    );
    expect(reply).toMatchObject({
      kind: "message",
      role: "agent",
      parts: [{ kind: "text", text: "direct reply" }],
    });
  });

  test("tasks/get, tasks/list and tasks/cancel", async () => {
    const created = ok(
      await bridge.handle(
        request("message/send", {
          message: { role: "user", parts: [{ kind: "text", text: "x" }] },
          configuration: { blocking: false },
        }),
      ),
    );
    expect(created.status.state).toBe("working");
    expect(ok(await bridge.handle(request("tasks/get", { id: created.id }))).id).toBe(created.id);
    const listed = ok(await bridge.handle(request("tasks/list", { status: "working" })));
    expect(listed.tasks.some((t: { id: string }) => t.id === created.id)).toBe(true);
    expect(listed.total).toBe(listed.tasks.length);
    expect(ok(await bridge.handle(request("tasks/cancel", { id: created.id }))).status.state).toBe("canceled");
    expect(failure(await bridge.handle(request("tasks/cancel", { id: created.id }))).code).toBe(-32002);
    expect(listed.tasks.every((t: { kind: string }) => t.kind === "task")).toBe(true);
  });

  test("tasks/list with a target keeps the tasks the executor tagged with it", async () => {
    await bridge.handle(request("message/send", { target: "ocr", instruction: "tagged" }));
    const all = ok(await bridge.handle(request("tasks/list", {})));
    const tagged = ok(await bridge.handle(request("tasks/list", { target: "ocr" })));
    expect(tagged.total).toBeLessThan(all.total);
    expect(tagged.tasks.every((t: any) => t.metadata?.target === "ocr")).toBe(true);
    expect(tagged.total).toBeGreaterThanOrEqual(1);
  });

  test("tasks/update binds a worker report to its task", async () => {
    const created = ok(
      await bridge.handle(
        request("message/send", {
          target: "codex",
          instruction: "work",
          configuration: { blocking: false },
        }),
      ),
    );
    const before = agent.requests.length;
    const updated = ok(
      await hub.handle(
        request("tasks/update", {
          taskId: created.id,
          sourceAgent: "codex",
          status: "completed",
          verdict: "FAIT",
          text: "done",
        }),
      ),
    );
    expect(updated.taskId).toBe(created.id);
    const sent = agent.requests.slice(before).find(r => r.method === "POST")!;
    expect((sent.body as any).params.message).toMatchObject({
      role: "ROLE_AGENT",
      taskId: created.id,
      parts: [{ text: "done" }],
      metadata: {
        legacyMethod: "tasks/update",
        sourceAgent: "codex",
        status: "completed",
        verdict: "FAIT",
      },
    });
  });

  test("message/stream and tasks/resubscribe stream legacy events as JSON-RPC responses", async () => {
    const events: LegacyRpcResponse[] = [];
    for await (const event of bridge.handleStream(
      request("message/stream", { message: { role: "user", parts: [{ kind: "text", text: "s" }] } }, 7),
    ))
      events.push(event);
    expect(events.every(e => e.id === 7 && "result" in e)).toBe(true);
    const kinds = events.map(e => (ok(e) as { kind: string }).kind);
    expect(kinds).toEqual(["task", "status-update", "artifact-update", "artifact-update", "status-update"]);
    expect(ok(events.at(-1)!)).toMatchObject({
      final: true,
      status: { state: "completed" },
    });

    const created = ok(
      await bridge.handle(
        request("message/send", {
          message: { role: "user", parts: [{ kind: "text", text: "w" }] },
          configuration: { blocking: false },
        }),
      ),
    );
    const resub: LegacyRpcResponse[] = [];
    for await (const event of bridge.handleStream(request("tasks/resubscribe", { id: created.id }))) resub.push(event);
    expect(resub.map(e => (ok(e) as { kind: string }).kind)).toEqual(["task", "status-update"]);
  });

  test("push notification config methods round-trip in the legacy shape", async () => {
    const created = ok(
      await bridge.handle(
        request("message/send", {
          message: { role: "user", parts: [{ kind: "text", text: "p" }] },
        }),
      ),
    );
    const set = ok(
      await bridge.handle(
        request("tasks/pushNotificationConfig/set", {
          taskId: created.id,
          pushNotificationConfig: {
            url: "https://h/hook",
            token: "t",
            authentication: { schemes: ["Bearer"], credentials: "c" },
          },
        }),
      ),
    );
    expect(set).toMatchObject({
      taskId: created.id,
      pushNotificationConfig: {
        url: "https://h/hook",
        token: "t",
        authentication: { schemes: ["Bearer"], credentials: "c" },
      },
    });
    const configId = set.pushNotificationConfig.id;
    expect(
      ok(
        await bridge.handle(
          request("tasks/pushNotificationConfig/get", {
            id: created.id,
            pushNotificationConfigId: configId,
          }),
        ),
      ).pushNotificationConfig.id,
    ).toBe(configId);
    expect(ok(await bridge.handle(request("tasks/pushNotificationConfig/list", { id: created.id })))).toHaveLength(1);
    expect(
      ok(
        await bridge.handle(
          request("tasks/pushNotificationConfig/delete", {
            id: created.id,
            pushNotificationConfigId: configId,
          }),
        ),
      ),
    ).toEqual({});
    expect(ok(await bridge.handle(request("tasks/pushNotificationConfig/list", { id: created.id })))).toEqual([]);
  });

  test("agent/card and the authenticated extended card keep the pre-1.0 transport members", async () => {
    const card = ok(await bridge.handle(request("agent/card", {})));
    expect(card).toMatchObject({
      name: "Fake Agent",
      url: `${agent.url}/rpc`,
      preferredTransport: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card.additionalInterfaces).toEqual([{ url: `${agent.url}/rest`, transport: "HTTP+JSON" }]);
    expect(card.supportsAuthenticatedExtendedCard).toBe(true);
    expect(ok(await bridge.handle(request("agent/getAuthenticatedExtendedCard", {}))).description).toBe("extended");
  });

  test("errors keep their A2A codes; protocol faults use JSON-RPC codes", async () => {
    const missing = failure(await bridge.handle(request("tasks/get", { id: "ghost" })));
    expect(missing.code).toBe(-32001);
    expect(missing.message).toContain("ghost");
    expect(Array.isArray(missing.data)).toBe(true);
    expect(
      failure(
        await bridge.handle(
          request("message/send", {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "fail:CONTENT_TYPE_NOT_SUPPORTED" }],
            },
          }),
        ),
      ).code,
    ).toBe(-32005);
    expect(failure(await bridge.handle(request("tasks/nope", {}))).code).toBe(-32601);
    expect(failure(await bridge.handle(request("tasks/get", {}))).code).toBe(-32602);
    expect(failure(await bridge.handle(request("message/send", { message: { role: "user", parts: [] } }))).code).toBe(
      -32602,
    );
    expect(failure(await bridge.handle(null)).code).toBe(-32600);
    expect(failure(await bridge.handle({ jsonrpc: "1.0", id: 1, method: "tasks/get" })).code).toBe(-32600);
    expect(failure(await bridge.handle(request("message/stream", {}))).code).toBe(-32600);
    const wrongMode: LegacyRpcResponse[] = [];
    for await (const event of bridge.handleStream(request("tasks/get", { id: "x" }))) wrongMode.push(event);
    expect(failure(wrongMode[0]!).code).toBe(-32600);
  });

  test("an unreachable upstream is an internal error, never a throw", async () => {
    const dead = new LegacyBridge(new A2AClient({ url: "http://127.0.0.1:1/rpc", timeoutMs: 2000 }));
    const reply = await dead.handle(request("tasks/get", { id: "x" }));
    expect(failure(reply).code).toBe(-32603);
    expect(failure(reply).message).toContain("Internal error");
  });

  test("isStreaming tells the two handlers apart", () => {
    expect(bridge.isStreaming(request("message/stream", {}))).toBe(true);
    expect(bridge.isStreaming(request("tasks/resubscribe", {}))).toBe(true);
    expect(bridge.isStreaming(request("message/send", {}))).toBe(false);
    expect(bridge.isStreaming("nope")).toBe(false);
  });
});
