// SPDX-License-Identifier: MIT
// Port of upstream scripts/hero-tier.py: bake one blueprint's T3 hero, kit module -> GLB -> Blender -> cached hero GLB.
//
// Absence is data. Blender missing (or a host probe that says so) prints {"status":"unavailable"} and exits 0: the
// ceiling is then T2 and nothing is faked. A bake that runs past its time box is killed, its partial output deleted,
// and the run reports {"status":"timeout"}, also exit 0. The T1 GLB comes from the module itself: the Bun kit server
// in export mode (upstream's export-glb.js harness page) driven over CDP, so nothing is re-modelled. Blender runs the
// upstream bpy script templates/kits/blender/export-hero-tier.py, which is Blender's own Python, not a helper.
//
//   bun scripts/hero-tier.js --record knowledge.blueprint-timber-cottage --params '{"seed":1}' --out t3.glb
//
// The cache key is sha256(module bytes + params + bake settings)[:12], computed over the same canonical JSON as
// upstream, so a cache written by either implementation is a hit for the other.
// Exit codes: 0 produced, cached, unavailable, skipped or timed out · 1 Blender ran and failed · 2 usage.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { findExecutable, launch } from "@aphrody/chromium/chromium";
import { findBlender } from "./blender.ts";
import { CdpPage } from "./capture.ts";
import { type CatalogRecord, loadCatalog, lossless } from "./catalog.ts";
import { parse, UsageError } from "./commands.ts";
import { skillRoot } from "./paths.ts";
import { parseLossless, plain, PyFloat, pyDumps, pyFloatRepr, type PyValue, sha256 } from "./pyjson.ts";
import { kitUrl, serve } from "./server.ts";

const CACHE = ".cache/hero-tier";

/** json.dumps(value, sort_keys=True, separators=(",", ":")): ensure_ascii stays on, as upstream. */
const keyJson = (value: unknown) => pyDumps(value, { sortKeys: true, ensureAscii: true, separators: [",", ":"] });

const blenderScript = (skill: string) => join(skill, "templates/kits/blender/export-hero-tier.py");
/** The two files that decide what the bake looks like; editing either invalidates the cache. */
const pipelineFiles = (skill: string) => [blenderScript(skill), join(skill, "templates/kits/_harness/export-glb.js")];

/** The cache key: the module that draws it, the parameters, and how it was baked. */
export function paramsHash(module: Uint8Array, params: unknown, bake: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(module);
  hasher.update(keyJson(params));
  hasher.update(keyJson(bake));
  return hasher.digest("hex").slice(0, 12);
}

/** A digest of the scripts that shape the bake, so tuning one rebakes instead of caching. */
export function pipelineHash(skill: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of pipelineFiles(skill)) hasher.update(existsSync(path) ? readFileSync(path) : (path.split(/[\\/]/).pop() ?? ""));
  return hasher.digest("hex").slice(0, 12);
}

export function heroRecord(root: string, id: string): CatalogRecord {
  const record = loadCatalog(root, "knowledge").records.find(r => r.id === id);
  if (!record || record.knowledge_kind !== "blueprint") throw new UsageError(`${id}: unknown blueprint record`);
  return record;
}

/** An output either lands in the project or in its hero-tier cache. */
export function checkOutPath(out: string, project: string, cacheDir: string): string {
  const target = resolve(out);
  const within = (root: string) => {
    const rel = relative(resolve(root), target);
    return rel === "" || (!rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel));
  };
  if (!within(project) && !within(cacheDir)) throw new UsageError(`--out must stay inside ${project} or ${cacheDir}, not ${target}`);
  return target;
}

/** Build the record's module in headless Chromium through the kit server's export page and write its GLB. */
export async function exportT1(record: CatalogRecord, params: unknown, target: string, timeoutS: number): Promise<string> {
  const executable = findExecutable();
  if (!executable) throw new Error("no Chrome, Chromium or Edge to run the export page; pass --t1-glb instead");
  const server = await serve({ mode: "kit" });
  const browser = await launch({ executable, headless: true, webgpu: true, timeout: timeoutS * 1000 });
  try {
    const page = await CdpPage.open(browser, 640, 480);
    try {
      await page.goto(kitUrl(server.url, record.id, { export: "1", capture: "1", params: JSON.stringify(params) }), timeoutS * 1000);
      if (!(await page.waitFor("window.__kitExportReady === true", timeoutS * 1000))) throw new Error("export page never finished");
      const failure = await page.evaluate<string | null>("window.__kitExportError ?? null");
      if (failure) throw new Error(`export failed: ${failure.split("\n")[0]}`);
      const glb = await page.evaluate<string>("window.__kitGlb");
      await Bun.write(target, Buffer.from(glb, "base64"));
      return target;
    } finally {
      page.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
    server.stop();
  }
}

interface Bake {
  bake_size: number;
  ao_samples: number;
  ao_strength: PyFloat;
  quality: number;
  bevel_m: PyValue;
  seed: number;
  pipeline: string;
}

/** One Blender at a time, de-prioritised where `nice` exists, four threads, killed when the time box expires. */
export async function runBlender(
  binary: string,
  skill: string,
  source: string,
  target: string,
  bake: Bake,
  families: PyValue,
  timeoutS: number,
): Promise<{ status: "produced" | "failed" | "timeout"; detail: Record<string, unknown>; seconds: number }> {
  const number = (v: PyValue) => (v instanceof PyFloat ? pyFloatRepr(v.value) : String(v));
  const command = [
    ...(process.platform !== "win32" && Bun.which("nice") ? ["nice", "-n", "10"] : []),
    binary,
    "-b",
    "--factory-startup",
    "--python-exit-code",
    "1",
    "--threads",
    "4",
    "--python",
    blenderScript(skill),
    "--",
    "--in",
    source,
    "--out",
    target,
    "--families",
    keyJson(families),
    "--seed",
    String(bake.seed),
    "--bake-size",
    String(bake.bake_size),
    "--quality",
    String(bake.quality),
    "--ao-samples",
    String(bake.ao_samples),
    "--ao-strength",
    number(bake.ao_strength),
    "--bevel",
    number(bake.bevel_m),
  ];
  const started = performance.now();
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", windowsHide: true, detached: process.platform === "linux" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      // Linux: the whole process group, like upstream's killpg; elsewhere the Blender process itself.
      if (process.platform === "linux") process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }, timeoutS * 1000);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  const seconds = Math.round((performance.now() - started) / 10) / 100;
  if (timedOut) {
    rmSync(target, { force: true });
    return { status: "timeout", detail: {}, seconds };
  }
  const output = `${stdout}\n${stderr}`;
  if (code !== 0 || !existsSync(target)) {
    rmSync(target, { force: true });
    return { status: "failed", detail: { stderr: output.trim().split(/\r?\n/).slice(-6) }, seconds };
  }
  const line = stdout.split(/\r?\n/).find(l => l.startsWith("HERO "));
  return { status: "produced", detail: line ? (JSON.parse(line.slice(5)) as Record<string, unknown>) : {}, seconds };
}

export const HERO_TIER_HELP = `usage: hero-tier.js --record ID --out PATH [--params JSON] [--root DIR] [--skill DIR] [--cache-dir DIR]
                    [--t1-glb PATH] [--host host.json] [--timeout-s 120] [--bake-size 1024] [--ao-samples 64]
                    [--ao-strength 0.8] [--quality 85] [--bevel M] [--no-hero-tier]
Bake one blueprint's T3 hero: kit module -> GLB -> Blender -> cached hero GLB. Exit 0 produced, cached,
unavailable, skipped or timed out; 1 Blender failed; 2 usage.`;

export async function heroTier(argv: string[]): Promise<{ code: number; summary: Record<string, unknown> | string }> {
  const { values } = parse(argv, {
    record: { type: "string" },
    out: { type: "string" },
    params: { type: "string" },
    root: { type: "string" },
    skill: { type: "string" },
    "cache-dir": { type: "string" },
    "t1-glb": { type: "string" },
    host: { type: "string" },
    "timeout-s": { type: "string" },
    "bake-size": { type: "string" },
    "ao-samples": { type: "string" },
    "ao-strength": { type: "string" },
    quality: { type: "string" },
    bevel: { type: "string" },
    "no-hero-tier": { type: "boolean" },
  });
  if (values.help) return { code: 0, summary: HERO_TIER_HELP };
  if (!values.record || !values.out) throw new UsageError(HERO_TIER_HELP);
  const num = (name: string, fallback: number, integer = true) => {
    const raw = values[name as keyof typeof values] as string | undefined;
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw new UsageError(`--${name}: invalid value '${raw}'`);
    return n;
  };
  const project = resolve((values.root as string | undefined) ?? process.cwd());
  const skill = resolve((values.skill as string | undefined) ?? skillRoot());
  const cacheDir = resolve((values["cache-dir"] as string | undefined) ?? join(project, CACHE));
  const record = heroRecord(skill, values.record as string);
  const out = checkOutPath(values.out as string, project, cacheDir);
  let exactParams: PyValue;
  try {
    exactParams = values.params
      ? parseLossless(values.params as string)
      : Object.fromEntries(((lossless(record) as any).params as { name: string; default: PyValue }[]).map(p => [p.name, p.default]));
  } catch (error) {
    throw new UsageError(`--params: ${(error as Error).message}`);
  }
  const params = plain(exactParams) as Record<string, unknown>;
  const summary: Record<string, unknown> = { record: record.id, out, cache: "miss" };
  if (values["no-hero-tier"])
    return { code: 0, summary: { ...summary, status: "skipped", note: "--no-hero-tier: the ceiling stays at the highest runtime tier" } };
  const defaults = ((lossless(record) as any).defaults?.values ?? {}) as Record<string, PyValue>;
  const bake: Bake = {
    bake_size: num("bake-size", 1024),
    ao_samples: num("ao-samples", 64),
    ao_strength: new PyFloat(num("ao-strength", 0.8, false)),
    quality: num("quality", 85),
    bevel_m: values.bevel !== undefined ? new PyFloat(num("bevel", 0, false)) : (defaults.bevel_m ?? new PyFloat(0.012)),
    seed: Math.trunc(Number(params.seed ?? 1)),
    pipeline: pipelineHash(skill),
  };
  const module = join(skill, (record.asset as { path: string }).path);
  const digest = paramsHash(readFileSync(module), exactParams, bake);
  Object.assign(summary, { params_hash: digest, params, bake: plain(bake as unknown as PyValue) });
  const cached = join(cacheDir, `${digest}.glb`);
  if (existsSync(cached)) {
    mkdirSync(dirname(out), { recursive: true });
    if (resolve(cached) !== out) copyFileSync(cached, out);
    return { code: 0, summary: { ...summary, status: "cached", cache: "hit", bytes: statSync(out).size, seconds: 0 } };
  }
  const blender = values.host
    ? (() => {
        const found = (JSON.parse(readFileSync(values.host as string, "utf8")).blender ?? {}) as Record<string, unknown>;
        return { found: Boolean(found.found), path: (found.path as string) ?? null, version: (found.version as string) ?? null, source: "host probe file" };
      })()
    : await findBlender();
  if (!blender.found || !blender.path)
    return { code: 0, summary: { ...summary, status: "unavailable", blender: null, note: `no Blender: ${blender.source}; the ceiling stays at T2` } };
  const families = ((lossless(record) as any).tiers?.T2?.families ?? {}) as PyValue;
  const folder = mkdtempSync(join(tmpdir(), "viz3d-hero-"));
  try {
    const source = values["t1-glb"] ? resolve(values["t1-glb"] as string) : join(folder, "kit-t1.glb");
    const target = join(folder, "hero-t3.glb");
    try {
      if (!values["t1-glb"]) await exportT1(record, params, source, num("timeout-s", 120));
    } catch (error) {
      return { code: 0, summary: { ...summary, status: "unavailable", note: (error as Error).message } };
    }
    const { status, detail, seconds } = await runBlender(blender.path, skill, source, target, bake, families, num("timeout-s", 120));
    if (status === "produced") {
      mkdirSync(cacheDir, { recursive: true });
      copyFileSync(target, cached);
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(target, out);
    }
    Object.assign(summary, { status, seconds, blender: blender.version, detail });
    if (status === "produced") summary.bytes = statSync(out).size;
    return { code: status === "failed" ? 1 : 0, summary };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export async function heroTierCommand(argv: string[]): Promise<number> {
  try {
    const { code, summary } = await heroTier(argv);
    console.log(typeof summary === "string" ? summary : JSON.stringify(summary));
    return code;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Usage: ${error.message}`);
      return 2;
    }
    throw error;
  }
}
