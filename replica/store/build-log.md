# Store UI build log

## Decisions

- Reuse of open-source stores (coordinator message): flathub-infra/website is a Next.js app and does not fit the WebOS shell (vanilla TypeScript with M3 web components). fdroidserver and winget-restsource have no Bun OS APK or Windows artifacts to feed. The UI therefore stays original TypeScript in the WebOS shell, following the Play Store and Microsoft Store layouts as clean-room replicas (see `replica/playstore/recon.md`, `replica/msstore/recon.md`). AppStream and Flatpak metadata come from `flatpak build-export` (repo builder in `apps/webos/store/flatpak.ts`). No vendor submodules were added.
- Data: only `/api/store/catalog`, `/api/store/qualification` and `/registry.json`. Ratings are always "No ratings yet"; ranked lists use size and install-test results and say so.
- Code: `apps/webos/src/apps/appstore.ts` (orchestrator) and `apps/webos/src/apps/appstore/*.ts` (one module per screen), styles in `apps/webos/src/apps/appstore.css` (M3 tokens only, container queries on the window).

## Screens

| Screen | Commit message | Verified |
|--------|----------------|----------|
| S01 shell | store UI S01 | tabs, search field, Library and Sources, skip link, toast; skeleton and error states; live on aphrody.com at 1440 and 390 |
| S02 home | store UI S02 | hero carousel (dots, arrows, pause, reduced motion), source chips, shelves, ranked lists; live |
| S03 collection | store UI S03 | category and source chips, sort, paging; live (games) |
| S04 search | store UI S04 | combobox suggestions with keyboard, ranked results, source filter; live (`?q=pdf`: 39 results) |
| S05 detail | store UI S05 | fact strip, about, uses, requirements, versions, ratings empty state, similar apps; live |
| S06 install | store UI S06 | browser install with progress, download, copyable commands, agent one-click when connected, sticky bar; install group shown live, Install click not exercised |
| S07 library | store UI S07 | installed and updates, update all, empty states; live empty state |
| S08 sources | store UI S08 | repository URL, setup line, install-test steps (5 of 6 formats pass), agent URL; live |
| S09 states | store UI S09 | skeleton, empty, error with retry, not found; live (`?store=nope`) |

## Defects found and fixed

- Detail page overflowed horizontally because code lines in command boxes widened the grid: grid columns now `minmax(0, 1fr)`.
- Shelves were ordered by count (libraries first): now Games, Create, Tools, System, Android, Libraries, Linux.
- Release versions with build metadata (`0.7.1+web.abc`) are shown as `0.7.1` in tiles and hero; the fact strip keeps the full string.
- Typecheck error in detail.ts (null sticky bar) fixed.

## Defects left

- On a 390 px viewport, deep links into `/apps` leave the shell launcher grid faintly visible behind the Store window while it fades; this is the WebOS shell transition, not Store code. Only the Home screen has a clean 390 capture (`clone-screens/S02-home-390.jpg`); the desktop captures are 1440 px. Headless Chrome cannot render a 390 px layout (500 px minimum window), so the other 390 px screens were checked in the built-in browser only.
- Android APK source has no packages (no built APK or SDK on the VPS).
- Agent one-click install was not exercised: no Bun OS agent answers `/api/agent/status`.
