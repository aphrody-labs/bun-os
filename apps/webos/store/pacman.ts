// SPDX-License-Identifier: Apache-2.0
// Pacman repository `aphrody` (libalpm layout /repo/os/x86_64/), built on the VPS from the factory PKGBUILDs inside an
// Arch Linux container. Packages and the database are signed with a key kept in the protected store (never served).
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const IMAGE = "archlinux:latest";
/** PKGBUILDs that build without a Rust or Bun compile; the rest is recorded as skipped. */
const BUILD = ["factory/usr/pkgs/bunos-filesystem", "factory/usr/pkgs/bun-canary", "factory/bunos/pkgbuilds/material-design-icons-bunos", "factory/bunos/pkgbuilds/bun-os-fonts"];
const SKIP_REASON: Record<string, string> = {
  "factory/usr/pkgs/bunos-utils": "Rust compile of the uutils multicall; built by the /usr factory",
  "factory/bunos/pkgbuilds/aphrody": "Rust workspace build (hours); built by the /usr factory",
  "factory/bunos/pkgbuilds/bun-engine": "Rust and native engine build; built by the factory",
  "factory/bunos/pkgbuilds/bun-os-server": "Rust compile; built by the factory",
  "factory/bunos/pkgbuilds/bun-os-spacedrive": "Rust and Node compile; built by the factory",
  "factory/bunos/pkgbuilds/bun-os-waydroid": "Rust compile and pinned source commit not published",
  "factory/bunos/pkgbuilds/bun-os-webapps": "Bun install and builds of every web app; built by the factory",
};

const keyDir = (ctx: Ctx) => join(ctx.secrets, "gnupg");
export const pacmanDir = (ctx: Ctx) => join(ctx.store, "repo/os/x86_64");

async function pkginfo(file: string) {
  const r = await run(["tar", "--zstd", "-xOf", file, ".PKGINFO"]);
  const info: Record<string, string> = {};
  for (const line of r.out.split("\n")) {
    const m = /^(\w+) = (.*)$/.exec(line);
    if (m && !(m[1]! in info)) info[m[1]!] = m[2]!;
  }
  return info;
}

export async function build(ctx: Ctx): Promise<void> {
  const out = pacmanDir(ctx);
  await mkdir(out, { recursive: true });
  await mkdir(keyDir(ctx), { recursive: true, mode: 0o700 });
  const work = join(ctx.store, ".work/pacman");
  await rm(work, { recursive: true, force: true });
  await mkdir(join(work, "src"), { recursive: true });
  for (const dir of BUILD) await cp(join(ctx.root, dir), join(work, "src", dir.split("/").pop()!), { recursive: true });
  const names = BUILD.map((d) => d.split("/").pop()!);
  const script = `set -eu
pacman -Syu --noconfirm --needed base-devel git gnupg >/dev/null
export GNUPGHOME=/gnupg
if ! gpg --list-secret-keys aphrody-store >/dev/null 2>&1; then
  gpg --batch --passphrase '' --quick-gen-key 'aphrody-store <contact@aphrody.com>' rsa3072 sign never >/dev/null 2>&1
fi
FPR=$(gpg --list-secret-keys --with-colons aphrody-store | awk -F: '/^fpr/{print $10; exit}')
gpg --export "$FPR" > /os/aphrody.gpg
useradd -m builder 2>/dev/null || true
cp -r /work/src /home/builder/src && chown -R builder /home/builder/src
for p in ${names.join(" ")}; do
  echo "== $p"
  if su builder -c "cd /home/builder/src/$p && PKGDEST=/home/builder/pkgs makepkg --nodeps --noconfirm --clean -f" >/tmp/$p.log 2>&1; then echo "BUILT $p"; else echo "FAILED $p"; tail -n 5 /tmp/$p.log; fi
done
rm -f /os/x86_64/*.pkg.tar.zst /os/x86_64/*.sig /os/x86_64/aphrody.db* /os/x86_64/aphrody.files*
cp /home/builder/pkgs/*.pkg.tar.zst /os/x86_64/ 2>/dev/null || true
cd /os/x86_64
for f in *.pkg.tar.zst; do [ -e "$f" ] && gpg --batch --yes --detach-sign --no-armor --local-user "$FPR" "$f"; done
repo-add --sign --key "$FPR" aphrody.db.tar.zst *.pkg.tar.zst >/dev/null
chmod -R a+rX /os
`;
  const r = await docker(IMAGE, script, { mounts: [`${work}:/work`, `${join(ctx.store, "repo/os")}:/os`, `${keyDir(ctx)}:/gnupg`], timeout: 1_800_000 });
  console.log(tail(r.out, 30));
  if (r.code) throw new Error("pacman build failed");
  const entries: IndexEntry[] = [];
  for (const f of (await readdir(out)).filter((n) => n.endsWith(".pkg.tar.zst")).sort()) {
    const i = await pkginfo(join(out, f));
    entries.push({
      name: i.pkgname!, version: i.pkgver!, desc: i.pkgdesc ?? "", license: i.license, size: Number(i.size ?? 0),
      sha256: await sha256(join(out, f)), file: `/repo/os/x86_64/${f}`, homepage: i.url,
      meta: { arch: i.arch, depends: [] },
    });
  }
  const built = new Set(entries.map((e) => e.name));
  const skipped = Object.entries(SKIP_REASON).map(([d, reason]) => ({ name: d.split("/").pop()!, reason }));
  for (const n of names) if (!built.has(n)) skipped.push({ name: n, reason: "makepkg failed in the container" });
  await writeIndex(ctx, { format: "pacman", generated: new Date().toISOString(), url: "/repo/os/$arch", entries, skipped });
  await rm(work, { recursive: true, force: true });
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const idx = (await Bun.file(join(ctx.store, "index/pacman.json")).json().catch(() => undefined)) as { entries: IndexEntry[] } | undefined;
  const pkg = idx?.entries.find((e) => e.name === "bun-canary") ?? idx?.entries[0];
  if (!pkg) steps.push({ name: "package published", ok: false, ms: 0, log: "pacman index has no package" });
  else {
    const script = `set -eu
curl -fsS ${ctx.origin}/repo/os/aphrody.gpg -o /tmp/k.gpg
pacman-key --init >/dev/null 2>&1
pacman-key --populate archlinux >/dev/null 2>&1
FPR=$(gpg --show-keys --with-colons /tmp/k.gpg | awk -F: '/^fpr/{print $10; exit}')
pacman-key --add /tmp/k.gpg >/dev/null 2>&1
pacman-key --lsign-key "$FPR" >/dev/null 2>&1
printf '\n[aphrody]\nSigLevel = Required DatabaseRequired\nServer = ${ctx.origin}/repo/os/$arch\n' >> /etc/pacman.conf
pacman -Sy
pacman -S --noconfirm aphrody/${pkg.name}
pacman -Q ${pkg.name}
${pkg.name === "bun-canary" ? "bun --revision" : "true"}
`;
    await step(steps, `pacman -Sy && pacman -S ${pkg.name} (signed)`, () => docker(IMAGE, script, { timeout: 900_000 }));
  }
  return { format: "pacman", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image: IMAGE, steps };
}
