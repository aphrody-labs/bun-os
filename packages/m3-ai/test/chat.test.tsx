// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act, type ReactElement, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatComposer } from "../src/ChatComposer";
import {
  type ChatLabels,
  chatLabelsEn,
  chatLabelsFr,
  chatLabelsJa,
  defaultChatLabels,
  formatLabel,
  resolveChatLabels,
} from "../src/chatLabels";
import {
  type Citation,
  CitationList,
  CitedMarkdown,
  RefusalNotice,
  citedNumbers,
  linkCitationMarkers,
} from "../src/citations";
import { ConversationList, filterConversations } from "../src/ConversationList";
import { MemoryPanel } from "../src/MemoryPanel";
import { Markdown, isExternalHref } from "../src/Markdown";
import { MessageBubble } from "../src/MessageBubble";
import { ModelOptionList, ModelSelector } from "../src/ModelSelector";
import { ModelUnavailable, clampProgress } from "../src/ModelUnavailable";
import {
  type ChatMessage,
  ChatStreamError,
  type ChatStreamEvent,
  accumulateToolCall,
  chatCompletionsUrl,
  chatReducer,
  createSseParser,
  initialChatState,
  parseChatCompletionChunk,
  streamChatCompletion,
} from "../src/openaiChatStream";
import { type UseOpenAIChatResult, useOpenAIChat } from "../src/useOpenAIChat";

const dictionaries = {
  fr: chatLabelsFr,
  en: chatLabelsEn,
  ja: chatLabelsJa,
} as const;
const noop = () => {};
const render = (element: ReactElement) => renderToStaticMarkup(element);
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sseResponse(parts: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

async function collect(iterable: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const citations: Citation[] = [
  {
    n: 1,
    id: "a",
    title: "Dragon Ball, chapitre 1",
    url: "https://example.org/1",
    sourceId: "manga",
  },
  { n: 2, id: "b", title: "Daizenshuu 2" },
];

describe("chat labels", () => {
  test("fr, en and ja are complete and have no empty value", () => {
    const keys = Object.keys(defaultChatLabels).toSorted();
    for (const [lang, labels] of Object.entries(dictionaries)) {
      expect(Object.keys(labels).toSorted(), lang).toEqual(keys);
      for (const [key, value] of Object.entries(labels))
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
    }
  });

  test("placeholders are kept in every language", () => {
    for (const labels of Object.values(dictionaries)) {
      expect(labels.citation).toContain("{n}");
      expect(labels.progressPercent).toContain("{percent}");
    }
  });

  test("resolveChatLabels falls back key by key and ignores empty strings", () => {
    const l = resolveChatLabels({ send: "Go", stop: "" });
    expect(l.send).toBe("Go");
    expect(l.stop).toBe(chatLabelsEn.stop);
    expect(resolveChatLabels()).toBe(defaultChatLabels);
    expect(resolveChatLabels({}, chatLabelsFr).send).toBe("Envoyer");
  });

  test("formatLabel substitutes known placeholders only", () => {
    expect(formatLabel("Source {n} {x}", { n: 3 })).toBe("Source 3 {x}");
  });
});

describe("SSE parser", () => {
  test("joins events split in the middle of a line and of a field", () => {
    const seen: string[] = [];
    const parser = createSseParser(data => seen.push(data));
    parser.push('data: {"a"');
    parser.push(":1}\r\n\r\n: comment\n\nda");
    parser.push("ta: line1\ndata: line2\n\nevent: x\ndata: [DONE]");
    parser.flush();
    expect(seen).toEqual(['{"a":1}', "line1\nline2", "[DONE]"]);
  });

  test("parseChatCompletionChunk decodes content, reasoning, tools, finish and grounding", () => {
    expect(parseChatCompletionChunk("[DONE]")).toEqual([{ type: "done" }]);
    expect(
      parseChatCompletionChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                reasoning_content: "hmm",
                content: "Hi",
                tool_calls: [
                  {
                    index: 1,
                    id: "c1",
                    function: { name: "rag", arguments: '{"q"' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          citations,
          refusal: true,
        }),
      ),
    ).toEqual([
      { type: "reasoning", text: "hmm" },
      { type: "content", text: "Hi" },
      {
        type: "tool_call_delta",
        index: 1,
        id: "c1",
        name: "rag",
        arguments: '{"q"',
      },
      { type: "finish", reason: "tool_calls" },
      { type: "citations", citations },
      { type: "refusal" },
    ]);
  });

  test("errors are typed", () => {
    expect(() => parseChatCompletionChunk("{nope")).toThrow(ChatStreamError);
    try {
      parseChatCompletionChunk('{"error":{"message":"context overflow"}}');
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatStreamError);
      expect((error as ChatStreamError).kind).toBe("stream");
      expect((error as ChatStreamError).message).toBe("context overflow");
    }
  });

  test("tool-call deltas accumulate by index", () => {
    let calls = accumulateToolCall([], {
      type: "tool_call_delta",
      index: 0,
      id: "x",
      name: "se",
    });
    calls = accumulateToolCall(calls, {
      type: "tool_call_delta",
      index: 0,
      name: "arch",
      arguments: '{"q":',
    });
    calls = accumulateToolCall(calls, {
      type: "tool_call_delta",
      index: 0,
      arguments: '"Goku"}',
    });
    expect(calls).toEqual([
      {
        id: "x",
        type: "function",
        function: { name: "search", arguments: '{"q":"Goku"}' },
      },
    ]);
  });
});

const status = (code: number) =>
  (async () => new Response("model loading", { status: code })) as unknown as typeof fetch;
async function failure(f: typeof fetch): Promise<ChatStreamError> {
  try {
    await collect(streamChatCompletion({ baseUrl: "http://x/v1", messages: [], fetch: f }));
  } catch (error) {
    return error as ChatStreamError;
  }
  throw new Error("expected a failure");
}

describe("streamChatCompletion", () => {
  test("posts a streaming request and yields events until [DONE]", async () => {
    let request: { url: string; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      request = { url, body: JSON.parse(String(init.body)) };
      return sseResponse([
        chunk({ content: "Kame" }),
        chunk({ content: "hameha" }, "stop"),
        "data: [DONE]\n\n",
        chunk({ content: "ignored" }),
      ]);
    }) as unknown as typeof fetch;
    const events = await collect(
      streamChatCompletion({
        baseUrl: "http://127.0.0.1:8080/v1/",
        model: "grounded-model",
        messages: [{ id: "1", role: "user", content: "Hi" }],
        body: { temperature: 0 },
        fetch: fakeFetch,
      }),
    );
    expect(request!.url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(request!.body).toEqual({
      temperature: 0,
      model: "grounded-model",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    });
    expect(events).toEqual([
      { type: "content", text: "Kame" },
      { type: "content", text: "hameha" },
      { type: "finish", reason: "stop" },
      { type: "done" },
    ]);
  });

  test("network failure and 503 are unavailable, 400 is an error", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const net = await failure(down);
    expect([net.kind, net.unavailable]).toEqual(["network", true]);
    const busy = await failure(status(503));
    expect([busy.kind, busy.status, busy.unavailable, busy.message]).toEqual(["http", 503, true, "model loading"]);
    const bad = await failure(status(400));
    expect([bad.kind, bad.unavailable]).toEqual(["http", false]);
  });

  test("an aborted request reports `aborted`", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = (async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return sseResponse([]);
    }) as unknown as typeof fetch;
    try {
      await collect(
        streamChatCompletion({
          baseUrl: "http://x/v1",
          messages: [],
          fetch: f,
          signal: controller.signal,
        }),
      );
      throw new Error("expected abort");
    } catch (error) {
      expect((error as ChatStreamError).kind).toBe("aborted");
    }
  });

  test("chatCompletionsUrl tolerates trailing slashes", () => {
    expect(chatCompletionsUrl("http://h/v1//")).toBe("http://h/v1/chat/completions");
  });
});

describe("chatReducer", () => {
  const user: ChatMessage = {
    id: "u",
    role: "user",
    content: "Qui est Goku ?",
  };
  test("start, events and finish build the assistant turn", () => {
    let state = chatReducer(initialChatState(), {
      type: "start",
      user,
      assistantId: "a",
    });
    expect(state.status).toBe("streaming");
    for (const event of [
      { type: "content", text: "Son Goku [1]" },
      { type: "reasoning", text: "r" },
      { type: "citations", citations },
      { type: "finish", reason: "stop" },
    ] satisfies ChatStreamEvent[])
      state = chatReducer(state, { type: "event", assistantId: "a", event });
    state = chatReducer(state, { type: "finish" });
    expect(state.status).toBe("idle");
    expect(state.messages[1]).toEqual({
      id: "a",
      role: "assistant",
      content: "Son Goku [1]",
      reasoning: "r",
      citations,
      finishReason: "stop",
    });
  });

  test("an unavailable failure drops the empty turn and sets the status", () => {
    let state = chatReducer(initialChatState(), {
      type: "start",
      user,
      assistantId: "a",
    });
    state = chatReducer(state, {
      type: "fail",
      error: new ChatStreamError("network", "down"),
    });
    expect(state.status).toBe("unavailable");
    expect(state.messages).toEqual([user]);
    state = chatReducer(state, { type: "start", user, assistantId: "b" });
    state = chatReducer(state, {
      type: "fail",
      error: new ChatStreamError("http", "bad", { status: 400 }),
    });
    expect(state.status).toBe("error");
    expect(chatReducer(state, { type: "reset" })).toEqual(initialChatState());
  });
});

describe("useOpenAIChat", () => {
  // act() flushes the renders and passive effects that dispatches from the async send() schedule.
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  });

  test("streams an answer into the conversation", async () => {
    let api: UseOpenAIChatResult | null = null;
    const finished: ChatMessage[] = [];
    const fakeFetch = (async () =>
      sseResponse([
        chunk({ content: "Ka" }),
        chunk({ content: "me" }, "stop"),
        "data: [DONE]\n\n",
      ])) as unknown as typeof fetch;
    function Harness() {
      const result = useOpenAIChat({
        baseUrl: "http://x/v1",
        fetch: fakeFetch,
        onFinish: m => finished.push(m),
      });
      useEffect(() => {
        api = result;
      });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(() => root.render(<Harness />));
    await act(() => api!.send("Hi"));
    expect(api!.status).toBe("idle");
    expect(api!.messages.map(m => [m.role, m.content])).toEqual([
      ["user", "Hi"],
      ["assistant", "Kame"],
    ]);
    expect(finished[0]?.content).toBe("Kame");
    act(() => root.unmount());
  });

  test("reports unavailable when the server is down", async () => {
    let api: UseOpenAIChatResult | null = null;
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    function Harness() {
      const result = useOpenAIChat({ baseUrl: "http://x/v1", fetch: down });
      useEffect(() => {
        api = result;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(() => root.render(<Harness />));
    await act(() => api!.send("Hi"));
    expect(api!.status).toBe("unavailable");
    expect(api!.error?.kind).toBe("network");
    act(() => root.unmount());
  });
});

describe("citations", () => {
  test("markers become links only when cited and outside code", () => {
    const text = "Goku [1] et Vegeta [2], pas [9]. `a[1]` [lien](x) ![i](y)";
    expect(linkCitationMarkers(text, citations)).toBe(
      "Goku [\\[1\\]](#citation-1) et Vegeta [\\[2\\]](#citation-2), pas [9]. `a[1]` [lien](x) ![i](y)",
    );
    expect(citedNumbers("a [2] b [1] c [2] `[3]`")).toEqual([2, 1]);
  });

  for (const [lang, labels] of Object.entries(dictionaries)) {
    test(`CitedMarkdown, CitationList and RefusalNotice render in ${lang}`, () => {
      const cited = render(<CitedMarkdown content="Goku [1]." citations={citations} labels={labels} />);
      expect(cited).toContain(`aria-label="${formatLabel(labels.citation, { n: 1 })}: ${citations[0]!.title}"`);
      expect(cited).toContain('href="https://example.org/1"');
      const list = render(<CitationList citations={citations} labels={labels} />);
      expect(list).toContain(labels.sources);
      expect(list).toContain('id="citation-2"');
      expect(list).toContain("bg-surface-container-low");
      const refusal = render(<RefusalNotice labels={labels} />);
      expect(refusal).toContain(labels.refusalTitle);
      expect(refusal).toContain(labels.refusalBody);
    });
  }

  test("MessageBubble renders citations, refusal and localized actions", () => {
    const html = render(
      <MessageBubble content="Goku [2]" isUser={false} citations={citations} onCopy={noop} labels={chatLabelsFr} />,
    );
    expect(html).toContain("Source 2: Daizenshuu 2");
    expect(html).toContain(chatLabelsFr.sources);
    expect(html).toContain(`aria-label="${chatLabelsFr.copyMessage}"`);
    const refused = render(<MessageBubble content="" isUser={false} refusal labels={chatLabelsJa} />);
    expect(refused).toContain(chatLabelsJa.refusalTitle);
  });
});

describe("chat components", () => {
  const conversations = [
    {
      id: "1",
      title: "Cell Game",
      updatedAt: "2026-10-01T10:00:00Z",
      preview: "Gohan",
    },
    { id: "2", title: "", updatedAt: 1_759_000_000_000 },
  ];

  test("filterConversations matches title and preview", () => {
    expect(filterConversations(conversations, "gohan").map(c => c.id)).toEqual(["1"]);
    expect(filterConversations(conversations, " ")).toHaveLength(2);
  });

  for (const [lang, labels] of Object.entries(dictionaries)) {
    test(`ConversationList renders in ${lang}`, () => {
      const html = render(
        <ConversationList
          conversations={conversations}
          selectedId="1"
          onSelect={noop}
          onNew={noop}
          onRename={noop}
          onDelete={noop}
          searchable
          labels={labels}
          locale={lang}
        />,
      );
      expect(html).toContain(`aria-label="${labels.conversations}"`);
      expect(html).toContain(labels.newConversation);
      expect(html).toContain(`placeholder="${labels.searchConversations}"`);
      expect(html).toContain(labels.untitledConversation);
      expect(html).toContain(`aria-label="${labels.deleteConversation}: Cell Game"`);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain("bg-secondary-container");
      const empty = render(<ConversationList conversations={[]} onSelect={noop} labels={labels} />);
      expect(empty).toContain(escaped(labels.noConversations));
    });

    test(`ModelUnavailable renders in ${lang}`, () => {
      const down = render(<ModelUnavailable reason="llama-server" onRetry={noop} labels={labels} />);
      expect(down).toContain(labels.modelUnavailable);
      expect(down).toContain(labels.retry);
      expect(down).toContain("bg-error-container");
      const pulling = render(<ModelUnavailable phase="downloading" progress={0.425} labels={labels} />);
      expect(pulling).toContain(labels.modelDownloading);
      expect(pulling).toContain('aria-valuenow="43"');
      expect(pulling).toContain(formatLabel(labels.progressPercent, { percent: 43 }));
      expect(pulling).not.toContain(labels.retry);
    });

    test(`MemoryPanel renders in ${lang}`, () => {
      const html = render(
        <MemoryPanel
          memories={[
            {
              id: "m1",
              content: "Préfère les réponses courtes",
              tags: ["style"],
              createdAt: "2026-10-06",
            },
          ]}
          onDelete={noop}
          onClear={noop}
          labels={labels}
          locale={lang}
        />,
      );
      expect(html).toContain(`aria-label="${labels.memory}"`);
      expect(html).toContain(`aria-label="${labels.deleteMemory}"`);
      expect(html).toContain(labels.clearMemory);
      expect(html).toContain("style");
      expect(render(<MemoryPanel memories={[]} labels={labels} />)).toContain(labels.memoryEmpty);
      expect(render(<MemoryPanel memories={[]} loading labels={labels} />)).toContain(labels.memoryLoading);
    });

    test(`ChatComposer takes its strings from the ${lang} labels`, () => {
      const html = render(
        <ChatComposer draft="x" onDraftChange={noop} onSend={noop} onOpenVoice={noop} labels={labels} />,
      );
      expect(html).toContain(`placeholder="${labels.composerPlaceholder}"`);
      expect(html).toContain(`aria-label="${labels.send}"`);
      expect(html).toContain(`aria-label="${labels.openVoice}"`);
    });
  }

  test("MemoryPanel clear asks for confirmation, then clears", () => {
    let cleared = 0;
    const host = document.createElement("div");
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <MemoryPanel
          memories={[{ id: "m1", content: "x", createdAt: 0 }]}
          onClear={() => (cleared += 1)}
          labels={chatLabelsFr}
        />,
      ),
    );
    const byText = (text: string) => [...host.querySelectorAll("button")].find(button => button.textContent === text);
    flushSync(() => byText(chatLabelsFr.clearMemory)!.click());
    expect(host.textContent).toContain(chatLabelsFr.clearMemoryConfirm);
    expect(cleared).toBe(0);
    flushSync(() => byText(chatLabelsFr.confirm)!.click());
    expect(cleared).toBe(1);
    flushSync(() => root.unmount());
  });

  test("no visible English default leaks into a French render", () => {
    const keys = Object.keys(chatLabelsEn) as (keyof ChatLabels)[];
    const html = render(
      <>
        <ConversationList conversations={[]} onSelect={noop} onNew={noop} searchable labels={chatLabelsFr} />
        <ModelUnavailable onRetry={noop} labels={chatLabelsFr} />
        <MemoryPanel memories={[]} onClear={noop} labels={chatLabelsFr} />
        <RefusalNotice labels={chatLabelsFr} />
      </>,
    );
    for (const key of keys) {
      if (chatLabelsEn[key] !== chatLabelsFr[key] && chatLabelsEn[key].length > 6)
        expect(html, key).not.toContain(chatLabelsEn[key]);
    }
  });

  test("clampProgress", () => {
    expect([clampProgress(-1), clampProgress(2), clampProgress(Number.NaN), clampProgress(null)]).toEqual([
      0,
      1,
      null,
      null,
    ]);
  });
});

describe("integration requirements of the desktop chat", () => {
  const ligatures = /<span[^>]*data-m3-component="Icon"/;

  test("chat icons are inline SVG, never font ligatures", () => {
    const html = render(
      <>
        <ChatComposer draft="x" onDraftChange={noop} onSend={noop} onOpenVoice={noop} heading="h" />
        <ChatComposer draft="x" onDraftChange={noop} onSend={noop} isSending onStop={noop} />
        <MessageBubble content="a" isUser={false} onCopy={noop} onDislike={noop} onFork={noop} />
        <MessageBubble content="```ts\nx\n```" isUser={false} />
        <ConversationList
          conversations={[{ id: "1", title: "t", updatedAt: 0 }]}
          onSelect={noop}
          onNew={noop}
          onDelete={noop}
          onRename={noop}
          searchable
        />
        <ModelUnavailable onRetry={noop} />
        <MemoryPanel memories={[{ id: "m", content: "c", createdAt: 0 }]} onDelete={noop} />
        <CitationList citations={citations} />
        <RefusalNotice />
      </>,
    );
    expect(html).not.toMatch(ligatures);
    for (const name of [
      "arrow_upward",
      "stop_filled",
      "mic",
      "auto_awesome_filled",
      "content_copy",
      "thumb_down",
      "call_split",
      "edit_square",
      "search",
      "edit",
      "delete",
      "cloud_off",
      "refresh",
      "open_in_new",
      "info",
    ])
      expect(html, name).toContain(`data-m3-icon="${name}"`);
    expect(html).toContain('viewBox="0 -960 960 960"');
  });

  test("ChatComposer and MessageBubble strings come from labels", () => {
    const composer = render(
      <ChatComposer
        draft="x"
        onDraftChange={noop}
        onSend={noop}
        isSending
        onStop={noop}
        onOpenVoice={noop}
        labels={chatLabelsJa}
      />,
    );
    expect(composer).toContain(`aria-label="${chatLabelsJa.stop}"`);
    expect(composer).toContain(`aria-label="${chatLabelsJa.openVoice}"`);
    expect(composer).not.toContain('aria-label="Stop"');
    const bubble = render(
      <MessageBubble content="a" isUser={false} onCopy={noop} onDislike={noop} onFork={noop} labels={chatLabelsEn} />,
    );
    for (const key of ["copyMessage", "dislike", "fork"] as const) {
      expect(bubble).toContain(`aria-label="${chatLabelsEn[key]}"`);
      expect(bubble).toContain(`title="${chatLabelsEn[key]}"`);
    }
    expect(bubble).not.toContain("Copier");
    expect(bubble).not.toContain("Bifurquer");
  });

  test("code blocks inside an answer are localized", () => {
    const html = render(<MessageBubble content={"```ts\nx\n```"} isUser={false} labels={chatLabelsFr} />);
    expect(html).toContain(`aria-label="${chatLabelsFr.copyCode}"`);
    expect(html).toContain(`>${chatLabelsFr.copy}</span>`);
  });

  test("external links open safely, internal ones stay in place", () => {
    const html = render(
      <MessageBubble content="[ext](https://example.org) [rel](/wiki/goku) [anchor](#x)" isUser={false} />,
    );
    expect(html).toMatch(/href="https:\/\/example.org" target="_blank" rel="noopener noreferrer"/);
    expect(html).toMatch(/href="\/wiki\/goku">/);
    expect(html).toMatch(/href="#x">/);
  });

  test("onLinkClick receives href and event from MessageBubble and CitedMarkdown", () => {
    const clicks: string[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <>
          <MessageBubble
            content="[ext](https://example.org/a)"
            isUser={false}
            onLinkClick={(href, event) => {
              event.preventDefault();
              clicks.push(href);
            }}
          />
          <MessageBubble
            content="Goku [2] [doc](https://example.org/b)"
            isUser={false}
            citations={citations}
            onLinkClick={(href, event) => {
              event.preventDefault();
              clicks.push(href);
            }}
          />
        </>,
      ),
    );
    for (const anchor of host.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://example.org/a"], a[href="https://example.org/b"]',
    ))
      flushSync(() => anchor.click());
    expect(clicks).toEqual(["https://example.org/a", "https://example.org/b"]);
    flushSync(() => root.unmount());
  });

  test("renderLink replaces the link element", () => {
    const html = render(
      <Markdown
        content="[go](https://example.org)"
        renderLink={({ href, children, external }) => (
          <button type="button" data-href={href} data-external={String(external)}>
            {children}
          </button>
        )}
      />,
    );
    expect(html).toContain('<button type="button" data-href="https://example.org" data-external="true">go</button>');
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
    expect(isExternalHref("//cdn.example.org/x")).toBe(true);
    expect(isExternalHref("/a")).toBe(false);
  });

  test("ChatComposer disabled blocks typing and sending, unlike isSending", () => {
    let sent = 0;
    const host = document.createElement("div");
    const root = createRoot(host);
    const mount = (props: { disabled?: boolean; isSending?: boolean }) =>
      flushSync(() =>
        root.render(
          <ChatComposer
            draft="hello"
            onDraftChange={noop}
            onSend={() => (sent += 1)}
            onOpenVoice={noop}
            onStop={noop}
            {...props}
          />,
        ),
      );
    mount({ disabled: true });
    const textarea = host.querySelector("textarea")!;
    expect(textarea.disabled).toBe(true);
    expect(host.querySelector(`[aria-label="${chatLabelsEn.send}"]`)).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(`[aria-label="${chatLabelsEn.openVoice}"]`)!.disabled).toBe(true);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent).toBe(0);

    mount({ disabled: true, isSending: true });
    expect(host.querySelector(`[aria-label="${chatLabelsEn.stop}"]`)).toBeNull();

    mount({ isSending: true });
    expect(host.querySelector("textarea")!.disabled).toBe(false);
    expect(host.querySelector(`[aria-label="${chatLabelsEn.stop}"]`)).not.toBeNull();

    mount({});
    flushSync(() => host.querySelector<HTMLButtonElement>(`[aria-label="${chatLabelsEn.send}"]`)!.click());
    expect(sent).toBe(1);
    flushSync(() => root.unmount());
  });

  test("ModelSelector strings come from labels", () => {
    const html = render(<ModelSelector models={[]} value="" onChange={noop} labels={chatLabelsFr} />);
    expect(html).toContain(chatLabelsFr.selectModel);
    expect(html).toContain('data-m3-icon="expand_more"');
    expect(html).not.toMatch(ligatures);
    const list = render(
      <ModelOptionList
        grouped={{
          Local: [{ id: "q", name: "Qwen3", provider: "Local", context_window: 8192 }],
        }}
        value="q"
        onSelect={noop}
        labels={chatLabelsFr}
      />,
    );
    expect(list).toContain(`aria-label="${chatLabelsFr.models}"`);
    expect(list).toContain(
      formatLabel(chatLabelsFr.contextTokens, {
        count: (8192).toLocaleString(),
      }),
    );
    expect(render(<ModelOptionList grouped={{}} value="" onSelect={noop} labels={chatLabelsJa} />)).toContain(
      chatLabelsJa.noModels,
    );
  });
});
