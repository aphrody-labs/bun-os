import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import {
  History,
  LineEditor,
  colorMode,
  decodeIndexedPng,
  evaluateNative,
  imageProtocol,
  img,
  keys,
  kittyImage,
  loadPalette,
  loadNativeModules,
  probeCoreutils,
  redraw,
  renderPrompt,
  sixel,
} from "./bun-shell.ts";

const script = join(import.meta.dir, "bun-shell.ts");
const visible = (s: string) => s.replaceAll("\x1b", "␛").replaceAll("\x07", "␇");

function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), "bun-shell-"));
  mkdirSync(join(dir, "sub"));
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

async function session(dir: string, input: string, extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    USERPROFILE: dir,
    HOME: dir,
    APHRODY_HOME: join(dir, ".aphrody"),
    APHRODY_THEME: "dark",
    COLORTERM: "truecolor",
    NO_COLOR: undefined,
    BUN_SHELL_PROGRESS_MS: undefined,
    ...extra,
  };
  await using proc = Bun.spawn({
    cmd: [process.execPath, script],
    cwd: dir,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  await proc.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  const url = pathToFileURL(dir).pathname;
  const norm = (s: string) =>
    visible(s.replaceAll(`${hostname()}${url}`, "HOST/TMP").replaceAll(url, "/TMP").replaceAll(dir, "TMP"));
  return { stdout: norm(stdout), stderr: norm(stderr), code };
}

test("piped session emits prompt marks, cwd, title and exit codes", async () => {
  using home = tempHome();
  const { stdout, stderr, code } = await session(home.dir, "echo hi\n\ncd sub\nfalse\nexit\n");
  expect(stderr).toBe("");
  expect(stdout.split("␛[?2026l")).toEqual([
    "␛[?2026h␛]7;file://HOST/TMP␛\\␛]9;9;TMP␛\\␛]0;bun ~␛\\␛]133;A␛\\␛[1;38;2;239;180;233mbun␛[0m ␛[38;2;99;211;255m~␛[0m ␛[38;2;160;215;86m❯␛[0m ␛]133;B␛\\",
    "␛]133;C␛\\␛]0;echo hi␛\\hi\n␛]133;D;0␛\\␛[?2026h␛]7;file://HOST/TMP␛\\␛]9;9;TMP␛\\␛]0;bun ~␛\\␛]133;A␛\\␛[1;38;2;239;180;233mbun␛[0m ␛[38;2;99;211;255m~␛[0m ␛[38;2;160;215;86m❯␛[0m ␛]133;B␛\\",
    "␛]133;D␛\\␛[?2026h␛]7;file://HOST/TMP␛\\␛]9;9;TMP␛\\␛]0;bun ~␛\\␛]133;A␛\\␛[1;38;2;239;180;233mbun␛[0m ␛[38;2;99;211;255m~␛[0m ␛[38;2;160;215;86m❯␛[0m ␛]133;B␛\\",
    "␛]133;C␛\\␛]0;cd sub␛\\␛]133;D;0␛\\␛[?2026h␛]7;file://HOST/TMP/sub␛\\␛]9;9;TMP\\sub␛\\␛]0;bun ~\\sub␛\\␛]133;A␛\\␛[1;38;2;239;180;233mbun␛[0m ␛[38;2;99;211;255m~\\sub␛[0m ␛[38;2;160;215;86m❯␛[0m ␛]133;B␛\\",
    "␛]133;C␛\\␛]0;false␛\\␛]133;D;1␛\\␛[?2026h␛]7;file://HOST/TMP/sub␛\\␛]9;9;TMP\\sub␛\\␛]0;bun ~\\sub␛\\␛]133;A␛\\␛[1;38;2;239;180;233mbun␛[0m ␛[38;2;99;211;255m~\\sub␛[0m ␛[38;2;255;180;171m[1]␛[0m ␛[38;2;255;180;171m❯␛[0m ␛]133;B␛\\",
    "",
  ]);
  expect(code).toBe(0);
});

test("progress (OSC 9;4) wraps busy commands; light palette, 256 colours", async () => {
  using home = tempHome();
  const { stdout, code } = await session(home.dir, "echo x\n", {
    BUN_SHELL_PROGRESS_MS: "0",
    APHRODY_THEME: "light",
    COLORTERM: "",
    WT_SESSION: "",
    TERM_PROGRAM: "",
    KITTY_WINDOW_ID: "",
  });
  expect(stdout).toContain("␛]133;C␛\\␛]0;echo x␛\\␛]9;4;3␛\\x\n␛]9;4;0␛\\␛]133;D;0␛\\");
  expect(stdout).toContain("␛[1;38;5;96mbun␛[0m ␛[38;5;24m~␛[0m");
  expect(code).toBe(0);
});

test("NO_COLOR keeps the marks and drops the colours", async () => {
  using home = tempHome();
  const { stdout } = await session(home.dir, "", { NO_COLOR: "1" });
  expect(stdout).toBe("␛[?2026h␛]7;file://HOST/TMP␛\\␛]9;9;TMP␛\\␛]0;bun ~␛\\␛]133;A␛\\bun ~ ❯ ␛]133;B␛\\␛[?2026l");
});

test("prompt shows branch, duration and failure", () => {
  const palette = loadPalette("dark");
  expect(palette?.brand.hex).toBe("#efb4e9");
  const p = renderPrompt({ cwd: "/h/x", home: "/h", lastCode: 2, lastMs: 1530, branch: "main" }, palette, "none");
  expect(p).toEqual({ text: "bun ~/x (main) 1.5s [2] ❯ ", width: 26 });
  expect(colorMode({ WT_SESSION: "x" })).toBe("truecolor");
  expect(colorMode({ TERM: "xterm-256color" })).toBe("256");
  expect(colorMode({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("none");
});

test("native modules select the host API and expose WebAssembly", async () => {
  const modules = await loadNativeModules();
  expect(typeof modules.wasm.validate).toBe("function");
  expect(() => modules.wasm.build()).toThrow("not available on upstream Bun");
  expect(modules.windows !== undefined).toBe(process.platform === "win32");
  expect(modules.linux !== undefined).toBe(process.platform === "linux");
  const portable = await loadNativeModules("darwin");
  expect(portable.windows).toBeUndefined();
  expect(portable.linux).toBeUndefined();
  expect(typeof portable.wasm.compile).toBe("function");
});

test("coreutils probe reports the CPU count", async () => {
  expect(await probeCoreutils()).toBeGreaterThan(0);
});

test("compiled-runtime probe guard exits before opening an interactive session", async () => {
  using home = tempHome();
  const { stdout, stderr, code } = await session(home.dir, "echo must-not-run\n", {
    BUN_RIO_COREUTILS_PROBE: "1",
  });
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(code).toBe(127);
});

test("JavaScript expressions use native modules and Bun Shell in the parent VM", async () => {
  const modules = await loadNativeModules();
  expect(await evaluateNative("await $`echo native-shell`.text()", modules)).toBe("native-shell\n");
  expect(await evaluateNative("typeof wasm.validate", modules)).toBe("function");
  expect(await evaluateNative("globalThis", modules)).toBe(globalThis);
  if (process.platform === "win32") {
    const version = await evaluateNative("windows.version", modules);
    expect(version).toEqual(modules.windows!.version);
  }
});

test("piped native commands execute and recover after expression errors", async () => {
  using home = tempHome();
  const { stdout, stderr, code } = await session(
    home.dir,
    'js typeof wasm.build\njs (() => { throw new Error("native-expression-failure") })()\njs await $`echo api-call`.text()\nexit\n',
    { NO_COLOR: "1" },
  );
  expect(stdout).toContain('"function"');
  expect(stderr).toContain("js: native-expression-failure");
  expect(stdout).toContain("api-call");
  expect(stdout).toContain("␛]133;D;1␛\\");
  expect(code).toBe(0);
});

test("line editor: keys, history, kill commands", () => {
  expect(keys("ab\x1b[A\x1bOB\x1b[3~é😀\r")).toEqual(["a", "b", "\x1b[A", "\x1bOB", "\x1b[3~", "é", "😀", "\r"]);
  const ed = new LineEditor(["ls", "echo one"]);
  const type = (s: string) => keys(s).map(k => ed.feed(k));
  type("pwd");
  type("\x1b[A");
  expect(ed.buf).toBe("echo one");
  type("\x1b[A\x1b[A");
  expect(ed.buf).toBe("ls");
  type("\x1b[B\x1b[B");
  expect(ed.buf).toBe("pwd");
  type("\x1b[D\x1b[DX");
  expect([ed.buf, ed.cur]).toEqual(["pXwd", 2]);
  type("\x01\x1b[3~\x05\x7f");
  expect([ed.buf, ed.cur]).toEqual(["Xw", 2]);
  type(" foo bar\x17");
  expect(ed.buf).toBe("Xw foo ");
  type("\x15");
  expect(ed.buf).toBe("");
  expect(ed.feed("\x04")).toBe("eof");
  expect(ed.feed("\x03")).toBe("cancel");
  expect(ed.feed("\r")).toBe("submit");
});

test("redraw keeps the cursor on wrapped lines inside one synchronized update", () => {
  const ed = new LineEditor([]);
  for (const k of keys("abcdefgh\x1b[D\x1b[D\x1b[D\x1b[D\x1b[D\x1b[D\x1b[D")) ed.feed(k);
  const r = redraw({ text: "> ", width: 2 }, ed, 4, 1);
  expect(visible(r.out)).toBe("␛[?2026h␛[1A\r␛[J> abcdefgh␛[2A\r␛[3C␛[?2026l");
  expect(r.row).toBe(0);
  ed.feed("\x05");
  expect(visible(redraw({ text: "> ", width: 2 }, ed, 5, 0).out)).toBe("␛[?2026h\r␛[J> abcdefgh \r\r␛[?2026l");
});

test("history is stored under APHRODY_HOME, deduplicated", () => {
  using home = tempHome();
  const file = join(home.dir, ".aphrody", "bun-shell-history");
  const h = new History(file);
  for (const l of ["ls", "ls", "pwd", ""]) h.add(l);
  expect(readFileSync(file, "utf8")).toBe("ls\npwd\n");
  expect(new History(file).entries).toEqual(["ls", "pwd"]);
});

test("image protocol follows the terminal", () => {
  expect(imageProtocol({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
  expect(imageProtocol({ TERM_PROGRAM: "ghostty" })).toBe("kitty");
  expect(imageProtocol({ TERM_PROGRAM: "WezTerm" })).toBe("iterm");
  expect(imageProtocol({ TERM_PROGRAM: "rio" })).toBe("iterm");
  expect(imageProtocol({ WT_SESSION: "x" })).toBe("sixel");
  expect(imageProtocol({ VTE_VERSION: "7600" })).toBe("sixel");
});

test("kitty graphics: PNG in 4096-byte base64 chunks, replies suppressed", () => {
  const out = visible(kittyImage(new Uint8Array(5000)));
  const chunks = out.split("␛\\").filter(Boolean);
  expect(chunks.map(c => c.slice(0, c.indexOf(";") + 1))).toEqual(["␛_Ga=T,f=100,q=2,m=1;", "␛_Gm=0;"]);
  expect(chunks[0].length - "␛_Ga=T,f=100,q=2,m=1;".length).toBe(4096);
});

test("sixel encodes bands, run lengths and transparency", () => {
  // 5×7: colour 0 transparent, 1 red, 2 blue.
  const pixels = Uint8Array.from([
    1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 1, 0, 0, 0, 2, 1, 0, 0, 0, 2, 1, 0, 0, 0, 2, 1, 0, 0, 0, 2, 2, 2, 2, 2, 2,
  ]);
  const out = sixel({
    width: 5,
    height: 7,
    palette: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0, 255]),
    alpha: Uint8Array.from([0]),
    pixels,
  });
  expect(visible(out)).toBe('␛P0;1;0q"1;1;5;7#0;2;0;0;0#1;2;100;0;0#2;2;0;0;100#1~!4@$#2!4?}-#2!5@␛\\');
});

function indexedPng(width: number, height: number, depth: number, palette: number[], rows: number[][]) {
  const chunk = (type: string, body: Uint8Array) => {
    const head = new Uint8Array(8 + body.length + 4);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, body.length);
    head.set(new TextEncoder().encode(type), 4);
    head.set(body, 8);
    dv.setUint32(8 + body.length, Bun.hash.crc32(head.subarray(4, 8 + body.length)));
    return head;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([depth, 3, 0, 0, 0], 8);
  const raw = Uint8Array.from(rows.flat());
  return Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Uint8Array.from(palette)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

test("indexed PNG decoder: sub-byte depth and Sub/Up filters", () => {
  // 3×2 at 2 bits: row 0 [1,2,3] unfiltered, row 1 [1,2,3] with Up (all zero deltas).
  const png = indexedPng(
    3,
    2,
    2,
    [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255],
    [
      [0, 0b01101100],
      [2, 0],
    ],
  );
  const decoded = decodeIndexedPng(png);
  expect([decoded.width, decoded.height, [...decoded.pixels]]).toEqual([3, 2, [1, 2, 3, 1, 2, 3]]);
  // 4×1 at 8 bits with the Sub filter.
  const sub = decodeIndexedPng(indexedPng(4, 1, 8, [0, 0, 0, 9, 9, 9], [[1, 1, 0, 255, 1]]));
  expect([...sub.pixels]).toEqual([1, 1, 0, 1]);
});

test("img renders a real PNG as sixel through Bun.Image", async () => {
  const icon = join(import.meta.dir, "../../../../../../crates/aphrody-identity/assets/brand/icon-16.png");
  const out = await img([icon, "--sixel"], {}, 80, 24);
  expect(visible(out).startsWith('␛P0;1;0q"1;1;16;16#0;2;')).toBe(true);
  expect(out.match(/-/g)?.length).toBe(2);
  expect(out.endsWith("\x1b\\\n")).toBe(true);
  const iterm = await img([icon], { TERM_PROGRAM: "WezTerm" }, 80, 24);
  expect(iterm.startsWith("\x1b]1337;File=name=")).toBe(true);
});
