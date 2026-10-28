// SPDX-License-Identifier: MIT
// The factory owns the installed product tree; the final image never resolves dependencies.
import { constants } from "node:fs";
import { lstat, mkdir, realpath, copyFile } from "node:fs/promises";
import { isAbsolute, join, resolve, relative } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { sourceIntegrity } from "../container/source-integrity.ts";
import { exportPinnedSources, type SourceExportOptions } from "./source-export.ts";
import type { RuntimeReceipt } from "../src/distribution.ts";

import {
  productIdentity,
  sameProductIdentity,
  productPath,
  sourceEntries,
  entryTreeHash,
  verifySourceEntries,
  verifyLinks,
  verifyInstalledAdditions,
  verifyProductPayload,
  validatePreparedProductPath,
  validateProductWasmInputs,
  validateProductNativeInputs,
  productModesSHA256,
  type ProductPayloadReceipt,
} from "../container/product-payload.ts";
export { verifyProductPayload, type ProductPayloadReceipt } from "../container/product-payload.ts";
type LinuxTarget = "linux-x64" | "linux-arm64";

export interface ProductPayloadOptions {
  sources: SourceExportOptions & { lock: NonNullable<SourceExportOptions["lock"]> };
  executable: string;
  runtime: RuntimeReceipt;
  /** Existing shared owner cache; defaults to BUN_INSTALL_CACHE_DIR, never an artifact-local cache. */
  installCache?: string;
  preparedInputs?: { path: string; artifact: string; sha256: string; sourceRevision: string }[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The runtime is the upstream oven-sh/bun commit, locked beside bun-os rather than as one of its gitlinks. */
function isRuntimeSource(source: { id: string; parent?: string; mount: string; repository: string }): boolean {
  return source.id === "bun" && !source.parent && source.mount === "sources/bun" && source.repository === "oven-sh/bun";
}

function validateRuntime(
  runtime: RuntimeReceipt,
): asserts runtime is RuntimeReceipt & { target: LinuxTarget; abi: "gnu" } {
  const target = process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : undefined;
  if (
    process.platform !== "linux" ||
    !target ||
    runtime.target !== target ||
    runtime.schemaVersion !== 1 ||
    runtime.repository !== "oven-sh/bun" ||
    runtime.abi !== "gnu" ||
    !/^[a-f0-9]{40}$/.test(runtime.revision) ||
    !/^[a-f0-9]{64}$/.test(runtime.sha256) ||
    !Number.isSafeInteger(runtime.bytes) ||
    runtime.bytes <= 0 ||
    typeof runtime.version !== "string" ||
    !runtime.version ||
    runtime.qualification?.passed !== true ||
    !Array.isArray(runtime.qualification.gates) ||
    !runtime.qualification.gates.includes("native-runtime")
  )
    throw new Error("Product installation requires the qualified native Linux runtime on its matching VPS target");
}

async function execute(
  executable: string,
  args: string[],
  cwd: string,
  options: ProductPayloadOptions,
  env?: Record<string, string | undefined>,
) {
  const result = await runProcess([executable, ...args], cwd, {
    timeoutMs: options.timeoutMs ?? 1_800_000,
    maxOutputBytes: 16 * 1024 * 1024,
    signal: options.signal,
    ...(env ? { env } : {}),
  });
  if (result.code !== 0)
    throw new Error(`Product payload command failed (${result.code}): ${result.stderr.slice(-3000)}`);
  return result.stdout;
}

/** Export one pinned product graph and install its dependencies in a fresh, target-native tree. */
export async function prepareProductPayload(
  output: string,
  options: ProductPayloadOptions,
): Promise<ProductPayloadReceipt> {
  options = {
    ...options,
    runtime: structuredClone(options.runtime),
    sources: { ...options.sources, lock: structuredClone(options.sources.lock) },
    preparedInputs: structuredClone(options.preparedInputs ?? []),
  };
  validateRuntime(options.runtime);
  const target = options.runtime.target;
  const configuredCache = options.installCache ?? Bun.env.BUN_INSTALL_CACHE_DIR;
  if (!configuredCache || !isAbsolute(configuredCache))
    throw new Error(
      "Configure an existing absolute shared Bun install cache via installCache or BUN_INSTALL_CACHE_DIR",
    );
  const installCache = await realpath(configuredCache);
  if (!(await lstat(installCache)).isDirectory())
    throw new Error("Shared Bun install cache must be an existing directory");
  const lock = options.sources.lock;
  const owner = lock.repositories.find(source => source.id === "bun-os");
  if (
    !owner ||
    owner.parent ||
    owner.repository !== "aphrody-labs/bun-distribution" ||
    owner.mount !== "sources/bun-os" ||
    lock.repositories.some(
      source =>
        source !== owner && !isRuntimeSource(source) && (!source.parent || !source.mount.startsWith("sources/bun-os/")),
    )
  )
    throw new Error("Provide one pinned bun-os root and its complete child gitlink graph");
  const runtimeSources = lock.repositories.filter(isRuntimeSource);
  if (runtimeSources.length !== 1 || runtimeSources[0]!.revision !== options.runtime.revision)
    throw new Error("Product oven-sh/bun pin must match the qualified runtime revision");
  const executable = await realpath(options.executable);
  if (!sameProductIdentity(await productIdentity(executable), options.runtime))
    throw new Error("Product runtime bytes differ from their qualification receipt");
  const root = resolve(output);
  try {
    await lstat(root);
    throw new Error("Product payload output must not exist");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  // The export owner checks protected paths before creating the fresh output.
  const exported = await exportPinnedSources(root, options.sources);
  if (!exported.complete || !exported.integrityComplete || exported.status !== "complete")
    throw new Error("Product source graph is incomplete");
  const facts = JSON.parse(
    await execute(
      executable,
      [
        "--no-env-file",
        "-e",
        "console.log(JSON.stringify({revision:Bun.revision,version:Bun.version,platform:process.platform,arch:process.arch}))",
      ],
      root,
      options,
    ),
  );
  if (
    facts.revision !== options.runtime.revision ||
    facts.version !== options.runtime.version ||
    facts.platform !== "linux" ||
    facts.arch !== process.arch
  )
    throw new Error("Selected product runtime does not match its receipt");
  const workspace = join(root, "sources/bun-os");
  if ((await sourceIntegrity(join(root, "sources"))).treeSHA256 !== exported.treeSHA256)
    throw new Error("Exported product source differs from its source receipt");
  for (const file of ["src/cli.ts", "src/cli/main.ts", "src/cli/commands.ts", "package.json", "bun.lock"])
    await productIdentity(join(workspace, file));
  const entries = await sourceEntries(workspace);
  const sourceTreeSHA256 = entryTreeHash(entries);
  if (
    (await sourceIntegrity(workspace)).treeSHA256 !== sourceTreeSHA256 ||
    (await sourceIntegrity(join(root, "sources"))).treeSHA256 !== exported.treeSHA256
  )
    throw new Error("Product source changed during inventory");
  await verifyLinks(workspace, entries);
  const preparedInputs: ProductPayloadReceipt["preparedInputs"] = [];
  for (const input of options.preparedInputs ?? []) {
    await validatePreparedProductPath(workspace, input.path, entries, target);
    if (
      !isAbsolute(input.artifact) ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      input.sourceRevision !== owner.revision ||
      preparedInputs.some(entry => entry.path === input.path)
    )
      throw new Error("Prepared inputs require unique paths, absolute artifacts and matching source revision/checksum");
    // Do not let a source symlink redirect the copy into an existing source or out of the workspace.
    const segments = input.path.split("/").slice(0, -1);
    for (const path of segments.map((_, index) => segments.slice(0, index + 1).join("/"))) {
      try {
        const stat = await lstat(productPath(workspace, path));
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error(`Prepared archive parent is not a directory: ${path}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
        await mkdir(productPath(workspace, path));
      }
    }
    const source = await productIdentity(input.artifact);
    if (source.sha256 !== input.sha256) throw new Error(`Prepared archive checksum differs: ${input.path}`);
    const destination = productPath(workspace, input.path);
    await copyFile(input.artifact, destination, constants.COPYFILE_EXCL);
    if (!sameProductIdentity(source, await productIdentity(destination)))
      throw new Error("Prepared archive changed while copying");
    preparedInputs.push({ path: input.path, ...source, sourceRevision: input.sourceRevision });
  }
  await validateProductWasmInputs(workspace, preparedInputs);
  await validateProductNativeInputs(workspace, preparedInputs, entries, target, owner.revision);
  const frozenLock = await productIdentity(join(workspace, "bun.lock"));
  const installHome = join(root, ".install-home");
  await mkdir(installHome);
  const env = {
    ...Bun.env,
    HOME: installHome,
    XDG_CONFIG_HOME: join(installHome, ".config"),
    BUN_INSTALL_CACHE_DIR: installCache,
    CI: "1",
    BUN_BE_BUN: undefined,
  };
  await execute(
    executable,
    ["--no-env-file", "install", "--frozen-lockfile", "--ignore-scripts"],
    workspace,
    options,
    env,
  );
  if (!sameProductIdentity(frozenLock, await productIdentity(join(workspace, "bun.lock"))))
    throw new Error("Frozen product lockfile changed");
  await verifySourceEntries(workspace, entries);
  await verifyLinks(workspace, entries);
  await verifyInstalledAdditions(workspace, entries, preparedInputs);
  const catalog: { target?: string }[] = JSON.parse(
    await execute(executable, ["--no-env-file", "src/cli.ts", "commands", "--all", "--json"], workspace, options, env),
  );
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("Product CLI command graph is empty");
  for (const command of catalog) {
    if (!command || typeof command !== "object") throw new Error("Invalid product command graph entry");
    if (command.target) {
      const path = productPath(workspace, command.target);
      await productIdentity(path);
      // Commands may never resolve through a preserved external source-fixture symlink.
      const physical = await realpath(path);
      productPath(workspace, relative(workspace, physical).replaceAll("\\", "/"));
    }
  }
  await verifySourceEntries(workspace, entries);
  const installed = await sourceIntegrity(workspace);
  if (installed.lfsPointers.length) throw new Error("Installed product contains unresolved LFS pointers");
  if (!sameProductIdentity(await productIdentity(executable), options.runtime))
    throw new Error("Product runtime changed during installation");
  const receipt: ProductPayloadReceipt = {
    schemaVersion: 1,
    kind: "bun-os-product-payload",
    root: "sources/bun-os",
    sourceRepository: "aphrody-labs/bun-distribution",
    sourceRevision: owner.revision,
    target,
    runtime: {
      revision: options.runtime.revision,
      version: options.runtime.version,
      target,
      abi: options.runtime.abi,
      sha256: options.runtime.sha256,
      bytes: options.runtime.bytes,
    },
    lock: frozenLock,
    sourceReceipt: await productIdentity(join(root, "sources.receipt.json")),
    sourceEntries: entries,
    preparedInputs,
    sourceTreeSHA256,
    installedTreeSHA256: installed.treeSHA256,
    installedModesSHA256: await productModesSHA256(workspace),
    commands: catalog.length,
    install: { passed: true, frozenLockfile: true, lifecycleScripts: false },
    qualification: { productCli: false, nativeCommands: false, fullProduct: false },
  };
  const receiptPath = join(root, "product.receipt.json");
  await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  await verifyProductPayload(workspace, receiptPath, { target, runtime: receipt.runtime });
  return receipt;
}
