// SPDX-License-Identifier: Apache-2.0
// Pacman repository `aphrody` (libalpm layout /repo/os/x86_64/), built on the VPS from the factory PKGBUILDs inside an
// Arch Linux container. Packages and the database are signed with a key kept in the protected store (never served).
//
// PKGBUILDs whose source is this repository (git+…/bun-distribution, bun-os, src-tree) are built from the VPS checkout:
// the compile runs on the host first (Cargo through scripts/aphrody/build/rust/cargo-serial.sh with the shared target
// directory and sccache, at most four jobs; Bun builds with the host Bun), the outputs are staged as a tree that stands
// in for the git checkout, and makepkg in the container only runs package() of the unchanged PKGBUILD.
//   PACMAN_ONLY=bunos-utils,aphrody bun apps/webos/store/cli.ts build pacman    rebuild only these, keep the others
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { docker, run, sha256, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const IMAGE = "archlinux:latest";
/** Every PKGBUILD published to the repository. */
const BUILD = [
  "factory/usr/pkgs/bunos-filesystem",
  "factory/usr/pkgs/bun-canary",
  "factory/usr/pkgs/bunos-utils",
  "factory/bunos/pkgbuilds/material-design-icons-bunos",
  "factory/bunos/pkgbuilds/bun-os-fonts",
  "factory/bunos/pkgbuilds/bun-os-server",
  "factory/bunos/pkgbuilds/bun-os-webapps",
  "factory/bunos/pkgbuilds/bun-os-waydroid",
  "factory/bunos/pkgbuilds/aphrody",
  "factory/bunos/pkgbuilds/bun-engine",
  "factory/bunos/pkgbuilds/bun-os-spacedrive",
  // Emulators and the gaming session stack (factory/arch/emulators renders the upstream-binary ones; forks build from aphrody-labs).
  "factory/bunos/pkgbuilds/cemu",
  "factory/bunos/pkgbuilds/rpcs3",
  "factory/bunos/pkgbuilds/xemu",
  "factory/bunos/pkgbuilds/flycast",
  "factory/bunos/pkgbuilds/vita3k-bin",
  "factory/bunos/pkgbuilds/shadps4",
  "factory/bunos/pkgbuilds/melonds",
  "factory/bunos/pkgbuilds/azahar",
  "factory/bunos/pkgbuilds/bunos-retroarch",
  "factory/bunos/pkgbuilds/bunos-dolphin-emu",
  "factory/bunos/pkgbuilds/pcsx2",
  "factory/bunos/pkgbuilds/bunos-gamescope",
  "factory/bunos/pkgbuilds/gopher64",
  "factory/bunos/pkgbuilds/tetanes",
  "factory/bunos/pkgbuilds/bunos-dxvk",
  "factory/bunos/pkgbuilds/bunos-vkd3d-proton",
];

interface Prebuild {
  /** Compile on the host; throw with the real reason on failure. */
  compile(ctx: Ctx): Promise<void>;
  /** Files of the checkout the PKGBUILD's package() reads, copied below tree/<name>/ (name = the git source name). */
  tree: { name: string; files: (ctx: Ctx) => Promise<string[]> | string[]; extra?: (ctx: Ctx, dir: string) => Promise<void> };
}

const HOURS = 3_600_000;
/** The shared factory lease gives up after 30 minutes; a busy factory is waited for, up to eight times. */
async function serialized(cmd: string[], cwd: string, timeout: number, env: Record<string, string> = {}) {
  let r = { code: 1, out: "" };
  for (let attempt = 0; attempt < 8; attempt++) {
    r = await run(cmd, { cwd, timeout, env: { APHRODY_BUILD_HOST: "vps", APHRODY_CARGO_JOBS: "4", APHRODY_CARGO_LOCK_TIMEOUT_SECS: "10800", MAKEFLAGS: "-j4", ...env } });
    if (r.code === 0 || !/lease was not acquired|Timed out waiting|failed to get lock/i.test(r.out)) return r;
    console.log(`pacman: factory busy, waiting again (${attempt + 1}/8)`);
  }
  return r;
}
const cargoSerial = (ctx: Ctx, args: string[], timeout = 4 * HOURS) =>
  serialized(["bash", join(ctx.root, "scripts/aphrody/build/rust/cargo-serial.sh"), ...args], ctx.root, timeout);
async function must(label: string, r: Promise<{ code: number; out: string }>) {
  const x = await r;
  if (x.code !== 0) throw new Error(`${label}: ${tail(x.out, 6)}`);
}
const LICENSES = ["LICENSE", "LICENSE-APACHE"];

const PREBUILD: Record<string, Prebuild> = {
  "bunos-utils": {
    async compile(ctx) {
      const m = (await Bun.file(join(ctx.root, "factory/usr/manifest.json")).json()) as { multicall: { features: string[]; target: string } };
      await must("cargo build bunos-utils", cargoSerial(ctx, ["build", "--release", "--locked", "-p", "bunos-utils", "--target", m.multicall.target, "--features", m.multicall.features.join(",")]));
    },
    // package() installs $srcdir/target/x86_64-unknown-linux-gnu/release/bunos-utils.
    tree: { name: "target", files: () => ["target/x86_64-unknown-linux-gnu/release/bunos-utils"] },
  },
  aphrody: {
    compile: (ctx) => must("cargo build aphrody", cargoSerial(ctx, ["build", "--release", "--locked", "-p", "aphrody"])),
    tree: { name: "bun-os", files: () => ["target/release/aphrody", "crates/aphrody/Cargo.toml", ...LICENSES] },
  },
  "bun-os-waydroid": {
    compile: (ctx) => must("cargo build bun-waydroid", cargoSerial(ctx, ["build", "--release", "--locked", "-p", "bun-waydroid", "--bin", "bun-waydroid"])),
    tree: {
      name: "bun-os",
      files: () => ["target/release/bun-waydroid", "packages/waydroid/src", "packages/waydroid/package.json", "factory/wsl/kernel/wsl-android.config", "crates/bun-waydroid/LICENSE", "docs/android/PROVENANCE.md"],
    },
  },
  "bun-os-server": {
    compile: (ctx) => must("bun-app-host build", run(["bun", "packages/bun-app-host/src/build.ts", "build"], { cwd: ctx.root, timeout: HOURS })),
    tree: { name: "bun-os", files: () => ["build/apps/bun-os-server", ...LICENSES] },
  },
  "bun-os-webapps": {
    async compile(ctx) {
      const { apps } = (await Bun.file(join(ctx.root, "factory/bunos/webapps.json")).json()) as { apps: { id: string; path: string; build: string }[] };
      for (const app of apps) await must(`${app.id} build`, run(["bun", "run", app.build], { cwd: join(ctx.root, app.path), timeout: HOURS }));
    },
    tree: {
      name: "bun-os",
      async files(ctx) {
        const { apps } = (await Bun.file(join(ctx.root, "factory/bunos/webapps.json")).json()) as { apps: { path: string; dist: string }[] };
        return ["factory/bunos/webapps.json", ...apps.map((a) => `${a.path}/${a.dist}`), ...LICENSES];
      },
    },
  },
  "bun-engine": {
    async compile(ctx) {
      await must("cargo build bun-engine", cargoSerial(ctx, ["build", "--release", "--locked", "-p", "bun-engine", "--bin", "bun-engine"]));
      // libretroarch.so is built in a copy: vendor/retroarch is a shared checkout another owner works in.
      const copy = join(ctx.store, ".work/retroarch");
      await must("copy retroarch", run(["bash", "-c", 'mkdir -p "$2" && rsync -a --delete --exclude .git "$1/" "$2/"', "_", join(ctx.root, "vendor/retroarch"), copy], { timeout: HOURS }));
      const flags = "--enable-libretroarch --enable-egl --disable-qt --disable-x11 --disable-wayland --disable-kms --disable-opengl --disable-vulkan --disable-sdl2 --disable-sdl3 --disable-pulse --disable-alsa --disable-jack --disable-oss --disable-pipewire --disable-ffmpeg --disable-udev --disable-materialui --disable-xmb --disable-ozone";
      // Built in the Arch container so libretroarch.so links against the target's libraries.
      await must(
        "libretroarch",
        docker(IMAGE, `set -e; pacman -Syu --noconfirm --needed base-devel mesa pkgconf >/dev/null; cd /ra; [ -f libretroarch.so ] && [ libretroarch.so -nt Makefile ] || { ./configure ${flags} >/dev/null && make -j4 >/dev/null; }; test -f libretroarch.so`, {
          mounts: [`${copy}:/ra`],
          timeout: 2 * HOURS,
        }),
      );
    },
    tree: {
      name: "bun-os",
      files: () => [
        "target/release/bun-engine",
        "packages/bun-engine/src",
        "packages/bun-engine/plugins",
        "packages/bun-engine/package.json",
        "factory/bunos/pkgbuilds/bun-engine/bunos-gamescope-session",
        "factory/bunos/pkgbuilds/bun-engine/bunos-gamescope.desktop",
        "vendor/retroarch/COPYING",
        "crates/bun-engine-core/LICENSE",
        "crates/bun-engine-core/DUST-PROVENANCE.md",
      ],
      async extra(ctx, dir) {
        await cp(join(ctx.store, ".work/retroarch/libretroarch.so"), join(dir, "vendor/retroarch/libretroarch.so"));
      },
    },
  },
  "bun-os-spacedrive": {
    async compile(ctx) {
      // The aphrody-labs/spacedrive fork is not a checkout of this repository: fetch the pinned commit once.
      const pkgbuild = await Bun.file(join(ctx.root, "factory/bunos/pkgbuilds/bun-os-spacedrive/PKGBUILD")).text();
      const commit = /_commit=([0-9a-f]{40})/.exec(pkgbuild)?.[1];
      if (!commit) throw new Error("PKGBUILD has no pinned commit");
      const dir = join(ctx.store, ".work/spacedrive");
      await must(
        "fetch spacedrive",
        run(["bash", "-c", 'set -e; mkdir -p "$1"; cd "$1"; [ -d .git ] || git init -q; git remote add origin https://github.com/aphrody-labs/spacedrive.git 2>/dev/null || true; git fetch -q --depth 1 origin "$2"; git checkout -q --force FETCH_HEAD', "_", dir, commit], { timeout: HOURS }),
      );
      await must("spacedrive bun install", run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: dir, timeout: HOURS }));
      await must("spacedrive web build", run(["bun", "run", "build"], { cwd: join(dir, "apps/web"), timeout: HOURS }));
      await must(
        "cargo build spacedrive",
        serialized(
          ["bash", join(ctx.root, "scripts/aphrody/build/rust/cargo-serial.sh"), "build", "--release", "--locked", "-p", "sd-server", "-p", "sd-cli", "-p", "sd-core", "--bin", "sd-server", "--bin", "sd-daemon", "--bin", "sd"],
          dir,
          6 * HOURS,
          { CARGO_TARGET_DIR: join(dir, "target") },
        ),
      );
    },
    tree: {
      name: "spacedrive",
      files: () => [],
      async extra(ctx, dir) {
        const src = join(ctx.store, ".work/spacedrive");
        for (const f of ["target/release/sd-server", "target/release/sd-daemon", "target/release/sd", "LICENSE", "NOTICE"]) {
          await mkdir(dirname(join(dir, f)), { recursive: true });
          await cp(join(src, f), join(dir, f));
        }
      },
    },
  },
};

// Appended to the work copy of a prebuilt PKGBUILD: drop the git source (the staged tree replaces it), link the tree
// into $srcdir, and skip build()/check() (the compile already ran on the host). package() is the PKGBUILD's own.
const OVERRIDE = `
_s=(); _h=()
for _i in "\${!source[@]}"; do [[ \${source[$_i]} == *git+* ]] && continue; _s+=("\${source[$_i]}"); _h+=("\${sha256sums[$_i]:-SKIP}"); done
source=("\${_s[@]}"); sha256sums=("\${_h[@]}")
prepare() { for _x in "$startdir"/tree/*; do ln -sfn "$_x" "$srcdir/\${_x##*/}"; done; }
build() { :; }
check() { :; }
`;

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
  const only = Bun.env.PACMAN_ONLY?.split(",").filter(Boolean);
  const dirs = BUILD.filter((d) => !only || only.includes(d.split("/").pop()!));
  const work = join(ctx.store, ".work/pacman");
  await rm(work, { recursive: true, force: true });
  await mkdir(join(work, "src"), { recursive: true });
  const failures = new Map<string, string>();
  const names: string[] = [];
  for (const dir of dirs) {
    const name = dir.split("/").pop()!;
    const dest = join(work, "src", name);
    await cp(join(ctx.root, dir), dest, { recursive: true });
    const pre = PREBUILD[name];
    if (pre) {
      const t = Date.now();
      try {
        console.log(`pacman: compiling ${name} on the host`);
        await pre.compile(ctx);
        const tree = join(dest, "tree", pre.tree.name);
        await mkdir(tree, { recursive: true });
        for (const f of await pre.tree.files(ctx)) {
          await mkdir(dirname(join(tree, f)), { recursive: true });
          await cp(join(ctx.root, f), join(tree, f), { recursive: true, dereference: true });
        }
        await pre.tree.extra?.(ctx, tree);
        await Bun.write(join(dest, "PKGBUILD"), (await Bun.file(join(dest, "PKGBUILD")).text()) + OVERRIDE);
        console.log(`pacman: ${name} compiled in ${Math.round((Date.now() - t) / 1000)} s`);
      } catch (error) {
        failures.set(name, String((error as Error).message ?? error).slice(0, 400));
        console.log(`pacman: ${name} failed: ${failures.get(name)}`);
        await rm(dest, { recursive: true, force: true });
        continue;
      }
    }
    names.push(name);
  }
  const bun = Bun.which("bun") ?? join(Bun.env.HOME ?? "", ".local/bin/bun");
  const script = `set -eu
pacman -Syu --noconfirm --needed base-devel git gnupg rsync >/dev/null
export GNUPGHOME=/gnupg
if ! gpg --list-secret-keys aphrody-store >/dev/null 2>&1; then
  gpg --batch --passphrase '' --quick-gen-key 'aphrody-store <contact@aphrody.com>' rsa3072 sign never >/dev/null 2>&1
fi
FPR=$(gpg --list-secret-keys --with-colons aphrody-store | awk -F: '/^fpr/{print $10; exit}')
gpg --export "$FPR" > /os/aphrody.gpg
useradd -m builder 2>/dev/null || true
cp -r /work/src /home/builder/src && chown -R builder /home/builder/src
mkdir -p /home/builder/pkgs && chown builder /home/builder/pkgs
for p in ${names.join(" ")}; do
  echo "== $p"
  if su builder -c "cd /home/builder/src/$p && PKGDEST=/home/builder/pkgs MAKEFLAGS=-j4 makepkg --nodeps --noconfirm --clean -f" >/tmp/$p.log 2>&1; then echo "BUILT $p"; else echo "FAILED $p"; tail -n 5 /tmp/$p.log; fi
done
cd /os/x86_64
# Replace the older files of every rebuilt package, keep the packages this run did not build.
for f in /home/builder/pkgs/*.pkg.tar.zst; do
  [ -e "$f" ] || continue
  n=$(bsdtar -xOf "$f" .PKGINFO | awk -F' = ' '$1=="pkgname"{print $2; exit}')
  for old in *.pkg.tar.zst; do
    [ -e "$old" ] || continue
    on=$(bsdtar -xOf "$old" .PKGINFO | awk -F' = ' '$1=="pkgname"{print $2; exit}')
    [ "$on" = "$n" ] && rm -f "$old" "$old.sig"
  done
  cp "$f" .
  gpg --batch --yes --detach-sign --no-armor --local-user "$FPR" "$(basename "$f")"
done
rm -f aphrody.db* aphrody.files*
repo-add --sign --key "$FPR" aphrody.db.tar.zst *.pkg.tar.zst >/dev/null
chmod -R a+rX /os
`;
  const r = await docker(IMAGE, script, {
    mounts: [`${work}:/work`, `${join(ctx.store, "repo/os")}:/os`, `${keyDir(ctx)}:/gnupg`, `${bun}:/usr/local/bin/bun:ro`],
    timeout: 3 * HOURS,
  });
  console.log(tail(r.out, 40));
  if (r.code) throw new Error("pacman build failed");
  for (const m of r.out.matchAll(/^FAILED (\S+)\n([\s\S]*?)(?=^== |^BUILT |\s*$)/gm)) failures.set(m[1]!, `makepkg failed: ${m[2]!.trim().split("\n").slice(-3).join(" ")}`);
  const entries: IndexEntry[] = [];
  for (const f of (await readdir(out)).filter((n) => n.endsWith(".pkg.tar.zst")).sort()) {
    const i = await pkginfo(join(out, f));
    entries.push({
      name: i.pkgname!,
      version: i.pkgver!,
      desc: i.pkgdesc ?? "",
      license: i.license,
      size: Number(i.size ?? 0),
      sha256: await sha256(join(out, f)),
      file: `/repo/os/x86_64/${f}`,
      homepage: i.url,
      member: BUILD.find((d) => d.endsWith(`/${i.pkgname}`)),
      meta: { arch: i.arch, depends: [] },
    });
  }
  const published = new Set(entries.map((e) => e.name));
  const skipped = BUILD.map((d) => d.split("/").pop()!)
    .filter((n) => !published.has(n))
    .map((name) => ({ name, reason: failures.get(name) ?? "not built yet" }));
  await writeIndex(ctx, { format: "pacman", generated: new Date().toISOString(), url: "/repo/os/$arch", entries, skipped });
  await rm(work, { recursive: true, force: true });
  console.log(`pacman: ${entries.length} published, ${skipped.length} not published`);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const idx = (await Bun.file(join(ctx.store, "index/pacman.json")).json().catch(() => undefined)) as { entries: IndexEntry[] } | undefined;
  // Install the runtime and the multicall utilities: one prebuilt Rust package, one upstream binary package.
  const picks = ["bun-canary", "bunos-utils"].filter((n) => idx?.entries.some((e) => e.name === n));
  if (!picks.length && idx?.entries[0]) picks.push(idx.entries[0].name);
  if (!picks.length) steps.push({ name: "package published", ok: false, ms: 0, log: "pacman index has no package" });
  else {
    const checks: Record<string, string> = { "bun-canary": "bun --revision", "bunos-utils": "bunos-utils ls / >/dev/null && bunos-utils echo bunos-utils-ok" };
    const script = `set -eu
curl -fsS ${ctx.origin}/repo/os/aphrody.gpg -o /tmp/k.gpg
pacman-key --init >/dev/null 2>&1
pacman-key --populate archlinux >/dev/null 2>&1
FPR=$(gpg --show-keys --with-colons /tmp/k.gpg | awk -F: '/^fpr/{print $10; exit}')
pacman-key --add /tmp/k.gpg >/dev/null 2>&1
pacman-key --lsign-key "$FPR" >/dev/null 2>&1
printf '\\n[aphrody]\\nSigLevel = Required DatabaseRequired\\nServer = ${ctx.origin}/repo/os/$arch\\n' >> /etc/pacman.conf
pacman -Sy
pacman -S --noconfirm ${picks.map((p) => `aphrody/${p}`).join(" ")}
pacman -Q ${picks.join(" ")}
${picks.map((p) => checks[p] ?? "true").join("\n")}
`;
    await step(steps, `pacman -Sy && pacman -S ${picks.join(" ")} (signed)`, () => docker(IMAGE, script, { timeout: 900_000 }));
  }
  return { format: "pacman", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image: IMAGE, steps };
}
