# Bun frontend library

This workspace adapts the upstream open source frontend library to Bun 1.4.4
from the former Bun fork. Internal names, source history and licences remain upstream.

From this `frontend/` directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
bun run build
bun run preview
```

Development binds `127.0.0.1:5173`; `--port N` selects another port. Source
changes rebuild and reload the page. React state is not preserved through HMR.
Preview serves the existing build. Neither command terminates other processes.

`Bun.build` writes `apps/artcraft/dist` for the upstream native launcher. It
retains source aliases/workspaces, React lazy imports, Tailwind 3/PostCSS,
public resources, inline drawing/FBX workers, Markdown content, Spark and
OpenCut WASM glue. Separate library `dist/` builds are unnecessary.

Only `VITE_ENVIRONMENT_TYPE` and `VITE_POSTHOG_API_KEY` enter browser code;
their existing names remain compatible. Credentials, cookies and sessions
remain in their isolated stores.

`bun scripts/unix-dev.mjs` starts the upstream Tauri 2 launcher and Bun frontend
on a free loopback port starting at `ARTCRAFT_DEV_PORT` (5193 by default).
The superproject owns the separate canonical Bun Tauri v3 integration.

The performance tool uses Bun's builder/server. Existing Vitest projects keep
Vite, React, declaration and WASM plugins for their opt-in test configurations.
Inactive application Vite/Nx configs and the npm lockfile have been removed.
Publishing workflows now install the fork's pinned Bun runtime and use its
lockfile/build; native signing remains platform-specific.

The production frontend compiled on native Windows with Bun 1.4.4 revision
`2ae8fc65fba1d05c423a2433b1195835109942b6`. Browser/provider execution, native
packaging, signing and tests were not qualified by this migration. The unchanged
upstream dev-launcher tests still expect Vite and need migration before use.

Preserve `LICENSE-*`, `NOTICE` and asset attribution. `NOTICE` identifies some
upstream public resources without distribution rights; the local build does
not qualify distribution of those resources.
