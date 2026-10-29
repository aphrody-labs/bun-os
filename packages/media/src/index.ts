/**
 * @aphrody/media: Bun API over the `media-core` Rust crate. The crate is the only implementation
 * (decode, edit stack, resize, proxies, handoff); this module is the typed process boundary.
 * The binary is found via `MEDIA_CORE_BIN`, else `target/{release,debug}/media-core` of the repo.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type Filter = "box" | "bilinear" | "mitchell" | "lanczos3";
export type AiKind = "upscale" | "inpaint" | "remove_background" | "enhance";

export type Op =
  | { op: "crop"; x: number; y: number; w: number; h: number }
  | { op: "resize"; w: number; h: number; filter: Filter }
  | { op: "blur"; sigma_milli: number }
  | { op: "brightness"; delta: number }
  | { op: "contrast"; factor_milli: number }
  | { op: "grayscale" }
  | { op: "invert" }
  | { op: "flip_h" }
  | { op: "flip_v" }
  | { op: "rotate90" }
  | { op: "ai"; kind: AiKind; params: string };

export interface EditStack {
  ops: Op[];
}

export interface AssetMeta {
  id: { 0: string } | string;
  bytes: number;
  format: string;
  width: number;
  height: number;
  orientation: number | null;
}

export interface Handoff {
  from: string;
  to: string;
  asset: AssetMeta;
  path: string;
  stack: EditStack;
  frames: [number, number] | null;
}

export function binary(): string {
  const env = process.env.MEDIA_CORE_BIN;
  if (env) return env;
  const root = resolve(import.meta.dir, "../../..");
  const exe = process.platform === "win32" ? "media-core.exe" : "media-core";
  for (const profile of ["release", "debug"]) {
    const p = join(root, "target", profile, exe);
    if (existsSync(p)) return p;
  }
  throw new Error("media-core binary not found; run `cargo build -p media-core` or set MEDIA_CORE_BIN");
}

async function call<T>(args: string[]): Promise<T> {
  const proc = Bun.spawn([binary(), ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(err.trim() || `media-core exited with ${code}`);
  return JSON.parse(out) as T;
}

async function withStack<T>(stack: EditStack, f: (path: string) => Promise<T>): Promise<T> {
  const path = join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", `media-stack-${crypto.randomUUID()}.json`);
  await Bun.write(path, JSON.stringify(stack));
  try {
    return await f(path);
  } finally {
    await Bun.file(path)
      .delete()
      .catch(() => {});
  }
}

export const media = {
  probe: (file: string) => call<AssetMeta>(["probe", file]),
  render: (file: string, stack: EditStack, out: string) =>
    withStack(stack, p => call<{ out: string; width: number; height: number }>(["render", file, p, out])),
  proxy: (file: string, stack: EditStack, cacheDir: string, maxEdge: number) =>
    withStack(stack, p => call<{ path: string; hit: boolean }>(["proxy", file, p, cacheDir, String(maxEdge)])),
  send: (inbox: string, from: string, to: string, file: string, stack: EditStack, frames?: [number, number]) =>
    withStack(stack, p =>
      call<{ file: string }>(["send", inbox, from, to, file, p, ...(frames ? frames.map(String) : [])]),
    ),
  receive: (inbox: string, app: string) => call<Handoff | null>(["receive", inbox, app]),
};
