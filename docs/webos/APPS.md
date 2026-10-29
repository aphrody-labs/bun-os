<!-- SPDX-License-Identifier: Apache-2.0 -->

# WebOS apps

Every app of the monorepo opens in the aphrody.com desktop (`apps/webos`): from the launcher (search finds
member names too, so `pdfcraft-web` finds PDF), from a dock pin, or from its deep link
`https://aphrody.com/<path>`. Nothing in this list is a mock-up: a window either runs the real
implementation or, for an app that cannot run in a browser tab, shows what it really offers (reason,
in-browser counterpart, published builds from the downloads service, README and source).

## Where the data comes from

| Data                                                                                               | Source                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deep-link paths, canonical origin, service hosts, repository browse URL                            | `infra/config/routes.catalog.json` (`apps`, `memberPath`, `source`, `hosts[*].role`)                                                                  |
| App UI routes opened as windows, run kind of monorepo members, default web apps, browser bookmarks | `apps/webos/apps.json`                                                                                                                                |
| Monorepo members (every tracked `apps/*` directory), descriptions, READMEs                         | `apps/webos/build.ts`, written to `dist/catalog.json` and `dist/readme/<member>.md`                                                                   |
| Craft family of a member, package id, file bridges                                                 | `@aphrody/bun-workspace/capabilities`                                                                                                                 |
| Installable packages (Craft, Bun Engine emulators), sha256 per file                                | `apps/webos/packages.ts`, written to `dist/registry.json`                                                                                             |
| Published native builds                                                                            | `GET /api/downloads` (Worker, `apps/webos/worker/downloads.ts`) reads `latest.json` of the downloads service                                          |
| Workspace Documentation and Templates catalogs                                                     | `GET /api/docs`, `GET /api/templates` (Worker): `crates/aphrody-site/data/docs.json` and `packages/m3-templates`, staged by `apps/webos/workspace.ts` |
| Workspace agent service transport (`/rpc`, `/events`, `/notifications`)                            | Answered by the Worker (`apps/webos/worker/app-server.ts`): the service is the private native `aphrody app-server`                                    |
| Shell code that reads them                                                                         | `apps/webos/src/config.ts` (the one config module)                                                                                                    |

Opening a package that is not installed installs it in its own window (every file sha256-verified and
cached for offline use), then starts it. A package that this deployment did not build opens the member
window of its owner with that reason.

## How an app runs

| Mode           | Meaning                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Desktop app    | TypeScript window of the shell (`apps/webos/src/apps/*`), on the Rust OPFS file system where it handles files  |
| Package (wasm) | Built bundle from the registry in a same-origin iframe (`/apps/<package>/`)                                    |
| App UI route   | The shared Workspace (`packages/app-ui`, built with `--base /workspace/`) at `/workspace/<route>` in an iframe |
| Member window  | `src/apps/member.ts`: native, command-line, server, Android, library or example member                         |

## Desktop apps

| App                   | Path             | Source owner                                            | Runs as                                                            | Status                                          |
| --------------------- | ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Files                 | `/files`         | `src/apps/files.ts`, `packages/webos-wasm`              | Desktop app, Rust VFS in OPFS                                      | Runs                                            |
| Aphrody Drive         | `/drive`         | `src/apps/files.ts` on `~/Projects`                     | Desktop app, same VFS as Files                                     | Runs                                            |
| Browser               | `/browser`       | `src/apps/browser.ts`, `/api/browse`                    | Desktop app; pages through the script-free edge reader             | Runs; Aphrody addresses open as desktop windows |
| Apps (App Store)      | `/apps`          | `src/apps/appstore.ts`, `src/pkg.ts`                    | Desktop app over `registry.json`                                   | Runs                                            |
| Aphrody Creative      | `/art`           | `src/apps/creative.ts`                                  | Desktop app: Craft packages and native studios                     | Runs                                            |
| Terminal              | `/terminal`      | `src/apps/terminal.ts`                                  | Desktop app, Rust shell in wasm                                    | Runs                                            |
| Docs                  | `/docs`          | `src/apps/docs.ts`, `apps/webos/docs.ts`                | Desktop app over `dist/docs`                                       | Runs                                            |
| Alpine Linux          | `/linux`         | `src/apps/linux.ts`, `apps/webos/vm.ts`                 | Desktop app, v86 with the Alpine ISO from R2                       | Runs                                            |
| Media                 | `/media`         | `src/apps/media.ts`                                     | Desktop app                                                        | Runs                                            |
| Video Studio          | `/video`         | `src/apps/video.ts`                                     | Desktop app (canvas compositor, WebM export); hands media to Video | Runs                                            |
| TypeScript playground | `/playground`    | `src/apps/engine.ts`, esbuild-wasm                      | Desktop app, module worker                                         | Runs; Bun-only APIs listed as unavailable       |
| Inspector             | `/inspector`     | `src/apps/inspector.ts`                                 | Desktop app                                                        | Runs                                            |
| Source catalog        | `/source`        | `src/apps/store.ts` over `catalog.json`                 | Desktop app; every app opens from here                             | Runs                                            |
| Material 3 components | `/components`    | `src/apps/showcase.ts`, `@aphrody/material-web`         | Desktop app                                                        | Runs                                            |
| Theme builder         | `/theme-builder` | `src/apps/themebuilder.ts`, `@aphrody/m3-tokens`        | Desktop app                                                        | Runs                                            |
| Web apps              | `/web-apps`      | `src/apps/webapps.ts`, defaults in `apps.json`          | Desktop app; sites open in their own window                        | Runs                                            |
| Calculator            | `/calculator`    | `src/apps/calculator.ts`                                | Desktop app                                                        | Runs                                            |
| Disk Usage            | `/storage`       | `src/apps/storage.ts`                                   | Desktop app                                                        | Runs                                            |
| Activity              | `/activity`      | `src/apps/activity.ts`                                  | Desktop app                                                        | Runs                                            |
| Keyboard              | `/keyboard`      | `src/keys.ts`                                           | Desktop app                                                        | Runs                                            |
| About                 | `/about`         | `src/main.ts`, `/api/health`                            | Desktop app                                                        | Runs                                            |
| Settings              | `/settings`      | Settings owner (`src/apps/settings.ts`, `src/prefs.ts`) | Desktop app                                                        | Runs                                            |
| Aphrody Workspace     | `/workspace/`    | `packages/app-ui`                                       | App UI (full page, or a desktop window)                            | Runs                                            |

## App UI routes

| App        | Path         | Route                   | Status                                                                          |
| ---------- | ------------ | ----------------------- | ------------------------------------------------------------------------------- |
| Play       | `/play`      | `/workspace/games`      | Runs; lists the qualified emulator packages                                     |
| Templates  | `/templates` | `/workspace/templates`  | Runs; the `packages/m3-templates` templates with their files (`/api/templates`) |
| Material 3 | `/material`  | `/workspace/material-3` | Runs; the pages this host can run (see below)                                   |

The Workspace serves its Documentation from `/api/docs` and opens its in-browser Files and Terminal
over the Rust WebAssembly backend. What needs a native owner is not offered in the browser:

- Chat, Models, Studio, Creator tools, Administration and Jobs are not WebOS windows. They drive the
  agent service (`crates/aphrody-app-server`, private per `infra/config/application-contracts.json`,
  `aphrody.ai.publicProduct: false`), Tauri commands of `apps/aphrody-app` or the Drive daemon, and
  open in the Aphrody desktop app. The Workspace sidebar lists them only where those run.
- The session chip, the home web search (`/api/search`, native Google search owner), Drive jobs and
  sync, Ask Aphrody, media jobs and tags in the inspector are hidden on the in-browser backend.
- Material 3 drops Design, Next and System (standalone Bun host API) on every native host, and the
  live Theme page (Rust scheme route `/api/m3/css`) in the browser; the desktop Theme builder
  (`/theme-builder`) builds schemes in the browser.
- The Worker still answers the agent service transport (`/rpc`, `/events`, `/notifications`) with a
  JSON-RPC "method not found" carrying that reason, for clients that call it anyway.

## Packages (registry)

The 13 Craft browser apps are compiled by `apps/webos/build-craft.ts` (wasm32, egui/eframe) on the VPS
factory; `apps/webos/deploy.ts` refuses a deployment without all of them. Fonts the pages fetch at run
time ship in the package: Images serves `fonts/manifest.txt` and every face it lists, Photo processing
its Simplified Chinese face as `lightcraft_zh_hans.otf` (with the render `worker.js`), each with its
OFL notice. Compositing starts on a blank project; `?demo` opens the demo project. The Bun Engine emulators come
from `packages/bun-engine/web-emulation` and join the registry only with a valid qualification receipt.

| App                | Path      | Package         | Source owner                                                    | Status                                                                                     |
| ------------------ | --------- | --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Video              | `/film`   | `craft-film`    | `apps/filmcraft-web`                                            | Runs (wasm)                                                                                |
| Images             | `/photo`  | `craft-photo`   | `apps/photocraft-web`                                           | Runs (wasm); opens image files from Files                                                  |
| Vectors            | `/vector` | `craft-vector`  | `apps/vectorcraft-web`                                          | Runs (wasm)                                                                                |
| Compositing        | `/effect` | `craft-effect`  | `apps/effectcraft-web`                                          | Runs (wasm)                                                                                |
| Photo processing   | `/light`  | `craft-light`   | `apps/lightcraft-web`                                           | Runs (wasm)                                                                                |
| PDF                | `/pdf`    | `craft-pdf`     | `apps/pdfcraft-web`                                             | Runs (wasm); opens PDF files from Files                                                    |
| Documents          | `/word`   | `craft-word`    | `apps/wordcraft-web`                                            | Runs (wasm)                                                                                |
| Audio              | `/sound`  | `craft-sound`   | `apps/soundcraft-web`                                           | Runs (wasm)                                                                                |
| Layout             | `/design` | `craft-design`  | `apps/designcraft-web`                                          | Runs (wasm)                                                                                |
| CAD                | `/cad`    | `craft-cad`     | `apps/cadcraft-web`                                             | Runs (wasm); opens DXF/DWG from Files                                                      |
| Slides             | `/deck`   | `craft-deck`    | `apps/deckcraft-web`                                            | Runs (wasm); opens decks from Files                                                        |
| Tables             | `/grid`   | `craft-grid`    | `apps/gridcraft-web`                                            | Runs (wasm); opens XLSX from Files                                                         |
| Interface layouts  | `/fig`    | `craft-fig`     | `apps/figcraft-web`                                             | Runs (wasm)                                                                                |
| Nintendo DS (Dust) | `/ds`     | `game-dust-nds` | `packages/bun-engine/web-emulation`, `crates/aphrody-dust-core` | Runs when its qualification receipt is present; otherwise the IECODE member window says so |

Generation (`artcraft`) has no browser build: `/art` opens Aphrody Creative, whose native studio card
opens the ArtCraft member window.

## Monorepo members (`apps/*`)

Members of kind web open their package or desktop app directly; every other member opens its member
window at `/source/<member>`. The reason shown is the kind's: a native app needs the operating system's
windows, GPU and disks; a command-line tool runs in a terminal; a server needs its own backend; an
Android app installs on a device; a library has no window; an example is read and run locally.

| Member                                                                                  | Kind                                                     | Opens                         | In-browser counterpart |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- | ---------------------- |
| aphrody-app                                                                             | Desktop (Tauri 3)                                        | `/source/aphrody-app`         | Aphrody Workspace      |
| aphrody-drive                                                                           | Server (Drive backend)                                   | `/source/aphrody-drive`       | Aphrody Drive          |
| aphrody-examples                                                                        | Example                                                  | `/source/aphrody-examples`    |                        |
| aphrody-model-view                                                                      | Desktop                                                  | `/source/aphrody-model-view`  | Files                  |
| artcraft, artcraft_native                                                               | Desktop                                                  | `/source/<member>`            | Aphrody Creative       |
| artcraft-web-app                                                                        | Server (needs the ArtCraft API)                          | `/source/artcraft-web-app`    | Aphrody Creative       |
| bun-android                                                                             | Android                                                  | `/source/bun-android`         |                        |
| `<craft>-web` (13)                                                                      | Web                                                      | the Craft package             | itself                 |
| `<craft>` desktop apps (12: cad has only a web build)                                   | Desktop                                                  | `/source/<member>`            | the Craft package      |
| `<craft>-cli` (12)                                                                      | Command line                                             | `/source/<member>`            | the Craft package      |
| figcraft-server                                                                         | Server                                                   | `/source/figcraft-server`     | Interface layouts      |
| desktop                                                                                 | Desktop (Tauri v3)                                       | `/source/desktop`             | Aphrody Workspace      |
| iecode-dotnet                                                                           | Desktop (.NET)                                           | `/source/iecode-dotnet`       |                        |
| iecode-web                                                                              | Server (webpack frontend)                                | `/source/iecode-web`          | Nintendo DS (Dust)     |
| iecode-web-wasm                                                                         | Web                                                      | Nintendo DS (Dust)            | itself                 |
| iecode-web-wii-wasm                                                                     | Library                                                  | `/source/iecode-web-wii-wasm` | IECODE Web member      |
| java-ffi                                                                                | Library                                                  | `/source/java-ffi`            | bun-android member     |
| m3-next-example, m3-next-tauri-example, m3-published-consumer | Example                                                  | `/source/<member>`            | Material 3 components  |
| m3-showcase                                                                             | Server                                                   | `/source/m3-showcase`         | Material 3 components  |
| play                                                                                    | Server (Bun.serve + NGINX: Steam, LAN cache, gamestream) | `/source/play`                | Play                   |
| rg-website                                                                              | Server (Next.js)                                         | `/source/rg-website`          |                        |
| webos                                                                                   | Web                                                      | About                         | itself                 |
| webos-server                                                                            | Server                                                   | `/source/webos-server`        | About                  |

## What cannot run in the browser, and why

- Native desktop apps (`aphrody-app`, `desktop`, `aphrody-model-view`, the Craft desktop apps,
  `artcraft`, `artcraft_native`, `iecode-dotnet`): Tauri, egui-native or .NET windows that need the
  operating system's windowing, GPU and disk access. Their browser counterparts are the Craft packages
  and the Workspace.
- Command-line tools (the Craft `-cli` members): terminal programs and MCP servers.
- Servers (`play`, `webos-server`, `aphrody-drive`, `figcraft-server`, `m3-showcase`, `iecode-web`,
  `artcraft-web-app`, `rg-website`): each needs its own backend process; `play` streams games over
  WebRTC from its own host.
- `bun-android`, `java-ffi`: Android only.
- Published builds: the member window lists the artifacts of the downloads service; when the service
  is down it says so with the HTTP status instead of inventing a list.
