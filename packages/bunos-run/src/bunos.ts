#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bunos run <file> [-- args]: detect what a file is and run it on the Bun OS Alpine line.
//   bunos detect [--json] <file>      what the file is and which route runs it
//   bunos run [--dry-run] [--engine bun|wasmtime] <file> [-- args]
// Self-contained (no dependencies): it is installed in the guest as /usr/lib/bunos/bunos.ts by the bunos-run apk,
// and it also runs on a host. Every route shells out to the real tool; nothing is emulated here.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

export type Kind =
  | "elf"
  | "appimage"
  | "alpine-apk"
  | "android-apk"
  | "deb"
  | "pe-native"
  | "pe-managed"
  | "msi"
  | "wasm-core"
  | "wasm-component"
  | "script-js"
  | "script-shebang"
  | "unknown";

export interface PeReport {
  machine: string;
  gui: boolean;
  dll: boolean;
  managed: boolean;
  imports: string[];
  /** imports that are neither a wine builtin nor next to the file; empty means a Wine run is plausible */
  missing: string[];
}

export interface Detection {
  file: string;
  kind: Kind;
  detail: Record<string, unknown>;
}

export interface Plan {
  detection: Detection;
  /** commands run in order; the last one is the program */
  steps: string[][];
  env?: Record<string, string>;
  /** set when no route can run the file here: the reason (exit 3 when run) */
  unsupported?: string;
}

const MACHINES: Record<number, string> = { 0x14c: "x86", 0x8664: "x86_64", 0xaa64: "aarch64", 0x1c4: "arm" };
const ELF_MACHINES: Record<number, string> = { 0x3e: "x86_64", 0xb7: "aarch64", 0x03: "x86", 0x28: "arm", 0xf3: "riscv64" };

const hostArch = () => (process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch);

export function parsePe(buf: Uint8Array, siblingDir: string, builtinDirs: string[]): PeReport | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 0x40 || dv.getUint16(0, true) !== 0x5a4d) return null;
  const nt = dv.getUint32(0x3c, true);
  if (nt + 0x18 > buf.length || dv.getUint32(nt, true) !== 0x4550) return null;
  const machine = dv.getUint16(nt + 4, true);
  const nsec = dv.getUint16(nt + 6, true);
  const optSize = dv.getUint16(nt + 20, true);
  const characteristics = dv.getUint16(nt + 22, true);
  const opt = nt + 24;
  const magic = dv.getUint16(opt, true);
  const plus = magic === 0x20b;
  const subsystem = dv.getUint16(opt + 68, true);
  const ddBase = opt + (plus ? 112 : 96);
  const dd = (i: number) => ({ rva: dv.getUint32(ddBase + i * 8, true), size: dv.getUint32(ddBase + i * 8 + 4, true) });
  const secs: { va: number; vs: number; raw: number; rs: number }[] = [];
  for (let i = 0; i < nsec; i++) {
    const s = opt + optSize + i * 40;
    secs.push({
      vs: dv.getUint32(s + 8, true),
      va: dv.getUint32(s + 12, true),
      rs: dv.getUint32(s + 16, true),
      raw: dv.getUint32(s + 20, true),
    });
  }
  const off = (rva: number) => {
    for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vs, s.rs)) return rva - s.va + s.raw;
    return -1;
  };
  const cstr = (o: number) => {
    let e = o;
    while (e < buf.length && buf[e] !== 0) e++;
    return new TextDecoder().decode(buf.subarray(o, e));
  };
  const imports: string[] = [];
  const imp = dd(1);
  if (imp.rva) {
    let o = off(imp.rva);
    while (o >= 0 && o + 20 <= buf.length) {
      const nameRva = dv.getUint32(o + 12, true);
      if (!nameRva) break;
      const n = off(nameRva);
      if (n >= 0) imports.push(cstr(n));
      o += 20;
    }
  }
  const have = new Set<string>();
  for (const d of [siblingDir, ...builtinDirs]) {
    try {
      for (const f of readdirSync(d)) have.add(f.toLowerCase());
    } catch {}
  }
  const missing = imports.filter(n => {
    const l = n.toLowerCase();
    if (l.startsWith("api-ms-win-") || l.startsWith("ext-ms-win-")) return false; // resolved by wine's apiset
    return !have.has(l) && !have.has(l.endsWith(".dll") ? l : l + ".dll");
  });
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    gui: subsystem === 2,
    dll: (characteristics & 0x2000) !== 0,
    managed: dd(14).rva !== 0,
    imports,
    missing,
  };
}

const WINE_DIRS = ["/usr/lib/wine/x86_64-windows", "/usr/lib/wine/i386-windows", "/usr/lib/wine/x86_64-unix"];

export function detect(file: string): Detection {
  const path = resolve(file);
  const st = statSync(path);
  if (!st.isFile()) throw new Error(`${file}: not a regular file`);
  const fd = readFileSync(path);
  const head = fd.subarray(0, 4096);
  const ext = extname(path).toLowerCase();
  const d = (kind: Kind, detail: Record<string, unknown> = {}): Detection => ({ file: path, kind, detail });

  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
    const machine = ELF_MACHINES[head[18]! | (head[19]! << 8)] ?? "unknown";
    const text = new TextDecoder("latin1").decode(head);
    const libc = text.includes("ld-musl") ? "musl" : text.includes("ld-linux") ? "glibc" : "static-or-unknown";
    // AppImage type 2: 'AI' 0x02 at offset 8
    if (head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02) return d("appimage", { machine, type: 2 });
    return d("elf", { machine, libc, host: hostArch() });
  }
  if (head[0] === 0x4d && head[1] === 0x5a) {
    const pe = parsePe(fd, resolve(path, ".."), WINE_DIRS);
    if (pe) return d(pe.managed ? "pe-managed" : "pe-native", pe as unknown as Record<string, unknown>);
  }
  if (head[0] === 0 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d) {
    // \0asm then version: 01 00 00 00 core module, 0d 00 01 00 component
    const component = head[4] === 0x0d && head[5] === 0 && head[6] === 0x01;
    return d(component ? "wasm-component" : "wasm-core");
  }
  if (head.subarray(0, 8).toString() === "!<arch>\n" || new TextDecoder().decode(head.subarray(0, 8)) === "!<arch>\n") {
    if (new TextDecoder("latin1").decode(head.subarray(8, 80)).includes("debian-binary")) return d("deb");
  }
  if (new TextDecoder().decode(head.subarray(0, 4)) === "ADB.") return d("alpine-apk", { format: "apk3 (adb)" });
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const r = Bun.spawnSync(["tar", "-tzf", path]);
    const names = new TextDecoder().decode(r.stdout);
    if (names.includes(".PKGINFO") || names.includes(".SIGN.")) return d("alpine-apk", { format: "apk2 (tar.gz)" });
  }
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const r = Bun.spawnSync(["unzip", "-l", path]);
    const listing = new TextDecoder().decode(r.stdout);
    if (listing.includes("AndroidManifest.xml")) return d("android-apk", { dex: /classes\d*\.dex/.test(listing) });
  }
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && ext === ".msi") return d("msi");
  if (head[0] === 0x23 && head[1] === 0x21) return d("script-shebang", { line: new TextDecoder().decode(head).split("\n")[0] });
  if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".tsx", ".jsx"].includes(ext)) return d("script-js");
  return d("unknown");
}

const which = (cmd: string): boolean => Bun.which(cmd) !== null;

export function plan(file: string, args: string[], opts: { engine?: string } = {}): Plan {
  const detection = detect(file);
  const f = detection.file;
  const env: Record<string, string> = {};
  const p = (steps: string[][], extra?: Partial<Plan>): Plan => ({ detection, steps, env, ...extra });
  const bad = (reason: string): Plan => ({ detection, steps: [], env, unsupported: reason });
  const detail = detection.detail as any;

  switch (detection.kind) {
    case "elf": {
      if (detail.machine !== detail.host) {
        const q = `qemu-${detail.machine}`;
        if (which(q)) return p([[q, f, ...args]]);
        return bad(`ELF ${detail.machine} on a ${detail.host} host and ${q} is not installed (apk add qemu-${detail.machine})`);
      }
      if (detail.libc === "glibc" && !existsSync("/lib/libc.so.6") && !existsSync("/usr/glibc-compat"))
        return bad("glibc ELF and gcompat is not installed (apk add gcompat)");
      return p([[f, ...args]]);
    }
    case "appimage":
      env.APPIMAGE_EXTRACT_AND_RUN = "1";
      return p([[f, ...args]]);
    case "alpine-apk":
      return p([["apk", "add", "--allow-untrusted", "--no-cache", f]]);
    case "android-apk": {
      // An Android APK needs an Android runtime. None runs inside the guest kernel (no binder); adb talks to a
      // redroid container or a device (docs/ALPINE.md). BUNOS_ADB_SERIAL / ANDROID_SERIAL picks the target.
      if (!which("adb")) return bad("Android APK: adb is not installed (apk add android-tools)");
      const serial = process.env.ANDROID_SERIAL ?? process.env.BUNOS_ADB_SERIAL;
      if (!serial) return bad("Android APK: no Android target; set ANDROID_SERIAL to a redroid container or device (docker compose run android-apk)");
      return p([["adb", "-s", serial, "install", "-r", f]]);
    }
    case "deb": {
      const root = join(process.env.BUNOS_DEB_ROOT ?? "/opt/bunos/deb", basename(f, ".deb"));
      return p([["mkdir", "-p", root], ["dpkg-deb", "-x", f, root], ["bunos-deb-exec", root, ...args]]);
    }
    case "pe-managed":
      return which("dotnet")
        ? p([["dotnet", f, ...args]])
        : bad("managed PE (CLR header) and dotnet is not installed (apk add dotnet10-runtime)");
    case "pe-native": {
      if (detail.machine !== "x86_64" && detail.machine !== "x86") return bad(`PE ${detail.machine}: Wine here runs x86_64 PE only`);
      // Measured: Alpine wine is a 64-bit build without the i386 (WoW64) DLL set; a 32-bit PE dies with c0000135.
      if (detail.machine === "x86" && !existsSync("/usr/lib/wine/i386-unix"))
        return bad("x86 PE (32-bit): this Wine has no i386 unix side (WoW64), only x86_64 PE run (see docs/ALPINE.md)");
      const wine = which("wine64") ? "wine64" : which("wine") ? "wine" : "";
      if (!wine) return bad("native PE and wine is not installed (apk add wine)");
      env.WINEDEBUG = process.env.WINEDEBUG ?? "-all";
      env.WINEPREFIX = process.env.WINEPREFIX ?? "/root/.wine";
      const run = [wine, f, ...args];
      if (detail.gui && !process.env.DISPLAY) return p([["xvfb-run", "-a", ...run]]);
      return p([run]);
    }
    case "msi":
      env.WINEDEBUG = "-all";
      return which("wine") ? p([["wine", "msiexec", "/i", f, ...args]]) : bad("MSI and wine is not installed");
    case "wasm-core":
    case "wasm-component": {
      const engine = opts.engine ?? (which("wasmtime") ? "wasmtime" : "bun");
      if (engine === "wasmtime") return p([["wasmtime", "run", "--dir", ".", f, "--", ...args]]);
      if (detection.kind === "wasm-component") return bad("wasm component: the Bun engine runs core modules (node:wasi); use wasmtime");
      return p([["bun", "-e", WASI_RUNNER, f, ...args]]);
    }
    case "script-js":
      return p([["bun", "run", f, ...args]]);
    case "script-shebang":
      return p([[f, ...args]]);
    default:
      return bad(`unknown file type (${basename(f)}); nothing to run it with`);
  }
}

// Runs a WASI preview1 core module with Bun's node:wasi.
const WASI_RUNNER = `
import { WASI } from "node:wasi";
import { readFileSync } from "node:fs";
const [file, ...args] = process.argv.slice(1).filter(a => a !== "-e");
const wasi = new WASI({ version: "preview1", args: [file, ...args], env: process.env, preopens: { ".": "." } });
const m = await WebAssembly.compile(readFileSync(file));
const i = await WebAssembly.instantiate(m, { wasi_snapshot_preview1: wasi.wasiImport });
process.exitCode = wasi.start(i);
`;

async function execPlan(pl: Plan): Promise<number> {
  const env = { ...process.env, ...pl.env } as Record<string, string>;
  for (let i = 0; i < pl.steps.length; i++) {
    let cmd = pl.steps[i]!;
    if (cmd[0] === "bunos-deb-exec") {
      const exe = findDebExecutable(cmd[1]!);
      if (!exe) {
        console.error(`bunos: no executable found under ${cmd[1]}/{usr/bin,bin,usr/games}`);
        return 4;
      }
      env.LD_LIBRARY_PATH = ["lib", "usr/lib", "lib/x86_64-linux-gnu", "usr/lib/x86_64-linux-gnu"].map(d => join(cmd[1]!, d)).join(":");
      cmd = [exe, ...cmd.slice(2)];
    }
    const proc = Bun.spawn(cmd, { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    if (code !== 0) return code;
  }
  return 0;
}

function findDebExecutable(root: string): string | null {
  for (const d of ["usr/bin", "bin", "usr/games", "usr/local/bin"]) {
    const dir = join(root, d);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      if (statSync(p).isFile() && (statSync(p).mode & 0o111) !== 0) return p;
    }
  }
  return null;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    if (i < 0) return false;
    argv.splice(i, 1);
    return true;
  };
  const opt = (n: string) => {
    const i = argv.indexOf(n);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
  };
  const json = flag("--json");
  const dry = flag("--dry-run");
  const engine = opt("--engine");
  const dash = argv.indexOf("--");
  const rest = dash < 0 ? [] : argv.slice(dash + 1);
  const pos = dash < 0 ? argv : argv.slice(0, dash);
  const file = pos[0];
  if ((cmd !== "run" && cmd !== "detect") || !file) {
    console.error("usage: bunos detect [--json] <file> | bunos run [--dry-run] [--engine bun|wasmtime] <file> [-- args]");
    process.exit(2);
  }
  mkdirSync("/tmp", { recursive: true });
  if (cmd === "detect") {
    const d = detect(file);
    console.log(json ? JSON.stringify(d) : `${d.kind}\t${basename(d.file)}`);
    process.exit(d.kind === "unknown" ? 1 : 0);
  }
  const pl = plan(file, [...pos.slice(1), ...rest], { engine });
  if (dry) {
    console.log(JSON.stringify(pl));
    process.exit(pl.unsupported ? 3 : 0);
  }
  if (pl.unsupported) {
    console.error(`bunos: ${pl.detection.kind}: ${pl.unsupported}`);
    process.exit(3);
  }
  process.exit(await execPlan(pl));
}
