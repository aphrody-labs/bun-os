# @aphrody/app-ui

The App UI web front end of Bun OS (its Tauri host `apps/aphrody-app` was retired on 2026-10-31)
(shell, top bar, command palette, chat and Codex surfaces, explorer, models hub, settings,
onboarding, pet). Built on the M3 packages of this repository (`@aphrody/m3-*`, `@aphrody/assets`,
`@aphrody/identity`).

The root Bun OS workspace installs and links this package and its canonical
dependencies. Native execution remains host-bound: the desktop and identity
owner is `crates/aphrody-identity`. Workspace membership
does not prove that a native desktop artifact has been built or launched.

The browser shell includes `/games/:core?` (`/workspace/games` in WebOS).
Its Games navigation, M3 cards and controls consume the public qualified package
registry at `/registry.json`. Selecting an emulator embeds its existing product
player; closing the player removes the iframe and ends that browser session.
No second emulator loader or runtime is implemented in App UI. Publication and
qualification of emulator packages remain with Bun Engine and WebOS assembly.

| Script              | Does                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `bun run dev`       | Native M3 development server on port 1421 (`tauri.conf.json` `build.devUrl`) |
| `bun run build`     | `build.ts`: native M3 build into `dist`                                      |
| `bun run test`      | `bun test src` (layout parity, chat, history, brand theme, ...)              |
| `bun run typecheck` | Native `bun check -p tsconfig.json --noEmit`                                 |
| `bun run brand`     | regenerates the brand theme (`scripts/brand-theme.ts`)                       |

Configuration: `m3.config.ts` (entry `src/index.html`, Tauri `uiDist`), `bunfig.toml`.

## Browser transport

From the selected Bun OS root, start the native backend with
`aphrody app-server --http --addr 127.0.0.1:8765`, then serve the built UI with
`bun run desktop:ui:serve`. Development via `bun run dev` uses the same proxy
configuration in `backend.ts`. `APHRODY_APP_SERVER_URL` selects another loopback
HTTP origin.

M3 forwards `/rpc`, `/events`, `/notifications`, `/health` and `/healthz`
unchanged. Backend failures remain failures. Desktop-only commands use real
Tauri IPC in the desktop host; the browser server does not impersonate Tauri.
The frontend starts no backend process and owns no model, crawl or RAG store.

## Aphrody Search

The product search home offers Search and Agent task modes, each over public
web results or the local indexed knowledge source. Indexed knowledge uses
`@aphrody/web-crawl/browser` and calls the versioned `/api/v1/rag/search`
endpoint. Set
`VITE_APHRODY_SEARCH_API_URL` to the Aphrody MCP HTTP origin when it is not
served through the app's own origin; otherwise the same-origin route is used.
The browser client sends no bearer token, so cross-origin deployments must be
configured by the operator with an authenticated gateway and appropriate
CORS. Search displays ranked result or passage excerpts. Agent first runs that
same search, then sends the question and up to eight excerpts to the
OpenAI-compatible chat gateway and streams the answer beside its source list.
By default, chat uses the same-origin `/api/chat/v1` gateway. Configure
`VITE_APHRODY_CHAT_API_BASE_URL` only for an already protected public endpoint;
never put a server bearer token in a `VITE_` variable or browser bundle.
Generated citation markers are not verified citation metadata, and Agent does
not yet persist multi-step runs or support schema-constrained output.
