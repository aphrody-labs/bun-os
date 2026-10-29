// SPDX-License-Identifier: Apache-2.0
// Typed facade over crates/aphrody-webos-wasm: the Rust file system and explorer backend of the browser OS, persisted
// in OPFS (the terminal is a real Alpine guest, see guest.ts). No logic of the OS lives here; this module loads the module, restores
// and saves the APFS1 image atomically, and exposes the wire transport the explorer client expects.
import init, { WebOsFs, WebTerminal, detectLanguage, version, type InitInput } from "#webos-wasm-glue";
import { GuestSession, type GuestOptions } from "./guest.ts";

export type { WebOsFs } from "#webos-wasm-glue";
export { GuestSession, type GuestOptions, type GuestState, type RioVt, type Snapshot } from "./guest.ts";
export type WasmInput = InitInput;

/** Where the file system image lives between page loads. */
export interface ImageStore {
  /** True when data survives a reload. */
  readonly persistent: boolean;
  /** Offer stored images newest first; return the first one `accept` takes (empty when none stored). */
  load(accept: (image: Uint8Array) => boolean): Promise<Uint8Array>;
  save(image: Uint8Array): Promise<void>;
}

/** Volatile store: tests, browsers without OPFS, or a second tab that lost the writer lock. */
export function memoryImageStore(initial?: Uint8Array): ImageStore {
  let image = initial ?? new Uint8Array();
  return {
    persistent: false,
    load: async accept => (image.byteLength > 0 && accept(image) ? image : new Uint8Array()),
    save: async next => {
      image = Uint8Array.from(next);
    },
  };
}

const SLOT_NAMES = ["aphrody-webos-0.img", "aphrody-webos-1.img"] as const;
const SLOT_MAGIC = new TextEncoder().encode("APH-SLOT");
const SLOT_HEADER_BYTES = 16;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const WRITER_LOCK = "aphrody-webos-writer";

interface SlotFile {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
interface SlotDirectory {
  getFileHandle(name: string, options: { create: true }): Promise<SlotFile>;
}

/** Encode `image` for a slot: magic, little-endian sequence number, then the image. */
export function encodeSlot(sequence: bigint, image: Uint8Array): Uint8Array {
  if (image.byteLength > MAX_IMAGE_BYTES) throw new Error("OPFS image exceeds 80 MiB");
  const bytes = new Uint8Array(SLOT_HEADER_BYTES + image.byteLength);
  bytes.set(SLOT_MAGIC);
  new DataView(bytes.buffer).setBigUint64(SLOT_MAGIC.length, sequence, true);
  bytes.set(image, SLOT_HEADER_BYTES);
  return bytes;
}

/** Decode a slot; null when empty, torn or foreign. */
export function decodeSlot(bytes: Uint8Array): { sequence: bigint; image: Uint8Array } | null {
  if (bytes.byteLength < SLOT_HEADER_BYTES || !SLOT_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const sequence = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(SLOT_MAGIC.length, true);
  return { sequence, image: bytes.subarray(SLOT_HEADER_BYTES) };
}

/** Two alternating slot files: a torn write leaves the previous image intact. */
export function slotImageStore(directory: SlotDirectory, persistent = true): ImageStore {
  let active = 1;
  let sequence = 0n;
  return {
    persistent,
    async load(accept) {
      const files = await Promise.all(SLOT_NAMES.map(name => directory.getFileHandle(name, { create: true })));
      const raw = await Promise.all(files.map(async f => new Uint8Array(await (await f.getFile()).arrayBuffer())));
      const candidates = raw
        .map((bytes, index) => ({ index, slot: decodeSlot(bytes) }))
        .filter((c): c is { index: number; slot: NonNullable<typeof c.slot> } => c.slot !== null)
        .toSorted((a, b) => (a.slot.sequence > b.slot.sequence ? -1 : 1));
      for (const c of candidates) {
        if (accept(c.slot.image)) {
          active = c.index;
          sequence = c.slot.sequence;
          return c.slot.image;
        }
      }
      if (raw.some(bytes => bytes.byteLength > 0))
        throw new Error("both OPFS WebOS images are invalid; existing data was preserved");
      return new Uint8Array();
    },
    async save(image) {
      const next = active === 0 ? 1 : 0;
      const file = await directory.getFileHandle(SLOT_NAMES[next]!, { create: true });
      const writable = await file.createWritable();
      await writable.write(encodeSlot(sequence + 1n, image));
      await writable.close();
      active = next;
      sequence += 1n;
    },
  };
}

/** OPFS store when the browser has it and this tab holds the writer lock; memory otherwise. */
export async function defaultImageStore(): Promise<ImageStore> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const storage = nav?.storage as { getDirectory?: () => Promise<SlotDirectory> } | undefined;
  if (!nav || !storage?.getDirectory) return memoryImageStore();
  const locks = nav.locks;
  if (locks) {
    const held = await new Promise<boolean>(resolve => {
      void locks.request(WRITER_LOCK, { ifAvailable: true }, lock => {
        resolve(lock !== null);
        return lock ? new Promise<never>(() => {}) : undefined;
      });
    });
    if (!held) return memoryImageStore();
  }
  return slotImageStore(await storage.getDirectory());
}

/** Request envelope of the explorer wire protocol (`Query`/`Action`) or the string "Ping". */
export type WireRequest = unknown;

/** Transport of the explorer wire protocol. */
export interface ExplorerTransport {
  sendRequest(request: WireRequest): Promise<unknown>;
  subscribe(): Promise<() => void>;
}

/** Local language detection of `aphrody-google` (scripts and stop words, no network). */
export interface LanguageDetection {
  /** ISO 639-1 code, `und` for empty text. */
  language: string;
  confidence: number;
  isReliable: boolean;
}

export interface WebOs {
  /** The Rust file system; call `flush()` after writing through it directly. */
  readonly fs: WebOsFs;
  readonly persistent: boolean;
  readonly version: string;
  /** Answer one explorer wire request from the Rust backend. */
  rpc(request: WireRequest): Promise<unknown>;
  transport(): ExplorerTransport;
  detectLanguage(text: string): LanguageDetection;
  /** Wait until every change reached the store. */
  flush(): Promise<void>;
}

export interface OpenOptions {
  store?: ImageStore;
  /** `.wasm` bytes, URL or Response; defaults to the file next to the glue. */
  wasm?: InitInput | Promise<InitInput>;
  now?: () => Date;
  /** Delay before a change is written, in milliseconds. */
  flushDelayMs?: number;
}

/** Load the module, restore the file system from the store and start autosaving. */
export async function openWebOs(options: OpenOptions = {}): Promise<WebOs> {
  await init(options.wasm === undefined ? undefined : { module_or_path: options.wasm });
  const store = options.store ?? (await defaultImageStore());
  let restored: WebOsFs | undefined;
  const image = await store.load(candidate => {
    try {
      restored = new WebOsFs(candidate);
      return true;
    } catch {
      return false;
    }
  });
  const files = restored ?? new WebOsFs(image);
  const now = options.now ?? (() => new Date());
  const delay = options.flushDelayMs ?? 150;

  // The dirty flag is cleared as soon as the image is taken; `pending` keeps it until stored.
  let pending: Uint8Array | undefined;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async (): Promise<void> => {
    const fresh = files.imageIfDirty();
    if (fresh.byteLength > 0) {
      pending = fresh;
      files.markPersisted();
    }
    if (pending) {
      await store.save(pending);
      pending = undefined;
    }
  };
  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    chain = chain.catch(() => {}).then(save);
    return chain;
  };
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      flush().catch((error: unknown) => console.error("WebOS save failed", error));
    }, delay);
  };
  if (typeof addEventListener === "function") {
    addEventListener("pagehide", () => void flush());
  }

  const rpc = async (request: WireRequest): Promise<unknown> => {
    const reply = JSON.parse(files.rpc(JSON.stringify(request), now().toISOString())) as unknown;
    schedule();
    return reply;
  };
  return {
    fs: files,
    persistent: store.persistent,
    version: version(),
    rpc,
    transport: () => ({ sendRequest: rpc, subscribe: async () => () => {} }),
    detectLanguage: text => JSON.parse(detectLanguage(text)) as LanguageDetection,
    flush,
  };
}

/**
 * A terminal on a real shell: the Alpine guest rendered by Rio VT. Call after `openWebOs` (it initialises the module that
 * carries `WebTerminal`).
 */
export function openGuestTerminal(
  options: Omit<GuestOptions, "vt"> & { cols?: number; rows?: number } = {},
): GuestSession {
  const { cols = 100, rows = 30, ...rest } = options;
  return new GuestSession({ ...rest, vt: new WebTerminal(cols, rows) });
}
