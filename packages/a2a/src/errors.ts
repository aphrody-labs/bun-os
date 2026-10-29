// SPDX-License-Identifier: Apache-2.0
/** A2A error model: JSON-RPC codes, google.rpc.ErrorInfo reasons, HTTP+JSON error bodies. */
import type { JsonValue } from "./generated/a2a.ts";

/**
 * Error codes of the A2A 1.0 specification (section 5.4) and of JSON-RPC 2.0. Kept in step with
 * `crates/aphrody-a2a/src/errors.rs`; the test suite compares both tables.
 */
export const A2A_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** `ErrorInfo.reason` of an A2A error: the error type in UPPER_SNAKE_CASE without `Error`. */
export type A2AErrorReason = keyof typeof A2A_ERROR_CODES;

/** Domain of the A2A `google.rpc.ErrorInfo` details. */
export const A2A_ERROR_DOMAIN = "a2a-protocol.org";
const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

/** Typed detail object (`@type` plus the members of the packed message). */
export interface ErrorDetail {
  "@type": string;
  [member: string]: JsonValue;
}

/** Aliases some agents still send as `ErrorInfo.reason`. */
const REASON_ALIASES: Readonly<Record<string, A2AErrorReason>> = {
  UNSUPPORTED_CONTENT_TYPE: "CONTENT_TYPE_NOT_SUPPORTED",
  EXTENDED_CARD_NOT_CONFIGURED: "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
};

export function errorReasonForCode(code: number): A2AErrorReason | undefined {
  for (const [reason, value] of Object.entries(A2A_ERROR_CODES)) {
    if (value === code) return reason as A2AErrorReason;
  }
  return undefined;
}

export function errorCodeForReason(reason: string): number | undefined {
  const known = (A2A_ERROR_CODES as Record<string, number>)[REASON_ALIASES[reason] ?? reason];
  return known;
}

function isDetail(value: unknown): value is ErrorDetail {
  return typeof value === "object" && value !== null && typeof (value as ErrorDetail)["@type"] === "string";
}

export interface A2AErrorInit {
  code: number;
  message: string;
  details?: readonly ErrorDetail[];
  /** HTTP status of the HTTP+JSON binding, when the error came from it. */
  httpStatus?: number;
  /** JSON-RPC method or REST operation that failed. */
  method?: string;
}

/** The agent answered with an A2A or JSON-RPC error. */
export class A2AError extends Error {
  readonly code: number;
  /** `ErrorInfo.reason`, or the reason implied by the code. */
  readonly reason: A2AErrorReason | string | undefined;
  readonly domain: string | undefined;
  /** `ErrorInfo.metadata` (for example `taskId`, `timestamp`). */
  readonly metadata: Readonly<Record<string, string>>;
  readonly details: readonly ErrorDetail[];
  readonly httpStatus: number | undefined;
  readonly method: string | undefined;

  constructor(init: A2AErrorInit) {
    super(init.message);
    this.name = "A2AError";
    this.code = init.code;
    this.details = init.details ?? [];
    this.httpStatus = init.httpStatus;
    this.method = init.method;
    const info = this.details.find(d => d["@type"] === ERROR_INFO_TYPE);
    const reason = typeof info?.reason === "string" ? info.reason : undefined;
    this.reason = reason ? (REASON_ALIASES[reason] ?? reason) : errorReasonForCode(init.code);
    this.domain = typeof info?.domain === "string" ? info.domain : undefined;
    const metadata: Record<string, string> = {};
    const raw = info?.metadata;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) if (typeof value === "string") metadata[key] = value;
    }
    this.metadata = metadata;
  }

  /** True when this error carries the given A2A reason. */
  is(reason: A2AErrorReason): boolean {
    return this.reason === reason;
  }

  get taskId(): string | undefined {
    return this.metadata.taskId;
  }
}

export type TransportErrorKind = "network" | "timeout" | "aborted" | "http" | "protocol" | "stream";

/** The exchange failed before an A2A answer could be read (network, HTTP status, malformed body). */
export class A2ATransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status: number | undefined;
  readonly method: string | undefined;

  constructor(
    kind: TransportErrorKind,
    message: string,
    options: { status?: number; method?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "A2ATransportError";
    this.kind = kind;
    this.status = options.status;
    this.method = options.method;
  }
}

/** The Agent Card could not be fetched, parsed, or offers no interface this client can use. */
export class A2ADiscoveryError extends Error {
  readonly kind: "fetch" | "invalid" | "no-interface";
  readonly status: number | undefined;

  constructor(kind: A2ADiscoveryError["kind"], message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "A2ADiscoveryError";
    this.kind = kind;
    this.status = options.status;
  }
}

interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export function isRpcErrorShape(value: unknown): value is RpcErrorShape {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RpcErrorShape).code === "number" &&
    typeof (value as RpcErrorShape).message === "string"
  );
}

/** Build an {@link A2AError} from a JSON-RPC error object (`data` is an array of typed details). */
export function a2aErrorFromRpc(error: RpcErrorShape, method?: string): A2AError {
  const details = Array.isArray(error.data) ? error.data.filter(isDetail) : [];
  return new A2AError({
    code: error.code,
    message: error.message,
    details,
    method,
  });
}

/** Build an {@link A2AError} from an HTTP+JSON error body (`google.rpc.Status` JSON). */
export function a2aErrorFromRest(status: number, body: unknown, method?: string): A2AError {
  const error = (body as { error?: unknown } | null | undefined)?.error;
  if (typeof error === "object" && error !== null) {
    const { message, details } = error as {
      message?: unknown;
      details?: unknown;
    };
    const typed = Array.isArray(details) ? details.filter(isDetail) : [];
    const info = typed.find(d => d["@type"] === ERROR_INFO_TYPE);
    const reason = typeof info?.reason === "string" ? info.reason : undefined;
    const code = (reason ? errorCodeForReason(reason) : undefined) ?? codeForHttpStatus(status);
    return new A2AError({
      code,
      message: typeof message === "string" ? message : `HTTP ${status}`,
      details: typed,
      httpStatus: status,
      method,
    });
  }
  return new A2AError({
    code: codeForHttpStatus(status),
    message: `HTTP ${status}`,
    httpStatus: status,
    method,
  });
}

function codeForHttpStatus(status: number): number {
  switch (status) {
    case 404:
      return A2A_ERROR_CODES.TASK_NOT_FOUND;
    case 400:
      return A2A_ERROR_CODES.INVALID_PARAMS;
    case 501:
      return A2A_ERROR_CODES.METHOD_NOT_FOUND;
    default:
      return A2A_ERROR_CODES.INTERNAL_ERROR;
  }
}
