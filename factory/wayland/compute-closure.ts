#!/usr/bin/env bun
/**
 * Computes factory/wayland/closure.json, factory/wayland/wslg-deps.json and docs/WAYLAND-CLOSURE.md.
 *   bun factory/wayland/compute-closure.ts [--cache DIR] [--offline-db]
 * Sources of truth, nothing is typed by hand except the policy list in policy.ts:
 *  - git ls-remote --tags + shallow blobless clone at the newest stable tag (SHA, commit date, build system,
 *    meson/cmake/Cargo build files, bundled git submodules with their exact gitlink SHA)
 *  - the Arch Linux sync databases (core, extra: version, depends, provides) and the Arch packaging repository
 *    (.SRCINFO of the pkgbase: makedepends), the Arch file lists (pkg-config / cmake / soname -> package)
 * Edges = Arch depends+makedepends united with the required dependencies found in the upstream build files at the tag.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DISTRO_ROOTS, SOURCES, type Consumer, type Source } from "./policy.ts";

const root = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const cache = resolve(args.includes("--cache") ? args[args.indexOf("--cache") + 1] : "C:/Users/aphro/src/wl-cache");
mkdirSync(join(cache, "src"), { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const run = async (cmd: string[], cwd?: string, allowFail = false) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code && !allowFail) throw new Error(`${cmd.join(" ")} (${code}): ${err.slice(0, 300)}`);
  return code ? "" : out;
};
const pool = async <T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out = Array.from({ length: items.length }) as R[];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
};

// ---- Arch databases -------------------------------------------------------------------------------------------
interface Pkg {
  name: string;
  base: string;
  version: string;
  repo: string;
  depends: string[];
  provides: string[];
  url: string;
  desc: string;
  groups: string[];
}
const pkgs = new Map<string, Pkg>();
for (const [repo, dir] of [
  ["core", "xcore"],
  ["extra", "x"],
] as const) {
  const d = join(cache, "db", dir);
  for (const e of readdirSync(d)) {
    const f = join(d, e, "desc");
    if (!existsSync(f)) continue;
    const sec: Record<string, string[]> = {};
    let cur = "";
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^%(\w+)%$/);
      if (m) sec[(cur = m[1])] = [];
      else if (cur && line) sec[cur].push(line);
    }
    const name = sec.NAME?.[0];
    if (name)
      pkgs.set(name, {
        name,
        base: sec.BASE?.[0] ?? name,
        version: sec.VERSION[0],
        repo,
        depends: sec.DEPENDS ?? [],
        provides: sec.PROVIDES ?? [],
        url: sec.URL?.[0] ?? "",
        desc: sec.DESC?.[0] ?? "",
        groups: sec.GROUPS ?? [],
      });
  }
}
const providers = new Map<string, string[]>();
for (const p of pkgs.values())
  for (const pr of p.provides)
    (providers.get(pr.split(/[=<>]/)[0]) ?? providers.set(pr.split(/[=<>]/)[0], []).get(pr.split(/[=<>]/)[0])!).push(
      p.name,
    );
// pkg-config / cmake / soname indexes from the Arch file lists
const pcIdx = new Map<string, string>();
const cmakeIdx = new Map<string, string>();
const libIdx = new Map<string, string>();
for (const dir of ["xc", "xf"]) {
  const d = join(cache, "db", dir);
  if (!existsSync(d)) continue;
  for (const e of readdirSync(d)) {
    const f = join(d, e, "files");
    if (!existsSync(f)) continue;
    const name = e.replace(/-[^-]+-[^-]+$/, "");
    for (const line of readFileSync(f, "utf8").split("\n")) {
      let m = line.match(/^usr\/(?:lib|share)\/pkgconfig\/([^/]+)\.pc$/);
      if (m) {
        if (!pcIdx.has(m[1]) || name.length < pcIdx.get(m[1])!.length) pcIdx.set(m[1], name);
        continue;
      }
      m = line.match(/^usr\/lib\/cmake\/([^/]+)\//);
      if (m && !cmakeIdx.has(m[1].toLowerCase())) {
        cmakeIdx.set(m[1].toLowerCase(), name);
        continue;
      }
      m = line.match(/^usr\/lib\/lib([^/]+)\.so$/);
      if (m && !libIdx.has(m[1])) libIdx.set(m[1], name);
    }
  }
}
const archVer = (v: string) => v.replace(/^\d+:/, "").replace(/-\d+$/, "");
const depName = (d: string) => d.split(/[<>=:]/)[0].trim();
const lookupArch = (name: string): string | undefined => {
  if (pkgs.has(name)) return name;
  const ps = providers.get(name);
  return ps?.length
    ? ps.sort(
        (a, b) =>
          (pkgs.get(a)!.repo === "core" ? -1 : 0) - (pkgs.get(b)!.repo === "core" ? -1 : 0) || a.length - b.length,
      )[0]
    : undefined;
};

// ---- distro base boundary ---------------------------------------------------------------------------------------
const base = new Set<string>();
{
  const q = ["base", "base-devel"];
  while (q.length) {
    const n = lookupArch(depName(q.pop()!));
    if (!n || base.has(n)) continue;
    base.add(n);
    for (const d of pkgs.get(n)!.depends) q.push(d);
  }
}

// ---- tags / clones ----------------------------------------------------------------------------------------------------
const verKey = (s: string) => s.split(/[.-]/).map(Number);
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
const isPre = (v: string) =>
  /rc|alpha|beta|pre/i.test(v) ||
  verKey(v).some((p, i) => i >= 2 && ((p >= 90 && p <= 99) || p >= 900) && !/^\d{4}-/.test(v));

function balanced(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(start + 1, i);
  }
  return text.slice(start + 1);
}
function scanFiles(
  dir: string,
  files: string[],
  ignore: Set<string>,
): { req: Map<string, string>; opt: Map<string, string> } {
  const req = new Map<string, string>(),
    opt = new Map<string, string>();
  const add = (kind: string, name: string, optional: boolean) => {
    name = name
      .replace(/["']/g, "")
      .replace(/[<>=!~].*$/, "")
      .trim();
    if (
      !name ||
      name.startsWith("$") ||
      name.includes("${") ||
      (/^[A-Z_]+$/.test(name) && kind === "pc" && name !== name.toLowerCase() && false)
    )
      return;
    const key = `${kind}:${name}`;
    (optional ? opt : req).set(key, name);
  };
  for (const rel of files) {
    const text = readFileSync(join(dir, rel), "utf8");
    if (rel.endsWith("meson.build")) {
      for (const m of text.matchAll(/\bdependency\s*\(/g)) {
        const body = balanced(text, m.index! + m[0].length - 1);
        const first = body.match(/^\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/);
        if (!first) continue;
        const names = [...first[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
        const rest = body.slice(first[0].length);
        const optional = /required\s*:\s*(?!true\b)/.test(rest) || (/\bfallback|native\s*:\s*true/.test(rest) && false);
        // the line before the call usually carries `if get_option(...)`: dependencies inside option branches are optional
        const lineStart = text.lastIndexOf("\n", m.index!) + 1;
        const inBranch =
          /^\s{2,}/.test(text.slice(lineStart, m.index!)) || /^\s{2,}/.test(text.slice(lineStart, lineStart + 4));
        names.forEach((n, i) => add("pc", n, optional || inBranch || i > 0));
      }
      for (const m of text.matchAll(/find_library\s*\(\s*['"]([^'"]+)['"]/g)) add("lib", m[1], true);
    } else if (rel.endsWith("CMakeLists.txt") || rel.endsWith(".cmake")) {
      for (const m of text.matchAll(/\b(pkg_check_modules|pkg_search_module)\s*\(/gi)) {
        const toks = balanced(text, m.index! + m[0].length - 1)
          .replace(/#.*$/gm, "")
          .split(/\s+/)
          .filter(Boolean);
        const required = toks.includes("REQUIRED");
        const skip = new Set([
          "REQUIRED",
          "QUIET",
          "IMPORTED_TARGET",
          "GLOBAL",
          "NO_CMAKE_PATH",
          "NO_CMAKE_ENVIRONMENT_PATH",
        ]);
        const mods = toks.slice(1).filter(t => !skip.has(t));
        const lineStart = text.lastIndexOf("\n", m.index!) + 1;
        const inBranch =
          /^\s{2,}/.test(text.slice(lineStart, m.index!)) || /^\s{2,}/.test(text.slice(lineStart, lineStart + 4));
        for (const t of mods) if (!/^[<>=]/.test(t) && !/^\d/.test(t)) add("pc", t, !required || inBranch);
      }
      for (const m of text.matchAll(/\bfind_package\s*\(\s*([A-Za-z0-9_+-]+)([^)]*)\)/g)) {
        const required = /\bREQUIRED\b/.test(m[2]);
        add("cmake", m[1], !required);
      }
      for (const m of text.matchAll(/FetchContent_Declare\s*\(\s*([A-Za-z0-9_+-]+)/g)) add("fetch", m[1], false);
    } else if (rel.endsWith("Cargo.toml")) {
      /* crate dependencies are not system packages */
    }
  }
  void ignore;
  return { req, opt };
}

interface Item {
  id: string;
  kind: "source" | "distro" | "bundled";
  name: string;
  version?: string;
  tag?: string;
  sha?: string;
  date?: string;
  url?: string;
  urls?: string[];
  buildSystem?: string;
  group?: string;
  consumers: Consumer[];
  arch?: { packages: string[]; repo?: string; version?: string; matchesPin?: boolean } | null;
  depends: string[];
  makedepends: string[];
  edgeSource: Record<string, string>;
  optionalUpstream: string[];
  unmappedUpstream: string[];
  distroDepends: string[];
  mount?: string;
  imageProvision?: string;
  note?: string;
  bundledBy?: string;
  provided?: string;
  pkgbase?: string;
  repoName?: string;
  compositions?: string[];
}
const items = new Map<string, Item>();
const archToSource = new Map<string, string>();
for (const s of SOURCES) for (const a of s.arch) archToSource.set(a, s.id);

async function resolveSource(s: Source) {
  let chosen: { url: string; tag: string; ver: number[] } | null = null;
  const errs: string[] = [];
  for (const url of s.url) {
    const out = await run(["git", "ls-remote", "--tags", "--refs", url], undefined, true);
    if (!out) {
      errs.push(`${url}: unreachable`);
      continue;
    }
    const re = new RegExp(
      s.tagRe ?? `^${(s.prefix ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+(?:[.\\-]\\d+)*)$`,
      "i",
    );
    const tags = out
      .split("\n")
      .map(l => l.split("refs/tags/")[1])
      .filter(Boolean)
      .map(t => ({ t, m: t.match(re) }))
      .filter(x => x.m && !isPre(x.m[1]));
    if (!tags.length) {
      errs.push(`${url}: no stable tag`);
      continue;
    }
    tags.sort((a, b) => cmp(verKey(a.m![1]), verKey(b.m![1])));
    const best = tags[tags.length - 1];
    chosen = { url, tag: best.t, ver: verKey(best.m![1]) };
    break;
  }
  if (!chosen) throw new Error(`${s.id}: ${errs.join("; ")}`);
  const dir = join(cache, "src", s.id);
  if (existsSync(join(dir, ".git"))) {
    // a cached clone at another tag (newer release since) is discarded
    const cur = (await run(["git", "describe", "--tags", "--exact-match"], dir, true)).trim();
    if (cur !== chosen.tag) await Bun.spawn(["cmd", "/c", "rmdir", "/s", "/q", dir.replace(/\//g, "\\")]).exited;
  }
  if (!existsSync(join(dir, ".git"))) {
    const fast = await run(
      ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", chosen.tag, chosen.url, dir],
      undefined,
      true,
    );
    if (!fast) {
      // dumb-HTTP remotes (bitmath.org) cannot do shallow/partial clones
      await Bun.spawn(["cmd", "/c", "rmdir", "/s", "/q", dir.replace(/\//g, "\\")]).exited.catch(() => 0);
      await run(["git", "clone", "--branch", chosen.tag, chosen.url, dir]);
    } else
      await run(
        [
          "git",
          "sparse-checkout",
          "set",
          "--no-cone",
          "/meson.build",
          "/meson.options",
          "/meson_options.txt",
          "/CMakeLists.txt",
          "/configure.ac",
          "/Cargo.toml",
          "/setup.py",
          "/pyproject.toml",
          "/.gitmodules",
          "**/meson.build",
          "**/CMakeLists.txt",
          "!/tests/",
          "!/test/",
          "!/docs/",
          "!/doc/",
          "!/subprojects/",
          "!/examples/",
        ],
        dir,
      );
  }
  const sha = (await run(["git", "rev-parse", "HEAD"], dir)).trim();
  const date = (await run(["git", "log", "-1", "--format=%cI"], dir)).trim();
  const tree = (await run(["git", "ls-tree", "-r", "--name-only", "HEAD"], dir)).split("\n").filter(Boolean);
  const buildSystem = tree.includes("meson.build")
    ? "meson"
    : tree.includes("CMakeLists.txt")
      ? "cmake"
      : tree.includes("Cargo.toml")
        ? "cargo"
        : tree.includes("configure.ac")
          ? "autotools"
          : "unknown";
  const wanted = tree.filter(
    f =>
      /(^|\/)(meson\.build|CMakeLists\.txt)$/.test(f) &&
      f.split("/").length <= 4 &&
      !/(^|\/)(tests?|docs?|doc|examples?|subprojects|fuzz|bench|contrib|test)(\/|$)/i.test(f),
  );
  const sc = scanFiles(
    dir,
    wanted.filter(f => existsSync(join(dir, f))),
    new Set(s.ignore ?? []),
  );
  // bundled git submodules with exact gitlink SHA
  const subs: { path: string; sha: string; url: string }[] = [];
  const gm = existsSync(join(dir, ".gitmodules")) ? readFileSync(join(dir, ".gitmodules"), "utf8") : "";
  const urls = new Map<string, string>();
  for (const b of gm.split(/\[submodule /).slice(1)) {
    const p = b.match(/path\s*=\s*(.*)/)?.[1].trim(),
      u = b.match(/url\s*=\s*(.*)/)?.[1].trim();
    if (p && u) urls.set(p, u);
  }
  const links = (await run(["git", "ls-tree", "-r", "HEAD"], dir)).split("\n").filter(l => l.startsWith("160000"));
  for (const l of links) {
    const m = l.match(/^160000 commit (\w{40})\t(.*)$/);
    if (m && urls.has(m[2])) subs.push({ path: m[2], sha: m[1], url: urls.get(m[2])! });
  }
  return { chosen, sha, date, buildSystem, sc, subs, ver: chosen.tag.replace(re0(s), "") };
}
function re0(s: Source) {
  return new RegExp(`^${(s.prefix ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
}

console.error(`resolving ${SOURCES.length} sources...`);
const resolved = await pool(SOURCES, 8, async s => {
  try {
    return { s, r: await resolveSource(s) };
  } catch (e) {
    console.error("FAILED", String(e).slice(0, 300));
    return { s, r: null as any };
  }
});
const failed = resolved.filter(x => !x.r).map(x => x.s.id);

// ---- makedepends from the Arch packaging .SRCINFO ------------------------------------------------------------------
const srcinfo = new Map<string, { makedepends: string[]; depends: string[] }>();
async function fetchSrcinfo(base: string) {
  const f = join(cache, "srcinfo", `${base}.txt`);
  mkdirSync(join(cache, "srcinfo"), { recursive: true });
  let text = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (!text) {
    const r = await fetch(
      `https://gitlab.archlinux.org/archlinux/packaging/packages/${base}/-/raw/main/.SRCINFO`,
    ).catch(() => null);
    text = r?.ok ? await r.text() : "";
    if (text) writeFileSync(f, text);
  }
  const md: string[] = [],
    dp: string[] = [];
  let inBase = true;
  for (const line of text.split("\n")) {
    if (/^pkgname\s*=/.test(line)) inBase = false;
    const m = line.match(/^\s*(makedepends|depends)\s*=\s*(.+)$/);
    if (m && inBase) (m[1] === "makedepends" ? md : dp).push(m[2].trim());
  }
  srcinfo.set(base, { makedepends: md, depends: dp });
}
const bases = new Set<string>();
for (const { s } of resolved) for (const a of s.arch.slice(0, 1)) if (pkgs.has(a)) bases.add(pkgs.get(a)!.base);
await pool([...bases], 8, fetchSrcinfo);

// ---- map upstream names to Arch packages -----------------------------------------------------------------------------
function mapUpstream(key: string): string | undefined {
  const [kind, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "pc")
    return pcIdx.get(name) ?? pcIdx.get(name.replace(/-/g, "_")) ?? (pkgs.has(name) ? name : undefined);
  if (kind === "cmake")
    return cmakeIdx.get(name.toLowerCase()) ?? (pkgs.has(name.toLowerCase()) ? name.toLowerCase() : undefined);
  if (kind === "lib") return libIdx.get(name);
  return undefined;
}

// ---- build items ------------------------------------------------------------------------------------------------------
const uniq = <T>(a: T[]) => [...new Set(a)];
const ok = resolved.filter(x => x.r);
for (const { s, r } of ok) {
  const a0 = s.arch.find(a => pkgs.has(a));
  const ap = a0 ? pkgs.get(a0)! : undefined;
  const it: Item = {
    id: s.id,
    kind: "source",
    name: s.id,
    version: r.ver,
    tag: r.chosen.tag,
    sha: r.sha,
    date: r.date,
    url: r.chosen.url,
    urls: s.url,
    buildSystem: r.buildSystem,
    group: s.group,
    consumers: [...s.consumers],
    depends: [],
    makedepends: [],
    edgeSource: {},
    optionalUpstream: [],
    unmappedUpstream: [],
    distroDepends: [],
    arch: a0
      ? {
          packages: s.arch,
          repo: ap!.repo,
          version: archVer(ap!.version),
          matchesPin: archVer(ap!.version) === r.ver.replace(/-/g, "."),
        }
      : { packages: [], matchesPin: false },
    note: s.note,
    pkgbase: ap?.base,
  };
  items.set(s.id, it);
}
// bundled submodules become items pinned at their gitlink SHA
for (const { s, r } of ok) {
  for (const sub of r.subs) {
    const last = sub.path.split("/").pop()!,
      id = last === "m4" ? "xcb-util-m4" : last;
    if (!items.has(id))
      items.set(id, {
        id,
        kind: "bundled",
        name: id,
        tag: undefined,
        sha: sub.sha,
        url: sub.url.replace(
          /^git:\/\/anongit\.freedesktop\.org\/xcb\/util-common-m4\.git$/,
          "https://gitlab.freedesktop.org/xorg/util/xcb-util-m4.git",
        ),
        urls: [sub.url],
        group: "bundled",
        consumers: [...s.consumers],
        depends: [],
        makedepends: [],
        edgeSource: {},
        optionalUpstream: [],
        unmappedUpstream: [],
        distroDepends: [],
        bundledBy: s.id,
        note: `git submodule ${sub.path} of ${s.id} ${r.chosen.tag} (gitlink SHA)`,
        arch: null,
      });
    items.get(s.id)!.depends.push(id);
    items.get(s.id)!.edgeSource[id] = "submodule";
  }
}

const distroNodes = new Map<string, Item>();
const resolveArchDep = (raw: string): { kind: "source" | "base" | "distro"; id: string } | undefined => {
  const n = depName(raw);
  const name = lookupArch(n);
  if (!name) return undefined;
  if (archToSource.has(name) && items.has(archToSource.get(name)!))
    return { kind: "source", id: archToSource.get(name)! };
  // virtual provided by a source item (e.g. libgl -> libglvnd)
  for (const p of providers.get(n) ?? [])
    if (archToSource.has(p) && items.has(archToSource.get(p)!)) return { kind: "source", id: archToSource.get(p)! };
  if (base.has(name)) return { kind: "base", id: name };
  return { kind: "distro", id: name };
};
const distroQueue: string[] = [];
function link(it: Item, raw: string, list: "depends" | "makedepends", src: string) {
  const r = resolveArchDep(raw);
  if (!r) {
    it.unmappedUpstream.push(raw);
    return;
  }
  const id = r.kind === "source" ? r.id : r.kind === "base" ? `base:${r.id}` : `arch:${r.id}`;
  if (id === it.id) return;
  if (r.kind === "distro") distroQueue.push(r.id);
  if (!it[list].includes(id) && !it.depends.includes(id) && !it.makedepends.includes(id)) it[list].push(id);
  it.edgeSource[id] = it.edgeSource[id] && it.edgeSource[id] !== src ? "both" : src;
}
const unreferenced: string[] = [];
for (const { s, r } of ok) {
  const it = items.get(s.id)!;
  const ap = s.arch.find(a => pkgs.has(a));
  const si = ap ? srcinfo.get(pkgs.get(ap)!.base) : undefined;
  const drop = new Set(s.dropDepends ?? []);
  for (const d of ap ? pkgs.get(ap)!.depends : []) if (!drop.has(depName(d))) link(it, d, "depends", "arch");
  for (const d of s.extraDepends ?? []) link(it, d, "depends", "policy");
  for (const d of si?.makedepends ?? []) link(it, d, "makedepends", "arch");
  const ign = new Set(s.ignore ?? []);
  const enable = new Set(s.enable ?? []);
  for (const [key, name] of r.sc.req) {
    if (ign.has(name) || name === s.id) continue;
    const a = mapUpstream(key);
    if (!a) {
      it.unmappedUpstream.push(key);
      continue;
    }
    if (a === ap) continue;
    link(it, a, "depends", "upstream");
  }
  for (const [key, name] of r.sc.opt) {
    if (ign.has(name)) continue;
    const a = mapUpstream(key);
    if (enable.has(name) && a && a !== ap) {
      link(it, a, "depends", "upstream-enabled");
      continue;
    }
    it.optionalUpstream.push(a ? `${name} -> ${a}` : `${key} (no Arch package found)`);
  }
  it.unmappedUpstream = uniq(it.unmappedUpstream);
  it.optionalUpstream = uniq(it.optionalUpstream);
}

// commit dates of bundled submodules (GitHub API)
for (const it of items.values()) {
  const m = it.kind === "bundled" && it.url?.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (m)
    it.date =
      (
        await run(["gh", "api", `repos/${m[1]}/commits/${it.sha}`, "--jq", ".commit.committer.date"], undefined, true)
      ).trim() || undefined;
}
// onlyIfReferenced items: drop when nothing references them
for (const s of SOURCES.filter(x => x.onlyIfReferenced)) {
  const referenced = [...items.values()].some(
    i => i.id !== s.id && (i.depends.includes(s.id) || i.makedepends.includes(s.id)),
  );
  if (!referenced) {
    items.delete(s.id);
    unreferenced.push(s.id);
  }
}
// distro roots
for (const dr of DISTRO_ROOTS) distroQueue.push(lookupArch(dr.pkg) ?? dr.pkg);
// expand distro nodes (runtime depends, stop at the base set)
const rootConsumers = new Map(DISTRO_ROOTS.map(d => [lookupArch(d.pkg) ?? d.pkg, d.consumers]));
const seenD = new Set<string>();
const missingArch: string[] = [];
while (distroQueue.length) {
  const n = distroQueue.pop()!;
  if (seenD.has(n)) continue;
  seenD.add(n);
  const p = pkgs.get(n);
  if (!p) {
    missingArch.push(n);
    continue;
  }
  const node: Item = {
    id: `arch:${n}`,
    kind: "distro",
    name: n,
    version: archVer(p.version),
    consumers: rootConsumers.get(n) ? [...rootConsumers.get(n)!] : [],
    depends: [],
    makedepends: [],
    edgeSource: {},
    optionalUpstream: [],
    unmappedUpstream: [],
    distroDepends: [],
    pkgbase: p.base,
    repoName: p.repo,
    provided: `distro: ${n}`,
    url: p.url,
    arch: { packages: [n], repo: p.repo, version: archVer(p.version) },
  };
  distroNodes.set(node.id, node);
  for (const d of p.depends) link(node, d, "depends", "arch");
}
for (const [k, v] of distroNodes) items.set(k, v);
// base nodes: referenced as "provided by distro"
const baseUsed = new Set<string>();
for (const it of items.values())
  for (const d of [...it.depends, ...it.makedepends]) if (d.startsWith("base:")) baseUsed.add(d.slice(5));
// consumers propagate along edges
const all = [...items.values()];
for (const c of ["bun-os", "wslg"] as Consumer[]) {
  const q = all.filter(i => (i.kind !== "distro" || i.consumers.includes(c)) && i.consumers.includes(c)).map(i => i.id);
  const seen = new Set(q);
  while (q.length) {
    const it = items.get(q.pop()!);
    if (!it) continue;
    for (const d of [...it.depends, ...it.makedepends]) {
      const t = items.get(d);
      if (t && !seen.has(d)) {
        seen.add(d);
        if (!t.consumers.includes(c)) t.consumers.push(c);
        q.push(d);
      }
    }
  }
}
// distro dependencies of source items (packages the build/runtime needs from the distro)
for (const it of items.values())
  if (it.kind !== "distro")
    it.distroDepends = uniq(
      [...it.depends, ...it.makedepends]
        .filter(d => d.startsWith("arch:") || d.startsWith("base:"))
        .map(d => d.replace(/^(arch|base):/, "")),
    );

// which existing Bun OS compositions already need an item (runtime closure of their Arch packages, Arch metadata)
const compRoots: Record<string, string[]> = {
  desktop: [...pkgs.values()]
    .filter(p => p.groups.includes("cosmic"))
    .map(p => p.name)
    .concat(["mesa", "vulkan-icd-loader", "pipewire", "wireplumber"]),
  gaming: ["gamescope", "steam", "mesa", "vulkan-icd-loader", "pipewire", "wireplumber"],
  hyprland: [
    "hyprland",
    "hyprpm",
    "xdg-desktop-portal-hyprland",
    "hyprlock",
    "hypridle",
    "hyprpaper",
    "hyprpicker",
    "hyprsunset",
    "hyprpolkitagent",
    "hyprshutdown",
    "hyprland-guiutils",
    "xorg-xwayland",
    "mesa",
    "pipewire",
    "wireplumber",
    "polkit",
    "qt6-wayland",
  ],
};
const compPkgs = new Map<string, Set<string>>();
for (const [c, rs] of Object.entries(compRoots)) {
  const seen = new Set<string>(),
    q = [...rs];
  while (q.length) {
    const n = lookupArch(depName(q.pop()!));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    for (const d of pkgs.get(n)?.depends ?? []) q.push(d);
  }
  compPkgs.set(c, seen);
}
compPkgs.set("server", new Set());
for (const it of items.values()) {
  const names = it.kind === "distro" ? [it.name] : (it.arch?.packages ?? []);
  it.compositions = [...compPkgs.entries()]
    .filter(([, set]) => names.some(n => set.has(n)))
    .map(([c]) => c)
    .sort();
}

// image provisioning + mount
for (const it of items.values()) {
  if (it.kind === "distro") continue;
  const needsSource =
    it.kind !== "bundled" && (it.consumers.includes("wslg") || !it.arch?.packages.length || !it.arch.matchesPin);
  it.mount = needsSource
    ? `vendor/${it.group === "hyprland" || it.id.startsWith("hypr") || it.bundledBy === "hyprland" ? "hyprland" : "wayland"}/${it.id}`
    : undefined;
  it.imageProvision =
    it.kind === "bundled"
      ? "bundled-in-parent"
      : it.arch?.matchesPin
        ? `pacman ${it.arch.packages[0]} ${it.arch.version} (equal to the pinned tag)`
        : it.arch?.packages.length
          ? `source build (Arch has ${it.arch.version}, pin ${it.version})`
          : "source build (not in the Arch repositories)";
}

// ---- topological order of the source items (cycle report) --------------------------------------------------------------
const srcIds = [...items.values()].filter(i => i.kind !== "distro").map(i => i.id);
const order: string[] = [];
const state = new Map<string, number>();
const cycles: string[][] = [];
const stack: string[] = [];
const visit = (id: string) => {
  if (state.get(id) === 2) return;
  if (state.get(id) === 1) {
    cycles.push([...stack.slice(stack.indexOf(id)), id]);
    return;
  }
  state.set(id, 1);
  stack.push(id);
  const it = items.get(id)!;
  for (const d of [...it.depends, ...it.makedepends].sort())
    if (items.get(d) && items.get(d)!.kind !== "distro") visit(d);
  stack.pop();
  state.set(id, 2);
  order.push(id);
};
for (const id of srcIds.sort()) visit(id);

// ---- write ------------------------------------------------------------------------------------------------------------
const outItems = [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
const closure = {
  schemaVersion: 1,
  kind: "bun-os-wayland-closure",
  computedAt: today,
  method:
    "git ls-remote + blobless shallow clone at the newest stable tag; Arch core/extra sync databases and .SRCINFO (main) of the pkgbase; Arch file lists for pkg-config/cmake/soname mapping; upstream meson.build/CMakeLists.txt scanned (balanced-paren regex, approximate: UNVERIFIED for generated or variable-indirected dependency lists)",
  archSnapshot: { mirror: "https://geo.mirror.pkgbuild.com", repos: ["core", "extra"], date: today },
  counts: {} as Record<string, number>,
  distroBase: [...baseUsed].sort(),
  buildOrder: order,
  cycles,
  unresolved: { failedSources: failed, unreferencedCandidates: unreferenced, archPackagesMissing: missingArch },
  items: outItems,
};
closure.counts = {
  items: outItems.length,
  sources: outItems.filter(i => i.kind === "source").length,
  bundledSubmodules: outItems.filter(i => i.kind === "bundled").length,
  distroPackages: outItems.filter(i => i.kind === "distro").length,
  distroBaseReferenced: baseUsed.size,
  mountedSubmodules: outItems.filter(i => i.mount).length,
  imageFromPacman: outItems.filter(i => i.imageProvision?.startsWith("pacman")).length,
  wslgFromSource: outItems.filter(i => i.kind !== "distro" && i.consumers.includes("wslg")).length,
};
mkdirSync(join(root, "factory/wayland"), { recursive: true });
writeFileSync(join(root, "factory/wayland/closure.json"), JSON.stringify(closure, null, 2) + "\n");

// wslg-deps.json: the source subset WSLg builds, in dependency order, with the options
const polBy = new Map(SOURCES.map(s => [s.id, s]));
const wslgIds = new Set(outItems.filter(i => i.kind !== "distro" && i.consumers.includes("wslg")).map(i => i.id));
const wslgOrder = order.filter(id => wslgIds.has(id));
const wslg = {
  schemaVersion: 1,
  kind: "wslg-source-dependencies",
  computedAt: today,
  note: "Consumed by the WSLg agent: build in this order (each entry only needs earlier entries plus distroRequires). prefix /usr/local, libdir lib. options marked verified=true are the ones of the WSLg bunos Dockerfile of 2026-10-29; the others are UNVERIFIED defaults (never built there).",
  distroNote:
    "distroRequires are Arch package names; the WSLg system distro is Azure Linux 3.0 (tdnf): map by name, UNVERIFIED.",
  entries: wslgOrder.map((id, n) => {
    const it = items.get(id)!,
      p = polBy.get(id);
    return {
      order: n + 1,
      id,
      tag: it.tag ?? null,
      sha: it.sha,
      date: it.date,
      url: it.url,
      buildSystem: it.buildSystem ?? "bundled",
      after: [...it.depends, ...it.makedepends].filter(d => wslgIds.has(d)),
      distroRequires: it.distroDepends,
      options: p?.wslgOptions ?? [],
      optionsVerified: p?.wslgOptionsVerified === true,
      bundledBy: it.bundledBy ?? null,
    };
  }),
};
writeFileSync(join(root, "factory/wayland/wslg-deps.json"), JSON.stringify(wslg, null, 2) + "\n");

// docs
const rows = outItems.filter(i => i.kind !== "distro");
const md = [
  "# Wayland and Hyprland dependency closure",
  "",
  `Generated by \`bun factory/wayland/compute-closure.ts\` on ${today} from the pinned upstream tags, the Arch Linux core/extra databases and the upstream build files. Machine-readable: \`factory/wayland/closure.json\`; WSLg subset: \`factory/wayland/wslg-deps.json\`; verified by \`bun factory/wayland/verify-closure.ts\`.`,
  "",
  "## Counts",
  "",
  ...Object.entries(closure.counts).map(([k, v]) => `- ${k}: ${v}`),
  `- build-order cycles among source items: ${cycles.length}`,
  "",
  "Source items are pinned by tag and full commit SHA. Items whose Arch package already equals the pinned tag are taken from pacman for the Bun OS image (no submodule); everything WSLg builds is mounted under `vendor/wayland/` or `vendor/hyprland/` as a shallow `update = none` submodule. Distro packages (Arch core/extra) are listed in the JSON with version and pkgbase; the `base`/`base-devel` closure is referenced as `base:<package>` (provided by distro).",
  "",
  "## Source items",
  "",
  "| id | tag | commit | date | build | Arch | consumers | image | mount |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    i =>
      `| ${i.id} | ${i.tag ?? "(gitlink)"} | \`${i.sha!.slice(0, 12)}\` | ${i.date?.slice(0, 10) ?? ""} | ${i.buildSystem ?? "bundled"} | ${i.arch?.packages.length ? i.arch.version : "none"} | ${i.consumers.join("+")} | ${i.imageProvision} | ${i.mount ?? ""} |`,
  ),
  "",
  "## Build order (source items, dependencies first)",
  "",
  order.map((id, n) => `${n + 1}. ${id}`).join("\n"),
  "",
  "## Unresolved or uncertain",
  "",
  `- sources that failed to resolve: ${failed.join(", ") || "none"}`,
  `- candidates dropped because nothing references them: ${unreferenced.join(", ") || "none"}`,
  `- Arch packages missing from core/extra: ${missingArch.join(", ") || "none"}`,
  "- upstream dependency scan is a regex over meson.build/CMakeLists.txt: names it could not map to an Arch package are in `unmappedUpstream` per item, options-gated dependencies in `optionalUpstream` (UNVERIFIED which are enabled).",
  "",
].join("\n");
writeFileSync(join(root, "docs/WAYLAND-CLOSURE.md"), md);
console.log(JSON.stringify({ ...closure.counts, cycles: cycles.length, failed, unreferenced, missingArch }, null, 1));
