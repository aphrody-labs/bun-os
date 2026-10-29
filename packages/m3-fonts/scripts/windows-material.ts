// SPDX-License-Identifier: Apache-2.0
// Installs the Material Symbols fonts for the current user and maps Windows shell icons to Material
// glyphs. Inputs come from scripts/material-icons-raster.py. Nothing is written outside
// %LOCALAPPDATA%: fonts go to Microsoft\Windows\Fonts with HKCU font values, shell icon overrides go
// to HKCU Explorer\Shell Icons, and the previous values are saved to rollback.json before any change.
//
//   bun scripts/windows-material.ts icons <png-dir> [ico-dir]
//   bun scripts/windows-material.ts font <ttf-dir>
//   bun scripts/windows-material.ts shell apply [--force]
//   bun scripts/windows-material.ts shell rollback
import { dlopen, FFIType } from "bun:ffi";
import * as registry from "@aphrody/winreg";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const windows = { registry };

if (process.platform !== "win32") throw new Error("windows-material.ts ne s'exécute que sous Windows");

const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA n'est pas défini");

const pkgDir = join(import.meta.dir, "..");
const shellTableFile = join(pkgDir, "src", "windows-shell-icons.json");
const baseDir = join(localAppData, "Aphrody", "material-icons");
const icoDir = join(baseDir, "ico");
const rollbackFile = join(baseDir, "rollback.json");
const fontsDir = join(localAppData, "Microsoft", "Windows", "Fonts");
const fontKey = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const shellIconsKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons";
const icoSizes = [16, 24, 32, 48, 256];

const fonts = [
  {
    file: "MaterialSymbolsOutlined.ttf",
    valueName: "Material Symbols Outlined Regular (TrueType)",
  },
  {
    file: "MaterialSymbolsRounded.ttf",
    valueName: "Material Symbols Rounded Regular (TrueType)",
  },
  {
    file: "MaterialSymbolsSharp.ttf",
    valueName: "Material Symbols Sharp Regular (TrueType)",
  },
];

const user32 = dlopen("user32.dll", {
  PostMessageW: {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.bool,
  },
});
const shell32 = dlopen("shell32.dll", {
  SHChangeNotify: {
    args: [FFIType.i32, FFIType.u32, FFIType.u64, FFIType.u64],
    returns: FFIType.void,
  },
});

const HWND_BROADCAST = 0xffff;
const WM_FONTCHANGE = 0x001d;
const SHCNE_ASSOCCHANGED = 0x08000000;
const SHCNE_UPDATEIMAGE = 0x00008000;
const SHCNF_DWORD = 0x0003;
const SHCNF_FLUSH = 0x1000;

function notifyShell() {
  shell32.symbols.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, 0, 0);
  shell32.symbols.SHChangeNotify(SHCNE_UPDATEIMAGE, SHCNF_DWORD | SHCNF_FLUSH, 0xffffffff, 0);
}

function broadcastFontChange() {
  user32.symbols.PostMessageW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0);
}

function encodeIco(images: { size: number; png: Uint8Array }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    const dim = size === 256 ? 0 : size;
    header[entry] = dim;
    header[entry + 1] = dim;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

async function buildIcons(pngDir: string, outDir: string) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  // The package tsconfig lib predates ES2023; the runtime (Bun) provides toSorted.
  const names = (
    (await readdir(join(pngDir, "256")))
      .filter(file => file.endsWith(".png"))
      .map(file => file.slice(0, -4)) as string[] & { toSorted(): string[] }
  ).toSorted();
  const index: Record<string, string> = {};
  for (const name of names) {
    const images = [];
    for (const size of icoSizes) {
      // oxlint-disable-next-line no-await-in-loop -- sizes are read one by one: the icon set is thousands of PNGs, and a fan-out would open them all at once
      images.push({
        size,
        png: await Bun.file(join(pngDir, String(size), `${name}.png`)).bytes(),
      });
    }
    // oxlint-disable-next-line no-await-in-loop -- one .ico at a time, matching the sequential PNG reads above (bounded file handles)
    await Bun.write(join(outDir, `${name}.ico`), encodeIco(images));
    index[name] = `${name}.ico`;
  }
  await Bun.write(join(outDir, "index.json"), JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ icons: names.length, dir: outDir }));
}

async function installFonts(ttfDir: string) {
  await mkdir(fontsDir, { recursive: true });
  for (const font of fonts) {
    const dest = join(fontsDir, font.file);
    // oxlint-disable-next-line no-await-in-loop -- fonts are copied then registered in order; a failed copy must stop before later registry writes
    await copyFile(join(ttfDir, font.file), dest);
    windows.registry.set(fontKey, font.valueName, dest, "REG_SZ");
    const check = windows.registry.get(fontKey, font.valueName);
    if (check === null || check.value !== dest) throw new Error(`registre non écrit : ${font.valueName}`);
  }
  broadcastFontChange();
  console.log(JSON.stringify({ fonts: fonts.map(font => font.valueName) }));
}

type ShellEntry = { shellIndex: number; label: string; material: string };

async function shellApply(force: boolean) {
  if (!force && (await Bun.file(rollbackFile).exists())) {
    throw new Error(`rollback déjà présent (${rollbackFile}) : relancer avec --force après rollback`);
  }
  const table: ShellEntry[] = JSON.parse(await readFile(shellTableFile, "utf8"));
  const plan = table.map(entry => {
    const icon = join(icoDir, `${entry.material}.ico`);
    return { name: String(entry.shellIndex), icon, data: `${icon},0` };
  });
  const iconPresent = await Promise.all(plan.map(step => Bun.file(step.icon).exists()));
  const absent = plan.find((_step, index) => !iconPresent[index]);
  if (absent) throw new Error(`icône absente : ${absent.icon}`);
  const entries = plan.map(step => {
    const current = windows.registry.get(shellIconsKey, step.name);
    return {
      name: step.name,
      existed: current !== null,
      type: current?.type ?? null,
      value: current === null ? null : String(current.value),
    };
  });
  await mkdir(baseDir, { recursive: true });
  await writeFile(
    rollbackFile,
    JSON.stringify({ key: shellIconsKey, savedAt: new Date().toISOString(), entries }, null, 1),
  );
  for (const step of plan) windows.registry.set(shellIconsKey, step.name, step.data, "REG_SZ");
  notifyShell();
  console.log(
    JSON.stringify({
      applied: plan.map(step => step.name),
      rollback: rollbackFile,
    }),
  );
}

async function shellRollback() {
  const saved = JSON.parse(await readFile(rollbackFile, "utf8"));
  for (const entry of saved.entries) {
    if (entry.existed) windows.registry.set(saved.key, entry.name, entry.value, entry.type);
    else windows.registry.deleteValue(saved.key, entry.name);
  }
  notifyShell();
  await rm(rollbackFile);
  console.log(
    JSON.stringify({
      restored: saved.entries.map((entry: { name: string }) => entry.name),
    }),
  );
}

const [command, sub, ...rest] = Bun.argv.slice(2);
if (command === "icons") await buildIcons(sub, rest[0] ?? icoDir);
else if (command === "font") await installFonts(sub);
else if (command === "shell" && sub === "apply") await shellApply(rest.includes("--force"));
else if (command === "shell" && sub === "rollback") await shellRollback();
else throw new Error("usage: windows-material.ts icons|font|shell ...");
