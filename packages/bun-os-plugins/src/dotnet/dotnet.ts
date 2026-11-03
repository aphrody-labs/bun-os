// SPDX-License-Identifier: MIT
/**
 * `bun:dotnet` of the aphrody-labs/bun fork on upstream Bun. The CLR is hosted in the Bun process through hostfxr and
 * bun:ffi (./hostfxr.ts); the object model (types, statics, instances, Task -> Promise, delegates, events, .d.ts
 * generation) is node-api-dotnet, loaded from @aphrody/bun-dotnet or the node-api-dotnet npm package. The SDK
 * commands run the `dotnet` muxer of the located install.
 */
import { CFunction, type FFIFunction } from "bun:ffi";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import * as fxr from "./hostfxr.ts";

export { DotnetError, type DotnetLocation, type EnvSnapshot, type FunctionPointerOptions } from "./hostfxr.ts";

const TARGET_FRAMEWORKS = ["net10.0", "net9.0", "net8.0", "net472"] as const;
type TargetFramework = (typeof TARGET_FRAMEWORKS)[number];

function invalid(name: string, expected: string, value: unknown): TypeError {
  const error = new TypeError(`The "${name}" argument must be ${expected}. Received ${typeof value}`);
  (error as TypeError & { code: string }).code = "ERR_INVALID_ARG_TYPE";
  return error;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(name, "of type string", value);
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw invalid(name, "of type string", value);
  return value;
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(name, "of type object", value);
}

function array(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw invalid(name, "an instance of Array", value);
}

/** The install bun:dotnet hosts: `dotnetRoot` when given. */
export function locate(dotnetRoot?: string) {
  return fxr.locate(optionalString(dotnetRoot, "dotnetRoot"));
}

/** Every install, the primary one, the SDK `cwd` selects, .NET Framework and the .NET environment variables. */
export function info(cwd?: string) {
  return fxr.info(optionalString(cwd, "cwd"));
}

/** The cached environment snapshot for `cwd`. */
export function env(cwd?: string, refresh = false) {
  return fxr.env(optionalString(cwd, "cwd"), !!refresh);
}

/** The SDK `cwd` selects or, with a `.runtimeconfig.json`, the frameworks that app binds to. */
export function resolve(runtimeConfig?: string, cwd?: string) {
  const config = optionalString(runtimeConfig, "runtimeConfig");
  if (config !== undefined) return fxr.resolveFrameworks(resolvePath(config));
  return fxr.resolveSdk(optionalString(cwd, "cwd"));
}

/** Starts the CLR: 0 started here, 1 or 2 when already running. */
export function initialize(runtimeConfig?: string): number {
  return fxr.initialize(optionalString(runtimeConfig, "runtimeConfig"));
}

export function runtimeConfig(): string | null {
  return fxr.runtimeConfig();
}

export function functionPointer(options: fxr.FunctionPointerOptions): number {
  object(options, "options");
  return fxr.functionPointer({
    assembly: optionalString(options.assembly, "options.assembly"),
    type: requiredString(options.type, "options.type"),
    method: requiredString(options.method, "options.method"),
    delegateType: optionalString(options.delegateType, "options.delegateType"),
  });
}

export type UnmanagedSignature = Partial<Pick<FFIFunction, "args" | "returns">>;

/** A managed `[UnmanagedCallersOnly]` (or delegate-typed) static method as a callable bun:ffi function. */
export function unmanaged(options: fxr.FunctionPointerOptions, signature: UnmanagedSignature = {}) {
  object(signature, "signature");
  if (signature.args !== undefined) array(signature.args, "signature.args");
  return CFunction({
    args: signature.args ?? [],
    returns: signature.returns ?? "void",
    ptr: functionPointer(options) as never,
  });
}

export function loadAssembly(assemblyPath: string): void {
  fxr.loadAssembly(resolvePath(requiredString(assemblyPath, "assemblyPath")));
}

// ─── node-api-dotnet object model ───────────────────────────────────────────────────────────────────────────────────

function resolveFrom(specifier: string): string | undefined {
  const bases = [join(process.cwd(), "noop.js")];
  if (typeof Bun.main === "string" && isAbsolute(Bun.main)) bases.push(Bun.main);
  for (const base of bases) {
    try {
      return Bun.resolveSync(specifier, dirname(base));
    } catch {}
  }
  return undefined;
}

function notFound(what: string): Error {
  const error = new Error(
    `bun:dotnet: ${what} not found. Install @aphrody/bun-dotnet (bun add @aphrody/bun-dotnet) or node-api-dotnet, or set BUN_DOTNET_NODE_API to its dotnet/out/pkg directory`,
  );
  (error as Error & { code: string }).code = "ERR_BUN_DOTNET_NODE_API_NOT_FOUND";
  return error;
}

/** Directory holding node-api-dotnet/ and node-api-dotnet-generator/. */
function packageOutput(): string | undefined {
  const explicit = process.env.BUN_DOTNET_NODE_API;
  if (explicit) {
    const root = resolvePath(explicit);
    return existsSync(join(root, "node-api-dotnet")) || existsSync(join(root, "node-api-dotnet-generator"))
      ? root
      : dirname(root);
  }
  const bunDotnet = resolveFrom("@aphrody/bun-dotnet/package.json");
  if (bunDotnet !== undefined) return join(dirname(bunDotnet), "dotnet", "out", "pkg");
  const nodeApi = resolveFrom("node-api-dotnet/package.json");
  if (nodeApi !== undefined) return dirname(dirname(nodeApi));
  return undefined;
}

function nodeApiModule(relative: string, what: string): string {
  const output = packageOutput();
  const file = output === undefined ? undefined : join(output, relative);
  if (file === undefined || !existsSync(file)) throw notFound(what);
  return file;
}

function validateFramework(targetFramework: string): asserts targetFramework is TargetFramework {
  if (!(TARGET_FRAMEWORKS as readonly string[]).includes(targetFramework)) {
    const error = new TypeError(
      `The argument 'targetFramework' must be one of ${TARGET_FRAMEWORKS.join(", ")}. Received '${targetFramework}'`,
    );
    (error as TypeError & { code: string }).code = "ERR_INVALID_ARG_VALUE";
    throw error;
  }
}

interface NodeApiDotnet {
  load(assembly: string): void;
  addListener(event: "resolving", listener: (...args: unknown[]) => unknown): void;
  removeListener(event: "resolving", listener: (...args: unknown[]) => unknown): void;
  [name: string]: unknown;
}

let hostModule: NodeApiDotnet | undefined;

/** node-api-dotnet hosted for `targetFramework` (default net10.0): the .NET object model in JavaScript. */
export function host(targetFramework: string = "net10.0"): NodeApiDotnet {
  validateFramework(targetFramework);
  if (hostModule !== undefined) return hostModule;
  const file = nodeApiModule(join("node-api-dotnet", `${targetFramework}.js`), "node-api-dotnet");
  hostModule = createRequire(file)(file) as NodeApiDotnet;
  return hostModule;
}

export function load(assembly: string, targetFramework?: string): NodeApiDotnet {
  requiredString(assembly, "assembly");
  const dotnet = host(targetFramework);
  dotnet.load(isAbsolute(assembly) || !/[\\/]|\.dll$/i.test(assembly) ? assembly : resolvePath(assembly));
  return dotnet;
}

export function addAssemblyResolver(listener: (...args: unknown[]) => unknown): void {
  host().addListener("resolving", listener);
}

export function removeAssemblyResolver(listener: (...args: unknown[]) => unknown): void {
  host().removeListener("resolving", listener);
}

// ─── SDK commands ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface DotnetCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

async function spawnCollect(cmd: string[], options: DotnetCommandOptions = {}) {
  object(options as unknown, "options");
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...(options.env ?? process.env) },
    signal: options.signal,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function muxer(): string {
  const location = fxr.locate();
  if (!location.muxer) throw new fxr.DotnetError(`${location.dotnetRoot} has no dotnet muxer`);
  return location.muxer;
}

/** Runs the `dotnet` muxer of the located install (the fork ran `bun dotnet`, its in-process muxer). */
export function dotnet(args: string[], options?: DotnetCommandOptions) {
  array(args, "args");
  const location = fxr.locate();
  const env = { ...(options?.env ?? process.env) };
  env.DOTNET_ROOT ??= location.dotnetRoot;
  env.DOTNET_CLI_TELEMETRY_OPTOUT ??= "1";
  env.DOTNET_NOLOGO ??= "1";
  return spawnCollect([muxer(), ...(args as string[])], { ...options, env });
}

export interface GenerateTypesOptions extends DotnetCommandOptions {
  assembly: string | string[];
  output: string;
  framework?: string;
  references?: string[];
  module?: string;
}

/** `.d.ts` for managed assemblies through node-api-dotnet-generator. */
export function generateTypes(options: GenerateTypesOptions) {
  object(options, "options");
  const assemblies = Array.isArray(options.assembly) ? options.assembly : [options.assembly];
  for (const assembly of assemblies) requiredString(assembly, "options.assembly");
  requiredString(options.output, "options.output");
  const framework = options.framework ?? "net10.0";
  validateFramework(framework);
  const args = ["-a", assemblies.join(";"), "-t", options.output, "-f", framework];
  if (options.references?.length) args.push("-r", options.references.join(";"));
  if (options.module) args.push("-m", options.module);
  const generator = nodeApiModule(join("node-api-dotnet-generator", "index.js"), "node-api-dotnet-generator");
  const env = { ...process.env, ...options.env };
  env.DOTNET_ROLL_FORWARD ??= "Major";
  return spawnCollect([process.execPath, generator, ...args], { ...options, env });
}

export const build = (args: string[] = [], options?: DotnetCommandOptions) => dotnet(["build", ...args], options);
export const run = (args: string[] = [], options?: DotnetCommandOptions) => dotnet(["run", ...args], options);
export const newProject = (args: string[] = [], options?: DotnetCommandOptions) => dotnet(["new", ...args], options);
export const test = (args: string[] = [], options?: DotnetCommandOptions) => dotnet(["test", ...args], options);

export default {
  locate,
  info,
  env,
  resolve,
  initialize,
  runtimeConfig,
  functionPointer,
  unmanaged,
  loadAssembly,
  host,
  load,
  addAssemblyResolver,
  removeAssemblyResolver,
  dotnet,
  build,
  run,
  newProject,
  test,
  generateTypes,
};
