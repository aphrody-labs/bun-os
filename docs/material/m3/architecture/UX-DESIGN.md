<!-- SPDX-License-Identifier: Apache-2.0 -->
# Desktop UX flows

> **Historical.** These rules come from the WebView-shell era and are superseded by
> [docs/DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), the single Bun OS design system. They are kept as a record;
> do not apply them to new work.

This document defines the public-facing flows in the desktop webview. [UI design](./UI-DESIGN.md)
owns layout and appearance; [GUI](../reference/GUI.md) owns runtime boundaries and evidence; [UI rules](../reference/UI-RULES.md)
own shippable copy and behavior. Keep the webview focused on Chat, Files, Models and Settings.

## Chat

1. Open the app without waiting for Drive or model downloads. Show agent readiness and
   recoverable errors truthfully.
2. Select a project and available model, enter a request and start a real app-server turn.
3. Project streamed messages and tool activity by stable IDs. Show approvals as explicit,
   accessible choices and reflect the backend's actual result.
4. Keep interruption available during work. On disconnect, preserve readable history,
   reconcile from backend state and never silently replay side effects.

## Files

1. Show Drive availability independently of Chat. If the daemon is unavailable, keep the
   route usable and provide a clear recovery action.
2. Browse locations and files in list/grid views; support real search, selection, preview,
   tagging and supported file operations through Drive.
3. Start OCR, transcription, indexing or other supported work from the relevant file or
   location. Present progress and results from the owning job/service, with retry on failure.

## Models and Settings

Models show actual catalog/install/runtime state and provide supported download, verify,
select and remove actions. Settings expose user preferences and app configuration through
owned APIs. Both areas use the same keyboard, focus, loading, empty and error behavior.

## Product boundaries

The [GUI contract](../reference/GUI.md) defines excluded webview capabilities and explicit backend actions.
Any standalone browser or system shell follows the [native packaging policy](../reference/NATIVE-DESKTOP.md).

## Interaction rules

- Keep one primary action per state and provide cancellation where the owner supports it.
- Confirm destructive user data changes; do not confirm reversible navigation.
- Preserve keyboard focus and selection across updates. Dialogs return focus to their trigger.
- Distinguish unavailable, loading, failed and completed states; never imply that a queued or
  locally simulated action has completed.
- Prefer contextual actions on files, threads or models over new global pages.

These flows are targets. Mark each one complete only with runtime evidence from its real
backend, keyboard and screen-reader behavior, and a packaged desktop build.
