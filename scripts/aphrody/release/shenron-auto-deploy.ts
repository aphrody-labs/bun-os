#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  factoryResourceAdmissionProgram,
  factoryResourcePolicy,
  type BuildFactoryConfig,
} from "@aphrody/bun-workspace/automation/build-factory.ts";
import { factoryTransientShell } from "@aphrody/bun-workspace/automation/build-factory-cleanup.ts";
import { activeDeployment, deploymentIsCurrent, deploymentSelection } from "./shenron-deployment-identity.ts";
import {
  runSourceControllerLoop,
  startSourceControllerWorker,
  type ControllerWorker,
} from "./shenron-source-controller";

const infra = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const config = JSON.parse(
  readFileSync(process.env.SHENRON_AUTO_DEPLOY_CONFIG ?? join(infra, "tools/aphrody/config/shenron-auto-deploy.json"), "utf8"),
);
const factoryPath = join(infra, "tools/aphrody/config/build-factory.json");
const factory = JSON.parse(readFileSync(factoryPath, "utf8")) as BuildFactoryConfig;
const resources = factoryResourcePolicy(factory);
const env: Record<string, string | undefined> = {
  ...process.env,
  PATH: "/home/ubuntu/.bun/bin:/home/ubuntu/.cargo/bin:/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin",
  SHENRON_BUN_EXECUTABLE: config.bun,
  SHENRON_COMPILE_BUN: config.bun,
  SHENRON_CARGO_REMOTE: "off",
  APHRODY_BUILD_HOST: "vps",
  APHRODY_CARGO_SERIAL: join(infra, "scripts/aphrody/build/rust/cargo-serial.sh"),
  APHRODY_CARGO_TARGET_DIR: join(factory.cacheRoot, "cargo/shenron"),
  CARGO_TARGET_DIR: join(factory.cacheRoot, "cargo/shenron"),
  SCCACHE_DIR: join(factory.cacheRoot, "sccache"),
  BUN_INSTALL_CACHE_DIR: join(factory.cacheRoot, "bun"),
  UV_CACHE_DIR: join(factory.cacheRoot, "uv"),
  APHRODY_CARGO_JOBS: String(resources.jobs),
  CARGO_BUILD_JOBS: String(resources.jobs),
  CARGO_INCREMENTAL: "0",
};

export interface RuntimeExpectation {
  version?: string;
  revision?: string;
  sourceUrl?: string;
}
export interface RuntimeEvidence {
  version: string;
  revision: string;
  sourceUrl: string;
  features: {
    serve: boolean;
    fetch: boolean;
    sqlite: boolean;
    image: boolean;
  };
}
export const runtimeFixture = `
const check=(value)=>{if(!value)throw Error('Native runtime fixture failed')};
let server;let stage='setup';
const reportFailure=()=>console.error(JSON.stringify({schema:'shenron-runtime-failure/v1',stage}));
const watchdog=setTimeout(()=>{reportFailure();process.exit(1)},20000);
try {
  stage='availability';check(typeof Bun.serve==='function'&&typeof Bun.Image==='function'&&typeof Bun.sql==='function');
  stage='http-fixture';
  server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response('public fixture',{headers:{'content-type':'text/plain'}})}});
  stage='fetch';const response=await fetch(server.url.href);check(response.status===200&&(await response.text())==='public fixture');
  stage='sqlite';
  const {Database}=await import('bun:sqlite');const db=new Database(':memory:');
  try{db.run('create table fixture(id integer primary key, name text)');db.run('insert into fixture(name) values (?)',['shenron']);check(db.query('select name from fixture').get().name==='shenron')}finally{db.close()}
  stage='image';
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),(c)=>c.charCodeAt(0));
  const meta=await new Bun.Image(png).metadata();check(meta.width===1&&meta.height===1);
  console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl,features:{serve:true,fetch:true,sqlite:true,image:true}}));
}catch{reportFailure();throw Error('Native runtime fixture failed')}
finally{clearTimeout(watchdog);if(server)await server.stop(true)}
`;
const runtimeFailureStages = new Set(["setup", "availability", "http-fixture", "fetch", "sqlite", "image"]);
function runtimeFailureStage(stderr: string): string {
  for (const line of stderr.split("\n")) {
    try {
      const failure = JSON.parse(line);
      if (failure?.schema === "shenron-runtime-failure/v1" && runtimeFailureStages.has(failure.stage))
        return ` (stage: ${failure.stage})`;
    } catch {
      // Only the fixture's structured stage is retained; raw child diagnostics stay private.
    }
  }
  return "";
}
type RuntimeProbe = (args: string[], environment: Record<string, string | undefined>) => Promise<string>;
async function readProbeOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Each read depends on the preceding chunk and its byte budget.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new Error("Native runtime qualification output exceeded limit");
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    reader.releaseLock();
  }
}

export async function probe(
  args: string[],
  environment: Record<string, string | undefined>,
  timeoutMs = 30_000,
): Promise<string> {
  const child = Bun.spawn(args, {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(timeoutMs),
    killSignal: "SIGKILL",
  });
  let output: [string, string, number];
  try {
    output = await Promise.all([readProbeOutput(child.stdout), readProbeOutput(child.stderr), child.exited]);
  } catch {
    child.kill("SIGKILL");
    await child.exited;
    throw new Error("Native runtime qualification failed");
  }
  const [stdout, stderr, status] = output;
  if (status !== 0) throw new Error("Native runtime qualification failed" + runtimeFailureStage(stderr));
  return stdout;
}
export function runtimeEvidence(output: string, expected: RuntimeExpectation = {}): RuntimeEvidence {
  const result = JSON.parse(output) as RuntimeEvidence;
  if (
    !result ||
    typeof result.version !== "string" ||
    typeof result.revision !== "string" ||
    typeof result.sourceUrl !== "string" ||
    !result.sourceUrl.startsWith("https://github.com/oven-sh/bun/releases/download/") ||
    !result.features ||
    ["serve", "fetch", "sqlite", "image"].some(
      key => result.features[key as keyof RuntimeEvidence["features"]] !== true,
    ) ||
    Object.entries(expected).some(([key, value]) => result[key as keyof RuntimeExpectation] !== value)
  )
    throw new Error("Runtime provenance or fixture evidence differs");
  return result;
}
export async function qualifyRuntime(
  binary: string,
  expectedSha256: string,
  expected: RuntimeExpectation = {},
  run: RuntimeProbe = probe,
) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !matches(binary, expectedSha256))
    throw new Error("Pinned Bun runtime digest differs");
  const evidence = runtimeEvidence(await run([binary, "-e", runtimeFixture], { ...env, BUN_BE_BUN: "1" }), expected);
  return {
    schema: "shenron-runtime-qualification/v1",
    binary,
    sha256: expectedSha256,
    size: Bun.file(binary).size,
    ...evidence,
  };
}
export async function qualifyCompiledRuntimes(image: string, expected: RuntimeExpectation, run: RuntimeProbe = probe) {
  const qualify = async (binary: string) =>
    runtimeEvidence(
      await run(
        [
          "docker",
          "run",
          "--rm",
          "--network",
          "none",
          "--env",
          "BUN_BE_BUN=1",
          "--entrypoint",
          "/usr/local/bin/" + binary,
          image,
          "-e",
          runtimeFixture,
        ],
        env,
      ),
      expected,
    );
  return {
    "shenron-server": await qualify("shenron-server"),
    "shenron-bot": await qualify("shenron-bot"),
  };
}

export function syncDecision(branch: string, status: string, fastForward: boolean): string {
  if (branch !== "main") return "branch-not-main";
  if (status.trim()) return "local-changes";
  if (!fastForward) return "divergent-history";
  return "fast-forward";
}

/** Current Shenron tracks its fork archives; no historical vendor bootstrap is needed. */
export async function verifyVendor(work: string): Promise<void> {
  const directory = join(work, "vendor/next-fork");
  const manifest = await Bun.file(join(directory, "manifest.json")).json();
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || !manifest.packages.length)
    throw new Error("Invalid Next fork archive manifest");
  for (const entry of manifest.packages) {
    if (
      typeof entry.archive !== "string" ||
      !/^[\w.-]+\.tgz$/.test(entry.archive) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error("Invalid Next fork archive identity");
    if (!matches(join(directory, entry.archive), entry.sha256))
      throw new Error(`Next fork archive digest differs: ${entry.archive}`);
  }
}

function command(args: string[], cwd = config.source, inherited = false): string {
  console.log(new Date().toISOString(), args[0], args[1] ?? "");
  const p = Bun.spawnSync(args, {
    cwd,
    env,
    stdout: inherited ? "inherit" : "pipe",
    stderr: "inherit",
  });
  if (p.exitCode !== 0) throw new Error(`Command failed (${p.exitCode}): ${args[0]} ${args[1] ?? ""}`);
  return inherited ? "" : (p.stdout?.toString().trim() ?? "");
}
function git(args: string[], cwd = config.source): string {
  return command(["git", ...args], cwd);
}
function matches(p: string, hash: string): boolean {
  return existsSync(p) && createHash("sha256").update(readFileSync(p)).digest("hex") === hash;
}
async function state(status: string, fields: Record<string, unknown> = {}) {
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const p = join(config.state, process.argv[2]?.startsWith("sync") ? "sync.json" : "deploy.json");
  await Bun.write(p, JSON.stringify({ status, at: new Date().toISOString(), ...fields }, null, 2) + "\n");
  chmodSync(p, 0o600);
}
async function syncSource(): Promise<string | undefined> {
  git(["fetch", "--quiet", "origin", "main"]);
  const branch = git(["branch", "--show-current"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  const ancestor = Bun.spawnSync(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], {
    cwd: config.source,
    env,
  });
  const decision = syncDecision(branch, dirty, ancestor.exitCode === 0);
  if (decision !== "fast-forward") {
    await state("skipped", { reason: decision });
    return;
  }
  git(["merge", "--quiet", "--ff-only", "origin/main"]);
  const sha = git(["rev-parse", "HEAD"]);
  await state("synchronized", { commit: sha });
  return sha;
}
async function sync(): Promise<string | undefined> {
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const p = Bun.spawnSync(
    [
      "flock",
      "--exclusive",
      "--close",
      "--timeout",
      "60",
      join(config.state, "source.lock"),
      config.bun,
      fileURLToPath(import.meta.url),
      "sync-source",
    ],
    { env, stdout: "inherit", stderr: "inherit" },
  );
  if (p.exitCode === 75) return;
  if (p.exitCode !== 0) throw new Error("Checkout synchronization failed");
  return JSON.parse(readFileSync(join(config.state, "sync.json"), "utf8")).commit;
}
function remote(args: string): string {
  return command(["aphrody", "infra", "--root", infra, "ssh", "exec", "--host", config.targetHost, "-c", args]);
}
function active() {
  const code = `const fs=await import('node:fs/promises');const release=await fs.realpath(${JSON.stringify(config.remoteRoot + "/current")});const m=await Bun.file(release+'/release.json').json();console.log(JSON.stringify({release,commit:m.commit,deployment:m.deployment}));`;
  return activeDeployment(JSON.parse(remote("bun --no-env-file -e '" + code.replaceAll("'", "'\\''") + "'")));
}
function native(sha: string, work: string) {
  const n = config.nativeCache;
  const noChanges = (base: string, paths: string[]) =>
    Bun.spawnSync(["git", "diff", "--quiet", base, sha, "--", ...paths], {
      cwd: config.source,
      env,
    }).exitCode === 0;
  const ffi = join(config.source, "target/release/libshenron_ffi.so");
  const re = join(config.source, "target/release/libshenron_re.so");
  const reuse =
    noChanges(n.mcpRevision, ["crates", "Cargo.toml", "Cargo.lock"]) &&
    noChanges(n.librariesRevision, ["crates", ":!crates/shenron-mcp", "Cargo.toml", "Cargo.lock"]) &&
    matches(ffi, n.ffiSha256) &&
    matches(re, n.reSha256);
  const out = join(work, "target/release");
  mkdirSync(out, { recursive: true });
  if (reuse) {
    const cache = join(config.state, "native");
    mkdirSync(cache, { recursive: true });
    const mcp = join(cache, "shenron-mcp-linux-x64");
    if (!matches(mcp, n.mcpSha256))
      command(
        [
          "gh",
          "release",
          "download",
          n.releaseTag,
          "-R",
          "aphrody-labs/shenron",
          "--pattern",
          "shenron-mcp-linux-x64",
          "--dir",
          cache,
          "--clobber",
        ],
        work,
        true,
      );
    if (!matches(mcp, n.mcpSha256)) throw new Error("Qualified MCP digest differs");
    for (const [from, name] of [
      [mcp, "shenron-mcp"],
      [ffi, "libshenron_ffi.so"],
      [re, "libshenron_re.so"],
    ] as const) {
      copyFileSync(from, join(out, name));
      chmodSync(join(out, name), 0o755);
    }
    console.log("Native artifacts reused after source-input and SHA-256 comparison");
  } else {
    for (const crate of ["shenron-mcp", "shenron-ffi", "shenron-re"]) {
      for (const args of [
        ["clippy", "-p", crate, "--all-targets", "--locked", "--", "-D", "warnings"],
        ["test", "-p", crate, "--locked"],
        ["build", "--release", "--locked", "-p", crate],
      ])
        command([config.bun, "scripts/build/rust/cargo.ts", ...args], work, true);
    }
    for (const name of ["shenron-mcp", "libshenron_ffi.so", "libshenron_re.so"])
      copyFileSync(join(env.CARGO_TARGET_DIR!, "release", name), join(out, name));
  }
  mkdirSync(join(work, "dist/mcp/linux-x64"), { recursive: true });
  copyFileSync(join(out, "shenron-mcp"), join(work, "dist/mcp/linux-x64/shenron-mcp"));
  chmodSync(join(work, "dist/mcp/linux-x64/shenron-mcp"), 0o755);
}
async function buildDeploy() {
  if (config.lock !== factory.lockPath) throw new Error("Deployment must use the factory heavy lock");
  const sha = git(["rev-parse", "HEAD"]);
  if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain", "--untracked-files=normal"]))
    throw new Error("Source checkout changed before build");
  const previous = active();
  const selection = deploymentSelection(sha, config);
  if (deploymentIsCurrent(previous, selection)) {
    await state("current", { commit: sha, deploymentId: selection.id });
    return;
  }
  await state("building", {
    commit: sha,
    deploymentId: selection.id,
    previous: previous.id,
  });
  const work = config.worktree,
    job = join(config.artifacts, selection.id);
  mkdirSync(dirname(work), { recursive: true });
  mkdirSync(job, { recursive: true, mode: 0o700 });
  mkdirSync(factory.cacheRoot, { recursive: true });
  await probe(
    [
      config.bun,
      "--no-env-file",
      "-e",
      factoryResourceAdmissionProgram(resources, {
        cache: factory.cacheRoot,
        artifacts: config.artifacts,
      }),
    ],
    env,
  );
  const runtime = config.runtimeSha256
    ? await qualifyRuntime(config.bun, config.runtimeSha256, config.runtimeExpected)
    : undefined;
  if (runtime)
    await Bun.write(join(job, "runtime.json"), JSON.stringify(runtime, null, 2) + "\n", {
      mode: 0o600,
    });
  if (!existsSync(join(work, ".git"))) git(["worktree", "add", "--detach", work, sha]);
  else {
    if (git(["status", "--porcelain", "--untracked-files=normal"], work))
      throw new Error("Build worktree contains changes; preserved");
    git(["checkout", "--detach", sha], work);
  }
  await verifyVendor(work);
  git(["submodule", "update", "--init", "--", "packages/config"], work);
  command([config.bun, "install", "--frozen-lockfile"], work, true);
  native(sha, work);
  env.SHENRON_RE_LIB = join(work, "target/release/libshenron_re.so");
  mkdirSync(join(work, "dist/vfs"), { recursive: true });
  copyFileSync(
    join(config.source, "dist/vfs/shenron-vfs.public.sqlite"),
    join(work, "dist/vfs/shenron-vfs.public.sqlite"),
  );
  command(
    [
      config.bun,
      "-e",
      'import {requireProductionVfs} from "./scripts/build/server-vfs-policy.ts";requireProductionVfs("dist/vfs/shenron-vfs.public.sqlite",false)',
    ],
    work,
    true,
  );
  command([config.bun, "packages/koharu/scripts/build-wasm.ts", "--check"], work, true);
  for (const gate of ["typecheck", "lint", "format:check", "test"]) command([config.bun, "run", gate], work, true);
  for (const args of [
    ["packages/api/scripts/openapi.ts", "--check"],
    ["packages/ui/scripts/generate-tokens.ts", "--check"],
    ["packages/pipeline/scripts/ai/check-contracts.ts"],
  ])
    command([config.bun, ...args], work, true);
  command([config.bun, "scripts/build/bot.ts", "--target", "linux-x64"], work, true);
  command([config.bun, "scripts/build/server.ts", "--flavor", "production", "--target", "linux-x64"], work, true);
  mkdirSync(join(work, "dist/server/linux-x64/native"), { recursive: true });
  copyFileSync(
    join(work, "target/release/libshenron_ffi.so"),
    join(work, "dist/server/linux-x64/native/libshenron_ffi.so"),
  );
  command(
    [
      "docker",
      "build",
      "--network=host",
      "-f",
      "deploy/docker/Dockerfile",
      "--build-arg",
      `SHENRON_REVISION=${sha}`,
      "-t",
      `localhost/shenron:${selection.id}`,
      ".",
    ],
    work,
    true,
  );
  command(["docker", "run", "--rm", "--network", "none", `localhost/shenron:${selection.id}`, "version"], work, true);
  command(
    [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "/usr/local/bin/shenron-bot",
      `localhost/shenron:${selection.id}`,
      "--smoke",
    ],
    work,
    true,
  );
  const image = command(["docker", "image", "inspect", "-f", "{{.Id}}", `localhost/shenron:${selection.id}`], work);
  if (runtime) {
    const compiled = await qualifyCompiledRuntimes(image, {
      version: runtime.version,
      revision: runtime.revision,
      sourceUrl: runtime.sourceUrl,
    });
    await Bun.write(join(job, "compiled-runtimes.json"), JSON.stringify(compiled, null, 2) + "\n", {
      mode: 0o600,
    });
  }
  await state("built", {
    commit: sha,
    deploymentId: selection.id,
    previous: previous.id,
    image,
  });
  // Promotion uses the same sealed Infra adapter as manual Shenron releases.
  command(
    [config.bun, join(infra, "scripts/release/shenron-auto-promote.ts"), sha, image, work, job, previous.id],
    work,
    true,
  );
  if (!deploymentIsCurrent(active(), selection)) throw new Error("Remote deployment identity differs after promotion");
  const health = await fetch(`${config.site}/api/health`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!health.ok || (await health.json()).status !== "ok") throw new Error("Public health probe failed");
  await state("deployed", {
    commit: sha,
    deploymentId: selection.id,
    previous: previous.id,
    image,
    health: "ok",
  });
}

if (import.meta.main) {
  let sourceController: ControllerWorker | undefined;
  try {
    const mode = process.argv[2];
    const expectedVersion = config.runtimeExpected?.version ?? "1.4.4";
    if (Bun.version !== expectedVersion) throw new Error(`Bun ${expectedVersion} is required`);
    if (mode === "source-controller") {
      if (!config.sourceCollection) throw new Error("No qualified source controller profile configured");
      await runSourceControllerLoop(config.sourceCollection);
    } else if (mode === "sync") {
      if (!(await sync())) process.exitCode = 75;
    } else if (mode === "sync-source") {
      if (!(await syncSource())) process.exitCode = 75;
    } else if (mode === "deploy") {
      if (config.sourceCollection)
        sourceController = await startSourceControllerWorker(config.bun, fileURLToPath(import.meta.url), env);
      const sha = await sync();
      if (!sha) process.exitCode = 75;
      else if (deploymentIsCurrent(active(), deploymentSelection(sha, config)))
        await state("current", {
          commit: sha,
          deploymentId: deploymentSelection(sha, config).id,
        });
      else {
        mkdirSync(dirname(config.lock), { recursive: true });
        if (!factory.cleanup || config.lock !== factory.lockPath)
          throw new Error("Deployment requires the canonical factory resource policy");
        const child = Bun.spawn(
          [
            "flock",
            "--exclusive",
            "--close",
            "--nonblock",
            "--conflict-exit-code",
            "75",
            config.lock,
            "flock",
            "--exclusive",
            "--close",
            join(config.state, "source.lock"),
            "bash",
            "-c",
            [
              "set -euo pipefail",
              ...factoryTransientShell(
                factory.cleanup.transientRoot,
                "docker",
                config.lock,
                factory.cleanup.privilegeBinary,
              ),
              '"$@"',
            ].join("\n"),
            "shenron-build",
            config.bun,
            fileURLToPath(import.meta.url),
            "build-deploy",
          ],
          { env, stdout: "inherit", stderr: "inherit" },
        );
        process.exitCode = await child.exited;
        if (process.exitCode === 75) await state("waiting", { reason: "factory-lock", commit: sha });
      }
    } else if (mode === "build-deploy") {
      command(
        [
          config.bun,
          join(infra, "packages/bun-workspace/src/automation/build-factory-cleanup.ts"),
          "--held",
          factoryPath,
        ],
        infra,
      );
      await buildDeploy();
    } else throw new Error("Usage: shenron-auto-deploy.ts sync|deploy");
  } catch (error) {
    await state("failed", { error: String(error) });
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    if (sourceController) {
      try {
        await sourceController.stop();
      } catch {
        await state("failed", { error: "source-controller-lifecycle" });
        process.exitCode = 1;
      }
    }
  }
}
