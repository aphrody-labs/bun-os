#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Publish creator-kit to https://creator.aphrody.com (static site served by nginx, no application origin).
 *
 *   plan                 show what would be built and uploaded
 *   stage                build and stage the release locally, upload nothing (prints the folder)
 *   release              build the Windows exe, stage the packs, upload, checksum on the host, flip `current`
 *   verify               download latest.json, both packs and check SHA-256
 *   host-plan | host-apply [--apply]
 *                        create the release root, install the nginx vhost in the vps host nginx conf.d
 *
 *   --host <ssh-host|local>  where the release lives (default vps); `local` on the vps itself, where the
 *                            Windows exe is cross-compiled and branded under Wine
 *   --compile-executable-path <bun-windows-x64.exe>
 *                            Windows runtime matching the running Bun, when --target cannot download one
 *
 * Runbook: docs/aphrody/operations/infra/CREATOR.md. Remote commands go through OpenSSH in batch mode.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export const SITE = {
  baseUrl: "https://creator.aphrody.com",
  host: "vps",
  root: "/home/ubuntu/apps/creator",
  keepReleases: 5,
  vhost: "infra/config/host/nginx/aphrody/creator.aphrody.com.conf",
  /** The vps host nginx loads every vhost from conf.d; TLS uses the aphrody.com certificate (SAN creator). */
  vhostTarget: "/etc/nginx/conf.d/creator.aphrody.com.conf",
};

const repo = resolve(import.meta.dir, "../../../");
const appDir = join(repo, "packages/product");
/** Release host: an ssh alias, or `local` when this process runs on it. */
const HOST = (() => {
  const i = Bun.argv.indexOf("--host");
  const host = i >= 0 ? Bun.argv[i + 1] : SITE.host;
  if (!host || !/^[A-Za-z0-9_.-]+$/.test(host)) throw new Error(`refused host: ${host}`);
  return host;
})();
/**
 * A Windows x64 Bun of the same build as the compiling Bun (a release pair of the former Bun fork) when the target
 * runtime cannot be downloaded for this version, as for canary builds of the fork.
 */
const WINDOWS_RUNTIME = (() => {
  const i = Bun.argv.indexOf("--compile-executable-path");
  return i >= 0 ? resolve(Bun.argv[i + 1] ?? "") : undefined;
})();
import { build as buildPage, SEED } from "@aphrody/product/creator/site";
import { brandExe } from "./windows-exe.ts";
const TARGET = {
  platform: "windows-x64",
  bunTarget: "bun-windows-x64-baseline",
  exe: "creator-kit.exe",
};

/** Files of the pack, relative to the app folder: anything not listed here never ships. */
const PACK_PATHS = [
  "README.md",
  "docs-challonge.md",
  "docs-video-translate.md",
  "web/image-compressor",
  "windows",
  "extensions/yt-subs-sorter/manifest.json",
  "extensions/yt-subs-sorter/README.md",
  "extensions/yt-subs-sorter/icons",
  "extensions/yt-subs-sorter/popup",
  "extensions/yt-subs-sorter/src",
  "patches/pngtuber-plus-hotkey-combos/README.md",
  "patches/pngtuber-plus-hotkey-combos/hotkey-combos.patch",
];

const DENIED_NAME = /(^|[\\/])(\.env[^\\/]*|.*\.(pem|key|p12|pfx|sqlite3?|db|gguf|safetensors)|cookies?\.txt)$/i;
const TOKEN_SHAPES = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk-[A-Za-z0-9_-]{32,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
];

export interface PackFile {
  id: string;
  kind: "pack" | "update";
  format: "zip" | "tar.gz";
  platform: string;
  file: string;
  size: number;
  sha256: string;
}

export function buildLatest(version: string, files: PackFile[], now = new Date()) {
  return {
    schemaVersion: 1,
    name: "creator-kit",
    version,
    releasedAt: now.toISOString(),
    artifacts: files.map(f => ({
      ...f,
      url: `${SITE.baseUrl}/files/${f.file}`,
    })),
    notes: ["pack = folder to unzip by hand; update = what `creator-kit self-update` installs (same content, flat)"],
  };
}

export async function sha256File(path: string): Promise<string> {
  const hasher = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function run(argv: string[], cwd = repo, env: Record<string, string> = {}, timeoutSecs?: number) {
  const proc = Bun.spawn(argv, {
    windowsHide: true,
    cwd,
    env: { ...process.env, ...env },
    timeout: timeoutSecs ? timeoutSecs * 1000 : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.slice(0, 4).join(" ")} failed (${code}):\n${stderr || stdout}`);
  return stdout;
}

const SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

async function remote(command: string, timeoutSecs = 120): Promise<string> {
  const argv = HOST === "local" ? ["sh", "-c", command] : [...SSH, HOST, command];
  return run(argv, repo, {}, timeoutSecs);
}

async function put(local: string, dest: string): Promise<void> {
  if (HOST === "local") await run(["install", "-m", "0644", local, dest]);
  else await run(["scp", "-q", "-o", "BatchMode=yes", local.replaceAll("\\", "/"), `${HOST}:${dest}`]);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Refuse a pack holding a denied file name or a token-shaped string. */
export async function scanPack(dir: string): Promise<void> {
  for await (const file of walk(dir)) {
    if (DENIED_NAME.test(file)) throw new Error(`denied file in pack: ${relative(dir, file)}`);
    if (file.endsWith(".exe")) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    for (const shape of TOKEN_SHAPES) {
      if (shape.test(text)) throw new Error(`token-shaped string in ${relative(dir, file)}`);
    }
  }
}

/** Icon and version resources of the Windows exe (shared rcedit-under-Wine helper). */
async function brand(exe: string, ver: string): Promise<void> {
  await brandExe(exe, {
    icon: join(appDir, "assets/creator/creator-kit.ico"),
    version: `${ver}.0`,
    strings: {
      ProductName: "Creator Kit",
      FileDescription: "Creator Kit",
      CompanyName: "MAKIT",
      LegalCopyright: "Apache-2.0",
      OriginalFilename: TARGET.exe,
      InternalName: "creator-kit",
    },
  });
}

async function version(): Promise<string> {
  return (
    JSON.parse(await readFile(join(appDir, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

async function stage(): Promise<{
  dir: string;
  version: string;
  commit: string;
  files: PackFile[];
  releaseId: string;
}> {
  const ver = await version();
  const commit = (await run(["git", "rev-parse", "--short=12", "HEAD"])).trim();
  // Staging stays in the checkout's build tree (git-ignored), never in a shared /tmp.
  await mkdir(join(repo, "build/creator"), { recursive: true });
  const dir = await mkdtemp(join(repo, "build/creator/release-"));
  const pack = join(dir, "pack");
  await mkdir(pack, { recursive: true });
  await run(
    [
      process.execPath,
      "build",
      "--compile",
      `--target=${TARGET.bunTarget}`,
      ...(WINDOWS_RUNTIME ? ["--compile-executable-path", WINDOWS_RUNTIME] : []),
      "src/cli.ts",
      "--outfile",
      join(pack, TARGET.exe),
    ],
    appDir,
  );
  await brand(join(pack, TARGET.exe), ver);
  for (const path of PACK_PATHS) {
    await mkdir(join(pack, path, ".."), { recursive: true });
    await cp(join(appDir, "resources/creator", path), join(pack, path), {
      recursive: true,
    });
  }
  // Windows M3 theme (light and dark) from the logo source colour; installers are dry-run until -Apply and revert with -Uninstall.
  const themeOut = join(dir, "theme");
  await run([
    process.execPath,
    "packages/m3-os-themes/src/cli.ts",
    "generate",
    "--target",
    "windows",
    "--seed",
    SEED,
    "--variant",
    "fidelity",
    "--mode",
    "auto",
    "--name",
    "MAKIT",
    "--out",
    themeOut,
  ]);
  await cp(join(themeOut, "windows"), join(pack, "windows/theme"), {
    recursive: true,
  });
  await scanPack(pack);
  const out = join(dir, "out");
  await mkdir(join(out, "files"), { recursive: true });
  const base = `creator-kit-${ver}-${TARGET.platform}`;
  // human pack: one wrapper folder, double-click friendly
  const wrap = join(dir, "wrap");
  await mkdir(wrap, { recursive: true });
  await cp(pack, join(wrap, "creator-kit"), { recursive: true });
  await run(["zip", "-q", "-r", "-X", join(out, "files", `${base}.zip`), "creator-kit"], wrap);
  // update pack: flat top-level entries, installed next to the running exe
  const entries = (await readdir(pack)).toSorted();
  await run(["tar", "-czf", join(out, "files", `${base}.update.tar.gz`), "-C", pack, ...entries]);
  const files: PackFile[] = [];
  for (const [id, kind, format, name] of [
    [`pack-${TARGET.platform}`, "pack", "zip", `${base}.zip`],
    [`update-${TARGET.platform}`, "update", "tar.gz", `${base}.update.tar.gz`],
  ] as const) {
    const path = join(out, "files", name);
    files.push({
      id,
      kind,
      format,
      platform: TARGET.platform,
      file: name,
      size: (await stat(path)).size,
      sha256: await sha256File(path),
    });
  }
  await writeFile(join(out, "latest.json"), `${JSON.stringify(buildLatest(ver, files), null, 2)}\n`);
  await writeFile(join(out, "SHA256SUMS"), `${files.map(f => `${f.sha256}  files/${f.file}`).join("\n")}\n`);
  await cp(await buildPage(), out, { recursive: true });
  const releaseId = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${ver}-${commit}`;
  return { dir: out, version: ver, commit, files, releaseId };
}

async function plan(): Promise<void> {
  console.log(`creator-kit ${await version()} -> ${SITE.baseUrl}`);
  console.log(`- bun build --compile --target=${TARGET.bunTarget} (${TARGET.exe}), pack: ${PACK_PATHS.length} paths`);
  console.log("- files: <pack>.zip (human), <pack>.update.tar.gz (self-update), latest.json, SHA256SUMS, index.html");
  console.log(
    `- host ${HOST}: ${SITE.root}/releases/<id>, atomic symlink ${SITE.root}/current, keep ${SITE.keepReleases}`,
  );
}

async function release(): Promise<void> {
  const staged = await stage();
  try {
    const dest = `${SITE.root}/releases/${staged.releaseId}`;
    await remote(`install -d ${dest}/files ${dest}/download`);
    for (const file of staged.files) await put(join(staged.dir, "files", file.file), `${dest}/files/${file.file}`);
    const site: string[] = [];
    for await (const file of walk(staged.dir)) {
      const rel = relative(staged.dir, file);
      if (!rel.startsWith("files/")) site.push(rel);
    }
    await remote(
      `install -d ${[...new Set(site.map(rel => `${dest}/${rel.split("/").slice(0, -1).join("/")}`))].join(" ")}`,
    );
    for (const rel of site) await put(join(staged.dir, rel), `${dest}/${rel}`);
    const pack = staged.files.find(f => f.kind === "pack") as PackFile;
    await remote(
      [
        "set -e",
        `cd ${dest}`,
        "sha256sum -c SHA256SUMS",
        `ln -f files/${pack.file} download/creator-kit-${TARGET.platform}.zip`,
        `chmod -R a+rX ${dest}`,
        `ln -sfn ${dest} ${SITE.root}/current.tmp`,
        `mv -Tf ${SITE.root}/current.tmp ${SITE.root}/current`,
        `ls -1dt ${SITE.root}/releases/* | tail -n +${SITE.keepReleases + 1} | xargs -r rm -rf`,
      ].join("\n"),
      300,
    );
    console.log(`published ${staged.releaseId}`);
    for (const f of staged.files) console.log(`  ${f.file}  ${f.size} B  ${f.sha256}`);
  } finally {
    await rm(join(staged.dir, ".."), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function verify(): Promise<void> {
  const res = await fetch(`${SITE.baseUrl}/latest.json`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`latest.json: HTTP ${res.status}`);
  const latest = (await res.json()) as ReturnType<typeof buildLatest>;
  for (const a of latest.artifacts) {
    const got = await fetch(a.url);
    if (!got.ok) throw new Error(`${a.url}: HTTP ${got.status}`);
    const sha = createHash("sha256")
      .update(new Uint8Array(await got.arrayBuffer()))
      .digest("hex");
    if (sha !== a.sha256) throw new Error(`${a.file}: SHA-256 mismatch`);
    console.log(`ok ${a.file}`);
  }
  for (const path of ["/", "/download/windows"]) {
    const page = await fetch(`${SITE.baseUrl}${path}`, { method: "HEAD" });
    if (!page.ok) throw new Error(`${path}: HTTP ${page.status}`);
    console.log(`ok ${path}`);
  }
  console.log(`creator.aphrody.com serves ${latest.version}`);
}

async function hostCommands(apply: boolean): Promise<void> {
  const steps = [
    `create ${SITE.root}/releases owned by ubuntu on ${HOST}`,
    "DNS creator.aphrody.com: proxied by Cloudflare to the vps (Cloudflare MCP, done separately)",
    "TLS: /etc/letsencrypt/live/aphrody.com, whose SAN covers creator.aphrody.com",
    `${SITE.vhost} -> ${SITE.vhostTarget} (previous file kept as .bak-<date>), nginx -t, reload`,
  ];
  console.log(steps.map(s => `- ${s}`).join("\n"));
  if (!apply) return console.log("plan only: pass --apply to execute");
  await remote(`sudo install -d -o ubuntu -g ubuntu ${SITE.root} ${SITE.root}/releases`);
  const staged = `${SITE.root}/.vhost.new`;
  const target = SITE.vhostTarget;
  await put(join(repo, SITE.vhost), staged);
  await remote(
    [
      "set -e",
      `backup=${target}.bak-$(date +%Y%m%d)`,
      `if [ -f ${target} ]; then sudo cp -p ${target} "$backup"; fi`,
      `sudo install -m 0644 -o root -g root ${staged} ${target}`,
      `rm -f ${staged}`,
      `if ! sudo nginx -t; then if [ -f "$backup" ]; then sudo cp -p "$backup" ${target}; fi; exit 1; fi`,
      "sudo systemctl reload nginx",
    ].join("\n"),
  );
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "plan";
  switch (command) {
    case "plan":
      await plan();
      break;
    case "stage": {
      const staged = await stage();
      console.log(staged.dir);
      for (const f of staged.files) console.log(`${f.file}  ${f.size} B  ${f.sha256}`);
      break;
    }
    case "release":
      await release();
      break;
    case "verify":
      await verify();
      break;
    case "host-plan":
      await hostCommands(false);
      break;
    case "host-apply":
      await hostCommands(Bun.argv.includes("--apply"));
      break;
    default:
      console.error(
        "usage: publish-creator.ts plan|stage|release|verify|host-plan|host-apply [--apply] [--host <ssh-host|local>] [--compile-executable-path <exe>]",
      );
      process.exit(2);
  }
}
