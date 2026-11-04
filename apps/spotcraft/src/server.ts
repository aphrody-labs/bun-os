// SPDX-License-Identifier: Apache-2.0
/**
 * Spotcraft Backend Server — Sovereign Local-First Desktop Spotlight & Assistant.
 * Uses clean-room WGA (Windows Google App) & local FTS5 index contracts from crates/bun-os-google/src/wga.rs.
 */
import { Database } from "bun:sqlite";
import indexHtml from "../index.html";

const port = Number(process.env.PORT) || 8792;
const dbPath = process.env.LOCAL_FILES_DB || "local_files.db";

// 1. Initialize SQLite FTS5 database matching WGA's clean-room schema
const db = new Database(dbPath);
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");

db.run(`
CREATE TABLE IF NOT EXISTS local_files (
  file_id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE COLLATE NOCASE,
  parent_path TEXT,
  filename TEXT,
  extension TEXT,
  is_directory INTEGER,
  is_users_directory INTEGER,
  last_modified INTEGER
);
CREATE INDEX IF NOT EXISTS idx_parent_path ON local_files(parent_path);
CREATE VIRTUAL TABLE IF NOT EXISTS local_files_fts USING fts5(
  file_path,
  filename,
  content='local_files',
  content_rowid='file_id'
);
CREATE TRIGGER IF NOT EXISTS local_files_ai AFTER INSERT ON local_files BEGIN
  INSERT INTO local_files_fts(rowid, file_path, filename) VALUES (new.file_id, new.file_path, new.filename);
END;
CREATE TRIGGER IF NOT EXISTS local_files_ad AFTER DELETE ON local_files BEGIN
  INSERT INTO local_files_fts(local_files_fts, rowid, file_path, filename) VALUES('delete', old.file_id, old.file_path, old.filename);
END;
CREATE TRIGGER IF NOT EXISTS local_files_au AFTER UPDATE ON local_files BEGIN
  INSERT INTO local_files_fts(local_files_fts, rowid, file_path, filename) VALUES('delete', old.file_id, old.file_path, old.filename);
  INSERT INTO local_files_fts(rowid, file_path, filename) VALUES (new.file_id, new.file_path, new.filename);
END;
`);

// Seed default index if empty
const countRow = db.query("SELECT COUNT(*) as c FROM local_files").get() as { c: number };
if (countRow.c === 0) {
  const seedFiles = [
    { path: "crates/bun-os-google/src/wga.rs", parent: "crates/bun-os-google/src", name: "wga.rs", ext: "rs", isDir: 0 },
    { path: "crates/bun-os-google/src/lib.rs", parent: "crates/bun-os-google/src", name: "lib.rs", ext: "rs", isDir: 0 },
    { path: "infra/fleet/fleet.toml", parent: "infra/fleet", name: "fleet.toml", ext: "toml", isDir: 0 },
    { path: "Cargo.toml", parent: ".", name: "Cargo.toml", ext: "toml", isDir: 0 },
    { path: "apps/spotcraft/src/app.ts", parent: "apps/spotcraft/src", name: "app.ts", ext: "ts", isDir: 0 },
    { path: "apps/wordcraft/src/main.rs", parent: "apps/wordcraft/src", name: "main.rs", ext: "rs", isDir: 0 },
    { path: "apps/deckcraft/src/main.rs", parent: "apps/deckcraft/src", name: "main.rs", ext: "rs", isDir: 0 },
    { path: "apps/gridcraft/src/main.rs", parent: "apps/gridcraft/src", name: "main.rs", ext: "rs", isDir: 0 },
    { path: "apps/vectorcraft/src/main.rs", parent: "apps/vectorcraft/src", name: "main.rs", ext: "rs", isDir: 0 },
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO local_files (file_path, parent_path, filename, extension, is_directory, is_users_directory, last_modified)
    VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
  `);
  for (const f of seedFiles) {
    insert.run(f.path, f.parent, f.name, f.ext, f.isDir, Date.now());
  }
}

export interface WgaSuggestion {
  title: string;
  subtitle: string;
  suggestion_type:
    | "local_file"
    | "web_search"
    | "web_history"
    | "local_app"
    | "windows_setting"
    | "google_drive_file"
    | "website"
    | "lens_multimodal"
    | "unknown";
  action_target: string;
  score: number;
}

const APPS: WgaSuggestion[] = [
  {
    title: "WordCraft",
    subtitle: "Sovereign Document Studio (Google Docs replacement)",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=wordcraft",
    score: 0.95,
  },
  {
    title: "DeckCraft",
    subtitle: "Sovereign Slide Presentation Studio (Google Slides replacement)",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=deckcraft",
    score: 0.95,
  },
  {
    title: "GridCraft",
    subtitle: "Sovereign Spreadsheet Engine (Google Sheets replacement)",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=gridcraft",
    score: 0.95,
  },
  {
    title: "VectorCraft",
    subtitle: "Sovereign Vector Illustration Studio",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=vectorcraft",
    score: 0.95,
  },
  {
    title: "COSMIC Terminal",
    subtitle: "Rio / Nushell shell environment",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=cosmic-term",
    score: 0.9,
  },
  {
    title: "Fichiers & VDFS",
    subtitle: "Bun OS Spacedrive File Explorer",
    suggestion_type: "local_app",
    action_target: "wga://open-app?id=spacedrive",
    score: 0.9,
  },
];

const server = Bun.serve({
  port,
  routes: {
    "/": indexHtml,
    "/api/suggestions": req => {
      const url = new URL(req.url);
      const query = (url.searchParams.get("q") || "").trim();
      if (!query) {
        return Response.json(APPS);
      }

      const results: WgaSuggestion[] = [];

      // 1. App matches
      const qLower = query.toLowerCase();
      for (const app of APPS) {
        if (app.title.toLowerCase().includes(qLower) || app.subtitle.toLowerCase().includes(qLower)) {
          results.push(app);
        }
      }

      // 2. FTS5 local files search
      try {
        const sanitized = query.replace(/[^a-zA-Z0-9_\-]/g, " ").trim();
        if (sanitized) {
          const ftsTokens = sanitized.split(/\s+/).map(t => `${t}*`).join(" ");
          const rows = db.query(`
            SELECT file_path, filename FROM local_files_fts
            WHERE local_files_fts MATCH ?1
            LIMIT 15
          `).all(ftsTokens) as { file_path: string; filename: string }[];

          for (const row of rows) {
            results.push({
              title: row.filename,
              subtitle: row.file_path,
              suggestion_type: "local_file",
              action_target: `wga://open-file?path=${encodeURIComponent(row.file_path)}`,
              score: 0.85,
            });
          }
        }
      } catch (err) {
        console.error("FTS search error:", err);
      }

      // 3. Web search suggestion fallback
      results.push({
        title: `Search web for "${query}"`,
        subtitle: "Search via sovereign index",
        suggestion_type: "web_search",
        action_target: `wga://search?q=${encodeURIComponent(query)}`,
        score: 0.5,
      });

      return Response.json(results);
    },
    "/api/action": async req => {
      const body = await req.json().catch(() => ({})) as { uri?: string };
      const uri = body.uri || "";
      console.log(`[WGA Dispatcher] Action received: ${uri}`);
      return Response.json({ status: "dispatched", uri });
    },
  },
  development: { hmr: true },
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/src/")) {
      const file = Bun.file("." + url.pathname);
      return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Spotcraft clean-room WGA server running at ${server.url}`);
