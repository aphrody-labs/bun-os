#!/usr/bin/env bun
/**
 * Portable Windows C bundle from factory/c/windows/bundle.json, every asset pinned by sha256.
 *   bun factory/c/windows/bundle.ts [--root dir] [--run]     (default is a dry run that lists what would be downloaded)
 * Unpacks with the Windows tar (bsdtar) into <root>/<id>; PATH, registry and system settings are never touched.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const recipe = JSON.parse(readFileSync(join(import.meta.dir, "bundle.json"), "utf8"));
const root = resolve(
  process.argv.includes("--root")
    ? process.argv[process.argv.indexOf("--root") + 1]!
    : join(process.env.LOCALAPPDATA ?? ".", "bunos-c"),
);
const run = process.argv.includes("--run");
let failed = 0;
for (const a of recipe.assets) {
  const dest = join(root, a.id);
  const url = `https://github.com/${a.repo}/releases/download/${a.tag}/${encodeURIComponent(a.asset).replace(/%2B/g, "%2B")}`;
  console.log(`${a.id}: ${url} sha256:${a.sha256} -> ${dest}`);
  if (!run) continue;
  if (existsSync(join(dest, ".bunos-c-ok"))) {
    console.log("  already present");
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  HTTP ${res.status}`);
    failed++;
    continue;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== a.sha256) {
    console.error(`  sha256 mismatch: got ${digest}`);
    failed++;
    continue;
  }
  mkdirSync(dest, { recursive: true });
  const archive = join(dest, a.asset.replace(/[+]/g, "_"));
  writeFileSync(archive, buf);
  const t = Bun.spawnSync(
    [
      process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar",
      "-xf",
      archive.slice(dest.length + 1),
    ],
    { cwd: dest, stdout: "inherit", stderr: "inherit" },
  );
  if (t.exitCode) failed++;
  else writeFileSync(join(dest, ".bunos-c-ok"), digest);
}
console.log(
  run
    ? failed
      ? `${failed} asset(s) failed`
      : "bundle ready; add these to PATH in your shell only:"
    : "dry run (add --run to download)",
);
if (run && !failed) for (const a of recipe.assets) console.log("  " + join(root, a.id, a.bin));
process.exit(failed ? 1 : 0);
