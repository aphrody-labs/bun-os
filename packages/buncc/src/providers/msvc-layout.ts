/**
 * MSVC layout provider (id `msvc-layout`; the registry default `msvc` runs vcvarsall.bat, this one never does): finds Visual Studio / Build Tools instances (vswhere, then a folder scan when vswhere is absent),
 * MSVC toolsets and the Windows SDK, computes the environment `vcvarsall.bat` would set without running a .bat,
 * caches it, and plans installation through the Visual Studio Installer or winget.
 *
 * Layout reference: https://learn.microsoft.com/cpp/build/building-on-the-command-line
 *                   https://learn.microsoft.com/visualstudio/install/use-command-line-parameters-to-install-visual-studio
 *                   https://learn.microsoft.com/windows/package-manager/winget/
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { cacheDir } from "../lock.ts";
import { run } from "../process.ts";
import { compareVersions } from "./types.ts";
import type { Context, Detection, InstallPlan, Provider } from "./types.ts";
import { hostArch, missing, pathVar, pinFromToolchain, prependPath } from "./_shared.ts";

export type MsvcArch = "x64" | "x86" | "arm64" | "arm";

export interface VsInstance {
  id?: string;
  path: string;
  /** e.g. 17.14.12 or 18.0.x */
  version: string;
  displayName: string;
  /** Microsoft.VisualStudio.Product.BuildTools, ...Community, ... */
  product: string;
  prerelease: boolean;
}

export function programFilesX86(env: Record<string, string | undefined> = Bun.env): string {
  return env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
}

/** vswhere ships with Visual Studio 2017+ at this fixed location (Microsoft Learn: tools-for-managing-visual-studio-instances). */
export function vswherePath(env: Record<string, string | undefined> = Bun.env): string | undefined {
  const path = join(programFilesX86(env), "Microsoft Visual Studio", "Installer", "vswhere.exe");
  return existsSync(path) ? path : (Bun.which("vswhere") ?? undefined);
}

export const VC_TOOLS_COMPONENT = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64";

/** vswhere arguments that find the newest instance with the C++ x64 toolset, including prereleases on request. */
export function vswhereArgs(prerelease = false): string[] {
  const args = ["-latest", "-products", "*", "-requires", VC_TOOLS_COMPONENT, "-format", "json", "-utf8"];
  if (prerelease) args.push("-prerelease");
  return args;
}

/** The newest instance that has the C++ x64 toolset; the one vswhere query behind vcvarsall, cargo and the driver. */
export async function findVisualStudio(
  env: Record<string, string | undefined> = Bun.env,
  prerelease = false,
): Promise<VsInstance | null> {
  const vswhere = vswherePath(env);
  if (!vswhere) return null;
  const result = await run([vswhere, ...vswhereArgs(prerelease)], { output: "capture", timeoutMs: 30_000 });
  if (result.code !== 0) return null;
  return parseVswhere(result.stdout)[0] ?? null;
}

export function parseVswhere(json: string): VsInstance[] {
  let rows: {
    instanceId?: string;
    installationPath: string;
    installationVersion: string;
    displayName?: string;
    productId?: string;
    isPrerelease?: boolean;
  }[];
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    rows = value.filter(r => typeof r?.installationPath === "string");
  } catch {
    return [];
  }
  return rows.map(r => ({
    id: r.instanceId,
    path: r.installationPath,
    version: r.installationVersion,
    displayName: r.displayName ?? r.productId ?? "Visual Studio",
    product: r.productId ?? "",
    prerelease: !!r.isPrerelease,
  }));
}

/** Folder scan of `Microsoft Visual Studio\<year>\<edition>`, used when vswhere is missing. */
export function scanInstances(env: Record<string, string | undefined> = Bun.env): VsInstance[] {
  const out: VsInstance[] = [];
  for (const base of [env.ProgramFiles ?? "C:\\Program Files", programFilesX86(env)]) {
    const root = join(base, "Microsoft Visual Studio");
    let years: string[] = [];
    try {
      years = readdirSync(root);
    } catch {
      continue;
    }
    for (const year of years) {
      if (!/^\d{4}$|^\d+$/.test(year)) continue;
      let editions: string[] = [];
      try {
        editions = readdirSync(join(root, year));
      } catch {}
      for (const edition of editions) {
        const path = join(root, year, edition);
        if (!existsSync(join(path, "VC", "Tools", "MSVC")) && !existsSync(join(path, "Common7"))) continue;
        out.push({
          path,
          version: year,
          displayName: `Visual Studio ${year} ${edition}`,
          product: `Microsoft.VisualStudio.Product.${edition}`,
          prerelease: edition === "Preview",
        });
      }
    }
  }
  return out;
}

export async function listInstances(ctx?: Pick<Context, "env">): Promise<VsInstance[]> {
  const env = ctx?.env ?? Bun.env;
  const vswhere = vswherePath(env);
  if (vswhere) {
    const result = await run([vswhere, "-all", "-prerelease", "-products", "*", "-format", "json", "-utf8"], {
      output: "capture",
      timeoutMs: 30_000,
    });
    if (result.code === 0) {
      try {
        const found = parseVswhere(result.stdout || "[]");
        if (found.length) return found.sort((a, b) => compareVersions(b.version, a.version));
      } catch {}
    }
  }
  return scanInstances(env).sort((a, b) => compareVersions(b.version, a.version));
}

export function msvcToolsets(instance: Pick<VsInstance, "path">): string[] {
  try {
    return readdirSync(join(instance.path, "VC", "Tools", "MSVC"))
      .filter(n => /^\d+\.\d+\.\d+/.test(n))
      .sort(compareVersions);
  } catch {
    return [];
  }
}

export function defaultToolset(instance: Pick<VsInstance, "path">): string | undefined {
  const file = join(instance.path, "VC", "Auxiliary", "Build", "Microsoft.VCToolsVersion.default.txt");
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** `14.44.35207` exact, `14.44` prefix, or undefined for the instance default (then the newest). */
export function pickToolset(instance: Pick<VsInstance, "path">, wanted?: string): string | undefined {
  const all = msvcToolsets(instance);
  if (wanted) {
    const exact = all.find(v => v === wanted);
    if (exact) return exact;
    return all.filter(v => v.startsWith(`${wanted}.`) || v === wanted).at(-1);
  }
  const def = defaultToolset(instance);
  return def && all.includes(def) ? def : all.at(-1);
}

export interface WindowsSdk {
  root: string;
  version: string;
}

/** SDKs with headers (um\Windows.h) installed under `Windows Kits\10`, newest last. */
export function windowsSdks(env: Record<string, string | undefined> = Bun.env, arch?: MsvcArch): WindowsSdk[] {
  const root = join(programFilesX86(env), "Windows Kits", "10");
  let versions: string[] = [];
  try {
    versions = readdirSync(join(root, "Include"));
  } catch {
    return [];
  }
  return versions
    .filter(v => /^\d+\.\d+\.\d+\.\d+$/.test(v))
    .filter(v => existsSync(join(root, "Include", v, "um", "Windows.h")))
    .filter(v => !arch || existsSync(join(root, "Lib", v, "um", arch)))
    .sort(compareVersions)
    .map(version => ({ root, version }));
}

export function pickSdk(sdks: WindowsSdk[], wanted?: string): WindowsSdk | undefined {
  if (!wanted) return sdks.at(-1);
  return sdks
    .filter(s => s.version === wanted || s.version.startsWith(`${wanted}.`) || s.version.startsWith(wanted))
    .at(-1);
}

export interface Selection {
  arch?: MsvcArch;
  host?: MsvcArch;
  toolset?: string;
  sdk?: string;
  instance?: string;
}

export interface Toolchain {
  instance: VsInstance;
  toolset: string;
  sdk: WindowsSdk;
  arch: MsvcArch;
  host: MsvcArch;
}

function normalizeArch(value: string | undefined): MsvcArch | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === "x64" || v === "amd64" || v === "x86_64") return "x64";
  if (v === "x86" || v === "i386" || v === "ia32") return "x86";
  if (v === "arm64" || v === "aarch64") return "arm64";
  if (v === "arm") return "arm";
  return undefined;
}

export function normalizeArchStrict(value: string): MsvcArch {
  const arch = normalizeArch(value);
  if (!arch) throw new Error(`unknown architecture ${JSON.stringify(value)} (x64, x86, arm64, arm)`);
  return arch;
}

const HOST_DIR: Record<MsvcArch, string> = { x64: "Hostx64", x86: "Hostx86", arm64: "Hostarm64", arm: "Hostarm" };

export async function resolveToolchain(
  sel: Selection = {},
  ctx?: Pick<Context, "env">,
): Promise<Toolchain | undefined> {
  const env = ctx?.env ?? Bun.env;
  const arch = sel.arch ? normalizeArchStrict(sel.arch) : hostArch();
  const host = sel.host ? normalizeArchStrict(sel.host) : hostArch();
  let instances = await listInstances(ctx);
  if (sel.instance) {
    const q = sel.instance.toLowerCase();
    instances = instances.filter(
      i =>
        i.id === sel.instance ||
        i.path.toLowerCase() === q ||
        i.product.toLowerCase().includes(q) ||
        i.displayName.toLowerCase().includes(q) ||
        i.version.startsWith(sel.instance!),
    );
  }
  const wanted = sel.toolset ?? env.VCToolsVersion;
  for (const instance of instances) {
    const toolset = pickToolset(instance, wanted);
    if (!toolset) continue;
    const sdk = pickSdk(windowsSdks(env, arch), sel.sdk ?? env.WindowsSDKVersion?.replace(/\\$/, ""));
    if (!sdk) continue;
    return { instance, toolset, sdk, arch, host };
  }
  return undefined;
}

export interface ComputedEnv {
  set: Record<string, string>;
  prepend: Record<string, string[]>;
}

const keepExisting = (dirs: string[]) => dirs.filter(d => existsSync(d));

/**
 * What `vcvarsall.bat <arch>` would set, computed from the on-disk layout. Only directories that exist are listed.
 */
export function computeEnv(tc: Toolchain): ComputedEnv {
  const { instance, toolset, sdk, arch, host } = tc;
  const vc = join(instance.path, "VC");
  const msvc = join(vc, "Tools", "MSVC", toolset);
  const kit = sdk.root;
  const v = sdk.version;
  const sdkBin = join(kit, "bin", v, host);
  const include = keepExisting([
    join(msvc, "include"),
    join(msvc, "ATLMFC", "include"),
    join(vc, "Auxiliary", "VS", "include"),
    join(kit, "Include", v, "ucrt"),
    join(kit, "Include", v, "shared"),
    join(kit, "Include", v, "um"),
    join(kit, "Include", v, "winrt"),
    join(kit, "Include", v, "cppwinrt"),
  ]);
  const lib = keepExisting([
    join(msvc, "lib", arch),
    join(msvc, "ATLMFC", "lib", arch),
    join(vc, "Auxiliary", "VS", "lib", arch),
    join(kit, "Lib", v, "ucrt", arch),
    join(kit, "Lib", v, "um", arch),
  ]);
  const libpath = keepExisting([
    join(msvc, "lib", arch),
    join(msvc, "ATLMFC", "lib", arch),
    join(kit, "UnionMetadata", v),
    join(kit, "References", v),
  ]);
  const path = keepExisting([
    join(msvc, "bin", HOST_DIR[host], arch),
    ...(host !== arch ? [join(msvc, "bin", HOST_DIR[host], host)] : []),
    sdkBin,
    join(kit, "bin", v, arch),
    join(instance.path, "Common7", "IDE"),
    join(instance.path, "Common7", "Tools"),
    join(instance.path, "MSBuild", "Current", "Bin"),
    join(instance.path, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin"),
    join(instance.path, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja"),
  ]);
  const major = instance.version.split(".")[0] ?? "";
  return {
    set: {
      VSINSTALLDIR: instance.path + "\\",
      VCINSTALLDIR: vc + "\\",
      VCToolsInstallDir: msvc + "\\",
      VCToolsVersion: toolset,
      VisualStudioVersion: instance.version.split(".").slice(0, 2).join("."),
      [`VS${major}0COMNTOOLS`]: join(instance.path, "Common7", "Tools") + "\\",
      DevEnvDir: join(instance.path, "Common7", "IDE") + "\\",
      Platform: arch,
      VSCMD_ARG_HOST_ARCH: host,
      VSCMD_ARG_TGT_ARCH: arch,
      WindowsSdkDir: kit + "\\",
      WindowsSDKVersion: v + "\\",
      WindowsSdkBinPath: join(kit, "bin") + "\\",
      UniversalCRTSdkDir: kit + "\\",
      UCRTVersion: v,
    },
    prepend: { PATH: path, INCLUDE: include, LIB: lib, LIBPATH: libpath },
  };
}

/** Merge a computed environment over a base (PATH-style lists get the new entries first). */
export function applyEnv(base: Record<string, string | undefined>, computed: ComputedEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  for (const [k, v] of Object.entries(computed.set)) out[k] = v;
  for (const [k, dirs] of Object.entries(computed.prepend)) {
    out[k] =
      k === "PATH" ? prependPath(out.PATH ?? out.Path, dirs) : [...dirs, ...(out[k] ? [out[k]] : [])].join(delimiter);
  }
  return out;
}

export type EnvFormat = "json" | "pwsh" | "cmd" | "sh" | "github";

function shQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function toMsysPath(p: string) {
  return p.replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
}

export function formatEnv(
  computed: ComputedEnv,
  format: EnvFormat,
  base: Record<string, string | undefined> = Bun.env,
): string {
  const lines: string[] = [];
  const lists = Object.entries(computed.prepend).filter(([, v]) => v.length);
  switch (format) {
    case "json":
      return JSON.stringify({ set: computed.set, prepend: computed.prepend }, null, 2);
    case "pwsh":
      for (const [k, v] of Object.entries(computed.set)) lines.push(`$env:${k} = '${v.replace(/'/g, "''")}'`);
      for (const [k, d] of lists)
        lines.push(`$env:${k} = '${d.join(delimiter).replace(/'/g, "''")}' + ';' + $env:${k}`);
      return lines.join("\n");
    case "cmd":
      for (const [k, v] of Object.entries(computed.set)) lines.push(`set "${k}=${v}"`);
      for (const [k, d] of lists) lines.push(`set "${k}=${d.join(";")};%${k}%"`);
      return lines.join("\r\n");
    case "sh":
      for (const [k, v] of Object.entries(computed.set)) lines.push(`export ${k}=${shQuote(v)}`);
      for (const [k, d] of lists)
        lines.push(
          k === "PATH"
            ? `export PATH=${shQuote(d.map(toMsysPath).join(":"))}":$PATH"`
            : `export ${k}=${shQuote(d.join(";"))}`,
        );
      return lines.join("\n");
    case "github": {
      const merged = applyEnv(base, computed);
      for (const k of [...Object.keys(computed.set), ...Object.keys(computed.prepend)])
        lines.push(`${k}=${merged[k] ?? ""}`);
      return lines.join("\n");
    }
  }
}

/** Fingerprint of everything the computed environment depends on: changes when a toolset or SDK is added or removed. */
export function fingerprint(tc: Toolchain): string {
  const parts = [
    tc.instance.path,
    tc.instance.version,
    tc.toolset,
    tc.sdk.version,
    msvcToolsets(tc.instance).join(","),
    safeMtime(join(tc.instance.path, "VC", "Tools", "MSVC")),
    safeMtime(join(tc.instance.path, "VC", "Auxiliary", "Build")),
    safeMtime(join(tc.sdk.root, "Include")),
    safeMtime(join(tc.sdk.root, "Lib")),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function safeMtime(path: string): string {
  try {
    return String(statSync(path).mtimeMs);
  } catch {
    return "0";
  }
}

/** Write env.json/env.cmd/env.ps1/env.sh under the cache; rewritten only when the fingerprint changed (or `force`). */
export function syncCache(
  tc: Toolchain,
  options: { dir?: string; force?: boolean } = {},
): { dir: string; written: boolean } {
  const key = [
    tc.arch,
    tc.host !== hostArch() ? `host-${tc.host}` : "",
    `toolset-${tc.toolset}`,
    `sdk-${tc.sdk.version}`,
  ]
    .filter(Boolean)
    .join("-");
  const dir = join(options.dir ?? join(cacheDir(), "msvc"), key);
  const computed = computeEnv(tc);
  const fp = fingerprint(tc);
  const jsonFile = join(dir, "env.json");
  if (!options.force && existsSync(jsonFile)) {
    try {
      if ((JSON.parse(readFileSync(jsonFile, "utf8")) as { fingerprint?: string }).fingerprint === fp)
        return { dir, written: false };
    } catch {}
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(jsonFile, JSON.stringify({ fingerprint: fp, ...computed }, null, 2));
  writeFileSync(join(dir, "env.cmd"), formatEnv(computed, "cmd"));
  writeFileSync(join(dir, "env.ps1"), formatEnv(computed, "pwsh"));
  writeFileSync(join(dir, "env.sh"), formatEnv(computed, "sh"));
  return { dir, written: true };
}

export function toolPath(tc: Toolchain, tool: string): string | undefined {
  const computed = computeEnv(tc);
  const name = /\.[a-z]+$/i.test(tool) ? tool : `${tool}.exe`;
  for (const dir of computed.prepend.PATH ?? []) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const COMPONENT_VC_TOOLS = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64";
const WORKLOAD_VCTOOLS = "Microsoft.VisualStudio.Workload.VCTools";

export function sdkComponent(version: string): string {
  const build = version.split(".")[2];
  return `Microsoft.VisualStudio.Component.Windows11SDK.${build}`;
}

export interface SetupOptions {
  instance?: VsInstance;
  arch?: MsvcArch;
  toolset?: string;
  sdk?: string;
  add?: string[];
  product?: "buildtools" | "community" | "professional" | "enterprise";
  repair?: boolean;
  update?: boolean;
}

/** Installer commands. With an instance: `setup.exe modify/repair/update`; without: winget installs Build Tools or the IDE. */
export function setupCommands(o: SetupOptions, env: Record<string, string | undefined> = Bun.env): string[][] {
  const installer = join(programFilesX86(env), "Microsoft Visual Studio", "Installer", "setup.exe");
  const components = new Set<string>([COMPONENT_VC_TOOLS, ...(o.add ?? [])]);
  if (o.arch === "arm64") components.add("Microsoft.VisualStudio.Component.VC.Tools.ARM64");
  if (o.arch === "arm") components.add("Microsoft.VisualStudio.Component.VC.Tools.ARM");
  // Versioned component ids carry the Visual Studio minor: `14.44.17.14` -> VC.14.44.17.14.x86.x64 (or .ARM64).
  if (o.toolset && /^\d+\.\d+\.\d+\.\d+$/.test(o.toolset)) {
    components.add(`Microsoft.VisualStudio.Component.VC.${o.toolset}.${o.arch === "arm64" ? "ARM64" : "x86.x64"}`);
  }
  if (o.sdk) components.add(sdkComponent(o.sdk));
  else components.add("Microsoft.VisualStudio.Component.Windows11SDK.26100");
  if (o.instance) {
    if (o.repair) return [[installer, "repair", "--installPath", o.instance.path, "--quiet", "--norestart", "--force"]];
    if (o.update) return [[installer, "update", "--installPath", o.instance.path, "--quiet", "--norestart"]];
    return [
      [
        installer,
        "modify",
        "--installPath",
        o.instance.path,
        ...[...components].flatMap(c => ["--add", c]),
        "--quiet",
        "--norestart",
      ],
    ];
  }
  const id = {
    buildtools: "Microsoft.VisualStudio.BuildTools",
    community: "Microsoft.VisualStudio.Community",
    professional: "Microsoft.VisualStudio.Professional",
    enterprise: "Microsoft.VisualStudio.Enterprise",
  }[o.product ?? "buildtools"];
  const override = [
    "--quiet",
    "--wait",
    "--norestart",
    "--add",
    WORKLOAD_VCTOOLS,
    "--includeRecommended",
    ...[...components].flatMap(c => ["--add", c]),
  ].join(" ");
  return [
    [
      "winget",
      "install",
      "--id",
      id,
      "--exact",
      "--source",
      "winget",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--override",
      override,
    ],
  ];
}

/** Installer exit codes 3010 and 1641 mean success with a reboot pending. */
export function interpretInstallerExit(code: number): "ok" | "reboot" | "failed" {
  return code === 0 ? "ok" : code === 3010 || code === 1641 ? "reboot" : "failed";
}

export async function detectMsvc(ctx: Pick<Context, "env"> & Partial<Context>): Promise<Detection> {
  const tc = await resolveToolchain({}, ctx);
  if (!tc) {
    return missing(
      "buncc install msvc   (winget install Microsoft.VisualStudio.BuildTools with the C++ workload and a Windows SDK)",
    );
  }
  const cl = toolPath(tc, "cl");
  const notes = [`${tc.instance.displayName} ${tc.instance.version}`, `Windows SDK ${tc.sdk.version}`];
  if (!cl) notes.push("cl.exe missing for this target");
  return { found: !!cl, path: cl, version: tc.toolset, notes, fixHint: cl ? undefined : "buncc install msvc" };
}

export const msvcLayoutProvider: Provider = {
  id: "msvc-layout",
  description:
    "MSVC toolset and Windows SDK selection, vcvars environment computed from the layout (no .bat), installer plan",
  platforms: ["win32"],
  detect: detectMsvc,
  install: (ctx): InstallPlan => ({ commands: setupCommands({}, ctx.env) }),
  async env(ctx) {
    const wanted = await pinFromToolchain(ctx, "msvc");
    const tc = await resolveToolchain({ toolset: wanted }, ctx);
    if (!tc) return {};
    const merged = applyEnv({ PATH: pathVar(ctx) }, computeEnv(tc));
    const out: Record<string, string> = {};
    for (const key of [...Object.keys(computeEnv(tc).set), ...Object.keys(computeEnv(tc).prepend)])
      if (merged[key] !== undefined) out[key] = merged[key]!;
    return out;
  },
  pin: ctx => pinFromToolchain(ctx, "msvc"),
};

/** Alias kept for callers that import the provider by its old name. */
export const msvcProvider = msvcLayoutProvider;
