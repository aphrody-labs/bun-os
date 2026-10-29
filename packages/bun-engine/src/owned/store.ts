// The owner's private dump store: BIOS, firmware and keys dumped from consoles the owner owns, and
// ROMs and disc images dumped from games the owner bought, kept for private qualification of Bun
// Engine and the emulators. Nothing here downloads anything: it only ingests files the owner
// supplies (`bep import`, the usr/var/inbox drop folder, the signed-in play.aphrody.app page).
//
// Each file is detected by content (formats registry), hashed in one streaming pass (CRC32, MD5,
// SHA-1, SHA-256 and its Git blob id for the pre-commit guard), verified against the No-Intro and
// Redump DATs of libretro-database, the BIOS tables of plugins/consoles/firmware.json and the
// libretro-core-info MD5s, and stored content-addressed:
//   usr/share/bun-engine/firmware/<console>/<sha256>.<ext>  (+ .json manifest, origin "owned")
//   usr/share/bun-engine/roms/<console>/<sha256>.<ext>      (+ .json manifest, origin "owned")
//   usr/share/bun-engine/keys/<console>/<sha256>.<ext>      (owner-only ACL / 0600, names only)
// with the metadata in the `owned` table of usr/var/lib/bep/library.db.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { defaultFirmwareStore, type FirmwareManifest } from "../firmware/import";
import { catalogFirmware, type FirmwareMatch } from "../formats/catalog";
import { BinaryImage } from "../formats/image";
import type { FormatId } from "../formats/types";
import { db, type DatRow, verifyDump } from "../frontend/library";
import { loadSystems, type SystemDefinition } from "../frontend/systems";
import { libretroCatalog } from "../libretro";
import { sevenZipTool, usrRoot } from "../usr";

export type OwnedKind = "firmware" | "rom" | "keys";
export type DumpStatus = "verified" | "unverified-good-dump" | "bad-dump";

export interface OwnedDump {
  sha256: string;
  kind: OwnedKind;
  system: string | null;
  console: string;
  format: string;
  platform: string;
  title: string | null;
  serial: string | null;
  region: string | null;
  size: number;
  crc32: string;
  md5: string;
  sha1: string;
  gitBlob: string;
  status: DumpStatus;
  reason: string | null;
  dat: string | null;
  /** Store file relative to usr/share/bun-engine. */
  file: string;
  /** Every name the dump was supplied under (archive members as `archive/member`). */
  names: string[];
  /** Key files only: the key names, never their values. */
  keyNames: string[];
  header: Record<string, unknown>;
  importedAt: string;
}

export interface IngestOptions {
  /** Force the system (systems.json id) when the content is ambiguous (disc images, arcade). */
  system?: string;
  /** Where the file came from, recorded with the name: cli, inbox or web. */
  via?: string;
}

export interface IngestResult {
  input: string;
  sha256?: string;
  kind?: OwnedKind;
  system?: string | null;
  console?: string;
  format?: string;
  status?: DumpStatus;
  reason?: string | null;
  title?: string | null;
  duplicate?: boolean;
  keyNames?: string[];
  error?: string;
}

const maxKeyFileBytes = 1024 * 1024;

export function ownedPaths() {
  const share = dirname(defaultFirmwareStore());
  const usr = usrRoot();
  return {
    share,
    firmware: join(share, "firmware"),
    roms: join(share, "roms"),
    keys: join(share, "keys"),
    inbox: join(usr, "var", "inbox"),
    work: join(usr, "var", "tmp", "bep-owned"),
    reports: join(usr, "var", "lib", "bep", "owned-tests"),
  };
}

let ready = false;
/** library.db with the owned-dump tables. */
export function ownedDb() {
  const database = db();
  if (ready) return database;
  database.run(`CREATE TABLE IF NOT EXISTS owned (
    sha256 TEXT PRIMARY KEY, kind TEXT NOT NULL, system TEXT, console TEXT NOT NULL, format TEXT NOT NULL,
    platform TEXT NOT NULL, title TEXT, serial TEXT, region TEXT, size INTEGER NOT NULL, crc32 TEXT NOT NULL,
    md5 TEXT NOT NULL, sha1 TEXT NOT NULL, gitBlob TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, dat TEXT,
    file TEXT NOT NULL, names TEXT NOT NULL, keyNames TEXT NOT NULL, header TEXT NOT NULL, importedAt TEXT NOT NULL)`);
  database.run("CREATE INDEX IF NOT EXISTS owned_git_blob ON owned (gitBlob)");
  database.run("CREATE INDEX IF NOT EXISTS owned_system ON owned (system)");
  database.run(`CREATE TABLE IF NOT EXISTS owned_sync (
    sha256 TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL, parts INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL,
    PRIMARY KEY (sha256, target))`);
  database.run(`CREATE TABLE IF NOT EXISTS owned_tests (
    run TEXT NOT NULL, sha256 TEXT NOT NULL, mode TEXT NOT NULL, route TEXT, status TEXT NOT NULL,
    frames INTEGER, frameHash TEXT, screenshot TEXT, ms INTEGER, detail TEXT, at TEXT NOT NULL)`);
  ready = true;
  return database;
}

type Row = Omit<OwnedDump, "names" | "keyNames" | "header"> & { names: string; keyNames: string; header: string };

function fromRow(row: Row): OwnedDump {
  return { ...row, names: JSON.parse(row.names), keyNames: JSON.parse(row.keyNames), header: JSON.parse(row.header) };
}

export function listOwned(filter: { kind?: OwnedKind; system?: string } = {}): OwnedDump[] {
  return ownedDb()
    .query<Row, { kind: string | null; system: string | null }>(
      "SELECT * FROM owned WHERE ($kind IS NULL OR kind = $kind) AND ($system IS NULL OR system = $system) ORDER BY kind, system, coalesce(title, names)",
    )
    .all({ kind: filter.kind ?? null, system: filter.system ?? null })
    .map(fromRow);
}

export function ownedBySha(sha256: string): OwnedDump | undefined {
  const rows = ownedDb()
    .query<Row, [string]>("SELECT * FROM owned WHERE sha256 LIKE ? || '%' LIMIT 2")
    .all(sha256.toLowerCase());
  if (rows.length > 1) throw new Error(`${sha256} is ambiguous`);
  return rows[0] && fromRow(rows[0]);
}

/** Absolute path of a dump in the store. */
export function storePath(dump: Pick<OwnedDump, "file">): string {
  return join(ownedPaths().share, dump.file);
}

interface Digest {
  size: number;
  crc32: string;
  md5: string;
  sha1: string;
  sha256: string;
  gitBlob: string;
  headerless?: string;
}

/** One streaming pass: CRC32, MD5, SHA-1, SHA-256 and the Git blob id (multi-GB images are never loaded). */
export async function hashDump(path: string, headerBytes = 0): Promise<Digest> {
  const file = Bun.file(path);
  const size = file.size;
  const md5 = new Bun.CryptoHasher("md5");
  const sha1 = new Bun.CryptoHasher("sha1");
  const sha256 = new Bun.CryptoHasher("sha256");
  const git = new Bun.CryptoHasher("sha1").update(`blob ${size}\0`);
  let crc = 0;
  let headerless = 0;
  let offset = 0;
  for await (const chunk of file.stream()) {
    crc = Bun.hash.crc32(chunk, crc);
    if (headerBytes && offset + chunk.byteLength > headerBytes)
      headerless = Bun.hash.crc32(chunk.subarray(Math.max(0, headerBytes - offset)), headerless);
    offset += chunk.byteLength;
    md5.update(chunk);
    sha1.update(chunk);
    sha256.update(chunk);
    git.update(chunk);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return {
    size,
    crc32: hex(crc),
    md5: md5.digest("hex"),
    sha1: sha1.digest("hex"),
    sha256: sha256.digest("hex"),
    gitBlob: git.digest("hex"),
    ...(headerBytes && size > headerBytes ? { headerless: hex(headerless) } : {}),
  };
}

// ---- keys -------------------------------------------------------------------------------------

const keyFileNames =
  /^(prod|title|dev)\.keys$|^aes_keys\.txt$|^keys\.(txt|bin)$|^(otp|seeddb|boot9|boot11|secret_sector)\.bin$|^movable\.sed$/i;

function keyConsole(name: string): string {
  if (/\.keys$/i.test(name)) return "nintendo-switch";
  if (/^(aes_keys\.txt|seeddb\.bin|boot9\.bin|boot11\.bin|secret_sector\.bin|movable\.sed)$/i.test(name))
    return "nintendo-3ds";
  if (/^(otp|keys)\.bin$/i.test(name)) return "nintendo-wii-gamecube";
  return "unknown";
}

/**
 * Key names of a key file (`name = hex` lines of prod.keys, title.keys, aes_keys.txt), or the file
 * name for binary key blobs; undefined when the file is not a key file. Values are never returned.
 */
async function keyNamesOf(path: string, name: string): Promise<string[] | undefined> {
  const file = Bun.file(path);
  if (file.size === 0 || file.size > maxKeyFileBytes) return undefined;
  const bytes = await file.bytes();
  const text = bytes.includes(0) ? undefined : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() && !/^\s*[#;[]/.test(line));
    const names = lines
      .map(line => /^\s*([A-Za-z0-9_.-]{2,64})\s*[=:]\s*[0-9A-Fa-f]{16,}\s*$/.exec(line)?.[1])
      .filter((key): key is string => Boolean(key));
    if (names.length && (names.length >= lines.length * 0.6 || keyFileNames.test(name))) return names;
  }
  return keyFileNames.test(name) ? [name] : undefined;
}

// ---- classification ---------------------------------------------------------------------------

/** Systems a detected format belongs to (systems.json ids), most likely first. */
const formatSystems: Partial<Record<FormatId, string[]>> = {
  nes: ["nes"],
  fds: ["nes"],
  gb: ["gb"],
  gbc: ["gb"],
  gba: ["gba"],
  nds: ["nds"],
  n64: ["n64"],
  dol: ["gc", "wii"],
  "gamecube-disc": ["gc"],
  "wii-disc": ["wii"],
  wbfs: ["wii"],
  wia: ["gc", "wii"],
  rvz: ["gc", "wii"],
  cue: ["psx", "ps2", "dreamcast"],
  chd: ["psx", "ps2", "dreamcast", "psp"],
  "psx-exe": ["psx"],
  "psx-disc": ["psx"],
  iso9660: ["psx", "ps2", "psp", "gc", "wii", "xbox"],
  pbp: ["psp", "psx"],
  "3ds-ncsd": ["3ds"],
  "3ds-ncch": ["3ds"],
  nsp: ["switch"],
  xci: ["switch"],
  nro: ["switch"],
  genesis: ["megadrive"],
};

/** Firmware formats recognised by structure, with their catalog console. */
const firmwareFormats: Partial<Record<FormatId, { console: string; system: string }>> = {
  "gba-bios": { console: "nintendo-game-boy-advance", system: "gba" },
  "nds-arm7-bios": { console: "nintendo-ds", system: "nds" },
  "nds-arm9-bios": { console: "nintendo-ds", system: "nds" },
  "nds-firmware": { console: "nintendo-ds", system: "nds" },
  "psx-bios": { console: "sony-playstation", system: "psx" },
};

let coreBios: Promise<Map<string, Array<{ core: string; file: string; system: string }>>> | undefined;
/** libretro-core-info BIOS requirements by MD5. */
function coreBiosByMd5() {
  coreBios ??= libretroCatalog().then(cores => {
    const map = new Map<string, Array<{ core: string; file: string; system: string }>>();
    for (const core of cores)
      for (const fw of core.firmware)
        if (fw.md5)
          map.set(fw.md5, [...(map.get(fw.md5) ?? []), { core: core.id, file: fw.path, system: core.systemId }]);
    return map;
  });
  return coreBios;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/\0+$/, "").trim() : null;
}

/** Header fields that a parser checked and found wrong (complement, CRC, checksum, logo). */
function headerFailures(header: Record<string, unknown>): string[] {
  return Object.entries(header)
    .filter(([key, value]) => key.endsWith("Valid") && value === false)
    .map(([key]) => key.replace(/Valid$/, ""));
}

function storeExtension(name: string, format: string): string {
  const ext = extname(name).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
  const byFormat: Record<string, string> = { n64: "z64", "gamecube-disc": "gcm", "wii-disc": "iso", genesis: "md" };
  return byFormat[format] ?? (format !== "unknown" ? format.replace(/[^a-z0-9]/g, "").slice(0, 8) : "bin");
}

interface Classification {
  kind: OwnedKind;
  console: string;
  system: string | null;
  format: string;
  platform: string;
  title: string | null;
  serial: string | null;
  region: string | null;
  status: DumpStatus;
  reason: string | null;
  dat: string | null;
  header: Record<string, unknown>;
  keyNames: string[];
}

async function classify(path: string, name: string, digest: Digest, options: IngestOptions): Promise<Classification> {
  const keyNames = await keyNamesOf(path, name);
  if (keyNames) {
    return {
      kind: "keys",
      console: keyConsole(name),
      system: null,
      format: "keys",
      platform: "console keys",
      title: null,
      serial: null,
      region: null,
      status: "unverified-good-dump",
      reason: "console keys are not listed in public DATs",
      dat: null,
      header: {},
      keyNames,
    };
  }
  const { systems } = await loadSystems();
  const systemById = new Map(systems.map(system => [system.id, system]));
  const forced = options.system ? systemById.get(options.system) : undefined;
  if (options.system && !forced) throw new Error(`unknown system ${options.system}`);

  // BIOS and firmware: the public hash tables first, then structural detection.
  const known: FirmwareMatch[] = await catalogFirmware({
    bytes: digest.size,
    chunks: 0,
    crc32: `0x${digest.crc32}`,
    md5: digest.md5,
    sha1: digest.sha1,
    sha256: digest.sha256,
    milliseconds: 0,
  }).catch(() => []);
  const core = (await coreBiosByMd5()).get(digest.md5) ?? [];
  const image = await BinaryImage.open(path).catch(() => undefined);
  const format = image?.format ?? "unknown";
  const header = (image?.header ?? {}) as Record<string, unknown>;
  const structural = firmwareFormats[format as FormatId];
  if (known.length || core.length || structural) {
    const consoleId = known[0]?.console ?? structural?.console ?? "unknown";
    const system =
      structural?.system ?? systems.find(item => item.consoles.includes(consoleId))?.id ?? forced?.id ?? null;
    const verified = known.length > 0 || core.length > 0;
    return {
      kind: "firmware",
      console: consoleId,
      system,
      format,
      platform: image?.platform ?? "firmware",
      title: known[0]?.file ?? core[0]?.file ?? null,
      serial: null,
      region: known[0]?.region ?? null,
      status: verified ? "verified" : "unverified-good-dump",
      reason: verified
        ? [
            ...known.map(item => `firmware.json ${item.console}/${item.file}`),
            ...core.map(item => `core-info ${item.core}: ${item.file}`),
          ].join("; ")
        : "structure matches a BIOS layout; hash not in the public BIOS tables",
      dat: known.length ? "plugins/consoles/firmware.json" : core.length ? "vendor/libretro-core-info" : null,
      header: structural ? header : {},
      keyNames: [],
    };
  }

  // ROMs and disc images: candidate systems from the content, else the forced one or the name.
  const extension = extname(name).slice(1).toLowerCase();
  const candidates: SystemDefinition[] = forced
    ? [forced]
    : [
        ...(formatSystems[format as FormatId] ?? []).map(id => systemById.get(id)!).filter(Boolean),
        ...systems.filter(system => format === "unknown" && system.extensions.includes(extension)),
      ];
  const serial = text(header.gameCode) ?? text(header.serial);
  const failures = headerFailures(header);
  // An ambiguous image (ISO, CHD, CUE, .bin) is only filed under a system a DAT or serial confirms.
  let chosen = candidates.length === 1 ? candidates[0] : undefined;
  let match: DatRow | undefined;
  let serialRows: DatRow[] = [];
  for (const system of candidates) {
    const headerBytes = system.headerBytes?.[storeExtension(name, format)] ?? 0;
    const headerless =
      headerBytes && digest.size < 64 * 1024 * 1024 ? (await hashDump(path, headerBytes)).headerless : undefined;
    const result = await verifyDump(system, {
      crc: digest.crc32,
      md5: digest.md5,
      size: digest.size,
      headerless,
      serial,
    });
    if (result.match) {
      chosen = system;
      match = result.match;
      break;
    }
    if (!serialRows.length && result.serial.length) {
      chosen = system;
      serialRows = result.serial;
    }
  }
  let status: DumpStatus = "unverified-good-dump";
  let reason: string | null = null;
  if (match && !/\[b\d*\]/i.test(match.name)) {
    status = "verified";
    reason = `${basename(match.dat, ".dat")}: ${match.name}`;
  } else if (match) {
    status = "bad-dump";
    reason = `matches a bad-dump entry: ${match.name}`;
  } else if (failures.length) {
    status = "bad-dump";
    reason = `header check failed: ${failures.join(", ")}`;
  } else if (serialRows.length && serialRows.every(row => row.size && row.size !== digest.size)) {
    status = "bad-dump";
    reason = `serial ${serial} is ${serialRows[0]!.size} bytes in the DAT, the dump is ${digest.size} (trimmed or overdumped)`;
  } else if (!chosen) {
    reason = "content not recognised; pass --system";
  } else {
    reason = chosen.dats.length
      ? "not in the DATs (homebrew, prototype or undumped revision)"
      : `no DAT for ${chosen.id}`;
  }
  return {
    kind: "rom",
    console: chosen ? (chosen.consoles[0] ?? chosen.id) : "unknown",
    system: chosen?.id ?? null,
    format,
    platform: image?.platform ?? "unknown",
    title: match?.description ?? match?.name ?? text(header.title),
    serial: match?.serial ?? serial,
    region: match?.region ?? text(header.region),
    status,
    reason,
    dat: match?.dat ?? null,
    header,
    keyNames: [],
  };
}

// ---- ACLs -------------------------------------------------------------------------------------

/** NUL-terminated UTF-16 for the Win32 W functions. */
const wide = (value: string) => Buffer.from(`${value}\0`, "utf16le");

/**
 * Owner-only access: a protected DACL (OWNER RIGHTS and SYSTEM) through bun:ffi (advapi32) on Windows,
 * 0700/0600 elsewhere.
 */
export async function restrict(path: string, directory: boolean): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const advapi = dlopen("advapi32.dll", {
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    SetFileSecurityW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.bool },
  }).symbols;
  const kernel = dlopen("kernel32.dll", {
    GetLastError: { args: [], returns: FFIType.u32 },
    LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  const descriptor = new BigUint64Array(1);
  const inherit = directory ? "OICI" : "";
  if (
    !advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
      ptr(wide(`D:P(A;${inherit};FA;;;OW)(A;${inherit};FA;;;SY)`)),
      1,
      ptr(descriptor),
      null,
    )
  )
    throw new Error(`cannot build the owner-only ACL (Win32 error ${kernel.GetLastError()})`);
  try {
    const DACL_SECURITY_INFORMATION = 0x4;
    const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
    if (
      !advapi.SetFileSecurityW(
        ptr(wide(path)),
        (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION) >>> 0,
        descriptor[0],
      )
    )
      throw new Error(`cannot restrict ${basename(path)} (Win32 error ${kernel.GetLastError()})`);
  } finally {
    kernel.LocalFree(descriptor[0]);
  }
}

async function ensureKeysRoot(): Promise<string> {
  const root = ownedPaths().keys;
  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
    await restrict(root, true);
  }
  return root;
}

// ---- archives ---------------------------------------------------------------------------------

function archiveKind(head: Uint8Array): "bun" | "7z" | undefined {
  const at = (offset: number, bytes: number[]) => bytes.every((byte, index) => head[offset + index] === byte);
  if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x1f, 0x8b])) return "bun"; // zip, gzip (tar.gz)
  if (head.length > 262 && new TextDecoder().decode(head.subarray(257, 262)) === "ustar") return "bun";
  if (
    at(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ||
    at(0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) ||
    at(0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
  )
    return "7z"; // 7z, rar, xz
  return undefined;
}

async function unpack(path: string, kind: "bun" | "7z"): Promise<string> {
  const dir = join(ownedPaths().work, crypto.randomUUID());
  await mkdir(dir, { recursive: true });
  if (kind === "bun") {
    await new Bun.Archive(Bun.file(path)).extract(dir);
    return dir;
  }
  const tool = sevenZipTool();
  if (!tool) throw new Error("7z/rar/xz archives need 7-Zip (7z on PATH)");
  const result = Bun.spawnSync([tool, "x", "-y", "-bd", `-o${dir}`, path], { stdout: "ignore", stderr: "pipe" });
  if (!result.success) throw new Error(`7-Zip could not unpack ${basename(path)}`);
  return dir;
}

// ---- ingest -----------------------------------------------------------------------------------

function* walk(path: string): Generator<string> {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry.startsWith(".")) continue;
    yield* walk(join(path, entry));
  }
}

async function storeFile(
  source: string,
  classification: Classification,
  digest: Digest,
  name: string,
): Promise<{ file: string; duplicate: boolean }> {
  const paths = ownedPaths();
  const root =
    classification.kind === "keys"
      ? await ensureKeysRoot()
      : classification.kind === "firmware"
        ? paths.firmware
        : paths.roms;
  const directory = join(root, classification.console);
  if (!existsSync(directory)) {
    await mkdir(directory, { recursive: true });
    if (classification.kind === "keys") await restrict(directory, true);
  }
  const target = join(directory, `${digest.sha256}.${storeExtension(name, classification.format)}`);
  const file = relative(paths.share, target).replaceAll("\\", "/");
  if (existsSync(target) && Bun.file(target).size === digest.size) return { file, duplicate: true };
  const partial = `${target}.part`;
  await Bun.write(partial, Bun.file(source));
  if (classification.kind === "keys") await restrict(partial, false);
  await rename(partial, target);
  if (classification.kind !== "keys") {
    const manifest = Bun.file(join(directory, `${digest.sha256}.json`));
    if (!(await manifest.exists())) {
      const record: FirmwareManifest & { origin: "owned" } = {
        console: classification.console,
        sha256: digest.sha256,
        bytes: digest.size,
        file: basename(target),
        importedAt: new Date().toISOString(),
        origin: "owned",
      };
      await Bun.write(manifest, `${JSON.stringify(record, null, 2)}\n`);
    }
  }
  return { file, duplicate: false };
}

async function ingestFile(path: string, label: string, options: IngestOptions, results: IngestResult[]): Promise<void> {
  const name = basename(label);
  const file = Bun.file(path);
  if (file.size === 0) {
    results.push({ input: label, error: "empty file" });
    return;
  }
  const kind = archiveKind(await file.slice(0, 512).bytes());
  if (kind && options.system !== "arcade") {
    const dir = await unpack(path, kind);
    try {
      for (const member of walk(dir))
        await ingestFile(member, `${label}/${relative(dir, member).replaceAll("\\", "/")}`, options, results);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return;
  }
  const digest = await hashDump(path);
  const known = ownedDb().query<Row, [string]>("SELECT * FROM owned WHERE sha256 = ?").get(digest.sha256);
  const supplied = options.via ? `${options.via}:${name}` : name;
  if (known && existsSync(storePath(known))) {
    const names = [...new Set([...JSON.parse(known.names), supplied])];
    ownedDb().query("UPDATE owned SET names = ? WHERE sha256 = ?").run(JSON.stringify(names), digest.sha256);
    results.push(summary(label, fromRow({ ...known, names: JSON.stringify(names) }), true));
    return;
  }
  const classification = await classify(path, name, digest, options);
  const { file: stored, duplicate } = await storeFile(path, classification, digest, name);
  const dump: OwnedDump = {
    sha256: digest.sha256,
    kind: classification.kind,
    system: classification.system,
    console: classification.console,
    format: classification.format,
    platform: classification.platform,
    title: classification.title,
    serial: classification.serial,
    region: classification.region,
    size: digest.size,
    crc32: digest.crc32,
    md5: digest.md5,
    sha1: digest.sha1,
    gitBlob: digest.gitBlob,
    status: classification.status,
    reason: classification.reason,
    dat: classification.dat,
    file: stored,
    names: [supplied],
    keyNames: classification.keyNames,
    header:
      classification.kind === "keys"
        ? {}
        : JSON.parse(JSON.stringify(classification.header, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    importedAt: new Date().toISOString(),
  };
  ownedDb()
    .query(
      `INSERT OR REPLACE INTO owned VALUES ($sha256, $kind, $system, $console, $format, $platform, $title, $serial,
        $region, $size, $crc32, $md5, $sha1, $gitBlob, $status, $reason, $dat, $file, $names, $keyNames, $header, $importedAt)`,
    )
    .run({
      ...dump,
      names: JSON.stringify(dump.names),
      keyNames: JSON.stringify(dump.keyNames),
      header: JSON.stringify(dump.header),
    });
  results.push(summary(label, dump, duplicate));
}

function summary(input: string, dump: OwnedDump, duplicate: boolean): IngestResult {
  return {
    input,
    sha256: dump.sha256,
    kind: dump.kind,
    system: dump.system,
    console: dump.console,
    format: dump.format,
    status: dump.status,
    reason: dump.reason,
    title: dump.title,
    duplicate,
    ...(dump.kind === "keys" ? { keyNames: dump.keyNames } : {}),
  };
}

/** Ingests files, directories and archives the owner supplies; one failing file never stops the rest. */
export async function ingestPaths(inputs: string[], options: IngestOptions = {}): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  mkdirSync(ownedPaths().work, { recursive: true });
  for (const input of inputs) {
    const full = resolve(input);
    if (!existsSync(full)) {
      results.push({ input, error: "not found" });
      continue;
    }
    for (const path of walk(full)) {
      const label = full === path ? input : `${input}/${relative(full, path).replaceAll("\\", "/")}`;
      try {
        await ingestFile(path, label, options, results);
      } catch (error) {
        // Messages name the input only; key material never reaches an error.
        results.push({ input: label, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return results;
}

/** Forgets a dump and deletes its store file (a free-firmware import of the same bytes is kept). */
export async function removeOwned(sha256: string): Promise<OwnedDump> {
  const dump = ownedBySha(sha256);
  if (!dump) throw new Error(`no owned dump ${sha256}`);
  const path = storePath(dump);
  const manifestPath = path.replace(/\.[^.\\/]+$/, ".json");
  const manifest = (await Bun.file(manifestPath).exists())
    ? ((await Bun.file(manifestPath).json()) as { origin?: string })
    : undefined;
  if (dump.kind === "keys" || !manifest || manifest.origin === "owned") {
    await rm(path, { force: true });
    if (manifest) await rm(manifestPath, { force: true });
  }
  ownedDb().query("DELETE FROM owned WHERE sha256 = ?").run(dump.sha256);
  ownedDb().query("DELETE FROM owned_sync WHERE sha256 = ?").run(dump.sha256);
  return dump;
}

/** Public listing: keys show their names only. */
export function describe(dump: OwnedDump) {
  const { gitBlob: _blob, header, crc32, md5, sha1, ...rest } = dump;
  // Key files: the store id and the key names only (no digests of the key material).
  return dump.kind === "keys" ? rest : { ...rest, crc32, md5, sha1, header };
}
