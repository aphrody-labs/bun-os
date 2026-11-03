#!/usr/bin/env bun
/**
 * Workstation side of the Bun OS Windows userland: fetches the build host's tarball over the mesh, checks its sha256
 * and every file against manifest.json, extracts it into %LOCALAPPDATA%\bunos\userland\staging\<build>, signs every
 * .exe with the Bun OS test certificate (factory/windows/signing/test-signing.ps1, elevated through sudo.exe), and
 * rewrites the manifest with the signed hashes (the build hash stays as `buildSha256`) and the signer thumbprint.
 *
 *   bun factory/windows/userland/stage.ts [--host vps] [--remote <tarball path>] [--no-sign]
 *
 * Then: C:\Windows\System32\sudo.exe pwsh -NoProfile -File factory\windows\userland\install-system.ps1
 */
import { $ } from "bun";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const option = (n: string, d?: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const host = option("--host", "vps")!;
const sign = !args.includes("--no-sign");
const root = resolve(import.meta.dir, "../../..");
const staging = join(process.env.LOCALAPPDATA!, "bunos", "userland", "staging");
mkdirSync(staging, { recursive: true });
const sha256 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

const remote =
  option("--remote") ??
  (await $`ssh ${host} ${"readlink -f build/out/windows-userland/latest"}`.text()).trim() + ".tar.gz";
const local = join(staging, basename(remote));
await $`scp -q ${`${host}:${remote}`} ${local}`;
await $`scp -q ${`${host}:${remote}.sha256`} ${local + ".sha256"}`;
const want = readFileSync(local + ".sha256", "utf8").split(/\s+/)[0];
if (sha256(local) !== want) throw new Error(`tarball sha256 mismatch: ${local}`);
const dir = join(staging, basename(remote, ".tar.gz"));
// A rebuilt (--into) tarball keeps its name: re-extract, but keep the signed copy of every binary whose build hash
// did not change, so an unchanged tool keeps its installed hash (a new signature carries a new timestamp).
const signedByBuild = new Map<string, Buffer>();
if (existsSync(join(dir, "manifest.json"))) {
  const old = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const tool of old.tools)
    for (const f of tool.files)
      if (
        f.buildSha256 &&
        f.buildSha256 !== f.sha256 &&
        existsSync(join(dir, f.path)) &&
        sha256(join(dir, f.path)) === f.sha256
      )
        signedByBuild.set(f.buildSha256, readFileSync(join(dir, f.path)));
}
rmSync(dir, { recursive: true, force: true });
await $`C:/Windows/System32/tar.exe -xzf ${local} -C ${staging}`;

const manifestPath = join(dir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const exes: string[] = [];
for (const tool of manifest.tools)
  for (const f of tool.files) {
    const p = join(dir, f.path);
    const expected = f.buildSha256 ?? f.sha256;
    const actual = sha256(p);
    if (actual !== expected && actual !== f.sha256) throw new Error(`sha256 mismatch: ${f.path}`);
    f.buildSha256 = expected;
    const signed = signedByBuild.get(expected);
    if (signed) writeFileSync(p, signed);
    if (f.path.endsWith(".exe")) exes.push(p);
  }
console.log(`verified ${manifest.tools.length} tools in ${dir}`);

if (sign) {
  const ps1 = join(root, "factory/windows/signing/test-signing.ps1");
  const unsigned: string[] = [];
  for (const p of exes) {
    const st = (
      await $`pwsh -NoProfile -Command ${`(Get-AuthenticodeSignature -LiteralPath '${p}').Status`}`.text()
    ).trim();
    if (st !== "Valid") unsigned.push(p);
  }
  if (unsigned.length) await $`C:/Windows/System32/sudo.exe pwsh -NoProfile -File ${ps1} sign ${unsigned}`;
  const thumbs = new Set<string>();
  for (const p of exes) {
    const out = (
      await $`pwsh -NoProfile -Command ${`$s = Get-AuthenticodeSignature -LiteralPath '${p}'; "$($s.Status) $($s.SignerCertificate.Thumbprint) $($s.SignerCertificate.Subject)"`}`.text()
    ).trim();
    const [status, thumb] = out.split(" ");
    if (status !== "Valid") throw new Error(`signature not valid on ${p}: ${out}`);
    thumbs.add(thumb);
    manifest.signing = {
      subject: out.split(" ").slice(2).join(" "),
      thumbprint: thumb,
      tool: "factory/windows/signing/test-signing.ps1",
    };
  }
  if (thumbs.size !== 1) throw new Error(`expected one signer, got ${[...thumbs].join(", ")}`);
  manifest.signing.signed = new Date().toISOString();
  console.log(`signed ${unsigned.length} (${exes.length} total) with ${[...thumbs][0]}`);
}
for (const tool of manifest.tools) for (const f of tool.files) f.sha256 = sha256(join(dir, f.path));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `staged ${dir}\ninstall: C:\\Windows\\System32\\sudo.exe pwsh -NoProfile -File ${join(root, "factory/windows/userland/install-system.ps1")} -Source ${dir}`,
);
