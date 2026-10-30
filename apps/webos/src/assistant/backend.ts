// SPDX-License-Identifier: Apache-2.0
// Pluggable model backend of the assistant. Both supported backends speak the OpenAI-compatible chat protocol with
// server-sent events: the local `llama-server` of llama.cpp (the native side runs it over `aphrody-llama-sys`) and any
// hosted API the user brings their own key for. The key lives in the user's preferences only, never in the repository.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AssistantBackend {
  readonly id: string;
  /** Stream the answer as text fragments. */
  ask(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string, void, void>;
}

export interface BackendConfig {
  kind: "llama" | "hosted";
  /** API root such as `http://127.0.0.1:8080/v1`. */
  baseUrl: string;
  model: string;
  /** Required for `hosted`. */
  apiKey?: string;
}

export class BackendError extends Error {}

export function openAiCompatible(cfg: BackendConfig, fetcher: typeof fetch = fetch): AssistantBackend {
  return {
    id: cfg.kind,
    async *ask(messages, signal) {
      if (!cfg.baseUrl.trim()) throw new BackendError("Set the assistant base URL in Settings.");
      if (cfg.kind === "hosted" && !cfg.apiKey?.trim()) throw new BackendError("Set your API key in Settings.");
      const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
      if (cfg.apiKey?.trim()) headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
      const response = await fetcher(`${cfg.baseUrl.replace(/[/]+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: cfg.model, messages, stream: true }),
        signal,
      });
      if (!response.ok || !response.body) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new BackendError(`${cfg.kind} backend answered ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta
              ?.content;
            if (delta) yield delta;
          } catch {
            // keep-alive or a comment line
          }
        }
      }
    },
  };
}

/** Context from the content index (BM25 over the user's files) placed before the question. */
export interface Excerpt {
  path: string;
  line: number;
  text: string;
}

export function buildMessages(question: string, excerpts: Excerpt[]): ChatMessage[] {
  const context = excerpts.length
    ? "\n\nExcerpts of the user's files that may help:\n" +
      excerpts.map(e => `- ${e.path}:${e.line}\n${e.text}`).join("\n")
    : "";
  return [
    {
      role: "system",
      content:
        "You are the assistant of Bun OS. Answer briefly and concretely. When you use an excerpt, name its file." +
        context,
    },
    { role: "user", content: question },
  ];
}
