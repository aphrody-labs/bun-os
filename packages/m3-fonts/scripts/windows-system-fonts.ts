// SPDX-License-Identifier: Apache-2.0
// Per-machine install of the Bun OS M3 fonts from a design artifact (`m3-os-themes design`, fonts/ + fonts.json):
// copies each font into %SystemRoot%\Fonts and registers it under
// HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts. It never overwrites a Windows font: a file or a registry
// value that already exists is kept (same bytes: reported as installed; different bytes: skipped and reported).
// Every action is recorded in %ProgramData%\BunOS\fonts\installed.json, which `uninstall` replays in reverse,
// removing only what this script added. Needs an elevated process: run through C:\Windows\System32\sudo.exe.
//
//   sudo bun packages/m3-fonts/scripts/windows-system-fonts.ts install <artifact>/fonts
//   sudo bun packages/m3-fonts/scripts/windows-system-fonts.ts uninstall
//   bun packages/m3-fonts/scripts/windows-system-fonts.ts status <artifact>/fonts
import { dlopen, FFIType } from "bun:ffi";
import * as registry from "@aphrody/windows/registry";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") throw new Error("windows-system-fonts.ts runs on Windows only");
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const fontsDir = join(systemRoot, "Fonts");
const fontKey = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const stateDir = join(process.env.ProgramData ?? "C:\\ProgramData", "BunOS", "fonts");
const stateFile = join(stateDir, "installed.json");

interface FontRow {
  file: string;
  family: string;
  registry: string;
  sha256: string;
  license: string;
}
interface Action {
  file: string;
  value: string;
  copied: boolean;
  registered: boolean;
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const gdi = dlopen("gdi32.dll", { AddFontResourceW: { args: [FFIType.ptr], returns: FFIType.i32 }, RemoveFontResourceW: { args: [FFIType.ptr], returns: FFIType.i32 } });
const user32 = dlopen("user32.dll", {
  SendMessageTimeoutW: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
});
const wide = (s: string) => Buffer.from(`${s}\0`, "utf16le");
const broadcast = () => user32.symbols.SendMessageTimeoutW(0xffffn, 0x001d /* WM_FONTCHANGE */, 0n, 0n, 0x0002, 2000, null);

function rows(dir: string): FontRow[] {
  const manifest = JSON.parse(readFileSync(join(dir, "fonts.json"), "utf8")) as { fonts: FontRow[] };
  return manifest.fonts;
}

function install(dir: string): number {
  const done: Action[] = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as Action[]) : [];
  let added = 0;
  for (const f of rows(dir)) {
    const src = join(dir, f.file);
    if (sha(src) !== f.sha256) throw new Error(`${f.file}: sha256 does not match fonts.json`);
    const dest = join(fontsDir, f.file);
    const action: Action = { file: f.file, value: f.registry, copied: false, registered: false };
    if (existsSync(dest)) {
      if (sha(dest) !== f.sha256) {
        console.log(`skip  ${f.file}: a different font with this name already exists in ${fontsDir}`);
        continue;
      }
    } else {
      copyFileSync(src, dest);
      action.copied = true;
    }
    const current = registry.get(fontKey, f.registry)?.value;
    if (current === undefined) {
      registry.set(fontKey, f.registry, f.file, "REG_SZ");
      action.registered = true;
    } else if (String(current).toLowerCase() !== f.file.toLowerCase()) {
      console.log(`keep  ${f.registry}: already registered to ${String(current)}`);
    }
    gdi.symbols.AddFontResourceW(wide(dest));
    if (action.copied || action.registered) {
      done.push(action);
      added++;
      console.log(`add   ${f.family} -> ${dest}`);
    } else console.log(`ok    ${f.family} (already installed)`);
  }
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(done, null, 2)}\n`);
  broadcast();
  console.log(`${added} font(s) added; state ${stateFile}`);
  return 0;
}

function uninstall(): number {
  if (!existsSync(stateFile)) return (console.log("nothing installed by Bun OS"), 0);
  const done = JSON.parse(readFileSync(stateFile, "utf8")) as Action[];
  for (const a of [...done].reverse()) {
    const dest = join(fontsDir, a.file);
    gdi.symbols.RemoveFontResourceW(wide(dest));
    if (a.registered) registry.deleteValue(fontKey, a.value);
    if (a.copied) rmSync(dest, { force: true });
    console.log(`removed ${a.file}`);
  }
  rmSync(stateFile, { force: true });
  broadcast();
  return 0;
}

function status(dir: string): number {
  let missing = 0;
  for (const f of rows(dir)) {
    const dest = join(fontsDir, f.file);
    const file = existsSync(dest) ? (sha(dest) === f.sha256 ? "file ok" : "file differs") : "no file";
    const reg = registry.get(fontKey, f.registry)?.value;
    if (file !== "file ok" || reg === undefined) missing++;
    console.log(`${f.family.padEnd(24)} ${file.padEnd(12)} ${reg === undefined ? "not registered" : `registered (${String(reg)})`}`);
  }
  return missing ? 1 : 0;
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "install" && dir) process.exit(install(dir));
if (cmd === "uninstall") process.exit(uninstall());
if (cmd === "status" && dir) process.exit(status(dir));
console.error("usage: windows-system-fonts.ts install <fonts-dir> | uninstall | status <fonts-dir>");
process.exit(2);
