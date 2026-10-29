#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Canonical Aphrody Infra provision client; credential values remain on the VPS.
// Rust includes this same client and remote program. Plan is local/read-only;
// apply admits one cataloged private source repository. Mirrors retain their separate Infra owner.
/* oxlint-disable no-await-in-loop -- Gate each ancestor and committed source before dependent reads. */
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

interface Repository {
  name: string;
  mirror: boolean;
  upstream?: string;
  private?: boolean;
}
interface Plan {
  schemaVersion: number;
  owner: string;
  branch: string;
  private: boolean;
  actions: boolean;
  apiUrl: string;
  tokenFile: string;
  tokenVariable: string;
  bunExecutable: string;
  runnerKey: string;
  repositories: Repository[];
}
interface Report {
  applied: boolean;
  owner: string;
  repositories: string[];
  actions: boolean;
  runner_key: string;
}
const catalogPath = "infra/config/host/apps/vps/gitea/bun-os-repositories.json";
const clientPath = "scripts/tools/infra/gitea-provision.ts";
const remotePath = "scripts/tools/infra/gitea-provision-remote.ts";
const rustPath = "crates/infra/infra/src/gitea.rs";
const usage =
  "Usage: bun scripts/tools/infra/gitea-provision.ts [--root <checkout>] [--repository <name>] [--apply] [--json]\nPlan by default. Apply requires exactly one explicitly named private non-mirror repository.";

function argumentsFrom(argv: string[]) {
  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) args.shift();
  let root = resolve(import.meta.dir, "../../../../");
  let apply = false,
    json = false;
  const repositories: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true, root, apply, json, repositories };
    if (flag === "--apply" && !apply) apply = true;
    else if (flag === "--json" && !json) json = true;
    else if (flag === "--root" && args[index + 1]) root = resolve(args[++index]!);
    else if (flag === "--repository" && args[index + 1]) repositories.push(...args[++index]!.split(","));
    else throw new Error("Invalid provision arguments.");
  }
  if (
    new Set(repositories).size !== repositories.length ||
    repositories.some(name => !/^[a-zA-Z0-9-]{1,100}$/.test(name))
  )
    throw new Error("Invalid repository selection.");
  return { help: false, root, apply, json, repositories };
}

async function safeSourceFile(root: string, name: string): Promise<string> {
  const path = resolve(root, name),
    within = relative(root, path);
  if (isAbsolute(within) || within === ".." || within.startsWith(".." + sep))
    throw new Error("Provision source path escaped its owner.");
  let current = root;
  for (const part of ["", ...within.split(sep)]) {
    if (part) current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Provision source reparse paths refused.");
  }
  if (!(await lstat(path)).isFile()) throw new Error("Provision input is not a regular source file.");
  return path;
}

function validatePlan(value: Plan): void {
  if (
    value.schemaVersion !== 1 ||
    value.owner !== "aphrody-dev" ||
    value.branch !== "os" ||
    value.private !== true ||
    value.actions !== true ||
    value.apiUrl !== "http://127.0.0.1:29020/api/v1" ||
    value.tokenFile !== "/home/ubuntu/.aphrody/config/gitea.env" ||
    value.tokenVariable !== "GITEA_TOKEN_OWNER" ||
    value.bunExecutable !== "/home/ubuntu/.bun/bin/bun-1.4.4" ||
    value.runnerKey !== "/home/ubuntu/.aphrody/secrets/gitea/bun-os-crate-runner" ||
    !Array.isArray(value.repositories) ||
    !value.repositories.length ||
    value.repositories.length > 1024
  )
    throw new Error("Gitea plan is outside the authorized owner contract.");
  const names = new Set<string>();
  for (const repo of value.repositories) {
    if (
      typeof repo.name !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(repo.name) ||
      names.has(repo.name) ||
      typeof repo.mirror !== "boolean"
    )
      throw new Error("Invalid declared forge repository.");
    names.add(repo.name);
    if (repo.mirror) {
      if (repo.name !== "bun-distribution" || repo.upstream !== "https://github.com/aphrody-labs/bun-distribution.git")
        throw new Error("Mirror source is outside the owner contract.");
    } else if (
      !(repo.name.startsWith("bun-crate-") || repo.name.startsWith("bun-package-")) ||
      (repo.private ?? value.private) !== true ||
      repo.upstream !== undefined
    )
      throw new Error("Private source repository contract mismatch.");
  }
}

async function bounded(argv: string[], options: { cwd: string; input?: string; timeoutMs: number }) {
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  async function capture(stream: ReadableStream<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) {
        child.kill();
        throw new Error("Provision process output exceeded its bound.");
      }
      chunks.push(chunk);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(buffer);
  }
  const [stdout, , code] = await Promise.all([capture(child.stdout), capture(child.stderr), child.exited]);
  if (code !== 0) throw new Error("Provision owner subprocess failed; no credential diagnostics are printed.");
  return stdout;
}

async function main() {
  const options = argumentsFrom(Bun.argv.slice(1));
  if (options.help) {
    console.log(usage);
    return;
  }
  const root = await realpath(options.root);
  const plan = (await Bun.file(await safeSourceFile(root, catalogPath)).json()) as Plan;
  validatePlan(plan);
  if (options.repositories.length) {
    plan.repositories = options.repositories.map(name => {
      const repo = plan.repositories.find(item => item.name === name);
      if (!repo) throw new Error("Selected repository is absent from the authorized catalog.");
      return repo;
    });
  }
  const report: Report = {
    applied: false,
    owner: plan.owner,
    repositories: plan.repositories.map(repo => repo.name),
    actions: plan.actions,
    runner_key: "VPS protected deploy key",
  };
  if (options.apply) {
    if (options.repositories.length !== 1 || plan.repositories.some(repo => repo.mirror))
      throw new Error("Apply requires one selected private source repository; mirror orchestration remains separate.");
    if (
      Bun.version !== "1.4.4" ||
      !process.release.sourceUrl?.startsWith("https://github.com/oven-sh/bun/releases/download/")
    )
      throw new Error("Use the pinned upstream Bun runtime.");
    for (const source of [catalogPath, clientPath, remotePath, rustPath]) {
      await safeSourceFile(root, source);
      const current = await bounded(["git", "hash-object", `--path=${source}`, source], {
        cwd: root,
        timeoutMs: 15000,
      });
      const committed = await bounded(["git", "rev-parse", `HEAD:${source}`], {
        cwd: root,
        timeoutMs: 15000,
      });
      if (current.trim() !== committed.trim()) throw new Error("Commit reviewed provision inputs before apply.");
    }
    const remoteProgram = await Bun.file(await safeSourceFile(root, remotePath)).text();
    if (Bun.env.APHRODY_GITEA_REMOTE_PROGRAM !== undefined && Bun.env.APHRODY_GITEA_REMOTE_PROGRAM !== remoteProgram)
      throw new Error("Embedded remote owner differs from the reviewed shared source.");
    const profile = Bun.env.USERPROFILE ?? Bun.env.HOME;
    if (!profile) throw new Error("Workstation profile unavailable.");
    const publicPath = join(profile, ".ssh/id_ed25519_aphrody.pub");
    if (!(await lstat(publicPath)).isFile()) throw new Error("Workstation public key metadata unavailable.");
    const accountKey = (await Bun.file(publicPath).text()).trim();
    if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(accountKey))
      throw new Error("Workstation public key is not the declared ED25519 identity.");
    const data = {
      owner: plan.owner,
      branch: plan.branch,
      private: plan.private,
      actions: plan.actions,
      apiUrl: plan.apiUrl,
      tokenFile: plan.tokenFile,
      tokenVariable: plan.tokenVariable,
      bunExecutable: plan.bunExecutable,
      runnerKey: plan.runnerKey,
      repositories: plan.repositories.map(repo => ({
        name: repo.name,
        mirror: repo.mirror,
        upstream: repo.upstream,
        private: repo.private ?? plan.private,
      })),
      accountKey,
    };
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64");
    const script = `set -eu\nexport APHRODY_GITEA_PLAN_B64='${encoded}'\ntimeout 90s /home/ubuntu/.bun/bin/bun-1.4.4 - <<'APHRODY_GITEA_OWNER'\n${remoteProgram}\nAPHRODY_GITEA_OWNER\n`;
    const response = JSON.parse(
      await bounded(
        [
          "ssh",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=15",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ServerAliveInterval=5",
          "-o",
          "ServerAliveCountMax=2",
          "vps",
          "bash",
          "-s",
        ],
        { cwd: root, input: script, timeoutMs: 110000 },
      ),
    );
    if (
      response.owner !== report.owner ||
      response.actions !== report.actions ||
      JSON.stringify(response.repositories) !== JSON.stringify(report.repositories) ||
      response.account_key !== "present" ||
      response.runner_key !== "present"
    )
      throw new Error("Remote owner report failed its public postconditions.");
    report.applied = true;
  }
  if (options.json) console.log(JSON.stringify(report));
  else
    console.log(
      `${report.applied ? "Applied" : "Plan"}: ${report.owner}, ${report.repositories.join(", ")}; protected runner identity.`,
    );
}

if (import.meta.main)
  main().catch(() => {
    console.error("Gitea provision failed; review the selected catalog, committed source and owner capability.");
    process.exitCode = 1;
  });
