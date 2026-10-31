// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { createClient, type GoogleClientOptions } from "./client.ts";
import { closeSync, lstatSync, openSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { GoogleOAuthSession, GoogleOAuthState, GoogleOAuthStore } from "./oauth";

const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const historyIdentifier = /^[1-9][0-9]{0,39}$/;
const oauthKey = /^[a-f0-9]{64}$/;
export interface GmailMetadata {
  id: string;
  threadId: string;
  historyId: string;
  labelIds: string[];
  internalDate: string;
  headers: { name: string; value: string }[];
}
export interface GmailCheckpoint {
  historyId: string;
  revision: number;
}
export interface GmailMirrorStore {
  checkpoint(subject: string): GmailCheckpoint | undefined;
  commit(
    subject: string,
    previous: GmailCheckpoint | undefined,
    next: string,
    messages: GmailMetadata[],
    deleted: string[],
    replace: boolean,
  ): void;
}

/** The owner verifies directory ACLs/mode, identity and protected-store location before opening. */
export function openProtectedGoogleStore(options: {
  filename: string;
  assertProtectedPath: (filename: string) => void;
  maxEntries?: number;
}) {
  if (!isAbsolute(options.filename) || typeof options.assertProtectedPath !== "function")
    throw new TypeError("An explicit protected Google store is required");
  const filename = resolve(options.filename);
  const maximum = options.maxEntries ?? 4096;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100000)
    throw new TypeError("Invalid Google store capacity");
  for (let current = dirname(filename); ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe Google store path");
    if (dirname(current) === current) break;
  }
  options.assertProtectedPath(filename);
  try {
    closeSync(openSync(filename, "wx", 0o600));
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw new Error("Google store unavailable");
  }
  const stat = lstatSync(filename);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()))
  )
    throw new Error("Unsafe Google store file");
  options.assertProtectedPath(filename);
  const db = new Database(filename, { strict: true });
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS google_oauth(kind TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, expires REAL NOT NULL, PRIMARY KEY(kind,key));
    CREATE TABLE IF NOT EXISTS google_gmail_cursor(subject TEXT PRIMARY KEY, history TEXT NOT NULL,
      revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS google_gmail_message(subject TEXT NOT NULL,id TEXT NOT NULL,
      value TEXT NOT NULL,PRIMARY KEY(subject,id));`);
  const find = db.query<{ value: string; expires: number }, [string, string]>(
    "SELECT value,expires FROM google_oauth WHERE kind=? AND key=?",
  );
  const remove = db.query("DELETE FROM google_oauth WHERE kind=? AND key=?");
  const put = db.transaction((kind: string, key: string, value: { expiresAt: number }) => {
    if (!oauthKey.test(key) || !Number.isFinite(value.expiresAt)) throw new TypeError("Invalid OAuth entry");
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 16384) throw new Error("OAuth entry exceeds limit");
    db.query("DELETE FROM google_oauth WHERE expires<=?").run(Date.now());
    const count = db
      .query<{ count: number }, [string]>("SELECT count(*) AS count FROM google_oauth WHERE kind=?")
      .get(kind)!.count;
    if (count >= maximum && !find.get(kind, key)) throw new Error("OAuth store capacity reached");
    db.query("INSERT OR REPLACE INTO google_oauth VALUES (?,?,?,?)").run(kind, key, serialized, value.expiresAt);
  });
  const consume = db.transaction((key: string, now: number) => {
    const value = find.get("state", key);
    remove.run("state", key);
    return value && value.expires > now ? (JSON.parse(value.value) as GoogleOAuthState) : undefined;
  });
  const readSession = db.transaction((key: string, now: number) => {
    const value = find.get("session", key);
    if (value && value.expires <= now) {
      remove.run("session", key);
      return undefined;
    }
    return value ? (JSON.parse(value.value) as GoogleOAuthSession) : undefined;
  });
  const oauth: GoogleOAuthStore = {
    async putState(key, value) {
      put.immediate("state", key, value);
    },
    async consumeState(key, now) {
      return consume.immediate(key, now);
    },
    async putSession(key, value) {
      put.immediate("session", key, value);
    },
    async getSession(key, now) {
      return readSession.immediate(key, now);
    },
    async deleteSession(key) {
      remove.run("session", key);
    },
  };
  function checkpoint(subject: string): GmailCheckpoint | undefined {
    subjectId(subject);
    const row = db
      .query<{ history: string; revision: number }, [string]>(
        "SELECT history,revision FROM google_gmail_cursor WHERE subject=?",
      )
      .get(subject);
    return row ? { historyId: row.history, revision: row.revision } : undefined;
  }
  const apply = db.transaction(
    (
      subject: string,
      previous: GmailCheckpoint | undefined,
      next: string,
      messages: GmailMetadata[],
      deleted: string[],
      replace: boolean,
    ) => {
      const current = checkpoint(subject);
      if (current?.revision !== previous?.revision || current?.historyId !== previous?.historyId)
        throw new Error("Gmail checkpoint changed");
      if (!historyIdentifier.test(next)) throw new Error("Invalid Gmail checkpoint");
      if (current && BigInt(next) < BigInt(current.historyId)) throw new Error("Gmail checkpoint moved backwards");
      if (replace) db.query("DELETE FROM google_gmail_message WHERE subject=?").run(subject);
      for (const id of deleted) db.query("DELETE FROM google_gmail_message WHERE subject=? AND id=?").run(subject, id);
      for (const message of messages)
        db.query("INSERT OR REPLACE INTO google_gmail_message VALUES (?,?,?)").run(
          subject,
          message.id,
          JSON.stringify(message),
        );
      const count = db
        .query<{ count: number }, [string]>("SELECT count(*) AS count FROM google_gmail_message WHERE subject=?")
        .get(subject)!.count;
      if (count > maximum) throw new Error("Gmail store capacity reached");
      db.query("INSERT OR REPLACE INTO google_gmail_cursor VALUES (?,?,?)").run(
        subject,
        next,
        (current?.revision ?? 0) + 1,
      );
    },
  );
  const mirror: GmailMirrorStore = {
    checkpoint,
    commit(subject, previous, next, messages, deleted, replace) {
      apply.immediate(subject, previous, next, messages, deleted, replace);
    },
  };
  return {
    oauth,
    mirror,
    /** Private owner access only; never expose this projection through a public capability endpoint. */
    readMessages(subject: string, limit = 100): GmailMetadata[] {
      subjectId(subject);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("Invalid Gmail read limit");
      return db
        .query<{ value: string }, [string, number]>(
          "SELECT value FROM google_gmail_message WHERE subject=? ORDER BY id LIMIT ?",
        )
        .all(subject, limit)
        .map(row => JSON.parse(row.value) as GmailMetadata);
    },
    close() {
      db.close();
    },
    [Symbol.dispose]() {
      db.close();
    },
  };
}

function subjectId(subject: string) {
  if (typeof subject !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(subject))
    throw new TypeError("Invalid Google account subject");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Gmail response");
  return value as Record<string, unknown>;
}
function string(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("Invalid Gmail response");
  return value;
}
function array(value: unknown, maximum: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid Gmail response");
  return value;
}
async function boundedJSON(response: Response) {
  if (!response.body) throw new Error("Invalid Gmail response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      length += value.value.byteLength;
      if (length > 1048576) throw new Error("Gmail response exceeds limit");
      chunks.push(value.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } catch {
    throw new Error("Invalid Gmail response");
  }
}
function metadata(value: Record<string, unknown>, expected: string): GmailMetadata {
  const id = string(value.id, identifier);
  if (id !== expected) throw new Error("Gmail message identity mismatch");
  const payload = value.payload === undefined ? {} : record(value.payload);
  const allowed = new Set(["from", "to", "subject", "date"]);
  const headers = array(payload.headers, 100).map(value => {
    const header = record(value);
    if (
      typeof header.name !== "string" ||
      typeof header.value !== "string" ||
      !allowed.has(header.name.toLowerCase()) ||
      header.value.length > 4096
    )
      throw new Error("Invalid Gmail header");
    return { name: header.name, value: header.value };
  });
  return {
    id,
    threadId: string(value.threadId, identifier),
    historyId: string(value.historyId, historyIdentifier),
    internalDate: string(value.internalDate, /^[0-9]{1,20}$/),
    labelIds: array(value.labelIds, 100).map(value => string(value, identifier)),
    headers,
  };
}

/** Explicit private metadata synchronization; never sends mail or retrieves bodies/attachments. */
export function createReadonlyGmailMirror(options: {
  store: GmailMirrorStore;
  authorization: (
    subject: string,
    signal: AbortSignal,
  ) => Promise<{
    subject: string;
    accessToken: string;
    scopes: readonly string[];
  }>;
  fetch?: GoogleClientOptions["fetch"];
  maxPages?: number;
  maxMessages?: number;
}) {
  const maxPages = options.maxPages ?? 5,
    maxMessages = options.maxMessages ?? 200;
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 20 ||
    !Number.isSafeInteger(maxMessages) ||
    maxMessages < 1 ||
    maxMessages > 2000
  )
    throw new TypeError("Invalid Gmail synchronization limits");
  return {
    async sync(subject: string) {
      subjectId(subject);
      const signal = AbortSignal.timeout(30000);
      const client = createClient({
        baseURL: "https://gmail.googleapis.com/gmail/v1/users/me/",
        fetch: options.fetch,
        credentialProvider: async () => {
          const authorization = await options.authorization(subject, signal);
          if (authorization.subject !== subject || !authorization.scopes.includes(READONLY))
            throw new Error("Gmail readonly authorization required");
          return authorization.accessToken;
        },
      });
      async function get(path: string) {
        return boundedJSON(await client.request(path, { method: "GET", signal }));
      }
      const previous = options.store.checkpoint(subject);
      let replace = !previous,
        next = previous?.historyId ?? "";
      const ids = new Set<string>(),
        deleted = new Set<string>();
      async function pages(path: string, consume: (page: Record<string, unknown>) => void) {
        let token: string | undefined;
        const seen = new Set<string>();
        for (let page = 0; page < maxPages; page++) {
          const result = await get(path + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
          consume(result);
          if (result.nextPageToken === undefined) return;
          token = string(result.nextPageToken, /^[\x21-\x7e]{1,2048}$/);
          if (seen.has(token)) throw new Error("Gmail pagination cycle");
          seen.add(token);
        }
        throw new Error("Gmail pagination limit reached");
      }
      function add(id: string) {
        ids.add(id);
        if (ids.size > maxMessages) throw new Error("Gmail message limit reached");
      }
      if (previous) {
        try {
          await pages("history?maxResults=100&startHistoryId=" + previous.historyId, page => {
            const historyId = string(page.historyId, historyIdentifier);
            if (BigInt(historyId) < BigInt(next)) throw new Error("Gmail checkpoint moved backwards");
            next = historyId;
            for (const entry of array(page.history, 100)) {
              const history = record(entry);
              for (const message of array(history.messages, 1000)) add(string(record(message).id, identifier));
              for (const field of ["messagesAdded", "labelsAdded", "labelsRemoved", "messagesDeleted"])
                for (const change of array(history[field], 1000)) {
                  const id = string(record(record(change).message).id, identifier);
                  add(id);
                }
            }
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Google request failed (HTTP 404)") throw error;
          replace = true;
          ids.clear();
        }
      }
      if (replace) {
        next = string((await get("profile")).historyId, historyIdentifier);
        await pages("messages?maxResults=100&includeSpamTrash=true", page => {
          for (const message of array(page.messages, 100)) add(string(record(message).id, identifier));
        });
      }
      const messages: GmailMetadata[] = [];
      for (const id of ids) {
        try {
          messages.push(
            metadata(
              await get(
                "messages/" +
                  id +
                  "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date",
              ),
              id,
            ),
          );
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Google request failed (HTTP 404)") throw error;
          deleted.add(id);
        }
      }
      signal.throwIfAborted();
      options.store.commit(subject, previous, next, messages, [...deleted], replace);
      return {
        mode: replace ? "full" : "history",
        updated: messages.length,
        deleted: deleted.size,
      };
    },
  };
}
