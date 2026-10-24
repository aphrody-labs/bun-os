// SPDX-License-Identifier: Apache-2.0
// Prepares the in-browser Linux: pinned v86 build and BIOS into dist/vm, Alpine ISO in the VPS artifact cache (served with
// Range requests). Every input is verified against vm.lock.json or the Alpine checksum file before it is published.
//   bun vm.ts            stage dist/vm and verify the local ISO
//   bun vm.ts --no-iso   stage only the small files
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const lock = JSON.parse(
  await Bun.file(join(import.meta.dir, "vm.lock.json")).text(),
) as {
  v86: { version: string; tarball: string; integrity: string; files: string[] };
  bios: { files: Record<string, { url: string; bytes: number }> };
  alpine: {
    version: string;
    iso: { name: string; url: string; bytes: number };
    checksums: string;
  };
};
const cache = join(root, "build/web-vm");
mkdirSync(cache, { recursive: true });

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** v86 library and wasm from the pinned npm tarball (integrity checked), plus the BIOS images. */
export async function stageVm(dist: string) {
  const out = join(dist, "vm");
  mkdirSync(join(out, "bios"), { recursive: true });
  const tgz = join(cache, `v86-${lock.v86.version}.tgz`);
  if (!existsSync(tgz))
    await Bun.write(tgz, await fetchBytes(lock.v86.tarball));
  const bytes = await Bun.file(tgz).bytes();
  const digest = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
  if (digest !== lock.v86.integrity)
    throw new Error(`v86 tarball integrity mismatch: ${digest}`);
  const files = await new Bun.Archive(await Bun.file(tgz).bytes()).files();
  for (const wanted of lock.v86.files) {
    const entry = files.get(`package/${wanted}`);
    if (!entry) throw new Error(`v86 tarball has no ${wanted}`);
    await Bun.write(join(out, wanted.split("/").pop()!), entry);
  }
  for (const [name, spec] of Object.entries(lock.bios.files)) {
    const path = join(cache, name);
    if (!existsSync(path)) await Bun.write(path, await fetchBytes(spec.url));
    const data = await Bun.file(path).bytes();
    if (data.byteLength !== spec.bytes)
      throw new Error(
        `${name}: expected ${spec.bytes} bytes, got ${data.byteLength}`,
      );
    await Bun.write(join(out, "bios", name), data);
  }
  await Bun.write(
    join(out, "manifest.json"),
    JSON.stringify({
      v86: lock.v86.version,
      alpine: lock.alpine.version,
      iso: lock.alpine.iso.name,
      isoBytes: lock.alpine.iso.bytes,
    }),
  );
}

/** Download and verify the Alpine ISO for inclusion in an immutable VPS release. */
export async function stageIso() {
  const { iso, checksums } = lock.alpine;
  const key = `webos/vm/${iso.name}`;
  const path = join(cache, iso.name);
  if (!existsSync(path) || Bun.file(path).size !== iso.bytes)
    await Bun.write(path, await fetchBytes(iso.url));
  const checksumResponse = await fetch(checksums, {
    signal: AbortSignal.timeout(30000),
  });
  if (!checksumResponse.ok)
    throw new Error(`Alpine checksum: HTTP ${checksumResponse.status}`);
  const expected = (await checksumResponse.text()).split(/\s+/)[0]!;
  if (!/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Invalid Alpine checksum");
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  const actual = hasher.digest("hex");
  if (actual !== expected)
    throw new Error(
      `${iso.name}: sha256 ${actual} does not match Alpine's ${expected}`,
    );
  return { path, key, sha256: actual };
}

if (import.meta.main) {
  await stageVm(join(import.meta.dir, "dist"));
  if (!Bun.argv.includes("--no-iso")) console.log(await stageIso());
}
