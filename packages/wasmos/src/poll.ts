// SPDX-License-Identifier: Apache-2.0
// poll_oneoff for a headless guest. Upstream Bun's node:wasi (1.4.4) reports every fd_read subscription ready, so the
// emulator then calls a blocking read(0) that never returns on an idle stdin. This one never reports stdin as ready,
// honours clock subscriptions (relative or absolute) and sleeps with Atomics.wait instead of spinning.
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
const nowNs = (clock: number) => (clock === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.round(performance.now() * 1e6)));

export function makePollOneoff(getMemory: () => WebAssembly.Memory) {
  return (inPtr: number, outPtr: number, n: number, neventsPtr: number): number => {
    const dv = new DataView(getMemory().buffer);
    let deadline: bigint | undefined;
    const clocks: { userdata: bigint; end: bigint; clock: number }[] = [];
    for (let i = 0; i < n; i++) {
      const o = inPtr + i * 48;
      if (dv.getUint8(o + 8) !== 0) continue; // fd_read / fd_write: never ready
      const clock = dv.getUint32(o + 16, true);
      const timeout = dv.getBigUint64(o + 24, true);
      const abs = (dv.getUint16(o + 40, true) & 1) !== 0;
      const end = abs ? timeout : nowNs(clock) + timeout;
      clocks.push({ userdata: dv.getBigUint64(o, true), end, clock });
    }
    const target = clocks.reduce<bigint | undefined>((m, c) => (m === undefined || c.end < m ? c.end : m), undefined);
    if (target !== undefined) deadline = target;
    const wait = deadline === undefined ? 10 : Number((deadline - nowNs(clocks[0]?.clock ?? 1)) / 1_000_000n);
    if (wait > 0) Atomics.wait(sleepBuf, 0, 0, Math.min(wait, 60_000));
    let events = 0;
    for (const c of clocks) {
      if (nowNs(c.clock) < c.end - 500_000n) continue; // not due (0.5 ms slack)
      const o = outPtr + events * 32;
      new Uint8Array(getMemory().buffer, o, 32).fill(0);
      dv.setBigUint64(o, c.userdata, true);
      dv.setUint16(o + 8, 0, true);
      dv.setUint8(o + 10, 0);
      events++;
    }
    dv.setUint32(neventsPtr, events, true);
    return 0;
  };
}
