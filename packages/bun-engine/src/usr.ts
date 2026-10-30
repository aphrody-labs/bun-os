// The Bun OS root that bep manages, laid out like an Arch/MSYS2 installation and kept out of Git:
//   usr/bin/<id>              launchers
//   usr/lib/<id>/             unpacked upstream release (exe, dll, so)
//   usr/src/<id>              junction to the pinned source in vendor/<id>
//   usr/share/bun-engine/     firmware and ROM store
//   usr/share/licenses/<id>/  upstream notices
//   usr/var/lib/bep/local.db  installed-package database (bun:sqlite)
//   usr/var/cache/bep/        downloaded archives
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const sevenZip = ["7z", ...(Bun.env.ProgramFiles ? [join(Bun.env.ProgramFiles, "7-Zip", "7z.exe")] : [])];

/** The 7-Zip executable bep unpacks 7z/rar/xz archives with, when one is installed. */
export function sevenZipTool(): string | undefined {
  return sevenZip.find(tool => Bun.which(tool) || existsSync(tool));
}

export function usrRoot(): string {
  return resolve(Bun.env.BEP_ROOT ?? join(repoRoot, "usr"));
}

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export interface ReleasePackage {
  console: string;
  repo: string;
  source?: string;
  asset?: Record<string, string>;
  url?: Record<string, string>;
  exe: string;
  selfExtracting?: boolean;
}

export interface InstalledRelease {
  id: string;
  version: string;
  url: string;
  asset: string;
  sha256: string;
  exe: string;
  files: number;
  installedAt: string;
}

export async function releaseCatalog(): Promise<Record<string, ReleasePackage>> {
  const file = join(import.meta.dir, "..", "plugins", "consoles", "releases.json");
  return ((await Bun.file(file).json()) as { packages: Record<string, ReleasePackage> }).packages;
}

let token: string | undefined | null = null;
function githubToken(): string | undefined {
  if (token !== null) return token;
  token = Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN;
  if (!token && Bun.which("gh")) {
    const out = Bun.spawnSync(["gh", "auth", "token"]);
    token = out.success ? out.stdout.toString().trim() || undefined : undefined;
  }
  return token;
}

async function github<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "bep" };
  const auth = githubToken();
  if (auth) headers.authorization = `Bearer ${auth}`;
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);
  return (await response.json()) as T;
}

/** The release asset to install: the pinned tag when given, otherwise the latest release. */
export async function resolveRelease(
  id: string,
  tag?: string,
): Promise<{ version: string; asset: string; url: string }> {
  const pkg = (await releaseCatalog())[id];
  if (!pkg) throw new Error(`no release package ${id}; see bep search`);
  const platform = platformKey();
  const release = await github<{ tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }>(
    `repos/${pkg.repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : "latest"}`,
  );
  const template = pkg.url?.[platform];
  if (template) {
    const url = template.replaceAll("{version}", release.tag_name.replace(/^v/, ""));
    return { version: release.tag_name, asset: basename(new URL(url).pathname), url };
  }
  const pattern = pkg.asset?.[platform];
  if (!pattern) throw new Error(`${id} has no ${platform} release`);
  const match = release.assets.find(asset => new RegExp(pattern, "i").test(asset.name));
  if (!match) throw new Error(`${id} ${release.tag_name}: no asset matches ${pattern}`);
  return { version: release.tag_name, asset: match.name, url: match.browser_download_url };
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

function run(cmd: string[]): boolean {
  return Bun.spawnSync(cmd, { stdout: "ignore", stderr: "pipe" }).success;
}

async function unpack(archive: string, into: string, pkg: ReleasePackage): Promise<void> {
  await mkdir(into, { recursive: true });
  const name = basename(archive).toLowerCase();
  const sevenZ = sevenZipTool();
  if (pkg.selfExtracting) {
    if (!run([archive, `-o${into}`, "-y"]) && !(sevenZ && run([sevenZ, "x", "-y", `-o${into}`, archive])))
      throw new Error(`could not unpack ${name}`);
  } else if (/\.(zip|7z|tar\.gz|tgz|tar\.xz|tar\.zst)$/.test(name)) {
    if (
      !(sevenZ && /\.(zip|7z)$/.test(name) && run([sevenZ, "x", "-y", `-o${into}`, archive])) &&
      !run(["tar", "-xf", archive, "-C", into])
    )
      throw new Error(`could not unpack ${name}`);
  } else {
    // A single executable or AppImage.
    await cp(archive, join(into, basename(archive)));
    if (process.platform !== "win32") run(["chmod", "+x", join(into, basename(archive))]);
  }
}

/** Windows Installer packages are unpacked with an administrative install: files only, no registration. */
async function unpackInstallers(dir: string): Promise<void> {
  if (process.platform !== "win32") return;
  for await (const path of new Bun.Glob("**/*.msi").scan({ cwd: dir, onlyFiles: true, absolute: true })) {
    if (!run(["msiexec", "/a", path, "/qn", `TARGETDIR=${join(dir, basename(path, ".msi"))}`]))
      throw new Error(`could not unpack ${basename(path)}`);
  }
}

async function findExecutable(dir: string, exe: string, asset: string): Promise<string> {
  const wanted = new Set([exe.toLowerCase(), `${exe}.exe`.toLowerCase()]);
  const candidates: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true })) {
    const file = basename(path).toLowerCase();
    if (wanted.has(file)) return join(dir, path);
    if (/\.(exe|appimage)$/.test(file) || file === basename(asset).toLowerCase()) candidates.push(path);
  }
  const fallback = candidates.sort((a, b) => a.length - b.length)[0];
  if (!fallback) throw new Error(`no ${exe} executable in ${dir}`);
  return join(dir, fallback);
}

async function writeLauncher(id: string, exe: string): Promise<void> {
  const bin = join(usrRoot(), "bin");
  await mkdir(bin, { recursive: true });
  if (process.platform === "win32") {
    await Bun.write(join(bin, `${id}.cmd`), `@echo off\r\n"%~dp0${relative(bin, exe)}" %*\r\n`);
  } else {
    await Bun.write(join(bin, id), `#!/bin/sh\nexec "$(dirname "$0")/${relative(bin, exe)}" "$@"\n`);
    run(["chmod", "+x", join(bin, id)]);
  }
}

async function linkSource(id: string, source: string | undefined): Promise<void> {
  if (!source) return;
  const target = join(repoRoot, source);
  const link = join(usrRoot(), "src", id);
  await mkdir(join(usrRoot(), "src"), { recursive: true });
  await rm(link, { recursive: false, force: true }).catch(() => {});
  await symlink(target, link, "junction");
}

async function copyLicenses(id: string, dir: string): Promise<void> {
  const into = join(usrRoot(), "share", "licenses", id);
  for await (const path of new Bun.Glob("**/{LICENSE,LICENSE.*,COPYING,COPYING.*,license.txt}").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    await mkdir(into, { recursive: true });
    await cp(join(dir, path), join(into, path.replaceAll(/[\\/]/g, "_")));
  }
}

let database: Database | undefined;
function db(): Database {
  if (database) return database;
  const dir = join(usrRoot(), "var", "lib", "bep");
  mkdirSync(dir, { recursive: true });
  database = new Database(join(dir, "local.db"), { create: true, strict: true });
  database.run(
    "CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, version TEXT NOT NULL, url TEXT NOT NULL, asset TEXT NOT NULL, sha256 TEXT NOT NULL, exe TEXT NOT NULL, files INTEGER NOT NULL, installedAt TEXT NOT NULL)",
  );
  return database;
}

export async function installedRelease(id: string): Promise<InstalledRelease | undefined> {
  return db().query<InstalledRelease, [string]>("SELECT * FROM packages WHERE id = ?").get(id) ?? undefined;
}

export async function listInstalled(): Promise<InstalledRelease[]> {
  return db().query<InstalledRelease, []>("SELECT * FROM packages ORDER BY id").all();
}

/**
 * Installs one upstream release into usr/. `expected` pins version and digest (bep.lock); a digest
 * mismatch aborts before anything is unpacked.
 */
export async function installRelease(
  id: string,
  expected?: { version: string; sha256: string },
): Promise<InstalledRelease> {
  const pkg = (await releaseCatalog())[id];
  if (!pkg) throw new Error(`no release package ${id}`);
  const current = await installedRelease(id);
  if (current && expected && current.version === expected.version && current.sha256 === expected.sha256) return current;
  const release = await resolveRelease(id, expected?.version);
  const cache = join(usrRoot(), "var", "cache", "bep");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, release.asset);
  if (!existsSync(archive)) {
    const response = await fetch(release.url, { headers: { "user-agent": "bep" } });
    if (!response.ok) throw new Error(`${id}: download ${release.url} failed with ${response.status}`);
    await Bun.write(archive, response);
  }
  const digest = await sha256(archive);
  if (expected && expected.sha256 !== digest) {
    await rm(archive, { force: true });
    throw new Error(`${id} ${release.version}: sha256 ${digest} does not match bep.lock ${expected.sha256}`);
  }
  const lib = join(usrRoot(), "lib", id);
  await rm(lib, { recursive: true, force: true });
  await unpack(archive, lib, pkg);
  await unpackInstallers(lib);
  const exe = await findExecutable(lib, pkg.exe, release.asset);
  await writeLauncher(id, exe);
  await linkSource(id, pkg.source);
  await copyLicenses(id, lib);
  let files = 0;
  for await (const _ of new Bun.Glob("**/*").scan({ cwd: lib, onlyFiles: true })) files++;
  const record: InstalledRelease = {
    id,
    version: release.version,
    url: release.url,
    asset: release.asset,
    sha256: digest,
    exe: relative(usrRoot(), exe),
    files,
    installedAt: new Date().toISOString(),
  };
  db()
    .query("INSERT OR REPLACE INTO packages VALUES ($id, $version, $url, $asset, $sha256, $exe, $files, $installedAt)")
    .run({ ...record });
  return record;
}

export async function uninstallRelease(id: string): Promise<boolean> {
  const record = await installedRelease(id);
  if (!record) return false;
  const root = usrRoot();
  db().query("DELETE FROM packages WHERE id = ?").run(id);
  for (const path of [join(root, "lib", id), join(root, "share", "licenses", id)])
    await rm(path, { recursive: true, force: true });
  for (const launcher of [join(root, "bin", id), join(root, "bin", `${id}.cmd`)]) await rm(launcher, { force: true });
  await rm(join(root, "src", id), { force: true }).catch(() => {});
  return true;
}
