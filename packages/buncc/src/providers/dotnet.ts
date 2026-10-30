/**
 * .NET SDK provider: discovery, global.json resolution, install (winget, dotnet-install or a checksum-verified archive),
 * build/publish and NativeAOT publication. Supports .NET 10 (LTS) and .NET 11 (newest preview/RC) side by side.
 *
 * Release facts come from https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json, the same
 * metadata `dotnet-install` reads. Native AOT prerequisites: https://learn.microsoft.com/dotnet/core/deploying/native-aot/
 * global.json semantics: https://learn.microsoft.com/dotnet/core/tools/global-json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { run } from "../process.ts";
import { detectMsvc } from "./msvc-layout.ts";
import {
  ChecksumError,
  download,
  exeSuffix,
  extractArchive,
  hostArch,
  pathVar,
  pinFromToolchain,
  prependPath,
  toolsDir,
  which,
} from "./_shared.ts";
import type { Context, Detection, InstallPlan, Platform, Provider } from "./types.ts";

export const RELEASES_INDEX = "https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json";

// ---------------------------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------------------------

export interface SdkVersion {
  raw: string;
  major: number;
  minor: number;
  /** Third component: feature band * 100 + patch (10.0.403 -> 403). */
  patch: number;
  band: number;
  prerelease: string[];
}

export function parseSdkVersion(raw: string): SdkVersion | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(raw.trim());
  if (!m) return undefined;
  const patch = Number(m[3]);
  return {
    raw: raw.trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch,
    band: Math.floor(patch / 100),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

/** SemVer precedence: a prerelease sorts before its release; numeric identifiers compare numerically. */
export function compareSdk(a: SdkVersion, b: SdkVersion): number {
  for (const key of ["major", "minor", "patch"] as const) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : undefined;
    const ny = /^\d+$/.test(y) ? Number(y) : undefined;
    if (nx !== undefined && ny !== undefined) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== undefined) return -1;
    else if (ny !== undefined) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export type RollForward =
  "patch" | "feature" | "minor" | "major" | "latestPatch" | "latestFeature" | "latestMinor" | "latestMajor" | "disable";

export interface GlobalJson {
  version?: string;
  rollForward?: RollForward;
  allowPrerelease?: boolean;
  paths?: string[];
  errorMessage?: string;
}

/** Read the `sdk` section of a global.json (comments and trailing commas are tolerated, like the .NET host does). */
export function parseGlobalJson(text: string): GlobalJson {
  const stripped = text
    .replace(/^﻿/, "")
    .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_m, str) => str ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  const json = JSON.parse(stripped) as { sdk?: GlobalJson };
  return json.sdk ?? {};
}

/** Walk up from `cwd` to the first global.json, as `dotnet` does. */
export function findGlobalJson(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, "global.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Choose the SDK `dotnet` would run for a global.json, from the installed SDK versions. Returns undefined when none
 * satisfies it. Default policy is `latestPatch` with a version, `latestMajor` without.
 */
export function selectSdk(installed: string[], request: GlobalJson = {}): string | undefined {
  const parsed = installed.map(parseSdkVersion).filter((v): v is SdkVersion => !!v);
  const allowPre = request.allowPrerelease ?? true;
  let pool = parsed.filter(v => allowPre || !v.prerelease.length);
  const req = request.version ? parseSdkVersion(request.version) : undefined;
  const policy: RollForward = request.rollForward ?? (req ? "latestPatch" : "latestMajor");
  if (!req) return pool.sort(compareSdk).at(-1)?.raw;
  if (request.version && !req) return undefined;

  const sameMinor = (v: SdkVersion) => v.major === req.major && v.minor === req.minor;
  const sameBand = (v: SdkVersion) => sameMinor(v) && v.band === req.band;
  const atLeast = (v: SdkVersion) => compareSdk(v, req) >= 0;
  const exact = pool.find(v => compareSdk(v, req) === 0);

  const latest = (scope: (v: SdkVersion) => boolean) =>
    pool
      .filter(v => scope(v) && atLeast(v))
      .sort(compareSdk)
      .at(-1)?.raw;
  const nearest = (scope: (v: SdkVersion) => boolean) => {
    const candidates = pool.filter(v => scope(v) && atLeast(v));
    if (!candidates.length) return undefined;
    const groupKey = (v: SdkVersion) => v.major * 1e8 + v.minor * 1e5 + v.band;
    const lowest = Math.min(...candidates.map(groupKey));
    return candidates
      .filter(v => groupKey(v) === lowest)
      .sort(compareSdk)
      .at(-1)?.raw;
  };

  switch (policy) {
    case "disable":
      return exact?.raw;
    case "latestPatch":
      return latest(sameBand);
    case "latestFeature":
      return latest(sameMinor);
    case "latestMinor":
      return latest(v => v.major === req.major);
    case "latestMajor":
      return latest(() => true);
    case "patch":
      return exact?.raw ?? nearest(sameBand);
    case "feature":
      return exact?.raw ?? nearest(sameMinor);
    case "minor":
      return exact?.raw ?? nearest(v => v.major === req.major);
    case "major":
      return exact?.raw ?? nearest(() => true);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Installs on disk
// ---------------------------------------------------------------------------------------------------------------

export interface DotnetInstall {
  root: string;
  sdks: string[];
  runtimes: string[];
}

/** Candidate install roots in the order the host looks at them. */
export function candidateRoots(env: Record<string, string | undefined>, platform: Platform): string[] {
  const roots: (string | undefined)[] = [env.DOTNET_ROOT, env.DOTNET_INSTALL_DIR];
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  if (platform === "win32") {
    roots.push(
      env.ProgramFiles && join(env.ProgramFiles, "dotnet"),
      env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "dotnet"),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Microsoft", "dotnet"),
    );
  } else if (platform === "darwin") {
    roots.push("/usr/local/share/dotnet", "/opt/homebrew/opt/dotnet/libexec");
  } else {
    roots.push("/usr/share/dotnet", "/usr/lib/dotnet", "/usr/local/share/dotnet");
  }
  roots.push(join(home, ".dotnet"));
  const onPath = Bun.which("dotnet");
  if (onPath) roots.push(dirname(onPath));
  return [...new Set(roots.filter((r): r is string => !!r).map(r => resolve(r)))];
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d/.test(e.name))
      .map(e => e.name);
  } catch {
    return [];
  }
}

/** Read the on-disk layout (`sdk/<v>`, `shared/Microsoft.NETCore.App/<v>`) of every existing root. */
export function listInstalls(roots: string[]): DotnetInstall[] {
  const out: DotnetInstall[] = [];
  for (const root of roots) {
    const sdks = listDirs(join(root, "sdk"));
    const runtimes = listDirs(join(root, "shared", "Microsoft.NETCore.App"));
    if (sdks.length || runtimes.length) out.push({ root, sdks, runtimes });
  }
  return out;
}

/** The install and SDK version a command run in `cwd` would use. */
export function resolveInstall(
  installs: DotnetInstall[],
  cwd: string,
): { root: string; sdk: string; globalJson?: string } | undefined {
  const file = findGlobalJson(cwd);
  const request = file ? parseGlobalJson(readFileSync(file, "utf8")) : {};
  const extra = (request.paths ?? []).filter(p => p !== "$host$").map(p => resolve(dirname(file ?? cwd), p));
  const pool = [...listInstalls(extra), ...installs];
  const all = pool.flatMap(i => i.sdks);
  const sdk = selectSdk(all, request);
  if (!sdk) return undefined;
  const install = pool.find(i => i.sdks.includes(sdk))!;
  return { root: install.root, sdk, globalJson: file };
}

// ---------------------------------------------------------------------------------------------------------------
// Channels, profiles and release metadata
// ---------------------------------------------------------------------------------------------------------------

export interface DotnetChannel {
  /** Major.minor channel. */
  channel: string;
  tfm: string;
  /** winget package id of the SDK for this channel. */
  wingetId: string;
  /** dotnet-install quality: ga for released channels, preview while only previews/RCs exist. */
  quality: "ga" | "preview";
}

/** Channels buncc supports in parallel. 11.0 stays on the preview id until its GA SDK replaces it. */
export const CHANNELS: Record<"10.0" | "11.0", DotnetChannel> = {
  "10.0": { channel: "10.0", tfm: "net10.0", wingetId: "Microsoft.DotNet.SDK.10", quality: "ga" },
  "11.0": { channel: "11.0", tfm: "net11.0", wingetId: "Microsoft.DotNet.SDK.Preview", quality: "preview" },
};

/** Named profiles buncc exposes; each resolves to one channel. */
export const AOT_PROFILES = {
  "aot-dotnet10": CHANNELS["10.0"],
  "aot-dotnet11": CHANNELS["11.0"],
} as const;
export type AotProfile = keyof typeof AOT_PROFILES;

interface IndexEntry {
  "channel-version": string;
  "latest-sdk": string;
  "latest-release": string;
  "release-type": string;
  "support-phase": string;
  "releases.json": string;
}
interface SdkFile {
  name: string;
  rid?: string;
  url: string;
  hash: string;
}
interface SdkEntry {
  version: string;
  files: SdkFile[];
}

export async function fetchIndex(fetcher: typeof fetch = fetch, url = Bun.env.BUNCC_DOTNET_FEED ?? RELEASES_INDEX) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return ((await response.json()) as { "releases-index": IndexEntry[] })["releases-index"];
}

/** Map `LTS`, `STS`, `latest`, `A.B` to an index entry. */
export function channelEntry(index: IndexEntry[], channel: string): IndexEntry | undefined {
  const usable = index.filter(e => e["support-phase"] !== "eol");
  const byVersion = (a: IndexEntry, b: IndexEntry) =>
    parseFloat(b["channel-version"]) - parseFloat(a["channel-version"]);
  const upper = channel.toUpperCase();
  if (upper === "LTS")
    return usable
      .filter(
        e =>
          e["release-type"] === "lts" &&
          !["preview", "rc"].includes(e["support-phase"]) &&
          !e["latest-sdk"].includes("-"),
      )
      .sort(byVersion)[0];
  if (upper === "STS")
    return usable.filter(e => e["release-type"] === "sts" && !e["latest-sdk"].includes("-")).sort(byVersion)[0];
  if (channel.toLowerCase() === "latest") return [...usable].sort(byVersion)[0];
  return index.find(e => e["channel-version"] === channel.split(".").slice(0, 2).join("."));
}

export function runtimeIdentifier(platform: Platform = currentPlatform(), arch = hostArch(), musl = isMusl()): string {
  if (platform === "win32") return `win-${arch}`;
  if (platform === "darwin") return `osx-${arch === "x86" ? "x64" : arch}`;
  return `linux-${musl ? "musl-" : ""}${arch === "x86" ? "x64" : arch}`;
}

function currentPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

function isMusl(): boolean {
  return (
    process.platform === "linux" &&
    (existsSync("/etc/alpine-release") || readdirOrEmpty("/lib").some(n => n.startsWith("ld-musl")))
  );
}
function readdirOrEmpty(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

export interface SdkArchive {
  version: string;
  rid: string;
  name: string;
  url: string;
  sha512: string;
}

/**
 * Pick the SDK archive for a channel. `version` is an exact SDK; `band` like `1xx` limits to a feature band;
 * the archive is the .zip on Windows and the .tar.gz elsewhere (no installer needed).
 */
export async function resolveArchive(options: {
  channel: string;
  version?: string;
  band?: string;
  rid?: string;
  fetcher?: typeof fetch;
}): Promise<SdkArchive> {
  const fetcher = options.fetcher ?? fetch;
  const index = await fetchIndex(fetcher);
  const channel = options.version ? options.version.split(".").slice(0, 2).join(".") : options.channel;
  const entry = channelEntry(index, channel);
  if (!entry) throw new Error(`.NET channel ${channel} not found in releases-index.json`);
  const response = await fetcher(entry["releases.json"]);
  if (!response.ok) throw new Error(`GET ${entry["releases.json"]}: HTTP ${response.status}`);
  const releases = ((await response.json()) as { releases: { sdk?: SdkEntry; sdks?: SdkEntry[] }[] }).releases;
  const sdks = new Map<string, SdkEntry>();
  for (const r of releases)
    for (const s of [r.sdk, ...(r.sdks ?? [])]) if (s?.version && s.files) sdks.set(s.version, s);
  let versions = [...sdks.keys()];
  if (options.version) versions = versions.filter(v => v === options.version);
  else if (options.band) {
    const prefix = `${entry["channel-version"]}.${options.band.replace(/xx$/, "")}`;
    versions = versions.filter(v => v.startsWith(prefix));
  }
  const best = versions
    .map(parseSdkVersion)
    .filter((v): v is SdkVersion => !!v)
    .sort(compareSdk)
    .at(-1);
  if (!best) throw new Error(`no .NET SDK matches ${options.version ?? options.band ?? channel}`);
  const rid = options.rid ?? runtimeIdentifier();
  const ext = rid.startsWith("win-") ? ".zip" : ".tar.gz";
  const file = sdks.get(best.raw)!.files.find(f => f.rid === rid && f.name === `dotnet-sdk-${rid}${ext}`);
  if (!file) throw new Error(`.NET SDK ${best.raw} has no ${rid}${ext} archive`);
  return { version: best.raw, rid, name: file.name, url: file.url, sha512: file.hash };
}

export function defaultInstallDir(
  platform: Platform = currentPlatform(),
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.DOTNET_INSTALL_DIR) return env.DOTNET_INSTALL_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Microsoft", "dotnet");
  return join(env.HOME ?? homedir(), ".dotnet");
}

export interface InstallResult {
  version: string;
  installDir: string;
  status: "installed" | "already-installed" | "dry-run";
  archive: SdkArchive;
}

/** Install an SDK from the official archive, verifying SHA-512. Nothing is written when the checksum fails. */
export async function installSdk(options: {
  channel: string;
  version?: string;
  band?: string;
  installDir?: string;
  rid?: string;
  dryRun?: boolean;
  fetcher?: typeof fetch;
}): Promise<InstallResult> {
  const archive = await resolveArchive(options);
  const installDir = resolve(options.installDir ?? defaultInstallDir());
  if (existsSync(join(installDir, "sdk", archive.version)))
    return { version: archive.version, installDir, status: "already-installed", archive };
  if (options.dryRun) return { version: archive.version, installDir, status: "dry-run", archive };
  const bytes = await download(archive.url, archive.sha512, "sha512", options.fetcher);
  const staging = toolsDir("dotnet-downloads");
  mkdirSync(staging, { recursive: true });
  const file = join(staging, archive.name);
  await Bun.write(file, bytes);
  try {
    await extractArchive(file, installDir);
  } finally {
    rmSync(file, { force: true });
  }
  if (!existsSync(join(installDir, "sdk", archive.version)))
    throw new Error(`extracted archive has no sdk/${archive.version}`);
  return { version: archive.version, installDir, status: "installed", archive };
}

export { ChecksumError };

// ---------------------------------------------------------------------------------------------------------------
// Install plan (winget on Windows, dotnet-install elsewhere) and global.json
// ---------------------------------------------------------------------------------------------------------------

export function installCommands(
  channel: DotnetChannel,
  platform: Platform,
  installDir = defaultInstallDir(platform),
): string[][] {
  if (platform === "win32") {
    return [
      [
        "winget",
        "install",
        "--id",
        channel.wingetId,
        "--exact",
        "--source",
        "winget",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
    ];
  }
  const script = join(toolsDir(), "dotnet-install.sh");
  return [
    ["curl", "-fsSL", "-o", script, "https://dot.net/v1/dotnet-install.sh"],
    [
      "bash",
      script,
      "--channel",
      channel.channel,
      "--quality",
      channel.quality,
      "--install-dir",
      installDir,
      "--no-path",
    ],
  ];
}

/** Write a global.json that pins the SDK. Refuses to replace an existing file unless `force`. */
export function writeGlobalJson(
  dir: string,
  sdk: { version: string; rollForward?: RollForward; allowPrerelease?: boolean },
  force = false,
): string {
  const file = join(dir, "global.json");
  if (existsSync(file) && !force) throw new Error(`${file} exists`);
  const body = {
    sdk: {
      version: sdk.version,
      rollForward: sdk.rollForward ?? "latestFeature",
      allowPrerelease: sdk.allowPrerelease ?? !!parseSdkVersion(sdk.version)?.prerelease.length,
    },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

// ---------------------------------------------------------------------------------------------------------------
// build / publish / NativeAOT
// ---------------------------------------------------------------------------------------------------------------

export type MsbuildProps = Record<string, string | boolean | number>;

function propArgs(props: MsbuildProps = {}): string[] {
  return Object.entries(props).map(([k, v]) => `-p:${k}=${typeof v === "boolean" ? (v ? "true" : "false") : v}`);
}

export function buildArgs(o: {
  project?: string;
  config?: string;
  rid?: string;
  framework?: string;
  props?: MsbuildProps;
}): string[] {
  const args = ["build"];
  if (o.project) args.push(o.project);
  args.push("-c", o.config ?? "Release", "--nologo");
  if (o.rid) args.push("-r", o.rid);
  if (o.framework) args.push("-f", o.framework);
  return [...args, ...propArgs(o.props)];
}

export function publishArgs(o: {
  project?: string;
  config?: string;
  rid?: string;
  framework?: string;
  output?: string;
  props?: MsbuildProps;
}): string[] {
  const args = ["publish"];
  if (o.project) args.push(o.project);
  args.push("-c", o.config ?? "Release", "--nologo");
  if (o.rid) args.push("-r", o.rid);
  if (o.framework) args.push("-f", o.framework);
  if (o.output) args.push("-o", o.output);
  return [...args, ...propArgs(o.props)];
}

export interface AotOptions {
  project?: string;
  profile?: AotProfile;
  rid?: string;
  config?: string;
  output?: string;
  /** Build a shared library (`NativeLib=Shared`) loadable with `bun:ffi` `dlopen`, or a static one. */
  nativeLib?: "Shared" | "Static";
  size?: boolean;
  invariantGlobalization?: boolean;
  stripSymbols?: boolean;
  props?: MsbuildProps;
}

/** `dotnet publish -r <rid> -p:PublishAot=true` with the options above. */
export function aotPublishArgs(o: AotOptions = {}): string[] {
  const channel = AOT_PROFILES[o.profile ?? "aot-dotnet10"];
  const props: MsbuildProps = { PublishAot: true };
  if (o.nativeLib) props.NativeLib = o.nativeLib;
  if (o.size) props.OptimizationPreference = "Size";
  if (o.invariantGlobalization !== undefined) props.InvariantGlobalization = o.invariantGlobalization;
  if (o.stripSymbols !== undefined) props.StripSymbols = o.stripSymbols;
  return publishArgs({
    project: o.project,
    config: o.config,
    rid: o.rid ?? runtimeIdentifier(),
    framework: channel.tfm,
    output: o.output,
    props: { ...props, ...o.props },
  });
}

/** NuGet package that carries the ILCompiler for a RID (restored by `dotnet publish`). */
export function ilcompilerPackage(rid: string): string {
  return `runtime.${rid}.Microsoft.DotNet.ILCompiler`;
}

export interface Prerequisite {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Native toolchain NativeAOT needs: MSVC linker on Windows, clang + zlib headers on Linux, Command Line Tools on macOS. */
export async function aotPrerequisites(ctx: Context): Promise<Prerequisite[]> {
  if (ctx.platform === "win32") {
    const msvc = await detectMsvc(ctx);
    return [
      {
        name: "MSVC linker (Desktop development with C++)",
        ok: msvc.found,
        detail: msvc.found ? `${msvc.path} ${msvc.version ?? ""}`.trim() : "not found",
        fix: msvc.fixHint,
      },
    ];
  }
  if (ctx.platform === "darwin") {
    const xcode = await run(["xcode-select", "-p"], { output: "capture", timeoutMs: 10_000 });
    return [
      {
        name: "Xcode Command Line Tools",
        ok: xcode.code === 0,
        detail: xcode.stdout.trim() || "not installed",
        fix: "xcode-select --install",
      },
    ];
  }
  const clang = which("clang", ctx);
  const zlib = ["/usr/include/zlib.h", "/usr/local/include/zlib.h"].find(existsSync);
  return [
    {
      name: "clang",
      ok: !!clang,
      detail: clang ?? "not found",
      fix: "sudo apt-get install clang   (Alpine: apk add clang build-base)",
    },
    {
      name: "zlib development headers",
      ok: !!zlib,
      detail: zlib ?? "not found",
      fix: "sudo apt-get install zlib1g-dev   (Alpine: apk add zlib-dev)",
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------------------------------

async function detectChannel(ctx: Context, channel: DotnetChannel): Promise<string | undefined> {
  const installs = listInstalls(candidateRoots(ctx.env, ctx.platform));
  const found = installs.flatMap(i => i.sdks).filter(v => v.startsWith(`${channel.channel}.`));
  return selectSdk(found, {});
}

function rootOfSdk(ctx: Context, version: string): string | undefined {
  return listInstalls(candidateRoots(ctx.env, ctx.platform)).find(i => i.sdks.includes(version))?.root;
}

export const dotnetProvider: Provider = {
  id: "dotnet",
  description:
    ".NET SDK 10 (LTS) and 11 (preview) with global.json resolution, NativeAOT publish and winget/dotnet-install",
  platforms: ["win32", "linux", "darwin"],
  async detect(ctx) {
    const cwdChoice = resolveInstall(listInstalls(candidateRoots(ctx.env, ctx.platform)), ctx.root);
    const notes: string[] = [];
    let any: string | undefined;
    for (const channel of Object.values(CHANNELS)) {
      const v = await detectChannel(ctx, channel);
      notes.push(`${channel.channel}: ${v ?? "missing"}`);
      any ??= v;
    }
    if (cwdChoice) notes.push(`global.json/default selects ${cwdChoice.sdk}`);
    const detection: Detection = {
      found: !!any,
      path: any ? (rootOfSdk(ctx, any) ?? undefined) && join(rootOfSdk(ctx, any)!, `dotnet${exeSuffix}`) : undefined,
      version: cwdChoice?.sdk ?? any,
      notes,
    };
    if (!any)
      detection.fixHint =
        ctx.platform === "win32" ? `winget install --id ${CHANNELS["10.0"].wingetId} -e` : "buncc install dotnet";
    return detection;
  },
  install(ctx) {
    const commands = installCommands(CHANNELS["10.0"], ctx.platform);
    // Run the 11.0 install after 10.0 so both channels are present; they live side by side under one root.
    commands.push(...installCommands(CHANNELS["11.0"], ctx.platform));
    return { commands } satisfies InstallPlan;
  },
  async env(ctx) {
    const choice = resolveInstall(listInstalls(candidateRoots(ctx.env, ctx.platform)), ctx.root);
    const root = choice?.root ?? defaultInstallDir(ctx.platform, ctx.env);
    const out: Record<string, string> = {
      DOTNET_ROOT: root,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_MULTILEVEL_LOOKUP: "0",
      PATH: prependPath(pathVar(ctx), [root]),
    };
    if (choice) out.DOTNET_HOST_PATH = join(root, `dotnet${exeSuffix}`);
    return out;
  },
  async pin(ctx) {
    const pinned = await pinFromToolchain(ctx, "dotnet");
    if (pinned) return pinned;
    const file = findGlobalJson(ctx.root);
    return file ? parseGlobalJson(readFileSync(file, "utf8")).version : undefined;
  },
};

/** Provider for a single profile, so `aot-dotnet10` / `aot-dotnet11` can detect and install exactly one channel. */
export function dotnetProfileProvider(profile: AotProfile): Provider {
  const channel = AOT_PROFILES[profile];
  return {
    id: `dotnet:${channel.channel}`,
    description: `.NET ${channel.channel} SDK for NativeAOT (${profile})`,
    platforms: ["win32", "linux", "darwin"],
    async detect(ctx) {
      const version = await detectChannel(ctx, channel);
      if (!version)
        return {
          found: false,
          fixHint: installCommands(channel, ctx.platform)
            .map(c => c.join(" "))
            .join(" && "),
        };
      const root = rootOfSdk(ctx, version)!;
      const prereq = await aotPrerequisites(ctx);
      const bad = prereq.filter(p => !p.ok);
      return {
        found: true,
        path: join(root, `dotnet${exeSuffix}`),
        version,
        notes: bad.map(p => `NativeAOT prerequisite missing: ${p.name} (${p.fix ?? "install it"})`),
        fixHint: bad[0]?.fix,
      };
    },
    install: ctx => ({ commands: installCommands(channel, ctx.platform) }),
    env: async ctx => {
      const version = await detectChannel(ctx, channel);
      const root = (version && rootOfSdk(ctx, version)) || defaultInstallDir(ctx.platform, ctx.env);
      return {
        DOTNET_ROOT: root,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
        DOTNET_MULTILEVEL_LOOKUP: "0",
        PATH: prependPath(pathVar(ctx), [root]),
      };
    },
    pin: async ctx => (await pinFromToolchain(ctx, `dotnet:${channel.channel}`)) ?? undefined,
  };
}

/** Run `dotnet <args>` with the provider environment. */
export async function runDotnet(ctx: Context, args: string[], cwd = ctx.root) {
  const env = { ...ctx.env, ...(await dotnetProvider.env(ctx)) };
  const root = env.DOTNET_ROOT;
  const exe = root && existsSync(join(root, `dotnet${exeSuffix}`)) ? join(root, `dotnet${exeSuffix}`) : "dotnet";
  return run([exe, ...args], { cwd, env, output: "inherit" });
}
