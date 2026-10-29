// SPDX-License-Identifier: Apache-2.0
/** Stage the Infra scripts referenced by copied systemd units. */
import { execFileSync } from "@aphrody/update/process";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SCRIPT_PATHS = ["scripts/ops/repo-sync.ts", "scripts/tools/workspace/source-sync.ts"] as const;

type SourceEntry = {
  source: string;
  target: string | null;
  sha256?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
};

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function importInfraScripts(sourceRoot: string, targetRoot: string): Promise<Record<string, unknown>> {
  const source = resolve(sourceRoot, "aphrody-infra");
  const target = resolve(targetRoot);
  const sourceHead = git(source, ["rev-parse", "HEAD"]).trim();
  const tracked = new Set(
    git(source, ["ls-files", "-z", "--", ...SCRIPT_PATHS])
      .split("\0")
      .filter(Boolean),
  );
  if (SCRIPT_PATHS.some(path => !tracked.has(path)))
    throw new Error("one or more Infra service scripts are not tracked");
  const dirty = () => git(source, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...SCRIPT_PATHS]);
  if (dirty()) throw new Error("Infra service script source is dirty; review it before import");

  const mapPath = join(target, "docs/migration/source-map.json");
  const sourceMap = JSON.parse(await readFile(mapPath, "utf8")) as {
    entries: SourceEntry[];
  };
  const bySource = new Map(sourceMap.entries.map(entry => [entry.source, entry]));
  const planned = [];
  for (const path of SCRIPT_PATHS) {
    const entry = bySource.get(`aphrody-infra/${path}`);
    if (!entry?.sha256) throw new Error(`script absent from hashed source map: ${path}`);
    // oxlint-disable-next-line no-await-in-loop -- contrôle préalable séquentiel : la première anomalie arrête l'import dans l'ordre des scripts
    const sourceBytes = await readFile(join(source, path));
    const sourceHash = hash(sourceBytes);
    if (entry.sha256 !== sourceHash) throw new Error(`Infra service script changed after inventory: ${path}`);
    const destination = `scripts/tools/infra/${path}`;
    if (entry.target && entry.target !== destination)
      throw new Error(`Infra service script already maps elsewhere: ${path}`);
    const targetPath = resolve(target, destination);
    if (!targetPath.startsWith(`${target}/`)) throw new Error(`script target escapes root: ${path}`);
    const existing = existsSync(targetPath);
    // oxlint-disable-next-line no-await-in-loop -- contrôle préalable séquentiel : la première anomalie arrête l'import dans l'ordre des scripts
    if (existing && hash(await readFile(targetPath)) !== sourceHash)
      throw new Error(`Infra service script target conflict: ${destination}`);
    if (entry.importedSha256 && entry.importedSha256 !== sourceHash)
      throw new Error(`recorded Infra service script target changed: ${destination}`);
    planned.push({
      path,
      destination,
      targetPath,
      sourceHash,
      entry,
      existing,
    });
  }
  if (git(source, ["rev-parse", "HEAD"]).trim() !== sourceHead || dirty())
    throw new Error("Infra service scripts changed during preflight; import aborted");

  for (const item of planned) {
    if (!item.existing) {
      // oxlint-disable-next-line no-await-in-loop -- copies séquentielles avec COPYFILE_EXCL : chaque écriture doit réussir avant la suivante
      await mkdir(dirname(item.targetPath), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- copies séquentielles avec COPYFILE_EXCL : chaque écriture doit réussir avant la suivante
      await copyFile(join(source, item.path), item.targetPath, constants.COPYFILE_EXCL);
    }
    item.entry.target = item.destination;
    item.entry.importedSha256 = item.sourceHash;
    item.entry.importedSourceSha256 = item.sourceHash;
  }
  await writeFile(mapPath, `${JSON.stringify(sourceMap)}\n`);
  const report = {
    observedAt: new Date().toISOString(),
    sourceHead,
    sourcePath: source,
    targetPath: target,
    fileCount: planned.length,
    copied: planned.filter(item => !item.existing).length,
    identical: planned.filter(item => item.existing).length,
    qualification: "Source-hash-qualified copy only; systemd and script runtime paths remain transitional.",
    files: planned.map(item => ({
      source: `aphrody-infra/${item.path}`,
      target: item.destination,
      sha256: item.sourceHash,
      category: "tools",
    })),
  };
  const reportPath = "docs/migration/infra-scripts-import.json";
  await writeFile(join(target, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  return {
    fileCount: report.fileCount,
    copied: report.copied,
    identical: report.identical,
    report: reportPath,
  };
}
