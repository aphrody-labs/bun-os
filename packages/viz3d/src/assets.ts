// SPDX-License-Identifier: MIT
// Port of upstream examples/scripts/fetch-assets.sh: copy the anatomy meshes the studies load (BodyParts3D,
// © The Database Center for Life Science, CC BY-SA 2.1 Japan) from the hosted bucket into the local cache the study
// server reads first, verifying each sha256. Files already present with the right checksum are skipped.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "./commands.ts";
import { sha256 } from "./pyjson.ts";
import { studiesDir } from "./paths.ts";

export const assetsDir = () => join(resolve(Bun.env.VIZ3D_CACHE ?? join(homedir(), ".cache", "aphrody", "viz3d")), "assets");

interface AssetManifest {
  base: string;
  files: { key: string; bytes: number; sha256: string }[];
}

export async function fetchAssets(options: { only?: string } = {}) {
  const studies = studiesDir();
  if (!studies) throw new Error("the studies ship with the @aphrody/viz3d workspace package, not the skill");
  const manifest = JSON.parse(readFileSync(join(studies, "assets-manifest.json"), "utf8")) as AssetManifest;
  const out = assetsDir();
  let fetched = 0,
    skipped = 0,
    bytes = 0;
  const failed: string[] = [];
  for (const file of manifest.files) {
    if (options.only && !file.key.startsWith(options.only)) continue;
    if (file.key.split("/").includes("..")) throw new Error(`unsafe key ${file.key}`);
    const target = join(out, file.key);
    if (existsSync(target) && sha256(readFileSync(target)) === file.sha256) {
      skipped++;
      continue;
    }
    const response = await fetch(new URL(file.key, manifest.base));
    const body = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || sha256(body) !== file.sha256) {
      failed.push(`${file.key}: ${response.ok ? "sha256 mismatch" : `HTTP ${response.status}`}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, body);
    fetched++;
    bytes += body.length;
  }
  return { dir: out, fetched, skipped, bytes, failed };
}

export async function fetchAssetsCommand(argv: string[]): Promise<number> {
  const { values } = parse(argv, { only: { type: "string" } });
  if (values.help) {
    console.log("usage: viz3d fetch-assets [--only anatomy/]\nDownload the study meshes into the local cache, verifying sha256.");
    return 0;
  }
  const report = await fetchAssets({ only: values.only as string | undefined });
  console.log(JSON.stringify(report, null, 2));
  return report.failed.length ? 1 : 0;
}
