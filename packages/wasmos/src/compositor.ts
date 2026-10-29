// SPDX-License-Identifier: Apache-2.0
// Host side of the wasmos compositor (packages/wasmos/compositor): loads the wasm32 module, feeds it Wayland wire
// messages and reads the RGBA framebuffer. Runs unchanged under Bun and in the browser (only WebAssembly is used).

export interface CompositorExports {
  memory: WebAssembly.Memory;
  init(w: number, h: number): void;
  fb_ptr(): number;
  in_ptr(): number;
  in_cap(): number;
  out_ptr(): number;
  out_len(): number;
  out_clear(): void;
  pool_ptr(id: number): number;
  feed(len: number): number;
  render(): void;
  window_count(): number;
  window_x(order: number): number;
  window_y(order: number): number;
  title_height(): number;
}

export class Compositor {
  constructor(
    readonly x: CompositorExports,
    readonly width: number,
    readonly height: number,
  ) {
    x.init(width, height);
  }

  static async load(source: BufferSource | Response | string, width = 640, height = 400): Promise<Compositor> {
    let bytes: BufferSource;
    if (typeof source === "string") bytes = await (await fetch(source)).arrayBuffer();
    else if (source instanceof Response) bytes = await source.arrayBuffer();
    else bytes = source;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Compositor(instance.exports as unknown as CompositorExports, width, height);
  }

  /** Send raw wire bytes, return the number of messages the compositor handled. */
  send(bytes: Uint8Array): number {
    if (bytes.length > this.x.in_cap())
      throw new Error(`message batch of ${bytes.length} bytes exceeds ${this.x.in_cap()}`);
    new Uint8Array(this.x.memory.buffer, this.x.in_ptr(), bytes.length).set(bytes);
    return this.x.feed(bytes.length);
  }

  /** Events produced since the last call, decoded to { id, op, args }. */
  events(): WireEvent[] {
    const n = this.x.out_len();
    const raw = new Uint8Array(this.x.memory.buffer, this.x.out_ptr(), n).slice();
    this.x.out_clear();
    const dv = new DataView(raw.buffer);
    const out: WireEvent[] = [];
    for (let p = 0; p + 8 <= n;) {
      const id = dv.getUint32(p, true);
      const w = dv.getUint32(p + 4, true);
      const size = w >>> 16;
      out.push({ id, op: w & 0xffff, args: raw.slice(p + 8, p + size) });
      p += size;
    }
    return out;
  }

  /** Compose one frame and return a view of the RGBA framebuffer (valid until the next wasm call that grows memory). */
  frame(): Uint8ClampedArray {
    this.x.render();
    return new Uint8ClampedArray(this.x.memory.buffer, this.x.fb_ptr(), this.width * this.height * 4);
  }

  pixel(fb: Uint8ClampedArray, px: number, py: number): [number, number, number, number] {
    const o = (py * this.width + px) * 4;
    return [fb[o]!, fb[o + 1]!, fb[o + 2]!, fb[o + 3]!];
  }

  pool(id: number, size: number): Uint8Array {
    const p = this.x.pool_ptr(id);
    if (!p) throw new Error(`no shm pool ${id}`);
    return new Uint8Array(this.x.memory.buffer, p, size);
  }
}

export interface WireEvent {
  id: number;
  op: number;
  args: Uint8Array;
}

/** Encoder for the Wayland wire format (little endian, 32-bit words). */
export class Msg {
  private words: number[] = [];
  private tail: number[] = [];
  constructor(
    private id: number,
    private op: number,
  ) {}
  u32(v: number) {
    this.words.push(v >>> 0);
    return this;
  }
  str(s: string) {
    const b = new TextEncoder().encode(s + "\0");
    this.words.push(b.length);
    for (let i = 0; i < b.length; i += 4) {
      this.words.push((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | (((b[i + 3] ?? 0) << 24) >>> 0));
    }
    return this;
  }
  bytes(): Uint8Array {
    const size = 8 + this.words.length * 4;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, this.id, true);
    dv.setUint32(4, ((size << 16) | this.op) >>> 0, true);
    this.words.forEach((w, i) => dv.setUint32(8 + i * 4, w, true));
    return out;
  }
}

export const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/**
 * A tiny Wayland client: registry bind, shm pool, one xdg_toplevel with a solid-colour buffer.
 * Object ids are allocated from 2 up like libwayland does.
 */
export class Client {
  private next = 2;
  constructor(readonly c: Compositor) {}
  private id() {
    return this.next++;
  }
  private send(...m: Msg[]) {
    return this.c.send(concat(m.map(x => x.bytes())));
  }

  /** wl_display.get_registry + binds of wl_compositor, wl_shm and xdg_wm_base. Returns the object ids. */
  connect() {
    const registry = this.id();
    this.send(new Msg(1, 1).u32(registry));
    const globals = this.c.events().filter(e => e.id === registry);
    if (globals.length !== 3) throw new Error(`expected 3 globals, got ${globals.length}`);
    const [compositor, shm, wm] = [this.id(), this.id(), this.id()];
    this.send(
      new Msg(registry, 0).u32(1).str("wl_compositor").u32(4).u32(compositor),
      new Msg(registry, 0).u32(2).str("wl_shm").u32(1).u32(shm),
      new Msg(registry, 0).u32(3).str("xdg_wm_base").u32(1).u32(wm),
    );
    const formats = this.c.events().filter(e => e.id === shm).length;
    return { registry, compositor, shm, wm, formats };
  }

  /** Create, fill and commit a toplevel of w*h pixels in 0xAARRGGBB. Returns ids and the events received. */
  window(g: { compositor: number; shm: number; wm: number }, w: number, h: number, argb: number, title: string) {
    const [surface, xdg, top, pool, buffer, frame] = [this.id(), this.id(), this.id(), this.id(), this.id(), this.id()];
    this.send(
      new Msg(g.compositor, 0).u32(surface),
      new Msg(g.wm, 2).u32(xdg).u32(surface),
      new Msg(xdg, 1).u32(top),
      new Msg(top, 2).str(title),
    );
    const configure = this.c.events();
    const serial = new DataView(configure.find(e => e.id === xdg && e.op === 0)!.args.buffer.slice(0)).getUint32(
      0,
      true,
    );
    const size = w * h * 4;
    this.send(new Msg(g.shm, 0).u32(pool).u32(size));
    const mem = this.c.pool(pool, size);
    new Uint32Array(mem.buffer, mem.byteOffset, w * h).fill(argb >>> 0);
    this.send(
      new Msg(pool, 0)
        .u32(buffer)
        .u32(0)
        .u32(w)
        .u32(h)
        .u32(w * 4)
        .u32(1), // XRGB8888
      new Msg(xdg, 4).u32(serial),
      new Msg(surface, 1).u32(buffer).u32(0).u32(0),
      new Msg(surface, 3).u32(frame),
      new Msg(surface, 6),
    );
    return { surface, xdg, top, pool, buffer, events: this.c.events() };
  }
}
