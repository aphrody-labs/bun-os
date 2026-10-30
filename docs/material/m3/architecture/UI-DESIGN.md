<!-- SPDX-License-Identifier: Apache-2.0 -->
# Desktop UI design

This is the visual authority for the single public desktop webview in
[`packages/m3`](../../packages/m3). [GUI](../reference/GUI.md) owns host and capability
boundaries; [UX](./UX-DESIGN.md) owns flows; [UI rules](../reference/UI-RULES.md) bind shipped
content and behavior. Descriptions here are design constraints, not proof that a
feature is implemented.

## 1. Product surface

One window and one navigation for four areas:

| Area | Purpose |
| --- | --- |
| Chat | Work with the out-of-process agent and inspect its real actions and results. |
| Files | Browse Drive locations, tags and files; preview and invoke supported file actions. |
| Models | Inspect and manage models through their owning services. |
| Settings | User preferences and application configuration. |

Do not add product areas beyond these four. Host and capability exclusions are defined in
[GUI](../reference/GUI.md); standalone GUI packaging is covered by [native desktop](../reference/NATIVE-DESKTOP.md).

## 2. Base and references

The visual references are indexed in [`assets/ui/manifest.json`](https://github.com/aphrody-labs/aphrody/blob/main/assets/ui/manifest.json).
The file navigation and explorer follow the Files conventions of the shell; Codex informs Chat and its composer;
Material 3 owns roles, states and accessibility. These are visual references, not runtime
requirements or permissions to copy source. Preserve per-file upstream provenance.

## 3. Layout and components

Use a compact navigation rail/sidebar, a clear top bar and one primary content region.
Files owns its explorer toolbar, list/grid views and contextual inspector. Chat owns its
thread timeline, composer, model selection and inline approval/result states. Models and
Settings use the same spacing, headings, dialogs and status language. Avoid a second global
navigation, nested product shells, diagnostic dashboards and developer consoles.

Use the maintained Base UI fork for accessible React interaction primitives and the
maintained Tailwind CSS fork for utility styling. Both are adapted to M3 in the Bun
workspace. `aphrody-m3-tokens` is the token source; do not add a second palette or a local
CSS token authority. Lit/material-web remains a distinct package renderer sharing M3 roles.

## 4. Accessibility and visual behavior

Follow [`ACCESSIBILITY.md`](../reference/ACCESSIBILITY.md): minimum 18 px text, high contrast, visible
static focus, keyboard operation, screen-reader labels and reduced motion. Use semantic
HTML, visible focus return after dialogs, and distinct focus targets for independent actions.
Prefer stable layouts, concise labels, real loading/error/empty states and user-readable
recovery. Do not display backend details, raw shell output or simulated data as product UI.

## 5. Implementation status

The active implementation lives in `packages/app-ui` (not in repo); route and feature status belongs to
[GUI.md](../reference/GUI.md). Historical terminal/browser concepts and obsolete mockups do not override
this scope. Rust render and M3 crates remain reusable libraries; a standalone native host
is a packaging decision, not a requirement to rewrite the desktop.
