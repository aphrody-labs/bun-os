// SPDX-License-Identifier: Apache-2.0
// Streaming client of an OpenAI-compatible `/v1/chat/completions` endpoint (llama-server,
// vLLM, the Aphrody gateway...): SSE framing, chunk decoding, tool-call accumulation, a pure
// reducer for the conversation state, and typed errors that tell "model unavailable" apart.
// Pure module: no React, no DOM; `fetch` is injectable.

import type { Citation } from "./citations";

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** One complete tool call, as OpenAI returns it once every delta is merged. */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message of the conversation, in the shape the chat components render. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** `reasoning_content` deltas (reasoning models), kept apart from the answer. */
  reasoning?: string;
  toolCalls?: OpenAIToolCall[];
  /** For a `tool` message: the call it answers. */
  toolCallId?: string;
  finishReason?: string | null;
  /** Grounded answer: the numbered passages `[n]` the text refers to. */
  citations?: Citation[];
  /** The backend refused to answer (out of the sources' scope). */
  refusal?: boolean;
}

/** What one SSE chunk contributes. */
export type ChatStreamEvent =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "citations"; citations: Citation[] }
  | { type: "refusal"; text?: string }
  | { type: "finish"; reason: string }
  | { type: "done" };

export type ChatStreamErrorKind = "network" | "http" | "aborted" | "parse" | "stream";

/** Typed failure of a chat request. `unavailable` marks a model that cannot answer right now. */
export class ChatStreamError extends Error {
  readonly kind: ChatStreamErrorKind;
  readonly status?: number;
  readonly unavailable: boolean;

  constructor(kind: ChatStreamErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChatStreamError";
    this.kind = kind;
    this.status = options.status;
    this.unavailable = kind === "network" || isUnavailableStatus(options.status);
  }
}

/** HTTP statuses that mean "no model to answer" rather than "bad request". */
export function isUnavailableStatus(status: number | undefined): boolean {
  return status === 404 || status === 502 || status === 503 || status === 504;
}

/**
 * Incremental SSE parser: feed it decoded text in arbitrary pieces, it calls `onData` with the
 * payload of every complete event (multi-line `data:` fields joined by `\n`). Comments and
 * other fields are ignored.
 */
export function createSseParser(onData: (data: string) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let buffer = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length > 0) onData(data.join("\n"));
    data = [];
  };
  const line = (raw: string) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (text === "") return dispatch();
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
  };
  return {
    push(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    flush() {
      if (buffer.length > 0) line(buffer);
      buffer = "";
      dispatch();
    },
  };
}

interface RawChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      refusal?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  citations?: Citation[];
  refusal?: boolean;
  error?: { message?: string } | string;
}

/**
 * Decode one `data:` payload of a chat-completions stream into events. `[DONE]` yields `done`.
 * A payload carrying `error` throws a `stream` error; malformed JSON throws a `parse` error.
 * Top-level `citations` / `refusal: true` (grounded RAG backends) are passed on.
 */
export function parseChatCompletionChunk(payload: string): ChatStreamEvent[] {
  const trimmed = payload.trim();
  if (trimmed === "") return [];
  if (trimmed === "[DONE]") return [{ type: "done" }];
  let chunk: RawChunk;
  try {
    chunk = JSON.parse(trimmed) as RawChunk;
  } catch (cause) {
    throw new ChatStreamError("parse", "invalid chat-completions chunk", {
      cause,
    });
  }
  if (chunk.error) {
    const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
    throw new ChatStreamError("stream", message || "stream error");
  }
  const events: ChatStreamEvent[] = [];
  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta;
    if (delta?.reasoning_content) events.push({ type: "reasoning", text: delta.reasoning_content });
    if (delta?.content) events.push({ type: "content", text: delta.content });
    if (delta?.refusal) events.push({ type: "refusal", text: delta.refusal });
    for (const call of delta?.tool_calls ?? []) {
      events.push({
        type: "tool_call_delta",
        index: call.index ?? 0,
        id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments,
      });
    }
    if (choice.finish_reason) events.push({ type: "finish", reason: choice.finish_reason });
  }
  if (Array.isArray(chunk.citations)) events.push({ type: "citations", citations: chunk.citations });
  if (chunk.refusal === true) events.push({ type: "refusal" });
  return events;
}

/** Merge a tool-call delta into the calls accumulated so far (returns a new array). */
export function accumulateToolCall(
  calls: readonly OpenAIToolCall[],
  delta: Extract<ChatStreamEvent, { type: "tool_call_delta" }>,
): OpenAIToolCall[] {
  const next = calls.slice();
  const current = next[delta.index] ?? {
    id: "",
    type: "function" as const,
    function: { name: "", arguments: "" },
  };
  next[delta.index] = {
    id: delta.id ?? current.id,
    type: "function",
    function: {
      name: current.function.name + (delta.name ?? ""),
      arguments: current.function.arguments + (delta.arguments ?? ""),
    },
  };
  return next;
}

/** The request body messages, in the OpenAI wire shape. */
export function toOpenAIMessages(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  return messages.map(message => {
    const wire: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    if (message.toolCalls?.length) wire.tool_calls = message.toolCalls;
    if (message.toolCallId) wire.tool_call_id = message.toolCallId;
    return wire;
  });
}

export interface StreamChatOptions {
  /** API root including `/v1` (e.g. `http://127.0.0.1:8080/v1`). */
  baseUrl: string;
  model?: string;
  messages: readonly ChatMessage[];
  /** Extra body fields (`temperature`, `tools`, `max_tokens`...). */
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** `<baseUrl>/chat/completions`, tolerant of a trailing slash. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * POST a streaming chat completion and yield its events until `[DONE]` or the end of the body.
 *
 * Throws `ChatStreamError`: `network` (fetch rejected: server down), `http` (non-2xx status;
 * `unavailable` for 404/502/503/504), `aborted` (the signal fired), `parse` / `stream`.
 */
export async function* streamChatCompletion(
  options: StreamChatOptions,
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(chatCompletionsUrl(options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...options.headers,
      },
      body: JSON.stringify({
        ...options.body,
        ...(options.model ? { model: options.model } : {}),
        messages: toOpenAIMessages(options.messages),
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw new ChatStreamError("aborted", "request aborted", { cause });
    throw new ChatStreamError("network", "chat endpoint unreachable", {
      cause,
    });
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // body unreadable: the status alone is reported
    }
    throw new ChatStreamError("http", detail || `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  if (!response.body) throw new ChatStreamError("stream", "response has no body");

  const queue: string[] = [];
  const parser = createSseParser(data => queue.push(data));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        // oxlint-disable-next-line no-await-in-loop -- SSE chunks are read in order, one at a time.
        result = await reader.read();
      } catch (cause) {
        if (options.signal?.aborted) throw new ChatStreamError("aborted", "request aborted", { cause });
        throw new ChatStreamError("stream", "stream interrupted", { cause });
      }
      if (result.done) {
        parser.push(decoder.decode());
        parser.flush();
      } else {
        parser.push(decoder.decode(result.value, { stream: true }));
      }
      while (queue.length > 0) {
        for (const event of parseChatCompletionChunk(queue.shift()!)) {
          yield event;
          if (event.type === "done") return;
        }
      }
      if (result.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Conversation state ─────────────────────────────────────────────────────────────────────

export type ChatStatus = "idle" | "streaming" | "error" | "unavailable";

export interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  error: ChatStreamError | null;
}

export type ChatAction =
  | { type: "start"; user: ChatMessage; assistantId: string }
  | { type: "event"; assistantId: string; event: ChatStreamEvent }
  | { type: "finish" }
  | { type: "fail"; error: ChatStreamError }
  | { type: "stop" }
  | { type: "reset"; messages?: ChatMessage[] }
  | { type: "set"; messages: ChatMessage[] };

export function initialChatState(messages: ChatMessage[] = []): ChatState {
  return { messages, status: "idle", error: null };
}

function applyEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  switch (event.type) {
    case "content":
      return { ...message, content: message.content + event.text };
    case "reasoning":
      return { ...message, reasoning: (message.reasoning ?? "") + event.text };
    case "tool_call_delta":
      return {
        ...message,
        toolCalls: accumulateToolCall(message.toolCalls ?? [], event),
      };
    case "citations":
      return { ...message, citations: event.citations };
    case "refusal":
      return { ...message, refusal: true };
    case "finish":
      return { ...message, finishReason: event.reason };
    case "done":
      return message;
  }
}

/** Pure reducer of a streamed conversation (the state behind `useOpenAIChat`). */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "start":
      return {
        status: "streaming",
        error: null,
        messages: [...state.messages, action.user, { id: action.assistantId, role: "assistant", content: "" }],
      };
    case "event":
      return {
        ...state,
        messages: state.messages.map(message =>
          message.id === action.assistantId ? applyEvent(message, action.event) : message,
        ),
      };
    case "finish":
    case "stop":
      return { ...state, status: "idle" };
    case "fail": {
      // An empty assistant turn left by a failed request is dropped.
      const last = state.messages.at(-1);
      const messages =
        last && last.role === "assistant" && !last.content && !last.toolCalls?.length
          ? state.messages.slice(0, -1)
          : state.messages;
      return {
        messages,
        status: action.error.unavailable ? "unavailable" : "error",
        error: action.error,
      };
    }
    case "reset":
      return initialChatState(action.messages ?? []);
    case "set":
      return { ...state, messages: action.messages };
  }
}

let counter = 0;
/** Message id: `crypto.randomUUID` when present, else a process-local counter. */
export function newMessageId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  counter += 1;
  return `msg-${Date.now().toString(36)}-${counter}`;
}
