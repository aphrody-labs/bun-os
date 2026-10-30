#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Pin the upstream Linux release asset of every native emulator packaged by factory/arch/emulators into pins.json
// (tag, asset URL, size, sha256 from the GitHub release digest). The asset selectors come from the canonical
// packages/bun-engine/plugins/consoles/releases.json; PKGBUILDs are rendered from the pins by render.ts.
//   bun factory/arch/emulators/pin.ts [id...]
import { join, resolve } from "node:path";

const here = import.meta.dir;
const root = resolve(here, "../../..");
const releases = (await Bun.file(join(root, "packages/bun-engine/plugins/consoles/releases.json")).json()) as {
  packages: Record<string, { repo: string; asset?: Record<string, string> }>;
};
/** Packages whose Linux binaries come from a different upstream repository than releases.json names. */
const LINUX_OVERRIDES: Record<string, { repo: string; asset: string }> = {
  rpcs3: { repo: "RPCS3/rpcs3-binaries-linux", asset: "\\.AppImage$" },
};
const ids = Bun.argv.slice(2);
const pinsPath = join(here, "pins.json");
const pins: Record<string, unknown> = (await Bun.file(pinsPath).exists()) ? await Bun.file(pinsPath).json() : {};
const token = Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN;
for (const [id, pkg] of Object.entries(releases.packages)) {
  if (ids.length && !ids.includes(id)) continue;
  const linux =
    LINUX_OVERRIDES[id] ?? (pkg.asset?.["linux-x64"] ? { repo: pkg.repo, asset: pkg.asset["linux-x64"] } : undefined);
  if (!linux) continue;
  const response = await fetch(`https://api.github.com/repos/${linux.repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) {
    console.warn(`${id}: ${linux.repo} ${response.status}`);
    continue;
  }
  const release = (await response.json()) as {
    tag_name: string;
    assets: { name: string; size: number; browser_download_url: string; digest?: string }[];
  };
  const asset = release.assets.find(a => new RegExp(linux.asset).test(a.name));
  if (!asset?.digest?.startsWith("sha256:")) {
    console.warn(`${id}: no matching asset with a sha256 digest in ${release.tag_name}`);
    continue;
  }
  pins[id] = {
    repo: linux.repo,
    tag: release.tag_name,
    asset: asset.name,
    url: asset.browser_download_url,
    bytes: asset.size,
    sha256: asset.digest.slice("sha256:".length),
  };
  console.log(`${id}: ${release.tag_name} ${asset.name}`);
}
await Bun.write(pinsPath, `${JSON.stringify(pins, null, 2)}\n`);
