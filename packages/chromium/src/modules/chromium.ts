// SPDX-License-Identifier: MIT
/* oxlint-disable no-control-regex -- Profile names reject raw control characters. */
// bun:chromium (and bun:chrome) of the aphrody-labs/bun fork on upstream Bun: a Chromium CDP client,
// launcher, profile reader and web-app planner. Process groups use Linux pidfds through bun:ffi
// (./pidfd.ts) and Windows job objects through bun:windows when that plugin is registered.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import manifests from "./chrome-manifests.ts";
import { linuxProcessGroup, windowsJob } from "./process.ts";

type Options = { timeout?: number; signal?: AbortSignal };
type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Listener = (params: Record<string, unknown>, sessionId?: string) => void;

function timeoutValue(value: number | undefined): number {
  const result = value ?? 10000;
  if (!Number.isSafeInteger(result) || result < 1 || result > 2147483647)
    throw new RangeError("timeout must be an integer from 1 to 2147483647 milliseconds");
  return result;
}

function endpointURL(endpoint: string, discovery = false): string {
  const url = new URL(endpoint);
  if (
    !(discovery ? ["ws:", "wss:", "http:", "https:"] : ["ws:", "wss:"]).includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new TypeError("CDP endpoint must be a loopback debugging URL without credentials or fragment");
  return url.href;
}

function validateURL(value: string): string {
  if (value === "about:blank") return value;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("navigation URL must use HTTP(S) without credentials, or about:blank");
  return url.href;
}

class ChromiumConnection {
  #socket: WebSocket;
  #timeout: number;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<Listener>>();
  #closed = false;
  #removeAbort: (() => void) | undefined;

  constructor(socket: WebSocket, timeout: number, signal?: AbortSignal) {
    this.#socket = socket;
    this.#timeout = timeout;
    socket.addEventListener("message", event => this.#message(event));
    socket.addEventListener("close", () => this.close());
    socket.addEventListener("error", () => this.close());
    if (signal) {
      const abort = () => this.close();
      signal.addEventListener("abort", abort, { once: true });
      this.#removeAbort = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) this.close();
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  async gpu(sessionId: string) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("gpu requires an attached target sessionId");
    const response = await this.send<any>(
      "Runtime.evaluate",
      {
        expression: `(async () => {
        if (!navigator.gpu) return { available: false, adapter: false, fallback: null, info: null };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { available: true, adapter: false, fallback: null, info: null };
        const info = adapter.info;
        return { available: true, adapter: true,
          fallback: typeof info?.isFallbackAdapter === "boolean" ? info.isFallbackAdapter : null,
          info: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null };
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    const { exceptionDetails } = response;
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? "WebGPU probe failed");
    return response.result.value;
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.#closed) throw new Error("Chrome connection closed");
    if (typeof method !== "string" || !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method))
      throw new TypeError("CDP method must have Domain.command syntax");
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new TypeError("params must be an object");
    if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId))
      throw new TypeError("sessionId must be a nonempty string");
    const id = ++this.#nextId;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    if (this.#closed) throw new Error("Chrome connection closed");
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.#timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#socket.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  on(method: string, callback: Listener): () => void {
    if (this.#closed) throw new Error("Chrome connection closed");
    if (typeof method !== "string" || !method.includes(".")) throw new TypeError("event must have Domain.event syntax");
    if (typeof callback !== "function") throw new TypeError("callback must be a function");
    let listeners = this.#listeners.get(method);
    if (!listeners) this.#listeners.set(method, (listeners = new Set()));
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (!listeners.size && this.#listeners.get(method) === listeners) this.#listeners.delete(method);
    };
  }

  #message(event: MessageEvent): void {
    let message;
    try {
      if (typeof event.data !== "string") throw new TypeError("CDP messages must be text");
      message = JSON.parse(event.data);
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new TypeError("invalid CDP message");
    } catch {
      this.close();
      return;
    }
    const { id, error: protocolError, method } = message;
    if (Number.isSafeInteger(id)) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (protocolError) {
        const error = new Error(String(protocolError.message ?? "CDP command failed"));
        Object.assign(error, { code: protocolError.code, data: protocolError.data });
        pending.reject(error);
      } else pending.resolve(message.result);
    } else if (typeof method === "string") {
      const listeners = this.#listeners.get(method);
      if (listeners)
        for (const callback of Array.from(listeners)) {
          try {
            callback.call(undefined, message.params ?? {}, message.sessionId);
          } catch (error) {
            reportError(error);
          }
        }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#removeAbort?.();
    this.#listeners.clear();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Chrome connection closed"));
    }
    this.#pending.clear();
    this.#socket.close();
  }
}

async function connect(endpoint: string, options: Options = {}, launchDeadline?: number): Promise<ChromiumConnection> {
  const timeout = timeoutValue(options.timeout);
  let url = endpointURL(endpoint, true);
  options.signal?.throwIfAborted();
  const started = Date.now();
  if (url.startsWith("http:") || url.startsWith("https:")) {
    const deadline = AbortSignal.timeout(timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await fetch(new URL("/json/version", url), { signal, redirect: "error", credentials: "omit" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`CDP discovery failed: HTTP ${response.status}`);
    }
    const version: unknown = await response.json();
    if (
      !version ||
      typeof version !== "object" ||
      !("webSocketDebuggerUrl" in version) ||
      typeof version.webSocketDebuggerUrl !== "string"
    )
      throw new TypeError("CDP discovery returned no browser WebSocket endpoint");
    url = endpointURL(version.webSocketDebuggerUrl);
    signal.throwIfAborted();
  }
  const remaining =
    launchDeadline === undefined ? timeout - (Date.now() - started) : Math.ceil(launchDeadline - performance.now());
  if (remaining <= 0) throw new Error("CDP connection timed out");
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const signal = options.signal;
    const timer = setTimeout(() => fail(new Error("CDP connection timed out")), remaining);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.removeEventListener("error", error);
      socket.removeEventListener("close", closed);
      socket.removeEventListener("open", opened);
    };
    const fail = (reason: any) => {
      cleanup();
      socket.close();
      reject(reason);
    };
    const abort = () => fail(signal?.reason);
    const error = () => fail(new Error("CDP WebSocket connection failed"));
    const closed = () => fail(new Error("CDP WebSocket closed before opening"));
    const opened = () => {
      cleanup();
      const connection = new ChromiumConnection(socket, timeout, signal);
      if (connection.closed) reject(signal?.reason ?? new Error("Chrome connection closed"));
      else resolve(connection);
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.addEventListener("error", error, { once: true });
    socket.addEventListener("close", closed, { once: true });
    socket.addEventListener("open", opened, { once: true });
    if (signal?.aborted) abort();
  });
}

function findExecutable(): string | null {
  const configured = process.env.BUN_CHROMIUM_PATH ?? process.env.BUN_CHROME_PATH;
  if (configured) return Bun.which(configured);
  for (const name of ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge"]) {
    const found = Bun.which(process.platform === "win32" ? `${name}.exe` : name);
    if (found) return found;
  }
  const candidates =
    process.platform === "win32"
      ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
          .filter((root): root is string => typeof root === "string")
          .flatMap(root =>
            [
              "BunChromium/Application/chrome.exe",
              "Chromium/Application/chrome.exe",
              "Google/Chrome/Application/chrome.exe",
              "Microsoft/Edge/Application/msedge.exe",
            ].map(name => path.join(root, name)),
          )
      : process.platform === "darwin"
        ? [
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]
        : ["/usr/bin/chromium", "/usr/bin/google-chrome", "/snap/bin/chromium"];
  for (const candidate of candidates) if (Bun.which(candidate)) return candidate;
  return null;
}

async function launch(
  options: Options & {
    executable?: string;
    userDataDir?: string;
    headless?: boolean;
    url?: string;
    extensions?: string[];
    webgpu?: boolean;
  } = {},
) {
  const timeout = timeoutValue(options.timeout);
  options.signal?.throwIfAborted();
  const executable = options.executable ?? findExecutable();
  if (!executable || !Bun.which(executable))
    throw new Error("Chromium executable not found; set BUN_CHROMIUM_PATH or executable");
  const url = validateURL(options.url ?? "about:blank");
  const extensions = options.extensions ?? [];
  if (
    !Array.isArray(extensions) ||
    extensions.some(dir => typeof dir !== "string" || !path.isAbsolute(dir) || dir.includes(",") || dir.includes("\0"))
  )
    throw new TypeError("extensions must be absolute directory paths without commas or NUL");
  for (const dir of extensions) {
    manifests.validateExtension(JSON.parse(await Bun.file(path.join(dir, "manifest.json")).text()));
  }
  options.signal?.throwIfAborted();
  if (options.webgpu !== undefined && typeof options.webgpu !== "boolean")
    throw new TypeError("webgpu must be a boolean");
  const linux = process.platform === "linux" ? linuxProcessGroup() : undefined;
  if (linux) {
    const probe = linux.pidfdOpen(process.pid);
    try {
      linux.pidfdSendSignal(probe, 0, linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
    } catch (error) {
      // A non-leader has no group at its own PID; ESRCH still proves the kernel accepted the flag.
      if ((error as { code?: string }).code !== "ESRCH")
        throw new Error("Chromium requires Linux 6.9 process-group pidfd signals", { cause: error });
    } finally {
      fs.closeSync(probe);
    }
  }
  const ownedProfile = options.userDataDir === undefined;
  if (!ownedProfile && (typeof options.userDataDir !== "string" || !path.isAbsolute(options.userDataDir)))
    throw new TypeError("userDataDir must be an absolute dedicated directory path");
  const userDataDir: string = ownedProfile
    ? fs.mkdtempSync(path.join(os.tmpdir(), "bun-chromium-"))
    : options.userDataDir!;
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = [
    executable,
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (options.headless === true) args.push("--headless=new");
  if (process.platform === "linux" && options.headless === true && ownedProfile) args.push("--password-store=basic");
  args.push(options.webgpu === false ? "--disable-features=WebGPUService" : "--enable-features=WebGPUService");
  if (extensions.length) args.push(`--load-extension=${extensions.join(",")}`);
  args.push(url);
  let proc: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;
  let connection: ChromiumConnection | undefined;
  let closed = false;
  let abort: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let job: any;
  let pidfd: number | null = null;
  let processGroup = false;
  // Re-read after each await: the process can exit while Browser.close is pending.
  const running = (child: Bun.Subprocess) => child.exitCode === null;
  const waitForExit = async (child: Bun.Subprocess, milliseconds: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        child.exited.then(() => true),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const close = () =>
    (closing ??= (async () => {
      closed = true;
      if (abort) options.signal?.removeEventListener("abort", abort);
      try {
        if (proc && running(proc)) {
          if (connection && !connection.closed) {
            // Browser.close can close its socket before replying; process exit is the acknowledgement.
            const request = connection.send("Browser.close").catch(() => undefined);
            if (!(await waitForExit(proc, Math.min(timeout, 1000)))) {
              connection.close();
              await request;
            }
          }
          if (running(proc)) {
            if (job) job.terminate();
            else if (pidfd === null || !processGroup) proc.kill("SIGKILL");
          }
        }
        if (linux && pidfd !== null && processGroup) {
          // The retained pidfd names the original process group even after its leader is reaped.
          try {
            linux.pidfdSendSignal(pidfd, "SIGKILL", linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
          } catch (error) {
            if ((error as { code?: string }).code !== "ESRCH") throw error;
          }
        }
        if (proc && !(await waitForExit(proc, Math.min(timeout, 5000))))
          throw new Error("Chromium did not exit after termination");
        connection?.close();
        job?.close();
        if (ownedProfile) fs.rmSync(userDataDir, { recursive: true, force: true });
      } finally {
        connection?.close();
        job?.close();
        if (pidfd !== null) {
          fs.closeSync(pidfd);
          pidfd = null;
        }
      }
    })());
  try {
    const spawnOptions = { stdin: "ignore", stdout: "ignore", stderr: "pipe" } as const;
    job = process.platform === "win32" ? windowsJob() : undefined;
    if (job) {
      job.setLimits({ killOnClose: true });
      proc = job.spawn(args, spawnOptions);
    } else {
      proc = Bun.spawn(args, { ...spawnOptions, detached: process.platform === "linux" });
      if (linux) {
        pidfd = linux.pidfdForProcess(proc);
        if (pidfd === null) throw new Error("Chromium requires native subprocess pidfd support on Linux");
        linux.pidfdSendSignal(pidfd, 0, linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
        processGroup = true;
      }
    }
    if (!proc) throw new Error("Chromium spawn did not return a subprocess");
    const child = proc;
    const deadline = performance.now() + timeout;
    const remaining = () => Math.max(0, Math.ceil(deadline - performance.now()));
    const childExit = new AbortController();
    void child.exited.then(() =>
      childExit.abort(new Error("Chromium exited before connecting its debugging endpoint")),
    );
    const launchSignal = options.signal ? AbortSignal.any([options.signal, childExit.signal]) : childExit.signal;
    const endpoint = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: any, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancelled);
        if (error !== undefined) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => finish(new Error("Chromium debugging endpoint timed out")), remaining());
      const cancelled = () => finish(options.signal?.reason);
      options.signal?.addEventListener("abort", cancelled, { once: true });
      const drain = async () => {
        const reader = child.stderr.getReader();
        const decoder = new TextDecoder();
        let tail = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            tail += decoder.decode(value, { stream: true });
            const match = /DevTools listening on (wss?:\/\/[^\s]+)[\r\n]/.exec(tail);
            if (match) finish(undefined, match[1]);
            tail = tail.slice(-16384);
          }
          finish(new Error("Chromium exited before publishing its debugging endpoint"));
        } catch (error) {
          finish(error);
        } finally {
          reader.releaseLock();
        }
      };
      void drain();
      if (options.signal?.aborted) cancelled();
    });
    while (!connection) {
      launchSignal.throwIfAborted();
      const budget = remaining();
      if (budget === 0) throw new Error("Chromium debugging connection timed out");
      try {
        connection = await connect(endpoint, { ...options, timeout, signal: launchSignal }, deadline);
      } catch (error) {
        launchSignal.throwIfAborted();
        if (
          !(error instanceof Error) ||
          !["CDP WebSocket connection failed", "CDP WebSocket closed before opening"].includes(error.message)
        )
          throw error;
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            launchSignal.removeEventListener("abort", abort);
            reject(launchSignal.reason);
          };
          const timer = setTimeout(
            () => {
              launchSignal.removeEventListener("abort", abort);
              resolve();
            },
            Math.min(25, remaining()),
          );
          launchSignal.addEventListener("abort", abort, { once: true });
          if (launchSignal.aborted) abort();
        });
      }
    }
    const backgroundClose = async () => {
      try {
        await close();
      } catch (error) {
        reportError(error);
      }
    };
    abort = () => {
      void backgroundClose();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const { signal } = options;
    if (signal?.aborted) {
      await close();
      signal.throwIfAborted();
    }
    const exited = async () => {
      await child.exited;
      if (!closed) await backgroundClose();
    };
    void exited();
    return { connection, process: proc, endpoint, userDataDir, close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function readProfileJSON(file: string) {
  const reader = Bun.file(file).stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw new RangeError("profile metadata exceeds the 8 MiB limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return JSON.parse(await new Blob(chunks as BlobPart[]).text());
  } catch {
    throw new TypeError("profile metadata is not valid JSON");
  }
}

async function discoverProfiles(options: { userDataDirs?: readonly string[] } = {}) {
  let directories = options.userDataDirs;
  if (directories === undefined) {
    const home = os.homedir();
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA;
      directories = local ? [path.join(local, "Google/Chrome/User Data"), path.join(local, "Chromium/User Data")] : [];
    } else if (process.platform === "darwin") {
      directories = [
        path.join(home, "Library/Application Support/Google/Chrome"),
        path.join(home, "Library/Application Support/Chromium"),
      ];
    } else {
      const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
      directories = [path.join(config, "google-chrome"), path.join(config, "chromium")];
    }
  }
  if (!Array.isArray(directories) || directories.length > 16)
    throw new TypeError("userDataDirs must contain at most 16 absolute directory paths");
  const result: { userDataDir: string; directory: string; name: string; isDefault: boolean; isLastUsed: boolean }[] =
    [];
  const seen = new Set<string>();
  for (const directory of directories) {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw new TypeError("userDataDirs entries must be absolute paths");
    let root: string;
    try {
      root = await fs.promises.realpath(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (seen.has(root)) continue;
    seen.add(root);
    let state;
    try {
      state = await readProfileJSON(path.join(root, "Local State"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const cache = state?.profile?.info_cache;
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) continue;
    const names = Object.keys(cache);
    if (names.length > 256) throw new RangeError("profile metadata exceeds the 256 profile limit");
    for (const name of names) {
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0"))
        throw new TypeError("profile directory name must be a single path component");
      const profile = path.join(root, name);
      let info;
      try {
        info = await fs.promises.stat(profile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!info.isDirectory()) continue;
      const resolved = await fs.promises.realpath(profile);
      if (path.dirname(resolved) !== root)
        throw new TypeError("profile directory must remain within its user data owner");
      result.push({
        userDataDir: root,
        directory: resolved,
        name: typeof cache[name]?.name === "string" ? cache[name].name : name,
        isDefault: name === "Default",
        isLastUsed: name === state.profile.last_used,
      });
    }
  }
  return result;
}

function profileCapabilities() {
  return Object.freeze({
    discovery: "read-only-metadata",
    bookmarks: "read-only-file",
    storedCookies: "unavailable",
    storedPasswords: "unavailable",
    liveCookies: "requires-connected-browser-site-api",
    liveSessions: "requires-connected-browser-target-api",
  });
}

async function readBookmarks(file: string, options: { site?: string; includeSubdomains?: boolean } = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new TypeError("Bookmarks file must be an absolute path");
  let hostname: string | undefined;
  const { site: siteOption } = options;
  if (siteOption !== undefined) {
    const site = new URL(siteOption);
    if (!["http:", "https:"].includes(site.protocol) || site.username || site.password)
      throw new TypeError("bookmark site must be an HTTP(S) URL without credentials");
    hostname = site.hostname;
  }
  if (options.includeSubdomains !== undefined && typeof options.includeSubdomains !== "boolean")
    throw new TypeError("includeSubdomains must be a boolean");
  const document = await readProfileJSON(file);
  if (!document || typeof document.roots !== "object" || !document.roots || Array.isArray(document.roots))
    throw new TypeError("invalid Chrome Bookmarks roots");
  const result: { id: string; name: string; url: string; folder: string[] }[] = [];
  const stack = Object.values(document.roots).map(node => ({
    node: node as any,
    folder: [] as string[],
  }));
  let nodes = 0;
  while (stack.length) {
    if (++nodes > 100000) throw new RangeError("Bookmarks exceeds the 100000 node limit");
    const { node, folder } = stack.pop()!;
    if (!node || typeof node.name !== "string") throw new TypeError("invalid bookmark node");
    if (node.type === "url") {
      if (typeof node.url !== "string" || typeof node.id !== "string") throw new TypeError("invalid bookmark URL node");
      if (hostname !== undefined) {
        let url: URL;
        try {
          url = new URL(node.url);
        } catch {
          continue;
        }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
        if (url.hostname !== hostname && !(options.includeSubdomains && url.hostname.endsWith(`.${hostname}`)))
          continue;
      }
      result.push({ id: node.id, name: node.name, url: node.url, folder });
    } else if (node.type === "folder") {
      const { children } = node;
      if (!Array.isArray(children)) throw new TypeError("invalid bookmark folder children");
      if (children.length + stack.length + nodes > 100000)
        throw new RangeError("Bookmarks exceeds the 100000 node limit");
      const parent = [...folder, node.name];
      if (parent.length > 64) throw new RangeError("Bookmarks exceeds the 64 folder depth limit");
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], folder: parent });
    } else throw new TypeError("invalid bookmark folder node");
  }
  return result;
}

async function importSite(options: import("bun:chromium").profiles.ImportSiteOptions) {
  if (!options || typeof options !== "object") throw new TypeError("site import requires options");
  for (const name of ["cookies", "sessions", "passwords", "includeSubdomains"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "boolean")
      throw new TypeError(`${name} must be a boolean`);
  }
  if (options.passwords) throw new Error("Stored password import is unavailable");
  if (typeof options.source?.send !== "function" || typeof options.view?.cdp !== "function")
    throw new TypeError("site import requires explicit source and destination browser connections");
  let site: URL;
  try {
    site = new URL(options.site);
  } catch {
    throw new TypeError("site must be an HTTP(S) URL without credentials");
  }
  if (!["http:", "https:"].includes(site.protocol) || site.username || site.password)
    throw new TypeError("site must be an HTTP(S) URL without credentials");
  if (options.navigate !== undefined && (typeof options.navigate !== "string" || !options.navigate))
    throw new TypeError("navigate must identify an explicitly selected source target");
  if (options.navigate !== undefined && options.sessions === false)
    throw new TypeError("selected target navigation requires sessions");
  if (options.navigate !== undefined && typeof options.view.navigate !== "function")
    throw new TypeError("destination browser must support navigation");
  if (
    options.sourceSessionId !== undefined &&
    (typeof options.sourceSessionId !== "string" || !options.sourceSessionId)
  )
    throw new TypeError("sourceSessionId must identify a connected source target session");
  options.signal?.throwIfAborted();
  let sourceTargets: Record<string, unknown>[] = [];
  if (options.sessions !== false || (options.cookies !== false && options.sourceSessionId === undefined)) {
    const response = await options.source.send<{ targetInfos: Record<string, unknown>[] }>("Target.getTargets");
    if (!Array.isArray(response.targetInfos) || response.targetInfos.length > 10000)
      throw new Error("Source browser returned an invalid target list");
    sourceTargets = response.targetInfos.filter(target => {
      if (target?.type !== "page" || typeof target.targetId !== "string" || typeof target.url !== "string")
        return false;
      try {
        const url = new URL(target.url);
        return (
          ["http:", "https:"].includes(url.protocol) && url.origin === site.origin && !url.username && !url.password
        );
      } catch {
        return false;
      }
    });
  }
  const cookies: Record<string, unknown>[] = [];
  if (options.cookies !== false) {
    let sessionId = options.sourceSessionId;
    let attached: string | undefined;
    let response: { cookies: Record<string, unknown>[] };
    try {
      if (sessionId === undefined) {
        const target =
          options.navigate === undefined
            ? sourceTargets[0]
            : sourceTargets.find(target => target.targetId === options.navigate);
        if (!target) throw new Error("Site cookie import requires a connected source page on the selected origin");
        const attachment = await options.source.send<{ sessionId: string }>("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
        if (typeof attachment.sessionId !== "string" || !attachment.sessionId)
          throw new Error("Source browser did not attach the selected site page");
        sessionId = attached = attachment.sessionId;
      }
      options.signal?.throwIfAborted();
      response = await options.source.send<{ cookies: Record<string, unknown>[] }>(
        "Network.getCookies",
        { urls: [site.href] },
        sessionId,
      );
    } finally {
      if (attached) await options.source.send("Target.detachFromTarget", { sessionId: attached });
    }
    if (!Array.isArray(response.cookies) || response.cookies.length > 3000)
      throw new Error("Source browser returned an invalid site cookie list");
    for (const cookie of response.cookies) {
      if (
        !cookie ||
        typeof cookie.name !== "string" ||
        typeof cookie.value !== "string" ||
        typeof cookie.domain !== "string" ||
        typeof cookie.path !== "string" ||
        !cookie.path.startsWith("/")
      )
        throw new Error("Source browser returned an invalid site cookie");
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      if (
        !domain ||
        !(site.hostname === domain || (cookie.domain.startsWith(".") && site.hostname.endsWith(`.${domain}`)))
      )
        throw new Error("Source browser returned a cookie outside the selected site");
      if (
        !site.pathname.startsWith(cookie.path) ||
        (site.pathname.length !== cookie.path.length &&
          !cookie.path.endsWith("/") &&
          site.pathname[cookie.path.length] !== "/")
      )
        throw new Error("Source browser returned a cookie outside the selected site path");
      if (cookie.secure === true && site.protocol !== "https:")
        throw new Error("A secure source cookie cannot be imported for an HTTP site");
      const parameter: Record<string, unknown> = {
        name: cookie.name,
        value: cookie.value,
        url: site.origin + site.pathname,
        path: cookie.path,
      };
      if (options.includeSubdomains && cookie.domain.startsWith(".")) parameter.domain = `.${site.hostname}`;
      for (const name of ["secure", "httpOnly", "sameParty"] as const) {
        if (cookie[name] !== undefined) {
          if (typeof cookie[name] !== "boolean") throw new Error("Source cookie attributes are invalid");
          parameter[name] = cookie[name];
        }
      }
      for (const [name, allowed] of [
        ["sameSite", ["Strict", "Lax", "None"]],
        ["priority", ["Low", "Medium", "High"]],
        ["sourceScheme", ["Unset", "NonSecure", "Secure"]],
      ] as const) {
        if (cookie[name] !== undefined) {
          if (!(allowed as readonly unknown[]).includes(cookie[name]))
            throw new Error("Source cookie attributes are invalid");
          parameter[name] = cookie[name];
        }
      }
      const { expires, partitionKey } = cookie;
      if (cookie.session !== true && expires !== undefined) {
        if (typeof expires !== "number" || !Number.isFinite(expires))
          throw new Error("Source cookie expiry is invalid");
        if (expires >= 0) parameter.expires = expires;
      }
      if (cookie.partitionKeyOpaque === true) throw new Error("Opaque partitioned cookies cannot be imported");
      if (partitionKey !== undefined) {
        const key = partitionKey as { topLevelSite?: unknown; hasCrossSiteAncestor?: unknown };
        if (!key || typeof key.topLevelSite !== "string" || typeof key.hasCrossSiteAncestor !== "boolean")
          throw new Error("Source cookie partition key is invalid");
        let topLevel: URL;
        try {
          topLevel = new URL(key.topLevelSite);
        } catch {
          throw new Error("Source cookie partition key is invalid");
        }
        if (!["http:", "https:"].includes(topLevel.protocol) || topLevel.username || topLevel.password)
          throw new Error("Source cookie partition key is invalid");
        if (
          topLevel.origin !== site.origin ||
          topLevel.pathname !== "/" ||
          topLevel.search ||
          topLevel.hash ||
          key.hasCrossSiteAncestor
        )
          throw new Error("Source cookie partition does not match the selected first-party site");
        parameter.partitionKey = { topLevelSite: topLevel.origin, hasCrossSiteAncestor: false };
      }
      if (
        cookies.some(
          existing =>
            existing.name === parameter.name &&
            existing.path === parameter.path &&
            existing.domain === parameter.domain &&
            JSON.stringify(existing.partitionKey) === JSON.stringify(parameter.partitionKey),
        )
      )
        throw new Error("Source cookies collide after selected site scoping");
      cookies.push(parameter);
    }
  }
  const sessions: { targetId: string; url: string; title: string }[] = [];
  if (options.sessions !== false) {
    options.signal?.throwIfAborted();
    for (const target of sourceTargets) {
      if (target?.type !== "page" || typeof target.targetId !== "string" || typeof target.url !== "string") continue;
      let url: URL;
      try {
        url = new URL(target.url);
      } catch {
        continue;
      }
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== site.origin || url.username || url.password)
        continue;
      sessions.push({
        targetId: target.targetId,
        url: url.href,
        title: typeof target.title === "string" ? target.title : "",
      });
    }
  }
  const selected =
    options.navigate === undefined ? undefined : sessions.find(target => target.targetId === options.navigate);
  if (options.navigate !== undefined && !selected)
    throw new Error("Selected source target is not a page on the requested site origin");
  options.signal?.throwIfAborted();
  if (cookies.length) {
    const acknowledgement = await options.view.cdp<{ success?: boolean }>("Network.setCookies", { cookies });
    if (acknowledgement?.success === false) throw new Error("Destination browser rejected the site cookies");
    options.signal?.throwIfAborted();
    const verified = await options.view.cdp<{ cookies: Record<string, unknown>[] }>("Network.getCookies", {
      urls: [site.href],
    });
    if (!Array.isArray(verified?.cookies)) throw new Error("Destination browser did not verify the site cookies");
    for (const cookie of cookies) {
      const expectedDomain = cookie.domain ?? site.hostname;
      const matches = verified.cookies.some(
        (actual: Record<string, unknown>) =>
          actual.name === cookie.name &&
          actual.value === cookie.value &&
          actual.domain === expectedDomain &&
          actual.path === cookie.path &&
          ["secure", "httpOnly", "sameSite"].every(
            name => cookie[name] === undefined || actual[name] === cookie[name],
          ) &&
          (cookie.partitionKey === undefined
            ? actual.partitionKey === undefined
            : (actual.partitionKey as Record<string, unknown> | undefined)?.topLevelSite ===
                (cookie.partitionKey as Record<string, unknown>).topLevelSite &&
              (actual.partitionKey as Record<string, unknown> | undefined)?.hasCrossSiteAncestor === false),
      );
      if (!matches) throw new Error("Destination browser did not verify the site cookies");
    }
  }
  options.signal?.throwIfAborted();
  if (selected) await options.view.navigate(selected.url);
  return {
    site: site.origin,
    cookiesRequested: cookies.length,
    cookiesImported: cookies.length,
    sessions,
    navigated: !!selected,
  };
}

function planApplication(options: { url: string; executable: string; userDataDir: string; profileDirectory?: string }) {
  const url = validateURL(options.url);
  if (url === "about:blank") throw new TypeError("Profile applications require an HTTP(S) URL");
  for (const value of [options.executable, options.userDataDir]) {
    if (typeof value !== "string" || !(path.isAbsolute(value) || path.win32.isAbsolute(value)) || value.includes("\0"))
      throw new TypeError("Application executable and user data directory must be absolute paths");
  }
  const profile = options.profileDirectory ?? "Default";
  if (typeof profile !== "string" || !profile || profile === "." || profile === ".." || /[\\/:\x00-\x1f]/.test(profile))
    throw new TypeError("Application profile must be a single directory name");
  return [
    options.executable,
    `--user-data-dir=${options.userDataDir}`,
    `--profile-directory=${profile}`,
    `--app=${url}`,
  ];
}

async function openApplication(options: {
  url: string;
  browser?: "chrome" | "chromium";
  executable?: string;
  userDataDir?: string;
  profileDirectory?: string;
}) {
  if (!options || typeof options !== "object") throw new TypeError("Application options are required");
  const url = validateURL(options.url);
  if (url === "about:blank") throw new TypeError("Profile applications require an HTTP(S) URL");
  const browser = options.browser ?? "chrome";
  if (browser !== "chrome" && browser !== "chromium") throw new TypeError("browser must be chrome or chromium");
  const home = os.homedir();
  let userDataDir = options.userDataDir;
  if (userDataDir === undefined) {
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA;
      if (!local) throw new Error("Chrome user data owner is unavailable");
      userDataDir = path.join(local, browser === "chrome" ? "Google/Chrome/User Data" : "Chromium/User Data");
    } else if (process.platform === "darwin") {
      userDataDir = path.join(home, "Library/Application Support", browser === "chrome" ? "Google/Chrome" : "Chromium");
    } else {
      userDataDir = path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
        browser === "chrome" ? "google-chrome" : "chromium",
      );
    }
  }
  const profiles = await discoverProfiles({ userDataDirs: [userDataDir] });
  const preferred = profiles.find(profile => profile.isLastUsed) ?? profiles.find(profile => profile.isDefault);
  const profileDirectory = options.profileDirectory ?? (preferred ? path.basename(preferred.directory) : "Default");
  const profile = profiles.find(profile => path.basename(profile.directory) === profileDirectory);
  if (!profile) throw new Error("Selected Chrome profile metadata is unavailable");
  let executable = options.executable;
  if (executable === undefined) {
    let candidates: string[];
    if (process.platform === "win32") {
      const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(
        Boolean,
      ) as string[];
      candidates = roots.map(root =>
        path.join(
          root,
          browser === "chrome" ? "Google/Chrome/Application/chrome.exe" : "Chromium/Application/chrome.exe",
        ),
      );
    } else if (process.platform === "darwin") {
      candidates = [
        browser === "chrome"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
    } else {
      candidates = browser === "chrome" ? ["google-chrome-stable", "google-chrome"] : ["chromium", "chromium-browser"];
    }
    executable = candidates.map(candidate => Bun.which(candidate)).find(Boolean) ?? undefined;
  }
  if (!executable) throw new Error("Selected browser executable is unavailable");
  const command = planApplication({ ...options, url, executable, userDataDir: profile.userDataDir, profileDirectory });
  // The browser owns its existing profile and ProcessSingleton; it may forward this launch to an existing process.
  const child = Bun.spawn(command, { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
  return { pid: child.pid, browser, profileDirectory, mode: "native-profile-application" as const };
}

const chromium = {
  ChromiumConnection,
  connect,
  launch,
  findExecutable,
  manifests,
  profiles: {
    readBookmarks,
    discover: discoverProfiles,
    capabilities: profileCapabilities,
    importSite,
    planApplication,
    openApplication,
  },
  protocol: { validateURL },
};

export { ChromiumConnection, connect, launch, findExecutable, manifests };
export const { profiles, protocol } = chromium;
export default chromium;
