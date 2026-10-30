// SPDX-License-Identifier: Apache-2.0
// Interactive stdin for a container2wasm guest. The headless host (poll.ts) never reports stdin ready, which is right
// for `sh -c` runs but leaves a terminal dead. Here keystrokes travel from the page to the worker through a
// SharedArrayBuffer ring, and poll_oneoff reports fd 0 readable exactly when the ring holds bytes.

const HEAD = 0;
const TAIL = 1;

/** Single-producer (page) single-consumer (worker) byte ring over a SharedArrayBuffer. */
export class StdinRing {
  readonly ctrl: Int32Array;
  readonly data: Uint8Array;

  /** `buffer` crosses postMessage to the worker; both sides wrap it with `new StdinRing(buffer)`. */
  constructor(readonly buffer: SharedArrayBuffer = new SharedArrayBuffer(8 + 4096)) {
    this.ctrl = new Int32Array(buffer, 0, 2);
    this.data = new Uint8Array(buffer, 8);
  }

  /** Producer side: queue bytes; bytes beyond the ring's capacity are dropped (a typist cannot outrun 4 KiB). */
  write(bytes: Uint8Array) {
    let head = Atomics.load(this.ctrl, HEAD);
    const tail = Atomics.load(this.ctrl, TAIL);
    for (const b of bytes) {
      if (head - tail >= this.data.length) break;
      this.data[head % this.data.length] = b;
      head++;
    }
    Atomics.store(this.ctrl, HEAD, head);
    Atomics.notify(this.ctrl, HEAD);
  }

  available(): number {
    return Atomics.load(this.ctrl, HEAD) - Atomics.load(this.ctrl, TAIL);
  }

  /** Consumer side: up to `max` queued bytes (empty when none). */
  read(max: number): Uint8Array {
    const head = Atomics.load(this.ctrl, HEAD);
    let tail = Atomics.load(this.ctrl, TAIL);
    const n = Math.min(max, head - tail);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.data[(tail + i) % this.data.length]!;
    tail += n;
    Atomics.store(this.ctrl, TAIL, tail);
    return out;
  }

  /** Consumer side: sleep until bytes arrive or `ms` pass. */
  wait(ms: number) {
    const tail = Atomics.load(this.ctrl, TAIL);
    if (Atomics.load(this.ctrl, HEAD) !== tail) return;
    Atomics.wait(this.ctrl, HEAD, tail, ms);
  }
}

const nowNs = (clock: number) =>
  clock === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.round(performance.now() * 1e6));

/**
 * poll_oneoff that reports stdin (fd 0) readable while the ring has bytes, honours clock subscriptions, and otherwise
 * sleeps on the ring so a keystroke wakes the guest at once.
 */
export function makeInteractivePoll(getMemory: () => WebAssembly.Memory, ring: Pick<StdinRing, "available" | "wait">) {
  return (inPtr: number, outPtr: number, n: number, neventsPtr: number): number => {
    const clocks: { userdata: bigint; end: bigint; clock: number }[] = [];
    const reads: { userdata: bigint; fd: number }[] = [];
    {
      const dv = new DataView(getMemory().buffer);
      for (let i = 0; i < n; i++) {
        const o = inPtr + i * 48;
        const tag = dv.getUint8(o + 8);
        const userdata = dv.getBigUint64(o, true);
        if (tag === 0) {
          const clock = dv.getUint32(o + 16, true);
          const timeout = dv.getBigUint64(o + 24, true);
          const abs = (dv.getUint16(o + 40, true) & 1) !== 0;
          clocks.push({ userdata, end: abs ? timeout : nowNs(clock) + timeout, clock });
        } else if (tag === 1) reads.push({ userdata, fd: dv.getUint32(o + 16, true) });
      }
    }
    const deadline = clocks.reduce<bigint | undefined>((m, c) => (m === undefined || c.end < m ? c.end : m), undefined);
    const stdinWanted = reads.some(r => r.fd === 0);
    for (;;) {
      const ready = stdinWanted && ring.available() > 0;
      const due = clocks.filter(c => nowNs(c.clock) >= c.end - 500_000n);
      if (ready || due.length) {
        const dv = new DataView(getMemory().buffer);
        let events = 0;
        const put = (userdata: bigint, type: number, nbytes: number) => {
          const o = outPtr + events * 32;
          new Uint8Array(getMemory().buffer, o, 32).fill(0);
          dv.setBigUint64(o, userdata, true);
          dv.setUint16(o + 8, 0, true);
          dv.setUint8(o + 10, type);
          dv.setBigUint64(o + 16, BigInt(nbytes), true);
          events++;
        };
        if (ready) for (const r of reads.filter(x => x.fd === 0)) put(r.userdata, 1, ring.available());
        for (const c of due) put(c.userdata, 0, 0);
        dv.setUint32(neventsPtr, events, true);
        return 0;
      }
      const remainingMs = deadline === undefined ? 50 : Number((deadline - nowNs(clocks[0]?.clock ?? 1)) / 1_000_000n);
      ring.wait(Math.max(1, Math.min(remainingMs, 50)));
    }
  };
}
