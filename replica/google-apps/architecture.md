# Architecture Specification: Aphrody Google Apps & WebOS Suite

Clean-room architectural design for replicating the entire Google Consumer & Productivity Web Apps ecosystem inside **Bun OS / Aphrody WebOS**. This specification details the unified WebOS application shell, client-side Rust WebAssembly studio engines, streaming media & GIS pipelines, local-first OPFS/SQLite storage tier, and the upstream Bun.serve backend infrastructure.

---

## 1. System Topology & Global Architecture

The Aphrody WebOS platform unifies the disparate Google Web Apps into an integrated, zero-telemetry, local-first operating environment:

```
+-----------------------------------------------------------------------------------------------------------------------+
|                                              Aphrody WebOS Shell & Window Manager                                     |
|                            (Global Command Palette Alt+Space, App Switcher Rail, Multi-Monitor Workspaces)            |
+-----------------------------------------------------------------------------------------------------------------------+
                                                           |
         +--------------------+----------------------------+----------------------------+--------------------+
         |                    |                            |                            |                    |
         v                    v                            v                            v                    v
  +--------------+    +---------------+            +---------------+            +---------------+    +---------------+
  |    Search    |    |  Media Suite  |            |  Spatial GIS  |            | Communication |    | Craft Studios |
  | & Knowledge  |    |               |            |               |            | & Meetings    |    | & Productivity|
  | - Web Search |    | - FilmCraft   |            | - Aphrody Maps|            | - Aphrody Mail|    | - WordCraft   |
  | - Lens / OCR |    |   (YouTube)   |            |   (Vector MVT)|            | - A2A Meet    |    | - GridCraft   |
  | - Scholar    |    | - SoundCraft  |            | - 3D Earth    |            |   (WebRTC)    |    | - DeckCraft   |
  |              |    |   (Music)     |            |   (WebGPU viz)|            | - Aphrody Chat|    | - PDFCraft    |
  +-------+------+    +-------+-------+            +-------+-------+            +-------+-------+    +-------+-------+
          |                   |                            |                            |                    |
          +-------------------+----------------------------+----------------------------+--------------------+
                                                           |
                                                           v
+-----------------------------------------------------------------------------------------------------------------------+
|                                          Client Storage & Hardware Acceleration Tier                                  |
|   - WebGPU / WebGL2 Rendering Canvas Pipeline (eframe / egui-wgpu at 60/120 FPS)                                     |
|   - Origin Private File System (OPFS) Direct Binary I/O via Web Workers (FileSystemSyncAccessHandle)                  |
|   - SQLite3 WASM Engine (WAL Mode, FTS5 Full-Text Indexing, CRDT Delta Storage)                                       |
+-----------------------------------------------------------------------------------------------------------------------+
                                                           |
                       Encrypted WireGuard Mesh / TLS 1.3 / HTTP/3 & WebSockets (JSON-RPC & Binary CRDT)
                                                           |
                                                           v
+-----------------------------------------------------------------------------------------------------------------------+
|                                              Bun.serve Backend Runtime (Bun OS)                                       |
|                                                                                                                       |
|   +----------------------------+  +----------------------------+  +----------------------------+  +---------------+   |
|   |     Aphrody Drive REST     |  |    A2A WebRTC SFU / Relay  |  |    Media Streaming HLS/DASH|  | Font Proxy    |   |
|   |   (Streaming Uploads, CAS) |  |   (Video/Audio Conferencing|  |   (Chunking & Transcoding) |  | (WOFF2 Cache) |   |
|   +--------------+-------------+  +--------------+-------------+  +--------------+-------------+  +-------+-------+   |
|                  |                               |                               |                        |           |
|                  +-------------------------------+-------------------------------+------------------------+           |
|                                                  |                                                                    |
|                                                  v                                                                    |
|   +---------------------------------------------------------------------------------------------------------------+   |
|   |                                          Bun Native Persistence Layer                                         |   |
|   |   - bun:sqlite High-Speed Relational Storage (Workspaces, Mail, Calendar, Chat, Quotas)                      |   |
|   |   - Content-Addressable Storage (CAS) for Media & File Blobs with SHA-256 Deduplication                      |   |
|   |   - Aphrody Identity & Cryptographic ACL Engine (packages/identity with Ed25519 Passkeys)                     |   |
|   +---------------------------------------------------------------------------------------------------------------+   |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Subsystem Architectural Specifications

### 2.1 Search & Knowledge Pipeline
- **Clean-Room Implementation:** `packages/google/src/search.ts` and `apps/search`.
- **Search Engine Core:** Operates on an inverted SQLite index utilizing the FTS5 tokenizer with Porter stemming and BM25 ranking.
- **Faceted Category Partitioning:** Searches are federated into distinct virtual index partitions: `web`, `images`, `videos`, `news`, and `scholar`.
- **Scholar & Citation Engine:** Extracts structured metadata (title, authors, publication venue, DOI, year) and formats citations into BibTeX, RIS, APA, MLA, and Chicago styles instantly.
- **Reverse Image Lookup:** Client-side WebGPU compute shader computes perceptual hashes (pHash) and visual feature vectors, comparing against indexed visual embeddings without transmitting user images to third-party ad networks.

### 2.2 Media & Streaming Infrastructure (FilmCraft & SoundCraft)
- **Clean-Room Implementation:** `packages/media`, `apps/filmcraft`, and `apps/soundcraft`.
- **Video Delivery Protocol:** Implements standard MPEG-DASH and HLS chunk streaming over HTTP/3. Chunks are ingested via `Bun.serve` and cached in Content-Addressable Storage (CAS).
- **Client Rendering Canvas:** FilmCraft utilizes an HTML5 `<video>` element hardware-accelerated through WebGPU custom post-processing shaders (color balance, sharpness, aspect-ratio letterboxing).
- **SoundCraft Audio Engine:** Built on the W3C WebAudio API. Manages an audio routing graph featuring an equalizer, dynamic range compressor, visualizer FFT analyser node, and seamless gapless playback buffer.
- **Synchronized Lyrics:** Parses standard LRC files and syncs line highlights with the audio timeline at 60 FPS.

### 2.3 Geographic & Spatial GIS Subsystem (Aphrody Maps & 3D Earth)
- **Clean-Room Implementation:** `packages/viz3d`, OpenStreetMap vector tile pipeline, and MapLibre GL WebGPU renderer.
- **Vector Tile Format:** Reads Mapbox Vector Tiles (MVT) encoded as Protocol Buffers over standard HTTP/2 tile endpoints (`/tiles/{z}/{x}/{y}.pbf`).
- **Turn-by-Turn Routing Engine:** Connects to an OSRM / GraphHopper routing core calculating shortest path trees via Contraction Hierarchies for driving, transit, walking, and cycling modes.
- **3D Planetary Globe:** `packages/viz3d` implements an Ellipsoidal Quadtree tile loader rendering digital elevation models (DEM) and terrain meshes with dynamic Level of Detail (LoD) in WebGPU.

### 2.4 Communication & Meeting Mesh (Mail, Meet, Chat, Contacts)
- **Clean-Room Implementation:** `packages/a2a`, `packages/identity`, Aphrody Mail, and Aphrody Chat.
- **A2A Meet (Video Conferencing):** WebRTC 1.0 engine supporting both peer-to-peer full-mesh (for 2–4 participants) and an upstream Bun SFU (Selective Forwarding Unit) relay (for 5+ participants) with VP9/AV1 simulcast and Opus high-definition audio.
- **Aphrody Mail:** Clean-room email client supporting JMAP (RFC 8620/8621) and IMAP/SMTP. Message threads are stored in client SQLite with full-text search and offline draft queues.
- **Aphrody Chat:** Real-time messaging implemented over Bun WebSockets with channel multiplexing, rich markdown formatting, and emoji reactions.
- **Address Book (Contacts):** Centralized identity directory using standard vCard 4.0 data structures synchronized with `packages/identity`.

### 2.5 Planning & Personal Organization (Calendar, Tasks, Quick Notes)
- **Clean-Room Implementation:** `packages/identity`, Aphrody Calendar, Aphrody Tasks, and WordCraft Quick Notes.
- **Calendar & Recurrence Engine:** Implements full iCalendar RFC 5545 specifications. Recurring rules (`RRULE`) are expanded dynamically into virtual occurrences in client SQLite.
- **Tasks & Checklist Sync:** Hierarchical task trees with due dates, priorities, and parent-child dependencies. Completing tasks triggers audio/visual feedback and updates calendar views.
- **WordCraft Quick Notes:** Masonry scratchpad with color badges and interactive checklists. Notes can be promoted with 1-click into fully-paginated WordCraft documents saved in Drive.

### 2.6 Photo & Creative Media Management (LightCraft)
- **Clean-Room Implementation:** `apps/lightcraft-web` and `crates/lightcraft-*`.
- **EXIF & Catalog Indexing:** Client-side extraction of camera model, focal length, exposure time, aperture, ISO, and GPS coordinates stored in local SQLite.
- **Non-Destructive RAW Grading:** WebGPU compute shaders apply parametric adjustments (exposure, white balance, contrast, highlights, shadows, tone curves, and HSL split toning) directly on the GPU without altering original image data.

### 2.7 Financial Ticker & Travel Routing
- **Clean-Room Implementation:** Aphrody Finance engine and Flights comparison module.
- **Real-Time Financial Feeds:** Server-Sent Events (SSE) and WebSockets stream tick data into financial candlestick graphs with technical indicators (SMA, EMA, RSI, MACD).
- **Flight Matrix:** Parses multi-carrier flight schedules, airline stops, and fare classes into a matrix view with price-trend charts.

### 2.8 Typography & Variable Fonts (Aphrody Fonts)
- **Clean-Room Implementation:** `packages/google/src/fonts-proxy.ts` and `packages/m3-fonts`.
- **Font Proxy & Cache:** Bun proxy caches open-source font families locally in WOFF2 format, eliminating external Google server tracking.
- **Variable Font Inspector:** Interactive sliders for variable font design axes (`wght`, `wdth`, `slnt`, `ital`, `opsz`) with instant preview and CSS `@font-face` generation.

### 2.9 AI Reasoning & Computational Notebooks
- **Clean-Room Implementation:** `gemini-app-runtime`, `apps/iecode-web`, and `packages/dak-notebook`.
- **Gemini Web Runtime Bridge:** Antigravity connects directly to the authenticated Gemini Web runtime for conversational reasoning, multimodal file ingestion, and Deep Research.
- **Colab Computational Notebooks:** `apps/iecode-web` provides an interactive notebook canvas executing Python (via Pyodide WASM or remote kernel) and TypeScript (via Bun) cells with inline chart rendering.

---

## 3. Storage Architecture: Local-First OPFS & Client SQLite

The architecture guarantees zero-latency user interaction and complete offline resilience across the entire suite.

### 3.1 Dual-Tier SQLite & OPFS
```
+-----------------------------------------------------------------------------------+
|                               Client Storage (Browser / WebOS)                    |
|                                                                                   |
|  +------------------------------------+  +-------------------------------------+  |
|  |     Origin Private File System     |  |         Client SQLite3 WASM         |  |
|  |             (OPFS)                 |  |              (WAL Mode)             |  |
|  | - Raw Video & Audio Chunks         |  | - File & Folder Tree (DriveItems)   |  |
|  | - Photo RAW Blobs & Thumbnails     |  | - Mail Threads & Calendar Occurrences|
|  | - Document CRDT Binary Deltas      |  | - FTS5 Search Indices               |  |
|  | - Cached Vector Map PBF Tiles      |  | - Offline Mutation Sync Queue       |  |
|  +------------------------------------+  +-------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                         |
                       Bi-directional Sync / WebSocket CRDT
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                               Bun.serve Native Backend                            |
|                                                                                   |
|  +------------------------------------+  +-------------------------------------+  |
|  |    Content-Addressable Storage     |  |             bun:sqlite              |  |
|  |           (CAS Blobs)              |  |        (Authoritative DB)           |  |
|  | - Deduplicated by SHA-256          |  | - Workspaces, Accounts, & Quotas    |  |
|  | - Streaming Range Requests         |  | - ACL Permissions & Cryptographic   |  |
|  | - Immutable Chunk Archives         |  |   Share Link Tokens                 |  |
|  +------------------------------------+  +-------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Bun.serve Backend Services Topology

All server-side operations are handled by **Upstream Bun (`v1.4.4+`)** using unified routers and high-performance native APIs:

```typescript
// Unified WebOS Backend Server: src/server.ts
import { serve } from "bun";
import { handleSearchApi } from "./api/search";
import { handleMediaApi } from "./api/media";
import { handleGeoApi } from "./api/geo";
import { handleMailApi } from "./api/mail";
import { handleMeetWs } from "./api/meet";
import { handleCalendarApi } from "./api/calendar";
import { handleFinanceApi } from "./api/finance";
import { handleFontsProxy } from "./api/fonts";
import { handleDriveApi } from "./api/drive";
import { handleCraftSyncWs } from "./api/sync";

export const server = serve({
  port: Number(process.env.PORT || 8080),
  hostname: "0.0.0.0",
  routes: {
    "/api/search/*": handleSearchApi,
    "/api/media/*": handleMediaApi,
    "/api/geo/*": handleGeoApi,
    "/api/mail/*": handleMailApi,
    "/api/calendar/*": handleCalendarApi,
    "/api/finance/*": handleFinanceApi,
    "/api/fonts/*": handleFontsProxy,
    "/api/drive/*": handleDriveApi,
  },
  websocket: {
    open(ws) {
      // Manage room subscriptions (Meet video SFU or Craft document CRDT)
    },
    message(ws, message) {
      if (ws.data.type === "meet") {
        handleMeetWs(ws, message);
      } else if (ws.data.type === "craft") {
        handleCraftSyncWs(ws, message);
      }
    },
    close(ws) {
      // Presence cleanup
    }
  },
  fetch(req, server) {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/ws/meet/")) {
        server.upgrade(req, { data: { type: "meet", room: url.pathname.split("/").pop() } });
        return;
      }
      if (url.pathname.startsWith("/ws/craft/")) {
        server.upgrade(req, { data: { type: "craft", docId: url.pathname.split("/").pop() } });
        return;
      }
    }
    return new Response("Not Found", { status: 404 });
  }
});
```

---

## 5. Security, Identity & Clean-Room Boundaries

1. **Authentication:** 100% decentralized and local-first. Authentication leverages WebAuthn passkeys and Ed25519 asymmetric key pairs managed via `packages/identity`.
2. **Zero Telemetry:** Strict elimination of third-party tracking beacons, analytics scripts, and advertising SDKs.
3. **Data Sovereignty:** All user files, emails, photos, calendar events, and notes are stored unencrypted only on the user's host or encrypted in transit/rest across the WireGuard mesh.
4. **Universal Open Interchange:** Bi-directional support for standard open formats (vCard, iCal, MVT, OpenXML, ODF, PDF, LRC, CommonMark) ensures zero vendor lock-in.
