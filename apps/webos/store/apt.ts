// SPDX-License-Identifier: Apache-2.0
// apt repository of Bun OS: the packages of the pacman repository repackaged as real .deb files (same staged
// files, dpkg-deb), indexed with apt-ftparchive and signed (InRelease + Release.gpg) with a dedicated key kept in
// the protected store. Only packages that run on Debian unchanged are carried: architecture-independent data
// (fonts, icons) and the statically usable Bun canary binary.
//   deb [signed-by=/usr/share/keyrings/aphrody-apt.gpg] https://aphrody.com/repo/apt stable main
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

/** Pacman packages carried to Debian: they hold no glibc-version-specific or Arch-layout-specific files. */
const CARRY = ["bun-canary", "bun-os-fonts", "material-design-icons-bunos"];

const debVersion = (v: string) => v.replace(/[^A-Za-z0-9.+~-]/g, "+").replace(/^([^0-9])/, "0$1");

async function gpgKey(ctx: Ctx): Promise<{ home: string; fpr: string }> {
  const home = join(ctx.secrets, "apt");
  await mkdir(home, { recursive: true });
  await chmod(home, 0o700);
  const list = async () => (await run(["gpg", "--homedir", home, "--batch", "--with-colons", "--list-secret-keys"])).out;
  if (!(await list()).includes("fpr:")) {
    const made = await run(["gpg", "--homedir", home, "--batch", "--passphrase", "", "--quick-gen-key", "Bun OS apt repository <contact@aphrody.com>", "rsa4096", "sign", "never"]);
    if (made.code !== 0) throw new Error("apt signing key generation failed");
  }
  const fpr = /^fpr:+([0-9A-F]+):/m.exec(await list())?.[1];
  if (!fpr) throw new Error("apt signing key not found");
  return { home, fpr };
}

export async function build(ctx: Ctx) {
  const repo = join(ctx.store, "repo/apt");
  const pacman = join(ctx.store, "repo/os/x86_64");
  const work = join(ctx.store, ".apt-staging");
  await rm(repo, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(join(repo, "pool/main"), { recursive: true });
  await mkdir(join(repo, "dists/stable/main/binary-amd64"), { recursive: true });
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const files = (await readdir(pacman)).filter((f) => f.endsWith(".pkg.tar.zst"));
  for (const name of CARRY) {
    const file = files.find((f) => f.startsWith(`${name}-`) && /^\d|^r\d/.test(f.slice(name.length + 1)));
    if (!file) {
      skipped.push({ name, reason: "not in the pacman repository of this build" });
      continue;
    }
    const root = join(work, name);
    await mkdir(join(root, "DEBIAN"), { recursive: true });
    const x = await run(["tar", "--zstd", "-xf", join(pacman, file), "-C", root, "--exclude=.PKGINFO", "--exclude=.MTREE", "--exclude=.BUILDINFO", "--exclude=.INSTALL"]);
    const info = await run(["tar", "--zstd", "-xOf", join(pacman, file), ".PKGINFO"]);
    if (x.code !== 0 || info.code !== 0) {
      skipped.push({ name, reason: `cannot unpack ${file}: ${tail(x.out + info.out, 2)}` });
      continue;
    }
    const meta: Record<string, string> = {};
    for (const line of info.out.split("\n")) {
      const m = /^(\w+) = (.*)$/.exec(line);
      if (m && !(m[1]! in meta)) meta[m[1]!] = m[2]!;
    }
    const arch = meta.arch === "any" ? "all" : "amd64";
    const version = debVersion(meta.pkgver ?? "0");
    const installed = (await run(["du", "-sk", "--exclude=DEBIAN", root])).out.split("\t")[0];
    await Bun.write(
      join(root, "DEBIAN/control"),
      [
        `Package: ${name}`,
        `Version: ${version}`,
        `Architecture: ${arch}`,
        "Maintainer: aphrody-dev <contact@aphrody.com>",
        `Installed-Size: ${installed}`,
        "Section: misc",
        "Priority: optional",
        `Homepage: ${meta.url ?? ctx.origin}`,
        `Description: ${meta.pkgdesc ?? name}`,
        ` Repackaged from the Bun OS pacman package ${file} (license ${meta.license ?? "see package"}).`,
        "",
      ].join("\n"),
    );
    const deb = `${name}_${version}_${arch}.deb`;
    const built = await run(["dpkg-deb", "--root-owner-group", "-Zxz", "--build", root, join(repo, "pool/main", deb)], { timeout: 900_000 });
    await rm(root, { recursive: true, force: true });
    if (built.code !== 0) {
      skipped.push({ name, reason: `dpkg-deb failed: ${tail(built.out, 2)}` });
      continue;
    }
    const path = join(repo, "pool/main", deb);
    entries.push({
      name,
      version,
      desc: meta.pkgdesc ?? "",
      license: meta.license,
      size: Bun.file(path).size,
      sha256: await sha256(path),
      file: `/repo/apt/pool/main/${deb}`,
      homepage: meta.url,
      meta: { arch, from: file },
    });
  }
  await rm(work, { recursive: true, force: true });
  // Index and release, signed.
  const packages = await run(["apt-ftparchive", "packages", "pool"], { cwd: repo });
  if (packages.code !== 0) throw new Error(`apt-ftparchive packages failed: ${tail(packages.out, 3)}`);
  await Bun.write(join(repo, "dists/stable/main/binary-amd64/Packages"), packages.out);
  await run(["sh", "-c", "gzip -9kf Packages"], { cwd: join(repo, "dists/stable/main/binary-amd64") });
  const release = await run(
    [
      "apt-ftparchive",
      "-o", "APT::FTPArchive::Release::Origin=Aphrody",
      "-o", "APT::FTPArchive::Release::Label=Bun OS",
      "-o", "APT::FTPArchive::Release::Suite=stable",
      "-o", "APT::FTPArchive::Release::Codename=stable",
      "-o", "APT::FTPArchive::Release::Architectures=amd64 all",
      "-o", "APT::FTPArchive::Release::Components=main",
      "release", "dists/stable",
    ],
    { cwd: repo },
  );
  if (release.code !== 0) throw new Error("apt-ftparchive release failed");
  await Bun.write(join(repo, "dists/stable/Release"), release.out);
  const key = await gpgKey(ctx);
  const gpg = ["gpg", "--homedir", key.home, "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", "", "--local-user", key.fpr];
  const s1 = await run([...gpg, "--clearsign", "-o", "InRelease", "Release"], { cwd: join(repo, "dists/stable") });
  const s2 = await run([...gpg, "-abs", "-o", "Release.gpg", "Release"], { cwd: join(repo, "dists/stable") });
  if (s1.code || s2.code) throw new Error("apt release signing failed");
  await run(["sh", "-c", `gpg --homedir "$1" --batch --export "$2" > "$3"`, "_", key.home, key.fpr, join(repo, "aphrody-apt.gpg")]);
  await writeIndex(ctx, { format: "apt", generated: new Date().toISOString(), url: `${ctx.origin}/repo/apt`, entries, skipped });
  console.log(`apt: ${entries.length} packages, ${skipped.length} skipped`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const image = "debian:stable-slim";
  const script = `set -e
apt-get update -qq >/dev/null && apt-get install -y -qq ca-certificates curl >/dev/null
curl -fsS ${ctx.origin}/repo/apt/aphrody-apt.gpg -o /usr/share/keyrings/aphrody-apt.gpg
echo "deb [signed-by=/usr/share/keyrings/aphrody-apt.gpg] ${ctx.origin}/repo/apt stable main" > /etc/apt/sources.list.d/aphrody.list
apt-get update 2>&1 | grep -i aphrody
apt-get install -y bun-canary 2>&1 | tail -3
dpkg -s bun-canary | grep -E '^(Status|Version)'
bun --revision`;
  await step(steps, `apt-get update (signed InRelease) && apt-get install bun-canary (container ${image})`, () => docker(image, script, { timeout: 600_000 }));
  return { format: "apt", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image, steps };
}
