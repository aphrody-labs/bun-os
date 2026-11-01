# Aphrody Search build log

| Screen | Date | Status | Missing | Notes |
| --- | --- | --- | --- | --- |
| S01 | 2026-11-01 | Partial | Deploy this React surface into the production Bun OS app, responsive production visual capture, structured outputs, verified citation metadata, persistent multi-step research runs, Exa provider adapter | Added Search/Agent mode choice. Agent mode runs the selected live-web or indexed search, sends the query plus up to eight excerpts to Aphrody's configured same-origin chat endpoint, streams the answer, supports stop/retry, and displays the matching source list. The production `/api/chat/v1/models` route returned 200. Targeted component typecheck, lint and tests pass (4 tests); the complete app-ui typecheck still has unrelated Material Web errors and missing workspace package files. No provider key is bundled. |
