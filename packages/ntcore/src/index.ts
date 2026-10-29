/**
 * @aphrody/ntcore: NT personality building blocks for Bun OS. The registry hive engine (ReactOS cmlib), the
 * Executive handle table (ReactOS ntoskrnl/ex/handle.c) and the PE header helpers (ReactOS rtl/image.c) run as
 * one freestanding wasm32 module compiled from the ReactOS sources by factory/ntcore/build.ts.
 */
export * from "./hivewriter.ts";

const NIL = 0xffffffff;

interface Exports {
  memory: WebAssembly.Memory;
  nt_malloc(n: number): number;
  nt_free(p: number): void;
  nt_hive_open(p: number, n: number): number;
  nt_hive_close(id: number): void;
  nt_hive_check(id: number): number;
  nt_hive_version(id: number): number;
  nt_hive_root(id: number): number;
  nt_key_open(id: number, start: number, p: number, n: number): number;
  nt_key_info(id: number, cell: number, out: number): number;
  nt_key_name(id: number, cell: number, out: number, cap: number): number;
  nt_key_parent(id: number, cell: number): number;
  nt_key_subkey(id: number, cell: number, i: number): number;
  nt_key_value(id: number, cell: number, i: number): number;
  nt_value_find(id: number, cell: number, p: number, n: number): number;
  nt_value_info(id: number, cell: number, out: number): number;
  nt_value_name(id: number, cell: number, out: number, cap: number): number;
  nt_ex_init(): void;
  nt_ht_create(): number;
  nt_ht_destroy(t: number): void;
  nt_ht_create_handle(t: number, obj: number, access: number): number;
  nt_ht_lookup(t: number, h: number, accessOut: number): number;
  nt_ht_close(t: number, h: number): number;
  nt_pe_inspect(p: number, n: number, out: number): number;
  nt_pe_rva_to_offset(p: number, n: number, rva: number): number;
  nt_pe_directory(p: number, n: number, idx: number, out: number): number;
}

export class NtError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(`${message} (NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, "0")})`);
  }
}

export interface RegistryValue {
  name: string;
  type: number;
  data: Uint8Array;
}
export interface KeyInfo {
  name: string;
  subKeys: number;
  values: number;
  /** FILETIME (100 ns since 1601) */
  lastWrite: bigint;
}

export interface PeInfo {
  machine: number;
  characteristics: number;
  sections: number;
  entryPointRva: number;
  sizeOfImage: number;
  subsystem: number;
  dllCharacteristics: number;
  imageBase: bigint;
  /** 0x10b = PE32, 0x20b = PE32+ */
  magic: number;
  ntHeadersOffset: number;
}

export class NtCore {
  private constructor(private readonly x: Exports) {
    x.nt_ex_init();
  }

  static async load(source?: BufferSource | Response | URL | string): Promise<NtCore> {
    let bytes: BufferSource;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) bytes = source as BufferSource;
    else {
      const url = source ?? new URL("../wasm/ntcore.wasm", import.meta.url);
      bytes =
        source instanceof Response
          ? await source.arrayBuffer()
          : await Bun.file(url instanceof URL ? url : String(url)).arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new NtCore(instance.exports as unknown as Exports);
  }

  /** @internal */ get exports(): Exports {
    return this.x;
  }
  get memoryBytes(): number {
    return this.x.memory.buffer.byteLength;
  }
  /** @internal copies `data` into wasm memory, runs `fn`, frees. */
  withBytes<T>(data: Uint8Array, fn: (ptr: number) => T): T {
    const p = this.x.nt_malloc(Math.max(1, data.length));
    new Uint8Array(this.x.memory.buffer, p, data.length).set(data);
    try {
      return fn(p);
    } finally {
      this.x.nt_free(p);
    }
  }
  /** @internal */ withWide<T>(s: string, fn: (ptr: number, n: number) => T): T {
    const buf = new Uint8Array(s.length * 2);
    const v = new DataView(buf.buffer);
    for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), true);
    return this.withBytes(buf, p => fn(p, s.length));
  }
  /** @internal */ scratch<T>(words: number, fn: (ptr: number, read: () => Uint32Array) => T): T {
    const p = this.x.nt_malloc(words * 4);
    try {
      return fn(p, () => new Uint32Array(this.x.memory.buffer.slice(p, p + words * 4)));
    } finally {
      this.x.nt_free(p);
    }
  }
  /** @internal */ readWide(fill: (ptr: number, cap: number) => number): string {
    let cap = 256;
    for (;;) {
      const p = this.x.nt_malloc(cap * 2);
      try {
        const n = fill(p, cap);
        if (n < 0) throw new NtError("invalid cell", 0xc0000008);
        if (n > cap) {
          cap = n;
          continue;
        }
        return String.fromCharCode(...new Uint16Array(this.x.memory.buffer.slice(p, p + n * 2)));
      } finally {
        this.x.nt_free(p);
      }
    }
  }

  openHive(image: Uint8Array): Hive {
    const id = this.withBytes(image, p => this.x.nt_hive_open(p, image.length));
    if (id <= 0) throw new NtError("hive load failed", id);
    return new Hive(this, id);
  }

  createHandleTable(): HandleTable {
    return new HandleTable(this, this.x.nt_ht_create());
  }

  inspectPe(image: Uint8Array): PeInfo {
    return this.withBytes(image, p =>
      this.scratch(9, (out, read) => {
        const st = this.x.nt_pe_inspect(p, image.length, out);
        if (st !== 0) throw new NtError("not a PE image", st);
        const r = read();
        return {
          ntHeadersOffset: r[0]!,
          machine: r[1]! & 0xffff,
          characteristics: r[1]! >>> 16,
          sections: r[2]!,
          entryPointRva: r[3]!,
          sizeOfImage: r[4]!,
          subsystem: r[5]! & 0xffff,
          dllCharacteristics: r[5]! >>> 16,
          imageBase: BigInt(r[6]!) | (BigInt(r[7]!) << 32n),
          magic: r[8]!,
        };
      }),
    );
  }
  /** File offset of an RVA through the section table, or undefined when it is not backed by the file. */
  rvaToOffset(image: Uint8Array, rva: number): number | undefined {
    const r = this.withBytes(image, p => this.x.nt_pe_rva_to_offset(p, image.length, rva));
    return r < 0 ? undefined : r;
  }
  peDirectory(image: Uint8Array, index: number): { rva: number; size: number } | undefined {
    return this.withBytes(image, p =>
      this.scratch(2, (out, read) => {
        if (this.x.nt_pe_directory(p, image.length, index, out) !== 0) return undefined;
        const r = read();
        return { rva: r[0]!, size: r[1]! };
      }),
    );
  }
}

/** A loaded registry hive, parsed by ReactOS cmlib. Keys are addressed by HCELL_INDEX. */
export class Hive {
  constructor(
    private readonly core: NtCore,
    readonly id: number,
  ) {}
  private get x() {
    return this.core.exports;
  }
  get version(): number {
    return this.x.nt_hive_version(this.id);
  }
  /** CM_CHECK_REGISTRY_* status of the kernel consistency checker; 0 means the hive is sound. */
  check(): number {
    return this.x.nt_hive_check(this.id);
  }
  get root(): number {
    return this.x.nt_hive_root(this.id) >>> 0;
  }
  /** Resolves `A\B\C` (case-insensitive) from `from` (default root). Returns the key cell or undefined. */
  open(path: string, from?: number): number | undefined {
    const c = this.core.withWide(path, (p, n) => this.x.nt_key_open(this.id, (from ?? NIL) | 0, p, n)) >>> 0;
    return c === NIL ? undefined : c;
  }
  info(cell: number): KeyInfo {
    return this.core.scratch(6, (out, read) => {
      if (this.x.nt_key_info(this.id, cell, out) !== 0) throw new NtError("bad key cell", 0xc0000008);
      const r = read();
      return {
        name: this.core.readWide((p, cap) => this.x.nt_key_name(this.id, cell, p, cap)),
        subKeys: r[0]!,
        values: r[1]!,
        lastWrite: BigInt(r[2]!) | (BigInt(r[3]!) << 32n),
      };
    });
  }
  parent(cell: number): number | undefined {
    const c = this.x.nt_key_parent(this.id, cell) >>> 0;
    return c === NIL ? undefined : c;
  }
  subKeys(cell: number): string[] {
    const n = this.info(cell).subKeys;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.x.nt_key_subkey(this.id, cell, i) >>> 0;
      if (c !== NIL) out.push(this.info(c).name);
    }
    return out;
  }
  values(cell: number): RegistryValue[] {
    const n = this.info(cell).values;
    const out: RegistryValue[] = [];
    for (let i = 0; i < n; i++) {
      const v = this.x.nt_key_value(this.id, cell, i) >>> 0;
      if (v !== NIL) out.push(this.readValue(v));
    }
    return out;
  }
  value(cell: number, name: string): RegistryValue | undefined {
    const v = this.core.withWide(name, (p, n) => this.x.nt_value_find(this.id, cell, p, n)) >>> 0;
    return v === NIL ? undefined : this.readValue(v);
  }
  private readValue(vcell: number): RegistryValue {
    return this.core.scratch(4, (out, read) => {
      if (this.x.nt_value_info(this.id, vcell, out) !== 0) throw new NtError("bad value cell", 0xc0000008);
      const r = read();
      return {
        name: this.core.readWide((p, cap) => this.x.nt_value_name(this.id, vcell, p, cap)),
        type: r[0]!,
        data: new Uint8Array(this.x.memory.buffer.slice(r[3]!, r[3]! + r[1]!)),
      };
    });
  }
  close(): void {
    this.x.nt_hive_close(this.id);
  }
}

/** ReactOS Executive handle table: 3-level table, handles are multiples of 4, 0 is never valid. */
export class HandleTable {
  private static nextObject = 0x1000;
  constructor(
    private readonly core: NtCore,
    private readonly ptr: number,
  ) {}
  private get x() {
    return this.core.exports;
  }
  /** `object` is an opaque 8-byte-aligned token (a kernel object address in a real kernel). */
  create(object: number, access = 0): number {
    if (object === 0 || (object & 7) !== 0) throw new RangeError("object token must be non-zero and 8-byte aligned");
    const h = this.x.nt_ht_create_handle(this.ptr, object, access);
    if (h === 0) throw new NtError("handle table exhausted", 0xc000009a);
    return h;
  }
  /** Allocates a fresh object token (for tests and simple servers). */
  static token(): number {
    HandleTable.nextObject += 8;
    return HandleTable.nextObject;
  }
  lookup(handle: number): { object: number; access: number } | undefined {
    return this.core.scratch(1, (acc, read) => {
      const obj = this.x.nt_ht_lookup(this.ptr, handle, acc);
      return obj === 0 ? undefined : { object: obj, access: read()[0]! };
    });
  }
  close(handle: number): boolean {
    return this.x.nt_ht_close(this.ptr, handle) === 1;
  }
  destroy(): void {
    this.x.nt_ht_destroy(this.ptr);
  }
}
