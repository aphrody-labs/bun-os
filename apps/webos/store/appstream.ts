// SPDX-License-Identifier: Apache-2.0
// AppStream catalog of the pacman repository `aphrody`, so native software centers (cosmic-store, GNOME Software,
// Discover) list Bun OS packages with their real names, summaries, icons and screenshots.
//   /repo/os/appstream/Components-x86_64.xml.gz   catalog (one <component> per metainfo file, with <pkgname>)
//   /repo/os/appstream/icons-{64x64,128x128}.tar.gz cached icons
//   /repo/os/appstream/media/                      screenshots and icons referenced by the catalog
//   aphrody-appstream-data (pacman package)        installs the catalog into /usr/share/swcatalog/{xml,icons}
// The catalog is composed with appstreamcli compose (Arch `appstream`) from the metainfo shipped inside each package;
// a package without metainfo is not a software-center component and is left out. Flatpak apps get their AppStream
// branch from flatpak.ts (compose + build-export --update-appstream).
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, readIndex, run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const IMAGE = "archlinux:latest";
const DATA_PKG = "aphrody-appstream-data";

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tagText = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? unescape(m[1]!.trim()) : undefined;
};

export async function build(ctx: Ctx): Promise<void> {
  const os = join(ctx.store, "repo/os");
  const work = join(ctx.store, ".work/appstream");
  const outDir = join(os, "appstream");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "media"), { recursive: true });

  // 1. Compose each package that ships metainfo.
  const compose = await docker(
    IMAGE,
    `set -eu
pacman -Sy --noconfirm --needed appstream libarchive >/dev/null 2>&1
mkdir -p /work/roots /work/out
: > /work/pkgs
for f in /os/x86_64/*.pkg.tar.zst; do
  [ -e "$f" ] || continue
  n=$(bsdtar -xOf "$f" .PKGINFO | awk -F' = ' '$1=="pkgname"{print $2; exit}')
  [ "$n" = ${DATA_PKG} ] && continue
  bsdtar -tf "$f" | grep -Eq '^usr/share/(metainfo|appdata)/.+\\.xml$' || continue
  mkdir -p "/work/roots/$n"
  bsdtar -xf "$f" -C "/work/roots/$n" usr/share
  if appstreamcli compose --no-net --origin=aphrody --prefix=/usr --result-root="/work/out/$n" \\
      --data-dir="/work/out/$n/xml" --icons-dir="/work/out/$n/icons" --hints-dir="/work/out/$n/hints" \\
      --media-dir=/work/media --media-baseurl=${ctx.origin}/repo/os/appstream/media --image-format=png \\
      "/work/roots/$n" > "/work/out/$n.log" 2>&1; then echo "$n" >> /work/pkgs; echo "composed $n"; else echo "COMPOSE FAILED $n"; tail -n 6 "/work/out/$n.log"; fi
done
chmod -R a+rwX /work`,
    { mounts: [`${work}:/work`, `${os}:/os:ro`], timeout: 1_200_000 },
  );
  console.log(tail(compose.out, 20));
  if (compose.code) throw new Error("AppStream compose failed");

  // 2. Merge into one catalog; each component names the pacman package that installs it.
  const pkgs = (await Bun.file(join(work, "pkgs")).text()).split("\n").filter(Boolean);
  const components: string[] = [];
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const sizes of ["64x64", "128x128"]) await mkdir(join(work, "icons", sizes), { recursive: true });
  for (const pkg of pkgs) {
    const file = join(work, "out", pkg, "xml", "aphrody.xml.gz");
    if (!(await Bun.file(file).exists())) {
      skipped.push({ name: pkg, reason: `compose produced no catalog: ${tail(await Bun.file(join(work, "out", `${pkg}.log`)).text().catch(() => ""), 3)}` });
      continue;
    }
    const xml = new TextDecoder().decode(Bun.gunzipSync(await Bun.file(file).bytes()));
    const found = xml.match(/<component[\s>][\s\S]*?<\/component>/g) ?? [];
    if (!found.length) skipped.push({ name: pkg, reason: "metainfo did not pass compose validation (see hints)" });
    for (const c of found) {
      const withPkg = c.includes("<pkgname>") ? c : c.replace(/(<component[^>]*>)/, `$1\n    <pkgname>${pkg}</pkgname>`);
      components.push(withPkg);
      const id = tagText(c, "id") ?? pkg;
      entries.push({
        name: id,
        version: pkg,
        desc: tagText(c, "summary") ?? "",
        license: tagText(c, "project_license"),
        homepage: /<url type="homepage">([^<]+)<\/url>/.exec(c)?.[1],
        meta: {
          pkgname: pkg,
          type: /<component type="([^"]+)"/.exec(c)?.[1] ?? "generic",
          display: tagText(c, "name"),
          icons: (c.match(/<icon type="cached"[^>]*>[^<]+<\/icon>/g) ?? []).length,
          screenshots: (c.match(/<screenshot[\s>]/g) ?? []).length,
        },
      });
    }
    for (const size of ["64x64", "128x128"]) {
      const src = join(work, "out", pkg, "icons", size);
      for (const icon of await readdir(src).catch(() => [] as string[])) await Bun.write(join(work, "icons", size, icon), Bun.file(join(src, icon)));
    }
  }
  const catalog = `<?xml version="1.0" encoding="utf-8"?>\n<components version="1.0" origin="aphrody">\n  ${components.join("\n  ")}\n</components>\n`;
  await Bun.write(join(outDir, "Components-x86_64.xml.gz"), Bun.gzipSync(new TextEncoder().encode(catalog)));
  for (const size of ["64x64", "128x128"]) await run(["tar", "-C", join(work, "icons", size), "-czf", join(outDir, `icons-${size}.tar.gz`), "."]);
  await run(["sh", "-c", `cp -r ${JSON.stringify(join(work, "media"))}/. ${JSON.stringify(join(outDir, "media"))}/ 2>/dev/null || true`]);

  // 3. Package the catalog for pacman clients (Arch layout /usr/share/swcatalog) and add it to the signed repository.
  const now = new Date();
  const pkgver = `${now.toISOString().slice(0, 10).replace(/-/g, "")}.${now.toISOString().slice(11, 16).replace(":", "")}`;
  await mkdir(join(work, "pkg"), { recursive: true });
  await Bun.write(
    join(work, "pkg/PKGBUILD"),
    `# SPDX-License-Identifier: Apache-2.0
# Generated by apps/webos/store/appstream.ts: AppStream catalog of the Bun OS pacman repository.
pkgname=${DATA_PKG}
pkgver=${pkgver}
pkgrel=1
pkgdesc='AppStream catalog of the Bun OS pacman repository (names, icons, screenshots for software centers)'
arch=(any)
url='${ctx.origin}/repo/os/appstream/'
license=(CC0-1.0)
options=(!strip !debug)

package() {
  install -Dm644 "$startdir/Components-x86_64.xml.gz" "$pkgdir/usr/share/swcatalog/xml/aphrody.xml.gz"
  for size in 64x64 128x128; do
    install -dm755 "$pkgdir/usr/share/swcatalog/icons/aphrody/$size"
    bsdtar -xf "$startdir/icons-$size.tar.gz" -C "$pkgdir/usr/share/swcatalog/icons/aphrody/$size"
  done
}
`,
  );
  for (const f of ["Components-x86_64.xml.gz", "icons-64x64.tar.gz", "icons-128x128.tar.gz"]) await Bun.write(join(work, "pkg", f), Bun.file(join(outDir, f)));
  const pack = await docker(
    IMAGE,
    `set -eu
pacman -Sy --noconfirm --needed base-devel gnupg >/dev/null 2>&1
export GNUPGHOME=/gnupg
FPR=$(gpg --list-secret-keys --with-colons aphrody-store | awk -F: '/^fpr/{print $10; exit}')
useradd -m builder 2>/dev/null || true
cp -r /work/pkg /home/builder/pkg && chown -R builder /home/builder/pkg
su builder -c "cd /home/builder/pkg && PKGDEST=/home/builder/out makepkg --nodeps --noconfirm -f" >/tmp/mk.log 2>&1 || { tail -n 20 /tmp/mk.log; exit 1; }
cd /os/x86_64
rm -f ${DATA_PKG}-*.pkg.tar.zst ${DATA_PKG}-*.pkg.tar.zst.sig
cp /home/builder/out/${DATA_PKG}-*.pkg.tar.zst .
f=$(ls ${DATA_PKG}-*.pkg.tar.zst)
gpg --batch --yes --detach-sign --no-armor --local-user "$FPR" "$f"
repo-add --sign --key "$FPR" aphrody.db.tar.zst "$f" >/dev/null
chmod -R a+rX /os
echo "added $f"`,
    { mounts: [`${work}:/work`, `${os}:/os`, `${join(ctx.secrets, "gnupg")}:/gnupg`], timeout: 900_000 },
  );
  console.log(tail(pack.out, 6));
  if (pack.code) throw new Error("aphrody-appstream-data packaging failed");
  await run(["chmod", "-R", "a+rX", outDir]);

  // The data package is part of the pacman repository: keep the pacman index in step.
  const pacman = await readIndex(ctx, "pacman");
  const dataFile = (await readdir(join(os, "x86_64"))).find((f) => f.startsWith(`${DATA_PKG}-`) && f.endsWith(".pkg.tar.zst"));
  if (pacman && dataFile) {
    pacman.entries = pacman.entries.filter((e) => e.name !== DATA_PKG);
    pacman.entries.push({
      name: DATA_PKG,
      version: `${pkgver}-1`,
      desc: "AppStream catalog of the Bun OS pacman repository (names, icons, screenshots for software centers)",
      license: "CC0-1.0",
      size: Bun.file(join(os, "x86_64", dataFile)).size,
      sha256: await sha256(join(os, "x86_64", dataFile)),
      file: `/repo/os/x86_64/${dataFile}`,
      homepage: `${ctx.origin}/repo/os/appstream/`,
      meta: { arch: "any", components: entries.length },
    });
    await writeIndex(ctx, pacman);
  }
  await writeIndex(ctx, { format: "appstream", generated: new Date().toISOString(), url: "/repo/os/appstream/Components-x86_64.xml.gz", entries, skipped });
  await rm(work, { recursive: true, force: true });
  console.log(`appstream: ${entries.length} components from ${pkgs.length} packages, ${skipped.length} skipped`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const index = await readIndex(ctx, "appstream");
  const pick = index?.entries.find((e) => e.name === "sh.bun.bun") ?? index?.entries[0];
  if (!pick) steps.push({ name: "catalog has components", ok: false, ms: 0, log: "appstream index is empty" });
  else {
    const term = String(pick.meta?.display ?? pick.name).split(/\s+/)[0]!;
    await step(steps, `pacman -S ${DATA_PKG} && appstreamcli search ${term} (container ${IMAGE})`, () =>
      docker(
        IMAGE,
        `set -eu
curl -fsS ${ctx.origin}/repo/os/aphrody.gpg -o /tmp/k.gpg
pacman-key --init >/dev/null 2>&1
pacman-key --populate archlinux >/dev/null 2>&1
FPR=$(gpg --show-keys --with-colons /tmp/k.gpg | awk -F: '/^fpr/{print $10; exit}')
pacman-key --add /tmp/k.gpg >/dev/null 2>&1 && pacman-key --lsign-key "$FPR" >/dev/null 2>&1
printf '\\n[aphrody]\\nSigLevel = Required DatabaseRequired\\nServer = ${ctx.origin}/repo/os/$arch\\n' >> /etc/pacman.conf
pacman -Sy --noconfirm --needed appstream aphrody/${DATA_PKG} >/dev/null
ls -l /usr/share/swcatalog/xml/aphrody.xml.gz
appstreamcli refresh-cache --force >/dev/null 2>&1 || true
appstreamcli search ${term} | grep -E 'Identifier|Name|Package|Icon' | head -20
appstreamcli get ${pick.name} | grep -q "Package: ${pick.meta?.pkgname}"
echo "icons in catalog: $(find /usr/share/swcatalog/icons/aphrody -name '*.png' | wc -l)"`,
        { timeout: 900_000 },
      ),
    );
  }
  // Flatpak: the remote's appstream branch names every app and carries its icons.
  await step(steps, "flatpak remote-ls aphrody shows names, appstream carries icons (container ubuntu:24.04)", () =>
    docker(
      "ubuntu:24.04",
      `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq flatpak ca-certificates >/dev/null
flatpak remote-add --system --if-not-exists aphrody ${ctx.origin}/repo/flatpak/aphrody.flatpakrepo
flatpak update --system --appstream aphrody >/dev/null 2>&1
flatpak remote-ls --system aphrody --app --columns=application,name,version
A=/var/lib/flatpak/appstream/aphrody/x86_64/active
test -f $A/icons/128x128/com.aphrody.WebOS.png
grep -c '<component' $A/appstream.xml
grep -q '<name>Aphrody Bun OS</name>' $A/appstream.xml
echo "flatpak icons: $(ls $A/icons/128x128 | wc -l)"`,
      { privileged: true, timeout: 900_000 },
    ),
  );
  return { format: "appstream", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image: IMAGE, steps };
}
