// SPDX-License-Identifier: Apache-2.0
/**
 * Native delivery of the showcase. There is no separate Tauri shell: the desktop is `aphrody-app`
 * (`apps/aphrody-app`), which opens the showcase window with `aphrody-app --showcase` (or its
 * "M3 Showcase" help menu entry). That window loads the compiled Bun sidecar `m3-showcase` of this
 * application on a loopback port: one origin for the UI and the API. This script compiles the
 * sidecar and stages it beside the desktop executable, where the desktop looks for it first.
 */
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { runProcess } from "../../../packages/bun-workspace/src/process";
import {
  heavyBuildStatus,
  readFactoryConfig,
  routeHeavyBuild,
  type BuildFactoryStatus,
} from "../../../packages/bun-workspace/src/automation/build-factory";

export const SHOWCASE_ROOT = resolve(import.meta.dir, "..");
export const APHRODY_ROOT = resolve(SHOWCASE_ROOT, "../..");
/** The only desktop application; it hosts the showcase window. */
export const DESKTOP_ROOT = resolve(APHRODY_ROOT, "apps/aphrody-app");
export const CARGO_RUNNER = resolve(APHRODY_ROOT, "scripts/cargo.ts");
/** Staging directory of the compiled sidecars, inside the ignored Cargo target directory. */
export const SIDECAR_STAGING = resolve(APHRODY_ROOT, "target/m3-showcase");
/** One canonical compiler serves either showcase source root. */
const M3_CLI = resolve(APHRODY_ROOT, "packages/m3-bun/bin/m3-bun.ts");

/** The canonical compiler embeds both UI and API in one executable. */
export function sidecarCommand(
  triple: string,
  root = SIDECAR_STAGING,
): string[] {
  const targets: Record<string, string> = {
    "x86_64-unknown-linux-gnu": "linux-x64",
    "aarch64-unknown-linux-gnu": "linux-arm64",
    "x86_64-unknown-linux-musl": "linux-x64-musl",
    "aarch64-unknown-linux-musl": "linux-arm64-musl",
    "x86_64-pc-windows-msvc": "windows-x64",
    "x86_64-apple-darwin": "darwin-x64",
    "aarch64-apple-darwin": "darwin-arm64",
  };
  const target = targets[triple];
  if (!target)
    throw new Error(
      `No native M3 Bun API sidecar target for ${triple}; mobile requires its canonical API host adapter`,
    );
  const suffix = target.startsWith("windows") ? ".exe" : "";
  return [
    process.execPath,
    M3_CLI,
    "compile",
    "--target",
    target,
    "--outfile",
    resolve(root, `m3-showcase-${triple}${suffix}`),
  ];
}

export function assertFactoryHost(status: BuildFactoryStatus): void {
  if (
    !status.configured ||
    !status.enabled ||
    status.route !== "local" ||
    status.host !== status.target
  )
    throw new Error(
      "Native host compilation must execute through the configured Workspace build factory. Local Cargo flags do not authorize host builds.",
    );
}

export interface ShowcaseHostPlan {
  platform: string;
  arch: string;
  /** The desktop that opens the window. */
  desktopOwner: string;
  /** How the desktop shows the showcase. */
  launch: string;
  apiOwner: string;
  execution: "workspace-build-factory" | "local";
  missing: string[];
}

export function showcaseHostPlan(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  which = Bun.which,
  showcaseRoot = SHOWCASE_ROOT,
): ShowcaseHostPlan {
  const missing: string[] = [];
  const sidecar = args[0] === "sidecar";
  if (sidecar && !which("cargo"))
    missing.push("The Rust Cargo toolchain is missing");
  if (sidecar && !which("rustc")) missing.push("The Rust compiler is missing");
  return {
    platform,
    arch: process.arch,
    desktopOwner: DESKTOP_ROOT,
    launch: "aphrody-app --showcase",
    apiOwner: showcaseRoot,
    execution: sidecar ? "workspace-build-factory" : "local",
    missing,
  };
}

async function runSidecar(showcaseRoot: string): Promise<void> {
  let triple =
    process.env.BUN_OS_M3_TARGET ?? process.env.APHRODY_M3_TAURI_TARGET;
  if (!triple) {
    const rust = await runProcess(["rustc", "-vV"], APHRODY_ROOT, {
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
    });
    const output = rust.stdout;
    if (rust.code !== 0)
      throw new Error("Cannot qualify the installed Rust host triple");
    triple = output.match(/^host: (.+)$/m)?.[1];
  }
  if (!triple) throw new Error("Missing native target triple");
  const command = sidecarCommand(triple);
  await mkdir(SIDECAR_STAGING, { recursive: true });
  const child = await runProcess(command, showcaseRoot, {
    timeoutMs: 1_800_000,
    maxOutputBytes: 32 * 1024 * 1024,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = child.code;
  if (code !== 0)
    throw new Error(`Native API sidecar compilation failed with exit ${code}`);
  // The desktop resolves its sidecar beside its own executable. Metadata runs through the same
  // native Cargo owner, after factory admission.
  const metadata = await runProcess(
    [
      process.execPath,
      CARGO_RUNNER,
      "exec",
      "--",
      "metadata",
      "--locked",
      "--offline",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      resolve(DESKTOP_ROOT, "Cargo.toml"),
    ],
    APHRODY_ROOT,
    { timeoutMs: 120_000, maxOutputBytes: 16 * 1024 * 1024, stderr: "inherit" },
  );
  const output = metadata.stdout;
  if (metadata.code !== 0)
    throw new Error("Cannot qualify the native desktop artifact directory");
  const targetDir = (JSON.parse(output) as { target_directory: string })
    .target_directory;
  const profile =
    process.env.BUN_OS_M3_PROFILE ??
    process.env.APHRODY_M3_TAURI_PROFILE ??
    "release";
  if (!["debug", "release"].includes(profile))
    throw new Error("Unsupported native desktop artifact profile");
  const suffix = triple.includes("windows") ? ".exe" : "";
  const beside = resolve(
    targetDir,
    ...((process.env.BUN_OS_M3_TARGET ?? process.env.APHRODY_M3_TAURI_TARGET)
      ? [triple]
      : []),
    profile,
    `m3-showcase${suffix}`,
  );
  await Bun.write(beside, Bun.file(command.at(-1)!));
}

export async function runTauri(
  input: string[] = [],
  showcaseRoot = SHOWCASE_ROOT,
): Promise<void> {
  const planOnly = input.includes("--plan");
  const args = input.filter((arg) => arg !== "--plan");
  if (args.length === 0) args.push("info");
  if (args[0] !== "info" && args[0] !== "sidecar")
    throw new Error(
      "Use an explicit owner command: info or sidecar. The existing desktop aphrody-app opens the showcase with --showcase; no separate Rust shell is generated",
    );
  const plan = showcaseHostPlan(
    args,
    process.platform,
    Bun.which,
    showcaseRoot,
  );
  if (planOnly || args[0] === "info") {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.missing.length) throw new Error(plan.missing.join("\n"));
  const dispatched = await routeHeavyBuild(
    [
      "bun",
      relative(
        APHRODY_ROOT,
        resolve(showcaseRoot, "scripts/tauri.ts"),
      ).replaceAll("\\", "/"),
      ...args,
    ],
    APHRODY_ROOT,
  );
  if (dispatched !== undefined) {
    if (dispatched !== 0)
      throw new Error(`Native build factory failed with exit ${dispatched}`);
    return;
  }
  const factory = await readFactoryConfig(APHRODY_ROOT);
  assertFactoryHost(heavyBuildStatus(factory, process.env, false));
  await runSidecar(showcaseRoot);
}

if (import.meta.main) {
  try {
    await runTauri(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
