// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal proto3 reader and ProtoJSON TypeScript emitter for `a2a.proto`.
 *
 * `crates/aphrody-a2a-pb/proto/a2a.proto` is the single source of the A2A 1.0 data model: the Rust
 * crates compile it with prost, this module projects it to TypeScript. Only the proto3 subset
 * used by the A2A schema is understood (messages, enums, oneof, map, optional, repeated,
 * services); anything else throws so a schema change cannot be silently mis-projected.
 */

export interface ProtoField {
  name: string;
  jsonName: string;
  type: string;
  number: number;
  repeated: boolean;
  optional: boolean;
  required: boolean;
  deprecated: boolean;
  mapKey?: string;
  doc: string;
}

export interface ProtoOneof {
  name: string;
  fields: ProtoField[];
}

export interface ProtoMessage {
  name: string;
  doc: string;
  fields: ProtoField[];
  oneofs: ProtoOneof[];
}

export interface ProtoEnumValue {
  name: string;
  number: number;
  doc: string;
}

export interface ProtoEnum {
  name: string;
  doc: string;
  values: ProtoEnumValue[];
}

export interface ProtoRpc {
  name: string;
  doc: string;
  request: string;
  response: string;
  requestStream: boolean;
  responseStream: boolean;
}

export interface ProtoFile {
  package: string;
  messages: ProtoMessage[];
  enums: ProtoEnum[];
  rpcs: ProtoRpc[];
}

interface Token {
  kind: "word" | "string" | "symbol" | "comment";
  text: string;
  line: number;
  /** For comments: the last line of the consecutive `//` block. */
  endLine?: number;
}

const SYMBOLS = new Set(["{", "}", "[", "]", "(", ")", "<", ">", "=", ";", ",", ":"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === "/" && source[i + 1] === "/") {
      let end = source.indexOf("\n", i);
      if (end < 0) end = source.length;
      const text = source.slice(i + 2, end).replace(/^ /, "");
      const last = tokens.at(-1);
      if (last?.kind === "comment" && last.endLine === line - 1) {
        last.text += `\n${text}`;
        last.endLine = line;
      } else {
        tokens.push({ kind: "comment", text, line, endLine: line });
      }
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === "\\" ? 2 : 1;
      tokens.push({ kind: "string", text: source.slice(i + 1, j), line });
      i = j + 1;
    } else if (SYMBOLS.has(ch)) {
      tokens.push({ kind: "symbol", text: ch, line });
      i++;
    } else {
      const match = /^[A-Za-z0-9_.\-+*/]+/.exec(source.slice(i));
      if (!match) throw new Error(`proto: unexpected character ${JSON.stringify(ch)} at line ${line}`);
      tokens.push({ kind: "word", text: match[0], line });
      i += match[0].length;
    }
  }
  return tokens;
}

/** Drop lint pragmas and `(-- ... --)` linter blocks, keep the human documentation. */
function cleanDoc(raw: string): string {
  const out: string[] = [];
  let inLinterBlock = false;
  for (const line of raw.split("\n")) {
    if (line.includes("(--")) inLinterBlock = true;
    const skip = inLinterBlock || /^\s*protolint:/.test(line);
    if (line.includes("--)")) inLinterBlock = false;
    if (!skip) out.push(line.trimEnd());
  }
  return out.join("\n").trim();
}

/** Protobuf JSON name: lowerCamelCase of the proto field name. */
export function jsonName(name: string): string {
  return name.replace(/_+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos++];
    if (!token) throw new Error("proto: unexpected end of file");
    return token;
  }

  private expect(text: string): Token {
    const token = this.next();
    if (token.text !== text || token.kind === "string") {
      throw new Error(`proto: expected ${text} at line ${token.line}, found ${token.text}`);
    }
    return token;
  }

  private accept(text: string): boolean {
    const token = this.peek();
    if (token && token.kind !== "string" && token.text === text) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** Consume leading comments; return the documentation adjacent to the next token. */
  private takeDoc(): string {
    let doc = "";
    while (this.peek()?.kind === "comment") {
      const comment = this.next();
      const following = this.peek();
      const adjacent = following !== undefined && following.line === (comment.endLine ?? 0) + 1;
      doc = adjacent ? cleanDoc(comment.text) : "";
    }
    return doc;
  }

  /** Skip a balanced `{ ... }` block, the opening brace being the next token. */
  private skipBlock(): void {
    this.expect("{");
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (token.kind === "symbol" && token.text === "{") depth++;
      if (token.kind === "symbol" && token.text === "}") depth--;
    }
  }

  private skipStatement(): void {
    while (!this.accept(";")) {
      if (this.peek()?.text === "{" && this.peek()?.kind === "symbol") this.skipBlock();
      else this.next();
    }
  }

  parse(): ProtoFile {
    const file: ProtoFile = { package: "", messages: [], enums: [], rpcs: [] };
    for (;;) {
      const doc = this.takeDoc();
      const token = this.peek();
      if (!token) break;
      if (token.kind !== "word") throw new Error(`proto: unexpected ${token.text} at line ${token.line}`);
      switch (token.text) {
        case "syntax":
        case "import":
        case "option":
          this.skipStatement();
          break;
        case "package": {
          this.next();
          file.package = this.next().text;
          this.expect(";");
          break;
        }
        case "message":
          file.messages.push(this.parseMessage(doc));
          break;
        case "enum":
          file.enums.push(this.parseEnum(doc));
          break;
        case "service":
          file.rpcs.push(...this.parseService());
          break;
        default:
          throw new Error(`proto: unsupported top-level ${token.text} at line ${token.line}`);
      }
    }
    return file;
  }

  private parseOptions(): { required: boolean; deprecated: boolean } {
    const result = { required: false, deprecated: false };
    if (!this.accept("[")) return result;
    let depth = 1;
    const words: string[] = [];
    while (depth > 0) {
      const token = this.next();
      if (token.kind === "symbol" && token.text === "[") depth++;
      else if (token.kind === "symbol" && token.text === "]") depth--;
      else words.push(token.text);
    }
    const flat = words.join(" ");
    result.required = /google\.api\.field_behavior\s*\)\s*=\s*REQUIRED/.test(flat.replace(/\s*\.\s*/g, "."));
    result.deprecated = /deprecated\s*=\s*true/.test(flat);
    return result;
  }

  private parseField(doc: string, repeated: boolean, optional: boolean): ProtoField {
    let type = this.next().text;
    let mapKey: string | undefined;
    if (type === "map") {
      this.expect("<");
      mapKey = this.next().text;
      this.expect(",");
      type = this.next().text;
      this.expect(">");
    }
    const name = this.next().text;
    this.expect("=");
    const number = Number(this.next().text);
    const { required, deprecated } = this.parseOptions();
    this.expect(";");
    const field: ProtoField = {
      name,
      jsonName: jsonName(name),
      type,
      number,
      repeated,
      optional,
      required,
      deprecated,
      doc,
    };
    if (mapKey !== undefined) field.mapKey = mapKey;
    return field;
  }

  private parseMessage(doc: string): ProtoMessage {
    this.expect("message");
    const message: ProtoMessage = {
      name: this.next().text,
      doc,
      fields: [],
      oneofs: [],
    };
    this.expect("{");
    while (!this.accept("}")) {
      const fieldDoc = this.takeDoc();
      const token = this.peek();
      if (!token) throw new Error(`proto: unterminated message ${message.name}`);
      if (token.text === "}") continue;
      if (token.text === "oneof") {
        this.next();
        const oneof: ProtoOneof = { name: this.next().text, fields: [] };
        this.expect("{");
        while (!this.accept("}")) {
          const memberDoc = this.takeDoc();
          if (this.peek()?.text === "}") continue;
          if (this.peek()?.text === "option") {
            this.skipStatement();
            continue;
          }
          oneof.fields.push(this.parseField(memberDoc, false, false));
        }
        message.oneofs.push(oneof);
      } else if (token.text === "option" || token.text === "reserved") {
        this.skipStatement();
      } else if (token.text === "message" || token.text === "enum") {
        throw new Error(`proto: nested ${token.text} in ${message.name} is not supported`);
      } else {
        const repeated = this.accept("repeated");
        const optional = !repeated && this.accept("optional");
        message.fields.push(this.parseField(fieldDoc, repeated, optional));
      }
    }
    return message;
  }

  private parseEnum(doc: string): ProtoEnum {
    this.expect("enum");
    const result: ProtoEnum = { name: this.next().text, doc, values: [] };
    this.expect("{");
    while (!this.accept("}")) {
      const valueDoc = this.takeDoc();
      if (this.peek()?.text === "}") continue;
      if (this.peek()?.text === "option" || this.peek()?.text === "reserved") {
        this.skipStatement();
        continue;
      }
      const name = this.next().text;
      this.expect("=");
      const number = Number(this.next().text);
      this.parseOptions();
      this.expect(";");
      result.values.push({ name, number, doc: valueDoc });
    }
    return result;
  }

  private parseService(): ProtoRpc[] {
    this.expect("service");
    this.next();
    this.expect("{");
    const rpcs: ProtoRpc[] = [];
    while (!this.accept("}")) {
      const doc = this.takeDoc();
      if (this.peek()?.text === "}") continue;
      if (this.peek()?.text === "option") {
        this.skipStatement();
        continue;
      }
      this.expect("rpc");
      const name = this.next().text;
      this.expect("(");
      const requestStream = this.accept("stream");
      const request = this.next().text;
      this.expect(")");
      this.expect("returns");
      this.expect("(");
      const responseStream = this.accept("stream");
      const response = this.next().text;
      this.expect(")");
      if (this.peek()?.text === "{" && this.peek()?.kind === "symbol") this.skipBlock();
      else this.expect(";");
      rpcs.push({
        name,
        doc,
        request,
        response,
        requestStream,
        responseStream,
      });
    }
    return rpcs;
  }
}

export function parseProto(source: string): ProtoFile {
  return new Parser(tokenize(source)).parse();
}

// ---------------------------------------------------------------------------
// TypeScript emission
// ---------------------------------------------------------------------------

const SCALARS: Readonly<Record<string, string>> = {
  string: "string",
  bool: "boolean",
  int32: "number",
  uint32: "number",
  sint32: "number",
  fixed32: "number",
  sfixed32: "number",
  float: "number",
  double: "number",
  int64: "string | number",
  uint64: "string | number",
  sint64: "string | number",
  fixed64: "string | number",
  sfixed64: "string | number",
  bytes: "Base64",
  "google.protobuf.Struct": "JsonObject",
  "google.protobuf.Value": "JsonValue",
  "google.protobuf.Timestamp": "Timestamp",
  "google.protobuf.Empty": "Empty",
};

function tsType(field: ProtoField, enums: ReadonlySet<string>, messages: ReadonlySet<string>): string {
  const base = SCALARS[field.type] ?? field.type;
  if (!(field.type in SCALARS) && !enums.has(field.type) && !messages.has(field.type)) {
    throw new Error(`proto: unresolved type ${field.type} (field ${field.name})`);
  }
  if (field.mapKey !== undefined) return `{ [key: string]: ${base} }`;
  const needsParens = base.includes(" ") && !base.startsWith("{");
  return field.repeated ? `${needsParens ? `(${base})` : base}[]` : base;
}

function jsdoc(text: string, indent: string): string[] {
  if (!text) return [];
  const body = text.replaceAll("*/", "*\\/").split("\n");
  if (body.length === 1) return [`${indent}/** ${body[0]} */`];
  return [`${indent}/**`, ...body.map(line => `${indent} *${line ? ` ${line}` : ""}`), `${indent} */`];
}

function constName(typeName: string): string {
  return typeName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function emitFields(
  fields: readonly ProtoField[],
  enums: ReadonlySet<string>,
  messages: ReadonlySet<string>,
  indent: string,
  neverNames: readonly string[] = [],
): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    lines.push(...jsdoc(field.doc, indent));
    const optional = field.required ? "" : "?";
    lines.push(`${indent}${field.jsonName}${optional}: ${tsType(field, enums, messages)};`);
  }
  for (const name of neverNames) lines.push(`${indent}${name}?: never;`);
  return lines;
}

export interface GenerateOptions {
  /** Repository-relative path of the proto, written in the header. */
  protoPath: string;
  /** Command that regenerates the file, written in the header. */
  command: string;
}

export function generateTypes(file: ProtoFile, options: GenerateOptions): string {
  const enums = new Set(file.enums.map(e => e.name));
  const messages = new Set(file.messages.map(m => m.name));
  const out: string[] = [
    "// SPDX-License-Identifier: Apache-2.0",
    `// Generated by \`${options.command}\` from ${options.protoPath} (package ${file.package}).`,
    "// Do not edit: change the proto, then regenerate. ProtoJSON shape: camelCase members, enum names.",
    "",
    "/** Any JSON value (`google.protobuf.Value`). */",
    "export type JsonValue =",
    "  | null",
    "  | boolean",
    "  | number",
    "  | string",
    "  | JsonValue[]",
    "  | { [key: string]: JsonValue };",
    "/** A JSON object (`google.protobuf.Struct`). */",
    "export type JsonObject = { [key: string]: JsonValue };",
    "/** RFC 3339 UTC timestamp (`google.protobuf.Timestamp`), e.g. `2026-10-06T10:00:00.000Z`. */",
    "export type Timestamp = string;",
    "/** Standard base64 text (`bytes` in ProtoJSON). */",
    "export type Base64 = string;",
    "/** `google.protobuf.Empty`. */",
    "export type Empty = Record<string, never>;",
    "",
  ];

  for (const e of file.enums) {
    const values = e.values.map(v => v.name);
    out.push(...jsdoc(e.doc, ""));
    if (e.values.every(v => !v.doc)) {
      out.push(...constArray(`${constName(e.name)}_VALUES`, values));
    } else {
      out.push(`export const ${constName(e.name)}_VALUES = [`);
      for (const v of e.values) {
        out.push(...jsdoc(v.doc, "  "));
        out.push(`  ${JSON.stringify(v.name)},`);
      }
      out.push("] as const;");
    }
    out.push(`export type ${e.name} = (typeof ${constName(e.name)}_VALUES)[number];`);
    if (values.length === 0) throw new Error(`proto: empty enum ${e.name}`);
    out.push("");
  }

  for (const m of file.messages) {
    out.push(...jsdoc(m.doc, ""));
    if (m.oneofs.length === 0) {
      out.push(`export interface ${m.name} {`);
      out.push(...emitFields(m.fields, enums, messages, "  "));
      out.push("}");
      out.push("");
      continue;
    }
    if (m.oneofs.length > 1) throw new Error(`proto: ${m.name} has several oneofs`);
    const oneof = m.oneofs[0] as ProtoOneof;
    const names = oneof.fields.map(f => f.jsonName);
    const common = `${m.name}Common`;
    if (m.fields.length > 0) {
      out.push(`export interface ${common} {`);
      out.push(...emitFields(m.fields, enums, messages, "  "));
      out.push("}");
      out.push("");
    }
    const unionName = m.fields.length > 0 ? `${m.name}${pascal(oneof.name)}` : m.name;
    out.push(`export type ${unionName} =`);
    for (const member of oneof.fields) {
      out.push(...jsdoc(member.doc, "  "));
      out.push("  | {");
      out.push(`      ${member.jsonName}: ${tsType(member, enums, messages)};`);
      for (const other of names.filter(n => n !== member.jsonName)) out.push(`      ${other}?: never;`);
      out.push("    }");
    }
    out[out.length - 1] += ";";
    out.push("");
    if (m.fields.length > 0) {
      out.push(`export type ${m.name} = ${common} & ${unionName};`);
      out.push("");
    }
  }

  out.push("/** JSON-RPC method names and gRPC rpc names of the A2AService. */");
  out.push(
    ...constArray(
      "A2A_METHODS",
      file.rpcs.map(r => r.name),
    ),
  );
  out.push("export type A2AMethod = (typeof A2A_METHODS)[number];");
  out.push("");
  out.push("/** Methods answered with a Server-Sent Events stream. */");
  out.push(
    ...constArray(
      "A2A_STREAMING_METHODS",
      file.rpcs.filter(r => r.responseStream).map(r => r.name),
    ),
  );
  out.push("export type A2AStreamingMethod = (typeof A2A_STREAMING_METHODS)[number];");
  out.push("");
  out.push("/** Request and response type of every method. */");
  out.push("export interface A2AMethodTypes {");
  for (const rpc of file.rpcs) {
    out.push(...jsdoc(rpc.doc, "  "));
    out.push(`  ${rpc.name}: {`);
    out.push(`    request: ${SCALARS[rpc.request] ?? rpc.request};`);
    out.push(`    response: ${SCALARS[rpc.response] ?? rpc.response};`);
    out.push("  };");
  }
  out.push("}");
  out.push("");
  return out.join("\n");
}

/** A `const` string array, on one line when it fits the formatter's 100 columns. */
function constArray(name: string, values: readonly string[]): string[] {
  const items = values.map(v => JSON.stringify(v));
  const oneLine = `export const ${name} = [${items.join(", ")}] as const;`;
  if (oneLine.length <= 100) return [oneLine];
  return [`export const ${name} = [`, ...items.map(item => `  ${item},`), "] as const;"];
}

function pascal(name: string): string {
  return name.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
}
