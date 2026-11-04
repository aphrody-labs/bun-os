# Spotcraft (ex-WGA) — Reconnaissance Map

> **Reverse-Engineered Source**: `C:\Users\aphro\AppData\Local\Google\Google` (`com.google.windows.app`)  
> **Rebuilt Product**: **Spotcraft** (Bun OS Spotlight Desktop Assistant)

---

## 1. Screen Inventory

| Screen ID | Screen Name | Route / Invocation | Purpose & Key Components |
| :--- | :--- | :--- | :--- |
| **S01** | **Spotlight Search Bar** | `spotcraft://` / `Alt+Space` | Floating centered search bar; instant FTS5 file results, app shortcuts, calculation results, web suggestion list. Key navigation (`Up`/`Down`/`Enter`/`Esc`). |
| **S02** | **Region Screen Capture** | `spotcraft://capture` / `Ctrl+Shift+S` | Fullscreen borderless transparent overlay with marquee drag selection, instant visual crop, text OCR extraction, and visual search trigger. |
| **S03** | **Tools & Assistant HUD** | `spotcraft://tools` | Quick launcher dock with buttons for Screen Capture, Live Voice Chat, File Index Status, Recent History, and Settings. |
| **S04** | **Settings & Local Storage** | `spotcraft://settings` | Local indexed folders configuration (`Documents`, `Downloads`, `Code`), Copilot key toggle, dark/light theme, local FTS5 database maintenance. |
| **S05** | **Inquiry & Thread History** | `spotcraft://history` | Search query log, saved visual screen snippets, file launch history. Local-first storage in SQLite. |

---

## 2. User Flows

### Flow F01: Instant Local File Discovery & Launch
1. User presses `Alt+Space` (or hardware Copilot key).
2. S01 Spotlight bar opens instantaneously (<20ms).
3. User types `project.rs`.
4. S01 queries local SQLite FTS5 database; results populate with file type icons, path subtitles, and modification dates.
5. User presses `Enter` -> file opens in default editor; or `Ctrl+Enter` -> folder opens in file manager.

### Flow F02: Circle to Search / Visual Region Inspection
1. User presses `Ctrl+Shift+S` (or clicks Capture icon on S03).
2. S02 transparent fullscreen overlay opens with precision crosshair cursor.
3. User drags a rectangle over an image, diagram, or error code on screen.
4. Selection snaps with animated Cyber Cyan reticle; thumbnail preview appears in floating action pill.
5. User clicks "Ask AI" or "Search Image" -> multimodal inspection dispatches.

### Flow F03: Hardware Copilot Key Hijack
1. User presses Windows 11 keyboard **Copilot** key.
2. Windows invokes `com.microsoft.windows.copilotkeyprovider`.
3. Spotcraft intercepts signal and activates S01 Spotlight HUD.

---

## 3. Inferred Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                      local_files (SQLite)                   │
├───────────────────┬──────────────┬──────────────────────────┤
│ file_id           │ INTEGER PK   │ Auto-increment           │
│ file_path         │ TEXT UNIQUE  │ Absolute path            │
│ parent_path       │ TEXT         │ Indexed directory        │
│ filename          │ TEXT         │ File name                │
│ extension         │ TEXT         │ lowercase extension      │
│ is_directory      │ INTEGER      │ 0 or 1                   │
│ is_users_directory│ INTEGER      │ 0 or 1                   │
│ last_modified     │ INTEGER      │ Unix epoch timestamp     │
└───────────────────┴──────────────┴──────────────────────────┘
                              ▲
                              │ Virtual Table FTS5
┌─────────────────────────────┴───────────────────────────────┐
│                     local_files_fts (FTS5)                  │
├───────────────────┬──────────────┬──────────────────────────┤
│ file_path         │ TEXT         │ Tokenized path           │
│ filename          │ TEXT         │ Tokenized filename       │
└───────────────────┴──────────────┴──────────────────────────┘
```
