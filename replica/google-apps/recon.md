# Recon Map: Comprehensive Google Web Apps Ecosystem

**Scope:** The entire consumer, communication, media, spatial, and productivity web application footprint of Google beyond and including Workspace. Replicated clean-room for **Bun OS / Aphrody WebOS** using first-party Rust WebAssembly engines, upstream Bun (`v1.4.4+`), local-first OPFS/SQLite storage, and private WebRTC/WireGuard mesh networking.  
**Target Suite Coverage:**
1. **Search & Knowledge:** Google Search, Google Lens, Google Scholar $\rightarrow$ Aphrody Search (`packages/aphrody-web`, `packages/google/src/search.ts`, `apps/search`).
2. **Media & Streaming:** YouTube, YouTube Music $\rightarrow$ Aphrody Media, FilmCraft (`apps/filmcraft`), SoundCraft (`apps/soundcraft`).
3. **Geo & Spatial:** Google Maps, Google Earth $\rightarrow$ Vector GIS, MapLibre WebGPU tiles, 3D spatial renderer (`packages/viz3d`).
4. **Communication:** Gmail, Google Meet, Google Chat, Google Contacts $\rightarrow$ Aphrody Mail, A2A WebRTC (`packages/a2a`), Aphrody Chat, Contacts (`packages/identity`).
5. **Planning & Personal Org:** Google Calendar, Google Keep, Google Tasks $\rightarrow$ Aphrody Calendar, WordCraft Quick Notes, Aphrody Tasks.
6. **Photos & Media Management:** Google Photos $\rightarrow$ LightCraft (`apps/lightcraft-web`, `crates/lightcraft-*`).
7. **Finance & Travel:** Google Finance, Google Flights $\rightarrow$ Aphrody Finance ticker & Flights router.
8. **Typography & Assets:** Google Fonts $\rightarrow$ `packages/google/src/fonts-proxy.ts` and `packages/m3-fonts`.
9. **AI & Compute:** Google Gemini, Google Colab $\rightarrow$ Gemini Web Runtime (`gemini-app-runtime`) and computational notebooks (`apps/iecode-web`).
10. **Storage & Productivity:** Google Drive, Docs, Sheets, Slides, PDF $\rightarrow$ Aphrody Drive (`apps/drive`), WordCraft, GridCraft, DeckCraft, PDFCraft.

**Strict Clean-Room Principles:**
- Zero private Google endpoints, zero proprietary JS scrapers, zero tracking beacons.
- Built strictly on open public protocols: WebRTC, IMAP/JMAP/SMTP, ActivityPub, OpenStreetMap vector tile schemas, OGC/GeoTIFF, W3C WebAudio, WebGPU, CommonMark, and standard financial/GTFS/OpenAPI data schemas.

---

## Sources & Public Standards

| Domain | Original Target | Canonical Public Standards & Specifications | Bun OS / Aphrody Implementation Target |
|:---|:---|:---|:---|
| **Search** | Google Search, Scholar, Lens | OpenSearch specification, Schema.org JSON-LD, BibTeX, RIS | `packages/google/src/search.ts`, `apps/search`, SQLite FTS5 |
| **Media** | YouTube, YouTube Music | MPEG-DASH (ISO/IEC 23009-1), HLS (RFC 8216), W3C WebAudio, MediaSource Extensions | `packages/media`, `apps/filmcraft`, `apps/soundcraft` |
| **Spatial** | Google Maps, Google Earth | Mapbox Vector Tile (MVT), OGC GeoJSON (RFC 7946), WGS84, 3D Tiles (OGC) | `packages/viz3d`, MapLibre GL / WebGPU rasterizer |
| **Email/Chat** | Gmail, Chat, Contacts | JMAP (RFC 8620, RFC 8621), IMAP (RFC 3501), vCard (RFC 6350), Matrix / A2A | `packages/identity`, `packages/a2a`, Aphrody Mail |
| **Video Meet** | Google Meet | WebRTC 1.0 (W3C), SDP (RFC 4566), ICE (RFC 8445), Opus (RFC 6716), AV1/VP9 | `packages/a2a`, WebRTC mesh / SFU |
| **Calendar** | Google Calendar, Tasks | iCalendar (RFC 5545), CalDAV (RFC 4791), Task RFC 5545 VTODO | `packages/identity`, Aphrody Calendar & Tasks |
| **Photos** | Google Photos | EXIF 2.32, IPTC, Adobe DNG (TIFF/EP), ColorSync / ICC profiles | `apps/lightcraft-web`, `crates/lightcraft-*` |
| **Finance** | Google Finance | FIX Protocol, ISO 4217, Yahoo/AlphaVantage Open Market APIs | Aphrody Finance engine, `Bun.serve` SSE ticker |
| **Fonts** | Google Fonts | OpenType (ISO/IEC 14496-22), WOFF2 (W3C), Variable Fonts (fvar/gvar) | `packages/google/src/fonts-proxy.ts`, `packages/m3-fonts` |
| **AI / Notebook**| Gemini, Google Colab | IPython/Jupyter Notebook Format v4, Gemini Web Runtime MCP | `gemini-app-runtime`, `apps/iecode-web` |

---

## Core Loops

```
+----------------------------------------------------------------------------------------------------+
|                                    Aphrody Global Command Rail                                     |
|                       (Global Search, App Launcher, Identity & Storage Quota)                      |
+----------------------------------------------------------------------------------------------------+
                                                  |
         +-----------------------+----------------+-----------------------+
         |                       |                                        |
         v                       v                                        v
+------------------+   +-------------------+                    +--------------------+
| Search & Content |   | Communication &   |                    | Studios & Creation |
|                  |   | Collaboration     |                    |                    |
| - Aphrody Search |   | - Aphrody Mail    |                    | - WordCraft (Docs) |
| - FilmCraft (YT) |   | - A2A Meet (Video)|                    | - GridCraft(Sheets)|
| - SoundCraft(Mus)|   | - Aphrody Chat    |                    | - DeckCraft(Slides)|
| - Aphrody Maps   |   | - Calendar & Tasks|                    | - LightCraft(Photo)|
| - Finance/Travel |   | - Contacts DB     |                    | - PDFCraft         |
+------------------+   +-------------------+                    +--------------------+
         |                       |                                        |
         +-----------------------+----------------+-----------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                               Aphrody Drive & Unified File Mesh                                    |
|                (Hierarchical Storage, Content-Addressable Blobs, OPFS, SQLite WAL)                 |
+----------------------------------------------------------------------------------------------------+
```

---

## Comprehensive Screen Inventory (S01 to S42)

| ID | Screen Name | Route / Modal | App Domain | Core Purpose | Key Components |
|:---|:---|:---|:---|:---|:---|
| **S01** | Aphrody Search Home | `/` or `/search` | Search & Knowledge | Clean query launch surface | Centered search bar, voice search trigger, category chips, recent search history pills |
| **S02** | Search Results Page (SERP) | `/search?q=...` | Search & Knowledge | Federated discovery with tabs | Tab bar (All, Images, Videos, News, Scholar), rich snippet cards, knowledge panel card |
| **S03** | Visual Search / Lens Overlay | Click camera icon | Search & Knowledge | Reverse image discovery | Drag-and-drop image drop zone, bounding box selector, visual similarity matches |
| **S04** | Scholar Research Explorer | `/scholar?q=...` | Search & Knowledge | Academic literature discovery | Citation count links, BibTeX exporter, PDF quick view, author profile link |
| **S05** | FilmCraft Video Feed (YT) | `/video` | Media & Streaming | Video browsing & recommendations | Responsive video thumbnail grid, category pills (Music, Tech, Gaming), sidebar subscriptions |
| **S06** | Video Watch Player Canvas | `/video/watch?v=...` | Media & Streaming | High-definition media consumption | WebGPU/WASM video player, theater mode toggle, chapter trackbar, comment discussion feed |
| **S07** | Video Channel & Studio Studio | `/video/studio` | Media & Streaming | Video publishing & management | Video upload drop zone, metadata editor, thumbnail picker, playback statistics graph |
| **S08** | SoundCraft Music Player | `/music` | Media & Streaming | Audio streaming & queue | Album art carousel, mini/fullscreen audio player, play queue drawer, lyrics view |
| **S09** | Aphrody Maps 2D Explorer | `/maps` | Geo & Spatial | Interactive vector geographic map | MapLibre WebGPU tile canvas, search POI input, layer toggle (satellite, terrain), zoom gizmo |
| **S10** | Turn-by-Turn Navigation Pane | `/maps/directions` | Geo & Spatial | Routing & transit calculation | Origin/destination inputs, mode switcher (Drive, Transit, Walk, Bike), step list, elevation profile |
| **S11** | 3D Spatial Earth Viewer | `/earth` | Geo & Spatial | Planetary photogrammetry & terrain | Fullscreen 3D globe (`packages/viz3d`), camera pitch/heading gimbal, 3D terrain elevation |
| **S12** | Aphrody Mail Inbox | `/mail` | Communication | Email management | Folder tree (Inbox, Starred, Sent, Drafts, Spam), message list rows, quick action buttons |
| **S13** | Rich Email Composer | Click "Compose" | Communication | Mail authoring | To/Cc/Bcc inputs, subject line, WordCraft mini-WYSIWYG toolbar, file attachment strip |
| **S14** | Email Conversation Thread | `/mail/thread/:id` | Communication | Message thread review | Expandable message cards, sender avatar, attachment preview chips, quick reply box |
| **S15** | A2A Meet Video Room | `/meet/:room` | Communication | WebRTC group video conferencing | Active speaker tile grid, bottom call control bar (Mic, Cam, Screen Share, End), participant drawer |
| **S16** | Meet Pre-Join Lobby | `/meet/lobby/:room` | Communication | AV hardware check & setup | Camera self-preview, microphone audio VU meter, virtual background selector, "Join Now" button |
| **S17** | Aphrody Chat & Channels | `/chat` | Communication | Real-time direct & group messaging | Channel sidebar, active chat timeline, emoji reactions, file drag-and-drop, thread sidecar |
| **S18** | Contacts Address Book | `/contacts` | Communication | Person directory | Contact card list, alphabet index scroller, detail inspector (phone, email, notes, avatar) |
| **S19** | Aphrody Calendar Grid | `/calendar` | Planning & Org | Schedule visualization | View switcher (Month, Week, Day, Agenda), time grid, color-coded event blocks, mini date picker |
| **S20** | Event Creation Modal | Click calendar slot | Planning & Org | Schedule entry | Title input, start/end time picker, recurring rule dropdown, attendee invite, location field |
| **S21** | Aphrody Tasks Sidebar | Flyout panel | Planning & Org | Fast task tracking | Due-date grouped list, task add input, sub-tasks, completion checkbox with sound feedback |
| **S22** | WordCraft Quick Notes | `/notes` | Planning & Org | Masonry scratchpad | Card grid, color badges, rich checklist toggle, pinned section, 1-click WordCraft conversion |
| **S23** | LightCraft Photo Timeline | `/photos` | Photos & Media | Visual media gallery | Chronological photo timeline, month/year sticky headers, infinite virtualized thumbnail grid |
| **S24** | LightCraft RAW Editor | Click photo $\rightarrow$ "Edit" | Photos & Media | Non-destructive image grading | WebGPU canvas, histogram, exposure/contrast sliders, HSL color grading, crop/rotate handles |
| **S25** | LightCraft Search & Albums | `/photos/albums` | Photos & Media | Visual semantic discovery | Face cluster cards, location map view, custom albums grid, favorite stars filter |
| **S26** | Aphrody Finance Ticker | `/finance` | Finance & Travel | Financial market dashboard | Index sparklines, watchlist table, currency exchange calculator, top market movers |
| **S27** | Stock / Crypto Instrument View | `/finance/quote/:sym` | Finance & Travel | Detailed asset analytics | Interactive candlestick chart with technical indicators (RSI, MACD), news feed, key financials |
| **S28** | Flight Search & Itinerary | `/flights` | Finance & Travel | Airfare route comparison | Departure/arrival city selectors, date range picker, airline & stop filters, price matrix graph |
| **S29** | Aphrody Fonts Catalog | `/fonts` | Typography | Typeface discovery | Font cards with live type previews, category filters (Serif, Sans, Mono), size/weight sliders |
| **S30** | Font Family Studio | `/fonts/specimen/:id` | Typography | Variable font inspector | Variable font axis sliders (weight, width, slant), full glyph grid, CSS `@font-face` code snippet |
| **S31** | Gemini Web Runtime Studio | `/ai` | AI & Compute | Conversational reasoning | Chat timeline with code block syntax highlighting, multi-modal file drop, thinking block toggle |
| **S32** | Deep Research Investigation | `/ai/research` | AI & Compute | Autonomous cited investigations| Multi-step query planner, source inspection list, streaming synthesized comprehensive markdown report |
| **S33** | Canvas Interactive Co-Editor | `/ai/canvas` | AI & Compute | Side-by-side artifact workspace | Split view: conversational guidance on left, editable live document / code preview on right |
| **S34** | Interactive Notebook Studio | `/notebook` | AI & Compute | Code execution & visualization | Python/Bun kernel, executable code cells, markdown cells, interactive charts output |
| **S35** | Drive Home Activity Hub | `/drive/home` | Storage & Files | Central file access | Search bar with filter chips, suggested cards, recent file list, navigation rail |
| **S36** | My Drive Hierarchical Tree | `/drive/my-drive` | Storage & Files | Folder & file explorer | Breadcrumb trail, grid/list view toggle, folder cards, file rows, multi-file upload progress drawer |
| **S37** | WordCraft Paginated Canvas | `/document/d/:id/edit` | Workspace Studio | Rich document processing | Paginated canvas, typography formatting toolbar, auto-derived heading outline, export dialog |
| **S38** | GridCraft Formula Matrix | `/spreadsheets/d/:id/edit`| Workspace Studio | Reactive calculations | Infinite virtualized grid, formula bar $f_x$, multi-sheet tabs, CSV/XLSX import wizard |
| **S39** | DeckCraft 16:9 Slide Studio | `/presentation/d/:id/edit`| Workspace Studio | Vector presentation deck | 16:9 canvas, left slide filmstrip, vector shape handles, presenter mode console |
| **S40** | PDFCraft Annotation Studio | `/pdfcraft/:id` | Workspace Studio | PDF review & form filling | Vector PDF renderer, text highlighter, ink drawing, AcroForm field filler, page extraction |
| **S41** | Account Storage & Quota Center| `/account/storage` | Identity & Quota | Storage monitoring & cleanup | Circular storage gauge breakdown (Drive vs. Craft vs. Snapshots), cleanup assistant, backup archive |
| **S42** | Global Command Bar | `Alt+Space` / `Meta+K` | Shell & Launcher | Universal search & actions | Spotlight overlay: jump to document, send mail, start call, search web, create note |

---

## Detailed Cross-App User Flows (F01 to F10)

```
F01 Universal Web & Scholar Search to WordCraft Document
    S01 (Search Home) -> enter research topic -> S02 (SERP) -> switch to Scholar tab -> S04 (Scholar)
    -> click "Export BibTeX / Copy Citation" -> launch S37 (WordCraft Document) -> paste citation
    happy path clicks: 4 clicks + typing
    edge cases: no scholarly records found, invalid BibTeX formatting

F02 Media Discovery & Background Listening in SoundCraft
    S05 (FilmCraft Video Feed) -> search song -> S08 (SoundCraft) -> play track
    -> minimize to persistent audio dock -> continue working in S38 (GridCraft)
    happy path clicks: 3 clicks
    edge cases: audio device unplugged, streaming buffer underflow (auto-caches locally)

F03 Geographic Exploration & Turn-by-Turn Route Planning
    S09 (Maps) -> search destination POI -> S10 (Directions Pane) -> select transit mode
    -> inspect step-by-step turns -> export route to S19 (Aphrody Calendar)
    happy path clicks: 4 clicks
    edge cases: offline vector tile cache used when network disconnected

F04 Email Composition with Meeting Link & Drive Attachment
    S12 (Mail Inbox) -> click "Compose" -> S13 (Composer) -> click "Add Drive File"
    -> pick document from S36 (Drive) -> click "Add A2A Meet Link" -> send email
    happy path clicks: 4 clicks
    edge cases: recipient has no public key (encrypts with link token fallback)

F05 Meeting Delivery in A2A Meet with Live Screen Share
    S14 (Email) or S19 (Calendar) -> click meeting link -> S16 (Meet Lobby AV Check)
    -> click "Join" -> S15 (Video Room) -> click "Share Screen" -> present S39 (DeckCraft)
    happy path clicks: 3 clicks
    edge cases: microphone muted warning, WebRTC peer connection ICE renegotiation

F06 Event Scheduling with Linked Tasks & Quick Notes
    S19 (Calendar) -> drag time slot -> S20 (Event Modal) -> enter title -> toggle "Add Task"
    -> event registers in S21 (Tasks panel) -> link note from S22 (Quick Notes)
    happy path clicks: 3 clicks + typing
    edge cases: overlapping scheduling conflicts highlighted in red

F07 Photo Ingestion, Album Sorting & Non-Destructive RAW Grading
    Connect SD card / drag photos into S23 (LightCraft Timeline) -> auto-indexes EXIF
    -> double-click RAW file -> S24 (RAW Editor) -> adjust Exposure/Highlights -> save preset
    happy path clicks: 3 clicks
    edge cases: unsupported proprietary camera RAW format (falls back to LibRaw / DNG converter)

F08 Financial Instrument Analysis & Export to GridCraft
    S26 (Finance Ticker) -> select stock symbol -> S27 (Instrument View) -> review candlestick chart
    -> click "Export Financials to GridCraft" -> S38 opens with live SSE price ticker formula
    happy path clicks: 3 clicks
    edge cases: market closed (displays last close price + pre-market indication)

F09 Typography Selection & 1-Click Injection into WordCraft / DeckCraft
    S29 (Fonts Catalog) -> test sample text -> S30 (Font Specimen) -> adjust variable weight axis
    -> click "Install in Aphrody WebOS" -> available immediately in S37 (WordCraft) and S39 (DeckCraft)
    happy path clicks: 3 clicks
    edge cases: missing WOFF2 glyph subset (fetches complete Unicode range on demand)

F10 Autonomous AI Research to Executable Computational Notebook
    S31 (Gemini Studio) -> trigger Deep Research -> S32 (Investigation Console)
    -> generates cited analytical report -> click "Open in Notebook" -> S34 (Colab Notebook)
    -> execute Python/Bun code cells -> render data visualization
    happy path clicks: 3 clicks
    edge cases: kernel execution timeout, missing Python/WASM module (auto-installs in Pyodide/Bun)
```

---

## Technical Clean-Room Boundary Summary

1. **Search & Indexing:** Clean-room crawler and SQLite FTS5 index; never scrape private Google search caches.
2. **Video & Audio Streaming:** Standard HLS/DASH pipelines streaming standard container formats (MP4, WebM, Opus, AV1); no proprietary Google Widevine DRM wrappers.
3. **Geo & Maps:** OpenStreetMap vector tile servers, MapLibre GL, and standard WGS84 coordinates.
4. **Communications:** Pure open standards: WebRTC for calls, JMAP/IMAP for mail, Matrix/A2A for real-time messaging.
5. **AI Runtime:** Transparent MCP server integration (`gemini-app-runtime`) connecting to authenticated sessions without storing credentials in plain text.
