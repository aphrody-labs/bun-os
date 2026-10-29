// SPDX-License-Identifier: Apache-2.0
/**
 * One file-type registry for open / preview / import in the shell and play. Detection reads
 * content, never only the extension:
 *   1. the platform magic table (images, video, audio, archives, packages, executables, fonts,
 *      documents, databases, saves, themes, catalogs, plugins);
 *   2. plugin detectors (built-ins: Bun Engine console images and firmware with typed headers;
 *      then installed plugins);
 *   3. Magika (packages/re, through the runtime SDK Python host) when asked and still unknown;
 *   4. the extension, at low confidence.
 * Previews use native Bun APIs: Bun.Image (thumbnails, `nearest` for pixel art), ffmpeg/ffprobe when
 * installed (video frame, video and audio metadata; upstream Bun has no video API), Bun.Archive (tar, tar.gz, zip listings), 7-Zip for 7z/rar, plugin previewers
 * (ROM headers, PE/APK inspectors). Large files are read through bounded slices of a BunFile.
 */
import { basename, extname, join } from "node:path";
import { platformPaths, repoRoot } from "../paths";
import { type Detection, type DetectInput, type PluginRegistry, plugins, type Preview } from "../plugins";

export type { Detection, Preview } from "../plugins";

export interface FileInfo extends Detection {
  path: string;
  name: string;
  size: number;
}

type Sig = { at?: number; bytes: (number | null)[] } | { at?: number; text: string };
interface MagicEntry {
  kind: string;
  format: string;
  mime: string;
  sig: Sig[];
  /** All signatures must match (default: any). */
  all?: boolean;
  test?: (head: Uint8Array, input: DetectInput) => boolean;
}

const t = (text: string, at = 0): Sig => ({ text, at });
const b = (bytes: (number | null)[], at = 0): Sig => ({ bytes, at });

/** Content signatures, most specific first. */
const MAGIC: MagicEntry[] = [
  {
    kind: "image",
    format: "png",
    mime: "image/png",
    sig: [b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  },
  {
    kind: "image",
    format: "jpeg",
    mime: "image/jpeg",
    sig: [b([0xff, 0xd8, 0xff])],
  },
  {
    kind: "image",
    format: "gif",
    mime: "image/gif",
    sig: [t("GIF87a"), t("GIF89a")],
  },
  {
    kind: "image",
    format: "webp",
    mime: "image/webp",
    sig: [t("RIFF"), t("WEBP", 8)],
    all: true,
  },
  {
    kind: "image",
    format: "avif",
    mime: "image/avif",
    sig: [t("ftypavif", 4), t("ftypavis", 4)],
  },
  {
    kind: "image",
    format: "heic",
    mime: "image/heic",
    sig: [t("ftypheic", 4), t("ftypmif1", 4)],
  },
  {
    kind: "image",
    format: "bmp",
    mime: "image/bmp",
    sig: [t("BM")],
    test: h => h.length > 26 && h[14] !== undefined && [12, 40, 56, 108, 124].includes(h[14]),
  },
  {
    kind: "image",
    format: "ico",
    mime: "image/x-icon",
    sig: [b([0, 0, 1, 0])],
  },
  { kind: "image", format: "qoi", mime: "image/qoi", sig: [t("qoif")] },
  {
    kind: "image",
    format: "svg",
    mime: "image/svg+xml",
    sig: [],
    test: h => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(ascii(h, 0, 512)),
  },
  {
    kind: "video",
    format: "mp4",
    mime: "video/mp4",
    sig: [t("ftypisom", 4), t("ftypmp42", 4), t("ftypmp41", 4), t("ftypavc1", 4), t("ftypM4V ", 4), t("ftypdash", 4)],
  },
  {
    kind: "video",
    format: "mov",
    mime: "video/quicktime",
    sig: [t("ftypqt  ", 4), t("moov", 4)],
  },
  {
    kind: "video",
    format: "matroska",
    mime: "video/x-matroska",
    sig: [b([0x1a, 0x45, 0xdf, 0xa3])],
    test: h => !ascii(h, 0, 64).includes("webm"),
  },
  {
    kind: "video",
    format: "webm",
    mime: "video/webm",
    sig: [b([0x1a, 0x45, 0xdf, 0xa3])],
  },
  {
    kind: "video",
    format: "avi",
    mime: "video/x-msvideo",
    sig: [t("RIFF"), t("AVI ", 8)],
    all: true,
  },
  {
    kind: "audio",
    format: "wav",
    mime: "audio/wav",
    sig: [t("RIFF"), t("WAVE", 8)],
    all: true,
  },
  { kind: "audio", format: "flac", mime: "audio/flac", sig: [t("fLaC")] },
  { kind: "audio", format: "ogg", mime: "audio/ogg", sig: [t("OggS")] },
  {
    kind: "audio",
    format: "mp3",
    mime: "audio/mpeg",
    sig: [t("ID3"), b([0xff, 0xfb]), b([0xff, 0xf3]), b([0xff, 0xf2])],
  },
  { kind: "audio", format: "m4a", mime: "audio/mp4", sig: [t("ftypM4A ", 4)] },
  { kind: "audio", format: "midi", mime: "audio/midi", sig: [t("MThd")] },
  {
    kind: "package",
    format: "apk",
    mime: "application/vnd.android.package-archive",
    sig: [t("PK\u0003\u0004")],
    test: h => ascii(h, 0, h.length).includes("AndroidManifest.xml"),
  },
  {
    kind: "package",
    format: "deb",
    mime: "application/vnd.debian.binary-package",
    sig: [t("!<arch>\ndebian-binary")],
  },
  {
    kind: "package",
    format: "msi",
    mime: "application/x-msi",
    sig: [b([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  },
  {
    kind: "archive",
    format: "zip",
    mime: "application/zip",
    sig: [t("PK\u0003\u0004"), t("PK\u0005\u0006")],
  },
  {
    kind: "archive",
    format: "gzip",
    mime: "application/gzip",
    sig: [b([0x1f, 0x8b])],
  },
  {
    kind: "archive",
    format: "zstd",
    mime: "application/zstd",
    sig: [b([0x28, 0xb5, 0x2f, 0xfd])],
  },
  {
    kind: "archive",
    format: "xz",
    mime: "application/x-xz",
    sig: [b([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])],
  },
  {
    kind: "archive",
    format: "bzip2",
    mime: "application/x-bzip2",
    sig: [t("BZh")],
  },
  {
    kind: "archive",
    format: "7z",
    mime: "application/x-7z-compressed",
    sig: [b([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
  },
  {
    kind: "archive",
    format: "rar",
    mime: "application/vnd.rar",
    sig: [t("Rar!\u001a\u0007")],
  },
  {
    kind: "archive",
    format: "tar",
    mime: "application/x-tar",
    sig: [t("ustar", 257)],
  },
  {
    kind: "executable",
    format: "wasm",
    mime: "application/wasm",
    sig: [b([0x00, 0x61, 0x73, 0x6d])],
  },
  {
    kind: "executable",
    format: "pe",
    mime: "application/vnd.microsoft.portable-executable",
    sig: [t("MZ")],
    test: h => {
      const off = h.length > 0x40 ? new DataView(h.buffer, h.byteOffset).getUint32(0x3c, true) : 0;
      return off > 0 && off + 4 <= h.length && ascii(h, off, 4) === "PE\0\0";
    },
  },
  {
    kind: "executable",
    format: "macho",
    mime: "application/x-mach-binary",
    sig: [b([0xcf, 0xfa, 0xed, 0xfe]), b([0xca, 0xfe, 0xba, 0xbe])],
  },
  { kind: "font", format: "woff2", mime: "font/woff2", sig: [t("wOF2")] },
  { kind: "font", format: "woff", mime: "font/woff", sig: [t("wOFF")] },
  { kind: "font", format: "otf", mime: "font/otf", sig: [t("OTTO")] },
  {
    kind: "font",
    format: "ttf",
    mime: "font/ttf",
    sig: [b([0x00, 0x01, 0x00, 0x00, 0x00])],
  },
  { kind: "font", format: "ttc", mime: "font/collection", sig: [t("ttcf")] },
  {
    kind: "document",
    format: "pdf",
    mime: "application/pdf",
    sig: [t("%PDF-")],
  },
  {
    kind: "database",
    format: "sqlite",
    mime: "application/vnd.sqlite3",
    sig: [t("SQLite format 3\u0000")],
  },
  {
    kind: "save",
    format: "retroarch-state",
    mime: "application/octet-stream",
    sig: [t("RASTATE")],
  },
];

function ascii(h: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = at; i < Math.min(h.length, at + len); i++) s += String.fromCharCode(h[i] as number);
  return s;
}

function sigMatches(h: Uint8Array, sig: Sig): boolean {
  const at = sig.at ?? 0;
  if ("text" in sig) return ascii(h, at, sig.text.length) === sig.text;
  return sig.bytes.every((v, i) => v === null || h[at + i] === v);
}

function magic(input: DetectInput): Detection | null {
  const h = input.head;
  for (const e of MAGIC) {
    const ok =
      e.sig.length === 0 ? true : e.all ? e.sig.every(s => sigMatches(h, s)) : e.sig.some(s => sigMatches(h, s));
    if (ok && (!e.test || e.test(h, input)))
      return {
        kind: e.kind,
        format: e.format,
        mime: e.mime,
        confidence: 1,
        by: "magic",
      };
  }
  return null;
}

/** Text formats recognized by content (catalogs, themes, plugin manifests, JSON, text). */
function textual(input: DetectInput): Detection | null {
  const h = input.head;
  // Binary if NUL bytes in the first 8 KiB.
  for (let i = 0; i < Math.min(h.length, 8192); i++) if (h[i] === 0) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(h.subarray(0, Math.min(h.length, 65536)));
  } catch {
    return null;
  }
  const trimmed = text.trimStart();
  if (input.name === "plugin.json" && /"permissions"\s*:/.test(text))
    return {
      kind: "plugin",
      format: "bun-os-plugin",
      mime: "application/json",
      confidence: 0.95,
      by: "content",
    };
  if (/bun-os-theme\/1/.test(text) || /--bun-os-theme-seed\s*:/.test(text))
    return {
      kind: "theme",
      format: "bun-os-theme",
      mime: "application/json",
      confidence: 0.95,
      by: "content",
    };
  if (
    /^-?[a-zA-Z][\w-]*\s*=\s*\S/m.test(text) &&
    /^(#.*|\s*|-?[a-zA-Z][\w-]*\s*=.*|\s+.*)$/m.test(text) &&
    input.name.endsWith(".ftl")
  )
    return {
      kind: "document",
      format: "fluent",
      mime: "text/x-fluent",
      confidence: 0.9,
      by: "content",
    };
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(text);
      return {
        kind: "document",
        format: "json",
        mime: "application/json",
        confidence: 0.9,
        by: "content",
      };
    } catch {
      /* not JSON */
    }
  }
  if (/^<\?xml|^<!doctype html|^<html/i.test(trimmed))
    return {
      kind: "document",
      format: /html/i.test(trimmed.slice(0, 64)) ? "html" : "xml",
      mime: "text/html",
      confidence: 0.85,
      by: "content",
    };
  return {
    kind: "document",
    format: "text",
    mime: "text/plain",
    confidence: 0.5,
    by: "content",
  };
}

/** Battery saves have no header: power-of-two sizes with a save extension. */
function save(input: DetectInput): Detection | null {
  const ext = extname(input.name).toLowerCase();
  if (![".sav", ".srm", ".eep", ".fla", ".dsv", ".mcr", ".gci", ".state", ".ss0", ".ss1"].includes(ext)) return null;
  const pow2 = input.size > 0 && (input.size & (input.size - 1)) === 0;
  return {
    kind: "save",
    format: ext.slice(1),
    mime: "application/octet-stream",
    confidence: pow2 || ext.startsWith(".s") ? 0.7 : 0.4,
    by: "size+extension",
  };
}

const EXTENSION: Record<string, [string, string]> = {
  ".iso": ["rom", "iso9660"],
  ".bin": ["rom", "raw-binary"],
  ".cue": ["rom", "cue"],
  ".rom": ["firmware", "rom"],
};

export async function readHead(path: string, bytes = 0x10000): Promise<{ head: Uint8Array; size: number }> {
  const file = Bun.file(path);
  const size = file.size;
  return {
    head: new Uint8Array(await file.slice(0, Math.min(size, bytes)).arrayBuffer()),
    size,
  };
}

export interface DetectOptions {
  /** Ask Magika (Python host) when the content is still unknown. */
  magika?: boolean;
  registry?: PluginRegistry;
}

/** Detects a file by content; returns the best detection with all candidates considered. */
export async function detectFile(path: string, options: DetectOptions = {}): Promise<FileInfo> {
  const { head, size } = await readHead(path);
  const name = basename(path);
  const input: DetectInput = { path, name, size, head };
  const candidates: Detection[] = [];
  const m = magic(input);
  if (m) candidates.push(m);
  const registry = options.registry ?? (await plugins());
  if (!m || m.kind === "archive" || m.kind === "executable") {
    for (const d of registry.detectors) {
      if (d.filter && !d.filter.test(name)) continue;
      if (d.magic && !d.magic.every((v, i) => head[d.offset + i] === v)) continue;
      try {
        const r = await d.detect(input);
        if (r) candidates.push({ ...r, by: r.by || d.plugin });
      } catch {
        /* a failing detector never hides the others */
      }
    }
  }
  const s = save(input);
  if (s) candidates.push(s);
  if (!candidates.some(c => c.confidence >= 0.8)) {
    const text = textual(input);
    if (text) candidates.push(text);
  }
  if (options.magika && !candidates.some(c => c.confidence >= 0.8)) {
    try {
      const { identifyWithMagika } = (await import(join(repoRoot, "packages", "re", "src", "ml", "magika.ts"))) as {
        identifyWithMagika(p: string): Promise<{
          label?: string;
          output?: { label?: string; mime_type?: string; group?: string };
          score?: number;
        }>;
      };
      const r = await identifyWithMagika(path);
      const label = r.output?.label ?? r.label;
      if (label)
        candidates.push({
          kind: r.output?.group ?? "unknown",
          format: label,
          mime: r.output?.mime_type,
          confidence: r.score ?? 0.6,
          by: "magika",
        });
    } catch {
      /* Magika needs the bun_python host; absent here */
    }
  }
  const ext = EXTENSION[extname(name).toLowerCase()];
  if (ext)
    candidates.push({
      kind: ext[0],
      format: ext[1],
      confidence: 0.3,
      by: "extension",
    });
  candidates.sort((a, c) => c.confidence - a.confidence);
  const best = candidates[0] ?? {
    kind: "unknown",
    format: "unknown",
    confidence: 0,
    by: "none",
  };
  return { ...best, path, name, size };
}

const PIXEL_ART_MAX = 256;

async function imagePreview(path: string, width: number): Promise<Preview> {
  const image = new Bun.Image(path);
  const metadata = await image.metadata();
  const pixelArt = Math.max(metadata.width, metadata.height) <= PIXEL_ART_MAX;
  const thumbnail = await new Bun.Image(path)
    .resize(width, width, {
      fit: "inside",
      filter: pixelArt ? "nearest" : "lanczos3",
    } as never)
    .webp({ quality: 82 })
    .bytes();
  return { kind: "image", thumbnail, metadata: { ...metadata, pixelArt } };
}

type Metadata = Record<string, unknown>;

async function capture(argv: string[]): Promise<Uint8Array> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
  const [bytes, code] = await Promise.all([new Response(child.stdout).bytes(), child.exited]);
  if (code !== 0) throw new Error(`${argv[0]} exited with ${code}`);
  return bytes;
}

/** Container and stream facts through ffprobe; null when ffprobe is missing or rejects the file. */
async function probeMedia(path: string): Promise<Metadata | null> {
  const ffprobe = Bun.which("ffprobe");
  if (!ffprobe) return null;
  try {
    const out = await capture([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
    return JSON.parse(new TextDecoder().decode(out)) as Metadata;
  } catch {
    return null;
  }
}

async function videoPreview(path: string, width: number): Promise<Preview> {
  const probe = await probeMedia(path);
  if (!probe) return { kind: "video", metadata: { size: Bun.file(path).size, probe: "ffprobe unavailable" } };
  const streams = (probe.streams as { codec_type?: string; width?: number; height?: number; codec_name?: string }[]) ?? [];
  const stream = streams.find(s => s.codec_type === "video");
  const duration = Number((probe.format as { duration?: string } | undefined)?.duration ?? 0);
  const metadata = {
    width: stream?.width,
    height: stream?.height,
    codec: stream?.codec_name,
    duration,
    ...probe,
  };
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg) return { kind: "video", metadata };
  const at = Math.min(Math.max(0, duration * 0.1), 10);
  try {
    const png = await capture([
      ffmpeg, "-v", "error", "-ss", String(at), "-i", path, "-frames:v", "1",
      "-vf", `scale=${width}:-2`, "-f", "image2pipe", "-c:v", "png", "pipe:1",
    ]);
    const thumbnail = await new Bun.Image(png).webp({ quality: 80 }).bytes();
    return { kind: "video", thumbnail, metadata };
  } catch {
    return { kind: "video", metadata };
  }
}

async function audioPreview(path: string): Promise<Preview> {
  return { kind: "audio", metadata: (await probeMedia(path)) ?? { size: Bun.file(path).size } };
}

async function archivePreview(path: string, format: string): Promise<Preview> {
  if (format === "7z" || format === "rar" || format === "xz" || format === "bzip2") {
    // bep's 7-Zip owner (packages/bun-engine/src/usr.ts).
    const seven = Bun.which("7z") ?? (process.platform === "win32" ? "C:\\Program Files\\7-Zip\\7z.exe" : null);
    if (!seven)
      return {
        kind: "archive",
        metadata: { format, lister: "7-Zip not installed" },
      };
    const out = Bun.spawnSync([seven, "l", "-slt", "-ba", path]);
    const entries: { path: string; size: number }[] = [];
    let cur: { path?: string; size?: number } = {};
    for (const line of out.stdout.toString().split(/\r?\n/)) {
      const [k, ...v] = line.split(" = ");
      if (k === "Path") cur = { path: v.join(" = ") };
      else if (k === "Size" && cur.path) entries.push({ path: cur.path, size: Number(v[0]) || 0 });
    }
    return {
      kind: "archive",
      entries,
      metadata: { format, count: entries.length },
    };
  }
  if (format === "zstd")
    return {
      kind: "archive",
      metadata: { format, note: "single zstd stream" },
    };
  const archive = new Bun.Archive(Bun.file(path));
  const files = await archive.files();
  const entries = [...files].map(([p, f]) => ({ path: p, size: f.size }));
  return {
    kind: "archive",
    entries: entries.slice(0, 500),
    metadata: { format, count: entries.length },
  };
}

async function savePreview(path: string): Promise<Preview> {
  const { head, size } = await readHead(path, 64);
  return {
    kind: "save",
    metadata: { size, head: Buffer.from(head).toString("hex") },
  };
}

/** Preview data for the shell and play (thumbnail as WebP bytes, metadata, archive entries). */
export async function previewFile(
  path: string,
  options: {
    width?: number;
    detection?: FileInfo;
    registry?: PluginRegistry;
  } = {},
): Promise<Preview & { detection: FileInfo }> {
  const detection = options.detection ?? (await detectFile(path));
  const width = options.width ?? 320;
  const registry = options.registry ?? (await plugins());
  const { head, size } = await readHead(path);
  for (const p of registry.previewers) {
    if ((p.kind && p.kind !== detection.kind) || (p.format && p.format !== detection.format)) continue;
    const r = await p.preview({
      path,
      name: detection.name,
      size,
      head,
      detection,
    });
    if (r) return { ...r, detection };
  }
  let preview: Preview;
  switch (detection.kind) {
    case "image":
      preview =
        detection.format === "svg" || detection.format === "ico" || detection.format === "qoi"
          ? { kind: "image", metadata: { format: detection.format } }
          : await imagePreview(path, width);
      break;
    case "video":
      preview = await videoPreview(path, width);
      break;
    case "audio":
      preview = await audioPreview(path);
      break;
    case "archive":
    case "package":
      preview =
        detection.format === "deb" || detection.format === "msi"
          ? await packagePreview(path, detection.format)
          : await archivePreview(path, detection.format === "apk" ? "zip" : detection.format);
      break;
    case "save":
      preview = await savePreview(path);
      break;
    default:
      preview = { kind: detection.kind, metadata: { size } };
  }
  return { ...preview, detection };
}

async function packagePreview(path: string, format: string): Promise<Preview> {
  if (format === "deb") {
    try {
      const { inspect } = (await import(join(repoRoot, "packages", "package-converter", "src", "convert.ts"))) as {
        inspect(
          p: string,
          o: Record<string, unknown>,
        ): Promise<{ inspection: Record<string, unknown>; entries: unknown[] }>;
      };
      const r = await inspect(path, {});
      return { kind: "package", metadata: r.inspection };
    } catch (error) {
      return { kind: "package", metadata: { format, error: String(error) } };
    }
  }
  return { kind: "package", metadata: { format } };
}

/** Imports a file into the right `usr/` store by kind (ROMs and firmware to bep's store, themes and catalogs to the platform). */
export async function importFile(path: string): Promise<{ to: string; detection: FileInfo }> {
  const detection = await detectFile(path);
  const usr = platformPaths().usr;
  const dir =
    detection.kind === "rom"
      ? join(usr, "share", "bun-engine", "system", detection.platform ?? "unknown")
      : detection.kind === "firmware"
        ? join(usr, "share", "bun-engine", "firmware")
        : detection.kind === "theme"
          ? platformPaths().themes
          : detection.kind === "save"
            ? join(usr, "var", "lib", "bun-os", "saves")
            : null;
  if (!dir) throw new Error(`${detection.name}: ${detection.kind} files are opened, not imported`);
  const to = join(dir, detection.name);
  await Bun.write(to, Bun.file(path));
  return { to, detection };
}
