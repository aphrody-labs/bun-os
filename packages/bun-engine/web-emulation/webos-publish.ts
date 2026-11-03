// SPDX-License-Identifier: Apache-2.0
// Publish qualified browser cores without deleting versions still used by clients.
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { qualificationSHA256, verifyQualification } from "./qualification";

interface PlannedFile {
  source: string;
  destination: string;
  digest: string;
  replace: boolean;
}

async function maybeStat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function safeDirectories(root: string, directory: string, create: boolean) {
  const rel = relative(root, directory);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== directory)
    throw new Error("Publication path escapes object store");
  let current = root;
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component);
    let stat = await maybeStat(current);
    if (!stat && create) {
      await mkdir(current).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      stat = await maybeStat(current);
    }
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error(`Unsafe publication directory: ${current}`);
  }
}

async function collect(
  source: string,
  prefix: string,
  objects: string,
  core?: string,
  include?: Set<string>,
): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  async function walk(dir: string, rel: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Publication source is a symlink: ${path}`);
      if (entry.isDirectory()) await walk(path, child);
      else if (entry.isFile()) {
        if (include && !include.has(child)) continue;
        const destination = join(objects, "emulation", prefix, ...child.split("/"));
        files.push({
          source: path,
          destination,
          digest: await qualificationSHA256(path),
          // Only core pointers are mutable; hashed assets and shared runtime/firmware are retained.
          replace: !!core && (child === "manifest.json" || child === "qualification.json"),
        });
      } else throw new Error(`Unsupported publication source: ${path}`);
    }
  }
  await walk(source, "");
  return files;
}

/** Caller supplies known core ids; every core is verified before the object store changes. */
export async function publishQualifiedCores(dist: string, objectsPath: string, cores: string[], root: string) {
  const ids = [...new Set(cores)];
  if (!ids.length) return [];
  const firmware = new Set<string>();
  for (const core of ids) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(core)) throw new Error(`Invalid core: ${core}`);
    const receipt = await verifyQualification(dist, core, { root });
    for (const fixture of receipt.fixtures) {
      if (fixture.path.startsWith("firmware/")) firmware.add(fixture.path.slice("firmware/".length));
    }
  }
  await mkdir(objectsPath, { recursive: true });
  const objects = await realpath(objectsPath);
  const files: PlannedFile[] = [];
  files.push(...(await collect(join(dist, "runtime"), "runtime", objects)));
  if (firmware.size) {
    firmware.add("firmware.json");
    files.push(...(await collect(join(dist, "firmware"), "firmware", objects, undefined, firmware)));
  }
  for (const core of ids) files.push(...(await collect(join(dist, core), core, objects, core)));
  // Refuse to overwrite immutable assets or shared files that another core may still use.
  for (const file of files) {
    await safeDirectories(objects, dirname(file.destination), false);
    const existing = await maybeStat(file.destination);
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw new Error(`Unsafe publication destination: ${file.destination}`);
    if (existing && !file.replace && (await qualificationSHA256(file.destination)) !== file.digest)
      throw new Error(`Publication would overwrite an existing asset: ${file.destination}`);
  }
  // Copy assets first; replace the small core pointers only after every asset is present.
  const rank = (file: PlannedFile) => (!file.replace ? 0 : file.destination.endsWith(`${sep}manifest.json`) ? 2 : 1);
  files.sort((a, b) => rank(a) - rank(b));
  let reverified = false;
  for (const file of files) {
    if (file.replace && !reverified) {
      for (const core of ids) await verifyQualification(dist, core, { root });
      reverified = true;
    }
    await safeDirectories(objects, dirname(file.destination), true);
    if ((await qualificationSHA256(file.source)) !== file.digest)
      throw new Error(`Publication source changed: ${file.source}`);
    if (!file.replace) {
      try {
        await copyFile(file.source, file.destination, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = await lstat(file.destination);
      if (!stat.isFile() || stat.isSymbolicLink() || (await qualificationSHA256(file.destination)) !== file.digest)
        throw new Error(`Publication asset changed: ${file.destination}`);
    } else {
      const tmp = `${file.destination}.${crypto.randomUUID()}.tmp`;
      try {
        await copyFile(file.source, tmp, constants.COPYFILE_EXCL);
        if ((await qualificationSHA256(tmp)) !== file.digest) throw new Error("Publication source changed during copy");
        await rename(tmp, file.destination);
      } finally {
        await unlink(tmp).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    }
  }
  return ids;
}
