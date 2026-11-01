// SPDX-License-Identifier: Apache-2.0
// `m3-bun package`: the distributable of an app. Compiles for a target, stages the executable with a README,
// the build manifest and checksums (and, on request, the generated deploy configs), archives it
// (tar.gz, or zip for Windows; Bun writes both) and writes the archive's SHA-256. `--rootfs` also writes the root filesystem of a
// scratch image: the executable and exactly the shared libraries `ldd` lists for it.
import { chmod, cp, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { compileApp, type CompileReport } from "./compile.ts";
import { loadApp, type CompileTargetName, type M3App } from "./config.ts";
import { generateTargets, contextFor } from "./targets/index.ts";
import { sha256 } from "./util.ts";

/** Absolute library paths from the output of `ldd`: `libc.so.6 => /lib/.../libc.so.6 (0x..)` and `/lib64/ld-linux-x86-64.so.2 (0x..)`. */
export function parseLdd(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const arrow = /=>\s*(\/\S+)/.exec(line);
    const bare = /^\s*(\/\S+)\s*\(0x/.exec(line);
    const path = arrow?.[1] ?? bare?.[1];
    if (path) paths.add(path);
  }
  return [...paths].toSorted();
}

export interface RootfsReport {
  dir: string;
  executable: string;
  libraries: string[];
  bytes: number;
}

/** Root filesystem of a scratch image: `/app/server` plus its libraries at their own absolute paths. Linux only. */
export async function buildRootfs(executable: string, dir: string): Promise<RootfsReport> {
  if (process.platform !== "linux") {
    throw new Error("m3-bun: --rootfs lists the executable's libraries with ldd and needs a Linux host");
  }
  const ldd = Bun.spawnSync(["ldd", executable], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = ldd.stdout.toString();
  if (ldd.exitCode !== 0 && !text.includes("=>")) {
    throw new Error(
      `m3-bun: ldd cannot read ${executable} (${ldd.stderr.toString().trim() || "not a dynamic executable for this host"}); build the rootfs on a host with the target's libc`,
    );
  }
  const libraries = parseLdd(text);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "app"), { recursive: true });
  await cp(executable, join(dir, "app", "server"));
  await chmod(join(dir, "app", "server"), 0o755);
  let bytes = Bun.file(executable).size;
  for (const library of libraries) {
    const target = join(dir, library);
    // oxlint-disable-next-line no-await-in-loop -- Create each library destination before copying and counting its staged bytes.
    await mkdir(dirname(target), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- Stage libraries serially to bound disk work and stop on the first failed copy.
    await cp(library, target, { dereference: true });
    bytes += Bun.file(target).size;
  }
  return { dir, executable: join(dir, "app", "server"), libraries, bytes };
}

export type ArchiveFormat = "tar.gz" | "zip";

interface ArchiveEntry {
  /** POSIX path relative to the staging root, `/`-terminated for directories. */
  name: string;
  mode: number;
  data: Uint8Array;
}

/** Windows has no execute bit: a file is executable when it starts like a program (shebang, PE, ELF, Mach-O). */
function looksExecutable(data: Uint8Array): boolean {
  const magic = (bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  return (
    magic([0x23, 0x21]) ||
    magic([0x4d, 0x5a]) ||
    magic([0x7f, 0x45, 0x4c, 0x46]) ||
    magic([0xcf, 0xfa, 0xed, 0xfe]) ||
    magic([0xca, 0xfe, 0xba, 0xbe])
  );
}

/** Every directory and file under `staging`, sorted by name, with POSIX modes. */
async function archiveEntries(staging: string): Promise<ArchiveEntry[]> {
  const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: staging, onlyFiles: false, dot: true }));
  const entries: ArchiveEntry[] = [];
  for (const path of paths) {
    const name = path.replaceAll("\\", "/");
    const full = join(staging, path);
    // oxlint-disable-next-line no-await-in-loop -- One stat per staged path, in a bounded directory.
    const info = await stat(full);
    if (info.isDirectory()) {
      entries.push({ name: `${name}/`, mode: 0o755, data: new Uint8Array() });
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Staged files are read one at a time to bound memory.
    const data = new Uint8Array(await Bun.file(full).arrayBuffer());
    const mode = process.platform === "win32" ? (looksExecutable(data) ? 0o755 : 0o644) : info.mode & 0o777;
    entries.push({ name, mode, data });
  }
  return entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const encoder = new TextEncoder();

/** ustar header: owner 0:0, mtime 0, so the same files give the same bytes on every host. */
function tarHeader(name: string, mode: number, size: number, type: "0" | "5"): Uint8Array {
  const header = new Uint8Array(512);
  const put = (offset: number, length: number, value: string) =>
    header.set(encoder.encode(value).subarray(0, length), offset);
  const octal = (offset: number, length: number, value: number) =>
    put(offset, length - 1, value.toString(8).padStart(length - 1, "0"));
  let prefix = "";
  let base = name;
  if (encoder.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", name.length - 2);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (cut < 0 || encoder.encode(base).length > 100 || encoder.encode(prefix).length > 155) {
      throw new Error(`m3-bun: path too long for a tar archive: ${name}`);
    }
  }
  put(0, 100, base);
  octal(100, 8, mode);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  header.fill(0x20, 148, 156);
  put(156, 1, type);
  put(257, 6, "ustar");
  put(263, 2, "00");
  put(345, 155, prefix);
  const sum = header.reduce((total, byte) => total + byte, 0);
  put(148, 7, `${sum.toString(8).padStart(6, "0")}\0`);
  return header;
}

function tarGz(entries: ArchiveEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [tarHeader("./", 0o755, 0, "5")];
  for (const entry of entries) {
    const directory = entry.name.endsWith("/");
    chunks.push(tarHeader(`./${entry.name}`, entry.mode, entry.data.length, directory ? "5" : "0"));
    if (directory) continue;
    chunks.push(entry.data);
    const pad = (512 - (entry.data.length % 512)) % 512;
    if (pad) chunks.push(new Uint8Array(pad));
  }
  chunks.push(new Uint8Array(1024));
  return Bun.gzipSync(Buffer.concat(chunks), { level: 9 });
}

/** Zip with Unix modes in the external attributes and a fixed 1980-01-01 timestamp. */
function zip(entries: ArchiveEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const directory = entry.name.endsWith("/");
    const name = encoder.encode(entry.name);
    const deflated = directory ? entry.data : deflateRawSync(entry.data, { level: 9 });
    const method = directory || deflated.length >= entry.data.length ? 0 : 8;
    const body = method === 8 ? deflated : entry.data;
    const crc = Bun.hash.crc32(entry.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x21, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(entry.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    chunks.push(head, name, body);
    const unixMode = (directory ? 0o40000 : 0o100000) | entry.mode;
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((unixMode * 0x10000 + (directory ? 0x10 : 0)) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += head.length + name.length + body.length;
  }
  const size = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

/** Who wrote an archive: `Bun.Archive`, or the writers above on a runtime whose `Bun.Archive` lacks modes and zip. */
export type Archiver = "bun-archive" | "m3-bun";

/** Whether Bun.Archive can preserve this packager's ZIP and POSIX-mode contract. */
export function bunArchiveSupported(): Promise<boolean> {
  // Upstream Bun.Archive accepts BlobPart contents and only exposes gzip
  // compression. It cannot set entry modes, ZIP format, or a fixed mtime, so
  // the deterministic writers below remain the compatible implementation.
  return Promise.resolve(false);
}

/**
 * Archive the contents of `staging` into `archive`. Bun writes it (`Bun.Archive` when the runtime has the full
 * contract), so no `tar` or `zip` is needed, and the bytes depend only on the names, contents and modes of the files.
 */
export async function archiveDir(staging: string, archive: string, format: ArchiveFormat): Promise<Archiver> {
  await mkdir(dirname(archive), { recursive: true });
  await rm(archive, { force: true });
  const entries = await archiveEntries(staging);
  await Bun.write(archive, format === "zip" ? zip(entries) : tarGz(entries));
  return "m3-bun";
}
export interface PackageOptions {
  dir?: string;
  configFile?: string;
  target?: CompileTargetName;
  /** Archive format (default zip for Windows targets, else tar.gz). */
  format?: ArchiveFormat;
  /** Output directory (default `<app>/release`). */
  out?: string;
  /** Also write `<out>/rootfs` for a scratch image (Linux glibc targets, on a Linux host). */
  rootfs?: boolean;
  /** Include the generated deploy configs under `deploy/` in the archive. */
  deploy?: boolean;
  /** Reuse an executable instead of compiling. */
  executable?: string;
  app?: M3App;
}

export interface PackageReport {
  archive: string;
  bytes: number;
  sha256: string;
  checksumFile: string;
  /** `Bun.Archive` or the built-in writers. */
  archiver: Archiver;
  files: string[];
  compile?: CompileReport;
  rootfs?: RootfsReport;
}

const readmeText = (name: string, version: string, exe: string, port: number) => `${name} ${version}

One executable serves the UI and the API from the same process.

  ${exe}                  serve on $PORT (default ${port})
  ${exe} --port 8080      choose the port
  ${exe} --healthcheck    exit 0 when the running instance answers /healthz
  ${exe} --version

Endpoints: / (UI), /healthz, /api/m3/info and the app's own /api/* routes.
Verify the download with SHA256SUMS. Built with @aphrody/m3-bun; the executable embeds the Bun runtime.
`;

/** Compile, stage and archive an app. */
export async function packageApp(options: PackageOptions = {}): Promise<PackageReport> {
  const app = options.app ?? (await loadApp(resolve(options.dir ?? process.cwd()), options.configFile));
  const target = options.target ?? app.bun.compile?.target;
  const windows = (target ?? "").startsWith("windows");
  const format = options.format ?? (windows ? "zip" : "tar.gz");
  const out = resolve(options.out ?? join(app.dir, "release"));
  const exeName = `${app.name}${windows ? ".exe" : ""}`;
  const stem = `${app.name}-${app.version}-${target ?? `${process.platform}-${process.arch}`}`;
  const staging = join(out, ".staging", stem);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  let compile: CompileReport | undefined;
  let executable = options.executable ? resolve(options.executable) : undefined;
  if (!executable) {
    compile = await compileApp({
      app,
      ...(target ? { target } : {}),
      outfile: join(staging, exeName),
    });
    executable = compile.outfile;
  } else {
    await cp(executable, join(staging, exeName));
    executable = join(staging, exeName);
  }
  await chmod(executable, 0o755).catch(() => undefined);

  const manifest = Bun.file(join(app.outdir, "m3-bun.manifest.json"));
  if (await manifest.exists()) await Bun.write(join(staging, "m3-bun.manifest.json"), manifest);
  await Bun.write(
    join(staging, "README.txt"),
    readmeText(app.name, app.version, windows ? exeName : `./${exeName}`, app.port),
  );
  if (options.deploy) await generateTargets(["all"], contextFor(app), join(staging, "deploy"));
  const exeHash = sha256(new Uint8Array(await Bun.file(executable).arrayBuffer()));
  await Bun.write(join(staging, "SHA256SUMS"), `${exeHash}  ${exeName}\n`);

  let rootfs: RootfsReport | undefined;
  if (options.rootfs) rootfs = await buildRootfs(executable, join(out, "rootfs"));

  const archive = join(out, `${stem}.${format}`);
  const archiver = await archiveDir(staging, archive, format);
  const archiveHash = sha256(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  const checksumFile = `${archive}.sha256`;
  await Bun.write(checksumFile, `${archiveHash}  ${basename(archive)}\n`);
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: staging, onlyFiles: true, dot: true })))
    .map(file => file.replaceAll("\\", "/"))
    .toSorted();
  await rm(join(out, ".staging"), { recursive: true, force: true });
  return {
    archive,
    bytes: Bun.file(archive).size,
    sha256: archiveHash,
    checksumFile,
    archiver,
    files,
    ...(compile ? { compile } : {}),
    ...(rootfs ? { rootfs } : {}),
  };
}
