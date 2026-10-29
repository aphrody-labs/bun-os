#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * End-to-end measurement against a real Android target reachable through adb (redroid, Waydroid, emulator).
 *   ANDROID_SERIAL=localhost:5555 bun packages/waydroid/scripts/e2e.ts [--out results.json] [--seconds 10]
 * Steps: boot wait, install of a pinned F-Droid APK, launch, adb screenshot, scrcpy stream through the gateway
 * (frame count, bytes, fps, distinct frame hashes, IDR presence), input-to-first-frame latency.
 * Everything printed is measured; nothing is simulated.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { Adb } from "../src/adb.ts";
import { startGateway } from "../src/gateway.ts";

const FDROID = {
  url: "https://f-droid.org/repo/org.fdroid.fdroid_2000052.apk",
  sha256: "19d51fad482239f6df6a99120e34513667e9a86d136dafdc4a211a68c3327b52",
  package: "org.fdroid.fdroid",
};

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { out: { type: "string" }, seconds: { type: "string", default: "10" }, taps: { type: "string", default: "10" } },
});
const serial = process.env.ANDROID_SERIAL;
const adb = new Adb(serial);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const r: Record<string, unknown> = { serial: serial ?? "default", startedAt: new Date().toISOString() };
const ms = (t0: number) => Math.round(performance.now() - t0);

// 1. device + boot
let t = performance.now();
await adb.waitForDevice();
r.waitForDeviceMs = ms(t);
r.bootMs = Math.round(await adb.waitForBoot());
r.android = (await adb.shell("getprop ro.build.version.release")).trim();
r.abi = (await adb.shell("getprop ro.product.cpu.abi")).trim();
r.display = await adb.displaySize();
r.memTotalKb = Number(/MemTotal:\s+(\d+)/.exec(await adb.shell("cat /proc/meminfo"))?.[1] ?? 0);

// 2. install the pinned APK
const apkPath = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/fdroid-${FDROID.sha256.slice(0, 8)}.apk`;
t = performance.now();
const res = await fetch(FDROID.url);
if (!res.ok) throw new Error(`apk download: ${res.status}`);
const apk = new Uint8Array(await res.arrayBuffer());
if (sha(apk) !== FDROID.sha256) throw new Error("apk sha256 mismatch");
await Bun.write(apkPath, apk);
r.apkDownloadMs = ms(t);
r.apkBytes = apk.byteLength;
t = performance.now();
const out = await adb.install(apkPath);
r.installMs = ms(t);
r.installOutput = out;
if (!(await adb.isInstalled(FDROID.package))) throw new Error("package not installed after adb install");

// 3. launch + screenshot
t = performance.now();
await adb.launch(FDROID.package);
await Bun.sleep(3000);
r.launchMs = ms(t);
t = performance.now();
const png = await adb.screenshot();
r.screenshotMs = ms(t);
r.screenshotBytes = png.byteLength;
if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error("screenshot is not a PNG");
const dv = new DataView(png.buffer, png.byteOffset);
r.screenshotSize = { width: dv.getUint32(16), height: dv.getUint32(20) };
r.screenshotSha256 = sha(png);

// 4. stream through the real gateway
const token = crypto.randomUUID();
const gw = startGateway({ token, start: { maxSize: 1280, maxFps: 60 } });
t = performance.now();
const ws = new WebSocket(`${gw.url.replace("http", "ws")}/stream?token=${token}${serial ? `&serial=${encodeURIComponent(serial)}` : ""}`);
ws.binaryType = "arraybuffer";
type Pkt = { at: number; flags: number; size: number; hash: string; nal: number };
const pkts: Pkt[] = [];
let meta: unknown;
ws.onmessage = e => {
  if (typeof e.data === "string") {
    const m = JSON.parse(e.data);
    if (m.type === "meta") meta = m;
    return;
  }
  const w = new Uint8Array(e.data);
  const p = w.subarray(9);
  const sc = p[2] === 1 ? 3 : 4;
  pkts.push({ at: performance.now(), flags: w[0]!, size: p.byteLength, hash: sha(p), nal: p[sc]! & 0x1f });
};
const opened = await new Promise<boolean>(res => {
  ws.onopen = () => res(true);
  ws.onerror = () => res(false);
});
if (!opened) throw new Error("websocket failed to open");
while (!pkts.some(p => p.flags & 2)) {
  if (performance.now() - t > 60_000) throw new Error("no key frame within 60 s");
  await Bun.sleep(20);
}
r.sessionStartToKeyFrameMs = ms(t);
r.stream = meta;

// 5. input -> first frame latency: swipe on the app and time the next packet
const m = meta as { width: number; height: number };
const lat: number[] = [];
for (let i = 0; i < Number(values.taps); i++) {
  await Bun.sleep(700); // let the encoder go idle
  const before = pkts.length;
  const t0 = performance.now();
  const y = (a: number) => Math.round(m.height * a);
  const x = Math.round(m.width / 2);
  const dir = i % 2 ? 0.3 : 0.7;
  for (const [action, yy] of [["down", dir], ["move", 0.5], ["up", i % 2 ? 0.7 : 0.3]] as const) {
    ws.send(JSON.stringify({ t: "touch", action, x, y: y(yy), w: m.width, h: m.height, id: 1 }));
  }
  while (pkts.length === before && performance.now() - t0 < 2000) await Bun.sleep(1);
  if (pkts.length > before) lat.push(Math.round(pkts[before]!.at - t0));
}
lat.sort((a, b) => a - b);
r.inputToFrameMs = { samples: lat, median: lat[Math.floor(lat.length / 2)], p90: lat[Math.floor(lat.length * 0.9)] };

// 6. sustained stream while scrolling
const seconds = Number(values.seconds);
const startCount = pkts.length;
const t1 = performance.now();
let phase = 0;
while (performance.now() - t1 < seconds * 1000) {
  phase++;
  const y0 = phase % 2 ? 0.75 : 0.25;
  const y1 = phase % 2 ? 0.25 : 0.75;
  for (let s = 0; s <= 8; s++) {
    ws.send(JSON.stringify({ t: "touch", action: s === 0 ? "down" : s === 8 ? "up" : "move", x: Math.round(m.width / 2), y: Math.round(m.height * (y0 + ((y1 - y0) * s) / 8)), w: m.width, h: m.height, id: 1 }));
    await Bun.sleep(16);
  }
  await Bun.sleep(100);
}
const window = pkts.slice(startCount);
const span = (performance.now() - t1) / 1000;
r.sustained = {
  seconds: Number(span.toFixed(2)),
  packets: window.length,
  fps: Number((window.length / span).toFixed(1)),
  bytes: window.reduce((a, p) => a + p.size, 0),
  kbps: Math.round((window.reduce((a, p) => a + p.size, 0) * 8) / span / 1000),
  distinctFrameHashes: new Set(window.map(p => p.hash)).size,
};
r.streamTotals = {
  packets: pkts.length,
  idrFrames: pkts.filter(p => p.nal === 5).length,
  spsInConfig: pkts.some(p => p.flags & 1 && p.nal === 7),
};
ws.close();
await gw.stop();

const json = JSON.stringify(r, null, 2);
console.log(json);
if (values.out) await Bun.write(values.out, json + "\n");

const s = r.sustained as { packets: number; distinctFrameHashes: number };
if (s.packets < 10 || s.distinctFrameHashes < 5 || !(r.streamTotals as { idrFrames: number }).idrFrames) {
  console.error("stream check failed: too few distinct frames or no IDR");
  process.exit(1);
}
