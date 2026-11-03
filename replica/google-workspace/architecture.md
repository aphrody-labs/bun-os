# Architecture Specification: Aphrody Drive & Craft Studios Suite

Clean-room architectural design for replicating the Google Workspace & Google Apps ecosystem inside **Bun OS / Aphrody WebOS**. This specification details the high-performance client-side WebAssembly rendering pipeline, local-first OPFS/SQLite storage engine, and Bun.serve backend APIs.

---

## 1. Architectural Overview & System Topology

The Aphrody Workspace suite replaces proprietary Google cloud dependencies with a decoupled, high-performance, local-first architecture:

```
+----------------------------------------------------------------------------------------------------+
|                                    Client-Side Web Browser / WebOS                                 |
|                                                                                                    |
|  +--------------------+  +--------------------+  +--------------------+  +---------------------+   |
|  |     WordCraft      |  |     GridCraft      |  |     DeckCraft      |  |      PDFCraft       |   |
|  |  (WebAssembly/wgpu)|  |  (WebAssembly/wgpu)|  |  (WebAssembly/wgpu)|  |   (WebAssembly/wgpu)|   |
|  +---------+----------+  +---------+----------+  +---------+----------+  +----------+----------+   |
|            |                       |                       |                        |              |
|            +-----------------------+-----------+-----------+------------------------+              |
|                                                |                                                   |
|                                                v                                                   |
|                         +-----------------------------------------------+                          |
|                         |         Aphrody Drive UI & Shell Rail         |                          |
|                         | (Navigation, File Grid, Search, Quota, Notes) |                          |
|                         +----------------------+------------------------+                          |
|                                                |                                                   |
|                                                v                                                   |
|                         +-----------------------------------------------+                          |
|                         |        Local-First Client Storage Engine      |                          |
|                         |  - Origin Private File System (OPFS Access)   |                          |
|                         |  - SQLite WASM (WAL mode, Metadata & CRDT)    |                          |
|                         +----------------------+------------------------+                          |
+------------------------------------------------|---------------------------------------------------+
                                                 |
                       TLS 1.3 / HTTP/3 & WebSockets (JSON-RPC & Binary CRDT)
                                                 |
                                                 v
+----------------------------------------------------------------------------------------------------+
|                                    Bun.serve Backend Runtime (Bun OS)                              |
|                                                                                                    |
|  +---------------------------+  +---------------------------+  +--------------------------------+  |
|  |     Aphrody Drive API     |  |     Craft Real-Time Sync  |  |    Format Conversion Worker    |  |
|  |   (REST, Uploads, ACLs)   |  |   (WebSocket CRDT Relay)  |  |   (PDF, DOCX, XLSX, PPTX)      |  |
|  +-------------+-------------+  +-------------+-------------+  +----------------+---------------+  |
|                |                              |                                 |                  |
|                +------------------------------+---------------------------------+                  |
|                                               |                                                    |
|                                               v                                                    |
|                         +-----------------------------------------------+                          |
|                         |               Bun Native Storage              |                          |
|                         | - Content-Addressable Blob Storage (CAS/hash) |                          |
|                         | - bun:sqlite Workspace Database (WAL mode)    |                          |
|                         | - Identity & Quota Manager (packages/identity)|                          |
|                         +-----------------------------------------------+                          |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Client-Side WebAssembly Studio Architecture

Rather than relying on deep DOM node trees (which produce severe reflows and memory bloat on large documents and grids), all Craft studios are built as native **Rust WebAssembly** applications compiled via `wasm-bindgen` and rendered through **eframe / egui-wgpu** directly onto an HTML5 `<canvas>`.

### 2.1 Studio Matrix & Responsibilities

| Studio | Crate Path | Web Runner | Rendering Backend | Core Responsibilities |
|:---|:---|:---|:---|:---|
| **WordCraft** | `crates/wordcraft-engine`, `crates/wordcraft-doc` | `apps/wordcraft-web` | WebGPU / WebGL2 | Paginated WYSIWYG canvas, typography shaping (`cosmic-text`), paragraph styling, tables, headers/footers, outline derivation. |
| **GridCraft** | `crates/gridcraft-engine`, `crates/gridcraft-core` | `apps/gridcraft-web` | WebGPU / WebGL2 | Infinite virtualized cell matrix, formula engine ($f_x$), cell dependency DAG, multi-sheet tabs, formatting rules. |
| **DeckCraft** | `crates/deckcraft-engine`, `crates/deckcraft-core` | `apps/deckcraft-web` | WebGPU / WebGL2 | 16:9 vector slide scene graph, transform gizmos, shapes, text boxes, presenter console, filmstrip track. |
| **PDFCraft** | `crates/pdfcraft-engine`, `crates/pdfcraft-core` | `apps/pdfcraft-web` | WebGPU / WebGL2 | Vector PDF page rasterization, ink/highlighter annotations, form field widgets, page reordering. |
| **Drive UI** | `apps/drive` (or Aphrody WebOS desktop) | TypeScript / Svelte 5 | DOM / WebGL | Fast file manager shell, breadcrumbs, search chips, quota dials, quick notes scratchpad. |

### 2.2 Text Layout, Font Shaping & Internationalization
- **Text Shaping Pipeline:** Powered by `cosmic-text` and HarfBuzz compiled to WebAssembly. Guarantees consistent font metrics, bi-directional text support (LTR/RTL), and kerning across all platforms.
- **Font Fallback:** System font discovery with bundled open typefaces: *Inter* (UI & Sans), *Merriweather* (Serif), *JetBrains Mono* (Code/Monospace), and *Noto Color Emoji*.
- **Sub-Pixel Positioning:** Glyph cache rendered directly into GPU textures, avoiding CSS subpixel rounding discrepancies.

### 2.3 GridCraft Formula Engine ($f_x$)
GridCraft implements a reactive formula evaluation engine written in pure Rust:
- **Abstract Syntax Tree (AST):** Lexer and Pratt parser compile formula strings (e.g. `=SUM(A1:A10) + IF(B1 > 0, C1, 0)`) into an AST.
- **Dependency Directed Acyclic Graph (DAG):** When a cell is modified, a topological sort identifies only dependent downstream cells for re-evaluation.
- **Cycle Detection:** Tarjan's strongly connected components algorithm catches circular dependencies and emits `#REF!` error tokens.
- **Standard Function Library:** Core mathematical (`SUM`, `PRODUCT`, `ROUND`, `ABS`), statistical (`AVERAGE`, `COUNT`, `MAX`, `MIN`), logical (`IF`, `AND`, `OR`, `IFS`), lookup (`VLOOKUP`, `XLOOKUP`, `INDEX`, `MATCH`), and string manipulation (`CONCATENATE`, `LEFT`, `RIGHT`, `MID`, `SPLIT`) functions.

---

## 3. Storage Engine: Local-First OPFS & Client SQLite

The architecture guarantees that every document, spreadsheet, presentation, and note can be authored with **zero network latency** and complete offline capability.

### 3.1 Origin Private File System (OPFS)
- High-throughput binary assets (document revision blobs, embedded high-res images, video clips, and database files) are stored directly in the browser's **Origin Private File System (OPFS)**.
- Handled inside a dedicated Web Worker using `FileSystemSyncAccessHandle` for synchronous, unbuffered read/write operations without main-thread blocking.

### 3.2 Client-Side SQLite WASM with OPFS VFS
- Every workspace maintains a local SQLite database (`workspace.db`) inside OPFS using the official SQLite3 WebAssembly build configured with the OPFS VFS.
- **WAL Mode Enabled:** `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;` ensure crash resistance and concurrent read/write transactions.
- **Local Indexing:** Full-text search (FTS5) is executed locally across document text, titles, and tags for instantaneous query completion.

### 3.3 Conflict-Free Replication (CRDT) & Sync Model
- Document mutations are represented as an append-only log of binary operational deltas.
- **Offline Mutation Queue:** Mutations are applied immediately to local state and appended to a local sync queue table.
- **Reconciliation Protocol:** When connectivity is established, deltas are exchanged over WebSockets. Vector clocks and deterministic conflict resolution algorithms (Yjs / Automerge model) reconcile concurrent changes without data loss.

---

## 4. Server Backend: Upstream Bun.serve & Bun OS Plugins

The backend server is implemented in **TypeScript on Upstream Bun (`v1.4.4+`)**, using Bun's native HTTP/WebSocket engine (`Bun.serve`), native SQLite (`bun:sqlite`), and streaming file utilities (`Bun.file`, `Bun.write`).

### 4.1 Server Architecture

```typescript
// Core Server Entrypoint: src/server.ts
import { serve } from "bun";
import { handleDriveApi } from "./api/drive";
import { handleCraftSyncWs } from "./api/sync";
import { handleStorageQuotaApi } from "./api/storage";
import { handleExportWorker } from "./workers/export";

export const server = serve({
  port: Number(process.env.PORT || 8080),
  hostname: "0.0.0.0",
  routes: {
    // REST API routes for Drive and Storage
    "/api/drive/*": handleDriveApi,
    "/api/account/storage/*": handleStorageQuotaApi,
    "/api/export/*": handleExportWorker,
  },
  websocket: {
    message(ws, message) {
      handleCraftSyncWs(ws, message);
    },
    open(ws) {
      // Register client connection to document room
    },
    close(ws) {
      // Broadcast cursor leave & presence cleanup
    }
  },
  fetch(req, server) {
    // WebSocket upgrade check
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/craft/sync/")) {
        const docId = url.pathname.split("/").pop();
        server.upgrade(req, { data: { docId, user: req.headers.get("x-user-id") } });
        return;
      }
    }
    return new Response("Not Found", { status: 404 });
  }
});
```

### 4.2 Aphrody Drive REST & Streaming API Endpoints

| Method | Endpoint | Description | Headers / Query | Response |
|:---|:---|:---|:---|:---|
| `GET` | `/api/drive/items` | List items in folder or root | `folder_id`, `trashed`, `starred`, `sort`, `limit` | `{ items: DriveItem[], total: number }` |
| `POST` | `/api/drive/items` | Create new item or folder | Body: `{ name, mime_type, parent_id }` | `{ item: DriveItem }` |
| `PATCH` | `/api/drive/items/:id` | Rename, move, star, trash item | Body: `{ name?, parent_id?, is_starred?, is_trashed? }` | `{ item: DriveItem }` |
| `DELETE` | `/api/drive/items/:id` | Permanently purge item from trash | — | `{ success: true, reclaimed_bytes: number }` |
| `POST` | `/api/drive/upload/init` | Initiate chunked upload | Body: `{ filename, size_bytes, mime_type, parent_id, sha256 }` | `{ upload_id: UUID, chunk_size: number }` |
| `PUT` | `/api/drive/upload/chunk` | Stream individual file chunk | Query: `upload_id`, `chunk_index`, `sha256` | `{ status: 'chunk_received' \| 'completed', item?: DriveItem }` |
| `GET` | `/api/drive/download/:id` | Stream file content with byte ranges | `Range: bytes=start-end` | Binary stream (`Content-Disposition: attachment`) |
| `GET` | `/api/drive/search` | Fast full-text & metadata search | Query: `q`, `type`, `modified_after`, `owner` | `{ results: SearchResultItem[] }` |
| `POST` | `/api/drive/share/:id` | Update ACL permissions or link | Body: `{ role, principal_type, principal_id?, passkey? }` | `{ permission: SharePermission, share_url: string }` |

### 4.3 Real-Time Collaboration & Document Sync (WebSockets)
- **Room Multiplexing:** Clients connect to `/api/craft/sync/:docId`.
- **Presence Protocol:** Cursors, text selections, and user avatars are broadcasted over lightweight JSON messages (at 30 Hz throttled):
  ```json
  { "type": "presence", "user_id": "usr_123", "color": "#2563EB", "cursor": { "page": 1, "offset": 142 }, "selection": null }
  ```
- **Delta Protocol:** Document edits are transmitted as compact binary CRDT messages:
  ```json
  { "type": "delta", "clock": 428, "payload": "<binary_base64_or_arraybuffer>" }
  ```
- **Snapshot Persistence:** Every 100 mutations or every 60 seconds of idle time, Bun commits a consolidated revision snapshot to the persistent storage layer.

### 4.4 High-Performance Document Export Pipeline
Conversions to standard office and publishing formats run through native Rust binaries invoked via Bun's fast child process API (`Bun.spawn`):

| Source Format | Target Format | Engine / Library | Performance Target |
|:---|:---|:---|:---|
| **WordCraft** (AST) | **PDF** | `typst` or `lopdf` with vector layout | < 150ms for 20-page document |
| **WordCraft** (AST) | **DOCX** | `docx-rs` (native Rust OpenXML builder) | < 80ms for 50-page document |
| **WordCraft** (AST) | **Markdown** | Bun native markdown serializer | < 5ms instant |
| **GridCraft** (Grid) | **XLSX** | `rust_xlsxwriter` (memory-mapped) | < 200ms for 100,000 cells |
| **GridCraft** (Grid) | **CSV / TSV** | Bun streaming text generator | < 20ms for 50,000 rows |
| **DeckCraft** (Scene) | **PPTX** | Native OpenXML presentation compiler | < 120ms for 30-slide deck |
| **DeckCraft** (Scene) | **PDF** | High-DPI page-by-page vector compiler | < 300ms for 30-slide deck |
| **PDFCraft** | **Flattened PDF** | `lopdf` / `pdfium` WebAssembly | < 100ms per 10 pages |

### 4.5 Storage Quota & Account Manager (`packages/identity`)
- **Real-Time Quota Calculation:** Bun evaluates storage consumption across:
  1. *Drive Blobs:* Sum of actual disk bytes in Content-Addressable Storage (CAS).
  2. *Craft Document Deltas:* Sum of SQLite revision table payload lengths.
  3. *Snapshot Backups:* Compressed `.tar.gz` archive snapshots in user backup directory.
  4. *Quarantine Trash:* Items marked `is_trashed = true`.
- **Cleanup Assistant Engine:** Identifies candidate files for reclamation:
  - Files in trash older than retention threshold.
  - Large files (> 50 MB) sorted descending.
  - Exact duplicate files identified via SHA-256 collision index.

---

## 5. Security, Identity & Clean-Room Boundaries

1. **Authentication & Identity:** Zero third-party telemetry. Authentication relies on passkeys (WebAuthn), Ed25519 cryptographic tokens, and local Unix user permissions via `packages/identity`.
2. **Access Control Lists (ACLs):**
   - Three standard roles: `Viewer` (read-only), `Commenter` (read + add comment markers), `Editor` (read + write + commit revisions).
   - Owner retains exclusive rights to change permissions, transfer ownership, or delete items.
3. **Cryptographic Share Links:** Generated via SHA-256 tokens; optional password protection hashes passwords with Argon2id via `Bun.password.hash()`.
4. **Clean-Room Enforcement:**
   - Universal open file interchange (PDF ISO 32000, Office Open XML ECMA-376, OpenDocument OASIS, CommonMark).
   - Zero proprietary Google serialization formats (no Google internal protobufs or proprietary RPC protocols).
   - Complete data ownership: users can export their entire Drive and document histories as raw files at any time.
