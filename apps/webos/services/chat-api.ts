// SPDX-License-Identifier: Apache-2.0
// Route table and standard endpoints of the Aphrody Chat gateway (chat.ts), public as https://api.aphrody.com/v1/chat/
// and on aphrody.com under /api/chat/. The OpenAI-compatible routes keep the OpenAI error body so stock clients work.
import { apiContract, defineApi, type Check } from "../../../packages/bun-os-platform/src/api/index.ts";

const openai = { errorFormat: "openai" as const, tags: ["openai"] };
const openaiError = (description: string) => ({ description, type: "application/json" });

export const chatSpec = defineApi(
  {
    service: "chat",
    title: "Aphrody Chat",
    version: "1.4.7",
    description:
      "OpenAI-compatible chat completions (SSE streaming) in front of Vertex AI Gemini and an optional local router. Base URL for OpenAI clients: https://api.aphrody.com/v1/chat/v1.",
  },
  {
    "GET /v1/models": {
      ...openai,
      summary: "List models",
      responses: { 200: { description: "OpenAI model list" } },
    },
    "POST /v1/chat/completions": {
      ...openai,
      summary: "Create a chat completion",
      description:
        "`stream: true` answers Server-Sent Events. `max_tokens` is capped; requests are budgeted per client.",
      stream: "sse",
      body: { description: "OpenAI ChatCompletionRequest (model, messages, stream, temperature, max_tokens)" },
      responses: {
        200: { description: "Completion, or an SSE stream of chunks", type: "application/json" },
        400: openaiError("Invalid request"),
        404: openaiError("Unknown model"),
        429: openaiError("Request budget exhausted"),
        502: openaiError("Model backend error"),
        503: openaiError("Inference credentials or backend unavailable"),
      },
    },
    "GET /healthz": {
      summary: "Legacy health",
      deprecated: true,
      tags: ["contract"],
      responses: { 200: { description: "Legacy health body; use /health" } },
    },
  },
);

/** /openapi.json and /health under both mounts (gateway root and aphrody.com /api/chat). */
export function chatContract(checks: () => Record<string, Check> | Promise<Record<string, Check>>) {
  return apiContract(chatSpec, { base: ["/api/chat", ""], checks });
}
