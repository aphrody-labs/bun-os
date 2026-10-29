import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containerPlan, hostLimits, planBuild, verifyOutput } from "../src/linux-target/build.ts";
import {
  buildOrder,
  closureProblems,
  loadClosures,
  resolveTarget,
  sysrootPackages,
  type Closure,
  type SourcePin,
} from "../src/linux-target/closure.ts";
import {
  cmakeToolchain,
  mesonCrossFile,
  parseTriple,
  pkgConfigEnv,
  targetFlags,
} from "../src/linux-target/crossfile.ts";
import {
  ArchIndex,
  archClosure,
  depKey,
  packageFromDesc,
  packageUrl,
  parseDesc,
} from "../src/linux-target/pacmandb.ts";
import { parsePc, pcFlags, splitRequires } from "../src/linux-target/pkgconfig.ts";
import { keepPath, resolveLink, shimHostTools, sysrootManifest } from "../src/linux-target/sysroot.ts";
import { untar } from "../src/linux-target/tar.ts";

const sha = "a".repeat(40);
const pin = (id: string, needs: string[] = [], extra: Partial<SourcePin> = {}): SourcePin => ({
  id,
  url: `https://example.org/${id}.git`,
  tag: "1.0",
  sha,
  date: "2026-01-01T00:00:00Z",
  build: "meson",
  needs,
  options: [],
  ...extra,
});

function ustar(entries: Array<{ name: string; data?: string; type?: string; link?: string }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const e of entries) {
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(enc.encode(s), at);
    const data = enc.encode(e.data ?? "");
    put(e.name, 0);
    put("0000644\0", 100);
    put(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h[156] = (e.type ?? "0").charCodeAt(0);
    put(e.link ?? "", 157);
    put("ustar\0", 257);
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  return Buffer.concat(chunks);
}

test("tar reader returns files, directories and symlinks", () => {
  const t = untar(
    ustar([
      { name: "usr/lib/", type: "5" },
      { name: "usr/lib/libx.so.1.2", data: "ELF" },
      { name: "usr/lib/libx.so", type: "2", link: "libx.so.1.2" },
    ]),
  );
  expect(t.map(e => [e.path, e.type])).toEqual([
    ["usr/lib", "dir"],
    ["usr/lib/libx.so.1.2", "file"],
    ["usr/lib/libx.so", "symlink"],
  ]);
  expect(new TextDecoder().decode(t[1]!.data)).toBe("ELF");
  expect(resolveLink(t[2]!)).toBe("usr/lib/libx.so.1.2");
  expect(resolveLink({ path: "usr/lib/a", link: "/usr/lib/b", type: "symlink" })).toBe("usr/lib/b");
});

test("sysroot keeps development files only unless full", () => {
  expect(keepPath("usr/include/glib-2.0/glib.h")).toBe(true);
  expect(keepPath("usr/lib/pkgconfig/gtk4.pc")).toBe(true);
  expect(keepPath("usr/share/man/man1/ls.1")).toBe(false);
  expect(keepPath("usr/bin/ls")).toBe(false);
  expect(keepPath("usr/bin/ls", true)).toBe(true);
  expect(keepPath(".PKGINFO", true)).toBe(false);
});

const desc = (name: string, ver: string, deps: string[], prov: string[] = [], make: string[] = []) =>
  `%FILENAME%\n${name}-${ver}-x86_64.pkg.tar.zst\n\n%NAME%\n${name}\n\n%VERSION%\n${ver}\n\n%CSIZE%\n100\n\n%ISIZE%\n400\n\n%SHA256SUM%\n${"b".repeat(64)}\n\n%ARCH%\nx86_64\n\n` +
  (deps.length ? `%DEPENDS%\n${deps.join("\n")}\n\n` : "") +
  (make.length ? `%MAKEDEPENDS%\n${make.join("\n")}\n\n` : "") +
  (prov.length ? `%PROVIDES%\n${prov.join("\n")}\n\n` : "");

const index = () =>
  new ArchIndex(
    [
      desc("gtk4", "1:4.24.1-1", ["glib2>=2.80", "libfoo.so"], [], ["meson", "sassc"]),
      desc("glib2", "2.90.1-1", ["glibc", "libffi.so"]),
      desc("glibc", "2.44-1", []),
      desc("libffi", "3.5-1", ["glibc"], ["libffi.so=8-64"]),
      desc("foo", "1-1", ["glibc"], ["libfoo.so=1-64"]),
      desc("meson", "1.9-1", []),
      desc("sassc", "3.6-1", []),
    ].map(d => packageFromDesc("extra", d)),
  );

test("desc parsing and dependency keys", () => {
  expect(parseDesc("%NAME%\nx\n\n%DEPENDS%\na\nb>=1\n").get("DEPENDS")).toEqual(["a", "b>=1"]);
  expect(depKey("glib2>=2.80")).toBe("glib2");
  expect(depKey("libfoo.so=1-64")).toBe("libfoo.so");
  expect(depKey("cmake: optional")).toBe("cmake");
});

test("closure follows provides, skips excluded host tools and makedepends of transitive packages", () => {
  const c = archClosure(index(), ["gtk4"], { rootMakedepends: true, exclude: ["meson"] });
  expect(c.packages.map(p => p.name)).toEqual(["foo", "glib2", "glibc", "gtk4", "libffi", "sassc"]);
  expect(c.unresolved).toEqual([]);
  const noMake = archClosure(index(), ["gtk4"]);
  expect(noMake.packages.map(p => p.name)).not.toContain("sassc");
  expect(archClosure(index(), ["missing-pkg"]).unresolved).toEqual(["missing-pkg"]);
});

test("sysroot manifest adds the toolchain roots and uses the right mirror per architecture", () => {
  const idx = new ArchIndex(
    ["glibc", "linux-api-headers", "gcc-libs", "gcc"]
      .map(n => packageFromDesc("core", desc(n, "1-1", [])))
      .concat(index().byName.get("glib2")!, index().byName.get("libffi")!),
  );
  const m = sysrootManifest(idx, "x86_64", ["glib2"]);
  expect(m.packages.map(p => p.name)).toEqual(["gcc", "gcc-libs", "glib2", "glibc", "libffi", "linux-api-headers"]);
  expect(m.packages[0]!.url).toBe("https://geo.mirror.pkgbuild.com/core/os/x86_64/gcc-1-1-x86_64.pkg.tar.zst");
  expect(m.totals).toEqual({ packages: 6, csize: 600, isize: 2400 });
  expect(sysrootManifest(idx, "aarch64", ["glib2"]).packages[0]!.url).toContain(
    "mirror.archlinuxarm.org/aarch64/core/",
  );
  expect(packageUrl({ repo: "extra", filename: "x.pkg.tar.zst", arch: "any" })).toContain("/extra/os/x86_64/x.pkg");
});

test("build order puts dependencies first and is deterministic", () => {
  const src = [
    pin("shell", ["mutter", "gjs"]),
    pin("mutter", ["gtk"]),
    pin("gjs", ["gtk"]),
    pin("gtk", []),
    pin("other", []),
  ];
  expect(buildOrder(src, ["shell"])).toEqual({ order: ["gtk", "gjs", "mutter", "shell"], cycle: [] });
  expect(buildOrder([pin("a", ["b"]), pin("b", ["a"])], ["a"]).cycle).toEqual(["a", "b"]);
  expect(buildOrder([pin("a", ["external"])], ["a"]).order).toEqual(["a"]);
});

const closure = (id: string, sources: SourcePin[], ext?: string[]): Closure => ({
  schemaVersion: 1,
  kind: "linux-desktop-closure",
  id,
  resolvedAt: "2026-10-29",
  release: {},
  sources,
  sysrootRoots: [],
  sysrootExclude: [],
  extends: ext,
  sysroot: {
    packages: [{ name: id + "-pkg", version: "1", repo: "extra", sha256: "c".repeat(64), csize: 1, isize: 2 }],
    unresolved: [],
    csize: 1,
    isize: 2,
  },
});

test("closure validation rejects short SHAs, unknown needs and cycles", () => {
  expect(closureProblems(closure("x", [pin("a")]))).toEqual([]);
  expect(closureProblems(closure("x", [pin("a", [], { sha: "abc" })]))[0]).toContain("40-hex");
  expect(closureProblems(closure("x", [pin("a", ["zzz"])]))[0]).toContain("unknown source zzz");
  expect(closureProblems(closure("x", [pin("a", ["b"]), pin("b", ["a"])])).join()).toContain("cycle");
  expect(closureProblems(closure("x", [pin("a", [], { date: "nope" })]))[0]).toContain("bad date");
});

test("targets resolve across extended closures", () => {
  const qt = closure("qt6", [pin("qtbase", [], { build: "cmake" })]);
  const plasma = closure("plasma", [pin("kwin", ["qtbase"], { build: "cmake" })], ["qt6"]);
  const map = new Map([
    ["qt6", qt],
    ["plasma", plasma],
  ]);
  const r = resolveTarget(map, "kwin")!;
  expect(r.order.map(o => `${o.closure}/${o.source.id}`)).toEqual(["qt6/qtbase", "plasma/kwin"]);
  expect(resolveTarget(map, "nope")).toBeUndefined();
  expect(sysrootPackages(map, "plasma").map(p => p.name)).toEqual(["plasma-pkg", "qt6-pkg"]);
});

test("triples", () => {
  expect(parseTriple("x86_64").llvm).toBe("x86_64-unknown-linux-gnu");
  expect(parseTriple("arm64").zig).toBe("aarch64-linux-gnu");
  expect(parseTriple("bun-linux-x64").arch).toBe("x86_64");
  expect(() => parseTriple("riscv64")).toThrow(/unsupported/);
});

test("meson cross file for clang + lld", () => {
  const f = mesonCrossFile({
    triple: parseTriple("aarch64"),
    sysroot: "C:\\sr",
    llvmBin: "C:\\llvm\\bin",
    gccInstallDir: "C:\\sr\\usr\\lib\\gcc\\x\\16",
  });
  expect(f).toContain("c = ['C:/llvm/bin/clang']");
  expect(f).toContain(
    "c_args = ['--target=aarch64-unknown-linux-gnu', '--sysroot=C:/sr', '--gcc-install-dir=C:/sr/usr/lib/gcc/x/16']",
  );
  expect(f).toContain("cpu_family = 'aarch64'");
  expect(f).toContain("system = 'linux'");
  expect(f).toContain("needs_exe_wrapper = true");
  expect(f).toContain("pkg_config_libdir = ['C:/sr/usr/lib/pkgconfig', 'C:/sr/usr/share/pkgconfig']");
  expect(f).toContain("'-fuse-ld=lld'");
  expect(
    mesonCrossFile({ triple: parseTriple("aarch64"), sysroot: "/sr", exeWrapper: ["qemu-aarch64", "-L", "/sr"] }),
  ).toContain("exe_wrapper = ['qemu-aarch64', '-L', '/sr']");
});

test("meson and cmake files for zig cc", () => {
  const o = { triple: parseTriple("x86_64"), sysroot: "/sr", compiler: "zig" as const };
  expect(mesonCrossFile(o)).toContain("c = ['zig', 'cc']");
  expect(targetFlags(o)).toEqual(["-target", "x86_64-linux-gnu", "--sysroot=/sr"]);
  const cm = cmakeToolchain(o);
  expect(cm).toContain('set(CMAKE_C_COMPILER "zig")');
  expect(cm).toContain('set(CMAKE_C_COMPILER_ARG1 "cc")');
});

test("cmake toolchain for clang", () => {
  const cm = cmakeToolchain({ triple: parseTriple("x86_64"), sysroot: "C:\\sr" });
  expect(cm).toContain("set(CMAKE_SYSTEM_NAME Linux)");
  expect(cm).toContain('set(CMAKE_SYSROOT "C:/sr")');
  expect(cm).toContain("set(CMAKE_C_COMPILER_TARGET x86_64-unknown-linux-gnu)");
  expect(cm).toContain("CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER");
  expect(pkgConfigEnv({ triple: parseTriple("x86_64"), sysroot: "C:\\sr" }, ";").PKG_CONFIG_LIBDIR).toBe(
    "C:/sr/usr/lib/pkgconfig;C:/sr/usr/share/pkgconfig",
  );
});

test("pkg-config files: variables, requires and sysroot prefixing", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-"));
  writeFileSync(
    join(dir, "a.pc"),
    "prefix=/usr\nincludedir=${prefix}/include\nName: a\nVersion: 1.2\nRequires: b >= 2, c\nLibs: -L${prefix}/lib -la\nCflags: -I${includedir}/a -DA=1\nLibs.private: -lm\n",
  );
  writeFileSync(join(dir, "b.pc"), "Name: b\nLibs: -lb\nCflags: -I/usr/include/b\n");
  writeFileSync(join(dir, "c.pc"), "Name: c\nLibs: -lc2\n");
  const pc = parsePc("a", "prefix=/usr\nName: a\nCflags: -I${prefix}/x\n");
  expect(pc.cflags).toBe("-I/usr/x");
  expect(splitRequires("b >= 2, c < 3 d")).toEqual(["b", "c", "d"]);
  const r = pcFlags(["a", "missing"], [dir], "C:\\sr");
  expect(r.cflags).toEqual(["-IC:/sr/usr/include/a", "-DA=1", "-IC:/sr/usr/include/b"]);
  expect(r.libs).toEqual(["-LC:/sr/usr/lib", "-la", "-lb", "-lc2"]);
  expect(r.missing).toEqual(["missing"]);
  expect(pcFlags(["a"], [dir], "/sr", { static: true }).libs).toContain("-lm");
  mkdirSync(join(dir, "x"));
});

test("meson build plan clones, verifies the pin, configures with a cross file and installs into a stage", () => {
  const plan = planBuild({
    source: pin("mutter", [], { options: ["-Dtests=disabled"], tag: "51.1" }),
    srcRoot: "/w/src",
    buildRoot: "/w/build",
    stage: "/w/stage",
    fileDir: "/w/cross",
    cross: { triple: parseTriple("x86_64"), sysroot: "/sr" },
  });
  expect(plan.steps[0]!.cmd).toEqual([
    "git",
    "clone",
    "--depth",
    "1",
    "--branch",
    "51.1",
    "https://example.org/mutter.git",
    "/w/src/mutter",
  ]);
  expect(plan.steps[1]!.expect).toBe(sha);
  expect(verifyOutput(plan.steps[1]!, sha + "\n")).toBe(true);
  expect(verifyOutput(plan.steps[1]!, "b".repeat(40))).toBe(false);
  const configure = plan.steps[2]!.cmd;
  expect(configure.slice(0, 4)).toEqual(["meson", "setup", "/w/build/mutter-x86_64", "/w/src/mutter"]);
  expect(configure).toContain("--cross-file");
  expect(configure).toContain("-Dtests=disabled");
  expect(plan.files.map(f => f.path)).toEqual(["/w/cross/meson-x86_64.ini", "/w/cross/meson-native.ini"]);
  expect(configure).toContain("--native-file");
  expect(plan.files[1]!.content).toContain("c = ['clang']");
  expect(plan.steps.at(-1)!.cmd).toEqual([
    "meson",
    "install",
    "-C",
    "/w/build/mutter-x86_64",
    "--destdir",
    "/w/stage",
    "--no-rebuild",
  ]);
});

test("cmake build plan passes the toolchain, host Qt and KF6 host tooling", () => {
  const plan = planBuild({
    source: pin("kwin", [], { build: "cmake", options: ["-DBUILD_TESTING=OFF"] }),
    srcRoot: "/w/src",
    buildRoot: "/w/build",
    stage: "/w/stage",
    fileDir: "/w/cross",
    cross: { triple: parseTriple("aarch64"), sysroot: "/sr" },
    qtHostPath: "/host/qt",
    kf6HostTooling: "/host/kf6",
    jobs: 8,
  });
  const cfg = plan.steps[2]!.cmd;
  expect(cfg).toContain("-DCMAKE_TOOLCHAIN_FILE=/w/cross/toolchain-aarch64.cmake");
  expect(cfg).toContain("-DQT_HOST_PATH=/host/qt");
  expect(cfg).toContain("-DKF6_HOST_TOOLING=/host/kf6");
  expect(plan.steps[3]!.cmd).toEqual(["cmake", "--build", "/w/build/kwin-aarch64", "-j", "8"]);
  expect(plan.steps[4]!.env?.DESTDIR).toBe("/w/stage");
});

test("host-run limits only apply when target code cannot run on the host", () => {
  const s = pin("gnome-shell", [], { hostRun: ["g-ir-scanner runs target code"] });
  expect(hostLimits(s, false, "x86_64", "x86_64")).toEqual(["host-run: g-ir-scanner runs target code"]);
  expect(hostLimits(s, true, "x86_64", "x86_64")).toEqual([]);
  expect(hostLimits(s, true, "aarch64", "x86_64")).toHaveLength(1);
  expect(hostLimits(pin("x"), false, "x86_64", "x86_64")).toEqual([]);
});

test("container plan installs packages inside the container only", () => {
  const [step] = containerPlan(closure("gnome", [pin("a")]), "a", "podman");
  expect(step!.cmd.slice(0, 3)).toEqual(["podman", "run", "--rm"]);
  expect(step!.cmd.at(-1)).toContain("pacman -S --noconfirm --needed gnome-pkg");
  expect(step!.cmd.at(-1)).toContain("linux build a --run");
  expect(step!.cmd.at(-1)).toContain("npm install -g --allow-scripts=bun bun@1.4.4-canary.20261028.1");
  expect(step!.cmd).toContain("/abs:/work".replace("/abs", "."));
});

const dir = new URL("../../../factory/linux-desktop", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("the committed closure files are valid, pinned to full SHAs and ordered", () => {
  const closures = loadClosures(dir);
  expect([...closures.keys()].sort()).toEqual(["gnome", "plasma", "qt6"]);
  for (const c of closures.values()) {
    expect(closureProblems(c)).toEqual([]);
    expect(c.sysroot.unresolved).toEqual([]);
    expect(c.sysroot.packages.length).toBeGreaterThan(100);
  }
  const shell = resolveTarget(closures, "gnome-shell")!;
  const ids = shell.order.map(o => o.source.id);
  expect(ids.at(-1)).toBe("gnome-shell");
  expect(ids.indexOf("mutter")).toBeLessThan(ids.indexOf("gnome-shell"));
  expect(ids.indexOf("gtk4")).toBeLessThan(ids.indexOf("libadwaita"));
  const kwin = resolveTarget(closures, "kwin")!;
  expect(kwin.order.find(o => o.source.id === "qtbase")!.closure).toBe("qt6");
  expect(kwin.order.at(-1)!.source.id).toBe("kwin");
  expect(sysrootPackages(closures, "plasma").some(p => p.name === "qt6-base")).toBe(true);
});

test("host tools are linked into the sysroot bin dir, replacing target binaries", () => {
  const root = mkdtempSync(join(tmpdir(), "shim-"));
  const links: Array<[string, string]> = [];
  const found = new Map([
    ["glib-mkenums", "/host/glib-mkenums"],
    ["wayland-scanner", "/host/wayland-scanner"],
  ]);
  const r = shimHostTools(
    root,
    n => found.get(n) ?? null,
    ["glib-mkenums", "wayland-scanner", "gresource"],
    (t, p) => links.push([t, p]),
  );
  expect(r).toEqual({ linked: ["glib-mkenums", "wayland-scanner"], present: [], missing: ["gresource"] });
  expect(links.map(l => l[0])).toEqual(["/host/glib-mkenums", "/host/wayland-scanner"]);
  expect(links[0]![1].replaceAll("\\", "/")).toContain("/usr/bin/glib-mkenums");
});
