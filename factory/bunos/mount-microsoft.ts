#!/usr/bin/env bun
/**
 * Mounts the official Microsoft reference repositories as pinned shallow submodules under vendor/microsoft/<name>.
 * Every pin is resolved live with `gh api` (tag -> commit SHA, default branch tip for repos without releases) and
 * recorded in vendor/microsoft/PINS.json with the newest stable and prerelease release found. No clone is needed:
 * the gitlink is written with `git update-index --cacheinfo`; `git submodule update --init` fetches on demand.
 *   bun factory/bunos/mount-microsoft.ts [--dry]
 */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const dry = process.argv.includes("--dry");

interface Spec {
  name: string;
  repo: string;
  /** Stable tag to pin; undefined pins the default-branch tip. */
  tag?: string;
  /** Also record (not pin) these prerelease tags. */
  pre?: string;
  /** Big repositories are never checked out by `submodule update` unless named explicitly. */
  big?: boolean;
  why: string;
}

const SPECS: Spec[] = [
  {
    name: "microsoft-ui-xaml",
    repo: "microsoft/microsoft-ui-xaml",
    tag: "winui3/release/1.8.12",
    pre: "winui3/release/2.5.4-experimental",
    big: true,
    why: "WinUI 3 controls, XAML framework source",
  },
  {
    name: "WindowsAppSDK",
    repo: "microsoft/WindowsAppSDK",
    tag: "v2.6.4",
    pre: "v2.5.4-exp",
    big: true,
    why: "Windows App SDK specs, API surface and docs",
  },
  {
    name: "WindowsAppSDK-Samples",
    repo: "microsoft/WindowsAppSDK-Samples",
    big: true,
    why: "Windows App SDK feature samples (C++, C#)",
  },
  { name: "WinUI-Gallery", repo: "microsoft/WinUI-Gallery", tag: "v3.0.4", why: "WinUI Gallery: one page per control" },
  {
    name: "DirectX-Graphics-Samples",
    repo: "microsoft/DirectX-Graphics-Samples",
    big: true,
    why: "Direct3D 12 samples",
  },
  { name: "DirectXTK12", repo: "microsoft/DirectXTK12", tag: "may2026", why: "DirectX Tool Kit for D3D12" },
  { name: "DirectX-Specs", repo: "microsoft/DirectX-Specs", why: "D3D12 functional specifications" },
  {
    name: "DirectXShaderCompiler",
    repo: "microsoft/DirectXShaderCompiler",
    tag: "v1.9.2609",
    pre: "v1.10.2605.37",
    big: true,
    why: "DXC HLSL compiler (D3D12 shaders)",
  },
  {
    name: "Windows-universal-samples",
    repo: "microsoft/Windows-universal-samples",
    tag: "v19.0.2",
    why: "UWP/WinRT API samples",
  },
  { name: "Windows-classic-samples", repo: "microsoft/Windows-classic-samples", why: "Win32/COM classic samples" },
  { name: "dotnet-samples", repo: "dotnet/samples", big: true, why: "Official .NET samples" },
  {
    name: "windows-rs",
    repo: "microsoft/windows-rs",
    tag: "74",
    big: true,
    why: "Rust for Windows projections and samples",
  },
  { name: "cppwinrt", repo: "microsoft/cppwinrt", tag: "3.0.260818.1", why: "C++/WinRT" },
  { name: "CsWinRT", repo: "microsoft/CsWinRT", tag: "2.3.1.260716.1", pre: "3.0.0-preview.260319.2", why: "C#/WinRT" },
];

const gh = async (path: string, jq: string) => {
  const p = Bun.spawn(["gh", "api", path, "--jq", jq], { stdout: "pipe", stderr: "pipe" });
  const [o, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code) throw new Error(`gh api ${path} failed`);
  return o.trim();
};
const git = async (...a: string[]) => {
  const p = Bun.spawn(["git", ...a], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`git ${a.join(" ")}: ${e}`);
  return o.trim();
};

const pins: Record<string, unknown> = {};
for (const s of SPECS) {
  const meta = JSON.parse(await gh(`repos/${s.repo}`, "{b:.default_branch,kb:.size,pushed:.pushed_at}"));
  const ref = s.tag ?? meta.b;
  const sha = await gh(`repos/${s.repo}/commits/${encodeURIComponent(ref)}`, ".sha");
  const date = await gh(`repos/${s.repo}/commits/${sha}`, ".commit.committer.date");
  const tip = await gh(`repos/${s.repo}/commits/${meta.b}`, ".sha");
  const pre = s.pre ? await gh(`repos/${s.repo}/commits/${encodeURIComponent(s.pre)}`, ".sha") : undefined;
  pins[s.name] = {
    repo: s.repo,
    ref,
    sha,
    commitDate: date,
    defaultBranch: meta.b,
    defaultBranchTip: tip,
    sizeKB: meta.kb,
    prerelease: s.pre ? { tag: s.pre, sha: pre } : undefined,
    big: !!s.big,
    why: s.why,
  };
  console.log(`${s.name} ${ref} ${sha.slice(0, 12)} ${meta.kb}KB`);
}
if (dry) process.exit(0);

await Bun.write(
  join(root, "vendor/microsoft/PINS.json"),
  JSON.stringify({ observedAt: new Date().toISOString().slice(0, 10), pins }, null, 2) + "\n",
);

// .gitmodules
const gmPath = join(root, ".gitmodules");
let gm = await Bun.file(gmPath).text();
for (const s of SPECS) {
  const path = `vendor/microsoft/${s.name}`;
  if (gm.includes(`[submodule "${path}"]`)) continue;
  gm =
    gm.replace(/\n*$/, "\n") +
    `[submodule "${path}"]\n\tpath = ${path}\n\turl = https://github.com/${s.repo}.git\n\tshallow = true\n${s.big ? "\tupdate = none\n" : ""}`;
}
await Bun.write(gmPath, gm);
for (const s of SPECS)
  await git("update-index", "--add", "--cacheinfo", `160000,${(pins[s.name] as any).sha},vendor/microsoft/${s.name}`);

// components.json
const cPath = join(root, "factory/bunos/components.json");
const comp = await Bun.file(cPath).json();
for (const s of SPECS) {
  const id = `submodule:vendor/microsoft/${s.name}`;
  if (comp.modules.some((m: any) => m.id === id)) continue;
  comp.modules.push({
    id,
    kind: "submodule",
    path: `vendor/microsoft/${s.name}`,
    source: { type: "submodule", url: `https://github.com/${s.repo}.git`, pin: (pins[s.name] as any).sha },
    registration: ["none"],
    aot: true,
    status: "present",
    dependsOn: ["npm:@aphrody/buncc", "crates.io:windows"],
    consumedBy: ["bun"],
    note: `Official Microsoft reference (${s.why}); test matrix in packages/windows-samples-tests, docs/WINDOWS-SAMPLES.md.`,
  });
}
await Bun.write(cPath, JSON.stringify(comp, null, 2) + "\n");
