// SPDX-License-Identifier: Apache-2.0
// WinUI 3 / Windows App SDK facade: drives native/winui-host (.NET) over JSON lines.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type WinUIErrorCode = "ERR_WINUI_RUNTIME_NOT_FOUND" | "ERR_WINUI_HOST_NOT_BUILT" | "ERR_WINUI_HOST";

export class WinUIError extends Error {
  readonly code: WinUIErrorCode;
  constructor(code: WinUIErrorCode, message: string) {
    super(message);
    this.name = "WinUIError";
    this.code = code;
  }
}

// Windows App SDK line the host is built against (package Microsoft.WindowsAppSDK 2.6.4).
export const WINDOWS_APP_SDK_VERSION = "2.6.4";
export const WINDOWS_APP_RUNTIME_FRAMEWORK = "Microsoft.WindowsAppRuntime.2";
export const HOST_TFM = "net10.0-windows10.0.19041.0";

const hostProject = resolve(import.meta.dir, "../native/winui-host/winui-host.csproj");
export const defaultHostDir = (): string => process.env.WINUI_HOST_DIR ?? join(tmpdir(), "bun-winui-host");
const hostExePath = (dir: string) => join(dir, "winui-host.exe");

function versionAtLeast(v: string, min: number[]): boolean {
  const p = v.split(".").map(Number);
  for (let i = 0; i < min.length; i++) {
    const a = p[i] ?? 0;
    if (a !== min[i]) return a > min[i];
  }
  return true;
}

// Installed Microsoft.WindowsAppRuntime packages ("Name Version"); needs no host build.
export async function probe(): Promise<{ ok: boolean; reason?: string; packages: string[] }> {
  if (process.platform !== "win32") return { ok: false, reason: "not Windows", packages: [] };
  const script = "Get-AppxPackage -Name 'Microsoft.WindowsAppRuntime*' | ForEach-Object { $_.Name + ' ' + $_.Version }";
  let out = "";
  try {
    const p = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
      stdout: "pipe",
      stderr: "ignore",
    });
    out = await new Response(p.stdout).text();
    await p.exited;
  } catch (e) {
    return { ok: false, reason: `Get-AppxPackage failed: ${(e as Error).message}`, packages: [] };
  }
  const packages = [
    ...new Set(
      out
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean),
    ),
  ].sort();
  const [major, minor] = WINDOWS_APP_SDK_VERSION.split(".").map(Number);
  const ok = packages.some(line => {
    const [name, ver] = line.split(" ");
    return name === WINDOWS_APP_RUNTIME_FRAMEWORK && !!ver && versionAtLeast(ver, [major, minor]);
  });
  return ok
    ? { ok, packages }
    : { ok, reason: `${WINDOWS_APP_RUNTIME_FRAMEWORK} >= ${major}.${minor} not installed`, packages };
}

// dotnet publish (framework-dependent, unpackaged). Intermediate files go next to outDir, not in the repo.
export async function buildHost(outDir: string = defaultHostDir()): Promise<{ exe: string }> {
  const out = resolve(outDir);
  const obj = out + "-obj";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const p = Bun.spawn(
    [
      "dotnet",
      "publish",
      hostProject,
      "-c",
      "Release",
      "-r",
      `win-${arch}`,
      "--self-contained",
      "false",
      "-o",
      out,
      `-p:BaseIntermediateOutputPath=${obj}\\`,
      `-p:Platform=${arch}`,
      "-nologo",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [so, se, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new WinUIError("ERR_WINUI_HOST", `dotnet publish failed (${code}):\n${so}\n${se}`.slice(-4000));
  return { exe: hostExePath(out) };
}

export function isHostBuilt(dir: string = defaultHostDir()): boolean {
  return existsSync(hostExePath(dir));
}

export type WinUIEvent = { event: string; name?: string; [k: string]: unknown };

export interface OpenOptions {
  title?: string;
  xaml: string;
  width?: number;
  height?: number;
  headless?: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class WinUIHost {
  #proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  #pending = new Map<number, Pending>();
  #events: WinUIEvent[] = [];
  #waiters: { match: (e: WinUIEvent) => boolean; resolve: (e: WinUIEvent) => void }[] = [];
  #listeners = new Set<(e: WinUIEvent) => void>();
  #nextId = 1;
  #closed: Promise<number>;

  private constructor(proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {
    this.#proc = proc;
    this.#pump();
    this.#closed = proc.exited.then(code => {
      for (const p of this.#pending.values()) p.reject(new WinUIError("ERR_WINUI_HOST", `host exited (${code})`));
      this.#pending.clear();
      return code;
    });
  }

  // Spawns the host and waits for its "ready" event.
  static async start(opts: { dir?: string } = {}): Promise<WinUIHost> {
    const dir = opts.dir ?? defaultHostDir();
    const exe = hostExePath(dir);
    if (!existsSync(exe)) {
      throw new WinUIError("ERR_WINUI_HOST_NOT_BUILT", `winui-host.exe not found in ${dir}; run buildHost()`);
    }
    const proc = Bun.spawn([exe], { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: false });
    const host = new WinUIHost(proc);
    const first = await Promise.race([
      host.waitEvent(e => e.event === "ready" || e.event === "error"),
      host.#closed.then(code => ({ event: "exit", code }) as WinUIEvent),
    ]);
    if (first.event !== "ready") {
      const code = first.code === 2 || first.event === "error" ? "ERR_WINUI_RUNTIME_NOT_FOUND" : "ERR_WINUI_HOST";
      throw new WinUIError(code, `host failed to start: ${JSON.stringify(first)}`);
    }
    return host;
  }

  async #pump() {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of this.#proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.#dispatch(line);
      }
    }
  }

  #dispatch(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.event === "string") {
      this.#events.push(msg);
      for (const l of this.#listeners) l(msg);
      this.#waiters = this.#waiters.filter(w => (w.match(msg) ? (w.resolve(msg), false) : true));
      return;
    }
    const p = this.#pending.get(msg.id);
    if (!p) return;
    this.#pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new WinUIError("ERR_WINUI_HOST", String(msg.error)));
  }

  onEvent(cb: (e: WinUIEvent) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  waitEvent(match: (e: WinUIEvent) => boolean, timeoutMs = 10_000): Promise<WinUIEvent> {
    const seen = this.#events.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new WinUIError("ERR_WINUI_HOST", "timed out waiting for event")), timeoutMs);
      this.#waiters.push({ match, resolve: e => (clearTimeout(t), res(e)) });
    });
  }

  send<T = unknown>(cmd: { op: string; [k: string]: unknown }, timeoutMs = 15_000): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((res, rej) => {
      const t = setTimeout(() => {
        this.#pending.delete(id);
        rej(new WinUIError("ERR_WINUI_HOST", `command ${cmd.op} timed out`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: v => (clearTimeout(t), res(v as T)),
        reject: e => (clearTimeout(t), rej(e)),
      });
      this.#proc.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
      this.#proc.stdin.flush();
    });
  }

  open(o: OpenOptions) {
    return this.send<{ headless: boolean }>({ op: "open", ...o });
  }
  get(name: string, property: string) {
    return this.send<unknown>({ op: "get", name, property });
  }
  set(name: string, property: string, value: unknown) {
    return this.send<null>({ op: "set", name, property, value });
  }
  click(name: string) {
    return this.send<null>({ op: "click", name });
  }
  async close() {
    try {
      await this.send({ op: "close" });
    } catch {}
    const t = setTimeout(() => this.#proc.kill(), 5_000);
    await this.#closed;
    clearTimeout(t);
  }

  async [Symbol.asyncDispose]() {
    if (this.#proc.exitCode === null) await this.close();
  }
}
