#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Regenerates pins.json from the official release metadata, or verifies the pins against it.
//   bun factory/dotnet-linux/refresh.ts            rewrite pins.json (latest .NET 10 LTS, latest .NET 11 preview/RC, PowerShell stable + preview)
//   bun factory/dotnet-linux/refresh.ts --check    exit 1 if a pinned hash differs from upstream for the same version (tamper); --strict also fails on a newer release
// Sources (no mirrors):
//   .NET   https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json -> <channel>/releases.json (sha512 per file)
//   pwsh   https://github.com/PowerShell/PowerShell/releases (hashes.sha256 asset, cross-checked with the API asset digest)
//   Arch   https://archlinux.org/packages/search/json/      AUR https://aur.archlinux.org/rpc/v5/info     (observed, informative)
//   Alpine https://dl-cdn.alpinelinux.org/alpine/<branch>/{main,community}/x86_64/APKINDEX.tar.gz        (observed, informative)
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const pinsPath = join(import.meta.dir, "pins.json");
export const DOTNET_RIDS = ["linux-x64", "linux-arm64", "linux-musl-x64", "linux-musl-arm64"] as const;
export const PWSH_RIDS = ["linux-x64", "linux-arm64", "linux-musl-x64"] as const;
const INDEX = "https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json";

interface Asset {
  url: string;
  sha512?: string;
  sha256?: string;
  size?: number;
}

async function json<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}
const gh = {
  headers: {
    accept: "application/vnd.github+json",
    ...(Bun.env.GITHUB_TOKEN ? { authorization: `Bearer ${Bun.env.GITHUB_TOKEN}` } : {}),
  },
};

const ver = (v: string) => v.split(/[.-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
export function cmp(a: string, b: string) {
  const x = ver(a),
    y = ver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return 0;
}

export async function dotnetChannel(channel: string) {
  const idx = await json<{ "releases-index": any[] }>(INDEX);
  const entry = idx["releases-index"].find(e => e["channel-version"] === channel);
  if (!entry) throw new Error(`channel ${channel} not in releases-index.json`);
  const doc = await json<{ releases: any[] }>(entry["releases.json"]);
  // releases[0] is the newest servicing release; take its newest SDK whatever the feature band
  const rel = doc.releases[0];
  const sdks: any[] = [rel.sdk, ...(rel.sdks ?? [])].filter(Boolean);
  const sdk = sdks.sort((a, b) => cmp(a.version, b.version)).at(-1);
  const assets: Record<string, Asset> = {};
  for (const rid of DOTNET_RIDS) {
    const f = sdk.files.find((f: any) => f.rid === rid && f.name === `dotnet-sdk-${rid}.tar.gz`);
    if (!f) throw new Error(`.NET SDK ${sdk.version} has no ${rid} tar.gz`);
    assets[rid] = { url: f.url, sha512: f.hash };
  }
  return {
    channel,
    supportPhase: entry["support-phase"],
    releaseType: entry["release-type"],
    release: rel["release-version"],
    releaseDate: rel["release-date"],
    sdk: sdk.version,
    runtime: rel.runtime?.version,
    aspnetcore: rel["aspnetcore-runtime"]?.version,
    metadata: entry["releases.json"],
    assets,
  };
}

export async function powershellRelease(kind: "stable" | "preview") {
  const list = await json<any[]>("https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30", gh);
  const pool = list.filter(r => !r.draft && r.prerelease === (kind === "preview"));
  const best = pool.sort((a, b) => cmp(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  const hashes = new Map<string, string>();
  const hashAsset = best.assets.find((a: any) => a.name === "hashes.sha256");
  // upstream publishes hashes.sha256 as UTF-16LE with a BOM
  const raw = new Uint8Array(await (await fetch(hashAsset.browser_download_url)).arrayBuffer());
  const text =
    raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder("utf-16le").decode(raw) : new TextDecoder().decode(raw);
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9A-Fa-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m) hashes.set(m[2]!, m[1]!.toLowerCase());
  }
  const version = best.tag_name.slice(1);
  const assets: Record<string, Asset> = {};
  for (const rid of PWSH_RIDS) {
    const name = `powershell-${version}-${rid}.tar.gz`;
    const a = best.assets.find((x: any) => x.name === name);
    if (!a) throw new Error(`${best.tag_name} has no ${name}`);
    const sha = hashes.get(name);
    const apiDigest = String(a.digest ?? "").replace(/^sha256:/, "");
    if (!sha) throw new Error(`${name}: missing from hashes.sha256`);
    if (apiDigest && apiDigest !== sha)
      throw new Error(`${name}: hashes.sha256 (${sha}) != GitHub API digest (${apiDigest})`);
    assets[rid] = { url: a.browser_download_url, sha256: sha, size: a.size };
  }
  return { tag: best.tag_name, version, publishedAt: best.published_at, release: best.html_url, assets };
}

export async function archObserved() {
  const repo: Record<string, string> = {};
  for (const name of ["dotnet-sdk", "dotnet-runtime", "aspnet-runtime"]) {
    const j = await json<{ results: any[] }>(`https://archlinux.org/packages/search/json/?name=${name}`);
    const r = j.results.find(r => r.arch === "x86_64");
    repo[name] = r ? `${r.repo}/${r.pkgver}-${r.pkgrel}` : "absent";
  }
  const aur: Record<string, string> = {};
  for (const name of ["dotnet-sdk-bin", "dotnet-sdk-preview-bin", "powershell-bin", "powershell-preview-bin"]) {
    const j = await json<{ results: any[] }>(`https://aur.archlinux.org/rpc/v5/info?arg[]=${name}`);
    aur[name] = j.results[0]?.Version ?? "absent";
  }
  return { repo, aur };
}

export async function alpineObserved(branch = "v3.24") {
  const out: Record<string, string> = {};
  for (const repo of ["main", "community"]) {
    const r = await fetch(`https://dl-cdn.alpinelinux.org/alpine/${branch}/${repo}/x86_64/APKINDEX.tar.gz`);
    if (!r.ok) throw new Error(`APKINDEX ${branch}/${repo}: HTTP ${r.status}`);
    const files = await new Bun.Archive(new Uint8Array(await r.arrayBuffer())).files();
    const index = await files.get("APKINDEX")!.text();
    for (const block of index.split("\n\n")) {
      const f: Record<string, string> = {};
      for (const line of block.split("\n")) f[line.slice(0, 1)] = line.slice(2);
      if (f.P && /^(dotnet\d+-(sdk|sdk-aot|runtime)|aspnetcore\d+-runtime|powershell)$/.test(f.P))
        out[f.P] = `${repo}/${f.V}`;
    }
  }
  return { branch, packages: Object.fromEntries(Object.entries(out).sort()), powershellPackaged: "powershell" in out };
}

export async function build() {
  const [d10, d11, stable, preview, arch, alpine] = await Promise.all([
    dotnetChannel("10.0"),
    dotnetChannel("11.0"),
    powershellRelease("stable"),
    powershellRelease("preview"),
    archObserved(),
    alpineObserved(),
  ]);
  return {
    note: "Pinned upstream inputs of factory/dotnet-linux. Every archive is verified against the hash below before extraction; nothing is fetched unpinned. Regenerate with `bun factory/dotnet-linux/refresh.ts`.",
    observedAt: new Date().toISOString().slice(0, 10),
    dotnet: { "10.0": d10, "11.0": d11 },
    powershell: { stable, preview },
    distro: { arch, alpine },
  };
}

if (import.meta.main) {
  const check = Bun.argv.includes("--check");
  const strict = Bun.argv.includes("--strict");
  const fresh = await build();
  if (!check) {
    await Bun.write(pinsPath, JSON.stringify(fresh, null, 2) + "\n");
    console.log(
      `pins.json: .NET ${fresh.dotnet["10.0"].sdk} / ${fresh.dotnet["11.0"].sdk}, PowerShell ${fresh.powershell.stable.version} / ${fresh.powershell.preview.version}`,
    );
  } else {
    const pinned = JSON.parse(readFileSync(pinsPath, "utf8"));
    const problems: string[] = [];
    const newer: string[] = [];
    const compare = (label: string, a: any, b: any, hash: "sha512" | "sha256", have: string, upstream: string) => {
      if (have !== upstream) return void newer.push(`${label}: pinned ${have}, upstream ${upstream}`);
      for (const rid of Object.keys(a.assets))
        if (a.assets[rid][hash] !== b.assets[rid]?.[hash])
          problems.push(`${label} ${rid}: ${hash} differs from upstream for the same version`);
    };
    for (const ch of ["10.0", "11.0"] as const)
      compare(
        `dotnet ${ch}`,
        pinned.dotnet[ch],
        fresh.dotnet[ch],
        "sha512",
        pinned.dotnet[ch].sdk,
        fresh.dotnet[ch].sdk,
      );
    for (const k of ["stable", "preview"] as const)
      compare(
        `pwsh ${k}`,
        pinned.powershell[k],
        fresh.powershell[k],
        "sha256",
        pinned.powershell[k].version,
        fresh.powershell[k].version,
      );
    for (const l of newer) console.log(`newer upstream: ${l}`);
    for (const l of problems) console.error(`MISMATCH ${l}`);
    console.log(`pins.json checked: ${problems.length} mismatch(es), ${newer.length} newer upstream release(s)`);
    process.exit(problems.length || (strict && newer.length) ? 1 : 0);
  }
}
