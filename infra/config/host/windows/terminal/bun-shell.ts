// Interactive Bun Shell for the Windows Terminal and Rio "Bun Shell" profiles: each line runs through `$`.
// Prompt colours come from aphrody-m3.prompt.json (`aphrody identity terminal-theme`), APHRODY_THEME=light
// picks the light palette. Shell integration: OSC 133 A/B/C/D marks, OSC 7 and 9;9 cwd, OSC 0 title,
// OSC 9;4 progress for commands over 1 s, synchronized output (DECSET 2026) around prompt redraws.
// History lives in $APHRODY_HOME/bun-shell-history (default ~/.aphrody); arrows browse it on a TTY.
//
// Runs on the unmodified upstream Bun canary. The fork-only modules map as follows:
//   bun:windows -> windowsHost() of @aphrody/winclean/windows-host (bun:ffi + @aphrody/winreg + Bun.spawnSync), win32 only;
//   bun:linux   -> a small node:os / /proc / Bun.spawn host (`linux`), linux only;
//   bun:wasm    -> the standard WebAssembly global (`wasm`: compile, instantiate, validate, Module, Instance).
// No upstream equivalent, removed: wasm.build / wasm.optimize (wasm toolchain); the linux namespace, cgroup, seccomp and
// io_uring helpers; the native coreutils (nproc) probe, now os.availableParallelism().
import { $ } from "bun";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { availableParallelism, homedir, hostname, loadavg, release, totalmem, freemem, uptime } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import promptPalettes from "./aphrody-m3.prompt.json";

const ESC = "\x1b";
const ST = `${ESC}\\`;
export const seq = {
  promptStart: `${ESC}]133;A${ST}`,
  promptEnd: `${ESC}]133;B${ST}`,
  outputStart: `${ESC}]133;C${ST}`,
  finished: (code?: number) => `${ESC}]133;D${code === undefined ? "" : `;${code}`}${ST}`,
  title: (text: string) => `${ESC}]0;${Array.from(text, c => (c < " " || c === "\x7f" ? " " : c)).join("")}${ST}`,
  cwd: (dir: string, host = hostname()) =>
    `${ESC}]7;file://${host}${pathToFileURL(dir).pathname}${ST}${ESC}]9;9;${dir}${ST}`,
  progressBusy: `${ESC}]9;4;3${ST}`,
  progressClear: `${ESC}]9;4;0${ST}`,
  syncStart: `${ESC}[?2026h`,
  syncEnd: `${ESC}[?2026l`,
};

// ---------------------------------------------------------------------------------------------- prompt

type Swatch = { hex: string; ansi256: number };
type PromptKey = "brand" | "cwd" | "git" | "symbol" | "success" | "error" | "duration" | "muted" | "text";
export type Palette = Record<PromptKey, Swatch>;
export type ColorMode = "truecolor" | "256" | "none";

export function colorMode(env: Record<string, string | undefined>): ColorMode {
  if (env.NO_COLOR) return "none";
  const truecolor =
    /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "") ||
    !!env.WT_SESSION ||
    !!env.KITTY_WINDOW_ID ||
    /^(rio|vscode|WezTerm|iTerm\.app|ghostty)$/i.test(env.TERM_PROGRAM ?? "");
  return truecolor ? "truecolor" : "256";
}

export function loadPalette(
  theme: string | undefined,
  file = join(import.meta.dir, "aphrody-m3.prompt.json"),
): Palette | undefined {
  try {
    const all = JSON.parse(readFileSync(file, "utf8"));
    return all[theme === "light" ? "light" : "dark"];
  } catch {
    if (file === join(import.meta.dir, "aphrody-m3.prompt.json"))
      return promptPalettes[theme === "light" ? "light" : "dark"];
    return undefined;
  }
}

function paint(palette: Palette | undefined, mode: ColorMode, key: PromptKey, text: string, bold = false): string {
  const s = palette?.[key];
  if (!s || mode === "none") return text;
  const fg =
    mode === "truecolor"
      ? `38;2;${parseInt(s.hex.slice(1, 3), 16)};${parseInt(s.hex.slice(3, 5), 16)};${parseInt(s.hex.slice(5, 7), 16)}`
      : `38;5;${s.ansi256}`;
  return `${ESC}[${bold ? "1;" : ""}${fg}m${text}${ESC}[0m`;
}

export function gitBranch(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const git = join(d, ".git");
    if (existsSync(git)) {
      try {
        let head = join(git, "HEAD");
        if (!existsSync(head)) {
          const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, "utf8"));
          if (!pointer) return undefined;
          head = join(resolve(d, pointer[1].trim()), "HEAD");
        }
        const ref = readFileSync(head, "utf8").trim();
        return ref.startsWith("ref: refs/heads/") ? ref.slice(16) : ref.slice(0, 9);
      } catch {
        return undefined;
      }
    }
    if (dirname(d) === d) return undefined;
  }
}

export type PromptState = {
  cwd: string;
  home: string;
  lastCode?: number;
  lastMs?: number;
  branch?: string;
};

/** The visible prompt and its width in cells. */
export function renderPrompt(
  st: PromptState,
  palette: Palette | undefined,
  mode: ColorMode,
): { text: string; width: number } {
  const shown = st.cwd.startsWith(st.home) ? "~" + st.cwd.slice(st.home.length) : st.cwd;
  const parts: [PromptKey, string, boolean?][] = [
    ["brand", "bun", true],
    ["text", " "],
    ["cwd", shown],
  ];
  if (st.branch) parts.push(["text", " "], ["symbol", "("], ["git", st.branch], ["symbol", ")"]);
  if (st.lastMs !== undefined && st.lastMs >= 1000)
    parts.push(["text", " "], ["duration", `${(st.lastMs / 1000).toFixed(1)}s`]);
  const failed = st.lastCode !== undefined && st.lastCode !== 0;
  if (failed) parts.push(["text", " "], ["error", `[${st.lastCode}]`]);
  parts.push(["text", " "], [failed ? "error" : "success", "❯"], ["text", " "]);
  const text = parts.map(([k, t, b]) => (k === "text" ? t : paint(palette, mode, k, t, b))).join("");
  return { text, width: Bun.stringWidth(parts.map(p => p[1]).join("")) };
}

// --------------------------------------------------------------------------------------------- history

export class History {
  entries: string[] = [];
  constructor(readonly file: string) {
    try {
      this.entries = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
      if (this.entries.length > 10_000) {
        this.entries = this.entries.slice(-5_000);
        writeFileSync(file, this.entries.join("\n") + "\n");
      }
    } catch {}
  }
  add(line: string) {
    if (!line || line === this.entries.at(-1)) return;
    this.entries.push(line);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, line + "\n");
    } catch {}
  }
}

// ----------------------------------------------------------------------------------------- line editor

/** Splits raw terminal input into keys: one escape sequence or one code point each. */
export function keys(chunk: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < chunk.length;) {
    if (chunk[i] === ESC && chunk[i + 1] === "[") {
      let j = i + 2;
      while (j < chunk.length && !/[\x40-\x7e]/.test(chunk[j])) j++;
      out.push(chunk.slice(i, j + 1));
      i = j + 1;
    } else if (chunk[i] === ESC && chunk[i + 1] === "O" && i + 2 < chunk.length) {
      out.push(chunk.slice(i, i + 3));
      i += 3;
    } else {
      const cp = chunk.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      out.push(chunk.slice(i, i + len));
      i += len;
    }
  }
  return out;
}

export type EditResult = "submit" | "eof" | "cancel" | "clear" | undefined;

export class LineEditor {
  buf = "";
  cur = 0;
  private index: number;
  private draft = "";
  constructor(private readonly history: readonly string[]) {
    this.index = history.length;
  }
  private set(text: string) {
    this.buf = text;
    this.cur = text.length;
  }
  feed(key: string): EditResult {
    const { buf, cur } = this;
    switch (key) {
      case "\r":
      case "\n":
        return "submit";
      case "\x03":
        return "cancel";
      case "\x04":
        if (!buf) return "eof";
        if (cur < buf.length) this.buf = buf.slice(0, cur) + buf.slice(cur + 1);
        return;
      case "\x0c":
        return "clear";
      case "\x7f":
      case "\b":
        if (cur > 0) {
          this.buf = buf.slice(0, cur - 1) + buf.slice(cur);
          this.cur--;
        }
        return;
      case `${ESC}[3~`:
        this.buf = buf.slice(0, cur) + buf.slice(cur + 1);
        return;
      case `${ESC}[D`:
      case `${ESC}OD`:
      case "\x02":
        this.cur = Math.max(0, cur - 1);
        return;
      case `${ESC}[C`:
      case `${ESC}OC`:
      case "\x06":
        this.cur = Math.min(buf.length, cur + 1);
        return;
      case `${ESC}[H`:
      case `${ESC}OH`:
      case `${ESC}[1~`:
      case "\x01":
        this.cur = 0;
        return;
      case `${ESC}[F`:
      case `${ESC}OF`:
      case `${ESC}[4~`:
      case "\x05":
        this.cur = buf.length;
        return;
      case "\x15":
        this.buf = buf.slice(cur);
        this.cur = 0;
        return;
      case "\x0b":
        this.buf = buf.slice(0, cur);
        return;
      case "\x17": {
        const start = buf.slice(0, cur).replace(/\S+\s*$/, "").length;
        this.buf = buf.slice(0, start) + buf.slice(cur);
        this.cur = start;
        return;
      }
      case `${ESC}[A`:
      case `${ESC}OA`:
      case "\x10":
        if (this.index > 0) {
          if (this.index === this.history.length) this.draft = buf;
          this.set(this.history[--this.index]);
        }
        return;
      case `${ESC}[B`:
      case `${ESC}OB`:
      case "\x0e":
        if (this.index < this.history.length) {
          this.index++;
          this.set(this.index === this.history.length ? this.draft : this.history[this.index]);
        }
        return;
    }
    if (key.startsWith(ESC) || key.charCodeAt(0) < 0x20) return;
    this.buf = buf.slice(0, cur) + key + buf.slice(cur);
    this.cur += key.length;
  }
}

/**
 * Redraw of prompt + buffer, inside one synchronized update. `row` is the cursor's row inside the
 * edited block before the redraw; returns the new one.
 */
export function redraw(
  prompt: { text: string; width: number },
  ed: LineEditor,
  columns: number,
  row: number,
): { out: string; row: number } {
  const w = Math.max(1, columns);
  const end = prompt.width + Bun.stringWidth(ed.buf);
  const at = prompt.width + Bun.stringWidth(ed.buf.slice(0, ed.cur));
  let out = seq.syncStart + (row > 0 ? `${ESC}[${row}A` : "") + `\r${ESC}[J` + prompt.text + ed.buf;
  // At an exact multiple of the width the cursor waits in the last column; force the wrap.
  if (end > 0 && end % w === 0) out += " \r";
  const endRow = Math.floor(end / w);
  const atRow = Math.floor(at / w);
  if (endRow > atRow) out += `${ESC}[${endRow - atRow}A`;
  out += "\r" + (at % w > 0 ? `${ESC}[${at % w}C` : "");
  return { out: out + seq.syncEnd, row: atRow };
}

// ------------------------------------------------------------------------------------------------ img

export type ImageProtocol = "kitty" | "sixel" | "iterm";

export function imageProtocol(env: Record<string, string | undefined>): ImageProtocol {
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || /^ghostty$/i.test(env.TERM_PROGRAM ?? "")) return "kitty";
  if (/^(iTerm\.app|WezTerm|vscode|rio)$/i.test(env.TERM_PROGRAM ?? "")) return "iterm";
  // Windows Terminal (1.22+) and VTE decode DECSIXEL.
  return "sixel";
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export function kittyImage(png: Uint8Array): string {
  const data = b64(png);
  const chunks = data.match(/.{1,4096}/g) ?? [""];
  return chunks
    .map((c, i) => {
      const more = i < chunks.length - 1 ? 1 : 0;
      return `${ESC}_G${i === 0 ? "a=T,f=100,q=2," : ""}m=${more};${c}${ST}`;
    })
    .join("");
}

export function itermImage(bytes: Uint8Array, name = "image"): string {
  return `${ESC}]1337;File=name=${b64(new TextEncoder().encode(name))};size=${bytes.length};inline=1;preserveAspectRatio=1:${b64(bytes)}\x07`;
}

export type IndexedImage = {
  width: number;
  height: number;
  palette: Uint8Array;
  alpha?: Uint8Array;
  pixels: Uint8Array;
};

/** Decodes an indexed-colour (type 3) PNG: what `Bun.Image#png({ palette: true })` writes. */
export function decodeIndexedPng(png: Uint8Array): IndexedImage {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0,
    height = 0,
    depth = 8,
    palette = new Uint8Array(0);
  let alpha: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= png.length;) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const body = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      depth = body[8];
      if (body[9] !== 3) throw new Error(`PNG colour type ${body[9]} is not indexed`);
      if (body[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "PLTE") palette = body.slice();
    else if (type === "tRNS") alpha = body.slice();
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * depth) / 8);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? row[x - 1] : 0,
        b = up[x],
        c = x > 0 ? up[x - 1] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height);
  const perByte = 8 / depth,
    mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const byte = rows[y * stride + Math.floor(x / perByte)];
      pixels[y * width + x] = (byte >> (8 - depth * ((x % perByte) + 1))) & mask;
    }
  return { width, height, palette, alpha, pixels };
}

const pct = (v: number) => Math.round((v * 100) / 255);

/** DECSIXEL of an indexed image; pixels whose palette alpha is under 128 stay transparent. */
export function sixel({ width: w, height: h, palette, alpha, pixels }: IndexedImage): string {
  const colors = palette.length / 3;
  let out = `${ESC}P0;1;0q"1;1;${w};${h}`;
  for (let i = 0; i < colors; i++)
    out += `#${i};2;${pct(palette[i * 3])};${pct(palette[i * 3 + 1])};${pct(palette[i * 3 + 2])}`;
  const bits = new Uint8Array(colors * w);
  for (let top = 0; top < h; top += 6) {
    bits.fill(0);
    const used = new Set<number>();
    for (let dy = 0; dy < 6 && top + dy < h; dy++)
      for (let x = 0; x < w; x++) {
        const c = pixels[(top + dy) * w + x];
        if (alpha && c < alpha.length && alpha[c] < 128) continue;
        bits[c * w + x] |= 1 << dy;
        used.add(c);
      }
    const bands: string[] = [];
    for (const c of [...used].toSorted((a, b) => a - b)) {
      let line = `#${c}`;
      const row = bits.subarray(c * w, (c + 1) * w);
      let last = w;
      while (last > 0 && row[last - 1] === 0) last--;
      for (let x = 0; x < last;) {
        let n = 1;
        while (x + n < last && row[x + n] === row[x]) n++;
        const ch = String.fromCharCode(63 + row[x]);
        line += n > 3 ? `!${n}${ch}` : ch.repeat(n);
        x += n;
      }
      bands.push(line);
    }
    out += bands.join("$") + (top + 6 < h ? "-" : "");
  }
  return out + ST;
}

export async function img(
  args: string[],
  env: Record<string, string | undefined>,
  columns: number,
  rows: number,
): Promise<string> {
  const flags = args.filter(a => a.startsWith("--"));
  const file = args.find(a => !a.startsWith("--"));
  if (!file) throw new Error("usage: img [--kitty|--sixel|--iterm] <file>");
  const forced = flags
    .map(f => f.slice(2))
    .find((f): f is ImageProtocol => f === "kitty" || f === "sixel" || f === "iterm");
  const protocol = forced ?? imageProtocol(env);
  // Sixel cells are 10×20 pixels in Windows Terminal (VT340 geometry).
  const image = () =>
    new Bun.Image(resolve(file)).resize(Math.max(1, columns) * 10, Math.max(1, rows - 2) * 20, {
      fit: "inside",
      withoutEnlargement: true,
    });
  if (protocol === "sixel")
    return sixel(decodeIndexedPng(await image().png({ palette: true, colors: 256, dither: true }).bytes())) + "\n";
  const png = await image().png().bytes();
  return (protocol === "kitty" ? kittyImage(png) : itermImage(png, file)) + "\n";
}

// ----------------------------------------------------------------------------------------------- main

const out = (s: string) => writeSync(1, s);
const expand = (p: string, home: string) =>
  p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? home + p.slice(1) : p;
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

const unsupported = (name: string, why: string) => () => {
  throw new Error(`${name} is not available on upstream Bun (${why})`);
};

/** WebAssembly through the standard global; the fork's wasm build and optimize toolchain has no upstream equivalent. */
export function wasmHost() {
  return {
    compile: WebAssembly.compile,
    instantiate: WebAssembly.instantiate,
    validate: WebAssembly.validate,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
    Memory: WebAssembly.Memory,
    Table: WebAssembly.Table,
    build: unsupported("wasm.build", "use an external wasm toolchain"),
    optimize: unsupported("wasm.optimize", "use an external wasm toolchain"),
  };
}

/** Linux host facts from node:os and Bun.spawn; namespaces, cgroups, seccomp and io_uring have no upstream API. */
export function linuxHost() {
  return {
    release,
    uptime,
    loadavg,
    memory: () => ({ total: totalmem(), free: freemem() }),
    cpus: availableParallelism,
    exec: async (cmd: string, ...args: string[]) => {
      await using proc = Bun.spawn({ cmd: [cmd, ...args], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([Bun.readableStreamToText(proc.stdout), Bun.readableStreamToText(proc.stderr), proc.exited]);
      return { stdout, stderr, code };
    },
  };
}

export async function loadNativeModules(platform: NodeJS.Platform = process.platform) {
  const windows =
    platform === "win32" && process.platform === "win32"
      ? (await import("@aphrody/winclean/windows-host")).windowsHost()
      : undefined;
  const linux = platform === "linux" ? linuxHost() : undefined;
  return { windows, linux, wasm: wasmHost(), $ };
}

type NativeModules = Awaited<ReturnType<typeof loadNativeModules>>;

/** The logical CPU count, like `nproc`; the fork-only native coreutils probe is replaced by node:os. */
export async function probeCoreutils(): Promise<number> {
  const count = availableParallelism();
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Bun Shell could not read the CPU count.");
  return count;
}

export async function evaluateNative(expression: string, modules: NativeModules): Promise<unknown> {
  const evaluate = new Function("windows", "linux", "wasm", "$", `return (async () => (${expression}))()`);
  return await evaluate(modules.windows, modules.linux, modules.wasm, modules.$);
}

/** Runs one line; returns its exit code. */
async function run(line: string, home: string, modules: NativeModules): Promise<number> {
  const js = /^js(?:\s+([\s\S]+))?$/.exec(line);
  if (js) {
    try {
      if (!js[1]) throw new Error("Usage: js <expression> — windows, linux, wasm, $ (Bun Shell)");
      const result = await evaluateNative(js[1], modules);
      if (result !== undefined) console.log(Bun.inspect(result, { colors: false }));
      return 0;
    } catch (e) {
      console.error(`js: ${(e as Error).message}`);
      return 1;
    }
  }
  const cd = /^cd(?:\s+(.+))?$/.exec(line);
  if (cd) {
    try {
      process.chdir(resolve(expand(unquote(cd[1] ?? "") || "~", home)));
      return 0;
    } catch (e) {
      console.error(`cd: ${(e as Error).message}`);
      return 1;
    }
  }
  const exp = /^export\s+([A-Za-z_]\w*)=(.*)$/.exec(line);
  if (exp) {
    process.env[exp[1]] = unquote(exp[2]);
    return 0;
  }
  const image = /^img(?:\s+(.*))?$/.exec(line);
  if (image) {
    try {
      out(
        await img(
          (image[1] ?? "").split(/\s+/).filter(Boolean).map(unquote),
          process.env,
          process.stdout.columns ?? 80,
          process.stdout.rows ?? 24,
        ),
      );
      return 0;
    } catch (e) {
      console.error(`img: ${(e as Error).message}`);
      return 1;
    }
  }
  try {
    return (await $`${{ raw: line }}`.cwd(process.cwd()).env(process.env).nothrow()).exitCode;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

async function readKeys(): Promise<string> {
  return await new Promise(res => process.stdin.once("data", d => res(d.toString("utf8"))));
}

async function main() {
  const modules = await loadNativeModules();
  await probeCoreutils();
  const env = process.env;
  const home = homedir();
  const mode = colorMode(env);
  const palette = loadPalette(env.APHRODY_THEME);
  const progressMs = Number(env.BUN_SHELL_PROGRESS_MS ?? 1000);
  const tty = !!process.stdin.isTTY;
  const history = new History(join(env.APHRODY_HOME ?? join(home, ".aphrody"), "bun-shell-history"));
  const state: PromptState = { cwd: process.cwd(), home };

  const prompt = () => {
    state.cwd = process.cwd();
    state.branch = gitBranch(state.cwd);
    const p = renderPrompt(state, palette, mode);
    const shown = state.cwd.startsWith(home) ? "~" + state.cwd.slice(home.length) : state.cwd;
    out(
      seq.syncStart +
        seq.cwd(state.cwd) +
        seq.title(`bun ${shown}`) +
        seq.promptStart +
        p.text +
        seq.promptEnd +
        seq.syncEnd,
    );
    return p;
  };

  const execute = async (line: string) => {
    if (!line) {
      out(seq.finished());
      return;
    }
    out(seq.outputStart + seq.title(line));
    const started = performance.now();
    let busy = false;
    const showBusy = () => {
      busy = true;
      out(seq.progressBusy);
    };
    // BUN_SHELL_PROGRESS_MS=0 marks every command busy at once (tests).
    const timer = progressMs > 0 ? setTimeout(showBusy, progressMs) : (showBusy(), undefined);
    const code = await run(line, home, modules);
    clearTimeout(timer);
    if (busy) out(seq.progressClear);
    state.lastCode = code;
    state.lastMs = performance.now() - started;
    out(seq.finished(code));
  };

  process.on("SIGINT", () => {});
  if (!tty) {
    prompt();
    for await (const raw of console) {
      const line = raw.trim();
      if (line === "exit" || line === "quit") break;
      await execute(line);
      prompt();
    }
    return;
  }

  const platform = modules.windows ? "windows host" : modules.linux ? "linux host" : "portable";
  out(`Bun Shell ${Bun.version} · ${platform} · WebAssembly — js <expression>, exit
`);
  for (;;) {
    const p = prompt();
    const ed = new LineEditor(history.entries);
    let row = 0;
    let result: EditResult;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    edit: for (;;) {
      for (const key of keys(await readKeys())) {
        result = ed.feed(key);
        if (result === "clear") {
          out(`${ESC}[H${ESC}[2J`);
          row = 0;
          result = undefined;
        }
        if (result) break edit;
      }
      const r = redraw(p, ed, process.stdout.columns ?? 80, row);
      out(r.out);
      row = r.row;
    }
    process.stdin.setRawMode(false);
    process.stdin.pause();
    // Leave the cursor after the whole input before the command writes.
    ed.cur = ed.buf.length;
    out(redraw(p, ed, process.stdout.columns ?? 80, row).out + "\r\n");
    if (result === "eof") break;
    if (result === "cancel") {
      out(seq.finished());
      continue;
    }
    const line = ed.buf.trim();
    if (line === "exit" || line === "quit") break;
    history.add(line);
    await execute(line);
  }
  out(seq.progressClear);
}

if (import.meta.main) {
  // Older compiled runtimes dispatch the embedded entry before coreutils; stop the probe here.
  if (process.env.BUN_RIO_COREUTILS_PROBE === "1") process.exit(127);
  try {
    await main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
