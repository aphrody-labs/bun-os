// SPDX-License-Identifier: Apache-2.0
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface ChromePasswordCredential {
  name: string;
  url: string;
  username: string;
  password: string;
}
export interface ChromePasswordAudit {
  records: number;
  supportedWebOrigins: number;
  credentialsWithPassword: number;
  unsupportedRecords: number;
}
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_CELL = 16384;

function csv(text: string): ChromePasswordCredential[] {
  const rows: string[][] = [];
  let width = 0;
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  function column() {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 5) throw new Error("Invalid Chrome password CSV");
  }
  function line() {
    column();
    if (rows.length === 0) {
      const header = row.join(",");
      if (header !== "name,url,username,password" && header !== "name,url,username,password,note")
        throw new Error("Invalid Chrome password CSV header");
      width = row.length;
    }
    if (row.length !== width) throw new Error("Invalid Chrome password CSV");
    rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new Error("Chrome password CSV exceeds limit");
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\0") throw new Error("Invalid Chrome password CSV");
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += character;
    } else if (character === '"') {
      if (cell || closed) throw new Error("Invalid Chrome password CSV");
      quoted = true;
    } else if (character === ",") column();
    else if (character === "\n" || character === "\r") {
      if (character === "\r") {
        if (text[index + 1] !== "\n") throw new Error("Invalid Chrome password CSV");
        index++;
      }
      line();
    } else {
      if (closed) throw new Error("Invalid Chrome password CSV");
      cell += character;
    }
    if (cell.length > MAX_CELL) throw new Error("Chrome password CSV exceeds limit");
  }
  if (quoted) throw new Error("Invalid Chrome password CSV");
  if (cell || row.length || closed) line();
  if (!rows.shift()) throw new Error("Invalid Chrome password CSV header");
  return rows.map(([name, url, username, password]) => ({
    name: name!,
    url: url!,
    username: username!,
    password: password!,
  }));
}
function webOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.origin;
  } catch {
    return;
  }
}
function canonical(value: string) {
  const path = resolve(value);
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function createConfiguredChromePasswordProvider(
  options: Pick<Parameters<typeof createChromePasswordProvider>[0], "allowedPaths" | "assertProtectedPath">,
  env: Record<string, string | undefined> = process.env,
) {
  const filename = env.BUN_BROWSER_PASSWORDS_FILE;
  if (!filename) throw new Error("Private Chrome password source is not configured");
  return createChromePasswordProvider({ ...options, filename });
}

/** Read-only private credential source; reuse this provider rather than exporting or copying CSV data. */
export function createChromePasswordProvider(options: {
  filename: string;
  allowedPaths: readonly string[];
  /** Trusted owner validates file and parent ACLs/mode, owner identity and exclusion from public stores. */
  assertProtectedPath: (filename: string) => void;
}) {
  if (
    !isAbsolute(options.filename) ||
    !Array.isArray(options.allowedPaths) ||
    options.allowedPaths.length < 1 ||
    options.allowedPaths.length > 8 ||
    options.allowedPaths.some(path => !isAbsolute(path)) ||
    !options.allowedPaths.some(path => canonical(path) === canonical(options.filename)) ||
    typeof options.assertProtectedPath !== "function"
  )
    throw new TypeError("An explicitly allowlisted private Chrome password file is required");
  const filename = resolve(options.filename);
  function load() {
    for (let current = dirname(filename); ; current = dirname(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe Chrome password path");
      if (dirname(current) === current) break;
    }
    options.assertProtectedPath(filename);
    const before = lstatSync(filename);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (process.platform !== "win32" && ((before.mode & 0o077) !== 0 || before.uid !== process.getuid!()))
    )
      throw new Error("Unsafe Chrome password file");
    const descriptor = openSync(filename, "r");
    try {
      const stat = fstatSync(descriptor);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.size > MAX_BYTES
      )
        throw new Error("Unsafe Chrome password file");
      const bytes = Buffer.alloc(stat.size + 1);
      let total = 0;
      while (total < bytes.length) {
        const count = readSync(descriptor, bytes, total, bytes.length - total, null);
        if (count === 0) break;
        total += count;
      }
      const after = fstatSync(descriptor);
      if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
        throw new Error("Chrome password file changed during read");
      options.assertProtectedPath(filename);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total));
      } catch {
        throw new Error("Invalid Chrome password CSV encoding");
      } finally {
        bytes.fill(0);
      }
      return csv(text.replace(/^\uFEFF/, ""));
    } finally {
      closeSync(descriptor);
    }
  }
  return {
    audit(): ChromePasswordAudit {
      const rows = load(),
        origins = new Set<string>();
      let credentialsWithPassword = 0,
        unsupportedRecords = 0;
      for (const row of rows) {
        const origin = webOrigin(row.url);
        if (origin) origins.add(origin);
        else unsupportedRecords++;
        if (row.password) credentialsWithPassword++;
      }
      return {
        records: rows.length,
        supportedWebOrigins: origins.size,
        credentialsWithPassword,
        unsupportedRecords,
      };
    },
    /** Callback is a privileged local consumer. Its return value is discarded; this is not an OAuth grant. */
    async withCredential(
      selector: { url: string; username?: string },
      callback: (credential: Readonly<ChromePasswordCredential>) => void | Promise<void>,
    ): Promise<void> {
      const origin = webOrigin(selector.url);
      if (
        !origin ||
        typeof callback !== "function" ||
        (selector.username !== undefined &&
          (typeof selector.username !== "string" || selector.username.length > MAX_CELL))
      )
        throw new TypeError("Invalid Chrome credential selector");
      const matches = load().filter(
        row =>
          webOrigin(row.url) === origin &&
          row.password &&
          (selector.username === undefined || row.username === selector.username),
      );
      if (matches.length !== 1) throw new Error("Chrome credential selection requires one match");
      try {
        await callback(Object.freeze(matches[0]!));
      } catch {
        throw new Error("Chrome credential consumer failed");
      }
    },
  };
}
