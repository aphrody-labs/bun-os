import { mkdtempSync } from "node:fs";
import { stopTestBrowser } from "./browser-process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Run explicitly with IECODE_BROWSER pointing to a Chromium executable.
// Requires real wasm-bindgen output in ../pkg; never replaces it with mocks.
const browser = process.env.IECODE_BROWSER;
if (!browser) throw new Error("Set IECODE_BROWSER to a Chromium executable");
const pkg = new URL("../pkg/", import.meta.url);
type BrowserReport = {
  frames?: string;
  top?: number[];
  bottom?: number[];
  error?: string;
};
let resolveReport!: (value: BrowserReport) => void;
const report = new Promise<BrowserReport>(resolve => {
  resolveReport = resolve;
});
// Original ARM homebrew configures red engine-A and blue engine-B backdrops.
// Register addresses/POWCNT1/DISPCNT: GBATEK DS video and power-control sections.
// The ARM7 increment loop matches emulator-host/tests/support/rom.rs.
const rom = new Uint8Array(0x1000);
rom.set(new TextEncoder().encode("IECODE TEST "));
rom.set(new TextEncoder().encode("IECT"), 12);
const words = new DataView(rom.buffer);
for (const [offset, value] of [
  [0x20, 0x200],
  [0x24, 0x02000000],
  [0x28, 0x02000000],
  [0x2c, 12],
  [0x30, 0x300],
  [0x34, 0x03800000],
  [0x38, 0x03800000],
  [0x3c, 12],
  [0x80, 0x1000],
  [0x84, 0x200],
] as const)
  words.setUint32(offset, value, true);
const program: number[] = [];
const literals: { instruction: number; register: number; value: number }[] = [];
function load(register: number, value: number) {
  literals.push({ instruction: program.length, register, value });
  program.push(0);
}
// LCDs, both 2D engines, engine A on the upper screen.
load(1, 0x04000304);
load(2, 0x8203);
program.push(0xe1c120b0); // STRH r2,[r1]
load(1, 0x04000000);
load(2, 0x10000);
program.push(0xe5812000); // STR r2,[r1]
load(1, 0x04001000);
program.push(0xe5812000);
load(1, 0x05000000);
load(2, 0x001f);
program.push(0xe1c120b0);
load(1, 0x05000400);
load(2, 0x7c00);
program.push(0xe1c120b0);
program.push(0xe3a00000, 0xe2800001, 0xeafffffd);
for (const literal of literals) {
  const displacement = program.length * 4 - (literal.instruction * 4 + 8);
  program[literal.instruction] = 0xe59f0000 | (literal.register << 12) | displacement;
  program.push(literal.value);
}
words.setUint32(0x2c, program.length * 4, true);
program.forEach((word, i) => words.setUint32(0x200 + i * 4, word, true));
[0xe3a00000, 0xe2800001, 0xeafffffd].forEach((word, i) => {
  words.setUint32(0x300 + i * 4, word, true);
});
const worker = `
import init, { create_emu_state, SaveType, WbgModel } from '/pkg/aphrody_dust_web.js';
let stage = 'wasm';
const fail = error => postMessage({error: stage + ': ' + String(error)});
self.addEventListener('unhandledrejection', event => fail(event.reason));
self.addEventListener('error', event => fail(event.message));
self.onmessage = async event => {
  try {
    await init();
    stage = 'core';
    const rom = new Uint8Array(await (await fetch('/rom')).arrayBuffer());
    const emu = create_emu_state(undefined, undefined, undefined, rom,
      undefined, SaveType.None, false, WbgModel.Ds, () => {});
    stage = 'renderer';
    await emu.enable_webgpu(event.data);
    stage = 'frames';
    for (let i = 0; i < 3; i++) {
      emu.run_frame_webgpu();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    postMessage({frames: emu.finished_frames().toString()});
  } catch (error) { fail(error); }
};`;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/report" && req.method === "POST") {
      resolveReport(await req.json());
      return new Response("ok");
    }
    if (path === "/rom") return new Response(rom);
    if (path === "/worker.js")
      return new Response(worker, {
        headers: { "Content-Type": "text/javascript" },
      });
    if (path === "/pkg/aphrody_dust_web.js" || path === "/pkg/aphrody_dust_web_bg.wasm") {
      return new Response(Bun.file(new URL(path.slice(5), pkg)));
    }
    if (path !== "/") return new Response("Not found", { status: 404 });
    return new Response(
      `<!doctype html><canvas width="256" height="384"></canvas>
      <script type="module">
      const worker = new Worker('/worker.js', {type:'module'});
      const report = data => fetch('/report', {method:'POST', body:JSON.stringify(data)});
      worker.onmessage = async event => {
        if (event.data.error) return report(event.data);
        try {
          // Read the presented HTML canvas after the browser's rendering opportunity.
          // Reading the WebGPU OffscreenCanvas in the worker can return transparent pixels.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const probe = new OffscreenCanvas(256, 384).getContext('2d');
          probe.drawImage(document.querySelector('canvas'), 0, 0);
          report({...event.data,
            top: Array.from(probe.getImageData(128, 96, 1, 1).data),
            bottom: Array.from(probe.getImageData(128, 288, 1, 1).data)});
        } catch (error) { report({error: String(error)}); }
      };
      worker.onerror = event => report({error:event.message});
      const canvas = document.querySelector('canvas').transferControlToOffscreen();
      worker.postMessage(canvas, [canvas]);
      </script>`,
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const browserProfile = mkdtempSync(join(tmpdir(), "iecode-chromium-smoke-"));
const child = Bun.spawn(
  [
    browser,
    "--headless",
    `--user-data-dir=${browserProfile}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-webgpu",
    ...(process.platform === "win32"
      ? ["--use-angle=d3d11", "--use-webgpu-adapter=d3d12", "--force-high-performance-gpu"]
      : ["--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=swiftshader", "--disable-vulkan-surface"]),
    "--disable-background-networking",
    String(server.url),
  ],
  { stdout: "pipe", stderr: "pipe", timeout: 45000 },
);
const stderr = new Response(child.stderr).text();
try {
  const result = await Promise.race([
    report,
    child.exited.then((code): BrowserReport => ({
      error: `Browser exited: ${code}`,
    })),
  ]);
  if (result.error) throw new Error(result.error);
  if (result.frames !== "3") throw new Error(`Expected 3 core frames: ${JSON.stringify(result)}`);
  // Independent native soft-renderer test verifies RGB6 62 for RGB5 maximum.
  // The WGPU shader normalizes by 63, producing RGBA8 round(62 / 63 * 255)=251.
  if (JSON.stringify(result.top) !== "[251,0,0,255]" || JSON.stringify(result.bottom) !== "[0,0,251,255]") {
    throw new Error(`Guest-programmed DS backdrop mismatch: ${JSON.stringify(result)}`);
  }
  console.log(
    JSON.stringify({
      backend: process.platform === "win32" ? "Chromium D3D12 WebGPU" : "Chromium SwiftShader WebGPU",
      ...result,
    }),
  );
} finally {
  await stopTestBrowser(child, browserProfile);
  server.stop(true);
  const diagnostics = await stderr;
  if (process.env.IECODE_BROWSER_VERBOSE) console.error(diagnostics);
}
