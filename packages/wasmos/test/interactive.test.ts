// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { StdinRing, makeInteractivePoll } from "../src/interactive.ts";

describe("stdin ring", () => {
  test("bytes written by the page are read in order by the worker side", () => {
    const ring = new StdinRing();
    const reader = new StdinRing(ring.buffer);
    ring.write(new TextEncoder().encode("ls\n"));
    expect(reader.available()).toBe(3);
    expect(new TextDecoder().decode(reader.read(2))).toBe("ls");
    expect(new TextDecoder().decode(reader.read(10))).toBe("\n");
    expect(reader.available()).toBe(0);
    expect(reader.read(4)).toHaveLength(0);
  });

  test("the ring wraps and drops what does not fit", () => {
    const ring = new StdinRing();
    const big = new Uint8Array(5000).fill(65);
    ring.write(big);
    expect(ring.available()).toBe(4096);
    ring.read(4000);
    ring.write(new Uint8Array(100).fill(66));
    expect(ring.available()).toBe(196);
  });
});

/** One poll_oneoff call over a plain memory with the given subscriptions. */
function poll(ring: Parameters<typeof makeInteractivePoll>[1], subs: ({ clockMs: number } | { fdRead: number })[]) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const dv = new DataView(memory.buffer);
  subs.forEach((s, i) => {
    const o = i * 48;
    dv.setBigUint64(o, BigInt(100 + i), true);
    if ("clockMs" in s) {
      dv.setUint8(o + 8, 0);
      dv.setUint32(o + 16, 1, true); // monotonic
      dv.setBigUint64(o + 24, BigInt(s.clockMs) * 1_000_000n, true);
    } else {
      dv.setUint8(o + 8, 1);
      dv.setUint32(o + 16, s.fdRead, true);
    }
  });
  const out = 4096;
  const nev = 8192;
  const code = makeInteractivePoll(() => memory, ring)(0, out, subs.length, nev);
  const count = dv.getUint32(nev, true);
  const events = Array.from({ length: count }, (_, i) => ({
    userdata: Number(dv.getBigUint64(out + i * 32, true)),
    type: dv.getUint8(out + i * 32 + 10),
  }));
  return { code, events };
}

describe("interactive poll_oneoff", () => {
  test("stdin readable is reported as soon as the ring has bytes", () => {
    const ring = new StdinRing();
    ring.write(new Uint8Array([97]));
    const { code, events } = poll(ring, [{ fdRead: 0 }, { clockMs: 5000 }]);
    expect(code).toBe(0);
    expect(events).toEqual([{ userdata: 100, type: 1 }]);
  });

  test("with no input, the clock subscription fires when due", () => {
    const ring = new StdinRing();
    const t0 = performance.now();
    const { events } = poll(ring, [{ fdRead: 0 }, { clockMs: 30 }]);
    expect(events).toEqual([{ userdata: 101, type: 0 }]);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
  });

  test("a keystroke from another thread wakes a sleeping guest well before the clock", async () => {
    const ring = new StdinRing();
    const worker = new Worker(
      URL.createObjectURL(
        new Blob(
          [
            `self.onmessage = e => { const c = new Int32Array(e.data, 0, 2); const d = new Uint8Array(e.data, 8);
             setTimeout(() => { d[0] = 120; Atomics.store(c, 0, 1); Atomics.notify(c, 0); self.postMessage("sent"); }, 40); };`,
          ],
          { type: "text/javascript" },
        ),
      ),
    );
    const sent = new Promise(r => (worker.onmessage = () => r(true)));
    worker.postMessage(ring.buffer);
    const t0 = performance.now();
    // Block this thread in poll (as the guest does): the worker thread delivers the byte.
    const { events } = await new Promise<ReturnType<typeof poll>>(resolve =>
      setTimeout(() => resolve(poll(ring, [{ fdRead: 0 }, { clockMs: 5000 }])), 0),
    );
    expect(events).toEqual([{ userdata: 100, type: 1 }]);
    expect(performance.now() - t0).toBeLessThan(1000);
    await sent;
    worker.terminate();
  });
});
