#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Builds the Bun OS NT-layer install bundle for %SystemRoot%\BunOS (consumed by setup-elevated.ps1): the WinClean
// bridge and the bunos-nt client (release, test-signed by setup-elevated), the Bun guest client, the bunos.sys driver
// package (built with `cargo wdk build`, signed with the machine cert), the load/test scripts, and a SHA256SUMS +
// manifest.json receipt (same shape as factory/windows/userland and factory/wsl/windows).
// Usage: bun factory/windows/nt/build-nt-bundle.ts [--out <dir>] [--no-driver]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, relative } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "../../..");
const out = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1]! : join(process.env.LOCALAPPDATA ?? "/tmp", "BunOS/bundle/bunos-nt");
})();
const withDriver = !process.argv.includes("--no-driver");
const targetDir = process.env.CARGO_TARGET_DIR ?? join(root, "build/rust");

const sha256 = (p: string) => createHash("sha256").update(require("node:fs").readFileSync(p)).digest("hex");
const rev = (await $`git -C ${root} rev-parse HEAD`.text()).trim();

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "driver"), { recursive: true });

console.log("building release binaries (bunos-nt, bunos-winbridge)…");
await $`cargo build --release -p bunos-nt-client -p bunos-nt-bridge`.cwd(root);

const copies: [string, string][] = [
  [join(targetDir, "release/bunos-nt.exe"), "bunos-nt.exe"],
  [join(targetDir, "release/bunos-winbridge.exe"), "bunos-winbridge.exe"],
  [join(root, "crates/bunos-nt-bridge/client/bunos-win.ts"), "bunos-win.ts"],
  [join(root, "factory/windows/nt/end-to-end.ts"), "end-to-end.ts"],
  [join(root, "factory/windows/nt/driver/load-driver.cmd"), "driver/load-driver.cmd"],
  [join(root, "factory/windows/nt/driver/test-driver.cmd"), "driver/test-driver.cmd"],
];

if (withDriver) {
  console.log("building the driver package (cargo wdk build)…");
  await $`cargo wdk build --profile release`.cwd(join(root, "crates/bunos-nt-driver"));
  const pkg = join(targetDir, "release/bunos_package");
  for (const f of ["bunos.sys", "bunos.inf", "bunos.cat"]) copies.push([join(pkg, f), `driver/${f}`]);
  const signer = join(root, "factory/windows/signing/test-signing.ps1");
  console.log("signing bunos.sys and bunos.cat with the machine test-signing certificate…");
  // Re-sign the driver with the trusted machine cert (cargo wdk used WDRLocalTestCert). Non-fatal off a set-up host.
  try {
    await $`pwsh -NoProfile -File ${signer} sign ${join(pkg, "bunos.sys")} ${join(pkg, "bunos.cat")}`;
  } catch (e) {
    console.warn(`signing skipped (${e}); setup-elevated.ps1 signs on install`);
  }
}

for (const [src, dst] of copies) {
  if (!existsSync(src)) {
    if (dst.startsWith("driver/") && !["driver/load-driver.cmd", "driver/test-driver.cmd"].includes(dst)) continue;
    throw new Error(`missing ${src}`);
  }
  const target = join(out, dst);
  mkdirSync(join(target, ".."), { recursive: true });
  cpSync(src, target);
}

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(out).filter(f => !f.endsWith("SHA256SUMS") && !f.endsWith("manifest.json"));
const sums = files
  .map(f => `${sha256(f)}  ${relative(out, f).replaceAll("\\", "/")}`)
  .sort()
  .join("\n");
writeFileSync(join(out, "SHA256SUMS"), sums + "\n");
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "bunos-windows-nt",
      built: new Date().toISOString(),
      host: hostname(),
      repository: { revision: rev },
      driver: withDriver,
      files: files.map(f => ({ path: relative(out, f).replaceAll("\\", "/"), sha256: sha256(f), bytes: statSync(f).size })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`bundle ${out}\n${files.length} files, driver ${withDriver}`);
console.log(`install: C:\\Windows\\System32\\sudo.exe pwsh -NoProfile -File ${join(root, "factory/windows/nt/setup-elevated.ps1")} -Bundle ${out}`);
