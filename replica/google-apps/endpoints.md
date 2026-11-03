# API & Endpoints Specification: Aphrody Google Apps Ecosystem

Complete clean-room endpoint catalog for the entire Google Web Apps replica suite in **Bun OS / Aphrody WebOS**, executed natively on Upstream Bun (`v1.4.4+`).

---

## 1. Search & Knowledge Endpoints

| Method | Endpoint | Query / Path Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/search` | `q`: string, `category`: enum (`all`, `images`, `videos`, `news`), `page`: int, `limit`: int | — | `{ results: SearchResultItem[], total: number, time_ms: number }` | Federated web search with FTS5 ranking and snippets. |
| `GET` | `/api/search/suggestions` | `q`: string | — | `{ suggestions: string[] }` | Instant prefix autocomplete query suggestions. |
| `POST` | `/api/search/lens` | — | Multipart / Binary image | `{ matches: VisualMatchItem[], detected_labels: string[] }` | Reverse visual search with perceptual hash feature matching. |
| `GET` | `/api/scholar/search` | `q`: string, `year_from`: int, `year_to`: int, `sort_by`: enum (`relevance`, `date`) | — | `{ articles: ScholarArticle[], total: number }` | Academic paper search with citation metrics and direct PDF links. |
| `GET` | `/api/scholar/cite/:id` | `format`: enum (`bibtex`, `apa`, `mla`, `chicago`, `ris`) | — | `{ citation_text: string, format: string }` | Generates standardized citation string or downloadable BibTeX. |

---

## 2. Media & Streaming Endpoints (FilmCraft & SoundCraft)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/media/feed` | `category`: string, `cursor`: string | — | `{ videos: VideoSummaryItem[], next_cursor: string }` | Recommended and subscribed video feeds for FilmCraft home. |
| `GET` | `/api/media/video/:id` | `id`: UUID | — | `{ video: VideoDetail, playback_manifest_url: string, chapters: Chapter[] }` | Retrieves video metadata, DASH/HLS manifest URL, and chapters. |
| `GET` | `/api/media/stream/:id/:file`| `id`: UUID, `file`: string (e.g. `master.m3u8`, `chunk-01.m4s`) | — | Streaming binary payload (`video/mp4`, `application/x-mpegURL`) | Streams media playlist manifests and segmented chunks. |
| `POST` | `/api/media/upload/init` | — | `{ title: string, description: string, size_bytes: int64, mime_type: string }` | `{ upload_id: UUID, chunk_size: number }` | Initiates chunked video upload pipeline. |
| `PUT` | `/api/media/upload/chunk` | `upload_id`: UUID, `chunk_index`: int | Binary chunk data | `{ status: 'received' \| 'completed', video_id?: UUID }` | Streams individual video file chunks with SHA-256 verification. |
| `GET` | `/api/music/search` | `q`: string, `type`: enum (`track`, `album`, `artist`, `playlist`) | — | `{ tracks: MusicTrack[], albums: MusicAlbum[], artists: Artist[] }` | Searches SoundCraft music catalog by metadata. |
| `GET` | `/api/music/lyrics/:track_id`| `track_id`: UUID | — | `{ lyrics_lrc: string, is_synced: boolean }` | Retrieves synchronized LRC lyrics timestamps. |

---

## 3. Geographic & Spatial GIS Endpoints (Aphrody Maps & Earth)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/geo/tiles/:z/:x/:y.pbf` | `z`, `x`, `y`: tile coordinates | — | Protocol Buffer (`application/x-protobuf`) | Streams OpenStreetMap vector tiles for MapLibre rendering. |
| `GET` | `/api/geo/poi/search` | `q`: string, `lat`: float, `lon`: float, `radius_meters`: int | — | `{ results: PlacePoiItem[] }` | Geocoding and points of interest lookup. |
| `POST` | `/api/geo/directions` | — | `{ origin: [lat, lon], destination: [lat, lon], mode: 'driving'\|'walking'\|'cycling'\|'transit' }` | `{ route: RouteGeometry, distance_meters: number, duration_seconds: number, steps: TurnStep[] }` | Turn-by-turn routing calculation with elevation and maneuvers. |
| `GET` | `/api/geo/elevation` | `locations`: `[lat, lon][]` | — | `{ elevations: float[] }` | Returns terrain digital elevation model heights for 3D Earth. |

---

## 4. Communication Endpoints (Mail, Meet, Chat, Contacts)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/mail/threads` | `folder`: string (`inbox`, `sent`, `starred`), `page`: int | — | `{ threads: MailThreadItem[], unread_count: number }` | Retrieves grouped email conversation threads. |
| `GET` | `/api/mail/thread/:id` | `id`: UUID | — | `{ thread: MailThreadDetail, messages: MailMessage[] }` | Fetches full conversation messages with body HTML and attachments. |
| `POST` | `/api/mail/send` | — | `{ to: string[], cc: string[], subject: string, body_markdown: string, attachment_ids: UUID[] }` | `{ success: true, message_id: UUID }` | Dispatches outgoing email via JMAP or configured SMTP. |
| `GET` | `/api/contacts` | `q`: string, `sort`: string | — | `{ contacts: ContactPerson[] }` | Lists personal address book contacts. |
| `POST` | `/api/contacts` | — | `{ name: string, email: string, phone: string, avatar_hash: string }` | `{ contact: ContactPerson }` | Creates or updates contact card. |
| `WS` | `/ws/meet/:room` | `room`: string (room ID or token) | WebRTC Signaling Messages (SDP Offer/Answer, ICE Candidate) | WebRTC Signaling & SFU Video Stream | Real-time WebRTC audio/video conference room. |
| `WS` | `/ws/chat/:channel`| `channel`: string | Chat Messages (JSON): `{ type: 'chat', text: string, attachments: [] }` | Broadcast Chat Messages | Real-time direct & group channel messaging. |

---

## 5. Planning & Personal Organization Endpoints (Calendar & Tasks)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/calendar/events` | `start`: ISO8601, `end`: ISO8601 | — | `{ events: CalendarEvent[] }` | Expands and returns calendar events and recurring instances. |
| `POST` | `/api/calendar/events` | — | `{ title: string, start_time: ISO8601, end_time: ISO8601, rrule?: string, meet_room?: string }` | `{ event: CalendarEvent }` | Creates calendar event with optional A2A Meet room link. |
| `PATCH`| `/api/calendar/events/:id` | `id`: UUID | `{ title?, start_time?, end_time? }` | `{ event: CalendarEvent }` | Updates event time or properties. |
| `GET` | `/api/tasks` | `completed`: boolean | — | `{ tasks: TaskItem[] }` | Lists to-do tasks grouped by list or due date. |
| `POST` | `/api/tasks` | — | `{ title: string, due_date?: ISO8601, parent_id?: UUID }` | `{ task: TaskItem }` | Creates a new task item. |
| `PATCH`| `/api/tasks/:id` | `id`: UUID | `{ is_done?: boolean, title?: string }` | `{ task: TaskItem }` | Toggles task completion status. |
| `GET` | `/api/notes` | `is_archived`: boolean | — | `{ notes: QuickNote[] }` | Retrieves quick scratchpad notes for masonry board. |
| `POST` | `/api/notes` | — | `{ title: string, body_markdown: string, checklist: [], color: string }` | `{ note: QuickNote }` | Saves new quick note. |

---

## 6. Photo & Creative Media Endpoints (LightCraft)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/photos` | `cursor`: string, `limit`: int | — | `{ photos: PhotoItem[], next_cursor: string }` | Chronological photo timeline with EXIF date grouping. |
| `GET` | `/api/photos/:id/raw` | `id`: UUID | — | Binary RAW / DNG / JPEG stream | Retrieves full-resolution RAW or high-res photo asset. |
| `GET` | `/api/photos/:id/thumb`| `id`: UUID, `size`: int (e.g. 256, 512) | — | Binary WebP thumbnail | Fetches pre-generated cached GPU-friendly image thumbnail. |
| `POST` | `/api/photos/adjustments`| — | `{ photo_id: UUID, adjustments: { exposure, contrast, temperature, tint, highlights, shadows } }` | `{ success: true, updated_at: ISO8601 }` | Saves non-destructive photo grading parameters. |
| `GET` | `/api/photos/albums` | — | — | `{ albums: AlbumItem[] }` | Lists photo albums, face clusters, and geographic sets. |

---

## 7. Financial & Travel Routing Endpoints

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/finance/indices` | — | — | `{ indices: MarketIndex[] }` | Key market indices (S&P, NASDAQ, Dow, FTSE, BTC, ETH). |
| `GET` | `/api/finance/quote/:sym` | `sym`: ticker symbol (e.g. `AAPL`, `GOOG`) | — | `{ symbol: string, price: float, change_percent: float, history: Candle[] }` | Financial instrument quote with intraday or historical candles. |
| `GET` | `/api/finance/stream` | `symbols`: string (comma-separated) | — | Server-Sent Events (SSE) Stream | Live tick stream pushing price updates. |
| `POST` | `/api/flights/search` | — | `{ origin: string, destination: string, departure_date: ISO8601, return_date?: ISO8601, passengers: int }` | `{ itineraries: FlightItinerary[], price_calendar: PriceDate[] }` | Flight route comparison and airline itinerary matrix. |

---

## 8. Typography & Fonts Endpoints (Aphrody Fonts)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/fonts` | `category`: string, `sort`: string | — | `{ fonts: FontFamilyItem[] }` | Open-source font directory with available weights and styles. |
| `GET` | `/api/fonts/css` | `family`: string (e.g. `Inter:wght@400..900`), `display`: string | — | CSS `@font-face` declaration | Serves zero-telemetry local CSS with WOFF2 font paths. |
| `GET` | `/api/fonts/file/:id.woff2` | `id`: string | — | Binary WOFF2 font file | Streams cached WOFF2 font glyph tables. |

---

## 9. AI & Computational Notebook Endpoints

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `POST` | `/api/ai/chat` | — | `{ prompt: string, model: string, attachments: [] }` | Streaming text / SSE response | Conversational AI reasoning stream. |
| `POST` | `/api/ai/research` | — | `{ topic: string, depth: 'quick' \| 'comprehensive' }` | Streaming research progress and citations | Autonomous multi-step Deep Research report generation. |
| `POST` | `/api/notebook/execute` | — | `{ cell_id: string, language: 'python' \| 'typescript', code: string }` | `{ status: 'success' \| 'error', output_text: string, output_mime?: string, data?: any }` | Executes computational code cell in Bun or Pyodide sandbox. |

---

## 10. Storage & Drive Endpoints (Aphrody Drive & Quota)

| Method | Endpoint | Parameters | Request Body | Response Payload | Description |
|:---|:---|:---|:---|:---|:---|
| `GET` | `/api/drive/items` | `folder_id`: UUID, `trashed`: boolean | — | `{ items: DriveItem[], total: number }` | Lists directory files and folders. |
| `POST` | `/api/drive/items` | — | `{ name: string, mime_type: string, parent_folder_id?: UUID }` | `{ item: DriveItem }` | Creates new Drive item or folder. |
| `PATCH`| `/api/drive/items/:id` | `id`: UUID | `{ name?, parent_folder_id?, is_starred?, is_trashed? }` | `{ item: DriveItem }` | Moves, renames, stars, or trashes item. |
| `DELETE`| `/api/drive/items/:id`| `id`: UUID | — | `{ success: true, reclaimed_bytes: number }` | Permanently purges item from trash. |
| `POST` | `/api/drive/upload` | — | Multipart file stream with `x-sha256` header | `{ item: DriveItem }` | Streams file directly into CAS storage with hash verification. |
| `GET` | `/api/drive/download/:id` | `id`: UUID | — | Binary file stream | Downloads file with Range request support. |
| `GET` | `/api/account/storage` | — | — | `{ allocated_bytes, used_bytes, breakdown: { drive, craft, snapshots, trash } }` | Storage quota usage breakdown. |
| `POST` | `/api/account/storage/cleanup`| — | `{ action: 'empty_trash' \| 'purge_duplicates' }` | `{ reclaimed_bytes: number }` | Reclaims storage by executing automated cleanup. |
| `WS` | `/ws/craft/:docId` | `docId`: UUID | Binary CRDT Delta messages | Vector clock CRDT sync | Real-time multi-user document collaboration room. |
