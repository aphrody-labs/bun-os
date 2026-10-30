// SPDX-License-Identifier: MIT
import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  assertRuntimeFacts,
  hashFile,
  loadConfig,
  repositoryRoot,
  runProcess,
  runtimePinFor,
  type RuntimeFacts,
} from "@aphrody/bun-workspace";
import { nativeRuntimeTarget } from "@aphrody/bun-workspace/runtime";
import { apiOwners } from "./product.ts";

interface InputProof {
  path: string;
  sha256: string;
  gitBlob: string | null;
  generated: boolean;
}
export interface ProductReceipt {
  schemaVersion: 1;
  product: "Aphrody / Bun";
  version: string;
  sourceRevision: string;
  sha256: string;
  inputs: InputProof[];
  runtime: RuntimeFacts;
  qualification: {
    compiled: boolean;
    executed: boolean;
    deployed: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export interface ProductVerification {
  sourceRevision: string;
  sha256: string;
  runtimeRevision: string;
  http: { total: number; passed: number };
  executed: true;
  deployed: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sha256Pattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

export function validateProductReceipt(value: unknown): ProductReceipt {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.product !== "Aphrody / Bun" ||
    typeof value.version !== "string" ||
    typeof value.sourceRevision !== "string" ||
    !revisionPattern.test(value.sourceRevision) ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256) ||
    !Array.isArray(value.inputs) ||
    !value.inputs.length ||
    value.inputs.length > 10000 ||
    !object(value.runtime) ||
    typeof value.runtime.version !== "string" ||
    typeof value.runtime.revision !== "string" ||
    !revisionPattern.test(value.runtime.revision) ||
    typeof value.runtime.executable !== "string" ||
    (value.runtime.sourceUrl !== null && typeof value.runtime.sourceUrl !== "string") ||
    !object(value.qualification) ||
    value.qualification.compiled !== true ||
    typeof value.qualification.executed !== "boolean" ||
    typeof value.qualification.deployed !== "boolean"
  )
    throw new Error("Product build receipt is invalid.");
  for (const input of value.inputs) {
    if (
      !object(input) ||
      typeof input.path !== "string" ||
      !input.path ||
      typeof input.sha256 !== "string" ||
      !sha256Pattern.test(input.sha256) ||
      typeof input.generated !== "boolean" ||
      (input.generated
        ? input.gitBlob !== null
        : typeof input.gitBlob !== "string" || !revisionPattern.test(input.gitBlob))
    )
      throw new Error("Product source input proof is invalid.");
  }
  return value as unknown as ProductReceipt;
}

/** Qualify a compiled product without activating a service or persisting its ephemeral bearer. */
export async function verifyProduct(
  binary: string,
  receiptPath = binary + ".json",
  options: { root?: string; timeoutMs?: number } = {},
): Promise<ProductVerification> {
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new Error("Product verification deadline must be at most 30 seconds.");
  const deadline = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const remaining = () => {
    const value = timeout - (Date.now() - startedAt);
    if (value < 1 || deadline.signal.aborted) throw new Error("Product verification deadline exceeded.");
    return value;
  };
  try {
    const root = await realpath(options.root ?? repositoryRoot);
    binary = await realpath(binary);
    receiptPath = await realpath(receiptPath);
    const file = Bun.file(receiptPath);
    if (file.size > 8 * 1024 * 1024) throw new Error("Product receipt exceeds its size limit.");
    const receipt = validateProductReceipt(await file.json());
    const receiptHash = await hashFile(receiptPath, {
      signal: deadline.signal,
    });
    const command = async (args: string[]) => {
      const result = await runProcess(args, root, {
        timeoutMs: Math.min(5000, remaining()),
        maxOutputBytes: 1048576,
        signal: deadline.signal,
      });
      if (result.code) throw new Error("Product source qualification failed.");
      return result.stdout.trim();
    };
    const head = await command(["git", "rev-parse", "HEAD"]);
    await command(["git", "merge-base", "--is-ancestor", receipt.sourceRevision, head]);
    const config = await loadConfig(root);
    const product = (await Bun.file(join(root, "package.json")).json()) as {
      version?: string;
    };
    if (receipt.version !== product.version) throw new Error("Product receipt version differs from its source owner.");
    const target = nativeRuntimeTarget();
    if (!target) throw new Error("Product target host is unsupported.");
    assertRuntimeFacts(runtimePinFor(config, target), receipt.runtime);
    const sourceInputs = async () => {
      let generated = 0;
      const seen = new Set<string>();
      for (const input of receipt.inputs) {
        const path = resolve(input.path);
        const local = relative(root, path);
        if (!local || local === ".." || local.startsWith(`..${sep}`) || seen.has(path))
          throw new Error("Product input leaves its owner or is duplicated.");
        seen.add(path);
        if (input.generated) {
          generated++;
          if (!/^build\/staging\/product-server\/[a-f0-9-]{36}\/entry\.ts$/.test(local.replaceAll("\\", "/")))
            throw new Error("Generated product input is outside its staging owner.");
          if ((await Bun.file(path).exists()) && (await hashFile(path, { signal: deadline.signal })) !== input.sha256)
            throw new Error("Generated product input changed.");
          continue;
        }
        if ((await realpath(path)) !== path) throw new Error("Product input ownership changed.");
        const gitPath = local.replaceAll("\\", "/");
        if (
          (await command(["git", "rev-parse", receipt.sourceRevision + ":" + gitPath])) !== input.gitBlob ||
          (await command(["git", "hash-object", "--path=" + gitPath, path])) !== input.gitBlob ||
          (await hashFile(path, { signal: deadline.signal })) !== input.sha256
        )
          throw new Error("Product input differs from its committed source proof: " + gitPath);
      }
      if (generated !== 1) throw new Error("Product receipt requires exactly one generated entry proof.");
      for (const path of [
        "package.json",
        ".gitmodules",
        "Cargo.toml",
        "aphrody.config.json",
        "sources.lock.json",
        "infra/apps.json",
        "packages/bun-app-host/src/product.ts",
        "packages/bun-app-host/src/transport.ts",
      ]) {
        if (!seen.has(join(root, path))) throw new Error("Product receipt omits a canonical source owner input.");
      }
    };
    await sourceInputs();
    if ((await hashFile(binary, { signal: deadline.signal })) !== receipt.sha256)
      throw new Error("Product artifact checksum differs.");
    const version = await runProcess([binary, "--version"], root, {
      timeoutMs: Math.min(5000, remaining()),
      maxOutputBytes: 1048576,
      signal: deadline.signal,
      env: { ...Bun.env, BUN_BE_BUN: undefined },
    });
    if (version.code || version.stdout.trim() !== "Aphrody / Bun server " + receipt.version)
      throw new Error("Product version contract differs.");
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const stop = new AbortController();
    const interrupt = () => stop.abort();
    deadline.signal.addEventListener("abort", interrupt, { once: true });
    const decoder = new TextDecoder();
    let output = "";
    let probing = false;
    let completed = false;
    let passed = 0;
    let probeFailure: unknown;
    const publicOrigin = "https://product.aphrody.com";
    const cases = [
      { path: "/healthz", status: 200, auth: false },
      { path: "/api/v1/apps", status: 401, auth: false },
      { path: "/api/v1/sources", status: 401, auth: false },
      { path: "/api/v1/status", status: 401, auth: false },
      { path: "/api/v1/status", status: 200, auth: true },
      { path: "/api/v1/apps", status: 200, auth: true },
      { path: "/api/v1/sources", status: 200, auth: true },
      { path: "/api/v1/owners", status: 200, auth: true },
      { path: "/api/v1/apps", status: 405, auth: true, method: "POST" },
      { path: "/missing", status: 404, auth: true },
      {
        path: "/api/v1/apps",
        status: 403,
        auth: true,
        origin: "https://foreign.invalid",
      },
      {
        path: "/api/v1/status",
        status: 200,
        auth: true,
        origin: publicOrigin,
        proxy: true,
      },
      {
        path: "/api/v1/status",
        status: 401,
        auth: false,
        origin: publicOrigin,
        proxy: true,
      },
      {
        path: "/api/v1/status",
        status: 403,
        auth: true,
        origin: publicOrigin,
        crossSite: true,
      },
      {
        path: "/api/v1/status",
        status: 403,
        auth: true,
        origin: "https://foreign.invalid",
        proxy: true,
      },
    ];
    try {
      await runProcess([binary], root, {
        timeoutMs: remaining(),
        maxOutputBytes: 1048576,
        signal: stop.signal,
        stdout: "discard",
        stderr: "discard",
        env: {
          ...Bun.env,
          BUN_BE_BUN: undefined,
          HOST: "127.0.0.1",
          PORT: "0",
          APHRODY_APP_TOKEN: token,
          APHRODY_APP_ORIGIN: publicOrigin,
        },
        onOutput: async (channel, chunk) => {
          if (channel !== "stdout" || probing) return;
          output += decoder.decode(chunk, { stream: true });
          if (output.length > 8192) throw new Error("Product readiness output exceeds its bound.");
          const ready = output.match(/Aphrody \/ Bun server: (http:\/\/127\.0\.0\.1:\d+\/)/);
          if (!ready) return;
          probing = true;
          try {
            const base = new URL(ready[1]!);
            for (const probe of cases) {
              const headers: Record<string, string> = {};
              if (probe.auth) headers.Authorization = "Bearer " + token;
              if (probe.origin) headers.Origin = probe.origin;
              if (probe.proxy) {
                headers.Host = "product.aphrody.com";
                headers["X-Forwarded-Proto"] = "https";
                headers["X-Forwarded-For"] = "127.0.0.1";
              }
              if (probe.crossSite) headers["Sec-Fetch-Site"] = "cross-site";
              const response = await fetch(new URL(probe.path, base), {
                method: probe.method ?? "GET",
                headers,
                signal: deadline.signal,
                redirect: "error",
              });
              if (
                response.status !== probe.status ||
                !response.headers.get("Content-Type")?.startsWith("application/json") ||
                response.headers.get("Cache-Control") !== "no-store" ||
                response.headers.get("X-Content-Type-Options") !== "nosniff"
              )
                throw new Error("Product HTTP contract failed.");
              const reader = response.body?.getReader();
              let text = "";
              let size = 0;
              const bodyDecoder = new TextDecoder();
              try {
                if (reader)
                  for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                    size += next.value.byteLength;
                    if (size > 1048576) throw new Error("Product response exceeds its bound.");
                    text += bodyDecoder.decode(next.value, { stream: true });
                  }
              } finally {
                await reader?.cancel();
              }
              if (
                text.includes(token) ||
                text.includes(root) ||
                text.includes(root.replaceAll("\\", "/")) ||
                text.includes(JSON.stringify(root).slice(1, -1))
              )
                throw new Error("Product response exposes private execution inputs.");
              const value: unknown = JSON.parse(text);
              if (!object(value)) throw new Error("Product response schema differs.");
              if (
                probe.status === 200 &&
                probe.path === "/healthz" &&
                (value.status !== "ready" || value.product !== receipt.product || value.version !== receipt.version)
              )
                throw new Error("Product readiness identity differs.");
              if (
                probe.status === 200 &&
                probe.path === "/api/v1/status" &&
                (!object(value.catalog) ||
                  value.catalog.sourceRevision !== receipt.sourceRevision ||
                  !object(value.runtime) ||
                  value.runtime.version !== receipt.runtime.version ||
                  value.runtime.revision !== receipt.runtime.revision ||
                  value.runtime.platform !== process.platform ||
                  value.runtime.arch !== process.arch)
              )
                throw new Error("Product source/runtime/target identity differs.");
              if (
                probe.status === 200 &&
                probe.path === "/api/v1/sources" &&
                (value.revision !== receipt.sourceRevision || !Array.isArray(value.sources))
              )
                throw new Error("Product source catalog differs.");
              if (probe.status === 200 && probe.path === "/api/v1/apps" && !Array.isArray(value.apps))
                throw new Error("Product application catalog differs.");
              if (
                probe.status === 200 &&
                probe.path === "/api/v1/owners" &&
                JSON.stringify(value) !== JSON.stringify(apiOwners)
              )
                throw new Error("Product API owner map differs.");
              passed++;
            }
            completed = true;
          } catch (error) {
            probeFailure = error;
          } finally {
            stop.abort();
          }
        },
      });
    } catch (error) {
      if (!completed || !object(error) || error.code !== "INTERRUPTED")
        throw probeFailure ?? new Error("Product server verification failed.");
    } finally {
      deadline.signal.removeEventListener("abort", interrupt);
      stop.abort();
    }
    if (!completed || passed !== cases.length) throw new Error("Product server did not complete its HTTP gates.");
    remaining();
    await sourceInputs();
    if (
      (await command(["git", "rev-parse", "HEAD"])) !== head ||
      (await hashFile(binary, { signal: deadline.signal })) !== receipt.sha256 ||
      (await hashFile(receiptPath, { signal: deadline.signal })) !== receiptHash
    )
      throw new Error("Product verification inputs changed.");
    receipt.qualification = {
      ...receipt.qualification,
      executed: true,
      http: { total: cases.length, passed },
      verifiedAt: new Date().toISOString(),
    };
    await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    return {
      sourceRevision: receipt.sourceRevision,
      sha256: receipt.sha256,
      runtimeRevision: receipt.runtime.revision,
      http: { total: cases.length, passed },
      executed: true,
      deployed: receipt.qualification.deployed,
    };
  } finally {
    clearTimeout(timer);
  }
}
