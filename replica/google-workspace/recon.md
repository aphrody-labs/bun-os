# Recon map: Google Workspace & Google Apps Ecosystem (Web)

**Scope:** The end-to-end cloud storage, file organization, cross-modal search, and creative document suite of Google Workspace & Google Apps. Clean-room replication targeting **Aphrody Drive (`apps/drive`)**, **WordCraft (`apps/wordcraft-web` / `apps/wordcraft`)**, **GridCraft (`apps/gridcraft-web` / `apps/gridcraft`)**, **DeckCraft (`apps/deckcraft-web` / `apps/deckcraft`)**, **PDFCraft (`apps/pdfcraft-web`)**, **Aphrody Account Quota & Storage Manager (`packages/identity`)**, and **WordCraft Quick Notes & Scrapbooks**.  
**Operating Environment:** Bun OS / Aphrody WebOS session, powered by upstream Bun (`v1.4.4+`), Rust WebAssembly studios (eframe/wgpu), local-first OPFS/SQLite storage, and zero-telemetry local encryption.  
**Strict Clean-Room Stance:** Derived exclusively from public API specifications (Google Drive API v3, Google Docs API v1, Google Sheets API v4, Google Slides API v1), observed web application UX patterns, standard interchange file formats (OpenDocument, Office Open XML, PDF ISO 32000, CSV, CommonMark), and local screenshots. Zero decompiled Google JS, zero proprietary Google endpoints, zero telemetry tracking.  
**Date:** 2026-11-04  

---

## Sources

| # | Source | URL | What It Yields |
|---|---|---|---|
| 1 | Google Workspace Suite Overview | https://workspace.google.com/ | Suite topology, product branding boundaries, shared collaboration concepts |
| 2 | Google Drive Product Overview | https://workspace.google.com/products/drive/ | Cloud storage capabilities, search filtering, sharing controls, offline modes |
| 3 | Google Drive Web App | https://drive.google.com/drive/home | Visual layout: search bar with chips, sidebar tree, suggested files, grid/list view, details drawer |
| 4 | Google Docs Web App & Hub | https://docs.google.com/document/ | Document launcher: template ribbon, recent docs list, sorting, view toggles |
| 5 | Google Sheets Web App & Hub | https://docs.google.com/spreadsheets/ | Spreadsheet launcher, formula bar ($f_x$), sheet tabs, matrix headers, cell formatting |
| 6 | Google Slides Web App & Hub | https://docs.google.com/presentation/ | Presentation launcher, 16:9 vector canvas, left filmstrip sidebar, themes drawer |
| 7 | Google Drive Help Center | https://support.google.com/drive/ | Storage quotas, file lifecycle (trash 30d), revision limits, sharing role matrix |
| 8 | Google Docs Help Center | https://support.google.com/docs/ | Document styling, tables, revision history, export formats, comments & suggestions |
| 9 | Google Sheets Help Center | https://support.google.com/sheets/ | Formula syntax, cell reference algebra, multi-sheet references, conditional formatting |
| 10 | Google Slides Help Center | https://support.google.com/slides/ | Vector shapes, z-index ordering, master layouts, presenter display notes |
| 11 | Google Drive REST API v3 | https://developers.google.com/drive/api/v3/reference | Public REST endpoints and schemas for Files, Permissions, Revisions, Comments |
| 12 | Google Docs REST API v1 | https://developers.google.com/docs/api/reference/rest/v1/documents | Structural document elements: Paragraph, Table, SectionBreak, InlineObject, TextStyle |
| 13 | Google Sheets REST API v4 | https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets | GridData, RowData, CellData, ExtendedValue, CellFormat, GridProperties |
| 14 | Google Slides REST API v1 | https://developers.google.com/slides/api/reference/rest/v1/presentations | Page, PageElement, Shape, Table, Line, AffineTransform, LayoutReference |
| 15 | Google One Storage Center | https://one.google.com/storage | Quota breakdown visualizations, storage cleanup manager, backup snapshots |
| 16 | Google Keep Web Notes | https://keep.google.com/ | Masonry note cards, checklist items, color tags, pinned notes, quick conversion |

---

## Reference Screenshots (Captured Live via Chrome DevTools Protocol)

The live user journey across the target ecosystem was captured directly into `replica/screens/google-workspace/`:

1. **S01 — Workspace Suite Landing:** [`s01-workspace-suite-landing.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s01-workspace-suite-landing.png)  
   *Overview of collaboration ecosystem, navigation, and product entry points.*
2. **S02 — Google Drive Product Showcase:** [`s02-drive-product-overview.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s02-drive-product-overview.png)  
   *Storage value proposition, security highlights, sharing controls, and CTA.*
3. **S03 — Google Drive Home Dashboard:** [`s03-drive-home-dashboard.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s03-drive-home-dashboard.png)  
   *Suggested files, recent activity, search bar with filter chips, left navigation rail.*
4. **S04 — Google Drive My Drive Explorer:** [`s04-drive-my-drive-explorer.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s04-drive-my-drive-explorer.png)  
   *Folder hierarchy, breadcrumb path, grid/list view toggle, sorting columns.*
5. **S05 — Google Docs Home & Hub:** [`s05-docs-home-hub.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s05-docs-home-hub.png)  
   *Template gallery ribbon (Blank, Resume, Letter, Project Proposal), recent document cards, owned-by filters.*
6. **S06 — Google Docs Rich-Text Canvas:** [`s06-docs-editor-canvas.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s06-docs-editor-canvas.png)  
   *WYSIWYG document surface, menu bar, formatting ribbon, status indicator ("Enregistré dans Drive"), share button.*
7. **S07 — Google Sheets Home & Hub:** [`s07-sheets-home-hub.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s07-sheets-home-hub.png)  
   *Spreadsheet launcher, template gallery (Planning, Budget, Facture), recent sheets list.*
8. **S08 — Google Sheets Matrix & Grid Editor:** [`s08-sheets-editor-grid.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s08-sheets-editor-grid.png)  
   *Formula bar ($f_x$), column/row headers ($A, B, C... 1, 2, 3...$), cell formatting, sheet tabs (Feuille 1).*
9. **S09 — Google Slides Home & Hub:** [`s09-slides-home-hub.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s09-slides-home-hub.png)  
   *Presentation launcher, template gallery (Album photo, Portfolio, Recette, Projet), recent slide decks list.*
10. **S10 — Google Slides Deck Canvas & Editor:** [`s10-slides-editor-canvas.png`](file:///C:/src/bun-os/replica/screens/google-workspace/s10-slides-editor-canvas.png)  
    *Slide deck filmstrip on the left, 16:9 presentation canvas with bounding handles, "Thèmes" sidebar on the right.*

---

## Core Loop

```
+-----------------------------------------------------------------------------------+
|                            Aphrody Account & Storage                              |
|          (Identity Quota, Local Snapshot Backup, Cleanup Assistant)               |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                               Aphrody Drive (`apps/drive`)                        |
|   Hierarchical Storage  <---->  Instant Search & Chips  <---->  ACL Sharing & Trash|
+------------------------------------------+----------------------------------------+
                                           |
         +-----------------+---------------+----------------+----------------+
         |                 |                                |                |
         v                 v                                v                v
   +-----------+     +------------+                   +------------+   +------------+
   | WordCraft |     |  GridCraft |                   |  DeckCraft |   |  PDFCraft  |
   | Docs &    |     | Sheets &   |                   | Slides &   |   | Annotation |
   | Notes     |     | Formulas   |                   | Decks      |   | & Forms    |
   +-----------+     +------------+                   +------------+   +------------+
         |                 |                                |                |
         +-----------------+---------------+----------------+----------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|               Local-First Persistence (OPFS / SQLite WAL) & Export               |
|            (PDF, DOCX, XLSX, CSV, PPTX, CommonMark, OpenDocument)                |
+-----------------------------------------------------------------------------------+
```

1. **Ingest / Organize:** Upload files, create folders, or capture quick notes in Aphrody Drive.
2. **Launch & Author:** Open or instantiate documents in dedicated high-performance WebAssembly studios:
   - Rich paginated prose $\rightarrow$ **WordCraft** (`apps/wordcraft-web`)
   - Reactive tabular calculations $\rightarrow$ **GridCraft** (`apps/gridcraft-web`)
   - Visual slide presentations $\rightarrow$ **DeckCraft** (`apps/deckcraft-web`)
   - PDF review, forms & annotation $\rightarrow$ **PDFCraft** (`apps/pdfcraft-web`)
   - Fast scrapbooking & capture $\rightarrow$ **Quick Notes**
3. **Persist & Reconcile:** Save synchronously to local Origin Private File System (OPFS) and SQLite WAL, syncing transparently with Bun.serve backend storage.
4. **Exchange & Share:** Export with zero fidelity loss to standard open and office file formats or distribute via cryptographic ACL links.

---

## Complete Screens Inventory (S01 to S25)

| ID | Screen Name | Route / Trigger | Target App / Package | Purpose | Key Components | Observed States |
|:---|:---|:---|:---|:---|:---|:---|
| **S01** | Workspace Suite Landing | `/` | Suite Hub | Portfolio discovery & application launcher | App launcher grid, quick action cards, storage gauge, system status | filled, responsive |
| **S02** | Drive Product Showcase | `/products/drive` | Suite Hub | Storage capabilities & privacy overview | Hero graphic, local-first highlights, encryption badges, CTA | default |
| **S03** | Drive Home Dashboard | `/drive/home` | Aphrody Drive (`apps/drive`) | Central activity hub with suggested & recent files | Search bar with filter chips, suggested cards carousel, recent file list, navigation rail | empty, populated, loading |
| **S04** | My Drive Explorer | `/drive/my-drive` | Aphrody Drive (`apps/drive`) | Hierarchical tree & folder browser | Breadcrumb path, grid/list view toggle, sort dropdown, folder cards, file rows, drop-zone | empty folder, populated, drag-over |
| **S05** | Drive Search & Filter View | `/drive/search?q=...` | Aphrody Drive (`apps/drive`) | Query-based file discovery with faceted filters | Search query field, type chips (Docs, Sheets, Slides, PDFs, Media), owner filter, date picker | typing, searching, no results, results |
| **S06** | "New" Action & Upload Drawer | Click `+ New` button | Aphrody Drive (`apps/drive`) | Create items and monitor uploads | Popover menu (New Folder, Upload File, Upload Folder, WordCraft Doc, GridCraft Sheet, DeckCraft Slide), floating progress drawer | open, minimized, upload in-progress, upload complete |
| **S07** | File Preview Overlay | Double-click non-studio file | Aphrody Drive (`apps/drive`) | Inspect media and documents without launch | Modal darkroom, zoom controls, download action, print action, "Open with Studio" picker | loading, rendered (image/PDF/code), unsupported format |
| **S08** | Details & Activity Pane | Select file $\rightarrow$ Info `(i)` | Aphrody Drive (`apps/drive`) | Inspect file metadata, permissions, audit history | Right sidebar: file preview thumbnail, file size, MIME type, storage path, creation/edit timestamp, activity feed | closed, open (Details tab), open (Activity tab) |
| **S09** | Shared With Me | `/drive/shared-with-me` | Aphrody Drive (`apps/drive`) | Files shared by collaborators across the mesh | Grouped list by date shared, collaborator avatars, search within shared, access level badge | empty, populated |
| **S10** | Trash & Purge Quota | `/drive/trash` | Aphrody Drive (`apps/drive`) | Soft-deleted file quarantine & recovery | Notice banner ("Items deleted after 30 days"), Empty Trash button, Restore button, Delete Permanently button | empty trash, populated, item selected |
| **S11** | Share & ACL Permissions Dialog | Select item $\rightarrow$ "Share" | Aphrody Drive & Studios | Manage item access and cryptographic links | Modal dialog, user/team autocomplete, role picker (Viewer / Commenter / Editor), Link sharing switch, Expiration date input | private, link-active, saving, error |
| **S12** | WordCraft Home Hub | `/document/u/0/` | WordCraft (`apps/wordcraft-web`) | Document launcher and template gallery | Template ribbon (Blank, Resume, Meeting Notes, Report, Letter), recent documents grid/list, sort menu | populated, template expanded |
| **S13** | WordCraft WYSIWYG Canvas | `/document/d/{id}/edit` | WordCraft (`apps/wordcraft-web`) | Paginated rich-text authoring & editing | Menu bar (File/Edit/View/Insert/Format), formatting ribbon, margin ruler, paginated canvas, heading outline tree, status pill | empty doc, editing, saving, offline |
| **S14** | WordCraft Version History | WordCraft $\rightarrow$ File $\rightarrow$ Version History | WordCraft (`apps/wordcraft-web`) | Historical revisions inspection and diff rollback | Right revision drawer, timestamped entries, diff toggle (red/green highlights), "Restore this version" action | loading revisions, diff mode |
| **S15** | WordCraft Export & Print Dialog | WordCraft $\rightarrow$ File $\rightarrow$ Download | WordCraft (`apps/wordcraft-web`) | Export document to standard interchange formats | Dropdown submenu: PDF, DOCX, Markdown, EPUB, TXT, HTML zip | generating, downloaded |
| **S16** | WordCraft Comment & Review Thread | Highlight text $\rightarrow$ Add Comment | WordCraft (`apps/wordcraft-web`) | Collaborative review and suggestion marks | Margin-anchored comment cards, reply input, resolve checkmark, suggestion mode toggle | active thread, resolved list |
| **S17** | GridCraft Home Hub | `/spreadsheets/u/0/` | GridCraft (`apps/gridcraft-web`) | Spreadsheet launcher and templates | Template carousel (Blank, Budget, Schedule, Invoice), recent sheets list, owner filter | populated |
| **S18** | GridCraft Matrix & Formula Studio | `/spreadsheets/d/{id}/edit` | GridCraft (`apps/gridcraft-web`) | Reactive calculation grid & formula engine | Formula bar with $f_x$ helper, column letters ($A..Z$), row numbers ($1..N$), cell selection box, formatting toolbar, sheet tabs bar (`Sheet1`, `+`) | editing cell, formula helper tooltip, calculation error |
| **S19** | GridCraft Data Import/Export Wizard | GridCraft $\rightarrow$ File $\rightarrow$ Import | GridCraft (`apps/gridcraft-web`) | Delimited and structured data parser | Modal: file picker, delimiter detector (comma, tab, semicolon), character encoding, replace/append sheet option | previewing parsed grid, importing |
| **S20** | DeckCraft Home Hub | `/presentation/u/0/` | DeckCraft (`apps/deckcraft-web`) | Presentation launcher and templates | Template gallery (Blank, Pitch Deck, Portfolio, Report), recent decks list | populated |
| **S21** | DeckCraft 16:9 Presentation Studio | `/presentation/d/{id}/edit` | DeckCraft (`apps/deckcraft-web`) | Slide deck authoring and vector layout | Left slide filmstrip track, center 16:9 vector canvas with object handles, top toolbar (shapes, text, image, layout), right Theme drawer | slide selected, shape dragging, text editing |
| **S22** | DeckCraft Fullscreen Presenter Mode | DeckCraft $\rightarrow$ "Present" | DeckCraft (`apps/deckcraft-web`) | Live slide presentation delivery | Fullscreen slide renderer, presenter console window (timer, speaker notes, upcoming slide preview, pointer) | active presentation, paused, black screen toggle |
| **S23** | PDFCraft Viewer & Annotation Studio | `/pdfcraft/{id}` | PDFCraft (`apps/pdfcraft-web`) | PDF inspection, annotation, and form filling | Left page thumbnail strip, center vector PDF canvas, top tool ribbon (select, pen, highlight, text box, stamp), form field highlights | viewing, annotating, page reordering |
| **S24** | Aphrody Account Storage & Quota Manager | `/account/storage` | Identity (`packages/identity`) | Storage quota monitoring and cleanup assistant | Multi-tier circular gauge (Drive, Craft Docs, Snapshots), large file list, trash cleanup recommendation, snapshot export | normal quota, near quota limit, cleanup running |
| **S25** | WordCraft Quick Notes & Scrapbook | `/notes` or Flyout Capsule | WordCraft & Identity | Lightweight note capture and scratchpad | Masonry grid of color-coded cards, rich checklist items, pinned section, search bar, "Open in WordCraft" button | empty notes, populated grid, checklist editing |

---

## Detailed User Flows (F01 to F10)

### F01: Multi-File & Folder Upload into Aphrody Drive
- **Path:** `S03` (Drive Home) $\rightarrow$ `S04` (My Drive) $\rightarrow$ `S06` (Click `+ New` $\rightarrow$ "Upload Files" or drag files into drop zone) $\rightarrow$ S06 upload progress drawer $\rightarrow$ `S04` refreshed with new items.
- **Happy Path:** 3 clicks (Click `+ New` $\rightarrow$ select files $\rightarrow$ upload).
- **Edge Cases:** Network disconnect mid-upload (automatic resume via chunked SHA-256 upload), file name collisions (prompt: "Keep both" / "Overwrite"), quota exhaustion (modal trigger to S24).

### F02: Create, Format, and Structure a Document in WordCraft
- **Path:** `S04` (My Drive) $\rightarrow$ `S06` (Click `+ New` $\rightarrow$ "WordCraft Document") $\rightarrow$ `S13` (WordCraft Studio) $\rightarrow$ enter title $\rightarrow$ insert headings and body text $\rightarrow$ heading outline tree populates $\rightarrow$ status pill displays "Saved to Drive".
- **Happy Path:** 2 clicks (`+ New` $\rightarrow$ "WordCraft Document") + typing.
- **Edge Cases:** Offline state (local OPFS cache immediately buffers changes; sync pill shifts to "Saved locally (Offline)"), auto-generation of document title from first H1 line if left untitled.

### F03: Create Reactive Calculation Spreadsheet in GridCraft
- **Path:** `S04` (My Drive) $\rightarrow$ `S06` (Click `+ New` $\rightarrow$ "GridCraft Sheet") $\rightarrow$ `S18` (GridCraft Studio) $\rightarrow$ click cell A1 $\rightarrow$ type formula `=SUM(B1:B10)` into formula bar $f_x$ $\rightarrow$ add new sheet tab $\rightarrow$ export to XLSX via File menu.
- **Happy Path:** 2 clicks to open + entering values and formula.
- **Edge Cases:** Circular reference detection (presents `#REF!` error callout), dividing by zero (`#DIV/0!`), massive dataset scrolling (virtualized viewports render 100k+ cells at 60 FPS).

### F04: Author Multi-Slide Presentation in DeckCraft
- **Path:** `S04` (My Drive) $\rightarrow$ `S06` (Click `+ New` $\rightarrow$ "DeckCraft Presentation") $\rightarrow$ `S21` (DeckCraft Studio) $\rightarrow$ select theme from right drawer $\rightarrow$ insert text and vector shapes on 16:9 canvas $\rightarrow$ click `+ Slide` in left filmstrip $\rightarrow$ click "Present" $\rightarrow$ `S22` (Fullscreen Presentation).
- **Happy Path:** 4 clicks (New Deck $\rightarrow$ Pick Theme $\rightarrow$ Add Slide $\rightarrow$ Present).
- **Edge Cases:** Ratio mismatch on imported PPTX (auto-converts 4:3 to 16:9 with letterboxing option), font fallbacks for missing system fonts.

### F05: Annotate, Form-Fill, and Extract Pages in PDFCraft
- **Path:** `S04` (My Drive) $\rightarrow$ double-click PDF file $\rightarrow$ `S23` (PDFCraft Studio) $\rightarrow$ select text highlight tool $\rightarrow$ fill in interactive form fields $\rightarrow$ reorder page thumbnails in sidebar $\rightarrow$ click "Save as Flattened PDF".
- **Happy Path:** 3 clicks (Open PDF $\rightarrow$ Annotate $\rightarrow$ Save).
- **Edge Cases:** Password-protected PDFs (unlock prompt modal), malformed PDF objects (strict fallback to vector glyph rendering).

### F06: Search and Filter Across Drive & Craft Ecosystem
- **Path:** `S03` (Drive Home) $\rightarrow$ focus search input $\rightarrow$ select "Spreadsheets" filter chip $\rightarrow$ enter query keyword $\rightarrow$ `S05` (Search Results) $\rightarrow$ select result $\rightarrow$ preview in `S07` or open directly in studio.
- **Happy Path:** 2 clicks + typing query.
- **Edge Cases:** Query syntax operators (`type:pdf`, `owner:me`, `after:2026-01-01`), full-text search indexing delays for newly uploaded binary files.

### F07: Secure File Sharing & Cryptographic Link Permissions
- **Path:** `S04` (My Drive) or studio header $\rightarrow$ click "Share" $\rightarrow$ `S11` (Share Dialog) $\rightarrow$ select role (Viewer / Commenter / Editor) $\rightarrow$ generate cryptographic share link $\rightarrow$ copy to clipboard.
- **Happy Path:** 3 clicks (Share $\rightarrow$ Role $\rightarrow$ Copy Link).
- **Edge Cases:** Link expiry elapsed, revoking public access resets token immediately across all active WebSocket sessions.

### F08: Document Version History Inspection & Rollback
- **Path:** `S13` (WordCraft) $\rightarrow$ File menu $\rightarrow$ "Version History" $\rightarrow$ `S14` (Revision Drawer) $\rightarrow$ click past timestamp $\rightarrow$ visual diff displays red deletions and green additions $\rightarrow$ click "Restore this version".
- **Happy Path:** 4 clicks (File $\rightarrow$ History $\rightarrow$ Select Version $\rightarrow$ Restore).
- **Edge Cases:** Unsaved local changes prior to restore (auto-saves current state as a new revision checkpoint before restoring older version).

### F09: Quick Note Capture and Conversion to Full Document
- **Path:** `S25` (WordCraft Notes) $\rightarrow$ click "Take a note..." $\rightarrow$ add title and checklist items $\rightarrow$ click note menu `...` $\rightarrow$ "Convert to WordCraft Document" $\rightarrow$ opens `S13` as a full formatted document saved in Drive.
- **Happy Path:** 3 clicks (Create Note $\rightarrow$ Options $\rightarrow$ Convert).
- **Edge Cases:** Checklist conversion automatically maps Markdown `[ ]` syntax to WordCraft task blocks.

### F10: Storage Quota Audit and Cleanup Assistant
- **Path:** `S03` (Drive Home) $\rightarrow$ click storage gauge in sidebar $\rightarrow$ `S24` (Storage Manager) $\rightarrow$ review storage breakdown (Drive blobs vs. Craft document deltas vs. snapshots) $\rightarrow$ click "Clean Up Trash" $\rightarrow$ confirm permanent purge.
- **Happy Path:** 3 clicks (Storage gauge $\rightarrow$ Clean Up $\rightarrow$ Confirm Purge).
- **Edge Cases:** User attempts to empty trash with active file locks in other open studio tabs (warns and gracefully purges unpinned items).

---

## Reusable Component Catalog

| Component | Variants | Interactive States | Used On |
|:---|:---|:---|:---|
| **App Shell Rail** | Compact icon rail, Expanded sidebar | default, active route, badge notification, collapsed | S01, S03, S04, S09, S10, S24 |
| **Primary Action Button (+ New)** | Floating Action Button (FAB), Sidebar pill button | default, hover, active, popover opened | S03, S04, S09, S10 |
| **Search Bar & Filter Chips** | Full-width header input + horizontal scroll chip bar | idle, focused, active chip, clearable, loading spinner | S03, S04, S05, S12, S17, S20 |
| **File Grid Card** | Folder card, Document thumbnail card, Media preview card | idle, hover, selected, dragging, context-menu active | S03, S04, S05, S09, S11, S12, S17, S20 |
| **File Tabular Row** | Standard list row with Name, Owner, Date, Size, Actions | idle, selected, multi-select, right-click, sorting column | S04, S05, S09, S10, S24 |
| **Breadcrumb Trail** | Hierarchical path segments with overflow menu | idle segment, hover segment, active leaf, drop-target | S04, S05 |
| **Studio Header & Menu Bar** | Title input + File/Edit/View/Insert menus + Status pill | editing title, menu open, status syncing, status saved | S13, S18, S21, S23 |
| **WYSIWYG Toolbar** | Rich-text formatting toolbar (Fonts, Sizes, B/I/U, Color, Align) | active toggle, dropdown opened, disabled | S13, S25 |
| **Matrix Formula Bar ($f_x$)** | Cell coordinate indicator + Formula input field | idle, typing, syntax highlighted, autocomplete tooltip | S18 |
| **Slide Filmstrip Sidebar** | Vertical thumbnail stack of 16:9 slides | default, selected, dragging/reordering, right-click menu | S21 |
| **Document Outline Tree** | Hierarchical H1/H2/H3 anchor list | default, active anchor highlighted, collapsed | S13 |
| **Inspector Drawer** | File Details, Slide Themes, Version History, Comments | closed, open, animating, tabs switched | S08, S14, S16, S21 |
| **Modal Dialog** | Share Dialog, Template Gallery, Import Wizard, Confirm Purge | hidden, open, form submitting, error message | S06, S11, S15, S19, S24 |
| **Floating Progress Drawer** | Multi-item upload / export progress window | minimized, expanded, per-item progress bar, cancel action | S04, S06, S15, S19 |
| **Toast Notification** | Undo action toast, Error alert toast, Link copied toast | enter, visible with action button, timer exit | All screens |

---

## Inferred Relational Data Schemas

```
DriveItem
    id: UUID (Primary Key)
    workspace_id: UUID
    parent_folder_id: UUID (Nullable, NULL = root)
    name: string
    mime_type: string (e.g., 'application/vnd.aphrody.wordcraft', 'application/pdf')
    size_bytes: int64
    content_hash: string (SHA-256 for CAS deduplication)
    owner_id: UUID
    is_folder: boolean
    is_starred: boolean
    is_trashed: boolean
    trashed_at: ISO8601 (Nullable)
    created_at: ISO8601
    updated_at: ISO8601
    evidence: Drive REST API v3 files resource, S04/S08 inspection
    confidence: high

WordCraftDocument
    id: UUID (Primary Key)
    drive_item_id: UUID (Foreign Key -> DriveItem.id)
    title: string
    body_tree: JSONB (ProseMirror/Yjs AST: blocks, headings, paragraphs, lists, tables)
    page_setup: JSONB (margins: {top, bottom, left, right}, orientation, paper_size: 'A4'|'Letter')
    active_revision_id: UUID
    updated_at: ISO8601
    evidence: Docs REST API v1 documents resource, S13 canvas inspection
    confidence: high

GridCraftSpreadsheet
    id: UUID (Primary Key)
    drive_item_id: UUID (Foreign Key -> DriveItem.id)
    sheets: JSONB (Array of SheetConfig: { id, title, index, row_count, col_count, grid_properties })
    cells: JSONB / SQLite Table (sheet_id, row, col, raw_value, formula, formatted_value, style)
    named_ranges: JSONB
    active_sheet_index: int32
    evidence: Sheets REST API v4 spreadsheets resource, S18 formula matrix inspection
    confidence: high

DeckCraftPresentation
    id: UUID (Primary Key)
    drive_item_id: UUID (Foreign Key -> DriveItem.id)
    slide_width: float32 (e.g., 960.0 for 16:9)
    slide_height: float32 (e.g., 540.0 for 16:9)
    theme_id: string
    slides: JSONB (Array of SlideObject: { id, layout, elements: [{ id, type, transform, shape, text }] })
    speaker_notes: JSONB
    evidence: Slides REST API v1 presentations resource, S21 deck canvas inspection
    confidence: high

PDFCraftAnnotation
    id: UUID (Primary Key)
    drive_item_id: UUID (Foreign Key -> DriveItem.id)
    page_number: int32
    annotation_type: enum ('highlight', 'ink', 'text_note', 'form_value', 'stamp')
    geometry: JSONB (bounding box [x0, y0, x1, y1] or vector stroke points)
    contents: string
    author_id: UUID
    created_at: ISO8601
    evidence: PDF ISO 32000 annotation dictionaries, S23 annotation studio inspection
    confidence: high

QuickNote
    id: UUID (Primary Key)
    workspace_id: UUID
    title: string
    body_markdown: string
    checklist_items: JSONB (Array of { id, text, is_done })
    color_label: string ('default' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple')
    is_pinned: boolean
    is_archived: boolean
    linked_drive_item_id: UUID (Nullable, set when converted to WordCraft)
    created_at: ISO8601
    updated_at: ISO8601
    evidence: Google Keep card layout, S25 inspection
    confidence: high

DocumentRevision
    id: UUID (Primary Key)
    document_id: UUID (Foreign Key -> WordCraft/GridCraft/DeckCraft)
    revision_number: int32
    author_id: UUID
    timestamp: ISO8601
    delta_blob: BLOB (Compressed binary delta / CRDT snapshot)
    label: string (Optional named version e.g. "Final Draft")
    evidence: S14 Version History drawer, Drive API revisions resource
    confidence: high

SharePermission
    id: UUID (Primary Key)
    item_id: UUID (Foreign Key -> DriveItem.id)
    principal_type: enum ('user', 'team', 'public_link')
    principal_id: UUID (Nullable for public_link)
    role: enum ('viewer', 'commenter', 'editor')
    passkey_hash: string (Nullable, for protected public links)
    expires_at: ISO8601 (Nullable)
    created_at: ISO8601
    evidence: S11 Share Dialog, Drive API permissions resource
    confidence: high

StorageQuota
    user_id: UUID (Primary Key)
    allocated_bytes: int64
    used_bytes: int64
    drive_blobs_bytes: int64
    craft_docs_bytes: int64
    snapshot_backups_bytes: int64
    trash_bytes: int64
    last_computed_at: ISO8601
    evidence: Google One storage breakdown, S24 inspection
    confidence: high
```

### Relational Entity Graph

```
WorkspaceUser (1)
  |-- (N) DriveItem (Owner)
  |        |-- (1) WordCraftDocument (when mime_type == wordcraft)
  |        |        |-- (N) DocumentRevision
  |        |        `-- (N) CommentThread
  |        |-- (1) GridCraftSpreadsheet (when mime_type == gridcraft)
  |        |        `-- (N) DocumentRevision
  |        |-- (1) DeckCraftPresentation (when mime_type == deckcraft)
  |        |        `-- (N) DocumentRevision
  |        |-- (1) PDFCraftAnnotation (when mime_type == pdf)
  |        `-- (N) SharePermission
  |-- (N) QuickNote
  `-- (1) StorageQuota
```

---

## Feature Matrix Summary

The comprehensive feature matrix across all 7 applications is tracked in `features.csv`:
- **Must-have (P1) Features:** 34 core capabilities (Full Drive navigation, folder tree, multi-file upload, instant search with chips, grid/list view, soft-delete trash & purge, sharing ACLs, WordCraft paginated canvas, heading outline, export to PDF/DOCX/MD, GridCraft calculation matrix, $f_x$ formula engine, multi-sheet tabs, XLSX/CSV parser, DeckCraft 16:9 canvas, filmstrip navigation, PDFCraft viewer & annotation, Storage Quota breakdown, Quick Notes capture).
- **Should-have (P2) Features:** 12 advanced capabilities (Document template galleries, interactive tables creation, comment threads with @mentions, presentation speaker notes, PDF form field auto-fill, duplicate file finder in cleanup assistant, color-coded note tags).
- **Could-have (P3) Features:** 4 auxiliary capabilities (DeckCraft animations & transitions, advanced conditional formatting color scales, spreadsheet charts rendering).
- **Skip / Out of Scope:** 4 proprietary items (Google Apps Script proprietary macro VM, Google Gemini enterprise DLP cloud policies, closed Workspace Marketplace store, proprietary Google Account OAuth tracking).

---

## Out of Scope (Clean-Room Boundary)

1. **Google Apps Script Proprietary Engine:** Aphrody replaces closed proprietary scripting with standard TypeScript and Bun APIs (`import { $ } from "bun"`).
2. **Google Enterprise DLP & Privacy Logging:** Aphrody utilizes client-side zero-telemetry encryption and standard POSIX/WebOS ACLs.
3. **Google Account Closed OAuth Infrastructure:** Aphrody leverages `packages/identity` passkeys, ed25519 cryptographic keys, and local SQLite session stores.
4. **Proprietary Workspace Marketplace:** Replaced by Bun OS native plugins architecture (`packages/bun-os-plugins`).

---

## Size & Complexity

- **Screens:** 25 verified screens and drawer surfaces.
- **Flows:** 10 end-to-end user journeys with happy paths and edge cases.
- **Entities:** 9 relational database entities with referential integrity.
- **Hard Technical Challenges:**
  1. *Paginated Vector Canvas in WebAssembly:* Rendering high-DPI text layout, cursor tracking, and page break mathematics in Rust/wgpu without DOM lag.
  2. *Reactive Dependency-Graph Formula Engine:* Instant recalculation of formulas across thousands of cells and multi-sheet references.
  3. *Local-First Storage Synchronization:* OPFS and SQLite WAL caching allowing full offline functionality with deterministic conflict reconciliation.
  4. *Lossless Document Interchange:* Bi-directional compilation to and from standard OpenDocument, OpenXML (DOCX, XLSX, PPTX), and PDF standards.
