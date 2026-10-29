// A small WebAssembly binary reader: imports, exports, custom sections, target features, WASI kind.
// It reads only the section framing, so it works on core modules and identifies components.

export type ExternKind = "function" | "table" | "memory" | "global" | "tag";

export interface WasmImport {
  module: string;
  name: string;
  kind: ExternKind;
}

export interface WasmExport {
  name: string;
  kind: ExternKind;
}

export interface WasmInfo {
  /** `core` for a module, `component` for a component-model binary (version 0x0d, layer 1). */
  format: "core" | "component";
  imports: WasmImport[];
  exports: WasmExport[];
  /** Names of custom sections (`name`, `producers`, `target_features`, ...). */
  customSections: string[];
  /** Features from the `target_features` custom section, such as `bulk-memory`. */
  features: string[];
  /** `command` exports `_start`, `reactor` exports `_initialize`, `imports-only` only imports WASI preview 1. */
  wasi: "command" | "reactor" | "imports-only" | undefined;
  /** True for wasm-bindgen output (`__wbindgen_*` / `__wbg_*` names). */
  bindgen: boolean;
  start: boolean;
  size: number;
}

const KINDS: ExternKind[] = ["function", "table", "memory", "global", "tag"];
const decoder = new TextDecoder("utf-8", { fatal: true });

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.bytes.length) throw new RangeError("unexpected end of module");
    return this.bytes[this.pos++]!;
  }
  u32(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result >>> 0;
      shift += 7;
      if (shift > 35) throw new RangeError("LEB128 overflow");
    }
  }
  name(): string {
    const length = this.u32();
    if (this.pos + length > this.bytes.length) throw new RangeError("name past end of module");
    const value = decoder.decode(this.bytes.subarray(this.pos, this.pos + length));
    this.pos += length;
    return value;
  }
  skipLimits(): void {
    const flags = this.u8();
    this.u32();
    if (flags & 1) this.u32();
  }
}

/** Parse the section framing of a WebAssembly binary. Throws `RangeError` on a truncated or malformed binary. */
export function inspect(input: Uint8Array | ArrayBuffer): WasmInfo {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new RangeError("not a WebAssembly binary (bad magic)");
  }
  const component = bytes[4] === 0x0d && bytes[5] === 0x00 && bytes[6] === 0x01 && bytes[7] === 0x00;
  const info: WasmInfo = {
    format: component ? "component" : "core",
    imports: [],
    exports: [],
    customSections: [],
    features: [],
    wasi: undefined,
    bindgen: false,
    start: false,
    size: bytes.length,
  };
  if (component) return info;
  if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) {
    throw new RangeError("unsupported WebAssembly version");
  }
  const reader = new Reader(bytes);
  reader.pos = 8;
  while (reader.pos < bytes.length) {
    const id = reader.u8();
    const size = reader.u32();
    const end = reader.pos + size;
    if (end > bytes.length) throw new RangeError("section past end of module");
    if (id === 0) {
      const section = new Reader(bytes.subarray(0, end));
      section.pos = reader.pos;
      const name = section.name();
      info.customSections.push(name);
      if (name === "target_features") {
        const count = section.u32();
        for (let i = 0; i < count; i++) {
          const prefix = section.u8();
          const feature = section.name();
          if (prefix === 0x2b) info.features.push(feature);
        }
      }
    } else if (id === 2) {
      const count = reader.u32();
      for (let i = 0; i < count; i++) {
        const module = reader.name();
        const name = reader.name();
        const kindByte = reader.u8();
        const kind = KINDS[kindByte];
        if (!kind) throw new RangeError(`unknown import kind ${kindByte}`);
        if (kind === "function") reader.u32();
        else if (kind === "table") {
          reader.u8();
          reader.skipLimits();
        } else if (kind === "memory") reader.skipLimits();
        else if (kind === "global") {
          reader.u8();
          reader.u8();
        } else {
          reader.u8();
          reader.u32();
        }
        info.imports.push({ module, name, kind });
      }
    } else if (id === 7) {
      const count = reader.u32();
      for (let i = 0; i < count; i++) {
        const name = reader.name();
        const kindByte = reader.u8();
        const kind = KINDS[kindByte];
        if (!kind) throw new RangeError(`unknown export kind ${kindByte}`);
        reader.u32();
        info.exports.push({ name, kind });
      }
    } else if (id === 8) {
      info.start = true;
    }
    reader.pos = end;
  }
  const wasiImports = info.imports.some(
    i => i.module.startsWith("wasi_snapshot_preview") || i.module === "wasi_unstable",
  );
  if (info.exports.some(e => e.name === "_start")) info.wasi = "command";
  else if (info.exports.some(e => e.name === "_initialize")) info.wasi = "reactor";
  else if (wasiImports) info.wasi = "imports-only";
  info.bindgen =
    info.imports.some(i => i.name.startsWith("__wbg_") || i.name.startsWith("__wbindgen_")) ||
    info.exports.some(e => e.name.startsWith("__wbindgen_"));
  return info;
}

/** `WebAssembly.validate` plus the framing check of {@link inspect}. Components are not core modules and fail. */
export function validate(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    if (inspect(bytes).format === "component") return false;
  } catch {
    return false;
  }
  return WebAssembly.validate(bytes);
}
