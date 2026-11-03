// SPDX-License-Identifier: MIT
// Port of upstream scripts/host-probe.py: discover host tools and recommend available shipped-kit pipelines,
// without grading art. Read-only: a fixed allow-list of commands, no shell, a 5 s limit each; installs nothing,
// downloads nothing and writes exactly one file (--out). A probe that fails becomes found: false with the command
// named as its source; absence is data, so the exit status is always 0. Bun OS reads the browser the capture
// command drives (Chrome, Chromium or Edge over CDP, @aphrody/chromium) instead of a Playwright install.
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, release, totalmem } from "node:os";
import { basename, dirname } from "node:path";
import { findExecutable } from "@aphrody/chromium/chromium";
import { type BlenderFound, findBlender } from "./blender.ts";
import { parse } from "./commands.ts";

export const SCHEMA_VERSION = 1;
const TIMEOUT_MS = 5000;
const SYSTEM: Record<string, string> = { darwin: "Darwin", linux: "Linux", win32: "Windows" };

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** stdout of a fixed command, or null when it is missing, slow or unhappy. Never throws. */
export async function run(command: string[], timeoutMs = TIMEOUT_MS): Promise<string | null> {
  if (!Bun.which(command[0]!)) return null;
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore", timeout: timeoutMs, windowsHide: true });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

const firstLine = (text: string | null) => (text ? (text.split(/\r?\n/)[0]?.trim() ?? null) : null);

export interface Gpu {
  found: boolean;
  name?: string | null;
  vendor?: string | null;
  cores?: number | null;
  source: string;
}

async function gpuDarwin(): Promise<Gpu> {
  const source = "system_profiler SPDisplaysDataType -json";
  try {
    const cards = JSON.parse((await run(["system_profiler", "SPDisplaysDataType", "-json"])) ?? "").SPDisplaysDataType;
    if (!cards?.length) return { found: false, source: `${source} listed no display device` };
    const card = cards[0];
    const cores = String(card.sppci_cores ?? "");
    return {
      found: true,
      name: card.sppci_model ?? card._name,
      vendor: card.spdisplays_vendor ?? null,
      cores: /^\d+$/.test(cores) ? Number(cores) : null,
      source,
    };
  } catch {
    return { found: false, source: `${source} unavailable` };
  }
}

async function gpuLinux(): Promise<Gpu> {
  const name = firstLine(await run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]));
  if (name) return { found: true, name, vendor: "NVIDIA", cores: null, source: "nvidia-smi --query-gpu=name" };
  const line = ((await run(["lspci"])) ?? "").split("\n").find(l => l.toUpperCase().includes("VGA"));
  if (line) return { found: true, name: line.split(": ").slice(1).join(": ").trim() || line, vendor: null, cores: null, source: "lspci (VGA lines)" };
  return { found: false, source: "nvidia-smi and lspci unavailable" };
}

/** Display adapters from the registry display class (wmic is gone from current Windows builds). */
async function gpuWindows(): Promise<Gpu> {
  const key = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
  const text = await run(["reg", "query", key, "/s", "/v", "DriverDesc"]);
  const names = [...(text ?? "").matchAll(/DriverDesc\s+REG_SZ\s+(.+)/g)].map(m => m[1]!.trim());
  const name = names.find(n => !/basic (display|render)|virtual|remote/i.test(n)) ?? names[0];
  if (name) return { found: true, name, vendor: null, cores: null, source: "reg query <display class> /s /v DriverDesc" };
  return { found: false, source: "reg query <display class> unavailable" };
}

export function gpuInfo(system: string): Promise<Gpu> {
  if (system === "Darwin") return gpuDarwin();
  if (system === "Linux") return gpuLinux();
  if (system === "Windows") return gpuWindows();
  return Promise.resolve({ found: false, source: `no GPU probe for ${system}` });
}

/** The CDP browser the capture command drives. Its path is not reported: it may contain the home directory. */
export function browserInfo() {
  const executable = (() => {
    try {
      return findExecutable();
    } catch {
      return null;
    }
  })();
  if (!executable) return { found: false, name: null, source: "no Chrome, Chromium or Edge on BUN_CHROMIUM_PATH, PATH or install paths" };
  const name = basename(executable).replace(/\.exe$/i, "");
  const kind = /msedge/i.test(name) ? "edge" : /chromium/i.test(executable) ? "chromium" : "chrome";
  return { found: true, name: kind, source: "@aphrody/chromium findExecutable" };
}

/** Legacy kit-pipeline recommendation, not a limit on custom or external asset quality. */
export function ceiling(blender: BlenderFound): [string, string] {
  if (blender.found && blender.meets_minimum) return ["T3", `Blender ${blender.version} >= 4.2 found via ${blender.source}`];
  if (blender.found) return ["T2", `Blender ${blender.version} is older than 4.2 LTS, so the T3 bake pipeline is not supported`];
  return ["T2", `no runnable Blender (${blender.source}), so no T3 bake`];
}

/**
 * The renderer a capture is expected to get. Headless Chromium draws WebGL with SwiftShader unless an ANGLE GPU
 * backend is requested (capture --gpu); the capture log records the renderer that actually drew either way.
 */
export function captureMode(system: string, hasBrowser: boolean): [string, string] {
  if (!hasBrowser) return ["unavailable", "no CDP browser was found, so no automated capture"];
  return [
    "swiftshader",
    `${system}: headless capture defaults to the software renderer; --gpu requests the ANGLE backend ` +
      "and the capture log names the renderer that actually drew",
  ];
}

export async function probe(platform = process.platform) {
  const system = SYSTEM[platform] ?? platform;
  const blender = await findBlender();
  const [quality, qualityReason] = ceiling(blender);
  const browser = browserInfo();
  const [mode, modeReason] = captureMode(system, browser.found);
  const memory = totalmem();
  return {
    schema_version: SCHEMA_VERSION,
    probed_at: now(),
    os: { system, release: release(), product_version: system === "Darwin" ? firstLine(await run(["sw_vers", "-productVersion"])) : null, arch: arch() },
    cpu: { brand: cpus()[0]?.model?.trim() ?? null, logical_cores: cpus().length },
    memory_gb: memory ? Math.round((memory / 1024 ** 3) * 10) / 10 : null,
    gpu: await gpuInfo(system),
    blender,
    runtimes: {
      bun: Bun.version,
      bun_revision: Bun.revision.slice(0, 9),
      node: firstLine(await run(["node", "--version"]))?.replace(/^v/, "") ?? null,
      browser,
    },
    quality_ceiling: quality,
    quality_ceiling_reason: qualityReason,
    quality_ceiling_scope: "shipped-kit-pipelines",
    quality_note:
      "Tool discovery does not grade art, constrain custom/sourced geometry, " +
      "or prove that a bake, render or scientific model was executed.",
    capture_mode_expected: mode,
    capture_mode_reason: modeReason,
  };
}

export const HOST_PROBE_HELP = `usage: host-probe.js [--out host.json]
Discover host tools and recommend available shipped-kit pipelines, without grading art.`;

export async function hostProbeCommand(argv: string[]) {
  const { values } = parse(argv, { out: { type: "string" } });
  if (values.help) return HOST_PROBE_HELP;
  const report = await probe();
  if (values.out) {
    mkdirSync(dirname(values.out as string), { recursive: true });
    writeFileSync(values.out as string, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
