# Features of the retired M3 Drive copy with no upstream equivalent

The M3-refactored copy of Spacedrive (`apps/aphrody-drive`, `crates/aphrody-drive`,
`packages/drive-client`, the explorer half of `packages/app-ui`) was removed in favour of a fresh
fork of `spacedriveapp/spacedrive` (`aphrody-labs/spacedrive`, Apache-2.0). Git history keeps
everything: the last commit that contains the copy is tagged `legacy/aphrody-drive-last`.

The copy was compared with upstream `main` (4d41a379f6, 2026-10-13). Explorer routes (redundancy,
file kinds, sources and adapters, tags, jobs, sync monitor, quick preview, inspector) all exist
upstream; only the items below do not, and are to be rebuilt on the new integration where wanted.

| Feature | Where it lived (at the tag) | Status |
| --- | --- | --- |
| Tauri 3 plugin that supervises `sd-daemon` (staged next to the app or on `PATH`, data dir, autostart service, native drag, file opening, keybinds, macOS FDA) | `crates/aphrody-drive` | Upstream has its own Tauri host (`apps/tauri`); port the supervision/autostart to the unified Tauri set only if still needed |
| `resvg` SVG rasterisation in `sd-images`, equal to `aphrody-svg::raster` | `apps/aphrody-drive/crates/images/src/svg_raster.rs` | Not upstream; re-apply as a patch on the fork if SVG thumbnails are required |
| Bun-native daemon transport (`Bun.connect` Unix socket / named pipe) and generated wire types | `packages/drive-client/src/bun.ts`, `socket-transport.ts` | Upstream ships `packages/ts-client`; check it covers Bun sockets before dropping |
| Mounting the Google Drive `dbfr` folder as a Spacedrive cloud volume (OpenDAL `gdrive`) plus an indexed location | `packages/app-ui/src/routes/studio/DriveStudio.tsx`, Drive OAuth in `packages/google` (`drive-cli.ts`) | The OAuth command stays; the volume mount must be redone against the new core (`volumes.add_cloud` exists upstream) |
| Browser backend that answers the explorer wire protocol from the OPFS VFS (`Query`/`Action` envelopes) | `crates/aphrody-webos-wasm/src/rpc.rs`, `apps/webos/src/apps/files-wire.ts` | Kept for the pure-browser webos; the native build talks to the Spacedrive daemon |
| Chat attachments typed for local models (`buildTurnInputItems`) | `packages/app-ui/src/turn-input.ts` | Kept (moved out of the explorer route) |
| "Ask Aphrody" prompt built from selected files, OCR / audio-video eligibility | `routes/explorer/ai-helpers.ts` | Dropped with the explorer; rebuild on the new interface if wanted |

The retired `apps/aphrody-app/ui-dist/app.js` was a committed build of `packages/app-ui`; it contained the
removed explorer until `packages/app-ui` is rebuilt and staged.
