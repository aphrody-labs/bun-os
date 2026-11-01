# Aphrody Search Agent mode

The Aphrody Search home offers two task modes:

- **Search** returns ranked public-web results or passages from the configured
  local RAG index.
- **Agent** runs the same search first, then streams an answer from Aphrody's
  configured OpenAI-compatible chat service. The page shows the retrieved
  evidence beside the answer and supports stopping the stream.

Agent mode sends the user's query and up to eight search excerpts to the
configured Aphrody model service. The browser package does not contain a
provider API key. By default it calls the same-origin
`/api/chat/v1/chat/completions`; set `VITE_APHRODY_CHAT_API_BASE_URL` to a public API root
only when that endpoint is already protected by an authenticated gateway.
Never put a server bearer token in a `VITE_` variable or browser bundle.

The browser client uses the built-in `streamChatCompletion` transport from
`@aphrody/m3-ai`. The default endpoint is the existing WebOS chat gateway, which
uses server-side Google credentials, limits model choices and token count, and
applies a per-client request budget. The alternative Aphrody Rust chat gateway
can be configured with `APHRODY_AI_CHAT_BASE_URL`; if it requires
`APHRODY_AI_HTTP_TOKEN`, a trusted gateway must authorize the browser request
and inject that token. The page must not receive a server bearer token. Without
an available chat service, Search results remain visible and Agent mode reports
an unavailable state.

## Current boundary

The streamed answer is prompted to cite evidence with numbered markers, and
the corresponding source records are shown below it. The chat-completions
contract does not return verified citation-to-claim metadata, so those markers
are model-generated and the UI does not claim that citations were validated.
The current Agent mode is one streamed answer over a single search result set;
it does not persist a research run, execute iterative searches, validate a
JSON output schema, or track a per-run provider budget.

The optional local-index source uses `/api/v1/rag/search?mode=hybrid`, through
the same Aphrody retrieval endpoint used by MCP. It sends the resulting
excerpts to the configured chat service only after the user selects Agent.

Exa's public API is documented separately in
[`replica/aphrody-search/exa-recon.md`](../../replica/aphrody-search/exa-recon.md).
No Exa credential or provider adapter is configured by this UI change.
