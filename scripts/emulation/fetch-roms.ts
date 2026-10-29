// Fetch the free test ROMs of the emulation suite into target/rom-suite/downloads (sha256-verified).
// Usage: bun scripts/emulation/fetch-roms.ts [downloadsDir]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = resolve(process.argv[2] ?? join(root, "target/rom-suite/downloads"));
const pins = JSON.parse(readFileSync(join(import.meta.dir, "pins.json"), "utf8"));
const roms = JSON.parse(readFileSync(join(root, "packages/bun-engine/plugins/consoles/roms.json"), "utf8"));

interface Pin {
  id: string;
  url: string;
  sha256: string;
  extractTo?: string;
  only?: string[];
}
const items: Pin[] = [
  ...pins.fromRoms.map((id: string) => {
    const p = roms.packs.find((x: { id: string }) => x.id === id);
    if (!p?.url || !p.sha256) throw new Error(`roms.json: no url+sha256 pin for ${id}`);
    return { id, url: p.url, sha256: p.sha256, extractTo: p.url.endsWith(".zip") ? id : undefined, flat: true };
  }),
  ...pins.downloads,
];

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let failed = 0;
for (const it of items) {
  const name = it.url.split("/").pop()!;
  const file = join(out, ".archives", `${it.id}-${name}`);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file) || sha256(new Uint8Array(readFileSync(file))) !== it.sha256) {
    const res = await fetch(it.url, { redirect: "follow" });
    if (!res.ok) {
      console.error(`FAIL ${it.id}: HTTP ${res.status} ${it.url}`);
      failed++;
      continue;
    }
    await Bun.write(file, new Uint8Array(await res.arrayBuffer()));
  }
  const got = sha256(new Uint8Array(readFileSync(file)));
  if (got !== it.sha256) {
    console.error(`FAIL ${it.id}: sha256 ${got} != ${it.sha256}`);
    failed++;
    continue;
  }
  const dest = join(out, it.extractTo ?? "");
  mkdirSync(dest, { recursive: true });
  if (/\.(zip|tar\.xz)$/.test(name)) {
    // bsdtar reads both on Windows (System32\tar.exe) and Linux (libarchive-tools); GNU tar does not read zip.
    const tar =
      process.platform === "win32" ? "C:/Windows/System32/tar.exe" : existsSync("/usr/bin/bsdtar") ? "bsdtar" : null;
    const cmd =
      name.endsWith(".zip") && !tar
        ? ["unzip", "-q", "-o", file, "-d", dest]
        : [tar ?? "tar", "-xf", file, "-C", dest, ...(it.only ?? [])];
    const p = Bun.spawnSync(cmd);
    if (p.exitCode !== 0) {
      console.error(`FAIL ${it.id}: extract ${p.stderr}`);
      failed++;
      continue;
    }
    if (it.only) {
      // flatten the single wanted member next to the archive name
      for (const o of it.only) await Bun.write(join(dest, o.split("/").pop()!), Bun.file(join(dest, o)));
    }
  } else {
    await Bun.write(join(dest, name), Bun.file(file));
  }
  console.log(`ok   ${it.id} ${it.sha256.slice(0, 12)}`);
}
process.exit(failed ? 1 : 0);
