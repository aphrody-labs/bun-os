<!-- SPDX-License-Identifier: Apache-2.0 -->
# UI rules

> **Historical.** These rules come from the WebView-shell era and are superseded by
> [docs/DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), the single Bun OS design system. They are kept as a record;
> do not apply them to new work.

Binding product rules for every view of the desktop app (`packages/app-ui` (not in repo), Drive, examples).
Target surfaces: [`GUI.md`](./GUI.md).

## Scope

- One app, one navigation shell and one sidebar. Drive is the Files feature, not a second app.
- Public areas are Chat, Files, Models and Settings. [`GUI.md`](./GUI.md) defines capability
  exclusions and host boundaries.

## No placeholders

- An unfinished view is not routed. No "coming soon", empty or stub pages, no disabled menu
  entries pointing at nothing.
- Every view is wired to a real backend (app-server, kernel, Drive daemon, `aphrody` CLI)
  before it ships. No mocked data, sample numbers or fake success states.
- When a feature is not ready, remove the page instead of stubbing it.

## No debug output in the UI

- Never render raw JSON, request/thread/process IDs, counts, versions, ports, hostnames, paths
  of internal files, health or status dumps, or stack traces.
- Diagnostics go to logs (`tauri-plugin-log`) and devtools, not to the screen.
- Errors are one short sentence with one action (retry, open settings); details go to the log.

## Copy

- Short labels. No explanatory paragraphs, onboarding essays or feature descriptions in views.
- No marketing, no superlatives, no AI-sounding filler ("Unleash", "Seamlessly", "Powered by").
- Empty states: one line and one action, or nothing.

## Design

- M3 roles, type, shape and motion from the token owners
  ([contract](../architecture/design/APHRODY-M3-CANONICAL-CONTRACT.md)); no hex values or ad-hoc sizes.
- Reuse `@aphrody/m3-*` components; do not add a parallel component set.
