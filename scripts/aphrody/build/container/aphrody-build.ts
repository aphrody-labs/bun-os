#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * aphrody-build: the single VPS build image for Aphrody
 * (tools/config/container/build/Dockerfile).
 *
 *   bun scripts/aphrody/build/container/aphrody-build.ts image                 # build + tag (versioned, latest)
 *   bun scripts/aphrody/build/container/aphrody-build.ts run [options] -- CMD   # run CMD on a bind-mounted checkout
 *
 * `run` options:
 *   --repo DIR            checkout to mount (default: this repository); mounted at the same absolute path
 *   --target-volume NAME  CARGO_TARGET_DIR on the named volume aphrody-build-target-NAME (CI checkouts
 *                         are cleaned between jobs; the target must survive them)
 *   --env NAME            pass NAME from the caller's environment (value never on the command line)
 *   --host-network        share the host network (loopback services such as a database tunnel)
 *   --no-lock             do not take the factory heavy lock
 *
 * Contract: image `aphrody-build:latest`, caller uid
 * plus the shared build group (gid 1500), named cache volumes aphrody-build-{cargo,sccache,bun,xwin,xdg},
 * bounded resources (APHRODY_BUILD_CPUS, default 6; APHRODY_BUILD_MEMORY, default 16g, no swap) and the
 * factory heavy lock `/home/ubuntu/build/locks/heavy.lock` when it exists.
 *
 * Private Git dependencies: the image's system Git
 * credential helper answers for github.com with `APHRODY_GIT_TOKEN`. `run` resolves it from the
 * caller (APHRODY_GIT_TOKEN, GH_TOKEN, GITHUB_TOKEN, else `gh auth token`) and passes it by name only.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const IMAGE = "aphrody-build";
export const BUILD_GID = 1500;
export const HEAVY_LOCK = "/home/ubuntu/build/locks/heavy.lock";
export const CACHE_VOLUMES = {
  cargo: "/cache/cargo",
  sccache: "/cache/sccache",
  bun: "/cache/bun",
  xwin: "/cache/xwin",
  xdg: "/cache/xdg",
} as const;

const ROOT = resolve(import.meta.dir, "../../../..");
/** Toolchain, runtime and lockfile pins share the canonical workspace owner. */
const PINS = ROOT;
const CONTEXT = "tools/aphrody/config/container/build";

export type Pins = {
  rustChannel: string;
  rustTargets: string[];
  rustComponents: string[];
  bun: string;
  bunRelease: string;
  wasmBindgen: string;
};

/** Pins from the repository manifests: the image always matches what the checkout declares. */
export function readPins(toolchain: string, packageJson: string, cargoLock: string): Pins {
  const channel = /^channel\s*=\s*"([^"]+)"/m.exec(toolchain)?.[1];
  const list = (key: string) =>
    [...(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(toolchain)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      m => m[1]!,
    );
  const bunMatch = /^bun@(\d+\.\d+\.\d+)$/.exec(
    (JSON.parse(packageJson) as { packageManager?: string }).packageManager ?? "",
  );
  const bun = bunMatch?.[1];
  const bunRelease = bun ? `bun-v${bun}` : undefined;
  const wasmBindgen = /\[\[package\]\]\r?\nname = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(cargoLock)?.[1];
  if (!channel) throw new Error("rust-toolchain.toml: channel introuvable");
  if (!bun || !bunRelease) throw new Error("package.json: packageManager bun@x.y.z introuvable");
  if (!wasmBindgen) throw new Error("Cargo.lock: wasm-bindgen introuvable");
  return {
    rustChannel: channel,
    rustTargets: list("targets"),
    rustComponents: list("components"),
    bun,
    bunRelease,
    wasmBindgen,
  };
}

export function imageTag(pins: Pins, revision: string): string {
  return `${IMAGE}:${pins.rustChannel}-bun${pins.bun}-${revision.slice(0, 9)}`;
}

export function buildArgs(pins: Pins, revision: string): string[] {
  return [
    "docker",
    "build",
    "--file",
    `${CONTEXT}/Dockerfile`,
    "--build-arg",
    `RUST_CHANNEL=${pins.rustChannel}`,
    "--build-arg",
    `RUST_TARGETS=${pins.rustTargets.join(" ")}`,
    "--build-arg",
    `RUST_COMPONENTS=${pins.rustComponents.join(" ")}`,
    "--build-arg",
    `BUN_VERSION=${pins.bun}`,
    "--build-arg",
    `BUN_RELEASE_VERSION=${pins.bunRelease}`,
    "--build-arg",
    `WASM_BINDGEN_VERSION=${pins.wasmBindgen}`,
    "--label",
    `org.opencontainers.image.revision=${revision}`,
    "--label",
    "org.opencontainers.image.source=https://github.com/aphrody-labs/aphrody",
    "--tag",
    imageTag(pins, revision),
    "--tag",
    `${IMAGE}:latest`,
    CONTEXT,
  ];
}

export type RunOptions = {
  repo: string;
  command: string[];
  uid: number;
  gid: number;
  targetVolume?: string;
  env?: string[];
  hostNetwork?: boolean;
  lock?: boolean;
  cpus?: string;
  memory?: string;
  image?: string;
  tty?: boolean;
};

/** The `docker run` invocation of the shared build contract (see the module comment). */
export function runArgs(o: RunOptions): string[] {
  if (!o.repo.startsWith("/")) throw new Error("--repo doit être un chemin absolu");
  if (o.command.length === 0) throw new Error("commande manquante après --");
  if (o.targetVolume && !/^[a-z0-9][a-z0-9_.-]*$/.test(o.targetVolume))
    throw new Error("--target-volume : nom de volume invalide");
  const cpus = o.cpus ?? "6";
  const memory = o.memory ?? "16g";
  if (!/^\d+(\.\d+)?$/.test(cpus) || Number(cpus) > 6) throw new Error("APHRODY_BUILD_CPUS ≤ 6");
  if (!/^\d+[mg]$/.test(memory)) throw new Error("APHRODY_BUILD_MEMORY : <n>m ou <n>g");
  const env = (o.env ?? []).flatMap(name => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`--env ${name} invalide`);
    return ["--env", name];
  });
  const docker = [
    "docker",
    "run",
    "--rm",
    "--init",
    ...(o.tty ? ["-it"] : []),
    "--pull=never",
    "--user",
    `${o.uid}:${o.gid}`,
    "--group-add",
    String(BUILD_GID),
    "--cpus",
    cpus,
    "--cpu-shares",
    "512",
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--pids-limit",
    "8192",
    "--oom-score-adj",
    "500",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    ...(o.hostNetwork ? ["--network", "host"] : []),
    "--volume",
    `${o.repo}:${o.repo}`,
    "--workdir",
    o.repo,
    ...Object.entries(CACHE_VOLUMES).flatMap(([name, path]) => ["--volume", `${IMAGE}-${name}:${path}`]),
    ...(o.targetVolume
      ? ["--volume", `${IMAGE}-target-${o.targetVolume}:/cache/target`, "--env", "CARGO_TARGET_DIR=/cache/target"]
      : []),
    ...env,
    o.image ?? `${IMAGE}:latest`,
    ...o.command,
  ];
  return o.lock === false || !existsSync(HEAVY_LOCK) ? docker : ["flock", "--close", HEAVY_LOCK, ...docker];
}

/** Token for the image's github.com credential helper, from the caller's environment or `gh`. */
export function gitToken(env: Record<string, string | undefined>, gh: () => string | undefined): string | undefined {
  return env.APHRODY_GIT_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN || gh() || undefined;
}

function ghToken(): string | undefined {
  if (!Bun.which("gh")) return undefined;
  const p = Bun.spawnSync(["gh", "auth", "token"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "ignore",
  });
  return p.exitCode === 0 ? p.stdout.toString().trim() : undefined;
}

function git(args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], {
    windowsHide: true,
    cwd: ROOT,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} : code ${p.exitCode}`);
  return p.stdout.toString().trim();
}

async function image(): Promise<void> {
  const pins = readPins(
    await Bun.file(`${PINS}/rust-toolchain.toml`).text(),
    await Bun.file(`${PINS}/package.json`).text(),
    await Bun.file(`${ROOT}/Cargo.lock`).text(),
  );
  const revision = git(["rev-parse", "HEAD"]);
  const started = performance.now();
  const p = Bun.spawnSync(buildArgs(pins, revision), {
    windowsHide: true,
    cwd: ROOT,
    env: { ...process.env, DOCKER_BUILDKIT: "1" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
  const inspect = Bun.spawnSync(
    ["docker", "image", "inspect", "--format", "{{.Id}} {{.Size}}", imageTag(pins, revision)],
    { windowsHide: true, stdout: "pipe" },
  );
  const [id, size] = inspect.stdout.toString().trim().split(" ");
  console.log(
    JSON.stringify({
      image: imageTag(pins, revision),
      latest: `${IMAGE}:latest`,
      id,
      bytes: Number(size),
      seconds: Math.round((performance.now() - started) / 1000),
    }),
  );
}

function run(argv: string[]): never {
  const split = argv.indexOf("--");
  const flags = split >= 0 ? argv.slice(0, split) : argv;
  const command = split >= 0 ? argv.slice(split + 1) : [];
  const value = (name: string) => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const env: string[] = [];
  flags.forEach((flag, i) => {
    if (flag === "--env") env.push(flags[i + 1] ?? "");
  });
  const token = gitToken(process.env, ghToken);
  if (token && !env.includes("APHRODY_GIT_TOKEN")) env.push("APHRODY_GIT_TOKEN");
  const args = runArgs({
    repo: resolve(value("--repo") ?? ROOT),
    command,
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
    targetVolume: value("--target-volume"),
    env,
    hostNetwork: flags.includes("--host-network"),
    lock: !flags.includes("--no-lock"),
    cpus: process.env.APHRODY_BUILD_CPUS,
    memory: process.env.APHRODY_BUILD_MEMORY,
    tty: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
  const p = Bun.spawnSync(args, {
    windowsHide: true,
    env: token ? { ...process.env, APHRODY_GIT_TOKEN: token } : process.env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(p.exitCode ?? 1);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "image") await image();
  else if (command === "run") run(rest);
  else {
    console.error(
      "usage: aphrody-build.ts image | run [--repo DIR] [--target-volume NAME] [--env NAME]… [--host-network] [--no-lock] -- CMD…",
    );
    process.exit(64);
  }
}
