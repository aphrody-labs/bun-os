#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Build the ChromiumOS minijail sandbox (aphrody-labs/minijail fork, BSD-3-Clause) as a .deb for the
// unified Bun OS image (factory/images/bunos-unified installs every deb in ~/native-apps/debs).
// The build runs inside ubuntu:26.04 so the binaries match the image's glibc.
//   bun factory/chromiumos/minijail-deb.ts [revision]     default revision: pinned below
import { mkdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const rev = process.argv[2] ?? "8787d1a4fdd7c64791607a1122d2408b3b35ade4";
const out = process.env.BUNOS_DEB_DIR ?? join(homedir(), "native-apps", "debs");
mkdirSync(out, { recursive: true });
const { uid, gid } = userInfo();

// Runs inside the container (Ubuntu userland), not on the dev host.
const inContainer = String.raw`
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates git build-essential libcap-dev pkg-config >/dev/null
git clone -q https://github.com/aphrody-labs/minijail.git /src/minijail
cd /src/minijail
git checkout -q "$REV"
make -j4 LIBDIR=/usr/lib/x86_64-linux-gnu all >/dev/null
ver="0~git$(git log -1 --format=%cd --date=format:%Y%m%d).$(git rev-parse --short=12 HEAD)"
pkg=/tmp/pkg
lib=$pkg/usr/lib/x86_64-linux-gnu
install -Dm0755 minijail0 $pkg/usr/bin/minijail0
install -Dm0755 libminijail.so $lib/libminijail.so
install -Dm0755 libminijailpreload.so $lib/libminijailpreload.so
install -Dm0644 libminijail.h $pkg/usr/include/libminijail.h
install -Dm0644 scoped_minijail.h $pkg/usr/include/scoped_minijail.h
install -Dm0644 minijail0.1 $pkg/usr/share/man/man1/minijail0.1
install -Dm0644 minijail0.5 $pkg/usr/share/man/man5/minijail0.5
install -Dm0644 LICENSE $pkg/usr/share/doc/minijail/copyright
install -Dm0644 NOTICE $pkg/usr/share/doc/minijail/NOTICE
mkdir -p $pkg/DEBIAN
printf '%s\n' "Package: bunos-minijail" "Version: $ver" "Architecture: amd64" \
  "Maintainer: aphrody-dev <contact@aphrody.com>" "Depends: libc6, libcap2" "Provides: minijail" \
  "Section: admin" "Priority: optional" "Homepage: https://github.com/aphrody-labs/minijail" \
  "Description: ChromiumOS minijail sandboxing tool and library (Bun OS build)" \
  " minijail0 and libminijail from the aphrody-labs fork of chromiumos/minijail, BSD-3-Clause." > $pkg/DEBIAN/control
deb=/out/bunos-minijail_"$ver"_amd64.deb
dpkg-deb --root-owner-group --build $pkg $deb >/dev/null
chown "$HOST_UID:$HOST_GID" $deb
echo $deb
`;

const proc = Bun.spawn(
  ["docker", "run", "--rm", "-i", "-e", `REV=${rev}`, "-e", `HOST_UID=${uid}`, "-e", `HOST_GID=${gid}`,
    "-v", `${out}:/out`, "ubuntu:26.04", "sh", "-eu"],
  { stdin: new Blob([inContainer]), stdout: "inherit", stderr: "inherit" },
);
process.exit(await proc.exited);
