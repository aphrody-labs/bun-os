#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Qualify every emulator inside WebOS. Publishes the built cores and free test ROMs to the WebOS objects
 * directory (the native service's local object store), then opens the emulator window of the running WebOS
 * (/emulator.html?core=<id>&autotest=1) in headless Chrome per emulator, boots its free test ROM and asserts:
 * enough frames, a lit canvas, an audio context, a working save state where the core supports it and no
 * console errors. The result is written to <objects>/emulators/qualification.json (served as
 * /api/emulators/qualification and shown in the Emulators app) with one screenshot per emulator.
 *
 *   bun packages/bun-engine/web-emulation/qualify-webos.ts [--base http://127.0.0.1:8790] [--only id,id]
 *     [--frames 120] [--timeout-ms 600000] [--no-publish] [--no-run] [--watch]
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { EMULATORS, type QualificationEntry, type QualificationReport } from "./emulators";
import { Cdp, chromePath } from "./smoke.ts";
import { stageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../..");
const dist = join(root, "dist/web-emulation");
const args = Bun.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
};
const base = (value("--base") ?? Bun.env.WEBOS_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");
const objects = resolve(Bun.env.WEBOS_OBJECTS ?? join(Bun.env.HOME ?? root, "apps/webos/objects"));
const frames = Number(value("--frames") ?? 120);
const timeoutMs = Number(value("--timeout-ms") ?? 600_000);
const only = value("--only")?.split(",");

/** Decodes a non-interlaced 8-bit PNG (Chrome screenshots) and reports whether any pixel channel exceeds 16. */
function pngHasLitPixel(png: Uint8Array): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG (need 8-bit, non-interlaced)");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : body[9] === 0 ? 1 : 0;
      if (!channels) throw new Error("unsupported PNG color type");
    } else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      line[x] = (line[x]! + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const p = x * channels;
      if (line[p]! > 16 || line[p + (channels > 2 ? 1 : 0)]! > 16 || line[p + (channels > 2 ? 2 : 0)]! > 16)
        return true;
    }
    previous = line;
  }
  return false;
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function git(...a: string[]) {
  const r = Bun.spawnSync(["git", ...a], { cwd: root });
  return r.exitCode ? undefined : r.stdout.toString().trim();
}

async function publish() {
  for (const dir of ["runtime", "firmware"]) {
    if (!existsSync(join(dist, dir))) continue;
    await rm(join(objects, "emulation", dir), { recursive: true, force: true });
    await cp(join(dist, dir), join(objects, "emulation", dir), { recursive: true });
  }
  const published: string[] = [];
  for (const emulator of EMULATORS) {
    if (!emulator.core || !existsSync(join(dist, emulator.core, "manifest.json"))) continue;
    await rm(join(objects, "emulation", emulator.core), { recursive: true, force: true });
    await cp(join(dist, emulator.core), join(objects, "emulation", emulator.core), { recursive: true });
    published.push(emulator.core);
  }
  console.log(`published to ${objects}/emulation: ${published.join(", ") || "(no built cores)"}`);
}

async function launch() {
  const chrome = chromePath();
  if (!chrome) throw new Error("no Chrome/Chromium found (set CHROME)");
  const profile = join(root, "build/web-emulation", `qualify-profile-${crypto.randomUUID()}`);
  const child = Bun.spawn(
    [
      chrome,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--enable-unsafe-webgpu",
      ...(process.platform === "linux"
        ? [
            "--enable-features=Vulkan",
            "--use-angle=vulkan",
            "--use-vulkan=swiftshader",
            "--disable-vulkan-surface",
            "--use-webgpu-adapter=swiftshader",
            "--enable-unsafe-swiftshader",
            ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
          ]
        : []),
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=800,1000",
      "about:blank",
    ],
    { stderr: "pipe", stdout: "ignore" },
  );
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let endpoint = "";
  while (!endpoint) {
    const { value: chunk, done } = await reader.read();
    if (done) throw new Error("Chrome exited before DevTools was ready");
    seen += decoder.decode(chunk);
    endpoint = seen.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? "";
  }
  // Keep draining stderr so the GPU process can never block on a full pipe.
  void (async () => {
    for (;;) if ((await reader.read()).done) return;
  })();
  return {
    cdp: await Cdp.connect(endpoint),
    async close() {
      child.kill();
      await child.exited;
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function qualify(cdp: Cdp, id: string, fixtureSha: string | undefined): Promise<QualificationEntry> {
  const emulator = EMULATORS.find(e => e.id === id)!;
  const url = `${pageOrigin}/emulator.html?core=${id}&autotest=1&frames=${frames}&timeout=${timeoutMs}`;
  const entry: QualificationEntry = { id, status: "fail", errors: [], url, testedAt: new Date().toISOString() };
  if (emulator.fixture)
    entry.fixture = {
      file: emulator.fixture.file,
      sha256: fixtureSha ?? "",
      license: emulator.fixture.license,
      source: emulator.fixture.source,
    };
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const logs: string[] = [];
  const listener = (m: any) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown")
      logs.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      logs.push(`console.error: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
      logs.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  };
  cdp.listeners.push(listener);
  try {
    for (const method of ["Runtime.enable", "Log.enable", "Page.enable"]) await cdp.send(method, {}, sessionId);
    await cdp.send("Page.bringToFront", {}, sessionId);
    await cdp.send("Page.navigate", { url }, sessionId);
    const started = performance.now();
    let result: any;
    while (performance.now() - started < timeoutMs + 60_000) {
      await Bun.sleep(1000);
      const { result: v } = await cdp.send(
        "Runtime.evaluate",
        { expression: "JSON.stringify(window.__emulator?.result ?? null)", returnByValue: true },
        sessionId,
      );
      result = JSON.parse(v.value ?? "null");
      if (result) break;
    }
    if (!result) {
      const { result: probe } = await cdp.send(
        "Runtime.evaluate",
        {
          expression:
            "JSON.stringify({phase: window.__emulator?.phase ?? 'no emulator page', frames: window.__emulator?.frames, errors: window.__emulator?.errors, title: document.title})",
          returnByValue: true,
        },
        sessionId,
      );
      entry.errors = logs;
      entry.detail = `timeout: the emulator window never reported a result (${probe.value})`;
      return entry;
    }
    const { result: box } = await cdp.send(
      "Runtime.evaluate",
      {
        expression:
          "JSON.stringify((()=>{const c=window.__emulator?.handle?.canvas??document.getElementById('screen');const r=c.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})())",
        returnByValue: true,
      },
      sessionId,
    );
    const clip = JSON.parse(box.value);
    let screenshotLit = false;
    if (clip.width > 0 && clip.height > 0) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip }, sessionId);
      const png = Buffer.from(shot.data, "base64");
      await Bun.write(join(objects, "emulators/shots", `${id}.png`), png);
      entry.screenshot = `/api/emulators/qualification/${id}.png`;
      screenshotLit = pngHasLitPixel(png);
    }
    entry.frames = result.frames;
    // Bevy presents through WebGPU, and a headless screenshot of a WebGPU canvas can come back transparent: the
    // core's own framebuffer (software renderers) or its GPU submission counter (Dust on wgpu) is the evidence then.
    const gpuSubmitted = result.renderer === "wgpu30-dust" && (result.gpu2d ?? 0) > 0;
    const lit = screenshotLit || result.lit === true || gpuSubmitted;
    entry.lit = lit;
    entry.hash = result.hash;
    entry.audio = result.audio;
    entry.renderer = result.renderer;
    entry.saveState = result.saveState;
    entry.errors = [...(result.errors ?? []), ...logs];
    const problems: string[] = [];
    if (result.error) problems.push(result.error);
    if ((result.frames ?? 0) < frames) problems.push(`only ${result.frames ?? 0} of ${frames} frames`);
    if (!lit) problems.push("the canvas stayed black");
    if (!result.audioProbe?.contexts) problems.push("no Web Audio context was created");
    if (result.saveState === "fail") problems.push("save state failed");
    if (result.stopped) problems.push(`machine stopped: ${result.stopped}`);
    if (entry.errors.length) problems.push(`${entry.errors.length} console error(s)`);
    entry.status = problems.length ? "fail" : "pass";
    entry.detail = problems.length
      ? problems.join("; ")
      : result.v86
        ? `Alpine booted to the serial login prompt and ran a command as root (${result.v86.serialBytes} serial bytes)`
        : `booted ${emulator.fixture?.file}, ${result.frames} frames`;
    return entry;
  } finally {
    cdp.listeners.splice(cdp.listeners.indexOf(listener), 1);
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// --watch: keep qualifying cores as the build-all pipeline finishes them (publish, then qualify only those).
if (flag("--watch")) {
  const seen = new Map<string, number>();
  for (;;) {
    const changed = EMULATORS.filter(e => {
      const manifest = e.core && join(dist, e.core, "manifest.json");
      return manifest && existsSync(manifest) && Bun.file(manifest).lastModified > (seen.get(e.id) ?? 0);
    });
    if (changed.length) {
      const stamp = Object.fromEntries(
        changed.map(e => [e.id, Bun.file(join(dist, e.core!, "manifest.json")).lastModified]),
      );
      const child = Bun.spawn(
        [
          process.execPath,
          import.meta.path,
          "--only",
          changed.map(e => e.id).join(","),
          "--base",
          base,
          "--timeout-ms",
          String(timeoutMs),
        ],
        { stdout: "inherit", stderr: "inherit" },
      );
      await child.exited;
      for (const [id, time] of Object.entries(stamp)) seen.set(id, time);
    }
    await Bun.sleep(300_000);
  }
}

if (!flag("--no-publish")) {
  await mkdir(objects, { recursive: true });
  await publish();
}
const staged = await stageFixtures(objects);
if (flag("--no-run")) process.exit(0);

const reportPath = join(objects, "emulators/qualification.json");
const previous: QualificationReport | undefined = (await Bun.file(reportPath).exists())
  ? await Bun.file(reportPath).json()
  : undefined;
const report: QualificationReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  base,
  sourceCommit: git("rev-parse", "HEAD"),
  entries: { ...(only ? previous?.entries : {}) },
};
// The test page (qualify-page/) is served here; every other request (/emulation/, /api/emulators, /vm/) is proxied to
// the WebOS origin under test, so the cores, fixtures and API are the ones WebOS serves.
const pageDir = join(import.meta.dir, "qualify-page");
const isolation = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "credentialless" };
const pageServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const local = /^\/(emulator(?:-probe)?\.(?:html|js|css))$/.exec(url.pathname)?.[1];
    if (local) return new Response(Bun.file(join(pageDir, local)), { headers: { ...isolation, "cache-control": "no-store" } });
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const upstream = await fetch(`${base}${url.pathname}${url.search}`, { headers: request.headers });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(isolation)) headers.set(k, v);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
});
const pageOrigin = pageServer.url.origin;
const browser = await launch();
try {
  for (const emulator of EMULATORS) {
    if (only && !only.includes(emulator.id)) continue;
    let entry: QualificationEntry;
    if (emulator.mode === "native") {
      entry = {
        id: emulator.id,
        status: "unsupported",
        errors: [],
        detail: emulator.reason,
        testedAt: new Date().toISOString(),
      };
    } else if (
      emulator.mode === "wasm" &&
      !(await Bun.file(join(objects, "emulation", emulator.core!, "manifest.json")).exists())
    ) {
      entry = {
        id: emulator.id,
        status: "untested",
        errors: [],
        testedAt: new Date().toISOString(),
        detail: "No WebAssembly build is published yet (web-emulation build-all pipeline).",
      };
    } else if (staged[emulator.id]?.error) {
      entry = {
        id: emulator.id,
        status: "fail",
        errors: [],
        detail: staged[emulator.id]!.error,
        testedAt: new Date().toISOString(),
      };
    } else {
      entry = await qualify(browser.cdp, emulator.id, staged[emulator.id]?.sha256).catch(
        (error): QualificationEntry => ({
          id: emulator.id,
          status: "fail",
          errors: [],
          detail: String(error?.message ?? error),
          testedAt: new Date().toISOString(),
        }),
      );
    }
    report.entries[emulator.id] = entry;
    console.log(`${emulator.id}: ${entry.status}${entry.detail ? ` (${entry.detail})` : ""}`);
    await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await browser.close();
  pageServer.stop(true);
}
await Bun.write(join(root, "build/web-emulation/webos-qualification.json"), `${JSON.stringify(report, null, 2)}\n`);
const failing = Object.values(report.entries).filter(e => e.status === "fail");
console.log(
  JSON.stringify(Object.fromEntries(Object.entries(report.entries).map(([id, e]) => [id, e.status])), null, 2),
);
if (failing.length) process.exitCode = 1;
