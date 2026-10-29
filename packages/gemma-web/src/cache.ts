// SPDX-License-Identifier: Apache-2.0
/**
 * Sharded, resumable weight cache. Every file is fetched with HTTP Range requests in fixed-size
 * parts (default 128 MiB) and each part is persisted on its own, so an interrupted download resumes
 * at the next missing part and no single stored object approaches the 2 GiB ArrayBuffer limit.
 */
export interface PartStorage {
  has(key: string): Promise<number | undefined>; // stored byte length, if present
  read(key: string): Promise<Uint8Array>;
  write(key: string, data: Uint8Array): Promise<void>;
  remove(prefix: string): Promise<void>;
}

export class MemoryStorage implements PartStorage {
  readonly parts = new Map<string, Uint8Array>();
  async has(key: string) {
    return this.parts.get(key)?.byteLength;
  }
  async read(key: string) {
    const v = this.parts.get(key);
    if (!v) throw new Error(`missing part ${key}`);
    return v;
  }
  async write(key: string, data: Uint8Array) {
    this.parts.set(key, data.slice());
  }
  async remove(prefix: string) {
    for (const k of [...this.parts.keys()]) if (k.startsWith(prefix)) this.parts.delete(k);
  }
}

/** Origin private file system storage (Chrome, Safari, Firefox; also in workers). */
export class OpfsStorage implements PartStorage {
  #root: Promise<FileSystemDirectoryHandle>;
  constructor(dir: string) {
    this.#root = navigator.storage.getDirectory().then(r => r.getDirectoryHandle(dir, { create: true }));
  }
  static #name(key: string) {
    return key.replace(/[^A-Za-z0-9._-]/g, "_");
  }
  async has(key: string) {
    try {
      const h = await (await this.#root).getFileHandle(OpfsStorage.#name(key));
      return (await h.getFile()).size;
    } catch {
      return undefined;
    }
  }
  async read(key: string) {
    const h = await (await this.#root).getFileHandle(OpfsStorage.#name(key));
    return new Uint8Array(await (await h.getFile()).arrayBuffer());
  }
  async write(key: string, data: Uint8Array) {
    const h = await (await this.#root).getFileHandle(OpfsStorage.#name(key), { create: true });
    const w = await h.createWritable();
    await w.write(data as unknown as BufferSource);
    await w.close();
  }
  async remove(prefix: string) {
    const root = await this.#root;
    const p = OpfsStorage.#name(prefix);
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys())
      if (name.startsWith(p)) await root.removeEntry(name);
  }
}

export interface FetchProgress {
  readonly file: string;
  readonly fileLoaded: number;
  readonly fileTotal: number;
  readonly loaded: number;
  readonly total: number;
  readonly cached: boolean;
}

export interface ShardStoreOptions {
  url(path: string): string;
  storage: PartStorage;
  /** Namespace for stored parts, e.g. the model revision. */
  namespace: string;
  partBytes?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?(p: FetchProgress): void;
}

export class ShardStore {
  readonly partBytes: number;
  #loaded = 0;
  #total = 0;
  constructor(readonly o: ShardStoreOptions) {
    this.partBytes = o.partBytes ?? 128 * 1024 * 1024;
  }

  /** Declare all files up front so progress reports a stable overall total. */
  plan(files: readonly { path: string; bytes: number }[]) {
    this.#total = files.reduce((n, f) => n + f.bytes, 0);
    this.#loaded = 0;
  }

  async #range(path: string, start: number, end: number): Promise<Uint8Array> {
    const f = this.o.fetch ?? fetch;
    const res = await f(this.o.url(path), {
      headers: { Range: `bytes=${start}-${end}` },
      signal: this.o.signal,
    });
    if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) {
      // Server ignored Range: keep the requested window of the full body.
      const all = new Uint8Array(await res.arrayBuffer());
      return all.slice(start, end + 1);
    }
    throw new Error(`GET ${path} range ${start}-${end}: HTTP ${res.status}`);
  }

  /** Bytes of `path`, from cached parts when present, otherwise fetched part by part. */
  async get(path: string, bytes: number): Promise<Uint8Array> {
    const out = new Uint8Array(bytes);
    const parts = Math.max(1, Math.ceil(bytes / this.partBytes));
    let fileLoaded = 0;
    let allCached = true;
    for (let i = 0; i < parts; i++) {
      const start = i * this.partBytes;
      const end = Math.min(bytes, start + this.partBytes) - 1;
      const want = end - start + 1;
      const key = `${this.o.namespace}/${path}.${String(i).padStart(4, "0")}`;
      let part: Uint8Array;
      if ((await this.o.storage.has(key)) === want) part = await this.o.storage.read(key);
      else {
        allCached = false;
        part = await this.#range(path, start, end);
        if (part.byteLength !== want) throw new Error(`${path} part ${i}: got ${part.byteLength}, expected ${want}`);
        await this.o.storage.write(key, part);
      }
      out.set(part, start);
      fileLoaded += want;
      this.#loaded += want;
      this.o.onProgress?.({
        file: path,
        fileLoaded,
        fileTotal: bytes,
        loaded: this.#loaded,
        total: Math.max(this.#total, this.#loaded),
        cached: allCached,
      });
    }
    return out;
  }

  async text(path: string, bytes: number): Promise<string> {
    return new TextDecoder().decode(await this.get(path, bytes));
  }

  clear() {
    return this.o.storage.remove(this.o.namespace);
  }
}
