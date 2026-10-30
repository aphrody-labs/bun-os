// SPDX-License-Identifier: Apache-2.0
// Aphrody Chat: conversation with the configured inference backend (llama.cpp llama-server over aphrody-llama-sys, or a
// hosted OpenAI-compatible API). Answers stream from the backend; when none is reachable the error is shown as is.
import { h } from "../dom";
import type { AssistantBackend, ChatMessage } from "../assistant/backend";

export function chatApp(root: HTMLElement, backend: () => AssistantBackend) {
  const history: ChatMessage[] = [
    { role: "system", content: "You are Aphrody Chat, the assistant of Bun OS. Answer concisely." },
  ];
  const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const field = h("textarea", { class: "fld grow", rows: "2", "aria-label": "Message", placeholder: "Message Aphrody Chat" }) as HTMLTextAreaElement;
  const send = h("button", { class: "btn" }, "Send") as HTMLButtonElement;
  let abort: AbortController | undefined;

  const bubble = (role: string, text: string) => {
    const el = h("div", { class: `chat-msg ${role}` }, text);
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  async function submit() {
    const text = field.value.trim();
    if (!text || send.disabled) return;
    field.value = "";
    history.push({ role: "user", content: text });
    bubble("user", text);
    const out = bubble("assistant", "…");
    send.disabled = true;
    abort = new AbortController();
    let answer = "";
    try {
      for await (const part of backend().ask(history, abort.signal)) {
        answer += part;
        out.textContent = answer;
        log.scrollTop = log.scrollHeight;
      }
      history.push({ role: "assistant", content: answer });
    } catch (error) {
      out.classList.add("error");
      out.textContent = `${answer}${answer ? "\n" : ""}${error instanceof Error ? error.message : String(error)}`;
      if (!answer) history.pop();
    } finally {
      send.disabled = false;
      field.focus();
    }
  }
  send.addEventListener("click", () => void submit());
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });
  root.append(h("div", { class: "chat" }, log, h("div", { class: "chat-input" }, field, send)));
  root.addEventListener("remove", () => abort?.abort());
  queueMicrotask(() => field.focus());
}
