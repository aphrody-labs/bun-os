// SPDX-License-Identifier: Apache-2.0
/**
 * Compatibility shim for the pre-1.0 dialect still spoken by older peers (`message/send`,
 * `tasks/get`, `tasks/update`, `kind`/`type` part discriminators, lower-case task states).
 *
 * Direction: a legacy request comes in, an A2A 1.0 agent is called through {@link A2AClient}, and
 * the answer goes back out in the legacy shape. See "Legacy dialect shim" in the package README
 * for the full mapping tables. The pure `upgrade*` and `downgrade*` functions are exported so a
 * caller that only needs one side of the translation can use them directly.
 */
import type { A2AClient } from "./client.ts";
import { A2AError, A2ATransportError, A2A_ERROR_CODES } from "./errors.ts";
import type {
  A2AMethod,
  AgentCard,
  Artifact,
  AuthenticationInfo,
  JsonObject,
  JsonValue,
  Message,
  Part,
  SendMessageConfiguration,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
  TaskState,
  TaskStatus,
} from "./generated/a2a.ts";
import { messageText, taskText } from "./helpers.ts";
import { isTerminalState, streamPayloadKind } from "./protocol.ts";

// ---------------------------------------------------------------------------
// Method table
// ---------------------------------------------------------------------------

/** Legacy method name to the A2A 1.0 method that serves it. `agent/card` is answered locally. */
export const LEGACY_METHODS: Readonly<Record<string, A2AMethod | "agent/card">> = {
  "message/send": "SendMessage",
  "message/stream": "SendStreamingMessage",
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "tasks/resubscribe": "SubscribeToTask",
  "tasks/pushNotificationConfig/set": "CreateTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/get": "GetTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/list": "ListTaskPushNotificationConfigs",
  "tasks/pushNotificationConfig/delete": "DeleteTaskPushNotificationConfig",
  "agent/getAuthenticatedExtendedCard": "GetExtendedAgentCard",
  // Aphrody hub convention, not an A2A method: a worker reports on a task. Served by SendMessage.
  "tasks/update": "SendMessage",
  "agent/card": "agent/card",
  "agent/getCard": "agent/card",
};

/** Legacy methods answered with an event stream. */
export const LEGACY_STREAMING_METHODS: ReadonlySet<string> = new Set(["message/stream", "tasks/resubscribe"]);

// ---------------------------------------------------------------------------
// Dialect profiles
// ---------------------------------------------------------------------------

/** How outgoing (downgraded) payloads are written. Incoming payloads accept both spellings. */
export interface LegacyProfile {
  /** Member that names the type of a part or an event: `kind` (A2A 0.3) or `type` (hub dialect). */
  discriminator: "kind" | "type";
  /** `input-required` (A2A 0.3) or `input_required` (hub dialect). */
  stateStyle: "kebab" | "snake";
  /** `message/send` result: the task or message itself (A2A 0.3), or the hub's `{taskId, status, response, task}`. */
  sendResult: "a2a" | "hub";
}

/** Wire dialect of the A2A 0.3 specification. */
export const A2A_03_PROFILE: LegacyProfile = {
  discriminator: "kind",
  stateStyle: "kebab",
  sendResult: "a2a",
};
/** Wire dialect of the pre-1.0 snake-case A2A hub. */
export const HUB_PROFILE: LegacyProfile = {
  discriminator: "type",
  stateStyle: "snake",
  sendResult: "hub",
};

export interface LegacyOptions {
  profile?: LegacyProfile;
  /**
   * Fleet `target` of a flat `message/send` to the `aphrody_peer` metadata the Rust coord executor
   * routes on. Return `undefined` to leave the message unrouted. Default: no routing key.
   */
  peerForTarget?: (target: string) => string | undefined;
  /** Id factory for messages that arrive without `messageId`. Default `crypto.randomUUID`. */
  newMessageId?: () => string;
}

// ---------------------------------------------------------------------------
// Task states
// ---------------------------------------------------------------------------

const STATE_BY_LEGACY: Readonly<Record<string, TaskState>> = {
  submitted: "TASK_STATE_SUBMITTED",
  working: "TASK_STATE_WORKING",
  "input-required": "TASK_STATE_INPUT_REQUIRED",
  input_required: "TASK_STATE_INPUT_REQUIRED",
  completed: "TASK_STATE_COMPLETED",
  canceled: "TASK_STATE_CANCELED",
  cancelled: "TASK_STATE_CANCELED",
  failed: "TASK_STATE_FAILED",
  rejected: "TASK_STATE_REJECTED",
  "auth-required": "TASK_STATE_AUTH_REQUIRED",
  auth_required: "TASK_STATE_AUTH_REQUIRED",
  unknown: "TASK_STATE_UNSPECIFIED",
};

/** A legacy state name (either spelling) or an already-1.0 name, as a 1.0 `TaskState`. */
export function legacyStateToTaskState(state: unknown): TaskState {
  if (typeof state !== "string") return "TASK_STATE_UNSPECIFIED";
  if (state.startsWith("TASK_STATE_")) return state as TaskState;
  return STATE_BY_LEGACY[state.toLowerCase()] ?? "TASK_STATE_UNSPECIFIED";
}

/** A 1.0 `TaskState` as a legacy state name. */
export function taskStateToLegacy(state: TaskState | undefined, style: LegacyProfile["stateStyle"] = "kebab"): string {
  const name = (state ?? "TASK_STATE_UNSPECIFIED").replace(/^TASK_STATE_/, "").toLowerCase();
  const kebab = name === "unspecified" ? "unknown" : name.replaceAll("_", "-");
  return style === "snake" ? kebab.replaceAll("-", "_") : kebab;
}

// ---------------------------------------------------------------------------
// Legacy to 1.0
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;

function isLoose(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

function object(value: unknown): JsonObject | undefined {
  return isLoose(value) ? (value as JsonObject) : undefined;
}

/** A legacy part (`kind` or `type` discriminator) as a 1.0 part. A part already in 1.0 shape passes through. */
export function upgradePart(raw: unknown): Part {
  if (!isLoose(raw)) throw new TypeError("a message part must be an object");
  const kind = str(raw.kind) ?? str(raw.type);
  const metadata = object(raw.metadata);
  const extras = metadata ? { metadata } : {};
  switch (kind) {
    case "text":
      return {
        text: String(raw.text ?? ""),
        ...extras,
        ...(str(raw.mediaType) ? { mediaType: str(raw.mediaType) } : {}),
      };
    case "data":
      return {
        data: (raw.data ?? {}) as JsonValue,
        mediaType: str(raw.mediaType) ?? "application/json",
        ...extras,
      };
    case "file": {
      const file = isLoose(raw.file) ? raw.file : {};
      const bytes = str(file.bytes) ?? str(file.bytesBase64) ?? str(file.fileWithBytes);
      const uri = str(file.uri) ?? str(file.fileWithUri);
      const common = {
        ...(str(file.name) ? { filename: str(file.name) } : {}),
        ...(str(file.mimeType) ? { mediaType: str(file.mimeType) } : {}),
        ...extras,
      };
      if (bytes) return { raw: bytes, ...common };
      if (uri) return { url: uri, ...common };
      throw new TypeError("a file part needs bytes or a uri");
    }
    case undefined: {
      const known = ["text", "raw", "url", "data"].filter(key => raw[key] !== undefined);
      if (known.length !== 1) throw new TypeError("a part needs exactly one of text, raw, url, data");
      return raw as unknown as Part;
    }
    default:
      throw new TypeError(`unsupported part kind: ${kind}`);
  }
}

function upgradeRole(role: unknown, metadata: JsonObject): "ROLE_USER" | "ROLE_AGENT" {
  const name = typeof role === "string" ? role.toLowerCase() : "user";
  if (name === "agent" || name === "role_agent") return "ROLE_AGENT";
  // The hub also had a `system` role; 1.0 has none. The sender is the client side: keep a trace.
  if (name === "system") metadata.legacyRole = "system";
  return "ROLE_USER";
}

/** A legacy message as a 1.0 message. */
export function upgradeMessage(raw: unknown, options: LegacyOptions = {}): Message {
  if (!isLoose(raw)) throw new TypeError("message must be an object");
  const metadata: JsonObject = { ...object(raw.metadata) };
  const role = upgradeRole(raw.role, metadata);
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) throw new TypeError("message.parts must not be empty");
  const message: Message = {
    messageId: str(raw.messageId) ?? (options.newMessageId ?? crypto.randomUUID.bind(crypto))(),
    role,
    parts: raw.parts.map(upgradePart),
  };
  if (str(raw.contextId)) message.contextId = str(raw.contextId);
  if (str(raw.taskId)) message.taskId = str(raw.taskId);
  const extensions = strings(raw.extensions);
  if (extensions) message.extensions = extensions;
  const references = strings(raw.referenceTaskIds);
  if (references) message.referenceTaskIds = references;
  if (Object.keys(metadata).length > 0) message.metadata = metadata;
  return message;
}

/** Legacy push config (`authentication.schemes[]`) as a 1.0 config; `taskId` is given separately. */
export function upgradePushConfig(raw: unknown, taskId?: string): Omit<TaskPushNotificationConfig, "tenant"> {
  if (!isLoose(raw)) throw new TypeError("pushNotificationConfig must be an object");
  const url = str(raw.url);
  if (!url) throw new TypeError("pushNotificationConfig.url is required");
  const config: Omit<TaskPushNotificationConfig, "tenant"> = { url };
  if (str(raw.id)) config.id = str(raw.id);
  if (taskId ?? str(raw.taskId)) config.taskId = taskId ?? str(raw.taskId);
  if (str(raw.token)) config.token = str(raw.token);
  if (isLoose(raw.authentication)) {
    const scheme = str(raw.authentication.scheme) ?? strings(raw.authentication.schemes)?.[0];
    if (scheme) {
      const authentication: AuthenticationInfo = { scheme };
      if (str(raw.authentication.credentials)) authentication.credentials = str(raw.authentication.credentials);
      config.authentication = authentication;
    }
  }
  return config;
}

function upgradeConfiguration(raw: unknown): SendMessageConfiguration | undefined {
  if (!isLoose(raw)) return undefined;
  const configuration: SendMessageConfiguration = {};
  const modes = strings(raw.acceptedOutputModes);
  if (modes) configuration.acceptedOutputModes = modes;
  if (typeof raw.historyLength === "number") configuration.historyLength = raw.historyLength;
  // 0.3 `blocking: false` is 1.0 `returnImmediately: true`; blocking is the default of both.
  if (raw.blocking === false) configuration.returnImmediately = true;
  if (typeof raw.returnImmediately === "boolean") configuration.returnImmediately = raw.returnImmediately;
  if (raw.pushNotificationConfig !== undefined) {
    configuration.taskPushNotificationConfig = upgradePushConfig(
      raw.pushNotificationConfig,
    ) as TaskPushNotificationConfig;
  }
  return Object.keys(configuration).length > 0 ? configuration : undefined;
}

/** Hub artifacts (`{name, type, data|content|uri}`) as parts, so they can ride in a message. */
function artifactsToParts(artifacts: unknown): Part[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter(isLoose).map((artifact): Part => {
    const metadata: JsonObject = {
      artifactName: str(artifact.name) ?? "artifact",
    };
    switch (artifact.type) {
      case "json":
        return {
          data: (artifact.data ?? {}) as JsonValue,
          mediaType: "application/json",
          metadata,
        };
      case "markdown":
        return {
          text: String(artifact.content ?? ""),
          mediaType: "text/markdown",
          metadata,
        };
      case "file":
        return { url: String(artifact.uri ?? ""), metadata };
      default:
        return {
          text: String(artifact.content ?? ""),
          mediaType: "text/plain",
          metadata: {
            ...metadata,
            artifactType: String(artifact.type ?? "code"),
          },
        };
    }
  });
}

/** Result of translating one legacy request. */
export type UpgradedRequest =
  | { method: A2AMethod; params: Record<string, unknown>; legacyMethod: string }
  | {
      method: "agent/card";
      params: Record<string, never>;
      legacyMethod: string;
    };

/**
 * Translate the method and params of a legacy request. Throws `TypeError` for params that cannot be
 * mapped (reported to the caller as JSON-RPC `-32602`) and `RangeError` for an unknown method.
 */
export function upgradeRequest(method: string, rawParams: unknown, options: LegacyOptions = {}): UpgradedRequest {
  const target = LEGACY_METHODS[method];
  if (!target) throw new RangeError(`Method not found: ${method}`);
  const params: Loose = isLoose(rawParams) ? rawParams : {};
  if (target === "agent/card") return { method: target, params: {}, legacyMethod: method };
  const out = (p: Record<string, unknown>): UpgradedRequest => ({
    method: target,
    params: p,
    legacyMethod: method,
  });

  switch (method) {
    case "message/send":
    case "message/stream":
      return out(upgradeSend(params, options) as unknown as Record<string, unknown>);
    case "tasks/update":
      return out(upgradeTaskUpdate(params, options) as unknown as Record<string, unknown>);
    case "tasks/get": {
      const id = str(params.id) ?? str(params.taskId);
      if (!id) throw new TypeError("Missing taskId parameter");
      return out({
        id,
        ...(typeof params.historyLength === "number" ? { historyLength: params.historyLength } : {}),
      });
    }
    case "tasks/list": {
      const list: Record<string, unknown> = {};
      if (str(params.contextId)) list.contextId = str(params.contextId);
      if (str(params.status)) list.status = legacyStateToTaskState(params.status);
      if (typeof params.pageSize === "number") list.pageSize = params.pageSize;
      if (str(params.pageToken)) list.pageToken = str(params.pageToken);
      if (typeof params.historyLength === "number") list.historyLength = params.historyLength;
      return out(list);
    }
    case "tasks/cancel":
    case "tasks/resubscribe": {
      const id = str(params.id) ?? str(params.taskId);
      if (!id) throw new TypeError("Missing taskId parameter");
      return out({
        id,
        ...(method === "tasks/cancel" && object(params.metadata) ? { metadata: object(params.metadata) } : {}),
      });
    }
    case "tasks/pushNotificationConfig/set": {
      const taskId = str(params.taskId) ?? str(params.id);
      if (!taskId) throw new TypeError("Missing taskId parameter");
      return out(upgradePushConfig(params.pushNotificationConfig ?? params, taskId) as Record<string, unknown>);
    }
    case "tasks/pushNotificationConfig/get":
    case "tasks/pushNotificationConfig/delete": {
      const taskId = str(params.taskId) ?? str(params.id);
      const id = str(params.pushNotificationConfigId) ?? (str(params.taskId) ? str(params.id) : undefined);
      if (!taskId || !id) throw new TypeError("taskId and pushNotificationConfigId are required");
      return out({ taskId, id });
    }
    case "tasks/pushNotificationConfig/list": {
      const taskId = str(params.taskId) ?? str(params.id);
      if (!taskId) throw new TypeError("Missing taskId parameter");
      return out({ taskId });
    }
    default:
      return out({});
  }
}

function upgradeSend(params: Loose, options: LegacyOptions): SendMessageRequest {
  const metadata: JsonObject = { ...object(params.metadata) };
  let message: Message;
  if (params.message !== undefined) {
    message = upgradeMessage(params.message, options);
  } else {
    // Flat fleet form: { target, sourceAgent, instruction, yolo, data }.
    const instruction = str(params.instruction);
    const parts: Part[] = [];
    if (instruction) parts.push({ text: instruction });
    if (isLoose(params.data) && Object.keys(params.data).length > 0)
      parts.push(upgradePart({ kind: "data", data: params.data }));
    if (parts.length === 0) throw new TypeError("message or instruction is required");
    message = {
      messageId: (options.newMessageId ?? crypto.randomUUID.bind(crypto))(),
      role: "ROLE_USER",
      parts,
    };
  }
  for (const key of ["target", "sourceAgent", "yolo"] as const) {
    const value = params[key] ?? (message.metadata?.[key] as unknown);
    if (value !== undefined) metadata[key] = value as JsonValue;
  }
  const target = str(metadata.target) ?? str(message.metadata?.targetAgent);
  if (target) {
    metadata.target = target;
    const peer = options.peerForTarget?.(target);
    if (peer) metadata.aphrody_peer = peer;
  }
  const request: SendMessageRequest = { message };
  const configuration = upgradeConfiguration(params.configuration);
  if (configuration) request.configuration = configuration;
  if (Object.keys(metadata).length > 0) request.metadata = metadata;
  return request;
}

/** `tasks/update`: a worker reply bound to an existing task, carried as an agent message. */
function upgradeTaskUpdate(params: Loose, options: LegacyOptions): SendMessageRequest {
  const taskId = str(params.taskId) ?? str(params.id);
  if (!taskId) throw new TypeError("Missing taskId parameter");
  const parts: Part[] = [];
  const text = str(params.text) ?? str(params.message);
  if (text) parts.push({ text });
  if (isLoose(params.data) && Object.keys(params.data).length > 0)
    parts.push(upgradePart({ kind: "data", data: params.data }));
  parts.push(...artifactsToParts(params.artifacts));
  if (parts.length === 0) parts.push({ text: `Status ${str(params.status) ?? "update"}` });
  const metadata: JsonObject = { legacyMethod: "tasks/update" };
  if (str(params.sourceAgent)) metadata.sourceAgent = str(params.sourceAgent) as string;
  if (str(params.status)) metadata.status = taskStateToLegacy(legacyStateToTaskState(params.status), "kebab");
  if (str(params.verdict)) metadata.verdict = str(params.verdict) as string;
  return {
    message: {
      messageId: (options.newMessageId ?? crypto.randomUUID.bind(crypto))(),
      role: "ROLE_AGENT",
      taskId,
      parts,
      metadata,
    },
  };
}

// ---------------------------------------------------------------------------
// 1.0 to legacy
// ---------------------------------------------------------------------------

function tag(profile: LegacyProfile, value: string): Record<string, string> {
  return { [profile.discriminator]: value };
}

/** A 1.0 part as a legacy part. A non-object `data` value is wrapped as `{ value }`. */
export function downgradePart(part: Part, profile: LegacyProfile = A2A_03_PROFILE): JsonObject {
  const metadata: JsonObject = part.metadata ? { metadata: part.metadata } : {};
  if (part.text !== undefined) return { ...tag(profile, "text"), text: part.text, ...metadata };
  if (part.data !== undefined) {
    const data = isLoose(part.data) ? part.data : { value: part.data };
    return { ...tag(profile, "data"), data: data as JsonValue, ...metadata };
  }
  const file: JsonObject = {};
  if (part.raw !== undefined) file.bytes = part.raw;
  if (part.url !== undefined) file.uri = part.url;
  if (part.filename) file.name = part.filename;
  if (part.mediaType) file.mimeType = part.mediaType;
  return { ...tag(profile, "file"), file, ...metadata };
}

export function downgradeMessage(message: Message, profile: LegacyProfile = A2A_03_PROFILE): JsonObject {
  const legacyRole =
    message.metadata?.legacyRole === "system" ? "system" : message.role === "ROLE_AGENT" ? "agent" : "user";
  return {
    ...(profile.discriminator === "kind" ? { kind: "message" } : {}),
    messageId: message.messageId,
    role: legacyRole,
    parts: message.parts.map(p => downgradePart(p, profile)),
    ...(message.contextId ? { contextId: message.contextId } : {}),
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
    ...(message.extensions ? { extensions: message.extensions } : {}),
    ...(message.referenceTaskIds ? { referenceTaskIds: message.referenceTaskIds } : {}),
  };
}

function downgradeStatus(status: TaskStatus, profile: LegacyProfile): JsonObject {
  return {
    state: taskStateToLegacy(status.state, profile.stateStyle),
    ...(status.message ? { message: downgradeMessage(status.message, profile) } : {}),
    ...(status.timestamp ? { timestamp: status.timestamp } : {}),
  };
}

export function downgradeArtifact(artifact: Artifact, profile: LegacyProfile = A2A_03_PROFILE): JsonObject {
  return {
    artifactId: artifact.artifactId,
    ...(artifact.name ? { name: artifact.name } : {}),
    ...(artifact.description ? { description: artifact.description } : {}),
    parts: artifact.parts.map(p => downgradePart(p, profile)),
    ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
    ...(artifact.extensions ? { extensions: artifact.extensions } : {}),
  };
}

export function downgradeTask(task: Task, profile: LegacyProfile = A2A_03_PROFILE): JsonObject {
  return {
    ...(profile.discriminator === "kind" ? { kind: "task" } : {}),
    id: task.id,
    ...(task.contextId ? { contextId: task.contextId } : {}),
    status: downgradeStatus(task.status, profile),
    ...(task.artifacts ? { artifacts: task.artifacts.map(a => downgradeArtifact(a, profile)) } : {}),
    ...(task.history ? { history: task.history.map(m => downgradeMessage(m, profile)) } : {}),
    ...(task.metadata ? { metadata: task.metadata } : {}),
  };
}

/** A 1.0 stream event as a legacy event (`status-update`, `artifact-update`, task or message). */
export function downgradeStreamResponse(event: StreamResponse, profile: LegacyProfile = A2A_03_PROFILE): JsonObject {
  switch (streamPayloadKind(event)) {
    case "task":
      return downgradeTask(event.task as Task, profile);
    case "message":
      return downgradeMessage(event.message as Message, profile);
    case "statusUpdate": {
      const update = event.statusUpdate as NonNullable<StreamResponse["statusUpdate"]>;
      return {
        ...tag(profile, "status-update"),
        taskId: update.taskId,
        contextId: update.contextId,
        status: downgradeStatus(update.status, profile),
        final: isTerminalState(update.status.state),
        ...(update.metadata ? { metadata: update.metadata } : {}),
      };
    }
    case "artifactUpdate": {
      const update = event.artifactUpdate as NonNullable<StreamResponse["artifactUpdate"]>;
      return {
        ...tag(profile, "artifact-update"),
        taskId: update.taskId,
        contextId: update.contextId,
        artifact: downgradeArtifact(update.artifact, profile),
        ...(update.append !== undefined ? { append: update.append } : {}),
        ...(update.lastChunk !== undefined ? { lastChunk: update.lastChunk } : {}),
        ...(update.metadata ? { metadata: update.metadata } : {}),
      };
    }
    default:
      throw new TypeError("not a stream response");
  }
}

/** Result of a legacy `message/send`, in the profile's style. */
export function downgradeSendResponse(
  response: SendMessageResponse,
  profile: LegacyProfile = A2A_03_PROFILE,
): JsonObject {
  if (profile.sendResult === "a2a") {
    return response.task
      ? downgradeTask(response.task, profile)
      : downgradeMessage(response.message as Message, profile);
  }
  // Hub style: { taskId, status, verdict?, response: { role, parts }, task? }
  const task = response.task;
  const text = task ? taskText(task) : messageText(response.message);
  const data = task?.artifacts?.flatMap(a => a.parts).find(p => p.data !== undefined)?.data;
  const verdict = task?.metadata?.verdict;
  return {
    ...(task
      ? {
          taskId: task.id,
          status: taskStateToLegacy(task.status.state, profile.stateStyle),
        }
      : { status: "completed" }),
    ...(typeof verdict === "string" ? { verdict } : {}),
    response: {
      role: "agent",
      parts: [downgradePart({ text }, profile), downgradePart({ data: (data ?? {}) as JsonValue }, profile)],
    },
    ...(task ? { task: downgradeTask(task, profile) } : {}),
  };
}

/** A 1.0 card with the pre-1.0 transport members (`url`, `preferredTransport`, `protocolVersion`). */
export function downgradeAgentCard(card: AgentCard): JsonObject {
  const [preferred, ...rest] = card.supportedInterfaces;
  return {
    ...(card as unknown as JsonObject),
    ...(preferred
      ? {
          url: preferred.url,
          preferredTransport: preferred.protocolBinding,
          protocolVersion: preferred.protocolVersion,
        }
      : {}),
    ...(rest.length > 0
      ? {
          additionalInterfaces: rest.map(i => ({
            url: i.url,
            transport: i.protocolBinding,
          })),
        }
      : {}),
    ...(card.capabilities?.extendedAgentCard ? { supportsAuthenticatedExtendedCard: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export interface LegacyRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type LegacyRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: LegacyRpcError };

/** The slice of {@link A2AClient} the bridge drives (narrow on purpose, easy to fake). */
export type BridgeClient = Pick<
  A2AClient,
  | "sendMessage"
  | "sendStreamingMessage"
  | "getTask"
  | "listTasks"
  | "cancelTask"
  | "subscribeToTask"
  | "createPushNotificationConfig"
  | "getPushNotificationConfig"
  | "listPushNotificationConfigs"
  | "deletePushNotificationConfig"
  | "getExtendedAgentCard"
  | "card"
>;

function rpcError(id: LegacyRpcResponse["id"], code: number, message: string, data?: unknown): LegacyRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/**
 * Serve legacy JSON-RPC requests from an A2A 1.0 agent. One `LegacyBridge` per upstream client:
 *
 * ```ts
 * const bridge = new LegacyBridge(await A2AClient.connect(url), { profile: HUB_PROFILE });
 * const reply = await bridge.handle(await request.json()); // legacy in, legacy out
 * ```
 *
 * Streaming methods (`message/stream`, `tasks/resubscribe`) go through {@link handleStream}; use
 * {@link isStreaming} to choose. A2A errors keep their code; transport failures become `-32603`.
 */
export class LegacyBridge {
  private readonly profile: LegacyProfile;

  constructor(
    private readonly client: BridgeClient,
    private readonly options: LegacyOptions = {},
  ) {
    this.profile = options.profile ?? A2A_03_PROFILE;
  }

  /** True when the request is answered with an event stream. */
  isStreaming(request: unknown): boolean {
    return isLoose(request) && typeof request.method === "string" && LEGACY_STREAMING_METHODS.has(request.method);
  }

  private parse(
    request: unknown,
  ): { id: LegacyRpcResponse["id"]; method: string; params: unknown } | LegacyRpcResponse {
    if (!isLoose(request)) return rpcError(null, -32600, "Invalid Request");
    const id = typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || request.method === "") {
      return rpcError(id, -32600, "Invalid JSON-RPC 2.0 request");
    }
    return { id, method: request.method, params: request.params };
  }

  private failure(id: LegacyRpcResponse["id"], cause: unknown): LegacyRpcResponse {
    if (cause instanceof A2AError) {
      return rpcError(id, cause.code, cause.message, cause.details.length > 0 ? cause.details : undefined);
    }
    if (cause instanceof RangeError) return rpcError(id, A2A_ERROR_CODES.METHOD_NOT_FOUND, cause.message);
    if (cause instanceof TypeError) return rpcError(id, A2A_ERROR_CODES.INVALID_PARAMS, cause.message);
    if (cause instanceof A2ATransportError) {
      return rpcError(id, A2A_ERROR_CODES.INTERNAL_ERROR, `Internal error: ${cause.message}`);
    }
    return rpcError(
      id,
      A2A_ERROR_CODES.INTERNAL_ERROR,
      "Internal error",
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  /** Answer one unary legacy request. Never throws: failures are JSON-RPC error responses. */
  async handle(request: unknown): Promise<LegacyRpcResponse> {
    const parsed = this.parse(request);
    if ("jsonrpc" in parsed) return parsed;
    const { id, method, params } = parsed;
    try {
      if (LEGACY_STREAMING_METHODS.has(method)) {
        return rpcError(id, A2A_ERROR_CODES.INVALID_REQUEST, `${method} is a streaming method: use handleStream`);
      }
      const call = upgradeRequest(method, params, this.options);
      const result = await this.dispatch(call);
      return {
        jsonrpc: "2.0",
        id,
        result: this.downgradeResult(call, result, params),
      };
    } catch (cause) {
      return this.failure(id, cause);
    }
  }

  /** Answer a streaming legacy request: one JSON-RPC response per event (each an SSE `data:` line). */
  async *handleStream(request: unknown): AsyncGenerator<LegacyRpcResponse> {
    const parsed = this.parse(request);
    if ("jsonrpc" in parsed) {
      yield parsed;
      return;
    }
    const { id, method, params } = parsed;
    try {
      if (!LEGACY_STREAMING_METHODS.has(method)) {
        yield rpcError(id, A2A_ERROR_CODES.INVALID_REQUEST, `${method} is not a streaming method: use handle`);
        return;
      }
      const call = upgradeRequest(method, params, this.options);
      const events =
        call.method === "SendStreamingMessage"
          ? this.client.sendStreamingMessage(call.params as unknown as SendMessageRequest)
          : this.client.subscribeToTask(call.params as { id: string });
      for await (const event of events) {
        yield {
          jsonrpc: "2.0",
          id,
          result: downgradeStreamResponse(event, this.profile),
        };
      }
    } catch (cause) {
      yield this.failure(id, cause);
    }
  }

  private async dispatch(call: UpgradedRequest): Promise<unknown> {
    const c = this.client;
    const p = call.params as never;
    switch (call.method) {
      case "agent/card":
        if (!c.card)
          throw new A2AError({
            code: A2A_ERROR_CODES.INTERNAL_ERROR,
            message: "agent card unavailable",
          });
        return c.card;
      case "SendMessage":
        return c.sendMessage(p);
      case "GetTask":
        return c.getTask(p);
      case "ListTasks":
        return c.listTasks(p);
      case "CancelTask":
        return c.cancelTask(p);
      case "CreateTaskPushNotificationConfig":
        return c.createPushNotificationConfig(p);
      case "GetTaskPushNotificationConfig":
        return c.getPushNotificationConfig(p);
      case "ListTaskPushNotificationConfigs":
        return c.listPushNotificationConfigs(p);
      case "DeleteTaskPushNotificationConfig":
        await c.deletePushNotificationConfig(p);
        return {};
      case "GetExtendedAgentCard":
        return c.getExtendedAgentCard();
      default:
        throw new RangeError(`Method not found: ${call.legacyMethod}`);
    }
  }

  private downgradeResult(call: UpgradedRequest, result: unknown, legacyParams: unknown): unknown {
    const profile = this.profile;
    switch (call.method) {
      case "agent/card":
      case "GetExtendedAgentCard":
        return downgradeAgentCard(result as AgentCard);
      case "SendMessage": {
        const response = result as SendMessageResponse;
        if (call.legacyMethod === "tasks/update") {
          // The hub answered a worker report with the updated task.
          return downgradeSendResponse(response, {
            ...profile,
            sendResult: "hub",
          });
        }
        return downgradeSendResponse(response, profile);
      }
      case "GetTask":
      case "CancelTask":
        return downgradeTask(result as Task, profile);
      case "ListTasks": {
        let tasks = (result as { tasks: Task[] }).tasks;
        const target = isLoose(legacyParams) ? str(legacyParams.target) : undefined;
        // 1.0 has no `target` filter: match what the executor recorded on the task.
        if (target) tasks = tasks.filter(t => t.metadata?.target === target || t.metadata?.aphrody_peer === target);
        return {
          tasks: tasks.map(t => downgradeTask(t, profile)),
          total: tasks.length,
        };
      }
      case "CreateTaskPushNotificationConfig":
      case "GetTaskPushNotificationConfig":
        return downgradePushConfig(result as TaskPushNotificationConfig);
      case "ListTaskPushNotificationConfigs":
        return (result as { configs: TaskPushNotificationConfig[] }).configs.map(downgradePushConfig);
      default:
        return result;
    }
  }
}

/** A 1.0 push config as the legacy `{ taskId, pushNotificationConfig }` pair. */
export function downgradePushConfig(config: TaskPushNotificationConfig): JsonObject {
  const authentication: JsonObject = config.authentication
    ? {
        authentication: {
          schemes: [config.authentication.scheme],
          ...(config.authentication.credentials ? { credentials: config.authentication.credentials } : {}),
        },
      }
    : {};
  return {
    taskId: config.taskId ?? "",
    pushNotificationConfig: {
      ...(config.id ? { id: config.id } : {}),
      url: config.url,
      ...(config.token ? { token: config.token } : {}),
      ...authentication,
    },
  };
}
