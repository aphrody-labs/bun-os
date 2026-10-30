#!/usr/bin/env bun
import { mkdir, realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  appCapabilities,
  appHostname,
  assertRuntimeFacts,
  cargoModule,
  checkoutPath,
  currentRuntimeFacts,
  findModule,
  hashFile,
  inspectModuleCoverage,
  isObject,
  loadConfig,
  repositoryRoot,
  resolveModuleBinary,
  runtimePinFor,
  runProcess,
  type Config,
  type RuntimeFacts,
  type RuntimePin,
  type RuntimeTarget,
} from "@aphrody/bun-workspace";
import { validateAssetReference, type AssetReference } from "@aphrody/bun-workspace/assets";
import {
  buildAppArtifact,
  hostMatchesTarget,
  parseArtifactTarget,
  type AppManifest,
  type ArtifactTarget,
  type BuiltAppArtifact,
  type NativeArtifactReceipt,
  type NativeFileInput,
  type RuntimeArtifactReceipt,
} from "@aphrody/bun-artifacts";

type Protocol = AppManifest["engine"]["protocol"];
type Qualification = NativeArtifactReceipt["qualification"];
type Stage = "plan" | "source" | "native-build" | "native-receipt" | "compile" | "extract";

interface AppBuildResult {
  appId: string;
  libraryId: string;
  hostname: string;
  protocol: Protocol;
  sourceRevision: string;
  status: "planned" | "built" | "owner-unavailable" | "failed";
  stage: Stage;
  nativeReceipt?: NativeArtifactReceipt;
  artifact?: BuiltAppArtifact;
  extraction?: "qualified";
  error?: { code: string; message: string };
}

interface BuildReport {
  schemaVersion: 1;
  identity: "Aphrody / Bun";
  action: "plan" | "build";
  target: ArtifactTarget;
  qualification: Qualification;
  expectedRuntime: RuntimePin;
  runtimeReceipt?: RuntimeArtifactReceipt;
  sharedAssets?: AssetReference;
  results: AppBuildResult[];
  complete: boolean;
}

const usage = `Aphrody / Bun app builds
  build-apps.ts [plan|build] [--app APP[,APP] ...] [--target TARGET]
    [--bun FILE] [--runtime-pin JSON] [--runtime-receipt JSON]
    [--shared-assets JSON] [--resources JSON] [--protocol cli|cli-json|jsonl|mcp-stdio]
    [--root DIR] [--output RELATIVE_DIR] [--report FILE] [--host HOST]
    [--mode native|ssh|docker] [--native-timeout SECONDS] [--compile-timeout SECONDS]
Planning is the default. Builds require a qualified native host and a fresh output.
`;
const maxMetadataBytes = 1024 * 1024;

async function readJSON(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!file.size || file.size > maxMetadataBytes) throw new Error("Build metadata must fit within 1 MiB.");
  return file.json();
}

function runtimePin(value: unknown): RuntimePin {
  if (
    !isObject(value) ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    value.repository !== "oven-sh/bun" ||
    typeof value.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.revision)
  )
    throw new Error("An explicit pinned Aphrody Bun 1.4.4 runtime is required.");
  return {
    version: value.version,
    repository: value.repository,
    revision: value.revision,
  };
}

function deadline(value: string | undefined, fallback: number, maximum: number): number {
  const seconds = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > maximum) throw new Error("Invalid build deadline.");
  return seconds * 1000;
}

function errorDetails(error: unknown): { code: string; message: string } {
  return {
    code: isObject(error) && typeof error.code === "string" ? error.code : "BUILD_FAILED",
    message: error instanceof Error ? error.message : "The application build failed.",
  };
}

function observed(qualification: Qualification): Qualification {
  return { ...qualification, observedAt: new Date().toISOString() };
}

function nativeHostTarget(): ArtifactTarget {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const target = `bun-${platform}-${process.arch}`;
  if (process.platform !== "linux") return parseArtifactTarget(target);
  return parseArtifactTarget(hostMatchesTarget(parseArtifactTarget(target)) ? target : `${target}-musl`);
}

async function qualifyRuntime(
  path: string,
  expected: RuntimePin,
  target: ArtifactTarget,
  root: string,
  qualification: Qualification,
  supplied?: unknown,
): Promise<{ executable: string; receipt: RuntimeArtifactReceipt }> {
  const executable = await realpath(path);
  const result = await runProcess(
    [
      executable,
      "--no-env-file",
      "-e",
      "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl??null,standalone:Bun.isStandaloneExecutable,platform:process.platform,arch:process.arch}))",
    ],
    root,
    {
      timeoutMs: 5_000,
      maxOutputBytes: 4096,
      stderr: "discard",
      env: { ...Bun.env, BUN_BE_BUN: undefined },
    },
  );
  const value: unknown = result.code === 0 ? JSON.parse(result.stdout.trim()) : undefined;
  if (
    !isObject(value) ||
    value.standalone !== false ||
    value.platform !== process.platform ||
    value.arch !== process.arch ||
    typeof value.version !== "string" ||
    typeof value.revision !== "string" ||
    typeof value.sourceUrl !== "string"
  )
    throw new Error("The selected Bun executable could not qualify on this native host.");
  const facts: RuntimeFacts = {
    version: value.version,
    revision: value.revision,
    sourceUrl: value.sourceUrl,
    executable,
  };
  assertRuntimeFacts(expected, facts);
  const sha256 = await hashFile(executable, { maxBytes: 200 * 1024 * 1024 });
  if (supplied !== undefined) {
    if (!isObject(supplied) || supplied.target !== target || supplied.sha256 !== sha256 || !isObject(supplied.facts)) {
      throw new Error("The selected Bun bytes differ from their runtime receipt.");
    }
    const previous = supplied.facts;
    if (
      previous.version !== facts.version ||
      previous.revision !== facts.revision ||
      previous.sourceUrl !== facts.sourceUrl
    ) {
      throw new Error("The selected Bun provenance differs from its runtime receipt.");
    }
  }
  return {
    executable,
    receipt: { target, sha256, facts, qualification: observed(qualification) },
  };
}

async function writeJSON(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}

async function resourceInputs(
  path: string | undefined,
  appIds: Set<string>,
): Promise<Record<string, NativeFileInput[]>> {
  if (!path) return {};
  const value = await readJSON(path);
  if (!isObject(value)) throw new Error("Native resources must map application IDs to selected files.");
  const result: Record<string, NativeFileInput[]> = {};
  for (const [id, inputs] of Object.entries(value)) {
    if (!appIds.has(id) || !Array.isArray(inputs) || inputs.length > 63)
      throw new Error("Invalid native application resources.");
    result[id] = inputs.map(input => {
      if (
        !isObject(input) ||
        typeof input.source !== "string" ||
        !isAbsolute(input.source) ||
        typeof input.path !== "string" ||
        !["library", "resource", "notice"].includes(String(input.kind))
      )
        throw new Error("Select absolute native resource inputs and their payload paths.");
      return {
        source: input.source,
        path: input.path,
        kind: input.kind as NativeFileInput["kind"],
      };
    });
  }
  return result;
}

async function buildOne(
  config: Config,
  result: AppBuildResult,
  report: BuildReport,
  options: {
    root: string;
    output: string;
    bun: string;
    resources: NativeFileInput[];
    nativeTimeout: number;
    compileTimeout: number;
  },
): Promise<void> {
  const module = findModule(config, result.libraryId);
  if (!module.binary) {
    result.status = "owner-unavailable";
    result.error = {
      code: "OWNER_UNAVAILABLE",
      message: "The application has no existing native engine CLI.",
    };
    return;
  }
  try {
    result.stage = "source";
    const coverage = await inspectModuleCoverage(module, options.root);
    if (coverage.errors.length || coverage.missingTargets.length || coverage.missingWorkspaceMembers.length) {
      throw new Error("The native source owner has missing Cargo members or targets.");
    }
    const output = join(
      options.output,
      report.target,
      result.appId,
      `aphrody-${result.appId}${report.target.startsWith("bun-windows-") ? ".exe" : ""}`,
    );
    if (await Bun.file(output).exists()) throw new Error("Select a fresh application output path.");
    result.stage = "native-build";
    console.error(`Aphrody ${result.appId}: native build`);
    const nativeConfig: Config = { ...config, runtime: report.expectedRuntime };
    const code = await cargoModule(nativeConfig, module.id, "build", [], {
      root: options.root,
      timeoutMs: options.nativeTimeout,
    });
    if (code !== 0) throw new Error(`The native library build failed (${code}).`);
    result.stage = "native-receipt";
    const binary = await resolveModuleBinary(nativeConfig, module.id, {
      root: options.root,
    });
    if (dirname(binary).split(/[\\/]/).at(-1) !== "release")
      throw new Error("Cargo did not produce the release engine artifact.");
    const version = await runProcess([binary, "--version"], options.root, {
      timeoutMs: 5_000,
      maxOutputBytes: 4096,
      stderr: "discard",
    });
    const match =
      version.code === 0 ? version.stdout.trim().match(/(?:^|\s)(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)(?:\s|$)/) : null;
    if (!match) throw new Error("The native engine did not report its version.");
    result.nativeReceipt = {
      target: report.target,
      sourceRevision: module.revision,
      sha256: await hashFile(binary, { maxBytes: 1024 * 1024 * 1024 }),
      version: match[1]!,
      qualification: observed(report.qualification),
    };
    await writeJSON(`${output}.native.json`, result.nativeReceipt);
    result.stage = "compile";
    console.error(`Aphrody ${result.appId}: Bun compile`);
    result.artifact = await buildAppArtifact({
      appId: result.appId,
      target: report.target,
      expectedRuntime: report.expectedRuntime,
      bunExecutable: options.bun,
      nativeBinary: binary,
      nativeReceipt: result.nativeReceipt,
      nativeFiles: options.resources,
      engineProtocol: result.protocol,
      targetRuntimeReceipt: report.runtimeReceipt,
      sharedAssets: report.sharedAssets,
      root: options.root,
      output,
      timeoutMs: options.compileTimeout,
    });
    result.stage = "extract";
    const doctor = await runProcess([result.artifact.path, "--doctor"], options.root, {
      timeoutMs: 180_000,
      maxOutputBytes: 256 * 1024,
      stderr: "discard",
      env: { ...Bun.env, BUN_BE_BUN: undefined },
    });
    const qualification: unknown = doctor.code === 0 ? JSON.parse(doctor.stdout.trim()) : undefined;
    if (
      !isObject(qualification) ||
      qualification.identity !== "Aphrody / Bun" ||
      qualification.app !== result.appId ||
      qualification.target !== report.target ||
      !isObject(qualification.engine) ||
      qualification.engine.available !== true ||
      qualification.engine.sourceRevision !== module.revision ||
      !isObject(qualification.runtime) ||
      qualification.runtime.revision !== report.expectedRuntime.revision
    ) {
      throw new Error("The independent executable failed native extraction qualification.");
    }
    result.extraction = "qualified";
    result.status = "built";
    console.error(`Aphrody ${result.appId}: built`);
  } catch (error) {
    result.status = "failed";
    result.error = errorDetails(error);
    console.error(`Aphrody ${result.appId}: ${result.stage} failed`);
  }
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      app: { type: "string", multiple: true },
      target: { type: "string" },
      bun: { type: "string" },
      "runtime-pin": { type: "string" },
      "runtime-receipt": { type: "string" },
      "shared-assets": { type: "string" },
      resources: { type: "string" },
      protocol: { type: "string" },
      root: { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
      host: { type: "string" },
      mode: { type: "string" },
      "native-timeout": { type: "string" },
      "compile-timeout": { type: "string" },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  const [action = "plan", ...extra] = positionals;
  if (extra.length || (action !== "plan" && action !== "build")) throw new Error("Use plan or build.");
  const root = resolve(values.root ?? repositoryRoot);
  const config = await loadConfig(root);
  const target = values.target ? parseArtifactTarget(values.target) : nativeHostTarget();
  const runtimeTarget = target.slice(4) as RuntimeTarget;
  const expectedRuntime = values["runtime-pin"]
    ? runtimePin(await readJSON(resolve(root, values["runtime-pin"])))
    : runtimePinFor(config, runtimeTarget);
  const mode = values.mode ?? "native";
  const host = values.host ?? hostname();
  if (!["native", "ssh", "docker"].includes(mode) || !/^[A-Za-z0-9._-]{1,128}$/.test(host))
    throw new Error("Select a native host qualification context.");
  const qualification = {
    host,
    mode: mode as Qualification["mode"],
    observedAt: new Date().toISOString(),
  };
  const capabilities = appCapabilities(config);
  const ids = new Set(capabilities.map(app => app.id));
  const selected = new Set((values.app ?? []).flatMap(value => value.split(",")));
  if ([...selected].some(id => !ids.has(id))) throw new Error("Select configured application IDs.");
  if (values.protocol && !["cli", "cli-json", "jsonl", "mcp-stdio"].includes(values.protocol))
    throw new Error("Select an existing native engine protocol.");
  const report: BuildReport = {
    schemaVersion: 1,
    identity: "Aphrody / Bun",
    action,
    target,
    qualification,
    expectedRuntime,
    results: capabilities
      .filter(app => !selected.size || selected.has(app.id))
      .map(app => {
        const module = findModule(config, app.libraryId);
        return {
          appId: app.id,
          libraryId: app.libraryId,
          hostname: appHostname(app.id, config),
          protocol: (values.protocol ?? module.protocol ?? "cli") as Protocol,
          sourceRevision: module.revision,
          stage: "plan",
          status: module.binary ? "planned" : "owner-unavailable",
          ...(!module.binary
            ? {
                error: {
                  code: "OWNER_UNAVAILABLE",
                  message: "The application has no existing native engine CLI.",
                },
              }
            : {}),
        };
      }),
    complete: false,
  };
  if (values["shared-assets"]) {
    report.sharedAssets = validateAssetReference(
      await readJSON(resolve(root, values["shared-assets"])),
      config.deployment?.assets.url,
    );
  }
  const reportPath = resolve(root, values.report ?? ".local/builds/report.json");
  if (action === "build") {
    if (!report.sharedAssets) throw new Error("Builds require one immutable shared asset manifest reference.");
    if (!hostMatchesTarget(target)) throw new Error("Native engine builds require their qualified target host.");
    assertRuntimeFacts(expectedRuntime, currentRuntimeFacts());
    const selectedBun = values.bun ? resolve(root, values.bun) : Bun.which("bun");
    if (!selectedBun) throw new Error("Select the qualified Aphrody Bun executable.");
    const runtime = await qualifyRuntime(
      selectedBun,
      expectedRuntime,
      target,
      root,
      qualification,
      values["runtime-receipt"] ? await readJSON(resolve(root, values["runtime-receipt"])) : undefined,
    );
    report.runtimeReceipt = runtime.receipt;
    const resources = await resourceInputs(values.resources ? resolve(root, values.resources) : undefined, ids);
    const output = checkoutPath(root, values.output ?? "build/apps");
    const nativeTimeout = deadline(values["native-timeout"], 1800, 43_200);
    const compileTimeout = deadline(values["compile-timeout"], 180, 600);
    for (const result of report.results) {
      await buildOne(config, result, report, {
        root,
        output,
        bun: runtime.executable,
        resources: resources[result.appId] ?? [],
        nativeTimeout,
        compileTimeout,
      });
      await writeJSON(reportPath, report);
    }
    report.complete = report.results.every(result => result.status === "built");
    await writeJSON(reportPath, report);
  } else if (values.report) await writeJSON(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  return action === "build" && !report.complete ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(JSON.stringify(errorDetails(error)));
    process.exitCode = 1;
  }
}
