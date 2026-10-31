# Desktop host and workspace views

This directory owns what is genuinely native, and the workspace views — no longer an
application. Since the merge of 2026-09-12 there is ONE application (`src/App.tsx`), ONE shell
(`src/shell/UnifiedShell.tsx`) and ONE stylesheet (`src/app.css`); a host adapter only supplies
the resource source and the platform work.

- `BrowserHost.tsx` (in `src/`) is the only host adapter since the Inacord Tauri host was removed
  on 2026-09-26; the Vite `#nie-host` alias points at it and `src/host-mount.tsx` mounts it.
- `Workspace.tsx` renders the views for the current `/inacord/<viewId>` route. It owns no
  navigation, no sidebar, no palette and no toaster — the shell above owns all four, on every
  screen of the product, game screens included.
- `components/` contains the Explorer, the editors and the tools.
- `lib/` contains desktop bindings and compatibility adapters. Shared decoding and domain logic
  remain in their Rust or workspace library owners.
- `lib/bindings.ts` is a frozen contract: its generator (`export-bindings` in the removed
  `inacord` crate) is gone, and the `src/inacord-web/shims` HTTP adapters implement it against
  `nie-site`. Edit it by hand together with the shim and the `nie-site` route.
- `styles.css` is a token layer of `src/app.css`, not a Tailwind entry: it must not re-import
  `tailwindcss`, or the document gets a second preflight and a second, conflicting palette.

`apps/nie-web/tsconfig.json` (not in repo) is the single TypeScript project: one `include`, one `@/*` alias.
The native backend `apps/inacord/src-tauri` (not in repo) was removed on 2026-09-26 (the desktop is aphrody-ui
the COSMIC session of Bun OS; IEVR stays in nie web).
