// SPDX-License-Identifier: Apache-2.0
/**
 * Browser backend of the OS: outside Tauri (os.aphrody.com, any plain browser) the file explorer,
 * the document search and the terminal are served by the Rust WebAssembly module
 * `crates/aphrody-webos-wasm` (`@aphrody/webos-wasm`), over a file system persisted in OPFS. Nothing
 * here implements OS behavior: this file loads the module once and adapts it to the callers.
 */
import { openWebOs, type WebOs } from "@aphrody/webos-wasm";
/** Request/subscribe transport of the explorer wire protocol served by the webos backend. */
export interface Transport {
  sendRequest(request: unknown): Promise<unknown>;
  subscribe(...args: unknown[]): Promise<() => void>;
}

/** The `.wasm` is copied next to `app.js` by `build.ts`. */
export const WEBOS_WASM_FILE = "wasm/aphrody_webos_wasm_bg.wasm";

let instance: Promise<WebOs> | undefined;

/** Load the Rust module and restore the file system, once per page. */
export function getWebOs(): Promise<WebOs> {
  const wasm = new URL(WEBOS_WASM_FILE, import.meta.url);
  wasm.search = new URL(import.meta.url).search;
  instance ??= openWebOs({ wasm }).catch((error: unknown) => {
    instance = undefined;
    throw error;
  });
  return instance;
}

/** Replace the module for tests. */
export function setWebOsForTesting(os: Promise<WebOs> | undefined): void {
  instance = os;
}

/** Explorer transport answered by the Rust backend; the module loads on the first request. */
export function webOsTransport(): Transport {
  return {
    sendRequest: async request => (await getWebOs()).rpc(request),
    subscribe: async () => () => {},
  };
}

/** True when `?backend=http` asks for a remote daemon (`/rpc`) instead of the in-browser backend. */
export function wantsHttpBackend(search: string): boolean {
  return new URLSearchParams(search).get("backend") === "http";
}

/** Use the in-browser OS unless this URL explicitly selects the HTTP daemon. */
export function usesBrowserBackend(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  return !wantsHttpBackend(search);
}

export interface BrowserFsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

/** Directory listing in the shape of the native `aphrody_fs_read_dir` command. */
export async function webOsReadDir(path = "/home/user"): Promise<{ path: string; entries: BrowserFsEntry[] }> {
  const os = await getWebOs();
  const entries = (JSON.parse(os.fs.list(path)) as { name: string; kind: "file" | "dir"; size: number }[]).map(e => ({
    name: e.name,
    path: `${path === "/" ? "" : path}/${e.name}`,
    is_dir: e.kind === "dir",
    size: e.size,
  }));
  return { path, entries };
}

/** File contents in the shape of the native `aphrody_fs_read_text` command. */
export async function webOsReadText(path: string): Promise<{ path: string; size: number; content: string }> {
  const bytes = (await getWebOs()).fs.read(path);
  return { path, size: bytes.byteLength, content: new TextDecoder().decode(bytes) };
}

export interface BrowserRagHit {
  path: string;
  start_line: number;
  end_line: number;
  score: number;
  content: string;
  /** ISO 639-1 code detected locally by `aphrody-google` in the Rust module. */
  language: string;
}

/** BM25 search over the browser file system, ranked by the Rust module. */
export async function webOsRagSearch(query: string, limit: number): Promise<BrowserRagHit[]> {
  const os = await getWebOs();
  return (JSON.parse(os.fs.ragSearch(query, limit)) as { results: BrowserRagHit[] }).results;
}

/** Indexed document and chunk counts. */
export async function webOsRagStats(): Promise<{ documents: number; chunks: number }> {
  return JSON.parse((await getWebOs()).fs.ragStats()) as { documents: number; chunks: number };
}
