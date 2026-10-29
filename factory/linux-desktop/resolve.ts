#!/usr/bin/env bun
/**
 * Resolves the Linux desktop closures from upstream and writes closure-gnome.json, closure-qt6.json and
 * closure-plasma.json next to this file.
 *
 *   bun factory/linux-desktop/resolve.ts [--offline-db <dir>] [--only gnome|qt6|plasma]
 *
 * Sources of truth, all fetched live:
 *  - tags and peeled commit SHAs: `git ls-remote` on gitlab.gnome.org, invent.kde.org and code.qt.io;
 *  - commit dates: the GitLab API (GNOME, KDE) and the GitHub mirror API (Qt);
 *  - build dependencies: dependency()/find_package() calls and option() declarations read from the pinned
 *    meson.build, meson.options and CMakeLists.txt at the pinned tag (options below are checked against them);
 *  - sysroot: the dependency closure, in the Arch core/extra databases, of the Arch packages that ship the
 *    same components (Arch is the dependency oracle: its depends/makedepends are the maintainers' view).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { archClosure } from "../../packages/buncc/src/linux-target/pacmandb.ts";
import { fetchIndex, TOOLCHAIN_ROOTS } from "../../packages/buncc/src/linux-target/sysroot.ts";
import type { Closure, SourcePin } from "../../packages/buncc/src/linux-target/closure.ts";

type Forge = "gnome" | "kde-plasma" | "kde-frameworks" | "kde-libraries" | "qt";

interface Spec {
  id: string;
  forge: Forge;
  repo: string;
  tag: RegExp;
  evenMinor?: boolean;
  build: "meson" | "cmake";
  options: string[];
  /** Map from declared dependency names to source ids built from this closure. */
  hostRun?: string[];
  /** Fixed extra `needs` the build files cannot show (computed pkg-config names). */
  needs?: string[];
}

const NOTE_GIR = "g-ir-scanner links and runs target binaries: needs an exe_wrapper (qemu-user) or a native Linux host";
const NOTE_GLIBTOOLS = "glib-compile-resources, glib-compile-schemas, gdbus-codegen, glib-mkenums must run on the build host (Windows host: MSYS2/mingw glib, else CI)";
const NOTE_QTHOST = "moc, rcc, uic, qsb must run on the build host: QT_HOST_PATH to a matching host Qt (stage 1) is required";
const NOTE_KFHOST = "kconfig_compiler_kf6 and other KF6 code generators run at build time: KF6_HOST_TOOLING to a host KF6 install is required";

const GNOME: Spec[] = [
  { id: "glib", forge: "gnome", repo: "glib", tag: /^2\.\d+\.\d+$/, evenMinor: true, build: "meson", options: ["-Dtests=false", "-Dman-pages=disabled", "-Ddocumentation=false", "-Dintrospection=disabled"] },
  { id: "gsettings-desktop-schemas", forge: "gnome", repo: "gsettings-desktop-schemas", tag: /^\d+\.\d+$/, build: "meson", options: ["-Dintrospection=false"], hostRun: [NOTE_GLIBTOOLS], needs: ["glib"] },
  { id: "gnome-desktop", forge: "gnome", repo: "gnome-desktop", tag: /^\d+\.\d+(\.\d+)?$/, build: "meson", options: ["-Dgtk_doc=false", "-Ddebug_tools=false", "-Dintrospection=false"], needs: ["glib", "gsettings-desktop-schemas", "gtk4"] },
  { id: "gtk4", forge: "gnome", repo: "gtk", tag: /^4\.\d+\.\d+$/, evenMinor: true, build: "meson", options: ["-Dintrospection=disabled", "-Dbuild-demos=false", "-Dbuild-tests=false", "-Dbuild-testsuite=false", "-Dbuild-examples=false", "-Dmedia-gstreamer=disabled", "-Dvulkan=disabled", "-Dman-pages=false", "-Ddocumentation=false"], hostRun: [NOTE_GLIBTOOLS], needs: ["glib"] },
  { id: "libadwaita", forge: "gnome", repo: "libadwaita", tag: /^1\.\d+\.\d+$/, evenMinor: true, build: "meson", options: ["-Dtests=false", "-Dexamples=false", "-Dintrospection=disabled", "-Dvapi=false", "-Ddocumentation=false"], hostRun: [NOTE_GLIBTOOLS], needs: ["glib", "gtk4"] },
  { id: "gjs", forge: "gnome", repo: "gjs", tag: /^1\.\d+\.\d+$/, evenMinor: true, build: "meson", options: ["-Dskip_dbus_tests=true", "-Dskip_gtk_tests=true", "-Dinstalled_tests=false"], hostRun: [NOTE_GIR, NOTE_GLIBTOOLS, "mozjs-140 (SpiderMonkey) comes from the sysroot (Arch mozjs140); building it from source needs a host JS shell and Rust"], needs: ["glib", "gtk4"] },
  { id: "mutter", forge: "gnome", repo: "mutter", tag: /^\d+\.\d+$/, build: "meson", options: ["-Dtests=disabled", "-Dintrospection=false", "-Ddocs=false", "-Dprofiler=false", "-Dinstalled_tests=false"], hostRun: [NOTE_GLIBTOOLS, "wayland-scanner (host tool) generates protocol glue; without introspection no target code runs"], needs: ["glib", "gtk4", "libadwaita", "gnome-desktop", "gsettings-desktop-schemas", "gnome-settings-daemon"] },
  { id: "gnome-settings-daemon", forge: "gnome", repo: "gnome-settings-daemon", tag: /^\d+\.\d+$/, build: "meson", options: [], hostRun: [NOTE_GLIBTOOLS], needs: ["glib", "gtk4", "gnome-desktop", "gsettings-desktop-schemas"] },
  { id: "gnome-shell", forge: "gnome", repo: "gnome-shell", tag: /^\d+\.\d+$/, build: "meson", options: ["-Dtests=false", "-Dgtk_doc=false", "-Dman=false"], hostRun: [NOTE_GIR, NOTE_GLIBTOOLS, "gnome-shell-extension-tool and the bundled gvc/st build run no target code after introspection is generated"], needs: ["glib", "gtk4", "gjs", "mutter", "gnome-desktop", "gsettings-desktop-schemas"] },
  { id: "gnome-session", forge: "gnome", repo: "gnome-session", tag: /^\d+\.\d+$/, build: "meson", options: ["-Ddocbook=false", "-Dman=false"], needs: ["glib", "gtk4"] },
  { id: "gnome-control-center", forge: "gnome", repo: "gnome-control-center", tag: /^\d+\.\d+$/, build: "meson", options: ["-Ddocumentation=false", "-Dtests=false"], hostRun: [NOTE_GLIBTOOLS], needs: ["glib", "gtk4", "libadwaita", "gnome-desktop", "gsettings-desktop-schemas", "gnome-settings-daemon"] },
];

const QT_MODULES = ["qtbase", "qtshadertools", "qtdeclarative", "qtsvg", "qtwayland", "qt5compat", "qttools"];
const qtOpts = ["-DQT_BUILD_TESTS=OFF", "-DQT_BUILD_EXAMPLES=OFF", "-DBUILD_TESTING=OFF"];
const QT: Spec[] = QT_MODULES.map(m => ({
  id: m,
  forge: "qt" as const,
  repo: m,
  tag: /^v6\.\d+\.\d+$/,
  build: "cmake" as const,
  options: m === "qtbase" ? [...qtOpts, "-DFEATURE_opengl_dynamic=OFF", "-DQT_FEATURE_xcb=ON", "-DINPUT_opengl=es2"] : qtOpts,
  hostRun: [NOTE_QTHOST],
  needs: m === "qtbase" ? [] : m === "qtshadertools" ? ["qtbase"] : m === "qtdeclarative" ? ["qtbase", "qtshadertools"] : m === "qttools" ? ["qtbase", "qtdeclarative"] : ["qtbase", "qtdeclarative"],
}));

const kdeOpts = ["-DBUILD_TESTING=OFF", "-DBUILD_QCH=OFF", "-DKDE_INSTALL_USE_QT_SYS_PATHS=ON", "-DCMAKE_BUILD_TYPE=Release"];
const P = (id: string, needs: string[], extra: string[] = [], repo = id): Spec => ({ id, forge: "kde-plasma", repo, tag: /^v6\.\d+\.\d+$/, build: "cmake", options: [...kdeOpts, ...extra], hostRun: [NOTE_QTHOST, NOTE_KFHOST], needs });
const PLASMA: Spec[] = [
  { id: "plasma-wayland-protocols", forge: "kde-libraries", repo: "plasma-wayland-protocols", tag: /^v1\.\d+\.\d+$/, build: "cmake", options: ["-DBUILD_TESTING=OFF"], needs: [] },
  P("kdecoration", ["qtbase"]),
  P("breeze", ["qtbase", "kdecoration"]),
  P("kwayland", ["qtbase", "qtwayland", "plasma-wayland-protocols"]),
  P("plasma-activities", ["qtbase", "qtdeclarative"]),
  P("plasma-activities-stats", ["qtbase", "plasma-activities"]),
  P("kglobalacceld", ["qtbase"]),
  P("layer-shell-qt", ["qtbase", "qtwayland"]),
  P("libplasma", ["qtbase", "qtdeclarative", "qtsvg", "kwayland", "plasma-activities"]),
  P("libkscreen", ["qtbase", "qtwayland", "plasma-wayland-protocols"]),
  P("kscreenlocker", ["qtbase", "qtdeclarative", "libplasma", "kwayland", "layer-shell-qt"]),
  P("knighttime", ["qtbase"]),
  P("union", ["qtbase", "qtdeclarative"]),
  P("kpipewire", ["qtbase", "qtdeclarative"]),
  P("kwin", ["qtbase", "qtdeclarative", "qtwayland", "kdecoration", "libplasma", "kwayland", "plasma-activities", "kglobalacceld", "kscreenlocker", "knighttime", "kpipewire", "plasma-wayland-protocols", "breeze"], ["-DKWIN_BUILD_X11=ON", "-DKWIN_BUILD_NOTIFICATIONS=ON"]),
  P("plasma-workspace", ["qtbase", "qtdeclarative", "qtsvg", "qtwayland", "libplasma", "kwayland", "plasma-activities", "plasma-activities-stats", "libkscreen", "layer-shell-qt", "kscreenlocker", "knighttime", "union", "kwin", "plasma-wayland-protocols"]),
  P("plasma-desktop", ["qtbase", "qtdeclarative", "libplasma", "plasma-workspace", "kwin", "plasma-activities", "plasma-activities-stats", "libkscreen", "kwayland"]),
];

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")}: ${err.trim()}`);
  return out;
};

const remote = (s: Spec): { url: string; api: string; raw: (ref: string, f: string) => string } => {
  switch (s.forge) {
    case "gnome":
      return {
        url: `https://gitlab.gnome.org/GNOME/${s.repo}.git`,
        api: `https://gitlab.gnome.org/api/v4/projects/GNOME%2F${s.repo}/repository/commits/`,
        raw: (r, f) => `https://gitlab.gnome.org/GNOME/${s.repo}/-/raw/${r}/${f}`,
      };
    case "kde-plasma":
      return {
        url: `https://invent.kde.org/plasma/${s.repo}.git`,
        api: `https://invent.kde.org/api/v4/projects/plasma%2F${s.repo}/repository/commits/`,
        raw: (r, f) => `https://invent.kde.org/plasma/${s.repo}/-/raw/${r}/${f}`,
      };
    case "kde-libraries":
      return {
        url: `https://invent.kde.org/libraries/${s.repo}.git`,
        api: `https://invent.kde.org/api/v4/projects/libraries%2F${s.repo}/repository/commits/`,
        raw: (r, f) => `https://invent.kde.org/libraries/${s.repo}/-/raw/${r}/${f}`,
      };
    case "kde-frameworks":
      return {
        url: `https://invent.kde.org/frameworks/${s.repo}.git`,
        api: `https://invent.kde.org/api/v4/projects/frameworks%2F${s.repo}/repository/commits/`,
        raw: (r, f) => `https://invent.kde.org/frameworks/${s.repo}/-/raw/${r}/${f}`,
      };
    case "qt":
      return {
        url: `https://code.qt.io/qt/${s.repo}.git`,
        api: `https://api.github.com/repos/qt/${s.repo}/commits/`,
        raw: (r, f) => `https://raw.githubusercontent.com/qt/${s.repo}/${r}/${f}`,
      };
  }
};

async function latestTag(s: Spec): Promise<{ tag: string; sha: string }> {
  const text = await run(["git", "-c", "credential.helper=", "ls-remote", "--tags", remote(s).url]);
  const tags = new Map<string, string>();
  for (const line of text.trim().split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    const full = ref.replace("refs/tags/", "");
    const peeled = full.endsWith("^{}");
    const name = peeled ? full.slice(0, -3) : full;
    if (!s.tag.test(name)) continue;
    if (s.evenMinor) {
      const minor = Number(name.replace(/^v/, "").split(".")[1]);
      if (minor % 2 !== 0) continue;
    }
    if (peeled || !tags.has(name)) tags.set(name, sha);
  }
  const sorted = [...tags].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const last = sorted.at(-1);
  if (!last) throw new Error(`${s.id}: no tag matches ${s.tag}`);
  return { tag: last[0], sha: last[1] };
}

async function commitDate(s: Spec, sha: string): Promise<string> {
  const r = remote(s);
  if (s.forge === "qt") {
    const json = JSON.parse(await run(["gh", "api", `repos/qt/${s.repo}/commits/${sha}`]));
    return json.commit.committer.date;
  }
  const res = await fetch(r.api + sha);
  if (!res.ok) throw new Error(`${s.id}: ${r.api}${sha} HTTP ${res.status}`);
  return ((await res.json()) as { committed_date: string }).committed_date;
}

const get = async (url: string) => {
  const r = await fetch(url);
  return r.ok ? r.text() : "";
};

/** option() declarations: name -> {type, choices}. */
function parseOptions(text: string): Map<string, { type: string; choices: string[] }> {
  const out = new Map<string, { type: string; choices: string[] }>();
  for (const m of text.matchAll(/option\(\s*'([^']+)'\s*,([\s\S]*?)\n?\)/g)) {
    const body = m[2]!;
    const type = /type\s*:\s*'(\w+)'/.exec(body)?.[1] ?? "string";
    const choices = [...(/choices\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/'([^']+)'/g)].map(x => x[1]!);
    out.set(m[1]!, { type, choices });
  }
  return out;
}

export function optionProblems(id: string, declared: Map<string, { type: string; choices: string[] }>, opts: string[]): string[] {
  const p: string[] = [];
  for (const o of opts) {
    const m = /^-D([^=]+)=(.*)$/.exec(o);
    if (!m || o.startsWith("-DQT") || o.startsWith("-DFEATURE") || o.startsWith("-DINPUT")) continue;
    const d = declared.get(m[1]!);
    if (!d) {
      p.push(`${id}: option ${m[1]} is not declared in the pinned meson options`);
      continue;
    }
    const v = m[2]!;
    const ok =
      d.type === "boolean" ? v === "true" || v === "false"
      : d.type === "feature" ? ["enabled", "disabled", "auto"].includes(v)
      : d.type === "combo" ? d.choices.includes(v)
      : true;
    if (!ok) p.push(`${id}: option ${m[1]}=${v} is not valid for type ${d.type}${d.choices.length ? ` (${d.choices.join("|")})` : ""}`);
  }
  return p;
}

async function declaredDeps(s: Spec, ref: string): Promise<{ declared: string[]; problems: string[] }> {
  const r = remote(s);
  if (s.build === "meson") {
    const meson = await get(r.raw(ref, "meson.build"));
    const names = new Set<string>();
    for (const m of meson.matchAll(/dependency\(\s*'([^']+)'(?:[^)]*?version:\s*'([^']+)')?/g)) names.add(m[1]! + (m[2] ? ` ${m[2]}` : ""));
    const optText = (await get(r.raw(ref, "meson.options"))) || (await get(r.raw(ref, "meson_options.txt")));
    return { declared: [...names].sort(), problems: optionProblems(s.id, parseOptions(optText), s.options) };
  }
  const cm = await get(r.raw(ref, "CMakeLists.txt"));
  const names = new Set<string>();
  for (const m of cm.matchAll(/find_package\(\s*([A-Za-z0-9_]+)([^)]*)\)/g)) {
    const comps = /COMPONENTS\s+([^)]*?)(?:OPTIONAL_COMPONENTS|$)/s.exec(m[2]!)?.[1]?.trim().split(/\s+/).filter(x => /^[A-Za-z0-9_]+$/.test(x));
    names.add(m[1]! + (comps?.length ? `[${comps.join(",")}]` : ""));
  }
  return { declared: [...names].sort(), problems: [] };
}

async function resolveSources(specs: Spec[]): Promise<{ sources: SourcePin[]; problems: string[] }> {
  const problems: string[] = [];
  const sources = await Promise.all(
    specs.map(async s => {
      const { tag, sha } = await latestTag(s);
      const [date, deps] = await Promise.all([commitDate(s, sha), declaredDeps(s, tag)]);
      problems.push(...deps.problems);
      const pin: SourcePin = {
        id: s.id,
        url: remote(s).url,
        tag,
        sha,
        date,
        build: s.build,
        needs: s.needs ?? [],
        options: s.options,
        declared: deps.declared,
      };
      if (s.hostRun?.length) pin.hostRun = s.hostRun;
      return pin;
    }),
  );
  return { sources, problems };
}

/** Host-only tools never installed into a target sysroot. */
const EXCLUDE = [
  "meson", "ninja", "cmake", "git", "pkgconf", "pkg-config", "python", "python-docutils", "python-sphinx", "python-gobject", "python-cairo",
  "asciidoc", "gi-docgen", "sassc", "gtk-doc", "doxygen", "docbook-xsl", "docbook-xml", "xorg-server-xvfb", "xorg-server", "weston", "gdb", "valgrind",
  "clang", "llvm", "gcc-fortran", "nodejs", "npm", "rust", "cargo", "bash-completion", "shellcheck", "yelp-tools", "itstool", "intltool",
  "kdoctools", "graphviz", "qt6-doc", "umockdev", "python-dbusmock", "libxslt",
];

async function sysroot(roots: string[], exclude: string[]) {
  const index = await fetchIndex("x86_64", join(process.env.TEMP ?? "/tmp", "buncc-linux-desktop-cache"), true);
  const { packages, unresolved } = archClosure(index, [...TOOLCHAIN_ROOTS, ...roots], { rootMakedepends: true, exclude });
  const list = packages.map(p => ({ name: p.name, version: p.version, repo: p.repo, sha256: p.sha256, csize: p.csize, isize: p.isize }));
  return {
    packages: list,
    unresolved,
    csize: list.reduce((a, p) => a + p.csize, 0),
    isize: list.reduce((a, p) => a + p.isize, 0),
  };
}

const today = new Date().toISOString().slice(0, 10);
const only: string | undefined = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const dir = import.meta.dir;
const allProblems: string[] = [];

async function emit(id: string, specs: Spec[], roots: string[], release: Record<string, string>, extendsIds: string[] = []) {
  if (only && only !== id) return;
  const { sources, problems } = await resolveSources(specs);
  allProblems.push(...problems);
  const closure: Closure = {
    schemaVersion: 1,
    kind: "linux-desktop-closure",
    id,
    resolvedAt: today,
    release,
    sources,
    sysrootRoots: roots,
    sysrootExclude: EXCLUDE,
    sysroot: await sysroot(roots, EXCLUDE),
    ...(extendsIds.length ? { extends: extendsIds } : {}),
  };
  writeFileSync(join(dir, `closure-${id}.json`), JSON.stringify(closure, null, 2) + "\n");
  console.log(`${id}: ${sources.length} sources, ${closure.sysroot.packages.length} sysroot packages, ${(closure.sysroot.csize / 1048576).toFixed(0)} MiB compressed, ${(closure.sysroot.isize / 1048576).toFixed(0)} MiB installed, unresolved: ${closure.sysroot.unresolved.join(",") || "none"}`);
}

await emit("gnome", GNOME, ["gnome-shell", "mutter", "gtk4", "libadwaita", "gjs", "gnome-session", "gnome-settings-daemon", "gnome-control-center", "gnome-desktop-4", "gsettings-desktop-schemas", "glib2"], { name: "GNOME", note: "stable branch; Arch core/extra carries the same tags" });
await emit("qt6", QT, ["qt6-base", "qt6-declarative", "qt6-wayland", "qt6-svg", "qt6-shadertools", "qt6-5compat", "qt6-tools"], { name: "Qt 6", note: "modules of the newest stable Qt tag" });
await emit("plasma", PLASMA, ["plasma-workspace", "kwin", "plasma-desktop", "libplasma", "kscreenlocker", "layer-shell-qt", "libkscreen", "breeze", "kdecoration", "plasma-activities"], { name: "KDE Plasma 6", note: "KF6 comes from the sysroot packages (kf6 individual Arch packages)" }, ["qt6"]);
if (allProblems.length) {
  console.error("option problems:\n" + allProblems.join("\n"));
  process.exitCode = 2;
}
