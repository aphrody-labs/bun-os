// SPDX-License-Identifier: Apache-2.0
import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  fstatSync,
  fsyncSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { replaceTomlTable } from "./agent-plugin-providers.ts";
import { isOwnedByCurrentUser, isOwnerOnly } from "./portable-fs.ts";

type Environment = Record<string, string>;
type Json = Record<string, unknown>;
const MAX_BYTES = 2 * 1024 * 1024;
const IMMUTABLE = new Set([
  "HOME",
  "PATH",
  "USERPROFILE",
  "APHRODY_HOME",
  "APHRODY_PROFILE",
  "APHRODY_WORKSPACE",
  "APHRODY_AGENT_DOMAIN",
]);
const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPLICIT_PROCESS_AUTH = new Set(["CONTEXT7_API_KEY", "SSH_AUTH_SOCK"]);
const object = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP configuration must be an object");
  return value as Json;
};
function fingerprint(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
function serialize(env: Environment): string {
  return `${JSON.stringify(Object.fromEntries(Object.entries(env).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))}\n`;
}
function environment(value: unknown): Environment {
  const result: Environment = Object.create(null) as Environment;
  for (const [key, entry] of Object.entries(object(value))) {
    if (!keyPattern.test(key) || typeof entry !== "string" || entry.includes("\0"))
      throw new Error("MCP environment contains invalid entries");
    result[key] = entry;
  }
  if (Buffer.byteLength(serialize(result)) > MAX_BYTES) throw new Error("MCP environment exceeds its size bound");
  return result;
}
/** The canonical stdio server binary; Windows executables carry an `.exe` suffix. */
function isCanonicalServer(path: string): boolean {
  const name = basename(path);
  return name === "aphrody-mcp" || (process.platform === "win32" && name.toLowerCase() === "aphrody-mcp.exe");
}
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("MCP configuration contains invalid JSON");
  }
}
function privateText(path: string): string {
  if (!isAbsolute(path)) throw new Error("MCP private source must be absolute");
  let descriptor: number | undefined;
  try {
    const link = lstatSync(path);
    if (!link.isFile() || link.isSymbolicLink()) throw new Error();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (
      !isOwnedByCurrentUser(stat.uid) ||
      !isOwnerOnly(stat.mode) ||
      stat.size > MAX_BYTES ||
      stat.ino !== link.ino ||
      stat.dev !== link.dev
    )
      throw new Error();
    const text = readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(text) > MAX_BYTES || text.includes("\0")) throw new Error();
    return text;
  } catch {
    throw new Error("MCP private source must be a bounded, owned, private regular file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function privateDirectory(path: string): void {
  if (!isAbsolute(path)) throw new Error("MCP profile directory must be absolute");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !isOwnedByCurrentUser(stat.uid) ||
    !isOwnerOnly(stat.mode) ||
    realpathSync(path) !== resolve(path)
  )
    throw new Error("MCP profile directory must be private and owned");
}
function atomicWrite(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    if (existsSync(path)) privateText(path);
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export interface McpEnvironmentRequirements {
  required: string[];
  processKeys: string[];
  aliases: Record<string, string[]>;
}
/** Contracts contain names and source references; target defaults do not grant authentication. */
export function loadMcpEnvironmentRequirements(
  repoRoot: string,
  services: readonly string[] = [],
  requireRag = false,
): McpEnvironmentRequirements {
  let ai: Json, secrets: Json;
  try {
    ai = object(safeJson(readFileSync(join(repoRoot, "tools/aphrody/config/local-ai.json"), "utf8")));
    secrets = object(safeJson(readFileSync(join(repoRoot, "tools/config/secrets-contract.json"), "utf8")));
  } catch {
    throw new Error("MCP environment contracts unavailable or invalid");
  }
  const required = new Set<string>(),
    processKeys = new Set<string>(["APHRODY_MCP_DATABASE_URL"]);
  const aliases: Record<string, string[]> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Json;
    if (typeof record.canonical === "string" && keyPattern.test(record.canonical)) {
      const names = Array.isArray(record.aliases)
        ? record.aliases.filter((name): name is string => typeof name === "string" && keyPattern.test(name))
        : [];
      aliases[record.canonical] = names;
      // Alias endpoint/origin forms are deliberately not rewritten.
      processKeys.add(record.canonical);
      for (const name of names) processKeys.add(name);
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(ai);
  if (requireRag) required.add("APHRODY_MCP_DATABASE_URL");
  const entries = object(secrets.services);
  for (const service of new Set(["aphrody-mcp-http", ...services])) {
    if (!service.startsWith("aphrody-")) throw new Error("MCP environment service belongs to another domain");
    const entry = object(entries[service]);
    if (!Array.isArray(entry.secrets)) throw new Error("MCP secret contract has invalid fields");
    for (const field of entry.secrets) {
      const descriptor = object(field),
        key = descriptor.name;
      if (typeof key !== "string" || !keyPattern.test(key) || typeof descriptor.required !== "boolean")
        throw new Error("MCP secret contract has invalid fields");
      processKeys.add(key);
      if (descriptor.required && services.includes(service)) required.add(key);
    }
  }
  return {
    required: [...required].toSorted(),
    processKeys: [...processKeys].toSorted(),
    aliases,
  };
}

/** Only the explicitly nominated, same-user canonical server may contribute process credentials. */
export function readMcpProcessEnvironment(pid: number, binary: string, keys: readonly string[]): Environment {
  if (!Number.isSafeInteger(pid) || pid < 1 || !isAbsolute(binary)) throw new Error("MCP process source is invalid");
  try {
    const root = `/proc/${pid}`;
    if (lstatSync(root).uid !== process.getuid?.()) throw new Error();
    const executable = realpathSync(readlinkSync(join(root, "exe")));
    // Multicall executables resolve to aphrody; argv[0] still proves the selected MCP surface.
    const command = readFileSync(join(root, "cmdline"), "utf8").split("\0");
    if (executable !== realpathSync(binary) || basename(command[0] ?? "") !== "aphrody-mcp") throw new Error();
    const startTime = (): string | undefined => readFileSync(join(root, "stat"), "utf8").split(") ")[1]?.split(" ")[19];
    const identity = startTime();
    const bytes = readFileSync(join(root, "environ"));
    if (!identity || bytes.length > MAX_BYTES || startTime() !== identity) throw new Error();
    const allowed = new Set(keys),
      values: Environment = {};
    for (const field of bytes.toString("utf8").split("\0")) {
      const separator = field.indexOf("=");
      if (separator < 1) continue;
      const key = field.slice(0, separator);
      if (allowed.has(key) && !IMMUTABLE.has(key)) values[key] = field.slice(separator + 1);
    }
    return environment(values);
  } catch {
    throw new Error("MCP process source failed ownership or canonical-server validation");
  }
}

export interface PreparedMcpEnvironment {
  schemaVersion: 1;
  profile: "aphrody" | "dbfr" | "ie";
  path: string;
  fingerprint: string;
  keys: string[];
  sources: { id: string; keys: string[] }[];
  missingRequired: string[];
}
export interface PrepareMcpEnvironmentOptions {
  profile: PreparedMcpEnvironment["profile"];
  outputDir: string;
  repoRoot: string;
  env?: Record<string, string | undefined>;
  processPid?: number;
  binary?: string;
  processBinary?: string;
  sourceFiles?: readonly string[];
  services?: readonly string[];
  requirements?: McpEnvironmentRequirements;
  configTargets?: readonly McpConfigTarget[];
  processKeys?: readonly string[];
}
export function prepareMcpEnvironment(options: PrepareMcpEnvironmentOptions): PreparedMcpEnvironment {
  const requirements =
    options.requirements ??
    loadMcpEnvironmentRequirements(options.repoRoot, options.services, options.profile === "dbfr");
  const additionalProcessKeys = options.processKeys ?? [];
  if (additionalProcessKeys.some(key => !EXPLICIT_PROCESS_AUTH.has(key)))
    throw new Error("MCP explicit process keys must be supported authentication references");
  const env = environment(
    Object.fromEntries(Object.entries(options.env ?? process.env).filter(([, value]) => value !== undefined)),
  );
  for (const selectedDomain of [env.APHRODY_AGENT_DOMAIN, env.APHRODY_PROFILE]) {
    if (selectedDomain && selectedDomain !== options.profile)
      throw new Error("MCP profile does not match the inherited domain");
  }
  const sources = [{ id: "bun-environment", keys: Object.keys(env).toSorted() }];
  const merge = (id: string, source: Environment): void => {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(source)) {
      if (IMMUTABLE.has(key) && env[key] !== value)
        throw new Error("MCP source would replace inherited host or domain settings");
      if (!env[key] && value) {
        env[key] = value;
        keys.push(key);
      }
    }
    sources.push({ id, keys: keys.toSorted() });
  };
  if (options.processPid !== undefined) {
    const processBinary = options.processBinary ?? options.binary;
    if (!processBinary) throw new Error("MCP process source requires the canonical binary");
    merge(
      `process:${options.processPid}`,
      readMcpProcessEnvironment(options.processPid, processBinary, [
        ...requirements.processKeys,
        ...additionalProcessKeys,
      ]),
    );
  }
  for (const path of options.sourceFiles ?? []) {
    if (!path.endsWith(".json"))
      throw new Error("MCP producer sources must be explicit private JSON maps; Bun resolves standard dotenv files");
    merge(`file:${resolve(path)}`, environment(safeJson(privateText(path))));
  }
  for (const target of options.configTargets ?? []) {
    const raw = readConfiguration(target);
    const servers = object(raw[target.provider === "codex" ? "mcp_servers" : "mcpServers"] ?? {});
    if (servers.aphrody === undefined) continue;
    const server = object(servers.aphrody);
    merge(`agent:${target.provider}`, environment(server.env ?? {}));
  }
  const path = join(options.outputDir, `${options.profile}.json`);
  // Refresh the explicitly nominated profile, including after the original process exits.
  // Current Bun/process/file inputs take precedence; unrelated profiles are never searched.
  if (existsSync(path)) {
    const previous = environment(safeJson(privateText(path)));
    for (const domain of [previous.APHRODY_PROFILE, previous.APHRODY_AGENT_DOMAIN]) {
      if (domain && domain !== options.profile) throw new Error("MCP saved profile belongs to another domain");
    }
    delete previous.APHRODY_MCP_ENV_FILE;
    delete previous.APHRODY_MCP_CONFIG;
    // A refresh does not restore absent host/routing settings from an older launch.
    for (const key of IMMUTABLE) if (env[key] === undefined) delete previous[key];
    merge(`profile:${path}`, previous);
  }
  // Never load a previous profile recursively or retain a temporary native-client configuration.
  delete env.APHRODY_MCP_ENV_FILE;
  delete env.APHRODY_MCP_CONFIG;
  privateDirectory(options.outputDir);
  const content = serialize(env);
  atomicWrite(path, content);
  return {
    schemaVersion: 1,
    profile: options.profile,
    path,
    fingerprint: fingerprint(content),
    keys: Object.keys(env).toSorted(),
    sources,
    missingRequired: requirements.required.filter(
      key => !env[key] && !(requirements.aliases[key] ?? []).some(alias => !!env[alias]),
    ),
  };
}

/** Inspect one existing protected profile without refreshing or disclosing its values. */
export function loadPreparedMcpEnvironment(options: {
  profile: PreparedMcpEnvironment["profile"];
  path: string;
  repoRoot: string;
  services?: readonly string[];
  requirements?: McpEnvironmentRequirements;
}): PreparedMcpEnvironment {
  if (basename(options.path) !== `${options.profile}.json`)
    throw new Error("MCP saved profile belongs to another domain");
  const env = environment(safeJson(privateText(options.path)));
  for (const domain of [env.APHRODY_PROFILE, env.APHRODY_AGENT_DOMAIN]) {
    if (domain && domain !== options.profile) throw new Error("MCP saved profile belongs to another domain");
  }
  if (env.APHRODY_MCP_ENV_FILE || env.APHRODY_MCP_CONFIG)
    throw new Error("MCP saved profile contains recursive routing references");
  const requirements =
    options.requirements ??
    loadMcpEnvironmentRequirements(options.repoRoot, options.services, options.profile === "dbfr");
  const keys = Object.keys(env).toSorted();
  return {
    schemaVersion: 1,
    profile: options.profile,
    path: options.path,
    fingerprint: fingerprint(serialize(env)),
    keys,
    sources: [{ id: `profile:${options.path}`, keys }],
    missingRequired: requirements.required.filter(
      key => !env[key] && !(requirements.aliases[key] ?? []).some(alias => !!env[alias]),
    ),
  };
}

export interface McpConfigTarget {
  provider: "codex" | "claude" | "agy" | "aphrody";
  path: string;
}
export interface McpConfigChange {
  target: McpConfigTarget;
  beforeFingerprint: string;
  afterFingerprint: string;
  content: string;
}
function readConfiguration(target: McpConfigTarget): Json {
  const text = privateText(target.path);
  try {
    return object(target.provider === "codex" ? Bun.TOML.parse(text) : safeJson(text));
  } catch {
    throw new Error("MCP agent configuration is invalid");
  }
}
/** Read existing global configurations only; never create phantom provider installations. */
export function existingMcpConfigTargets(home: string): McpConfigTarget[] {
  return (
    [
      { provider: "codex", path: join(home, ".codex/config.toml") },
      { provider: "claude", path: join(home, ".claude.json") },
      { provider: "agy", path: join(home, ".gemini/config/mcp_config.json") },
      { provider: "aphrody", path: join(home, ".config/aphrody/mcp.json") },
    ] satisfies McpConfigTarget[]
  ).filter(target => existsSync(target.path));
}
export function planMcpEnvironmentConfiguration(
  prepared: PreparedMcpEnvironment,
  binary: string,
  targets: readonly McpConfigTarget[],
): McpConfigChange[] {
  if (!isAbsolute(binary) || !isCanonicalServer(binary))
    throw new Error("MCP configuration requires the canonical server path");
  const values = environment(safeJson(privateText(prepared.path)));
  if (fingerprint(serialize(values)) !== prepared.fingerprint) throw new Error("MCP profile changed after preparation");
  return targets.map(target => {
    const before = privateText(target.path);
    const raw = readConfiguration(target);
    const field = target.provider === "codex" ? "mcp_servers" : "mcpServers";
    const servers = object(raw[field] ?? {}),
      current = object(servers.aphrody ?? {});
    const inherited = environment(current.env ?? {});
    // Inline secret values must already have been preserved in the protected profile.
    for (const [key, value] of Object.entries(inherited)) {
      if (key === "APHRODY_MCP_ENV_FILE") continue;
      if (values[key] !== value)
        throw new Error("MCP configuration contains environment values absent from the prepared profile");
    }
    const server: Json = {
      ...current,
      command: binary,
      env: { APHRODY_MCP_ENV_FILE: prepared.path },
    };
    delete server.url;
    delete server.headers;
    delete server.http_headers;
    if (typeof current.command === "string" && !isCanonicalServer(current.command))
      throw new Error("MCP configuration is not the canonical stdio server");
    if (
      Array.isArray(current.args) &&
      current.args.some(arg => typeof arg !== "string" || ["kernel", "mcp", "tool-host"].includes(arg))
    )
      throw new Error("MCP configuration contains deprecated command routing");
    const content =
      target.provider === "codex"
        ? replaceTomlTable(before, "mcp_servers.aphrody", server)
        : `${JSON.stringify({ ...raw, [field]: { ...servers, aphrody: server } }, null, 2)}\n`;
    return {
      target,
      beforeFingerprint: fingerprint(before),
      afterFingerprint: fingerprint(content),
      content,
    };
  });
}

export interface McpEnvironmentProbe {
  supported: boolean;
  completed: boolean;
  binaryFingerprint: string;
  profileFingerprint: string;
  toolCount: number;
  ragReady: boolean;
  failure?: string;
}
async function capture(
  command: string[],
  env: Environment,
  timeoutMs: number,
): Promise<{ code: number; text: string }> {
  const child = Bun.spawn(command, {
    windowsHide: true,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const reader = child.stdout.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      // A stream must be read in order and bounded before consuming the next chunk.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_BYTES) {
        child.kill();
        throw new Error("MCP probe exceeded its output bound");
      }
      chunks.push(result.value);
    }
    return {
      code: await child.exited,
      text: Buffer.concat(chunks).toString("utf8"),
    };
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    child.kill();
    await child.exited;
  }
}
/** The existing native client owns handshake and transport; no second JSON-RPC implementation. */
export async function probeMcpEnvironment(
  prepared: PreparedMcpEnvironment,
  binary: string,
  timeoutMs = 30000,
): Promise<McpEnvironmentProbe> {
  const result: McpEnvironmentProbe = {
    supported: false,
    completed: false,
    binaryFingerprint: "",
    profileFingerprint: prepared.fingerprint,
    toolCount: 0,
    ragReady: false,
  };
  try {
    if (!isAbsolute(binary) || !isCanonicalServer(binary) || timeoutMs < 1 || timeoutMs > 60000) throw new Error();
    const profile = environment(safeJson(privateText(prepared.path)));
    if (fingerprint(serialize(profile)) !== prepared.fingerprint) throw new Error();
    result.binaryFingerprint = fingerprint(readFileSync(realpathSync(binary)));
    const env = { ...profile };
    delete env.APHRODY_MCP_ENV_FILE;
    const help = await capture([binary, "--help"], env, timeoutMs);
    result.supported = help.code === 0 && help.text.includes("--env-file");
    if (!result.supported) {
      result.failure = "native-environment-loader-unavailable";
      return result;
    }
    const configPath = join(dirname(prepared.path), `.probe-${crypto.randomUUID()}.json`);
    try {
      atomicWrite(
        configPath,
        JSON.stringify({
          mcpServers: {
            aphrody: {
              command: binary,
              args: ["--env-file", prepared.path],
              env: { APHRODY_MCP_ENV_FILE: prepared.path },
            },
          },
        }),
      );
      // The native list operation accepts structured command/args from the config.
      // Its older --stdio parser splits whitespace and must not receive quoted paths.
      const listing = await capture(
        [binary, "--env-file", prepared.path, "client", "list", "aphrody", "--config", configPath],
        env,
        timeoutMs,
      );
      if (listing.code !== 0) {
        result.failure = "native-stdio-probe-failed";
        return result;
      }
      const lines = listing.text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => object(safeJson(line)));
      const tools = lines.filter(line => line.kind === "tool");
      const header = lines.find(line => line.kind === "server_info");
      if (header?.tool_count !== tools.length) throw new Error();
      result.toolCount = tools.length;
      if (prepared.missingRequired.length !== 0) {
        result.failure = "required-environment-unavailable";
        return result;
      }
      if (!tools.some(tool => tool.name === "aphrody_rag_search")) {
        result.failure = "native-rag-tool-unavailable";
        return result;
      }
      const rag = await capture(
        [
          binary,
          "--env-file",
          prepared.path,
          "client",
          "call",
          "aphrody",
          "aphrody_rag_search",
          "--config",
          configPath,
          "--args",
          JSON.stringify({ q: "MCP environment verification", limit: 1 }),
        ],
        env,
        timeoutMs,
      );
      if (rag.code === 0) {
        const response = object(object(safeJson(rag.text)).result);
        if (response.isError !== true && Array.isArray(response.content)) {
          result.ragReady = response.content.some((entry: unknown) => {
            const block = object(entry);
            if (block.type !== "text" || typeof block.text !== "string") return false;
            const body = object(safeJson(block.text));
            if (body.error !== undefined) {
              const message = typeof body.error === "string" ? body.error : object(body.error).message;
              result.failure =
                message === "RAG database unavailable"
                  ? "native-rag-database-unavailable"
                  : message === "RAG search unavailable"
                    ? "native-rag-search-unavailable"
                    : "native-rag-backend-error";
              return false;
            }
            return body.error === undefined && Array.isArray(body.results);
          });
        }
      }
    } finally {
      rmSync(configPath, { force: true });
    }
    result.completed = result.toolCount > 0 && result.ragReady;
    if (!result.completed) result.failure ??= "native-rag-probe-failed";
    return result;
  } catch {
    result.failure = "native-probe-unavailable";
    return result;
  }
}
export async function applyMcpEnvironmentConfiguration(
  prepared: PreparedMcpEnvironment,
  binary: string,
  targets: readonly McpConfigTarget[],
): Promise<{ applied: number; probe: McpEnvironmentProbe }> {
  const changes = planMcpEnvironmentConfiguration(prepared, binary, targets);
  const probe = await probeMcpEnvironment(prepared, binary);
  if (!probe.completed) return { applied: 0, probe };
  // Check every input before writing any provider configuration.
  for (const change of changes)
    if (fingerprint(privateText(change.target.path)) !== change.beforeFingerprint)
      throw new Error("MCP configuration changed during verification");
  privateDirectory(join(dirname(prepared.path), "backups"));
  for (const change of changes) {
    const backup = join(
      dirname(prepared.path),
      "backups",
      `${fingerprint(change.target.path)}-${change.beforeFingerprint}.json`,
    );
    if (!existsSync(backup)) atomicWrite(backup, privateText(change.target.path));
    atomicWrite(change.target.path, change.content);
  }
  return { applied: changes.length, probe };
}

export async function runMcpEnvironment(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        profile: { type: "string", default: "aphrody" },
        output: { type: "string" },
        repo: { type: "string", default: process.cwd() },
        binary: { type: "string" },
        "process-binary": { type: "string" },
        pid: { type: "string" },
        source: { type: "string", multiple: true },
        "process-key": { type: "string", multiple: true },
        service: { type: "string", multiple: true },
        home: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (parsed.values.help) {
      console.log(
        "yolo ops mcp-environment <prepare|probe|apply> --output PRIVATE_DIR --binary /absolute/aphrody-mcp [--home AGENT_HOME] [--service ID] [--profile aphrody|dbfr|ie]\nprepare: [--pid PID --process-binary EXISTING_NATIVE] [--process-key CONTEXT7_API_KEY|SSH_AUTH_SOCK] [--source PRIVATE_JSON]\nprobe/apply: inspect the prepared profile without refreshing its environment",
      );
      return 0;
    }
    const [action = "prepare"] = parsed.positionals,
      { values } = parsed;
    if (
      !["prepare", "probe", "apply"].includes(action) ||
      parsed.positionals.length > 1 ||
      !values.output ||
      !["aphrody", "dbfr", "ie"].includes(values.profile!)
    )
      throw new Error("Invalid MCP environment operation");
    const profile = values.profile as PreparedMcpEnvironment["profile"];
    if (
      action !== "prepare" &&
      (values.pid !== undefined ||
        values.source?.length ||
        values["process-key"]?.length ||
        values["process-binary"] !== undefined)
    )
      throw new Error("MCP source refresh requires prepare before verification");
    const prepared =
      action === "prepare"
        ? prepareMcpEnvironment({
            profile,
            outputDir: values.output,
            repoRoot: values.repo!,
            binary: values.binary,
            processBinary: values["process-binary"],
            processPid: values.pid === undefined ? undefined : Number(values.pid),
            sourceFiles: values.source,
            services: values.service,
            processKeys: values["process-key"],
            configTargets: values.home ? existingMcpConfigTargets(values.home) : undefined,
          })
        : loadPreparedMcpEnvironment({
            profile,
            path: join(values.output, `${profile}.json`),
            repoRoot: values.repo!,
            services: values.service,
          });
    if (action === "prepare") {
      console.log(JSON.stringify(prepared));
      return prepared.missingRequired.length ? 1 : 0;
    }
    if (!values.binary) throw new Error("MCP verification requires the canonical binary");
    if (action === "probe") {
      const probe = await probeMcpEnvironment(prepared, values.binary);
      console.log(JSON.stringify({ prepared, probe }));
      return probe.completed ? 0 : 1;
    }
    if (!values.home) throw new Error("MCP configuration apply requires an explicit agent home");
    const result = await applyMcpEnvironmentConfiguration(
      prepared,
      values.binary,
      existingMcpConfigTargets(values.home),
    );
    console.log(JSON.stringify({ prepared, ...result }));
    return result.probe.completed ? 0 : 1;
  } catch {
    console.error("MCP environment operation failed; protected values omitted");
    return 1;
  }
}
