# Aphrody Craft workspace architecture

This document maps the public Adobe app-catalog patterns to the existing Bun OS product. It is a clean-room integration plan, not an Adobe implementation. Adobe product pages, private APIs, marks, media, entitlement logic and proprietary behavior are out of scope.

## Stack

| layer | choice | why |
| --- | --- | --- |
| browser desktop | Existing Bun WebOS TypeScript application | The workspace should be a first-party desktop surface, with independent movable windows and existing app hosting. |
| UI | Existing `@aphrody/m3-theme` and Craft app components | Keep Material 3 tokens, accessible focus/state layers, and shared Aphrody visual identity. |
| runtime and package boundary | Aphrody Bun plus existing Rust owners | Reuse the runtime and Rust-first package owners; do not add another runtime or package workspace. |
| identity | Aphrody Identity owner | Reuse the product's authenticated user and organization context. |
| files | Aphrody Drive owner and its existing Inbox/Services writer contract | Make Drive the shared project/artifact source and route open/save through an owned capability. |
| catalog | Existing WebOS capability registry and generated Craft manifests | Show availability from actual registered, built and qualified artifacts. |
| persistence | Existing Drive and WebOS state owners | Do not introduce a second database or shadow identity/file model. |
| hosting | Existing Bun OS/WebOS release owners | Keep deployment and artifact publication in the central release path. |
| Adobe integration | No server dependency on `adobe-creativity.adobe.io/mcp`; evaluate official Adobe Express Embed/Express API or Firefly Services per user-authorized capability | Adobe documents the Creativity MCP as a connector for Claude. It does not document the endpoint as an API for Craft to call. |

## Boundaries and data ownership

There is no new SQL schema in this integration. The Adobe catalog's cards and filters are reference behavior, not evidence that Aphrody needs Adobe-like subscriptions or an entitlement database. Identity owns user and organization identity; Drive owns file bytes, paths, revisions and conflict handling; each Craft app owns its editing model; WebOS owns window placement/focus and the capability registry owns installable app metadata. A generated manifest can describe an app's stable ID, display name, capability category, supported input/output MIME types, required runtime, artifact URL/hash, qualification status and launch entry point. It must not claim “open” or “installed” until the artifact is present and verified.

The existing PhotoCraft `photocraft:ready/open/save/failed` same-origin bridge is an app-specific adapter. The shared contract should keep source/origin checks and bounded payloads, then route through the Drive writer. Do not let a browser app write arbitrary paths or replace Drive's authorization and revision checks. Other Craft apps should implement narrow adapters for their actual formats; format conversion belongs to an owning app or shared package with explicit loss/error reporting.

## Capability and window flow

| step | owner | behavior |
| --- | --- | --- |
| 1. Discover | WebOS catalog | Search and filter registered Craft capabilities; disclose browser/native requirements and verified state. |
| 2. Resolve | Capability registry | Resolve app ID to an installed artifact and launch target; reject missing, stale-hash or unqualified artifacts. |
| 3. Open | WebOS + Drive | Pass a scoped file handle/revision and permitted actions to a Craft window. Do not expose general Drive credentials to the editor. |
| 4. Edit | Craft app | Preserve its existing editing model; surface unsupported inputs and resource limits before destructive conversion. |
| 5. Save/export | Drive writer | Save against the opened revision; report conflict, quota, offline, or format failure without discarding local edits. |
| 6. Continue | WebOS + compatibility metadata | Offer another Craft app only when its declared input type matches the artifact or an explicit conversion is available. |

Window state (focused, minimized, maximized, tiled, restored) belongs to WebOS. Document content and unsaved edits belong to the app until saved. The host needs a clear dirty/close guard, keyboard focus order, accessible window controls, and error surfaces. Mobile/small widths should use a single active editor surface rather than shrinking desktop chrome into unusable panes.

## Routes and existing interfaces

No new public HTTP API is required for the first vertical slice. Use the current WebOS shell routes, capability registry and Drive open/save interfaces. Exact route names must be taken from their owning code before implementation; this plan does not invent endpoint names. If a later remote catalog API is needed, it must be versioned and owned by WebOS, with Identity checks and Drive permissions enforced by their owners.

| surface | operation | authorization and source of truth | flow |
| --- | --- | --- | --- |
| WebOS catalog | list/search/filter Craft entries | generated capability registry; show only truthful artifact state | F01 |
| WebOS launch | open a registered Craft app | registry verification and WebOS launch policy | F01, F02 |
| Drive open action | open selected file in a compatible Craft app | Drive's existing user/org authorization and scoped file reference | F02 |
| Craft save action | write a new revision or return conflict | Drive writer checks identity, authorization, size and revision | F02, F03 |
| WebOS window manager | move/focus/minimize/restore app windows | current local WebOS session | F02, F03 |

An Adobe developer API integration would be a separate opt-in provider feature, not an implementation of the supplied MCP endpoint. The official Express Embed SDK is for embedding an editor and requires registering the app; Express API and Firefly Services use Adobe Developer Console credentials and OAuth. Select the exact documented capability and consent model before adding a server route. See `backend.md` for the provider decision and blockers.

## Failure and security cases

- **Missing or invalid artifact:** disable launch and show the registry's real build/qualification state; never substitute a placeholder editor silently.
- **Origin and message spoofing:** accept bridge traffic only from the expected same-origin app frame and known message schema; validate source, operation, MIME, size and correlation ID.
- **Drive authorization:** re-check authorization at open and save; a stale scoped handle must not outlive revoked access.
- **Concurrent edits:** send the opened revision; on conflict retain the user's local buffer and provide reload/copy/retry choices owned by Drive's conflict model.
- **Offline and retry:** keep unsaved content visible, make retries idempotent where the writer supports it, and clearly distinguish local draft from persisted revision.
- **Large media:** enforce declared and server-side bounds, cancellation and progress; don't hold duplicate unbounded copies in the shell bridge.
- **Format mismatch:** validate before open/import; conversions must disclose lossy behavior and preserve the source until a successful save.
- **Multi-window:** isolate window/session state and route each save to the correct file/revision; closing a dirty window requires a decision.
- **Keyboard and accessibility:** visible M3 focus, semantic controls, keyboard window switching, reduced motion, responsive narrow layout, and screen-reader labels.
- **Privacy:** catalog/search metadata is not a grant to read Drive; never put file names or identity tokens in public app URLs or telemetry by default.

## Build order

1. **One vertical slice:** WebOS catalog -> verified PhotoCraft launch -> open a Drive file -> edit -> save through the existing bounded bridge -> reopen and confirm the new revision. Include missing-artifact, save-failure and conflict states. This proves the desktop/file boundary before broadening apps.
2. **Shared catalog and window behavior:** use generated manifests for each actually built Craft app; add keyboard window switching, independent windows, minimize/restore and dirty-close behavior.
3. **Per-app format adapters:** onboard each Craft app only with declared supported formats, export behavior, payload limits and qualification evidence. Keep unavailable capabilities visibly unavailable.
4. **Cross-app handoff:** implement compatible-artifact actions and explicit conversions; preserve original files and report loss/failure.
5. **Release:** have the central owner publish artifacts/manifests, deploy the WebOS host at `craft.aphrody.app`, then verify the public host serves the real workspace and launch/open/save flows. A commit or successful build alone is not deployment evidence.

## Qualification gate

The deployment is ready only when the hosted Craft root resolves to the WebOS workspace; the registry entries correspond to actual artifact hashes; each advertised app launches; Drive open/save is tested against authorization and revision conflicts; windows can be focused and managed with keyboard and pointer; and a failed or unavailable app never appears as ready. Native OS desktop qualification and browser WebOS behavior are separate claims.
