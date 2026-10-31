#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Emulator .debs of the unified Bun OS image (Ubuntu 26.04 + Pop resolute), built from the aphrody-labs forks pinned
// by their pacman PKGBUILDs (factory/bunos/pkgbuilds) inside the native-apps builder (builder.Dockerfile, ubuntu:26.04),
// into <work>/debs/index.tsv, which the apt feed publishes (factory/native-apps/build.ts publish).
//
//   bun factory/native-apps/emulators.ts [name...]             run the builder container (default: every emulator)
//   bun factory/native-apps/emulators.ts --in-builder [name...] build inside the container
import { $ } from "bun";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const HOME = Bun.env.HOME ?? "/home/ubuntu";
const ROOT = Bun.env.BUNOS_NATIVE_ROOT ?? join(HOME, "src/bun-os");
const WORK = Bun.env.BUNOS_NATIVE_WORK ?? join(HOME, "native-apps");
const DEBS = join(WORK, "debs");
const JOBS = "4";
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function install(source: string, target: string, mode = 0o644) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  await chmod(target, mode);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function isElf(path: string) {
  const head = new Uint8Array(await Bun.file(path).slice(0, 4).arrayBuffer());
  return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
}

/** Package a staged /usr tree; Depends from dpkg-shlibdeps plus the given run-time libraries. */
async function deb(name: string, version: string, stage: string, description: string, extra = "", recommends = "") {
  const elfs: string[] = [];
  for (const file of await walk(stage)) if ((await stat(file)).mode & 0o100 && (await isElf(file))) elfs.push(file);
  let depends = "";
  if (elfs.length) {
    const tmp = join(WORK, `shlibs-${process.pid}`);
    await mkdir(join(tmp, "debian"), { recursive: true });
    await Bun.write(join(tmp, "debian/control"), `Source: ${name}\n\nPackage: ${name}\nArchitecture: amd64\n`);
    const out = await $`dpkg-shlibdeps -O --ignore-missing-info -l${join(stage, "usr/lib")} ${elfs}`.cwd(tmp).quiet().nothrow();
    depends = /^shlibs:Depends=(.*)$/m.exec(out.stdout.toString())?.[1] ?? "";
    await rm(tmp, { recursive: true, force: true });
  }
  if (extra) depends = depends ? `${depends}, ${extra}` : extra;
  await mkdir(join(stage, "DEBIAN"), { recursive: true });
  await Bun.write(
    join(stage, "DEBIAN/control"),
    [
      `Package: ${name}`,
      `Version: ${version}`,
      "Architecture: amd64",
      "Maintainer: aphrody-dev <contact@aphrody.com>",
      ...(depends ? [`Depends: ${depends}`] : []),
      ...(recommends ? [`Recommends: ${recommends}`] : []),
      "Section: x11",
      "Priority: optional",
      "Homepage: https://aphrody.com",
      `Description: ${description}`,
      " Built for Bun OS from the aphrody-labs fork.",
      "",
    ].join("\n"),
  );
  const file = `${name}_${version}_amd64.deb`;
  const target = join(DEBS, file);
  await $`dpkg-deb --root-owner-group -Zxz --build ${stage} ${target}`.quiet();
  const sum = new Bun.CryptoHasher("sha256").update(await Bun.file(target).arrayBuffer()).digest("hex");
  const index = join(DEBS, "index.tsv");
  const previous = (await Bun.file(index).exists()) ? await Bun.file(index).text() : "";
  await Bun.write(index, `${previous}${name}\t${version}\t${file}\t${sum}\n`);
  log(`packaged ${target}`);
}

async function clone(dir: string, repo: string, rev?: string) {
  // A builder killed mid-checkout leaves index.lock behind; each source tree has a single lane, so it is stale.
  await rm(join(dir, ".git/index.lock"), { force: true });
  if (!existsSync(join(dir, ".git"))) await $`git clone --filter=blob:none https://github.com/aphrody-labs/${repo} ${dir}`;
  if (rev) {
    const known = await $`git -C ${dir} cat-file -e ${rev}^{commit}`.quiet().nothrow();
    if (known.exitCode !== 0) await $`git -C ${dir} fetch -q origin`;
    await $`git -C ${dir} checkout -q ${rev}`;
  }
}

const shortRev = async (dir: string) => (await $`git -C ${dir} rev-parse --short HEAD`.text()).trim();

async function stageDir(name: string) {
  const dir = join(WORK, "stage", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Emulators of the Bun OS desktop session, from the aphrody-labs forks at the commits pinned by their pacman PKGBUILDs
 * (factory/bunos/pkgbuilds/<pkg>, the single pin source for Arch and Ubuntu). Each upstream cmake/make install provides
 * the desktop entry, icons and AppStream metainfo; console BIOS, firmware and keys are never shipped.
 */
const EMULATORS: Record<string, { repo: string; pkgbuild: string; deps: string[]; build: (d: string, s: string) => Promise<void>; description: string }> = {
  melonds: {
    repo: "melonds",
    pkgbuild: "melonds",
    deps: ["qt6-base-dev", "qt6-multimedia-dev", "qt6-svg-dev", "qt6-wayland", "libsdl2-dev", "libarchive-dev", "libenet-dev", "libzstd-dev", "libslirp-dev", "libfaad-dev", "extra-cmake-modules", "ninja-build"],
    description: "melonDS Nintendo DS emulator",
    async build(d, s) {
      await $`cmake -S ${d} -B ${d}/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DUSE_QT6=ON`;
      await $`cmake --build ${d}/build -j ${JOBS}`;
      await $`cmake --install ${d}/build`.env({ ...Bun.env, DESTDIR: s });
    },
  },
  azahar: {
    repo: "azahar",
    pkgbuild: "azahar",
    deps: ["qt6-base-dev", "qt6-base-private-dev", "qt6-multimedia-dev", "qt6-tools-dev", "qt6-wayland", "libsdl2-dev", "libusb-1.0-0-dev", "ninja-build"],
    description: "Azahar Nintendo 3DS emulator (no console keys)",
    async build(d, s) {
      await $`git -C ${d} submodule update --init --recursive --depth 1`;
      // FFmpeg off: Azahar requires FFmpeg 7 exactly; it only drives the AAC fallback and the video dumper.
      await $`cmake -S ${d} -B ${d}/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DENABLE_TESTS=OFF -DENABLE_ROOM=OFF -DUSE_DISCORD_PRESENCE=OFF -DENABLE_BUILTIN_KEYBLOB=OFF -DENABLE_QT_UPDATER=OFF -DENABLE_FFMPEG=OFF`;
      await $`cmake --build ${d}/build -j ${JOBS}`;
      await $`cmake --install ${d}/build`.env({ ...Bun.env, DESTDIR: s });
    },
  },
  "dolphin-emu": {
    repo: "dolphin",
    pkgbuild: "bunos-dolphin-emu",
    deps: ["qt6-base-dev", "qt6-base-private-dev", "qt6-svg-dev", "libsdl3-dev", "libevdev-dev", "libudev-dev", "libbluetooth-dev", "libhidapi-dev", "libusb-1.0-0-dev", "libasound2-dev", "libpulse-dev", "libsystemd-dev", "ninja-build"],
    description: "Dolphin GameCube and Wii emulator",
    async build(d, s) {
      await $`git -C ${d} submodule update --init --recursive --depth 1`;
      await $`cmake -S ${d} -B ${d}/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DDISTRIBUTOR=bun-os -DENABLE_TESTS=OFF -DENABLE_AUTOUPDATE=OFF`;
      await $`cmake --build ${d}/build -j ${JOBS}`;
      await $`cmake --install ${d}/build`.env({ ...Bun.env, DESTDIR: s });
    },
  },
  retroarch: {
    repo: "retroarch",
    pkgbuild: "bunos-retroarch",
    deps: ["libsdl2-dev", "libasound2-dev", "libpulse-dev", "libpipewire-0.3-dev", "libudev-dev", "libusb-1.0-0-dev", "libv4l-dev", "libxkbcommon-dev", "libwayland-dev", "wayland-protocols", "libvulkan-dev", "libgl-dev", "libegl-dev", "libgbm-dev", "libdrm-dev", "libfreetype-dev", "libfontconfig-dev", "zlib1g-dev", "libflac-dev", "libmbedtls-dev", "qt6-base-dev"],
    description: "RetroArch libretro frontend",
    async build(d, s) {
      await $`./configure --prefix=/usr --sysconfdir=/etc --disable-cg --disable-jack --disable-oss --enable-dbus`.cwd(d);
      await $`make -j ${JOBS}`.cwd(d);
      await $`make DESTDIR=${s} install`.cwd(d);
    },
  },
  pcsx2: {
    repo: "pcsx2",
    pkgbuild: "pcsx2",
    deps: ["qt6-base-dev", "qt6-base-private-dev", "qt6-svg-dev", "qt6-tools-dev", "qt6-wayland", "libsdl3-dev", "libaio-dev", "libpcap-dev", "libpng-dev", "libwebp-dev", "libzip-dev", "liblz4-dev", "libzstd-dev", "libshaderc-dev", "libsoundtouch-dev", "libcurl4-openssl-dev", "libplutosvg-dev", "lld", "llvm", "ninja-build", "extra-cmake-modules"],
    description: "PCSX2 PlayStation 2 emulator (no BIOS)",
    async build(d, s) {
      await $`git -C ${d} submodule update --init --recursive --depth 1`;
      await $`cmake -S ${d} -B ${d}/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DPACKAGE_MODE=ON -DWAYLAND_API=ON -DX11_API=ON`;
      await $`cmake --build ${d}/build -j ${JOBS}`;
      await $`cmake --install ${d}/build`.env({ ...Bun.env, DESTDIR: s });
    },
  },
};

async function emulators(names: string[]) {
  const failed: string[] = [];
  for (const name of names.length ? names : Object.keys(EMULATORS)) {
    const e = EMULATORS[name];
    if (!e) throw new Error(`unknown emulator ${name}`);
    try {
      const pkgbuild = await readFile(join(ROOT, "factory/bunos/pkgbuilds", e.pkgbuild, "PKGBUILD"), "utf8");
      const rev = /^_commit=([0-9a-f]{40})$/m.exec(pkgbuild)?.[1];
      const pkgver = /^pkgver=(\S+)$/m.exec(pkgbuild)?.[1] ?? "0";
      if (!rev) throw new Error(`no pinned _commit in ${e.pkgbuild}/PKGBUILD`);
      await $`apt-get update -qq`.quiet();
      await $`apt-get install -y -qq --no-install-recommends ${e.deps}`.env({ ...Bun.env, DEBIAN_FRONTEND: "noninteractive" }).quiet();
      const d = join(WORK, "src", e.repo);
      await clone(d, e.repo, rev);
      const s = await stageDir(name);
      log(`build ${name} ${rev}`);
      await e.build(d, s);
      for (const license of ["LICENSE", "COPYING", "license.txt", "LICENSE.txt"])
        if (existsSync(join(d, license))) {
          await install(join(d, license), join(s, `usr/share/doc/${name}/copyright`));
          break;
        }
      await deb(name, `${pkgver.replace(/\.r([0-9a-f]+)$/, "+bunos$1")}`, s, e.description);
    } catch (error) {
      log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      failed.push(name);
    }
  }
  if (failed.length) throw new Error(`failed: ${failed.join(" ")}`);
}


/** Same builder image and caches as the native-apps lanes; its own container name so lane cleanups leave it alone. */
async function container(names: string[]) {
  const image = "bunos-native-builder:26.04";
  await $`git -C ${ROOT} fetch -q origin main`;
  const exp = join(WORK, `emu-root-${process.pid}`);
  await rm(exp, { recursive: true, force: true });
  await mkdir(exp, { recursive: true });
  try {
    await $`git -C ${ROOT} archive origin/main factory/native-apps factory/bunos/pkgbuilds | tar -x -C ${exp}`;
    await $`docker build -q -t ${image} -f ${join(exp, "factory/native-apps/builder.Dockerfile")} ${join(exp, "factory/native-apps")}`.quiet();
    const proc = Bun.spawn(
      [
        "docker", "run", "--rm", "--cpus", "4", "--memory", "16g", "--name", `bunos-emu-builder-${process.pid}`,
        "-v", `${WORK}:/work`, "-v", `${exp}:/src/bun-os:ro`, "-v", `${join(HOME, ".local/bin/bun")}:/usr/local/bin/bun:ro`,
        "-e", "BUNOS_NATIVE_ROOT=/src/bun-os", "-e", "BUNOS_NATIVE_WORK=/work",
        "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*",
        image, "bun", "/src/bun-os/factory/native-apps/emulators.ts", "--in-builder", ...names,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`builder exited ${code}`);
  } finally {
    await rm(exp, { recursive: true, force: true });
  }
}

const argv = Bun.argv.slice(2);
await mkdir(join(WORK, "src"), { recursive: true });
await mkdir(DEBS, { recursive: true });
if (argv[0] === "--in-builder") await emulators(argv.slice(1));
else await container(argv);
