#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Regenerates factory/aosp/projects.json and factory/chromiumos/projects.json from googlesource.com
// (read-only JSON endpoints, serialized, >=700 ms between requests, project list cached for the run).
//   bun factory/aosp/refresh.ts                 rewrite both snapshots
//   bun factory/aosp/refresh.ts --only aosp     one snapshot (aosp | chromiumos)
//   bun factory/aosp/refresh.ts --check         exit 1 if a pinned commit no longer exists upstream or a project vanished
//   bun factory/aosp/refresh.ts --check --strict  also exit 1 when a tracked branch moved past the pin
// Endpoints: /?format=JSON (project list), /<p>/+/<ref>?format=JSON (commit), /<p>/+/<ref>/?format=JSON (tree),
// /<p>/+/<ref>/<file>?format=TEXT (base64), /<p>/+refs/heads?format=JSON.
import { dirname, join } from "node:path";

const here = import.meta.dir;
const DELAY_MS = 700;
let last = 0;
const XSSI = ")]}'\n";

async function gs(url: string, text = false): Promise<any | null> {
  const wait = last + DELAY_MS - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  for (let attempt = 0; attempt < 4; attempt++) {
    last = Date.now();
    const r = await fetch(url, { headers: { "user-agent": "bun-os-factory-refresh/1 (aphrody-labs/bun-os)" } });
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) {
      await Bun.sleep(3000 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
    const body = await r.text();
    if (text) return Buffer.from(body, "base64").toString("utf8");
    return JSON.parse(body.startsWith(XSSI) ? body.slice(XSSI.length) : body);
  }
  throw new Error(`GET ${url}: throttled`);
}

interface Want {
  name: string;
  /** SPDX expectation, cross-checked against the license files seen in the tree. */
  license: string;
  score: number;
  goal: string;
  why: string;
  /** refs to try in order for the pin */
  refs?: string[];
}

const W = (name: string, license: string, score: number, goal: string, why: string, refs?: string[]): Want => ({
  name,
  license,
  score,
  goal,
  why,
  refs,
});

export const SITES = {
  aosp: {
    host: "https://android.googlesource.com",
    out: join(here, "projects.json"),
    refs: ["android-latest-release", "main"],
    want: [
      W("platform/manifest", "Apache-2.0", 10, "manifest", "Repo manifest: default.xml revision and project set per release"),
      W("platform/packages/modules/adb", "Apache-2.0", 10, "adb", "adb client/daemon sources"),
      W("platform/system/core", "Apache-2.0", 9, "adb", "fastboot, libbase, libcutils, liblog, libsparse, init (adb/fastboot deps)"),
      W("platform/bionic", "BSD-3-Clause", 8, "runtime", "Android libc/libm/linker (read-only study for APK compatibility)"),
      W("platform/art", "Apache-2.0", 8, "runtime", "ART runtime and dex2oat (APK execution)"),
      W("platform/frameworks/native", "Apache-2.0", 8, "binder", "libbinder, servicemanager, SurfaceFlinger, binder userspace"),
      W("platform/frameworks/base", "Apache-2.0", 9, "shell", "Android framework; libs/WindowManager/Shell holds desktop windowing (read-only study)"),
      W("platform/external/crosvm", "BSD-3-Clause", 9, "vmm", "AOSP copy of crosvm (Cuttlefish default VMM)"),
      W("platform/external/minijail", "BSD-3-Clause", 6, "sandbox", "AOSP minijail"),
      W("platform/hardware/google/gfxstream", "Apache-2.0", 7, "gpu", "gfxstream GPU virtualization for guests"),
      W("platform/external/virglrenderer", "MIT", 6, "gpu", "virglrenderer in AOSP"),
      W("device/google/cuttlefish", "Apache-2.0", 10, "cuttlefish", "Cuttlefish host tools (cvd, launch_cvd, WebRTC operator)"),
      W("platform/external/qemu", "GPL-2.0-only", 5, "emulator", "Android Emulator QEMU fork (listed only if present on this host)", ["emu-master-dev", "main"]),
      W("kernel/common", "GPL-2.0-only", 5, "kernel", "Android Common Kernel (binder, GKI)", ["android-mainline", "main"]),
    ],
  },
  chromiumos: {
    host: "https://chromium.googlesource.com",
    out: join(dirname(here), "chromiumos", "projects.json"),
    refs: ["main"],
    want: [
      W("chromiumos/manifest", "BSD-3-Clause", 10, "manifest", "Repo manifest (default.xml) for ChromiumOS; release-R* branches"),
      W("crosvm/crosvm", "BSD-3-Clause", 10, "vmm", "Rust VMM (upstream, development moved here from chromiumos/platform/crosvm)"),
      W("chromiumos/platform/crosvm", "BSD-3-Clause", 6, "vmm", "Legacy mirror marked MOVED; kept for history"),
      W("chromiumos/platform/minijail", "BSD-3-Clause", 8, "sandbox", "Sandboxing (namespaces, seccomp) used by crosvm"),
      W("chromiumos/platform2", "BSD-3-Clause", 9, "platform", "vm_tools, sommelier, permission_broker, system daemons"),
      W("chromiumos/third_party/adhd", "BSD-3-Clause", 7, "audio", "CRAS audio server"),
      W("chromiumos/third_party/virglrenderer", "MIT", 7, "gpu", "virglrenderer with CrOS patches"),
      W("chromiumos/overlays/chromiumos-overlay", "BSD-3-Clause", 6, "packaging", "Portage ebuilds, reference for PKGBUILD translation"),
      W("chromiumos/overlays/portage-stable", "GPL-2.0-only", 3, "packaging", "Upstream Gentoo ebuilds (reference only)"),
      W("chromiumos/platform/tast-tests", "BSD-3-Clause", 3, "tests", "Tast integration tests, behaviour reference"),
    ],
  },
};
type SiteKey = keyof typeof SITES;

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING|NOTICE|MODULE_LICENSE_\w+|LICENSE[.-]\w+)(\.\w+)?$/i;

const listCache: Record<string, Record<string, any>> = {};
async function projectList(host: string) {
  return (listCache[host] ??= await gs(`${host}/?format=JSON`));
}

async function resolveProject(host: string, w: Want, defaults: string[]) {
  const list = await projectList(host);
  const meta = list[w.name];
  if (!meta) return { name: w.name, url: `${host}/${w.name}`, missing: true };
  const tried: string[] = [];
  for (const ref of w.refs ?? defaults) {
    tried.push(ref);
    const c = await gs(`${host}/${w.name}/+/refs/heads/${ref}?format=JSON`);
    if (!c) continue;
    const tree = await gs(`${host}/${w.name}/+/${c.commit}/?format=JSON`);
    const files: string[] = (tree?.entries ?? []).map((e: any) => e.name).filter((n: string) => LICENSE_FILE.test(n));
    return {
      name: w.name,
      url: `${host}/${w.name}`,
      cloneUrl: meta.clone_url,
      description: meta.description ?? "",
      defaultBranch: ref,
      pinnedCommit: c.commit,
      pinnedTree: c.tree,
      pinnedDate: c.committer?.time,
      license: w.license,
      licenseFiles: files,
      relevance: w.score,
      goal: w.goal,
      why: w.why,
      sizeBytes: null as number | null,
    };
  }
  return { name: w.name, url: `${host}/${w.name}`, cloneUrl: meta.clone_url, missing: true, triedRefs: tried };
}

const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

async function releaseInfo(key: SiteKey) {
  const s = SITES[key];
  const mf = key === "aosp" ? "platform/manifest" : "chromiumos/manifest";
  const heads = (await gs(`${s.host}/${mf}/+refs/heads?format=JSON`)) as Record<string, { value: string }>;
  const names = Object.keys(heads).map(n => n.replace(/^refs\/heads\//, ""));
  if (key === "aosp") {
    const tags = names.filter(n => /^android-\d+(\.\d+)*\.\d+_r\d+$/.test(n)).sort(numeric);
    const lr = heads["refs/heads/android-latest-release"]?.value ?? heads["android-latest-release"]?.value;
    const def = await gs(`${s.host}/${mf}/+/refs/heads/android-latest-release/default.xml?format=TEXT`, true);
    return {
      manifestProject: mf,
      defaultBranch: "main",
      latestReleaseBranch: "android-latest-release",
      latestReleaseCommit: lr,
      latestReleaseTag: tags.at(-1),
      releaseDefaultRevision: def?.match(/<default[^>]*revision="([^"]+)"/)?.[1] ?? null,
      branchesSeen: names.filter(n => /^(main|android-latest-release|android\d+-release|main-cuttlefish-vendor-dev)$/.test(n)),
    };
  }
  const rel = names.filter(n => /^release-R\d+-\d+\.B$/.test(n)).sort(numeric);
  const def = await gs(`${s.host}/${mf}/+/refs/heads/main/default.xml?format=TEXT`, true);
  return {
    manifestProject: mf,
    defaultBranch: "main",
    latestReleaseBranch: rel.at(-1),
    releaseBranchesRecent: rel.slice(-5),
    stableBranch: names.includes("stable") ? "stable" : null,
    mainDefaultRevision: def?.match(/<default[^>]*revision="([^"]+)"/)?.[1] ?? null,
  };
}

async function build(key: SiteKey) {
  const s = SITES[key];
  const projects = [];
  for (const w of s.want) projects.push(await resolveProject(s.host, w, s.refs));
  return {
    $comment: `Generated by factory/aosp/refresh.ts from ${s.host}; do not edit. 'license' is the expected SPDX id, 'licenseFiles' what the tree shows.`,
    source: `${s.host}/`,
    release: await releaseInfo(key),
    projects,
  };
}

const args = Bun.argv.slice(2);
const check = args.includes("--check");
const strict = args.includes("--strict");
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] as SiteKey) : undefined;
const keys = (only ? [only] : (Object.keys(SITES) as SiteKey[])).filter(k => k in SITES);

let bad = 0;
for (const key of keys) {
  const s = SITES[key];
  if (check) {
    const pins = JSON.parse(await Bun.file(s.out).text());
    for (const p of pins.projects) {
      if (p.missing) {
        console.log(`${key}: ${p.name} missing in snapshot`);
        bad++;
        continue;
      }
      const c = await gs(`${s.host}/${p.name}/+/${p.pinnedCommit}?format=JSON`);
      if (!c || c.tree !== p.pinnedTree) {
        console.log(`${key}: ${p.name} pinned commit ${p.pinnedCommit} not found upstream (or tree differs)`);
        bad++;
        continue;
      }
      const head = await gs(`${s.host}/${p.name}/+/refs/heads/${p.defaultBranch}?format=JSON`);
      if (head && head.commit !== p.pinnedCommit) {
        console.log(`${key}: ${p.name} ${p.defaultBranch} moved ${p.pinnedCommit.slice(0, 12)} -> ${head.commit.slice(0, 12)}${strict ? "" : " (informative)"}`);
        if (strict) bad++;
      } else console.log(`${key}: ${p.name} ok ${p.pinnedCommit.slice(0, 12)}`);
    }
  } else {
    const snap = await build(key);
    try {
      const old = JSON.parse(await Bun.file(s.out).text());
      for (const p of snap.projects as any[]) p.sizeBytes = old.projects.find((o: any) => o.name === p.name)?.sizeBytes ?? null;
    } catch {}
    await Bun.write(s.out, JSON.stringify(snap, null, 2) + "\n");
    console.log(`${key}: wrote ${s.out} (${snap.projects.length} projects, ${(snap.projects as any[]).filter(p => p.missing).length} missing)`);
  }
}
if (check) console.log(bad ? `FAIL: ${bad} problem(s)` : "OK");
process.exit(bad ? 1 : 0);
