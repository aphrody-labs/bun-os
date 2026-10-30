#!/usr/bin/env bun
/**
 * Headless browser smoke test per core: serve dist/web-emulation cross-origin isolated, open the
 * smoke page in headless Chrome over the DevTools protocol, boot a free ROM, run 120 frames and
 * require a non-black frame, a frame hash and no console errors. Writes
 * dist/web-emulation/smoke.json and screenshots under build/web-emulation/screens/.
 *
 *   bun packages/bun-engine/web-emulation/smoke.ts [core...] [--threads]
 */
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { serve } from "./serve.ts";
import {
  createQualificationSnapshot,
  qualificationSHA256,
  writeQualification,
  type QualificationFixture,
} from "./qualification.ts";

const root = resolve(import.meta.dir, "../../..");
const dist = join(root, "dist", "web-emulation");
const shots = join(root, "build", "web-emulation", "screens");

/** Only source-licensed release fixtures with exact binary pins are admitted. */
const cases: Record<string, { system: string; pack: string; firmware?: string; frames?: number }> = {
  "dust-nds": { system: "nds", pack: "godmode9i" },
  melonds: { system: "nds", pack: "godmode9i" },
  "zakuro-3ds": { system: "3ds", pack: "fbi" },
};

async function stageFixture(packID: string): Promise<QualificationFixture> {
  const lock = await Bun.file(join(import.meta.dir, "web-emulation.lock.json")).json();
  const catalog = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/roms.json")).json();
  const pin = lock.testContent[packID];
  const pack = catalog.packs.find((p: any) => p.id === packID);
  if (!pin || !pack?.url || pack.sha256 !== pin.sha256)
    throw new Error(`${packID}: missing matching open-source fixture pins`);
  const source = join(root, "usr/var/cache/bep/roms", packID, pin.file);
  if ((await qualificationSHA256(source)) !== pin.sha256) throw new Error(`${packID}: cached ROM digest mismatch`);
  const path = `fixtures/${packID}/${pin.file}`;
  await Bun.write(join(dist, path), Bun.file(source));
  return { path, sha256: pin.sha256, license: pack.license, source: pack.url };
}

export function chromePath() {
  const candidates = [
    Bun.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find(p => p && Bun.file(p).size > 0);
}

export class Cdp {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, (value: any) => void>();
  listeners: Array<(message: any) => void> = [];
  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.#pending.has(message.id)) {
        this.#pending.get(message.id)!(message);
        this.#pending.delete(message.id);
      } else for (const listener of this.listeners) listener(message);
    };
  }
  static async connect(url: string) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = fail;
    });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) =>
      this.#pending.set(id, m => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result))),
    );
  }
  close() {
    this.#ws.close();
  }
}

export async function smoke(
  cores: string[],
  threads: boolean,
  timeoutMs = 90_000,
  options: { rom?: string; renderer?: "gpu" | "software" } = {},
) {
  const comparison = options.renderer === "software";
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000)
    throw new Error("Smoke timeout must be 30000..900000 milliseconds");
  // Invalidate old claims before setup too: missing browser/content must not retain qualification.
  for (const core of cores) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(core)) throw new Error(`Invalid core: ${core}`);
    if (!options.rom && !comparison) rmSync(join(dist, core, "qualification.json"), { force: true });
  }
  if (options.rom && !isAbsolute(options.rom))
    throw new Error("--rom must be an absolute path to an explicitly supplied local image");
  const privateROM = options.rom
    ? { path: options.rom, token: crypto.randomUUID(), sha256: await qualificationSHA256(options.rom) }
    : undefined;
  const reportDir =
    privateROM || comparison
      ? join(root, "build/web-emulation", privateROM ? "private" : "reference", crypto.randomUUID())
      : dist;
  if (privateROM || comparison) console.log(`Local qualification report: ${join(reportDir, "smoke.json")}`);
  const chrome = chromePath();
  if (!chrome) throw new Error("no Chrome/Chromium found (set CHROME)");
  const profileRoot = resolve(root, "build/web-emulation");
  const profile = join(profileRoot, `chrome-profile-${crypto.randomUUID()}`);
  const browserStderrPath = join(profileRoot, "browser-logs", `${crypto.randomUUID()}.stderr.log`);
  const profileName = profile.slice(profileRoot.length + 1);
  if (!/^chrome-profile-[a-f0-9-]+$/.test(profileName) || resolve(profile) !== join(profileRoot, profileName))
    throw new Error("Unsafe browser profile cleanup path");
  mkdirSync(join(profileRoot, "browser-logs"), { recursive: true });
  console.log(`Browser stderr: ${browserStderrPath}`);
  // Browser process diagnostics include Dawn/GPU-process crashes which CDP page errors do
  // not report. Retain a bounded tail outside redistributable dist and keep draining the
  // pipe throughout qualification so browser stderr can never block its GPU process.
  const stderrLimit = 1024 * 1024;
  let stderrTail = Buffer.alloc(0);
  let stderrTruncated = false;
  const captureStderr = (chunk: Uint8Array) => {
    const combined = Buffer.concat([stderrTail, chunk]);
    stderrTruncated ||= combined.byteLength > stderrLimit;
    stderrTail = Buffer.from(combined.subarray(Math.max(0, combined.byteLength - stderrLimit)));
  };
  const saveStderr = () =>
    Bun.write(
      browserStderrPath,
      Buffer.concat([
        Buffer.from(stderrTruncated ? "[Earlier browser stderr omitted; retaining the last 1 MiB]\n" : ""),
        stderrTail,
      ]),
    );
  let stderrReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stderrDrain: Promise<void> | undefined;
  const screenshotDir = privateROM || comparison ? reportDir : shots;
  mkdirSync(screenshotDir, { recursive: true });
  const server = serve(0, { privateROM });
  let cleanupBrowser: (() => Promise<void>) | undefined;
  let cdp: Cdp | undefined;
  try {
    const browser = Bun.spawn(
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
        // GPU-less Linux hosts (the VPS): WebGPU on SwiftShader's Vulkan.
        ...(process.platform === "linux"
          ? [
              "--enable-features=Vulkan",
              // Chrome's documented headless Vulkan path avoids platform swapchain surfaces.
              // https://developer.chrome.com/blog/supercharge-web-ai-testing
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
    cleanupBrowser = async () => {
      browser.kill();
      await browser.exited;
    };
    let endpoint = "";
    const reader = browser.stderr.getReader();
    stderrReader = reader;
    const decoder = new TextDecoder();
    let buffered = "";
    while (!endpoint) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Chrome exited before DevTools was ready");
      captureStderr(value);
      buffered += decoder.decode(value);
      endpoint = buffered.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? "";
      if (buffered.length > stderrLimit) buffered = buffered.slice(-stderrLimit);
    }
    await saveStderr();
    stderrDrain = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          captureStderr(value);
        }
      } catch (error) {
        captureStderr(new TextEncoder().encode(`\n[Browser stderr capture: ${String(error)}]\n`));
      }
    })();
    cdp = await Cdp.connect(endpoint);
    const results: Record<string, unknown> =
      !privateROM && !comparison && (await Bun.file(join(dist, "smoke.json")).exists())
        ? await Bun.file(join(dist, "smoke.json")).json()
        : {};
    for (const core of cores) {
      const test = cases[core];
      const renderer = options.renderer ?? (core === "dust-nds" ? "gpu" : undefined);
      if (!test)
        throw new Error(`no pinned open-source smoke case for ${core}; freeware and placeholder images cannot qualify`);
      const fixture = privateROM ? undefined : await stageFixture(test.pack);
      const fixtures = fixture ? [fixture] : [];
      if (test.firmware) {
        const registry = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/free-firmware.json")).json();
        const pin = registry.firmware[test.firmware];
        if (!pin) throw new Error(`No free firmware pin: ${test.firmware}`);
        fixtures.push({ path: `firmware/${pin.file}`, sha256: pin.sha256, license: pin.license, source: pin.source });
      }
      const manifest = await Bun.file(join(dist, core, "manifest.json")).json();
      if (threads && !manifest.variants?.threads) throw new Error("Requested threaded WASM variant is not built");
      const selectedVariant = threads ? manifest.variants.threads : manifest;
      const privateArtifacts: Record<string, string> = {};
      if (privateROM) {
        for (const path of [
          `${core}/manifest.json`,
          `${core}/${selectedVariant.module}`,
          `${core}/${selectedVariant.wasm}`,
        ]) {
          if (/[\\%:?#]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".."))
            throw new Error("Unsafe private qualification artifact path");
          privateArtifacts[path] = await qualificationSHA256(join(dist, path));
        }
      }
      const snapshot =
        privateROM || comparison
          ? undefined
          : await createQualificationSnapshot(dist, core, fixtures, { variant: threads ? "threads" : "single" });
      const query = new URLSearchParams({
        core,
        system: test.system,
        rom: privateROM ? `/private-rom/${privateROM.token}` : `/emulation/${fixture!.path}`,
        frames: String(test.frames ?? 120),
        timeout: String(timeoutMs),
      });
      if (test.firmware) query.set("firmware", test.firmware);
      if (threads) query.set("threads", "1");
      if (renderer) query.set("renderer", renderer);
      if (privateROM && renderer === "gpu") query.set("require3d", "1");
      const url = `${server.url}smoke/?${query}`;
      const { targetId } = await cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const logs: string[] = [];
      const listener = (m: any) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === "Runtime.exceptionThrown")
          logs.push(
            `exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`,
          );
        if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
          logs.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
        if (m.method === "Log.entryAdded" && m.params.entry.level === "error") logs.push(`log: ${m.params.entry.text}`);
      };
      cdp.listeners.push(listener);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Log.enable", {}, sessionId);
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Page.bringToFront", {}, sessionId);
      const opened = performance.now();
      await cdp.send("Page.navigate", { url }, sessionId);
      let result: any;
      while (performance.now() - opened < timeoutMs + 30_000) {
        await Bun.sleep(500);
        const { result: value } = await cdp.send(
          "Runtime.evaluate",
          {
            expression: "JSON.stringify(window.__smoke ?? null)",
            returnByValue: true,
          },
          sessionId,
        );
        result = JSON.parse(value.value ?? "null");
        if (result) break;
      }
      const { result: canvasBox } = await cdp.send(
        "Runtime.evaluate",
        {
          expression:
            "JSON.stringify((()=>{const c=window.__handle?.canvas??document.getElementById('screen');const r=c.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})())",
          returnByValue: true,
        },
        sessionId,
      );
      const clip = JSON.parse(canvasBox.value);
      if (!(clip.width > 0 && clip.height > 0)) throw new Error("Emulator canvas has no visible screenshot region");
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip }, sessionId);
      const shotPath = join(screenshotDir, `${core}${threads ? "-threads" : ""}.png`);
      const png = Buffer.from(shot.data, "base64");
      await Bun.write(shotPath, png);
      let presentation;
      if (renderer === "gpu") {
        const pixels = await new Bun.Image(png).rgba();
        let lit = false;
        for (let i = 0; i < pixels.data.length; i += 4)
          if (pixels.data[i]! > 16 || pixels.data[i + 1]! > 16 || pixels.data[i + 2]! > 16) {
            lit = true;
            break;
          }
        presentation = {
          lit,
          hash: new Bun.CryptoHasher("sha256").update(pixels.data).digest("hex"),
          width: pixels.width,
          height: pixels.height,
          evidence: "cdp-canvas-screenshot-rgba",
        };
        if (result)
          Object.assign(result, {
            lit,
            hash: presentation.hash,
            ok:
              result.ok &&
              lit &&
              result.renderer === "wgpu30-dust" &&
              result.gpu2d_submitted_frames > 0 &&
              (!privateROM || result.gpu3d_submitted_frames > 0),
          });
      }
      if (privateROM && (await qualificationSHA256(privateROM.path)) !== privateROM.sha256)
        throw new Error("Private ROM changed during qualification");
      for (const [path, digest] of Object.entries(privateArtifacts))
        if ((await qualificationSHA256(join(dist, path))) !== digest)
          throw new Error(`Private qualification artifact changed: ${path}`);
      cdp.listeners.splice(cdp.listeners.indexOf(listener), 1);
      await cdp.send("Target.closeTarget", { targetId });
      const entry = {
        ...(result ?? { ok: false, error: "timeout" }),
        ok: result?.ok === true && logs.length === 0,
        browserLog: logs,
        browserStderr: browserStderrPath,
        screenshot: shotPath,
        testedAt: new Date().toISOString(),
        ...(privateROM
          ? {
              privateROM: { path: privateROM.path, sha256: privateROM.sha256 },
              artifacts: privateArtifacts,
              redistributable: false,
            }
          : {}),
        ...(presentation ? { presentation } : {}),
      };
      results[`${core}${threads ? ":threads" : ""}`] = entry;
      if (entry.ok && snapshot)
        await writeQualification(dist, snapshot, {
          ok: entry.ok,
          frames: entry.frames,
          lit: entry.lit,
          hash: entry.hash,
          errors: [...(entry.errors ?? []), ...logs],
          renderer: entry.renderer,
          gpu2d_submitted_frames: entry.gpu2d_submitted_frames ?? 0,
          gpu3d_submitted_frames: entry.gpu3d_submitted_frames ?? 0,
        });
      console.log(
        `${core}${threads ? " (threads)" : ""}: ${entry.ok ? "ok" : "FAIL"} frames=${entry.frames} hash=${entry.hash} lit=${entry.lit} ${entry.renderer ?? ""} first=${Math.round(entry.ms?.firstFrame ?? -1)}ms ${entry.error ?? ""}`,
      );
      await Bun.write(join(reportDir, "smoke.json"), `${JSON.stringify(results, null, 2)}\n`);
    }
    return results;
  } finally {
    cdp?.close();
    await cleanupBrowser?.();
    await stderrReader?.cancel().catch(() => {});
    await stderrDrain;
    await saveStderr();
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const cores = args.filter(a => !a.startsWith("--"));
  const selected = cores.length ? cores : ["dust-nds"];
  const timeoutArg = args.find(arg => arg.startsWith("--timeout-ms="));
  const rom = args.find(arg => arg.startsWith("--rom="))?.slice("--rom=".length);
  const renderer = args.find(arg => arg.startsWith("--renderer="))?.slice("--renderer=".length);
  if (renderer && renderer !== "gpu" && renderer !== "software") throw new Error("--renderer supports gpu or software");
  const results = await smoke(
    selected,
    args.includes("--threads"),
    timeoutArg ? Number(timeoutArg.split("=")[1]) : 90_000,
    { rom, renderer: renderer as "gpu" | "software" | undefined },
  );
  if (selected.some(core => (results[`${core}${args.includes("--threads") ? ":threads" : ""}`] as any)?.ok !== true))
    process.exitCode = 1;
}
