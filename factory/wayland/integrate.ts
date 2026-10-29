#!/usr/bin/env bun
/**
 * Applies factory/wayland/closure.json to the repository (idempotent):
 *  - shallow `update = none` submodules under vendor/wayland/<name> and vendor/hyprland/<name> (.gitmodules + gitlinks at the
 *    exact pinned commit, no checkout and no network)
 *  - one `submodule:` entry per mount in factory/bunos/components.json with dependsOn/consumedBy edges
 *  - PKGBUILD stubs (factory/wayland/pkgbuilds/<name>) for items the image needs at a pin that Arch does not ship
 *  - the opt-in Hyprland package list factory/images/bunos-hyprland/hyprland.packages
 *   bun factory/wayland/integrate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const closure = await Bun.file(join(root, "factory/wayland/closure.json")).json();
const items: any[] = closure.items;
const byId = new Map<string, any>(items.map(i => [i.id, i]));
const git = async (...a: string[]) => {
  const p = Bun.spawn(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [o, e, c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (c) throw new Error(`git ${a.join(" ")}: ${e}`);
  return o;
};

// ---- .gitmodules + gitlinks
let gm = await Bun.file(join(root, ".gitmodules")).text();
const have = new Map<string, string>();
for (const b of gm.split(/\[submodule /).slice(1)) {
  const p = b.match(/path\s*=\s*(.*)/)?.[1].trim(),
    u = b.match(/url\s*=\s*(.*)/)?.[1].trim();
  if (p && u) have.set(p, u);
}
const mounts = items.filter(i => i.mount);
let added = 0;
for (const it of mounts) {
  if (have.has(it.mount)) {
    if (have.get(it.mount) !== it.url)
      throw new Error(`${it.mount}: .gitmodules url ${have.get(it.mount)} != ${it.url}`);
  } else {
    gm =
      gm.replace(/\n*$/, "\n") +
      `[submodule "${it.mount}"]\n\tpath = ${it.mount}\n\turl = ${it.url}\n\tshallow = true\n\tupdate = none\n`;
    added++;
  }
}
await Bun.write(join(root, ".gitmodules"), gm);
for (const it of mounts) await git("update-index", "--add", "--cacheinfo", `160000,${it.sha},${it.mount}`);

// ---- components.json
const file = join(root, "factory/bunos/components.json");
const manifest = await Bun.file(file).json();
const idOf = (i: any) => `submodule:${i.mount}`;
const ours = new Set(mounts.map(idOf));
manifest.modules = manifest.modules.filter((m: any) => !ours.has(m.id));
for (const it of mounts) {
  const deps = [...it.depends, ...it.makedepends]
    .map(d => byId.get(d))
    .filter(d => d?.mount)
    .map(idOf);
  const consumedBy = ["file:factory/wayland/closure.json"];
  if (it.consumers.includes("wslg")) consumedBy.push("file:factory/wayland/wslg-deps.json");
  if (it.consumers.includes("bun-os")) consumedBy.push("file:factory/images/bunos-hyprland/hyprland.packages");
  manifest.modules.push({
    id: idOf(it),
    kind: "submodule",
    path: it.mount,
    source: { type: "submodule", url: it.url, pin: it.sha },
    registration: ["none"],
    aot: true,
    status: "present",
    dependsOn: [...new Set(deps)].sort(),
    consumedBy,
    note: `${it.name} ${it.tag ?? ""} (${it.date?.slice(0, 10) ?? ""}) ${it.buildSystem}; consumers ${it.consumers.join("+")}; factory/wayland/closure.json`,
  });
}
await Bun.write(file, JSON.stringify(manifest, null, 2) + "\n");

// ---- PKGBUILD stubs for image items that Arch ships at a different version (or not at all)
const archName = (i: any) => i.arch?.packages?.[0] ?? i.id;
const pkgOf = (d: string) =>
  d.startsWith("arch:") || d.startsWith("base:")
    ? d.slice(d.indexOf(":") + 1)
    : byId.get(d)
      ? archName(byId.get(d))
      : d;
const stubs = items.filter(
  i =>
    i.kind === "source" &&
    i.consumers.includes("bun-os") &&
    i.imageProvision &&
    !i.imageProvision.startsWith("pacman") &&
    i.id !== "hyprland-qtutils",
);
for (const it of stubs) {
  const dir = join(root, "factory/wayland/pkgbuilds", archName(it));
  mkdirSync(dir, { recursive: true });
  const deps = [
    ...new Set([...it.depends].filter((d: string) => !byId.get(d) || byId.get(d).kind !== "bundled").map(pkgOf)),
  ].sort();
  const mk = [...new Set(it.makedepends.map(pkgOf))].sort();
  const bs = it.buildSystem;
  const build =
    bs === "meson"
      ? `  arch-meson build "$_src"\n  meson compile -C build`
      : bs === "cmake"
        ? `  cmake -S "$_src" -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr\n  cmake --build build`
        : bs === "cargo"
          ? `  cd "$_src" && cargo build --release --locked`
          : `  echo "UNVERIFIED build system ${bs}" >&2; false`;
  const pack =
    bs === "meson"
      ? `  meson install -C build --destdir "$pkgdir"`
      : bs === "cmake"
        ? `  DESTDIR="$pkgdir" cmake --install build`
        : `  install -Dm755 "$_src/target/release/${it.id}" "$pkgdir/usr/bin/${it.id}"`;
  const ver = (it.version ?? "0").replace(/-/g, ".").replace(/^v/, "");
  writeFileSync(
    join(dir, "PKGBUILD"),
    `# STUB, UNVERIFIED (never built): ${it.name} ${it.tag} pinned to the exact commit of factory/wayland/closure.json.
# Replaces Arch ${it.arch?.version ?? "(not packaged)"} for the opt-in Hyprland composition; same package name, so the local repository must precede core/extra.
pkgname=${archName(it)}
pkgver=${ver}
pkgrel=1
_commit=${it.sha}
pkgdesc='${it.name} pinned by the Bun OS Wayland closure'
arch=(x86_64)
url='${it.url.replace(/\.git$/, "")}'
license=(custom)
depends=(${deps.map(d => `'${d}'`).join(" ")})
makedepends=(${[...new Set([...mk, bs === "meson" ? "meson" : bs === "cmake" ? "cmake" : "git", "ninja", "git"])].map(d => `'${d}'`).join(" ")})
source=("$pkgname::git+${it.url}#commit=$_commit")
sha256sums=('SKIP')

build() {
  _src="$srcdir/$pkgname"
${build}
}

package() {
  _src="$srcdir/$pkgname"
${pack}
}
`,
  );
}

// ---- opt-in composition package list
const hypr = items.filter(
  i => i.kind === "source" && i.compositions?.includes("hyprland") && i.consumers.includes("bun-os"),
);
const top = [
  "hyprland",
  "hyprland-guiutils",
  "xdg-desktop-portal-hyprland",
  "hyprlock",
  "hypridle",
  "hyprpaper",
  "hyprpicker",
  "hyprsunset",
  "hyprpolkitagent",
  "hyprshutdown",
  "xorg-xwayland",
  "xdg-desktop-portal",
  "xdg-desktop-portal-gtk",
  "polkit",
  "pipewire",
  "wireplumber",
  "mesa",
  "vulkan-icd-loader",
  "qt6-wayland",
  "qt6-base",
  "gtk4",
  "wayland-utils",
];
const stubNames = new Set(stubs.map(archName));
const lines = [
  "# OPT-IN Hyprland composition. NOT part of server, desktop (COSMIC) or gaming and never selected by default:",
  "# PLAN.md keeps Omarchy Hyprland blocked until a package subset, a signed closure and boot/session qualification exist.",
  "# Facts: these names exist in Arch core/extra on " +
    closure.computedAt +
    " (factory/wayland/closure.json); nothing here is built, booted or qualified.",
  "# Items marked (source) need a local PKGBUILD from factory/wayland/pkgbuilds (stubs, UNVERIFIED) because Arch ships a different version than the pin.",
  ...top.map(p => `${p}${stubNames.has(p) ? "   # (source) pinned, see factory/wayland/pkgbuilds/" + p : ""}`),
  ...[...stubNames]
    .filter(n => !top.includes(n) && hypr.some(h => archName(h) === n))
    .sort()
    .map(n => `${n}   # (source) pinned, see factory/wayland/pkgbuilds/${n}`),
  "",
];
mkdirSync(join(root, "factory/images/bunos-hyprland"), { recursive: true });
writeFileSync(join(root, "factory/images/bunos-hyprland/hyprland.packages"), lines.join("\n"));
console.log(
  JSON.stringify({ mounts: mounts.length, newGitmodules: added, stubs: stubs.map(archName), hyprPackages: top.length }),
);
