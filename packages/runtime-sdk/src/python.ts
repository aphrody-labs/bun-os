// SPDX-License-Identifier: Apache-2.0
// Embedded CPython through bun:ffi and the aphrody-ffi Python host library (crates/aphrody-ffi). Plain TypeScript on
// upstream Bun: no runtime module is needed, only bun:ffi, node:worker and the host library built from this repository.
import { CString, dlopen, FFIType, ptr, read, suffix, toArrayBuffer, type Pointer } from "bun:ffi";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function embeddedNativeLibraryPath(name: string): string | null {
  const stem = process.platform === "win32" ? name : `lib${name}`;
  const matches = Bun.embeddedFiles.flatMap(file => {
    const path = (file as Blob & { name?: string }).name;
    return path &&
      (basename(path) === `${stem}.${suffix}` ||
        (basename(path).startsWith(`${stem}-`) && basename(path).endsWith(`.${suffix}`)))
      ? [path]
      : [];
  });
  if (matches.length > 1) throw new Error(`Multiple embedded native libraries for ${name}`);
  const path = matches[0];
  return path === undefined ? null : isAbsolute(path) ? path : join(dirname(Bun.main), path);
}

const SUPPORTED_TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const PyStatus = {
  Ok: 0,
  Arg: -1,
  Load: -2,
  State: -3,
  Python: -4,
  Panic: -5,
  Unsupported: -6,
} as const;

class PythonError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PythonError";
    this.status = status;
  }
}

const SYMBOLS = {
  bun_py_abi_version: { args: [], returns: FFIType.u32 },
  bun_py_capabilities: { args: [], returns: FFIType.u64 },
  aphrody_py_load: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_py_init: { args: [], returns: FFIType.i32 },
  aphrody_py_run: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_py_eval: { args: [FFIType.cstring, FFIType.ptr], returns: FFIType.i32 },
  aphrody_py_call: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  aphrody_py_version: { args: [FFIType.ptr], returns: FFIType.i32 },
  aphrody_py_finalize: { args: [], returns: FFIType.i32 },
  aphrody_py_last_error: { args: [], returns: FFIType.ptr },
  aphrody_py_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  bun_py_buffer_acquire: { args: [FFIType.cstring, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  bun_py_buffer_release: { args: [FFIType.u64], returns: FFIType.i32 },
  bun_py_buffer_deallocator: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
} as const;

type Symbols = ReturnType<typeof dlopen<typeof SYMBOLS>>["symbols"];

const HOST_ABI_VERSION = 1;
const WRITABLE_BUFFER_CAPABILITY = 1n;
const BUFFER_DESCRIPTOR_SIZE = 32;
const MAX_BATCH_EXPRESSIONS = 1024;
const MAX_BATCH_SOURCE_LENGTH = 8 * 1024 * 1024;

function batchExpression(expressions: readonly string[]): string {
  if (expressions.length > MAX_BATCH_EXPRESSIONS) {
    throw new PythonError(PyStatus.Arg, `Python batch exceeds ${MAX_BATCH_EXPRESSIONS} expressions`);
  }
  const source = `[${expressions.map(expression => `str((${expression}))`).join(",")}]`;
  if (source.length > MAX_BATCH_SOURCE_LENGTH) {
    throw new PythonError(PyStatus.Arg, "Python batch source exceeds 8 MiB");
  }
  return source;
}

/** The explicit or embedded Bun Python host; no core runtime library supplies this ABI. */
function pythonHostLibraryPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["BUV_PYTHON_HOST_LIBRARY"] || env["BUN_PYTHON_HOST_LIBRARY"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const embedded = embeddedNativeLibraryPath("bun_python_host");
  if (embedded !== null) return embedded;
  throw new PythonError(
    PyStatus.Load,
    "Bun Python host unavailable; set BUN_PYTHON_HOST_LIBRARY to the qualified bun_python_host library",
  );
}

const LIBPYTHON = /^(lib)?python3\.?\d+(\.so(\.1\.0)?|\.dylib|\.dll)$/;

/**
 * The libpython of the active `buv` artifact (`$BUV_HOME`, default `~/.buv`, `runtime/<target>/current`), or null.
 * `APHRODY_LIBPYTHON` wins when set; `BUV_RUNTIME` selects an artifact directly.
 */
function buvLibpython(env: NodeJS.ProcessEnv = process.env): string | null {
  const bunLibrary = env["BUV_PYTHON_LIBPYTHON"] || env["BUN_PYTHON_LIBPYTHON"];
  const explicit = bunLibrary !== undefined && bunLibrary !== "" ? bunLibrary : env["APHRODY_LIBPYTHON"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const runtime = env["BUV_RUNTIME"] || env["VU_RUNTIME"];
  if (runtime !== undefined && runtime !== "") return libpythonIn(resolve(runtime));
  const target = SUPPORTED_TARGETS[`${process.platform}-${process.arch}`];
  if (target === undefined) return null;
  const selectedHome = env["BUV_HOME"] || env["VU_HOME"];
  const home = selectedHome ? resolve(selectedHome) : join(homedir(), ".buv");
  try {
    return libpythonIn(realpathSync(join(home, "runtime", target, "current")));
  } catch {
    return null;
  }
}

/** The libpython inside a `buv` artifact directory (`lib/` on Unix, the root or `bin/` on Windows), or null. */
function libpythonIn(current: string): string | null {
  for (const dir of process.platform === "win32" ? [current, join(current, "bin")] : [join(current, "lib")]) {
    if (!existsSync(dir)) continue;
    const name = readdirSync(dir)
      .filter(file => LIBPYTHON.test(file))
      .sort((a, b) => b.length - a.length)[0];
    if (name !== undefined) return join(dir, name);
  }
  return null;
}

function takeString(symbols: Symbols, raw: Pointer | bigint | number | null): string {
  if (raw === null || raw === 0 || raw === 0n) return "";
  try {
    return new CString(raw as Pointer).toString();
  } finally {
    symbols.aphrody_py_string_free(raw as Pointer);
  }
}

const cstr = (text: string): Uint8Array => {
  if (text.includes("\0")) throw new PythonError(PyStatus.Arg, "Python argument contains a NUL character");
  return new TextEncoder().encode(`${text}\0`);
};

/** One way of reaching the interpreter: the Bun Python host library, or the CPython C API directly. */
interface PythonBackend {
  readonly kind: "host" | "capi";
  readonly started: boolean;
  version(): string;
  run(code: string): void;
  eval(expression: string): string;
  call(module: string, fn: string, arg?: string): string;
  buffer(expression: string): ArrayBuffer;
  /** Releases this lease; the last lease finalises an interpreter this backend started. */
  release(): void;
  unload(): void;
}

/** The Bun Python host library (crates/aphrody-ffi, ABI 1): the fork's native host, unchanged. */
class HostBackend implements PythonBackend {
  readonly kind = "host";
  readonly #symbols: Symbols;
  readonly #lib: { close(): void };
  readonly started: boolean;

  constructor(libraryPath: string, libpython: string | null) {
    const lib = dlopen(libraryPath, SYMBOLS);
    const symbols = lib.symbols;
    this.#lib = lib;
    this.#symbols = symbols;
    try {
      const version = symbols.bun_py_abi_version();
      if (version !== HOST_ABI_VERSION) {
        throw new PythonError(
          PyStatus.Unsupported,
          `Bun Python host ABI ${version} is incompatible with SDK ABI ${HOST_ABI_VERSION}`,
        );
      }
      const library = libpython === null ? null : cstr(libpython);
      this.#check(symbols.aphrody_py_load(library === null ? null : ptr(library)));
      const init = symbols.aphrody_py_init();
      if (init < 0) this.#check(init);
      this.started = init === 1;
    } catch (error) {
      lib.close();
      throw error;
    }
  }

  #check(status: number): void {
    if (status !== PyStatus.Ok) {
      const message = takeString(this.#symbols, this.#symbols.aphrody_py_last_error());
      throw new PythonError(status, message || `aphrody_py status ${status}`);
    }
  }

  #out(call: (out: Pointer) => number): string {
    const slot = new BigUint64Array(1);
    this.#check(call(ptr(slot)));
    const raw = read.ptr(ptr(slot), 0) as Pointer | 0;
    return raw === 0 ? "" : takeString(this.#symbols, raw);
  }

  version(): string {
    return this.#out(out => this.#symbols.aphrody_py_version(out));
  }

  run(code: string): void {
    const source = cstr(code);
    this.#check(this.#symbols.aphrody_py_run(ptr(source)));
  }

  eval(expression: string): string {
    const source = cstr(expression);
    return this.#out(out => this.#symbols.aphrody_py_eval(ptr(source), out));
  }

  call(module: string, fn: string, arg?: string): string {
    const moduleName = cstr(module);
    const functionName = cstr(fn);
    const argument = arg === undefined ? null : cstr(arg);
    return this.#out(out =>
      this.#symbols.aphrody_py_call(ptr(moduleName), ptr(functionName), argument === null ? null : ptr(argument), out),
    );
  }

  buffer(expression: string): ArrayBuffer {
    if ((BigInt(this.#symbols.bun_py_capabilities()) & WRITABLE_BUFFER_CAPABILITY) === 0n) {
      throw new PythonError(PyStatus.Unsupported, "Bun Python host has no writable buffer capability");
    }
    const source = cstr(expression);
    const descriptor = new Uint8Array(BUFFER_DESCRIPTOR_SIZE);
    const fields = new DataView(descriptor.buffer);
    fields.setUint32(0, BUFFER_DESCRIPTOR_SIZE, true);
    this.#check(this.#symbols.bun_py_buffer_acquire(ptr(source), 1, ptr(descriptor)));
    const address = fields.getBigUint64(8, true);
    const length = fields.getBigUint64(16, true);
    const lease = fields.getBigUint64(24, true);
    if (length > BigInt(Number.MAX_SAFE_INTEGER) || (address === 0n && length !== 0n)) {
      this.#symbols.bun_py_buffer_release(lease);
      throw new PythonError(PyStatus.Unsupported, "Python buffer cannot be represented by JavaScript");
    }
    if (length === 0n) {
      this.#check(this.#symbols.bun_py_buffer_release(lease));
      return new ArrayBuffer(0);
    }
    try {
      // toArrayBuffer(ptr, offset, length, context, deallocator): the runtime overload the type declarations omit.
      const withDeallocator = toArrayBuffer as unknown as (...args: unknown[]) => ArrayBuffer;
      const deallocator = (this.#symbols.bun_py_buffer_deallocator as unknown as { ptr: Pointer }).ptr;
      return withDeallocator(address, 0, Number(length), lease, deallocator);
    } catch (error) {
      this.#symbols.bun_py_buffer_release(lease);
      throw error;
    }
  }

  release(): void {
    this.#check(this.#symbols.aphrody_py_finalize());
  }

  unload(): void {
    this.#lib.close();
  }
}

/** Whether a Bun Python host library is configured or embedded (the `host` backend). */
function hostLibraryConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env["BUV_PYTHON_HOST_LIBRARY"] || env["BUN_PYTHON_HOST_LIBRARY"] || embeddedNativeLibraryPath("bun_python_host"),
  );
}

interface PythonOpenOptions {
  /** The Bun Python host library; selects the `host` backend. */
  libraryPath?: string;
  /** The libpython to load; `null` lets the host pick, `undefined` runs {@link findLibpython}. */
  libpython?: string | null;
  /** `host` (the Bun Python host library) or `capi` (libpython directly). Default: `host` when one is configured. */
  backend?: "host" | "capi";
}

/** The shared interpreter. `Python.open()` loads libpython (or Bun's Python host) and initialises or attaches. */
class Python implements Disposable {
  readonly #backend: PythonBackend;
  #closed = false;

  private constructor(backend: PythonBackend) {
    this.#backend = backend;
  }

  /** True when this handle caused the interpreter to start. */
  get started(): boolean {
    return this.#backend.started;
  }

  /** `host` or `capi`. */
  get backend(): "host" | "capi" {
    return this.#backend.kind;
  }

  static open(options: PythonOpenOptions = {}): Python {
    const backend = options.backend ?? (options.libraryPath !== undefined || hostLibraryConfigured() ? "host" : "capi");
    if (backend === "host") {
      const libraryPath = options.libraryPath ?? pythonHostLibraryPath();
      const libpython = options.libpython === undefined ? findLibpython() : options.libpython;
      return new Python(new HostBackend(libraryPath, libpython));
    }
    const libpython = options.libpython ?? findLibpython();
    if (libpython === null) {
      throw new PythonError(
        PyStatus.Load,
        "libpython not found: install CPython (uv python install) or set BUN_PYTHON_LIBPYTHON",
      );
    }
    return new Python(openCapi(libpython));
  }

  static async(options: PythonOpenOptions = {}) {
    return PythonAsync.open(options);
  }

  #open(): PythonBackend {
    if (this.#closed) throw new PythonError(PyStatus.State, "Python host handle is closed");
    return this.#backend;
  }

  /** `Py_GetVersion()`. */
  version(): string {
    return this.#open().version();
  }

  /** Runs statements in `__main__`. */
  run(code: string): void {
    this.#open().run(code);
  }

  exec(source: string | TemplateStringsArray): void {
    if (typeof source === "string") this.run(source);
    else {
      if (source.length !== 1) throw new PythonError(PyStatus.Arg, "Python templates cannot interpolate code");
      this.run(source.raw[0]!);
    }
  }

  /** Evaluates an expression in `__main__` and returns `str(result)`. */
  eval(expression: string): string {
    return this.#open().eval(expression);
  }

  evalJSON<T = unknown>(expression: string): T {
    return JSON.parse(
      this.eval(
        `__import__('json').dumps((${expression}), ensure_ascii=False, allow_nan=False, separators=(',', ':'))`,
      ),
    );
  }

  /** Evaluates up to 1024 expressions in one GIL/FFI crossing. */
  evalBatch(expressions: readonly string[]): string[] {
    return this.evalJSON<string[]>(batchExpression(expressions));
  }

  /** `module.function(arg)` (no argument when `arg` is undefined), returns `str(result)`. */
  call(module: string, fn: string, arg?: string): string {
    return this.#open().call(module, fn, arg);
  }

  /** Shares a contiguous writable Python buffer with JavaScript without copying it. */
  buffer(expression: string): ArrayBuffer {
    return this.#open().buffer(expression);
  }

  /** Releases this client lease; the last client finalises an interpreter owned by the host. */
  close(): void {
    if (this.#closed) return;
    this.#backend.release();
    this.#closed = true;
    this.#backend.unload();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

type Reply = { id: number; value?: string; error?: { status: number; message: string } };
class PythonAsync implements AsyncDisposable {
  readonly #worker: Worker;
  readonly #pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();
  #next = 0;
  #closing = false;
  #closePromise: Promise<void> | null = null;

  private constructor(worker: Worker) {
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      const error = reply.error;
      if (error) pending.reject(new PythonError(error.status, error.message));
      else pending.resolve(reply.value ?? "");
    };
    worker.onerror = event => {
      this.#closing = true;
      for (const pending of this.#pending.values()) pending.reject(new PythonError(PyStatus.State, event.message));
      this.#pending.clear();
      worker.terminate();
    };
  }

  static async open(options: PythonOpenOptions = {}) {
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("./python-worker.ts", import.meta.url), { name: "buv-python" });
      const python = new PythonAsync(worker);
      await python.#request("open", [options]);
      return python;
    } catch (error) {
      worker?.terminate();
      throw error;
    }
  }

  #request(operation: string, args: unknown[] = []) {
    if (this.#closing) return Promise.reject(new PythonError(PyStatus.State, "Python worker is closed"));
    if (this.#pending.size >= 256)
      return Promise.reject(new PythonError(PyStatus.State, "Python worker queue is full"));
    const id = ++this.#next;
    return new Promise<string>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage({ id, operation, args });
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  version() {
    return this.#request("version");
  }
  async run(code: string) {
    await this.#request("run", [code]);
  }
  async exec(source: string | TemplateStringsArray) {
    if (typeof source !== "string" && source.length !== 1)
      throw new PythonError(PyStatus.Arg, "Python templates cannot interpolate code");
    await this.run(typeof source === "string" ? source : source.raw[0]!);
  }
  eval(expression: string) {
    return this.#request("eval", [expression]);
  }
  async evalJSON<T = unknown>(expression: string): Promise<T> {
    return JSON.parse(
      await this.eval(
        `__import__('json').dumps((${expression}), ensure_ascii=False, allow_nan=False, separators=(',', ':'))`,
      ),
    );
  }
  /** Evaluates up to 1024 expressions in one worker request and one GIL/FFI crossing. */
  evalBatch(expressions: readonly string[]): Promise<string[]> {
    return this.evalJSON<string[]>(batchExpression(expressions));
  }
  call(module: string, fn: string, arg?: string) {
    return this.#request("call", [module, fn, arg]);
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    if (this.#closing) return Promise.resolve();
    const closed = this.#request("close");
    this.#closing = true;
    this.#closePromise = closed
      .then(() => {})
      .finally(() => {
        this.#worker.terminate();
      });
    return this.#closePromise;
  }
  async [Symbol.asyncDispose]() {
    await this.close();
  }
}

// ─── libpython discovery ────────────────────────────────────────────────────────────────────────────────────────────

/** Asks a Python executable for its shared libpython; null for static builds or a failed probe. */
function libpythonOfExecutable(executable: string): string | null {
  const probe = [
    "import os, sys, sysconfig",
    "v = sys.version_info",
    "if os.name == 'nt':",
    "    print(os.path.join(sys.base_prefix, 'python%d%d.dll' % (v[0], v[1])))",
    "else:",
    "    g = sysconfig.get_config_var",
    "    fw = g('PYTHONFRAMEWORKPREFIX')",
    "    name = g('INSTSONAME') or g('LDLIBRARY') or ''",
    "    if g('PYTHONFRAMEWORK') and fw: print(os.path.join(fw, g('LDLIBRARY') or ''))",
    "    elif name and not name.endswith('.a'): print(os.path.join(g('LIBDIR') or '', name))",
  ].join("\n");
  try {
    const result = Bun.spawnSync([executable, "-I", "-c", probe], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 15_000,
      windowsHide: true,
    });
    if (result.exitCode !== 0) return null;
    const path = result.stdout.toString().trim();
    return path !== "" && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** The CPython `uv python find` selects (it honours `.python-version`, `UV_PYTHON` and uv-managed installs). */
function uvLibpython(env: NodeJS.ProcessEnv = process.env): string | null {
  const uv = Bun.which("uv", { PATH: env["PATH"] ?? env["Path"] ?? "" });
  if (uv === null) return null;
  try {
    const result = Bun.spawnSync([uv, "python", "find"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 15_000,
      windowsHide: true,
    });
    const executable = result.exitCode === 0 ? result.stdout.toString().trim() : "";
    return executable === "" ? null : libpythonOfExecutable(executable);
  } catch {
    return null;
  }
}

/** The `python3`/`python` on PATH; the Windows Store alias stub is skipped. */
function systemLibpython(env: NodeJS.ProcessEnv = process.env): string | null {
  const PATH = env["PATH"] ?? env["Path"] ?? "";
  for (const name of ["python3", "python"]) {
    const executable = Bun.which(name, { PATH });
    if (executable === null || /[\\/]WindowsApps[\\/]/i.test(executable)) continue;
    const library = libpythonOfExecutable(executable);
    if (library !== null) return library;
  }
  return null;
}

let discovered: string | null | undefined;

/**
 * The libpython to embed: the explicit or `buv` one ({@link buvLibpython}), else the CPython `uv python find`
 * selects, else the `python3`/`python` on PATH. The probe result is cached for the process.
 */
function findLibpython(env: NodeJS.ProcessEnv = process.env): string | null {
  const buv = buvLibpython(env);
  if (buv !== null) return buv;
  if (env === process.env && discovered !== undefined) return discovered;
  const found = uvLibpython(env) ?? systemLibpython(env);
  if (env === process.env) discovered = found;
  return found;
}

// ─── CPython C API backend ──────────────────────────────────────────────────────────────────────────────────────────
// libpython driven directly through bun:ffi, for any stock CPython 3.9+: no host library to build. Every call takes the
// GIL with PyGILState_Ensure, so handles opened on different threads (PythonAsync workers) share one interpreter.

const CAPI = {
  Py_IsInitialized: { args: [], returns: FFIType.i32 },
  Py_InitializeEx: { args: [FFIType.i32], returns: FFIType.void },
  Py_FinalizeEx: { args: [], returns: FFIType.i32 },
  Py_GetVersion: { args: [], returns: FFIType.ptr },
  PyEval_SaveThread: { args: [], returns: FFIType.ptr },
  PyGILState_Ensure: { args: [], returns: FFIType.i32 },
  PyGILState_Release: { args: [FFIType.i32], returns: FFIType.void },
  PyImport_AddModule: { args: [FFIType.ptr], returns: FFIType.ptr },
  PyImport_ImportModule: { args: [FFIType.ptr], returns: FFIType.ptr },
  PyModule_GetDict: { args: [FFIType.ptr], returns: FFIType.ptr },
  PyRun_StringFlags: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  PyObject_Str: { args: [FFIType.ptr], returns: FFIType.ptr },
  PyObject_GetAttrString: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  PyObject_CallObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  PyObject_GetBuffer: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  PyBuffer_Release: { args: [FFIType.ptr], returns: FFIType.void },
  PyUnicode_AsUTF8AndSize: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  PyUnicode_FromStringAndSize: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.ptr },
  PyTuple_New: { args: [FFIType.i64], returns: FFIType.ptr },
  PyTuple_SetItem: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
  Py_DecRef: { args: [FFIType.ptr], returns: FFIType.void },
  PyErr_Occurred: { args: [], returns: FFIType.ptr },
  PyErr_Fetch: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  PyErr_NormalizeException: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
} as const;

/** The C API with pointers typed as `Pointer | null` (CPython returns NULL on failure). */
type Capi = {
  [K in keyof typeof CAPI]: (
    ...args: any[]
  ) => (typeof CAPI)[K]["returns"] extends FFIType.ptr
    ? Pointer | null
    : (typeof CAPI)[K]["returns"] extends FFIType.void
      ? void
      : number;
};

const Py_file_input = 257;
const Py_eval_input = 258;
/** PyBUF_WRITABLE | PyBUF_ND: writable and C-contiguous. */
const PyBUF_CONTIG = 0x0009;
/** sizeof(Py_buffer) is 80 on 64-bit CPython; the extra room keeps the struct safe across versions. */
const PY_BUFFER_SIZE = 128;

/** The interpreter prefix next to a libpython: the stdlib landmark (`Lib/os.py`, `lib/python3.X/os.py`) decides. */
function pythonHome(libpython: string): string | null {
  const version = /python3\.?(\d+)/i.exec(basename(libpython))?.[1];
  for (const dir of [dirname(libpython), dirname(dirname(libpython))]) {
    if (existsSync(join(dir, "Lib", "os.py"))) return dir;
    if (version !== undefined && existsSync(join(dir, "lib", `python3.${version}`, "os.py"))) return dir;
  }
  return null;
}

/** POSIX: re-open libpython RTLD_GLOBAL so the C extension modules Python imports can bind its symbols. */
function promoteGlobal(libpython: string): void {
  if (process.platform === "win32") return;
  const RTLD_NOW = 2;
  const RTLD_GLOBAL = process.platform === "darwin" ? 8 : 0x100;
  const candidates =
    process.platform === "darwin" ? ["/usr/lib/libSystem.B.dylib"] : ["libc.so.6", "libdl.so.2", "libc.so"];
  for (const candidate of candidates) {
    try {
      const libc = dlopen(candidate, { dlopen: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr } });
      libc.symbols.dlopen(ptr(cstr(libpython)), RTLD_NOW | RTLD_GLOBAL);
      return;
    } catch {}
  }
}

/** Optional initialisation entry points (`home`): PyInitConfig (3.14+) or Py_SetPythonHome (up to 3.13). */
function initializeWithHome(libpython: string, home: string | null, api: Capi): void {
  if (home !== null && !process.env["PYTHONHOME"]) {
    try {
      const lib = dlopen(libpython, {
        PyInitConfig_Create: { args: [], returns: FFIType.ptr },
        PyInitConfig_SetStr: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        PyInitConfig_Free: { args: [FFIType.ptr], returns: FFIType.void },
        Py_InitializeFromInitConfig: { args: [FFIType.ptr], returns: FFIType.i32 },
      });
      const config = lib.symbols.PyInitConfig_Create();
      if (config) {
        try {
          if (
            lib.symbols.PyInitConfig_SetStr(config, ptr(cstr("home")), ptr(cstr(home))) === 0 &&
            lib.symbols.PyInitConfig_SetStr(config, ptr(cstr("program_name")), ptr(cstr("python"))) === 0 &&
            lib.symbols.Py_InitializeFromInitConfig(config) === 0
          )
            return;
        } finally {
          lib.symbols.PyInitConfig_Free(config);
        }
      }
    } catch {}
    try {
      const lib = dlopen(libpython, { Py_SetPythonHome: { args: [FFIType.ptr], returns: FFIType.void } });
      const wideHome = wideString(home);
      pinnedHomes.push(wideHome);
      lib.symbols.Py_SetPythonHome(ptr(wideHome));
    } catch {}
  }
  api.Py_InitializeEx(0);
}

/** Py_SetPythonHome keeps the pointer: the buffer must live as long as the interpreter. */
const pinnedHomes: Uint8Array[] = [];

function wideString(text: string): Uint8Array {
  if (process.platform === "win32") {
    const bytes = new Uint8Array((text.length + 1) * 2);
    for (let i = 0; i < text.length; i++) new DataView(bytes.buffer).setUint16(i * 2, text.charCodeAt(i), true);
    return bytes;
  }
  const points = [...text].map(c => c.codePointAt(0)!);
  const bytes = new Uint8Array((points.length + 1) * 4);
  const view = new DataView(bytes.buffer);
  points.forEach((point, i) => view.setUint32(i * 4, point, true));
  return bytes;
}

const decoder = new TextDecoder();

/** libpython stays loaded for the process: unloading it under a live interpreter would crash. */
const capiLibraries = new Map<string, { api: Capi; finalized: boolean }>();

class CapiBackend implements PythonBackend {
  readonly kind = "capi";
  readonly #api: Capi;
  readonly #state: { api: Capi; finalized: boolean };
  readonly started: boolean;
  readonly #buffers: FinalizationRegistry<Uint8Array>;

  constructor(libpython: string) {
    let state = capiLibraries.get(libpython);
    if (state === undefined) {
      state = { api: dlopen(libpython, CAPI).symbols as unknown as Capi, finalized: false };
      capiLibraries.set(libpython, state);
    }
    this.#state = state;
    const api = state.api;
    this.#api = api;
    let started = false;
    if (api.Py_IsInitialized() === 0) {
      promoteGlobal(libpython);
      initializeWithHome(libpython, pythonHome(libpython), api);
      if (api.Py_IsInitialized() === 0) {
        throw new PythonError(PyStatus.Load, `Py_InitializeEx failed for ${libpython}`);
      }
      // Hand the GIL back so every call (and every worker thread) takes it through PyGILState_Ensure.
      api.PyEval_SaveThread();
      started = true;
      state.finalized = false;
    }
    this.started = started;
    this.#exec(
      `import sys as _bun_sys, threading as _bun_threading\n` +
        `_bun_sys._bun_py_leases = getattr(_bun_sys, '_bun_py_leases', 0) + 1\n` +
        (started ? `_bun_sys._bun_py_owner = _bun_threading.get_ident()\n` : "") +
        `del _bun_sys, _bun_threading\n`,
    );
    this.#buffers = new FinalizationRegistry(view => {
      if (!state.finalized) this.#gil(() => this.#api.PyBuffer_Release(ptr(view)));
    });
  }

  #gil<T>(body: () => T): T {
    const state = this.#api.PyGILState_Ensure();
    try {
      return body();
    } finally {
      this.#api.PyGILState_Release(state);
    }
  }

  /** The pending exception as `Type: message`, cleared; PythonError status Python. */
  #error(): PythonError {
    const api = this.#api;
    const slots = new BigUint64Array(3);
    const at = (i: number) => ptr(slots, i * 8);
    api.PyErr_Fetch(at(0), at(1), at(2));
    api.PyErr_NormalizeException(at(0), at(1), at(2));
    const [type, value, traceback] = [slots[0]!, slots[1]!, slots[2]!];
    let name = "Exception";
    let message = "";
    if (type !== 0n) {
      const qualname = api.PyObject_GetAttrString(Number(type) as unknown as Pointer, ptr(cstr("__qualname__")));
      if (qualname) name = this.#text(qualname) ?? name;
    }
    if (value !== 0n) {
      const text = api.PyObject_Str(Number(value) as unknown as Pointer);
      if (text) message = this.#text(text) ?? "";
    }
    for (const object of [type, value, traceback])
      if (object !== 0n) api.Py_DecRef(Number(object) as unknown as Pointer);
    if (api.PyErr_Occurred()) {
      const clear = new BigUint64Array(3);
      api.PyErr_Fetch(ptr(clear), ptr(clear, 8), ptr(clear, 16));
      for (const object of clear) if (object !== 0n) api.Py_DecRef(Number(object) as unknown as Pointer);
    }
    return new PythonError(PyStatus.Python, message ? `${name}: ${message}` : name);
  }

  /** UTF-8 of a `str` object, consuming the reference; null on failure (the error stays pending). */
  #text(object: Pointer): string | null {
    const api = this.#api;
    try {
      const size = new BigInt64Array(1);
      const data = api.PyUnicode_AsUTF8AndSize(object, ptr(size));
      if (!data) return null;
      const length = Number(size[0]);
      return length === 0 ? "" : decoder.decode(new Uint8Array(toArrayBuffer(data, 0, length)));
    } finally {
      api.Py_DecRef(object);
    }
  }

  /** `str(object)`, consuming the reference. */
  #str(object: Pointer | null): string {
    if (!object) throw this.#error();
    const api = this.#api;
    const text = api.PyObject_Str(object);
    api.Py_DecRef(object);
    if (!text) throw this.#error();
    const value = this.#text(text);
    if (value === null) throw this.#error();
    return value;
  }

  #globals(): Pointer {
    const main = this.#api.PyImport_AddModule(ptr(cstr("__main__")));
    if (!main) throw this.#error();
    return this.#api.PyModule_GetDict(main)!;
  }

  #evaluate(source: string, start: number): Pointer | null {
    const globals = this.#globals();
    return this.#api.PyRun_StringFlags(ptr(cstr(source)), start, globals, globals, null);
  }

  #exec(code: string): void {
    this.#gil(() => {
      const result = this.#evaluate(code, Py_file_input);
      if (!result) throw this.#error();
      this.#api.Py_DecRef(result);
    });
  }

  version(): string {
    return new CString(this.#api.Py_GetVersion()!).toString();
  }

  run(code: string): void {
    this.#exec(code);
  }

  eval(expression: string): string {
    return this.#gil(() => this.#str(this.#evaluate(expression, Py_eval_input)));
  }

  call(module: string, fn: string, arg?: string): string {
    const moduleName = cstr(module);
    const functionName = cstr(fn);
    const argument = arg === undefined ? null : new TextEncoder().encode(arg);
    return this.#gil(() => {
      const api = this.#api;
      const imported = api.PyImport_ImportModule(ptr(moduleName));
      if (!imported) throw this.#error();
      const callable = api.PyObject_GetAttrString(imported, ptr(functionName));
      api.Py_DecRef(imported);
      if (!callable) throw this.#error();
      try {
        let args: Pointer | null = null;
        if (argument !== null) {
          const value = api.PyUnicode_FromStringAndSize(argument.length ? ptr(argument) : null, argument.length);
          if (!value) throw this.#error();
          args = api.PyTuple_New(1);
          if (!args) {
            api.Py_DecRef(value);
            throw this.#error();
          }
          api.PyTuple_SetItem(args, 0, value);
        }
        const result = api.PyObject_CallObject(callable, args);
        if (args) api.Py_DecRef(args);
        return this.#str(result);
      } finally {
        api.Py_DecRef(callable);
      }
    });
  }

  buffer(expression: string): ArrayBuffer {
    return this.#gil(() => {
      const api = this.#api;
      const object = this.#evaluate(expression, Py_eval_input);
      if (!object) throw this.#error();
      const view = new Uint8Array(PY_BUFFER_SIZE);
      const status = api.PyObject_GetBuffer(object, ptr(view), PyBUF_CONTIG);
      api.Py_DecRef(object);
      if (status !== 0) throw this.#error();
      const fields = new DataView(view.buffer);
      const address = fields.getBigUint64(0, true);
      const length = fields.getBigInt64(16, true);
      if (length > BigInt(Number.MAX_SAFE_INTEGER) || length < 0n || (address === 0n && length !== 0n)) {
        api.PyBuffer_Release(ptr(view));
        throw new PythonError(PyStatus.Unsupported, "Python buffer cannot be represented by JavaScript");
      }
      if (length === 0n) {
        api.PyBuffer_Release(ptr(view));
        return new ArrayBuffer(0);
      }
      // The exporter stays pinned by the Py_buffer until the ArrayBuffer is collected.
      const buffer = toArrayBuffer(Number(address) as unknown as Pointer, 0, Number(length));
      this.#buffers.register(buffer, view);
      return buffer;
    });
  }

  release(): void {
    const last = this.#gil(() =>
      this.#str(
        this.#evaluate(
          `(lambda s, t: (setattr(s, '_bun_py_leases', s._bun_py_leases - 1), ` +
            `s._bun_py_leases == 0 and getattr(s, '_bun_py_owner', None) == t.get_ident())[1])` +
            `(__import__('sys'), __import__('threading'))`,
          Py_eval_input,
        ),
      ),
    );
    if (last === "True" && this.started) {
      this.#api.PyGILState_Ensure();
      this.#state.finalized = true;
      const status = this.#api.Py_FinalizeEx();
      if (status !== 0) throw new PythonError(PyStatus.Python, `Py_FinalizeEx returned ${status}`);
    }
  }

  unload(): void {}
}

function openCapi(libpython: string): PythonBackend {
  return new CapiBackend(libpython);
}

export {
  Python,
  PythonAsync,
  PythonError,
  PyStatus,
  pythonHostLibraryPath,
  buvLibpython,
  buvLibpython as vuLibpython,
  libpythonIn,
  findLibpython,
  uvLibpython,
  systemLibpython,
  type PythonOpenOptions,
};

/** The fork's `bun:python` default export shape. */
export default {
  Python,
  PythonAsync,
  PythonError,
  PyStatus,
  pythonHostLibraryPath,
  buvLibpython,
  vuLibpython: buvLibpython,
  libpythonIn,
  findLibpython,
};
