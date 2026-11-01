// SPDX-License-Identifier: Apache-2.0
// Real React DOM interactions against isolated native owner responses.
// No live service, inference, protected conversation or clipboard is used.
import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const { CodexChat, CodexChatRoute } = await import("./codex-chat");
const { toast } = await import("@aphrody/m3-primitives");
const { useChatStore } = await import("./stores/chat-store");

const host = document.createElement("div");
document.body.append(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalTauri = window.__TAURI__;
const testWindow = window as unknown as {
  __TAURI_INTERNALS__?: { transformCallback: () => number };
};
const originalInternals = testWindow.__TAURI_INTERNALS__;
const originalEventInternals = Object.getOwnPropertyDescriptor(window, "__TAURI_EVENT_PLUGIN_INTERNALS__");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let notification: ((event: { payload: unknown }) => void) | undefined;
let rpcCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
const success = spyOn(toast, "success").mockImplementation(() => "");
const failure = spyOn(toast, "error").mockImplementation(() => "");

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.replaceChildren();
  window.__TAURI__ = originalTauri;
  testWindow.__TAURI_INTERNALS__ = originalInternals;
  globalThis.fetch = originalFetch;
  for (const [object, property, descriptor] of [
    [navigator, "clipboard", originalClipboard],
    [document, "execCommand", originalExecCommand],
    [window, "__TAURI_EVENT_PLUGIN_INTERNALS__", originalEventInternals],
  ] as const) {
    if (descriptor) Object.defineProperty(object, property, descriptor);
    else Reflect.deleteProperty(object, property);
  }
  success.mockClear();
  failure.mockClear();
});

afterAll(() => {
  success.mockRestore();
  failure.mockRestore();
});

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;
function backend(handler?: RpcHandler) {
  rpcCalls = [];
  notification = undefined;
  useChatStore.setState({
    threads: [],
    activeThreadId: null,
    sessionTitle: undefined,
    newSessionRequested: false,
    model: "",
    effort: "Minimal",
    accessMode: "ask",
    cwd: "",
  });
  globalThis.fetch = async () => {
    throw new Error("External network forbidden by this fixture.");
  };
  testWindow.__TAURI_INTERNALS__ = { transformCallback: () => 1 };
  window.__TAURI__ = {
    event: {
      listen: async (_name, callback) => {
        notification = callback;
        return () => {
          notification = undefined;
        };
      },
    },
    core: {
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (command === "aphrody_rpc") {
          const request = args?.request as {
            method: string;
            params: Record<string, unknown>;
          };
          rpcCalls.push(request);
          const result = await (handler ?? defaultRpc)(request.method, request.params);
          return { result } as T;
        }
        if (command === "aphrody_system_cwd") return { cwd: "/fixture" } as T;
        if (command === "aphrody_session_stream" || command === "aphrody_session_unstream") return null as T;
        if (command === "aphrody_reply") return null as T;
        throw new Error(`Unexpected native command: ${command}`);
      },
    },
  };
}

function defaultRpc(method: string): Record<string, unknown> {
  if (method === "initialize" || method === "initialized") return {};
  if (method === "model/list")
    return {
      data: [{ id: "fixture-model", provider: "fixture", default: true }],
    };
  if (method === "thread/list") return { data: [] };
  if (method === "thread/start" || method === "thread/resume" || method === "thread/read")
    return {
      thread: {
        id: "fixture-thread",
        model: "fixture-model",
        cwd: "/fixture",
        turns: [],
      },
    };
  throw new Error(`Unexpected RPC: ${method}`);
}

async function mount(node: ReactNode) {
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    item => item.getAttribute("aria-label") === label || item.textContent?.trim() === label || item.title === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function emit(payload: unknown) {
  expect(notification).toBeDefined();
  await act(async () => notification!({ payload }));
}
const chatProps = {
  turns: [],
  busy: false,
  draft: "",
  model: "",
  modelOptions: [],
  cwd: "",
  onDraftChange: () => {},
  onSend: () => {},
  onStop: () => {},
  onNewSession: () => {},
  onClearSession: () => {},
  onModelChange: () => {},
  onCwdChange: () => {},
};
function route(prompt = "") {
  return createElement(
    MemoryRouter,
    {
      initialEntries: [prompt ? `/chat?prompt=${encodeURIComponent(prompt)}` : "/chat"],
    },
    createElement(CodexChatRoute),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("empty chat shows no fake models, feedback, rename or unavailable OCR/transcription actions", async () => {
  backend();
  await mount(createElement(CodexChat, chatProps));
  expect(host.textContent).toContain("Bonjour, par quoi commence-t-on ?");
  expect(host.textContent).not.toContain("GPT-6");
  expect(host.querySelector('[aria-label="Je n\'aime pas"]')).toBeNull();
  expect(host.querySelector('[aria-label="Renommer le chat"]')).toBeNull();
  await click("Modèle : Aucun modèle configuré");
  expect(document.body.textContent).toContain("Aucun modèle configuré.");
  expect(document.body.textContent).not.toContain("Recommandés & cloud");
});

test("message copy waits for the actual native clipboard acknowledgement", async () => {
  backend();
  const copied = deferred<void>();
  window.__TAURI__!.core!.invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    expect(command).toBe("plugin:clipboard-manager|write_text");
    expect(args?.text).toBe("Fixture response");
    await copied.promise;
    return null as T;
  };
  await mount(
    createElement(CodexChat, {
      ...chatProps,
      turns: [
        {
          id: "fixture-assistant",
          role: "assistant",
          content: "Fixture response",
        },
      ],
    }),
  );
  await click("Copier le message");
  expect(success).not.toHaveBeenCalled();
  await act(async () => copied.resolve());
  expect(success).toHaveBeenCalledWith("Message copié");
});

test("failed message and transcript copy report failure without success", async () => {
  backend();
  window.__TAURI__!.core!.invoke = async () => {
    throw new Error("Fixture clipboard unavailable");
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("Fixture browser clipboard unavailable");
      },
    },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => false,
  });
  await mount(
    createElement(CodexChat, {
      ...chatProps,
      turns: [
        {
          id: "fixture-assistant",
          role: "assistant",
          content: "Fixture response",
        },
      ],
    }),
  );
  await click("Copier le message");
  await click("Copier l'échange");
  expect(success).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledTimes(2);
});

test("initial connection failure is visible and retry recovers using the real protocol", async () => {
  let fail = true;
  backend(method => {
    if (method === "model/list" && fail) throw new Error("Fixture unavailable");
    return defaultRpc(method);
  });
  await mount(route("Fixture draft"));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Connexion au service indisponible.");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Envoyer"]')?.disabled).toBe(true);
  fail = false;
  await click("Réessayer");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("fixture-model");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Envoyer"]')?.disabled).toBe(false);
  expect(rpcCalls.some(call => call.method === "turn/start")).toBe(false);
});

test("rejected turn preserves the draft and never displays a sent user message", async () => {
  backend(method => {
    if (method === "turn/start") throw new Error("Fixture rejected");
    return defaultRpc(method);
  });
  await mount(route("Fixture unsent draft"));
  await click("Envoyer");
  expect(host.querySelector("textarea")?.value).toBe("Fixture unsent draft");
  expect(host.textContent).toContain("Bonjour, par quoi commence-t-on ?");
  expect(failure).toHaveBeenCalledWith("Fixture rejected");
  expect(success).not.toHaveBeenCalled();
});

test("stop queued during turn submission sends the acknowledged native IDs and waits for completion", async () => {
  const started = deferred<Record<string, unknown>>();
  let rejectInterrupt = true;
  backend((method, params) => {
    if (method === "turn/start") return started.promise;
    if (method === "turn/interrupt") {
      expect(params).toEqual({
        threadId: "fixture-thread",
        turnId: "fixture-turn",
      });
      if (rejectInterrupt) throw new Error("Fixture interrupt rejected");
      return { status: "interrupt_requested" };
    }
    return defaultRpc(method);
  });
  await mount(route("Fixture prompt"));
  await click("Envoyer");
  await click("Arrêter la génération");
  expect(rpcCalls.filter(call => call.method === "turn/interrupt")).toHaveLength(0);
  await act(async () => started.resolve({ turn: { id: "fixture-turn" } }));
  expect(failure).toHaveBeenCalledWith("Arrêt impossible : Fixture interrupt rejected");
  expect(host.querySelector('[aria-label="Arrêter la génération"]')).not.toBeNull();
  rejectInterrupt = false;
  await click("Arrêter la génération");
  expect(rpcCalls.filter(call => call.method === "turn/interrupt")).toHaveLength(2);
  expect(host.querySelector('[aria-label="Arrêter la génération"]')).not.toBeNull();
  await emit({
    method: "turn/completed",
    params: {
      threadId: "fixture-thread",
      turn: { id: "fixture-turn", status: "interrupted" },
    },
  });
  expect(host.querySelector('[aria-label="Arrêter la génération"]')).toBeNull();
});

test("approval remains pending on rejected reply and records only a confirmed decision", async () => {
  backend();
  await mount(route());
  await act(async () => useChatStore.getState().setActiveThreadId("fixture-thread"));
  const reply = deferred<void>();
  const invoke = window.__TAURI__!.core!.invoke;
  let replyCount = 0;
  window.__TAURI__!.core!.invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (command === "aphrody_reply") {
      replyCount++;
      await reply.promise;
      return null as T;
    }
    return invoke<T>(command, args);
  };
  await emit({
    id: 42,
    backendGeneration: 7,
    method: "item/fileChange/requestApproval",
    params: { threadId: "fixture-thread", path: "/fixture/change.ts" },
  });
  await click("Autoriser une fois");
  expect(host.textContent).not.toContain("Autorisé");
  expect(host.querySelector<HTMLButtonElement>("button[disabled]")).not.toBeNull();
  await act(async () => reply.reject(new Error("Fixture approval rejected")));
  expect(failure.mock.calls[0]?.[0]).toContain("Fixture approval rejected");
  expect(host.textContent).not.toContain("Autorisé");
  window.__TAURI__!.core!.invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    command === "aphrody_reply" ? (null as T) : invoke<T>(command, args);
  await click("Autoriser une fois");
  expect(host.textContent).toContain("Autorisé");
  expect(success).toHaveBeenCalledWith("Action autorisée");
  expect(replyCount).toBe(1);
});

test("a missing fork identifier cannot show a success", async () => {
  backend(method => (method === "thread/fork" ? {} : defaultRpc(method)));
  await mount(route());
  await act(async () => useChatStore.getState().setActiveThreadId("fixture-thread"));
  await emit({
    method: "item/completed",
    params: {
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      item: {
        id: "fixture-message",
        type: "agentMessage",
        text: "Fixture response",
      },
    },
  });
  await click("Bifurquer ce chat");
  expect(success).not.toHaveBeenCalled();
  expect(failure.mock.calls.at(-1)?.[0]).toContain("Le serveur n’a pas créé de nouveau chat.");
  expect(rpcCalls.find(call => call.method === "thread/fork")?.params).toEqual({
    threadId: "fixture-thread",
  });
});

test("clear creates a genuinely empty new-session state and leaves other-thread events isolated", async () => {
  backend();
  await mount(route("/clear"));
  await act(async () => useChatStore.getState().setActiveThreadId("fixture-thread"));
  await emit({
    method: "item/completed",
    params: {
      threadId: "fixture-thread",
      item: {
        id: "fixture-message",
        type: "agentMessage",
        text: "Fixture response",
      },
    },
  });
  await click("Envoyer");
  expect(useChatStore.getState().activeThreadId).toBeNull();
  expect(host.textContent).not.toContain("Fixture response");
  expect(host.textContent).toContain("Bonjour, par quoi commence-t-on ?");
  await emit({
    method: "item/completed",
    params: {
      threadId: "fixture-thread",
      item: {
        id: "late-message",
        type: "agentMessage",
        text: "Late fixture response",
      },
    },
  });
  expect(host.textContent).not.toContain("Late fixture response");
  expect(rpcCalls.some(call => call.method === "turn/start")).toBe(false);
});

test("persisted user messages restore the actual owner content array", async () => {
  backend(method =>
    method === "thread/read"
      ? {
          thread: {
            id: "fixture-thread",
            model: "fixture-model",
            turns: [
              {
                id: "fixture-restored-turn",
                items: [
                  {
                    id: "fixture-user",
                    type: "userMessage",
                    content: [{ type: "inputText", text: "Fixture restored input" }],
                  },
                  {
                    id: "fixture-answer",
                    type: "agentMessage",
                    text: "Fixture restored answer",
                  },
                ],
              },
            ],
          },
        }
      : defaultRpc(method),
  );
  useChatStore.getState().setActiveThreadId("fixture-thread");
  await mount(route());
  expect(host.textContent).toContain("Fixture restored input");
  expect(host.textContent).toContain("Fixture restored answer");
  expect(rpcCalls.some(call => call.method === "turn/start")).toBe(false);
});

test("HTTP failure details are localized without exposing transport codes in Chat", async () => {
  backend(method => {
    if (method === "turn/start") throw new Error("Server returned HTTP 503");
    return defaultRpc(method);
  });
  await mount(route("Fixture unsent draft"));
  await click("Envoyer");
  expect(failure).toHaveBeenCalledWith("Connexion au service indisponible.");
  expect(failure.mock.calls.flat().join(" ")).not.toContain("503");
  expect(host.querySelector("textarea")?.value).toBe("Fixture unsent draft");
});

test("sidebar session selection reads and renders the selected real owner history", async () => {
  backend((method, params) =>
    method === "thread/read"
      ? {
          thread: {
            id: params.threadId,
            turns: [
              {
                id: "fixture-selection-turn",
                items: [
                  {
                    id: "fixture-selection-message",
                    type: "agentMessage",
                    text: "Fixture selected history",
                  },
                ],
              },
            ],
          },
        }
      : defaultRpc(method),
  );
  await mount(route());
  await act(async () => useChatStore.getState().setActiveThreadId("fixture-selected-thread"));
  expect(host.textContent).toContain("Fixture selected history");
  expect(rpcCalls.find(call => call.method === "thread/read")?.params).toEqual({
    threadId: "fixture-selected-thread",
    includeTurns: true,
  });
  expect(host.querySelector('[aria-label="Arrêter la génération"]')).toBeNull();
  expect(rpcCalls.some(call => call.method === "turn/start")).toBe(false);
});

test("new session invalidates a pending history read without restoring stale messages", async () => {
  const read = deferred<Record<string, unknown>>();
  backend(method => (method === "thread/read" ? read.promise : defaultRpc(method)));
  await mount(route());
  await act(async () => useChatStore.getState().setActiveThreadId("fixture-stale-thread"));
  expect(host.querySelector("output")?.textContent).toContain("Chargement du chat");
  expect(host.querySelector('[aria-label="Arrêter la génération"]')).toBeNull();
  await click("Nouveau chat");
  await act(async () =>
    read.resolve({
      thread: {
        id: "fixture-stale-thread",
        turns: [
          {
            id: "fixture-stale-turn",
            items: [
              {
                id: "fixture-stale-message",
                type: "agentMessage",
                text: "Fixture stale history",
              },
            ],
          },
        ],
      },
    }),
  );
  expect(useChatStore.getState().activeThreadId).toBeNull();
  expect(host.textContent).not.toContain("Fixture stale history");
  expect(host.textContent).toContain("Bonjour, par quoi commence-t-on ?");
});

test("Tauri uses one ordered native notification transport and preserves legitimate repeated deltas", async () => {
  const commands: string[] = [];
  backend(method => (method === "turn/start" ? { turn: { id: "fixture-turn" } } : defaultRpc(method)));
  const invoke = window.__TAURI__!.core!.invoke;
  window.__TAURI__!.core!.invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    commands.push(command);
    return invoke<T>(command, args);
  };
  await mount(route("Fixture prompt"));
  await click("Envoyer");
  const delta = {
    method: "item/agentMessage/delta",
    params: {
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      itemId: "fixture-message",
      delta: "ha ",
    },
  };
  await emit(delta);
  await emit(delta);
  expect(host.textContent).toContain("ha ha");
  expect(host.textContent).not.toContain("ha ha ha");
  expect(commands).not.toContain("aphrody_session_stream");
});

test("Tauri internals-only windows subscribe through the official native event API", async () => {
  backend();
  const invoke = window.__TAURI__!.core!.invoke;
  const commands: string[] = [];
  const internals = testWindow as unknown as {
    __TAURI_INTERNALS__?: {
      transformCallback: (callback: unknown) => number;
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  };
  window.__TAURI__ = undefined;
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    configurable: true,
    value: { unregisterListener: () => {} },
  });
  internals.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: async (command, args) => {
      commands.push(command);
      if (command === "plugin:event|listen") return 42;
      if (command === "plugin:event|unlisten") return null;
      return invoke(command, args);
    },
  };
  await mount(route());
  expect(commands).toContain("plugin:event|listen");
  expect(commands).not.toContain("aphrody_session_stream");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("fixture-model");
});
