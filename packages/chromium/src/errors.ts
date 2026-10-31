// SPDX-License-Identifier: MIT
// Node-style argument errors, replacing the fork's `$ERR_*` builtin intrinsics.

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `function ${value.name || "<anonymous>"}`;
  if (typeof value === "object") return `an instance of ${value.constructor?.name ?? "Object"}`;
  const shown =
    typeof value === "string" ? JSON.stringify(value.length > 28 ? `${value.slice(0, 25)}...` : value) : String(value);
  return `type ${typeof value} (${shown})`;
}

function coded<E extends Error>(error: E, code: string): E {
  Object.defineProperty(error, "code", { value: code, enumerable: false, configurable: true, writable: true });
  return error;
}

export function ERR_INVALID_ARG_TYPE(name: string, expected: string | string[], actual: unknown): TypeError {
  const list = Array.isArray(expected) ? expected.join(" or ") : expected;
  return coded(
    new TypeError(`The "${name}" argument must be of type ${list}. Received ${describe(actual)}`),
    "ERR_INVALID_ARG_TYPE",
  );
}

export function ERR_INVALID_ARG_VALUE(name: string, value: unknown, reason = "is invalid"): TypeError {
  return coded(new TypeError(`The argument '${name}' ${reason}. Received ${describe(value)}`), "ERR_INVALID_ARG_VALUE");
}

export function ERR_OUT_OF_RANGE(name: string, range: string, value: unknown): RangeError {
  return coded(
    new RangeError(`The value of "${name}" is out of range. It must be ${range}. Received ${String(value)}`),
    "ERR_OUT_OF_RANGE",
  );
}
