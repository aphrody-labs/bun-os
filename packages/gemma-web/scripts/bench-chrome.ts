// SPDX-License-Identifier: Apache-2.0
// Headless Chrome benchmark over CDP: load time, TTFT, decode tokens/s, peak process-tree RSS and GPU memory.
// Usage: bun scripts/bench-chrome.ts [--model-dir DIR] [--ep webgpu|wasm] [--max-tokens N] [--chrome PATH]
//        [--swiftshader] [--profile DIR] [--prompt TEXT] [--json out.json]
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./serve";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (k: string) => args.includes(k);

const dist = join(import.meta.dir, "..", "dist", "web");
const modelDir = opt("--model-dir", process.env["GEMMA_MODEL_DIR"]);
if (!modelDir || !existsSync(modelDir)) throw new Error("--model-dir (or GEMMA_MODEL_DIR) must point at the ONNX repo snapshot");
const ep = (opt("--ep", "webgpu") as "webgpu" | "wasm") ?? "webgpu";
const maxTokens = Number(opt("--max-tokens", "64"));
const prompt = opt("--prompt", "Explain in two sentences why the sky is blue.")!;

function findChrome(): string {
  const c = [
    opt("--chrome"),
    process.env["CHROME_PATH"],
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean) as string[];
  const f = c.find((p) => existsSync(p));
  if (!f) throw new Error("no Chrome/Chromium found; pass --chrome");
  return f;
}

async function sh(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const t = await new Response(p.stdout).text();
  await p.exited;
  return t;
}

/** Sum of resident memory over a process tree, MiB. */
async function treeRssMiB(root: number): Promise<number> {
  if (process.platform === "win32") {
    const ps = `$ids=@(${root});$all=Get-CimInstance Win32_Process;$i=0;while($i -lt $ids.Count){$ids+=@($all|?{$_.ParentProcessId -eq $ids[$i]}|%{$_.ProcessId});$i++};[int]((Get-Process -Id $ids -ErrorAction SilentlyContinue|Measure-Object WorkingSet64 -Sum).Sum/1MB)`;
    return Number((await sh(["powershell", "-NoProfile", "-Command", ps])).trim()) || 0;
  }
  const out = await sh(["sh", "-c", `ps -eo pid,ppid,rss | awk -v r=${root} '{p[$1]=$2;m[$1]=$3} END{for(i in p){x=i;while(x&&x!=r)x=p[x];if(x==r)s+=m[i]};print s/1024}'`]);
  return Number(out.trim()) || 0;
}

async function gpuUsedMiB(): Promise<number | undefined> {
  try {
    const t = await sh(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
    const n = Number(t.trim().split("\n")[0]);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

const server = serve({ dist, modelDir, port: Number(opt("--port", "0")) });
// --profile DIR keeps the Chrome profile (and so the OPFS shard cache) between runs: cold vs warm load.
const userData = opt("--profile") ?? mkdtempSync(join(tmpdir(), "gemma-chrome-"));
try { unlinkSync(join(userData, "DevToolsActivePort")); } catch {}
const flags = [
  "--headless=new",
  `--user-data-dir=${userData}`,
  "--remote-debugging-port=0",
  "--no-first-run",
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan,WebGPU",
  "--ignore-gpu-blocklist",
  "--enable-precise-memory-info",
  "--js-flags=--max-old-space-size=4096",
  ...(flag("--swiftshader") ? ["--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] : []),
  "about:blank",
];
const chrome = Bun.spawn([findChrome(), ...flags], { stdout: "ignore", stderr: "ignore" });

async function devtoolsUrl(): Promise<string> {
  const f = join(userData, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(f)) {
      const [port] = readFileSync(f, "utf8").split("\n");
      const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      return ((await r.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    }
    await Bun.sleep(100);
  }
  throw new Error("Chrome did not expose DevTools");
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map<number, (v: any) => void>();
const logs: string[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) pending.get(m.id)!(m);
  else if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  else if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((res) => {
    const id = ++nextId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr: string) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: `http://localhost:${server.port}/?model=/model` });
await Bun.sleep(1500);

const result: Record<string, unknown> = { chrome: findChrome(), ep, prompt, maxTokens };
const gpuBase = await gpuUsedMiB();
let peakRss = 0;
let peakGpu = gpuBase ?? 0;
const sampler = setInterval(async () => {
  peakRss = Math.max(peakRss, await treeRssMiB(chrome.pid));
  const g = await gpuUsedMiB();
  if (g !== undefined) peakGpu = Math.max(peakGpu, g);
}, 1000);

try {
  result["device"] = await evalJs("gemma.device()");
  const t0 = performance.now();
  result["load"] = await evalJs(`gemma.load({decoderEp:${JSON.stringify(ep)}})`);
  result["loadWallMs"] = performance.now() - t0;
  const chat: any = await evalJs(
    `gemma.chat({prompt:${JSON.stringify(prompt)},maxTokens:${maxTokens},seed:1,temperature:0})`,
  );
  result["chat"] = chat;
  // second run, warm: steady-state numbers
  result["chatWarm"] = await evalJs(
    `gemma.chat({prompt:${JSON.stringify(prompt)},maxTokens:${maxTokens},seed:1,temperature:0})`,
  );
} catch (e) {
  result["error"] = String(e);
} finally {
  clearInterval(sampler);
  result["peakTreeRssMiB"] = Math.round(peakRss);
  if (gpuBase !== undefined) {
    result["gpuBaselineMiB"] = gpuBase;
    result["gpuPeakDeltaMiB"] = peakGpu - gpuBase;
  }
  result["console"] = logs.slice(-30);
  if (process.platform === "win32") await sh(["taskkill", "/T", "/F", "/PID", String(chrome.pid)]);
  else chrome.kill();
  server.stop(true);
}
const json = JSON.stringify(result, null, 2);
console.log(json);
const outFile = opt("--json");
if (outFile) writeFileSync(outFile, json);
process.exit(result["error"] ? 1 : 0);
