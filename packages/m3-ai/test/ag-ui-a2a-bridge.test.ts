// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  EventType,
  type BaseEvent,
  type TextMessageContentEvent,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallResultEvent,
  type ReasoningMessageContentEvent,
  type SubagentStartedEvent,
  type SubagentFinishedEvent,
} from "../src/ag-ui";
import {
  AgUiEventAccumulator,
  agUiEventsToTranscriptItems,
  coordEnvelopeToAgUiEvent,
  agUiEventToCoordEnvelope,
  type CoordEnvelope,
} from "../src/AgUiEventStream";

describe("AgUiEventStream: Accumulator & A2U Bridge", () => {
  it("accumulates streamed text chunks into a unified transcript step", () => {
    const acc = new AgUiEventAccumulator();

    acc.push({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg_1",
      role: "assistant",
    } as BaseEvent);

    acc.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_1",
      delta: "Hello ",
    } as TextMessageContentEvent);

    acc.push({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg_1",
      delta: "world from AG-UI!",
    } as TextMessageContentEvent);

    acc.push({
      type: EventType.TEXT_MESSAGE_END,
      messageId: "msg_1",
    } as BaseEvent);

    acc.push({
      type: EventType.RUN_FINISHED,
    } as BaseEvent);

    const snapshot = acc.snapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.steps.length).toBe(1);
    expect(snapshot.steps[0].type).toBe("action");

    const items = snapshot.items;
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("text");
    if (items[0].kind === "text") {
      expect(items[0].text).toBe("Hello world from AG-UI!");
    }
  });

  it("pairs streamed tool calls and results cleanly", () => {
    const events: BaseEvent[] = [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "call_abc",
        toolCallName: "readFile",
      } as ToolCallStartEvent,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "call_abc",
        delta: '{"path": "Cargo.toml"}',
      } as ToolCallArgsEvent,
      {
        type: EventType.TOOL_CALL_END,
        toolCallId: "call_abc",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call_abc",
        toolCallName: "readFile",
        content: '{"status":"ok","content":"[package]"}',
      } as ToolCallResultEvent,
      {
        type: EventType.RUN_FINISHED,
      } as BaseEvent,
    ];

    const items = agUiEventsToTranscriptItems(events);
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("tool");

    if (items[0].kind === "tool") {
      expect(items[0].pair.id).toBe("call_abc");
      expect(items[0].pair.name).toBe("readFile");
      expect(items[0].pair.status).toBe("completed");
      expect(items[0].pair.args?.path).toBe("Cargo.toml");
      expect(items[0].pair.result?.status).toBe("ok");
    }
  });

  it("accumulates reasoning and thinking tokens", () => {
    const acc = new AgUiEventAccumulator();

    acc.push({
      type: EventType.REASONING_MESSAGE_START,
      messageId: "r_1",
    } as BaseEvent);

    acc.push({
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "r_1",
      delta: "Thinking through ",
    } as ReasoningMessageContentEvent);

    acc.push({
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "r_1",
      delta: "architecture and design...",
    } as ReasoningMessageContentEvent);

    const snapshot = acc.snapshot();
    expect(snapshot.reasoning).toBe("Thinking through architecture and design...");
  });

  it("tracks subagent invocations and lifecycle", () => {
    const acc = new AgUiEventAccumulator();

    acc.push({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: "sub_101",
      subagentName: "Codebase Researcher",
    } as SubagentStartedEvent);

    let snap = acc.snapshot();
    expect(snap.subagents.length).toBe(1);
    expect(snap.subagents[0].id).toBe("sub_101");
    expect(snap.subagents[0].status).toBe("running");

    acc.push({
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: "sub_101",
    } as SubagentFinishedEvent);

    snap = acc.snapshot();
    expect(snap.subagents[0].status).toBe("completed");
  });

  it("tracks declarative A2UI surfaces from tool results", () => {
    const acc = new AgUiEventAccumulator();

    acc.push({
      type: EventType.TOOL_CALL_START,
      toolCallId: "a2ui_call",
      toolCallName: "render_dashboard",
    } as ToolCallStartEvent);

    acc.push({
      type: EventType.TOOL_CALL_END,
      toolCallId: "a2ui_call",
    } as BaseEvent);

    acc.push({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "a2ui_call",
      toolCallName: "render_dashboard",
      content: {
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: { surfaceId: "surface_main", catalogId: "basic" },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "surface_main",
              components: [{ id: "btn_1", type: "Button", props: { label: "Deploy" } }],
            },
          },
          {
            version: "v0.9",
            updateDataModel: {
              surfaceId: "surface_main",
              value: { counter: 42 },
            },
          },
        ],
      },
    } as any);

    const snap = acc.snapshot();
    expect(snap.a2uiSurfaces.has("surface_main")).toBe(true);
    const surface = snap.a2uiSurfaces.get("surface_main") as any;
    expect(surface.surfaceId).toBe("surface_main");
    expect(surface.components.length).toBe(1);
    expect(surface.dataModel.counter).toBe(42);
  });
});

describe("AgUiEventStream: A2A Fleet Envelope Bidirectional Bridge", () => {
  it("bridges CoordEnvelope ask into AG-UI custom event and back", () => {
    const envelope: CoordEnvelope = {
      v: 1,
      ts: "2026-10-03T01:00:00.000Z",
      id: "env-test-1",
      from: "agy",
      to: "codex",
      kind: "ask",
      topic: "cargo-check",
      body: "Verify serialization in crates/os/kernel/comps/a2a-coord",
      channel_hint: ["rust", "serial"],
      re: "env-parent-0",
    };

    const agUiEvent = coordEnvelopeToAgUiEvent(envelope);
    expect(agUiEvent.type).toBe(EventType.CUSTOM);
    expect((agUiEvent as any).name).toBe("a2a_ask");
    expect((agUiEvent as any).value.topic).toBe("cargo-check");

    const roundtrip = agUiEventToCoordEnvelope(agUiEvent, "agy", "codex");
    expect(roundtrip.kind).toBe("ask");
    expect(roundtrip.topic).toBe("cargo-check");
    expect(roundtrip.body).toBe("Verify serialization in crates/os/kernel/comps/a2a-coord");
    expect(roundtrip.re).toBe("env-parent-0");
    expect(roundtrip.channel_hint).toEqual(["rust", "serial"]);
  });

  it("bridges error envelopes into RUN_ERROR events", () => {
    const errorEnvelope: CoordEnvelope = {
      v: 1,
      ts: "2026-10-03T01:00:00.000Z",
      id: "env-err-99",
      from: "rag-agent",
      to: "agy",
      kind: "error",
      topic: "rag-timeout",
      body: "Vector index lock timed out after 30s",
    };

    const event = coordEnvelopeToAgUiEvent(errorEnvelope);
    expect(event.type).toBe(EventType.RUN_ERROR);
    expect((event as any).message).toBe("Vector index lock timed out after 30s");

    const backToEnv = agUiEventToCoordEnvelope(event, "rag-agent", "agy");
    expect(backToEnv.kind).toBe("error");
    expect(backToEnv.body).toBe("Vector index lock timed out after 30s");
  });
});
