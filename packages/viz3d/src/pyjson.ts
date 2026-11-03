// SPDX-License-Identifier: MIT
// Python `json` compatibility for the catalog hashes. Upstream hashes `json.dumps(..., sort_keys=True,
// ensure_ascii=False, separators=(",", ":"))`, where a float read from a file keeps its float type (`1.0` stays
// `1.0`) and is printed with `repr()`. A plain JSON.parse loses that distinction, so hashing goes through the
// lossless parse below: values are ordinary JSON values except floats, which are `PyFloat` boxes.

/** A Python float: printed with repr(), so 1.0 stays "1.0" and 1e-05 stays "1e-05". */
export class PyFloat {
  constructor(readonly value: number) {}
}

export type PyValue = null | boolean | number | bigint | string | PyFloat | PyValue[] | { [key: string]: PyValue };

/** Python's repr() of a float (float_repr_style "short"). */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  // toExponential() without an argument yields the shortest digits that round-trip, like Python's repr.
  const [mantissa, exponent] = Math.abs(x).toExponential().split("e") as [string, string];
  const digits = mantissa.replace(".", "");
  const decpt = Number(exponent) + 1;
  if (decpt > -4 && decpt <= 16) {
    if (decpt <= 0) return `${sign}0.${"0".repeat(-decpt)}${digits}`;
    if (decpt >= digits.length) return `${sign}${digits}${"0".repeat(decpt - digits.length)}.0`;
    return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }
  const e = decpt - 1;
  const body = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${body}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

/** JSON.parse that keeps float-ness: number tokens with a fraction or exponent become PyFloat. */
export function parseLossless(text: string): PyValue {
  let i = 0;
  const fail = (what: string): never => {
    throw new SyntaxError(`${what} at offset ${i}`);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const value = (): PyValue => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const out: { [key: string]: PyValue } = {};
      ws();
      if (text[i] === "}") return i++, out;
      for (;;) {
        ws();
        if (text[i] !== '"') fail("expected key");
        const key = string();
        ws();
        if (text[i++] !== ":") fail("expected :");
        out[key] = value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return i++, out;
        else fail("expected , or }");
      }
    }
    if (c === "[") {
      i++;
      const out: PyValue[] = [];
      ws();
      if (text[i] === "]") return i++, out;
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return i++, out;
        else fail("expected , or ]");
      }
    }
    if (c === '"') return string();
    if (text.startsWith("true", i)) return (i += 4), true;
    if (text.startsWith("false", i)) return (i += 5), false;
    if (text.startsWith("null", i)) return (i += 4), null;
    const match = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (!match) return fail("unexpected token");
    i += match[0].length;
    if (match[1] || match[2]) return new PyFloat(Number(match[0]));
    const n = Number(match[0]);
    return Number.isSafeInteger(n) ? (Object.is(n, -0) ? 0 : n) : BigInt(match[0]);
  };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const out = value();
  ws();
  if (i !== text.length) fail("trailing data");
  return out;
}

/** Strip PyFloat boxes: the plain JSON value the rest of the code uses. */
export function plain(value: PyValue): unknown {
  if (value instanceof PyFloat) return value.value;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

export interface DumpOptions {
  sortKeys?: boolean;
  ensureAscii?: boolean;
  /** Python separators; the default is the compact (",", ":"). */
  separators?: [string, string];
  /** Python indent; separators then default to (",", ": "). */
  indent?: number;
}

function quote(s: string, ensureAscii: boolean): string {
  const json = JSON.stringify(s);
  if (!ensureAscii) return json;
  return json.replace(/[\u0080-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Python json.dumps of a PyValue (plain numbers print as ints when integral, as floats otherwise). */
export function pyDumps(value: unknown, options: DumpOptions = {}): string {
  const { sortKeys = false, ensureAscii = true, indent } = options;
  const [item, kv] = options.separators ?? (indent === undefined ? [", ", ": "] : [",", ": "]);
  const walk = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (v instanceof PyFloat) return pyFloatRepr(v.value);
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return Number.isInteger(v) ? String(Object.is(v, -0) ? 0 : v) : pyFloatRepr(v);
    if (typeof v === "string") return quote(v, ensureAscii);
    const pad = indent === undefined ? "" : `\n${" ".repeat(indent * (depth + 1))}`;
    const end = indent === undefined ? "" : `\n${" ".repeat(indent * depth)}`;
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return `[${pad}${v.map(x => walk(x, depth + 1)).join(`${item}${pad}`)}${end}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (sortKeys) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return "{}";
    return `{${pad}${entries.map(([k, x]) => `${quote(k, ensureAscii)}${kv}${walk(x, depth + 1)}`).join(`${item}${pad}`)}${end}}`;
  };
  return walk(value, 0);
}

/** The canonical bytes every upstream hash is taken over. */
export function canonical(value: unknown): string {
  return pyDumps(value, { sortKeys: true, ensureAscii: false, separators: [",", ":"] });
}

export function sha256(text: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
