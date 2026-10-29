// SPDX-License-Identifier: Apache-2.0
// Bun Engine: a TypeScript playground on the Rust VFS. Everything in the capability list is either really
// provided here or listed as unavailable; nothing is simulated.
//
// Real: esbuild-wasm (NOT Bun's transpiler) transpiles and bundles the project; the bundle runs in a module
// worker with a hard time limit; Bun.file/Bun.write/Bun.sleep are small shims over the VFS (not Bun).
import { h } from "../dom";
import { webos, HOME } from "../os";

const PROJECT = `${HOME}/Projects/playground`;
const ESBUILD_BASE = "/engine/esbuild";
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];
const LOADERS: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".json": "json",
  ".txt": "text",
  ".md": "text",
};
const MAX_LINES = 5000;
const MAX_CHARS = 1_000_000;
const GRACE_MS = 300;

const SEED: Record<string, string> = {
  "index.ts": `import { fib, type Point, distance } from "./math";
import data from "./data.json";

const origin: Point = { x: 0, y: 0 };
console.log("fib(24) =", fib(24));
console.log("distance =", distance(origin, { x: 3, y: 4 }));
console.log("data =", data);

// Bun.file and Bun.write work on this project's files (the Rust VFS).
await Bun.write("out.txt", "written at " + new Date().toISOString());
console.log("read back:", await Bun.file("out.txt").text());
`,
  "math.ts": `export interface Point {
  x: number;
  y: number;
}

export const fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
`,
  "data.json": `{ "name": "playground", "files": 3 }\n`,
};

interface Esbuild {
  initialize(options: { wasmURL: string }): Promise<void>;
  transform(code: string, options: Record<string, unknown>): Promise<{ code: string; warnings: Msg[] }>;
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[]; warnings: Msg[] }>;
  version: string;
}
interface Msg {
  text: string;
  location?: { file: string; line: number; column: number; lineText: string } | null;
}

let esbuildPromise: Promise<Esbuild> | undefined;
/** esbuild-wasm, loaded on first use from /engine/esbuild (13.9 MB wasm, MIT). */
function loadEsbuild(): Promise<Esbuild> {
  esbuildPromise ??= (async () => {
    const mod = (await import(/* @vite-ignore */ `${ESBUILD_BASE}/browser.js`)) as Esbuild;
    await mod.initialize({ wasmURL: `${location.origin}${ESBUILD_BASE}/esbuild.wasm` });
    return mod;
  })().catch(error => {
    esbuildPromise = undefined;
    throw error;
  });
  return esbuildPromise;
}

// Runs first in the module worker, before the bundle. Names are prefixed to stay clear of user code.
const PRELUDE = `
const __rpc = (op, path, data) => new Promise((resolve, reject) => {
  const id = ++__rpc.n;
  __rpc.p.set(id, { resolve, reject });
  self.postMessage({ kind: "rpc", id, op, path, data });
});
__rpc.n = 0;
__rpc.p = new Map();
self.addEventListener("message", ({ data }) => {
  const p = __rpc.p.get(data.id);
  if (!p) return;
  __rpc.p.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
});
const __fmt = v => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || String(v);
  try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
};
for (const [name, kind] of [["log", "log"], ["info", "log"], ["debug", "log"], ["warn", "err"], ["error", "err"]]) {
  console[name] = (...a) => self.postMessage({ kind, text: a.map(__fmt).join(" ") });
}
const __file = path => ({
  path,
  async exists() { return __rpc("exists", path); },
  async bytes() { return new Uint8Array(await __rpc("read", path)); },
  async arrayBuffer() { return (await this.bytes()).buffer; },
  async text() { return new TextDecoder().decode(await this.bytes()); },
  async json() { return JSON.parse(await this.text()); },
});
globalThis.Bun = Object.freeze({
  file: __file,
  async write(path, data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    await __rpc("write", path, bytes);
    return bytes.byteLength;
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
});
`;

const EPILOGUE = `\n;self.postMessage({ kind: "done" });\n`;

type Status = "yes" | "no";
interface Capability {
  name: string;
  status: Status;
  detail: string;
}
const CAPABILITIES: Capability[] = [
  {
    name: "TypeScript, TSX, JSX, JSON: transpile and bundle",
    status: "yes",
    detail: `esbuild-wasm, loaded from ${ESBUILD_BASE}. This is esbuild, not Bun's transpiler (Bun's lives in the native binary).`,
  },
  {
    name: "Multi-file project on the Rust VFS",
    status: "yes",
    detail: `Files under ${PROJECT} (OPFS, aphrody-shell-vfs). Relative imports resolve with .ts .tsx .js .jsx .mjs .json and index files.`,
  },
  {
    name: "Isolated run with a time limit",
    status: "yes",
    detail: "Module worker from a blob, terminated at the limit. No DOM, no access to the page; file access only through the shims below.",
  },
  {
    name: "Bun.file (text, json, bytes, arrayBuffer, exists), Bun.write, Bun.sleep",
    status: "yes",
    detail: "Shims over the VFS, limited to /home/user. They are not Bun: no Bun.file().size, no streams, no Blob return.",
  },
  {
    name: "Bun.semver, Bun.$ shell parser, Bun.markdown",
    status: "no",
    detail:
      "The Rust crate bun_wasm (src/wasm of the Bun fork) exports them, but this desktop ships no bun_wasm build: it targets wasm32-wasip1-threads and needs WASI thread imports and shared memory.",
  },
  {
    name: "fmt, lint (bun_quality)",
    status: "no",
    detail: "src/quality is an rlib over oxfmt and oxc_linter with no wasm target or export; native only for now.",
  },
  {
    name: "check (type check)",
    status: "no",
    detail: "Native tsgo/tsc. The browser only reports syntax errors from the transpile step.",
  },
  {
    name: "bun:* modules, Bun.serve, Bun.spawn, Bun.Transpiler, bun test, bun install, bun:ffi",
    status: "no",
    detail: "Need the native Bun binary (JavaScriptCore, sockets, processes). Bare package imports are rejected: no registry or node_modules here.",
  },
  {
    name: "bun:rio terminal screen (src/vt)",
    status: "no",
    detail: "Dependency-free crate but not exported to wasm. The Terminal app already uses the Rio VT state of aphrody-shell-web.",
  },
];

const join = (base: string, rel: string) => {
  const out: string[] = [];
  for (const part of `${base}/${rel}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};
const extname = (p: string) => {
  const i = p.lastIndexOf(".");
  return i > p.lastIndexOf("/") ? p.slice(i) : "";
};

/** TypeScript playground: edit a multi-file project on the Rust VFS, bundle with esbuild-wasm, run in a worker. */
export async function engineApp(root: HTMLElement) {
  const os = await webos();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const stat = (path: string) => {
    try {
      return JSON.parse(os.fs.stat(path)) as { kind: string; size: number };
    } catch {
      return undefined;
    }
  };
  const ensureProject = () => {
    if (stat(PROJECT)) return;
    os.fs.mkdir(PROJECT);
    for (const [name, text] of Object.entries(SEED)) os.fs.write(`${PROJECT}/${name}`, enc.encode(text));
  };
  ensureProject();

  /** Project-relative paths of every file, depth first. */
  const listFiles = (dir = PROJECT, prefix = ""): string[] => {
    const entries = JSON.parse(os.fs.list(dir)) as { name: string; kind: string }[];
    return entries.flatMap(e => (e.kind === "dir" ? listFiles(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
  };

  let files = listFiles();
  let active = files.includes("index.ts") ? "index.ts" : (files[0] ?? "");
  let entry = files.includes("index.ts") ? "index.ts" : (files[0] ?? "");
  let view: "console" | "js" | "caps" = "console";
  let worker: Worker | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const code = h("textarea", { class: "editor", spellcheck: "false", "aria-label": "Code" });
  const list = h("div", { class: "engine-files", role: "listbox", "aria-label": "Project files" });
  const out = h("div", { class: "engine-out", "aria-live": "polite" });
  const status = h("div", { class: "files-status" });
  const newName = h("input", { class: "fld", placeholder: "new-file.ts", "aria-label": "New file name" });
  const entrySel = h("select", { class: "fld", "aria-label": "Entry file" });
  const limitSel = h("select", { class: "fld", "aria-label": "Time limit" });
  for (const s of [1, 5, 30]) limitSel.append(h("option", { value: s }, `${s} s limit`));
  limitSel.value = "5";
  const tabs = h("div", { class: "engine-tabs", role: "tablist" });

  const say = (text: string) => {
    status.textContent = text;
  };
  const clear = () => out.replaceChildren();
  const line = (text: string, cls = "") => out.append(h("div", { class: `engine-line ${cls}`.trim() }, text));
  const flush = () => void os.flush();

  const saveNow = () => {
    clearTimeout(saveTimer);
    if (!active || !dirty) return;
    dirty = false;
    os.fs.write(`${PROJECT}/${active}`, enc.encode(code.value));
    flush();
  };
  const scheduleSave = () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  };

  const renderList = () => {
    list.replaceChildren(
      ...files.map(f =>
        h(
          "button",
          { class: `engine-file${f === active ? " sel" : ""}`, role: "option", "aria-selected": f === active, onclick: () => open(f) },
          f,
        ),
      ),
    );
    entrySel.replaceChildren(...files.map(f => h("option", { value: f }, `entry: ${f}`)));
    entrySel.value = entry;
  };
  const open = (file: string) => {
    saveNow();
    active = file;
    code.value = dec.decode(os.fs.read(`${PROJECT}/${file}`));
    renderList();
  };
  const refresh = () => {
    files = listFiles();
    if (!files.includes(active)) active = files[0] ?? "";
    if (!files.includes(entry)) entry = active;
    renderList();
  };

  const messageText = (m: Msg) => (m.location ? `${m.location.file}:${m.location.line}:${m.location.column + 1} ${m.text}` : m.text);
  const showErrors = (error: unknown) => {
    const errors = (error as { errors?: Msg[] }).errors;
    if (errors?.length) for (const m of errors) line(messageText(m), "err");
    else line(String((error as Error)?.message ?? error), "err");
  };

  // esbuild plugin: resolve and load only from the VFS project.
  const vfsPlugin = {
    name: "vfs",
    setup(build: {
      onResolve(o: { filter: RegExp }, cb: (a: { path: string; importer: string; kind: string }) => unknown): void;
      onLoad(o: { filter: RegExp; namespace: string }, cb: (a: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === "entry-point") return { path: join(PROJECT, args.path), namespace: "vfs" };
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          const why = args.path.startsWith("bun:") || args.path === "bun" ? "Bun modules are not available in the browser" : "bare package imports are not available (no registry or node_modules)";
          return { errors: [{ text: `Cannot import "${args.path}": ${why}` }] };
        }
        const base = args.path.startsWith("/") ? args.path : join(args.importer.replace(/\/[^/]*$/, ""), args.path);
        const candidates = [base, ...EXTENSIONS.map(e => base + e), ...EXTENSIONS.map(e => `${base}/index${e}`)];
        const hit = candidates.find(c => stat(c)?.kind === "file");
        return hit ? { path: hit, namespace: "vfs" } : { errors: [{ text: `Could not resolve "${args.path}" from ${args.importer}` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "vfs" }, args => ({
        contents: os.fs.read(args.path),
        loader: LOADERS[extname(args.path)] ?? "text",
      }));
    },
  };

  const bundle = async () => {
    const es = await loadEsbuild();
    const result = await es.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      sourcemap: false,
      logLevel: "silent",
      plugins: [vfsPlugin],
    });
    return { text: result.outputFiles[0]!.text, warnings: result.warnings };
  };

  // File operations requested by the worker's shims; confined to /home/user.
  const serve = (w: Worker, req: { id: number; op: string; path: string; data?: Uint8Array }) => {
    const reply = (result: unknown, error?: string) => w.postMessage({ id: req.id, result, error });
    try {
      const path = req.path.startsWith("/") ? join("/", req.path) : join(PROJECT, req.path);
      if (!path.startsWith(`${HOME}/`)) throw new Error(`Access outside ${HOME} is not allowed: ${path}`);
      if (req.op === "exists") reply(stat(path)?.kind === "file");
      else if (req.op === "read") reply(os.fs.read(path));
      else if (req.op === "write") {
        const dir = path.slice(0, path.lastIndexOf("/"));
        if (dir && !stat(dir)) os.fs.mkdir(dir);
        os.fs.write(path, req.data ?? new Uint8Array());
        flush();
        reply(true);
        refresh();
      } else throw new Error(`Unknown operation ${req.op}`);
    } catch (error) {
      reply(undefined, String((error as Error)?.message ?? error));
    }
  };

  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };

  const run = async () => {
    saveNow();
    stop();
    show("console");
    clear();
    say("Bundling…");
    let program: string;
    try {
      const b = await bundle();
      for (const m of b.warnings) line(messageText(m), "warn");
      program = PRELUDE + b.text + EPILOGUE;
    } catch (error) {
      showErrors(error);
      say("Build failed");
      return;
    }
    const limit = Number(limitSel.value) * 1000;
    const url = URL.createObjectURL(new Blob([program], { type: "text/javascript" }));
    const w = (worker = new Worker(url, { type: "module" }));
    URL.revokeObjectURL(url);
    const started = performance.now();
    let lines = 0;
    let chars = 0;
    const finish = (note: string, cls = "") => {
      clearTimeout(timer);
      if (worker === w) worker = undefined;
      w.terminate();
      line(`${note} (${Math.round(performance.now() - started)} ms)`, `engine-note ${cls}`.trim());
      say(note);
    };
    const timer = setTimeout(() => finish(`Timed out after ${limit / 1000} s, worker terminated`, "err"), limit);
    w.onmessage = ({ data }) => {
      if (worker !== w) return;
      if (data.kind === "rpc") serve(w, data);
      else if (data.kind === "done") setTimeout(() => worker === w && finish("Finished"), GRACE_MS);
      else if (lines < MAX_LINES && chars < MAX_CHARS) {
        lines++;
        chars += String(data.text).length;
        line(String(data.text), data.kind === "err" ? "err" : "");
      } else if (lines === MAX_LINES || chars >= MAX_CHARS) {
        lines = MAX_LINES + 1;
        finish("Output limit reached, worker terminated", "err");
      }
    };
    w.onerror = e => {
      e.preventDefault();
      if (worker !== w) return;
      line(e.message || "Uncaught error", "err");
      finish("Failed", "err");
    };
    say(`Running ${entry}…`);
  };

  const transpile = async () => {
    saveNow();
    show("js");
    out.replaceChildren();
    try {
      const es = await loadEsbuild();
      const ext = extname(active);
      const loader = LOADERS[ext];
      if (!loader || loader === "json" || loader === "text") {
        line(`${active}: nothing to transpile`, "warn");
        return;
      }
      const r = await es.transform(code.value, { loader, sourcefile: active, target: "es2022", format: "esm", logLevel: "silent" });
      for (const m of r.warnings) line(messageText(m), "warn");
      out.append(h("pre", { class: "engine-code" }, r.code));
      say(`Transpiled ${active} with esbuild-wasm ${es.version}`);
    } catch (error) {
      showErrors(error);
      say("Syntax errors");
    }
  };

  const renderCaps = () => {
    out.replaceChildren(
      h("div", { class: "engine-line engine-note" }, "Only what is marked available runs here. The rest is not simulated."),
      ...CAPABILITIES.map(c =>
        h(
          "div",
          { class: `engine-cap ${c.status}` },
          h("span", { class: "engine-badge" }, c.status === "yes" ? "available" : "unavailable"),
          h("div", { class: "engine-cap-body" }, h("strong", {}, c.name), h("div", {}, c.detail)),
        ),
      ),
    );
  };

  const consoleLog: Node[] = [];
  const show = (next: typeof view) => {
    if (view === "console" && next !== "console") consoleLog.splice(0, consoleLog.length, ...Array.from(out.childNodes));
    view = next;
    for (const t of Array.from(tabs.children)) t.classList.toggle("sel", (t as HTMLElement).dataset.v === next);
    if (next === "caps") renderCaps();
    else if (next === "console") out.replaceChildren(...consoleLog);
  };
  const tab = (id: typeof view, text: string) =>
    h("button", { class: `engine-tab${id === view ? " sel" : ""}`, role: "tab", "data-v": id, onclick: () => (id === "js" ? void transpile() : show(id)) }, text);
  tabs.append(tab("console", "Console"), tab("js", "Transpiled"), tab("caps", "Capabilities"));

  const addFile = () => {
    const name = newName.value.trim().replace(/^\/+/, "");
    if (!name || name.includes("..")) return say("Enter a file name inside the project");
    const path = join(PROJECT, name);
    if (!path.startsWith(`${PROJECT}/`)) return say("Enter a file name inside the project");
    if (stat(path)) return say(`${name} already exists`);
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (!stat(dir)) os.fs.mkdir(dir);
    os.fs.write(path, new Uint8Array());
    flush();
    newName.value = "";
    refresh();
    open(name);
  };
  const removeFile = () => {
    if (!active) return;
    const gone = active;
    clearTimeout(saveTimer);
    dirty = false;
    os.fs.remove(`${PROJECT}/${gone}`);
    flush();
    active = "";
    refresh();
    if (active) open(active);
    else code.value = "";
    say(`Removed ${gone}`);
  };

  code.addEventListener("input", scheduleSave);
  code.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      code.setRangeText("  ", code.selectionStart, code.selectionEnd, "end");
      scheduleSave();
    }
  });
  entrySel.addEventListener("change", () => {
    entry = entrySel.value;
  });
  newName.addEventListener("keydown", e => e.key === "Enter" && addFile());

  const btn = (text: string, fn: () => void, tonal = false) => h("button", { class: tonal ? "btn tonal" : "btn", onclick: fn }, text);
  root.append(
    h(
      "div",
      { class: "engine" },
      h(
        "div",
        { class: "files-bar" },
        btn("Run", () => void run()),
        btn("Stop", () => {
          stop();
          say("Stopped");
        }, true),
        entrySel,
        limitSel,
        h("span", { class: "grow" }),
        h("span", { class: "engine-tag", title: "Bun's own transpiler is native-only" }, "esbuild-wasm · not Bun"),
      ),
      h(
        "div",
        { class: "engine-main" },
        h(
          "div",
          { class: "engine-side" },
          list,
          h("div", { class: "engine-add" }, newName, btn("Add", addFile, true), btn("Delete", removeFile, true)),
        ),
        h("div", { class: "engine-work" }, code, tabs, out),
      ),
      status,
    ),
  );
  open(active || "");
  if (!active) code.value = "";
  show("console");
  say(`${PROJECT} · webos-wasm ${os.version} · ${os.persistent ? "OPFS" : "memory"} · Ctrl+Enter runs`);
}
