// SPDX-License-Identifier: MIT
// Port of upstream scripts/capture.py: capture screenshots of a locally served scene; records observations, never
// judges them. Playwright is replaced by the Bun OS CDP owner (@aphrody/chromium: Chrome, Chromium or Edge, headless,
// WebGPU on) and the Python static server by src/server.ts. `--kit <record-id>` serves one kit blueprint through
// the same server, which is upstream's kit-proof capture.
//
// Exit codes: 0 ok · 1 console or page errors · 2 usage · 3 no CDP browser · 4 ready-flag timeout ·
// 5 --expect-motion on two identical frames · 6 --expect-usable on a view the frame measurement flagged.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findExecutable, launch } from "@aphrody/chromium/chromium";

type ChromiumBrowser = Awaited<ReturnType<typeof launch>>;
import { parse, UsageError } from "./commands.ts";
import { sha256 } from "./pyjson.ts";
import { blueprint, kitUrl, type SceneServer, serve } from "./server.ts";
import { canvasRegion, type Evaluator, measurePng, type Region, THRESHOLDS, unusable, type ViewQuality } from "./view-quality.ts";

/** One ANGLE backend per platform for --gpu; the renderer that actually drew is always logged. */
export const ANGLE_ARGS: Record<string, string[]> = {
  darwin: ["--use-angle=metal"],
  linux: ["--use-angle=gl", "--ignore-gpu-blocklist"],
  win32: ["--use-angle=d3d11"],
};

/** WEBGL_debug_renderer_info is the only way to read the driver string the page actually got. */
const RENDERER_JS = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
})()`;

/** The page's WebGPU adapter, when it has one. */
const WEBGPU_JS = `(async () => {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return null;
  const info = adapter.info || {};
  return { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '',
           fallback: Boolean(adapter.isFallbackAdapter || info.isFallbackAdapter) };
})()`;

export function captureMode(renderer: string | null): "unknown" | "swiftshader" | "gpu" {
  if (!renderer) return "unknown";
  return /swiftshader/i.test(renderer) ? "swiftshader" : "gpu";
}

export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "target";

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** A flattened CDP page session with the handful of operations a capture needs. */
export class CdpPage implements Evaluator {
  consoleErrors: string[] = [];
  pageErrors: string[] = [];
  private off: (() => void)[] = [];

  private constructor(
    private readonly browser: ChromiumBrowser,
    private readonly sessionId: string,
    readonly targetId: string,
  ) {}

  static async open(browser: ChromiumBrowser, width: number, height: number): Promise<CdpPage> {
    const { targetId } = await browser.connection.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.connection.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new CdpPage(browser, sessionId, targetId);
    const on = (event: string, fn: (p: any) => void) =>
      page.off.push(browser.connection.on(event, (params, sid) => sid === sessionId && fn(params)));
    on("Runtime.consoleAPICalled", p => {
      if (p.type === "error")
        page.consoleErrors.push((p.args ?? []).map((a: any) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" "));
    });
    on("Runtime.exceptionThrown", p => {
      const d = p.exceptionDetails ?? {};
      page.pageErrors.push(d.exception?.description ?? d.text ?? "exception");
    });
    on("Log.entryAdded", p => {
      if (p.entry?.level === "error" && p.entry.source !== "violation") page.consoleErrors.push(p.entry.text);
    });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.browser.connection.send<T>(method, params, this.sessionId);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: any }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluation failed");
    return r.result.value as T;
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    const loaded = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`navigation timed out: ${url}`)), timeoutMs);
      const off = this.browser.connection.on("Page.loadEventFired", (_p, sid) => {
        if (sid !== this.sessionId) return;
        clearTimeout(timer);
        off();
        done();
      });
    });
    const r = await this.send<{ errorText?: string }>("Page.navigate", { url });
    if (r.errorText) throw new Error(`navigation failed: ${r.errorText}`);
    await loaded;
  }

  async waitFor(expression: string, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return true;
      await Bun.sleep(50);
    }
    return false;
  }

  async screenshot(format: "png" | "jpeg", quality?: number, fullPage = false): Promise<Uint8Array> {
    const params: Record<string, unknown> = { format };
    if (format === "jpeg" && quality !== undefined) params.quality = quality;
    if (fullPage) {
      const metrics = await this.send<{ cssContentSize: { width: number; height: number } }>("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 };
    }
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", params);
    return Buffer.from(data, "base64");
  }

  /** Wait for the selector, scroll it into view and click its centre with real input events. */
  async click(selector: string, timeoutMs: number): Promise<void> {
    const box = JSON.stringify(selector);
    const found = await this.waitFor(`document.querySelector(${box})`, timeoutMs);
    if (!found) throw new Error(`no element matches ${selector}`);
    const point = await this.evaluate<{ x: number; y: number }>(`(() => {
      const el = document.querySelector(${box}); el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await this.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }

  close(): void {
    for (const off of this.off) off();
  }
}

export interface CaptureArgs {
  directory?: string;
  url?: string;
  kit?: string;
  kitTier?: string;
  kitParams?: string;
  kitBackend?: "auto" | "webgl2";
  path: string;
  out: string;
  views: string[];
  allViews: boolean;
  clicks: string[];
  width: number;
  height: number;
  readyFlag: string;
  settleMs: number;
  motionCheck: number;
  expectMotion: boolean;
  expectUsable: boolean;
  timeoutS: number;
  allowConsoleErrors: boolean;
  fullPage: boolean;
  query: string;
  gpu: boolean;
  format: "png" | "jpeg";
  quality?: number;
  executable?: string;
}

export const CAPTURE_HELP = `usage: capture.js (--dir DIR [--path REL/] [--query K=V] | --url URL | --kit RECORD-ID [--tier T1|T2|T3]
                  [--params JSON] [--backend auto|webgl2]) [--out captures] [--view NAME]... [--all-views]
                  [--click CSS]... [--width 1280] [--height 720] [--ready-flag __sceneReady|none] [--settle-ms 300]
                  [--motion-check MS [--expect-motion]] [--expect-usable] [--timeout-s 30] [--allow-console-errors]
                  [--full-page] [--gpu] [--format png|jpeg] [--quality N] [--browser PATH]
Capture screenshots of a locally served scene through headless Chrome, Chromium or Edge (CDP); records
observations, never judges them. Exit: 0 ok, 1 console/page errors, 2 usage, 3 no browser, 4 ready timeout,
5 frozen with --expect-motion, 6 unusable view with --expect-usable.`;

export function parseCaptureArgs(argv: string[]): CaptureArgs | null {
  const { values } = parse(argv, {
    dir: { type: "string" },
    url: { type: "string" },
    kit: { type: "string" },
    tier: { type: "string" },
    params: { type: "string" },
    backend: { type: "string" },
    path: { type: "string" },
    out: { type: "string" },
    view: { type: "string", multiple: true },
    "all-views": { type: "boolean" },
    click: { type: "string", multiple: true },
    width: { type: "string" },
    height: { type: "string" },
    "ready-flag": { type: "string" },
    "settle-ms": { type: "string" },
    "motion-check": { type: "string" },
    "expect-motion": { type: "boolean" },
    "expect-usable": { type: "boolean" },
    "timeout-s": { type: "string" },
    "allow-console-errors": { type: "boolean" },
    "full-page": { type: "boolean" },
    query: { type: "string" },
    gpu: { type: "boolean" },
    format: { type: "string" },
    quality: { type: "string" },
    browser: { type: "string" },
  });
  if (values.help) return null;
  const int = (name: string, fallback: number) => {
    const raw = values[name as keyof typeof values] as string | undefined;
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new UsageError(`--${name}: invalid int value '${raw}'`);
    return n;
  };
  const format = (values.format as string | undefined) ?? "png";
  if (format !== "png" && format !== "jpeg") throw new UsageError("--format: choose from png, jpeg");
  const backend = (values.backend as string | undefined) ?? "auto";
  if (backend !== "auto" && backend !== "webgl2") throw new UsageError("--backend: choose from auto, webgl2");
  const quality = values.quality === undefined ? undefined : int("quality", 0);
  return {
    directory: values.dir as string | undefined,
    url: values.url as string | undefined,
    kit: values.kit as string | undefined,
    kitTier: values.tier as string | undefined,
    kitParams: values.params as string | undefined,
    kitBackend: backend,
    path: (values.path as string | undefined) ?? "",
    out: (values.out as string | undefined) ?? "captures",
    views: (values.view as string[] | undefined) ?? [],
    allViews: Boolean(values["all-views"]),
    clicks: (values.click as string[] | undefined) ?? [],
    width: int("width", 1280),
    height: int("height", 720),
    readyFlag: (values["ready-flag"] as string | undefined) ?? "__sceneReady",
    settleMs: int("settle-ms", 300),
    motionCheck: int("motion-check", 0),
    expectMotion: Boolean(values["expect-motion"]),
    expectUsable: Boolean(values["expect-usable"]),
    timeoutS: int("timeout-s", 30),
    allowConsoleErrors: Boolean(values["allow-console-errors"]),
    fullPage: Boolean(values["full-page"]),
    query: (values.query as string | undefined) ?? "",
    gpu: Boolean(values.gpu),
    format,
    quality,
    executable: values.browser as string | undefined,
  };
}

/** Validate the target: exactly one of --dir, --url or --kit, and a relative page path without traversal. */
export function resolveTarget(args: CaptureArgs): void {
  const targets = [args.directory, args.url, args.kit].filter(Boolean).length;
  if (targets !== 1) throw new UsageError("Pass exactly one of --dir, --url or --kit");
  if (!args.directory && args.path) throw new UsageError("--path is only valid with --dir");
  if (!args.kit && (args.kitTier || args.kitParams)) throw new UsageError("--tier and --params are only valid with --kit");
  if (args.directory) {
    const p = args.path;
    if (p.startsWith("/") || p.includes("\\") || p.split("/").includes("..") || p.includes("?") || p.includes("#"))
      throw new UsageError("--path must be a relative URL path without traversal, query or fragment");
    let page = join(args.directory, ...p.split("/").filter(Boolean));
    if (p.endsWith("/") || !/\.[^/]+$/.test(p)) page = join(page, "index.html");
    if (!Bun.file(page).size) throw new UsageError(`No page for --path ${p || "/"} in ${args.directory}`);
  }
  if (args.kit) {
    try {
      blueprint(args.kit);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    if (args.kitParams) {
      try {
        JSON.parse(args.kitParams);
      } catch {
        throw new UsageError("--params must be a JSON object");
      }
    }
  }
}

/** The served directory as written to the log: relative to the working directory, never an absolute home path. */
function loggedDir(directory: string | undefined): string | null {
  if (!directory) return null;
  const rel = relative(process.cwd(), resolve(directory)).replaceAll("\\", "/");
  return /^[a-zA-Z]:/.test(rel) ? (resolve(directory).split(/[\\/]/).pop() ?? null) : rel || ".";
}

export interface CaptureResult {
  status: number;
  log: Record<string, any>;
  message: string;
}

export async function capture(args: CaptureArgs): Promise<CaptureResult> {
  resolveTarget(args);
  const executable = args.executable ?? findExecutable();
  if (!executable) return { status: 3, log: {}, message: "No Chrome, Chromium or Edge found. Set BUN_CHROMIUM_PATH or pass --browser." };
  let server: SceneServer | null = null;
  let url = args.url ?? "";
  if (args.directory) {
    server = await serve({ mode: "dir", dir: args.directory });
    url = server.url + encodeURI(args.path.replace(/^\/+/, "")) + (args.query ? `?${args.query.replace(/^\?/, "")}` : "");
  } else if (args.kit) {
    server = await serve({ mode: "kit" });
    url = kitUrl(server.url, args.kit, {
      capture: "1",
      tier: args.kitTier,
      params: args.kitParams,
      backend: args.kitBackend === "webgl2" ? "webgl2" : undefined,
    });
  }
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const log: Record<string, any> = {
    url,
    dir: loggedDir(args.directory),
    kit: args.kit ?? null,
    viewport: { width: args.width, height: args.height },
    ready_flag: args.readyFlag,
    ready_timeout: false,
    motion: null,
    gpu_requested: args.gpu,
    capture_mode: "unknown",
    webgl_renderer: null,
    webgpu_adapter: null,
    scene_backend: null,
    image_format: args.format,
    views: [],
    clicks: [],
    unusable_views: [],
    view_quality_thresholds: THRESHOLDS,
    measured_region: null,
    console_errors: [],
    page_errors: [],
    started: now(),
    finished: null,
    browser: null,
  };
  let status = 0;
  let browser: ChromiumBrowser | null = null;
  let page: CdpPage | null = null;
  try {
    browser = await launch({
      executable,
      headless: true,
      webgpu: true,
      timeout: args.timeoutS * 1000,
      args: [...(args.gpu ? (ANGLE_ARGS[process.platform] ?? []) : []), "--hide-scrollbars", "--mute-audio"],
    });
    log.browser = ((await browser.connection.send<{ product: string }>("Browser.getVersion")) ?? {}).product ?? null;
    page = await CdpPage.open(browser, args.width, args.height);
    const shoot = async (name: string) => {
      const bytes = await page!.screenshot(args.format, args.quality, args.fullPage);
      const file = `${name}.${args.format === "jpeg" ? "jpg" : "png"}`;
      writeFileSync(join(out, file), bytes);
      return { entry: { name, file, sha256: sha256(bytes) } as Record<string, any>, bytes };
    };
    const measure = async (bytes: Uint8Array): Promise<ViewQuality> => {
      const png = args.format === "png" ? bytes : await page!.screenshot("png", undefined, args.fullPage);
      return measurePng(page!, png, log.measured_region as Region | null);
    };
    status = await (async () => {
      await page!.goto(url, args.timeoutS * 1000);
      // Read the renderer before the ready wait, so even a scene that never becomes ready says what it failed on.
      log.webgl_renderer = await page!.evaluate<string | null>(RENDERER_JS).catch(() => null);
      log.capture_mode = captureMode(log.webgl_renderer);
      log.webgpu_adapter = await page!.evaluate(WEBGPU_JS).catch(() => null);
      if (args.readyFlag !== "none") {
        if (!(await page!.waitFor(`window.${args.readyFlag} === true`, args.timeoutS * 1000))) {
          log.ready_timeout = true;
          return 4;
        }
      }
      await Bun.sleep(args.settleMs);
      log.scene_backend = await page!.evaluate<string | null>("window.__kitInfo?.backend ?? null").catch(() => null);
      if (args.kit) log.kit_info = await page!.evaluate("window.__kitInfo ?? null").catch(() => null);
      log.measured_region = await canvasRegion(page!);
      const first = await shoot("default");
      first.entry.view_quality = await measure(first.bytes);
      log.views.push(first.entry);
      if (args.motionCheck) {
        await Bun.sleep(args.motionCheck);
        const after = await shoot("default-motion");
        after.entry.view_quality = await measure(after.bytes);
        log.views.push(after.entry);
        log.motion = {
          interval_ms: args.motionCheck,
          differs: first.entry.sha256 !== after.entry.sha256,
          sha_before: first.entry.sha256,
          sha_after: after.entry.sha256,
        };
      }
      const names = [...args.views];
      if (args.allViews) {
        for (const n of await page!.evaluate<string[]>("window.__viewer?.views ?? []")) if (!names.includes(n)) names.push(n);
      }
      for (const name of names) {
        const applied = await page!.evaluate<boolean>(`Boolean(window.__viewer && window.__viewer.setView(${JSON.stringify(name)}))`);
        await Bun.sleep(args.settleMs);
        const shot = await shoot(slug(name));
        shot.entry.requested = name;
        shot.entry.applied = applied;
        shot.entry.view_quality = await measure(shot.bytes);
        log.views.push(shot.entry);
      }
      for (const [index, selector] of args.clicks.entries()) {
        await page!.click(selector, args.timeoutS * 1000);
        await Bun.sleep(args.settleMs);
        const shot = await shoot(`click-${index}-${slug(selector)}`);
        log.clicks.push({ selector, file: shot.entry.file, sha256: shot.entry.sha256 });
      }
      return 0;
    })();
  } finally {
    if (page) {
      log.console_errors = page.consoleErrors;
      log.page_errors = page.pageErrors;
      page.close();
    }
    await browser?.close().catch(() => undefined);
    server?.stop();
  }
  log.finished = now();
  // default-motion is the default view again; gating it would charge the same frame twice.
  log.unusable_views = unusable(log.views.filter((v: any) => v.name !== "default-motion"));
  writeFileSync(join(out, "capture-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  const errors = [...log.console_errors, ...log.page_errors];
  if (status === 4) return { status, log, message: `Ready flag window.${args.readyFlag} never became true` };
  if (errors.length && !args.allowConsoleErrors)
    return { status: 1, log, message: `${errors.length} console or page errors; see ${join(out, "capture-log.json")}` };
  if (log.motion && args.expectMotion && !log.motion.differs)
    return { status: 5, log, message: `Frames ${log.motion.interval_ms} ms apart are identical; the scene is frozen` };
  if (log.unusable_views.length && args.expectUsable)
    return { status: 6, log, message: `unusable views: ${JSON.stringify(log.unusable_views)}` };
  return {
    status,
    log,
    message:
      `${log.views.length} view captures, ${log.clicks.length} click captures in ${out}; capture_mode ${log.capture_mode} ` +
      `(${log.webgl_renderer ?? "no WebGL2 context"})${log.scene_backend ? `; scene backend ${log.scene_backend}` : ""}`,
  };
}

export async function captureCommand(argv: string[]): Promise<number> {
  let args: CaptureArgs | null;
  try {
    args = parseCaptureArgs(argv);
    if (!args) {
      console.log(CAPTURE_HELP);
      return 0;
    }
    const result = await capture(args);
    if (result.log.motion) console.log(`motion: ${JSON.stringify(result.log.motion)}`);
    (result.status === 0 ? console.log : console.error)(result.message);
    return result.status;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Usage: ${error.message}`);
      return 2;
    }
    throw error;
  }
}
