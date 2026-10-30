import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exeSuffix, fetchPinned, hostArch, toolsDir } from "./_shared.ts";
import type { Platform } from "./types.ts";

export interface GithubAsset {
  tag: string;
  name: string;
  url: string;
  sha256: string;
}

interface ReleaseJson {
  tag_name: string;
  assets: { name: string; browser_download_url: string; digest?: string | null }[];
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "buncc" };
  const token = Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** The release of `owner/repo`: the `latest` one, or the given tag. */
export async function githubRelease(repo: string, tag?: string, fetcher: typeof fetch = fetch): Promise<ReleaseJson> {
  const url = `https://api.github.com/repos/${repo}/releases/${tag ? `tags/${tag}` : "latest"}`;
  const response = await fetcher(url, { headers: headers() });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return (await response.json()) as ReleaseJson;
}

/**
 * Pick one asset of a release and its SHA-256. GitHub publishes each asset digest (`sha256:<hex>`) in the release API;
 * a sibling `<name>.sha256` / `SHA256SUMS` style file is not required.
 */
export function pickAsset(release: ReleaseJson, match: string | RegExp): GithubAsset {
  const asset = release.assets.find(a => (typeof match === "string" ? a.name === match : match.test(a.name)));
  if (!asset) throw new Error(`release ${release.tag_name} has no asset matching ${match}`);
  const digest = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : undefined;
  if (!digest) throw new Error(`asset ${asset.name} of ${release.tag_name} has no published sha256 digest`);
  return { tag: release.tag_name, name: asset.name, url: asset.browser_download_url, sha256: digest };
}

export function targetKey(
  platform: Platform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
  arch = hostArch(),
) {
  return { platform, arch, key: `${platform}-${arch}` };
}

export interface GithubToolSpec {
  id: string;
  repo: string;
  /** Asset file name (exact or RegExp) for a release tag, platform and arch; undefined when unsupported. */
  asset(tag: string, platform: Platform, arch: "x64" | "arm64" | "x86"): string | RegExp | undefined;
  /** Strip the leading `v` etc.: how the tag maps to the version printed by the tool. */
  version?(tag: string): string;
  /** Path of the executable inside the extracted archive, searched recursively by file name. */
  binary: string;
}

export function versionOfTag(tag: string): string {
  return tag.replace(/^[A-Za-z-]*?v?(?=\d)/, "");
}

/** Directory holding an installed copy: <cache>/tools/<id>/<version>. */
export function installedDir(id: string, version: string): string {
  return toolsDir(id, version);
}

function findFile(dir: string, name: string, depth = 4): string | undefined {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) if (e.isFile() && e.name === name) return join(dir, e.name);
  if (depth === 0) return undefined;
  for (const e of entries)
    if (e.isDirectory()) {
      const found = findFile(join(dir, e.name), name, depth - 1);
      if (found) return found;
    }
  return undefined;
}

/** Newest copy of a tool this module installed, if any. */
export function findInstalled(
  spec: Pick<GithubToolSpec, "id" | "binary">,
): { dir: string; version: string; bin: string } | undefined {
  const base = toolsDir(spec.id);
  let versions: string[] = [];
  try {
    versions = readdirSync(base).filter(v => !v.includes(".partial-"));
  } catch {
    return undefined;
  }
  const sorted = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const version of sorted.reverse()) {
    const dir = join(base, version);
    const bin = findFile(dir, spec.binary + exeSuffix);
    if (bin) return { dir, version, bin };
  }
  return undefined;
}

/** Download, verify (published SHA-256) and extract a tool release; reuses an existing copy of the same version. */
export async function installGithubTool(
  spec: GithubToolSpec,
  options: {
    tag?: string;
    platform?: Platform;
    arch?: "x64" | "arm64" | "x86";
    fetcher?: typeof fetch;
    dryRun?: boolean;
  } = {},
): Promise<{
  version: string;
  tag: string;
  dir: string;
  bin: string | undefined;
  asset: GithubAsset;
  status: "installed" | "already-installed" | "dry-run";
}> {
  const { platform, arch } = targetKey(options.platform, options.arch);
  const release = await githubRelease(spec.repo, options.tag, options.fetcher);
  const name = spec.asset(release.tag_name, platform, arch);
  if (!name) throw new Error(`${spec.id}: no ${platform}-${arch} build`);
  const asset = pickAsset(release, name);
  const version = (spec.version ?? versionOfTag)(release.tag_name);
  const dir = installedDir(spec.id, version);
  if (existsSync(dir) && findFile(dir, spec.binary + exeSuffix))
    return {
      version,
      tag: release.tag_name,
      dir,
      bin: findFile(dir, spec.binary + exeSuffix),
      asset,
      status: "already-installed",
    };
  if (options.dryRun) return { version, tag: release.tag_name, dir, bin: undefined, asset, status: "dry-run" };
  await fetchPinned({ url: asset.url, hash: asset.sha256, dest: dir, fetcher: options.fetcher });
  return {
    version,
    tag: release.tag_name,
    dir,
    bin: findFile(dir, spec.binary + exeSuffix),
    asset,
    status: "installed",
  };
}
