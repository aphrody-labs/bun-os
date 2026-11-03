// @ts-nocheck -- ported verbatim from the fork, whose src/js modules are loosely typed builtins.
// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun src/js/internal/winmd.ts (commit 62fcdb38ec9, MIT, Copyright Oven and contributors) to upstream Bun
// for the Bun OS bun:* modules of @aphrody/windows (src/bun-plugin.ts).
// ECMA-335 metadata reader for .winmd files: Windows Runtime (System32\WinMetadata, UnionMetadata\<sdk>\Windows.winmd)
// and Win32 (win32metadata Windows.Win32.winmd). Shared by bun:winrt at runtime and by the generators in scripts/aphrody.
// Plain TypeScript without builtin intrinsics so scripts can import it from the source tree.

const T = {
  Module: 0x00,
  TypeRef: 0x01,
  TypeDef: 0x02,
  FieldPtr: 0x03,
  Field: 0x04,
  MethodPtr: 0x05,
  MethodDef: 0x06,
  ParamPtr: 0x07,
  Param: 0x08,
  InterfaceImpl: 0x09,
  MemberRef: 0x0a,
  Constant: 0x0b,
  CustomAttribute: 0x0c,
  FieldMarshal: 0x0d,
  DeclSecurity: 0x0e,
  ClassLayout: 0x0f,
  FieldLayout: 0x10,
  StandAloneSig: 0x11,
  EventMap: 0x12,
  EventPtr: 0x13,
  Event: 0x14,
  PropertyMap: 0x15,
  PropertyPtr: 0x16,
  Property: 0x17,
  MethodSemantics: 0x18,
  MethodImpl: 0x19,
  ModuleRef: 0x1a,
  TypeSpec: 0x1b,
  ImplMap: 0x1c,
  FieldRVA: 0x1d,
  ENCLog: 0x1e,
  ENCMap: 0x1f,
  Assembly: 0x20,
  AssemblyProcessor: 0x21,
  AssemblyOS: 0x22,
  AssemblyRef: 0x23,
  AssemblyRefProcessor: 0x24,
  AssemblyRefOS: 0x25,
  File: 0x26,
  ExportedType: 0x27,
  ManifestResource: 0x28,
  NestedClass: 0x29,
  GenericParam: 0x2a,
  MethodSpec: 0x2b,
  GenericParamConstraint: 0x2c,
} as const;

const CODED: Record<string, { bits: number; tables: number[] }> = {
  TypeDefOrRef: { bits: 2, tables: [T.TypeDef, T.TypeRef, T.TypeSpec] },
  HasConstant: { bits: 2, tables: [T.Field, T.Param, T.Property] },
  HasCustomAttribute: {
    bits: 5,
    tables: [
      T.MethodDef,
      T.Field,
      T.TypeRef,
      T.TypeDef,
      T.Param,
      T.InterfaceImpl,
      T.MemberRef,
      T.Module,
      T.DeclSecurity,
      T.Property,
      T.Event,
      T.StandAloneSig,
      T.ModuleRef,
      T.TypeSpec,
      T.Assembly,
      T.AssemblyRef,
      T.File,
      T.ExportedType,
      T.ManifestResource,
      T.GenericParam,
      T.GenericParamConstraint,
      T.MethodSpec,
    ],
  },
  HasFieldMarshal: { bits: 1, tables: [T.Field, T.Param] },
  HasDeclSecurity: { bits: 2, tables: [T.TypeDef, T.MethodDef, T.Assembly] },
  MemberRefParent: { bits: 3, tables: [T.TypeDef, T.TypeRef, T.ModuleRef, T.MethodDef, T.TypeSpec] },
  HasSemantics: { bits: 1, tables: [T.Event, T.Property] },
  MethodDefOrRef: { bits: 1, tables: [T.MethodDef, T.MemberRef] },
  MemberForwarded: { bits: 1, tables: [T.Field, T.MethodDef] },
  Implementation: { bits: 2, tables: [T.File, T.AssemblyRef, T.ExportedType] },
  CustomAttributeType: { bits: 3, tables: [T.MethodDef, T.MemberRef] },
  ResolutionScope: { bits: 2, tables: [T.Module, T.ModuleRef, T.AssemblyRef, T.TypeRef] },
  TypeOrMethodDef: { bits: 1, tables: [T.TypeDef, T.MethodDef] },
};

// Column kinds: 1/2/4 fixed, "S" string, "G" guid, "B" blob, ["t", table], ["c", coded].
type Col = 1 | 2 | 4 | "S" | "G" | "B" | ["t", number] | ["c", string];
const t = (id: number): Col => ["t", id];
const c = (name: string): Col => ["c", name];
const SCHEMA: Record<number, Col[]> = {
  [T.Module]: [2, "S", "G", "G", "G"],
  [T.TypeRef]: [c("ResolutionScope"), "S", "S"],
  [T.TypeDef]: [4, "S", "S", c("TypeDefOrRef"), t(T.Field), t(T.MethodDef)],
  [T.FieldPtr]: [t(T.Field)],
  [T.Field]: [2, "S", "B"],
  [T.MethodPtr]: [t(T.MethodDef)],
  [T.MethodDef]: [4, 2, 2, "S", "B", t(T.Param)],
  [T.ParamPtr]: [t(T.Param)],
  [T.Param]: [2, 2, "S"],
  [T.InterfaceImpl]: [t(T.TypeDef), c("TypeDefOrRef")],
  [T.MemberRef]: [c("MemberRefParent"), "S", "B"],
  [T.Constant]: [1, 1, c("HasConstant"), "B"],
  [T.CustomAttribute]: [c("HasCustomAttribute"), c("CustomAttributeType"), "B"],
  [T.FieldMarshal]: [c("HasFieldMarshal"), "B"],
  [T.DeclSecurity]: [2, c("HasDeclSecurity"), "B"],
  [T.ClassLayout]: [2, 4, t(T.TypeDef)],
  [T.FieldLayout]: [4, t(T.Field)],
  [T.StandAloneSig]: ["B"],
  [T.EventMap]: [t(T.TypeDef), t(T.Event)],
  [T.EventPtr]: [t(T.Event)],
  [T.Event]: [2, "S", c("TypeDefOrRef")],
  [T.PropertyMap]: [t(T.TypeDef), t(T.Property)],
  [T.PropertyPtr]: [t(T.Property)],
  [T.Property]: [2, "S", "B"],
  [T.MethodSemantics]: [2, t(T.MethodDef), c("HasSemantics")],
  [T.MethodImpl]: [t(T.TypeDef), c("MethodDefOrRef"), c("MethodDefOrRef")],
  [T.ModuleRef]: ["S"],
  [T.TypeSpec]: ["B"],
  [T.ImplMap]: [2, c("MemberForwarded"), "S", t(T.ModuleRef)],
  [T.FieldRVA]: [4, t(T.Field)],
  [T.ENCLog]: [4, 4],
  [T.ENCMap]: [4],
  [T.Assembly]: [4, 2, 2, 2, 2, 4, "B", "S", "S"],
  [T.AssemblyProcessor]: [4],
  [T.AssemblyOS]: [4, 4, 4],
  [T.AssemblyRef]: [2, 2, 2, 2, 4, "B", "S", "S", "B"],
  [T.AssemblyRefProcessor]: [4, t(T.AssemblyRef)],
  [T.AssemblyRefOS]: [4, 4, 4, t(T.AssemblyRef)],
  [T.File]: [4, "S", "B"],
  [T.ExportedType]: [4, 4, "S", "S", c("Implementation")],
  [T.ManifestResource]: [4, 4, "S", c("Implementation")],
  [T.NestedClass]: [t(T.TypeDef), t(T.TypeDef)],
  [T.GenericParam]: [2, 2, c("TypeOrMethodDef"), "S"],
  [T.MethodSpec]: [c("MethodDefOrRef"), "B"],
  [T.GenericParamConstraint]: [t(T.GenericParam), c("TypeDefOrRef")],
};

export type TypeSig =
  | { kind: "prim"; name: string }
  | { kind: "string" }
  | { kind: "object" }
  | { kind: "named"; ns: string; name: string; valueType: boolean; table: number; row: number }
  | { kind: "generic"; base: TypeSig; args: TypeSig[] }
  | { kind: "array"; elem: TypeSig }
  | { kind: "fixed"; elem: TypeSig; length: number }
  | { kind: "byref"; inner: TypeSig }
  | { kind: "ptr"; inner: TypeSig }
  | { kind: "fnptr" }
  | { kind: "var"; index: number; method: boolean }
  | { kind: "const"; inner: TypeSig }
  | { kind: "unknown"; code: number };

export type Attribute = { ns: string; name: string; args: unknown[]; named: Record<string, unknown> };

const PRIM: Record<number, string> = {
  0x01: "void",
  0x02: "bool",
  0x03: "char16",
  0x04: "i8",
  0x05: "u8",
  0x06: "i16",
  0x07: "u16",
  0x08: "i32",
  0x09: "u32",
  0x0a: "i64",
  0x0b: "u64",
  0x0c: "f32",
  0x0d: "f64",
  0x18: "isize",
  0x19: "usize",
};

class Winmd {
  private view: DataView;
  private bytes: Uint8Array;
  private strings = 0;
  private blob = 0;
  private guidHeap = 0;
  private rows: number[] = Array.from({ length: 64 }, () => 0);
  private tableOffset: number[] = Array.from({ length: 64 }, () => 0);
  private rowSize: number[] = Array.from({ length: 64 }, () => 0);
  private colOffsets: number[][] = [];
  private colSizes: number[][] = [];
  private decoder = new TextDecoder();
  private attrIndex?: Map<number, number[]>;
  private constIndex?: Map<number, number>;
  private layoutIndex?: Map<number, number>;
  private fieldOffsetIndex?: Map<number, number>;
  private implIndex?: Map<number, number>;
  private nestIndex?: Map<number, number>;
  private nestedIndex?: Map<number, number[]>;
  private typeIndex?: Map<string, number>;
  private ifaceIndex?: Map<number, number[]>;
  private genericIndex?: Map<number, string[]>;

  constructor(data: Uint8Array) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const v = this.view;
    const pe = v.getUint32(0x3c, true);
    const sections = v.getUint16(pe + 6, true);
    const optSize = v.getUint16(pe + 20, true);
    const opt = pe + 24;
    const magic = v.getUint16(opt, true);
    const dirs = opt + (magic === 0x20b ? 112 : 96);
    const cliRva = v.getUint32(dirs + 14 * 8, true);
    const secTable = opt + optSize;
    const rvaToOffset = (rva: number) => {
      for (let i = 0; i < sections; i++) {
        const s = secTable + i * 40;
        const va = v.getUint32(s + 12, true);
        const size = Math.max(v.getUint32(s + 8, true), v.getUint32(s + 16, true));
        if (rva >= va && rva < va + size) return rva - va + v.getUint32(s + 20, true);
      }
      throw new Error(`rva ${rva} outside sections`);
    };
    const cli = rvaToOffset(cliRva);
    const root = rvaToOffset(v.getUint32(cli + 8, true));
    if (v.getUint32(root, true) !== 0x424a5342) throw new Error("not a metadata root");
    const versionLength = v.getUint32(root + 12, true);
    let p = root + 16 + versionLength + 2;
    const streams = v.getUint16(p, true);
    p += 2;
    let tables = 0;
    for (let i = 0; i < streams; i++) {
      const offset = root + v.getUint32(p, true);
      p += 8;
      let end = p;
      while (data[end] !== 0) end++;
      const name = this.decoder.decode(data.subarray(p, end));
      p = (end + 4) & ~3;
      if (name === "#~" || name === "#-") tables = offset;
      else if (name === "#Strings") this.strings = offset;
      else if (name === "#Blob") this.blob = offset;
      else if (name === "#GUID") this.guidHeap = offset;
    }
    const heapSizes = data[tables + 6];
    const valid = v.getBigUint64(tables + 8, true);
    p = tables + 24;
    for (let i = 0; i < 64; i++) {
      if ((valid >> BigInt(i)) & 1n) {
        this.rows[i] = v.getUint32(p, true);
        p += 4;
      }
    }
    const strSize = heapSizes & 1 ? 4 : 2;
    const guidSize = heapSizes & 2 ? 4 : 2;
    const blobSize = heapSizes & 4 ? 4 : 2;
    const sizeOf = (col: Col): number => {
      if (typeof col === "number") return col;
      if (col === "S") return strSize;
      if (col === "G") return guidSize;
      if (col === "B") return blobSize;
      if (col[0] === "t") return this.rows[col[1]] < 0x10000 ? 2 : 4;
      const coded = CODED[col[1]];
      const max = Math.max(...coded.tables.map(id => this.rows[id]));
      return max < 1 << (16 - coded.bits) ? 2 : 4;
    };
    for (let id = 0; id < 64; id++) {
      const schema = SCHEMA[id];
      if (!schema) continue;
      const sizes = schema.map(sizeOf);
      const offsets: number[] = [];
      let acc = 0;
      for (const s of sizes) {
        offsets.push(acc);
        acc += s;
      }
      this.colSizes[id] = sizes;
      this.colOffsets[id] = offsets;
      this.rowSize[id] = acc;
    }
    for (let id = 0; id < 64; id++) {
      if (!this.rows[id]) continue;
      if (!SCHEMA[id]) throw new Error(`unsupported metadata table 0x${id.toString(16)}`);
      this.tableOffset[id] = p;
      p += this.rows[id] * this.rowSize[id];
    }
  }

  count(table: number) {
    return this.rows[table];
  }

  /** Raw column value; rows are 1-based. */
  col(table: number, row: number, column: number): number {
    const at = this.tableOffset[table] + (row - 1) * this.rowSize[table] + this.colOffsets[table][column];
    const size = this.colSizes[table][column];
    return size === 2 ? this.view.getUint16(at, true) : size === 1 ? this.bytes[at] : this.view.getUint32(at, true);
  }

  str(table: number, row: number, column: number): string {
    const start = this.strings + this.col(table, row, column);
    let end = start;
    while (this.bytes[end] !== 0) end++;
    return this.decoder.decode(this.bytes.subarray(start, end));
  }

  blobAt(table: number, row: number, column: number): Uint8Array {
    const pos = { p: this.blob + this.col(table, row, column) };
    const len = readCompressed(this.bytes, pos);
    return this.bytes.subarray(pos.p, pos.p + len);
  }

  decode(coded: string, value: number): [table: number, row: number] {
    const { bits, tables } = CODED[coded];
    const tag = value & ((1 << bits) - 1);
    if (coded === "CustomAttributeType") return [tag === 2 ? T.MethodDef : T.MemberRef, value >>> bits];
    return [tables[tag], value >>> bits];
  }

  /** Range [first, last) of child rows owned by a parent row through a list column. */
  range(table: number, row: number, column: number, child: number): [number, number] {
    const first = this.col(table, row, column);
    const last = row < this.rows[table] ? this.col(table, row + 1, column) : this.rows[child] + 1;
    return [first, last];
  }

  typeName(table: number, row: number): { ns: string; name: string } {
    const { TypeDef, TypeRef } = T;
    if (table === TypeDef) {
      const parent = this.enclosing(row);
      if (parent) {
        const outer = this.typeName(TypeDef, parent);
        return { ns: outer.ns, name: `${outer.name}/${this.str(TypeDef, row, 1)}` };
      }
      return { ns: this.str(TypeDef, row, 2), name: this.str(TypeDef, row, 1) };
    }
    if (table === TypeRef) {
      const [scopeTable, scopeRow] = this.decode("ResolutionScope", this.col(TypeRef, row, 0));
      if (scopeTable === TypeRef && scopeRow) {
        const outer = this.typeName(TypeRef, scopeRow);
        return { ns: outer.ns, name: `${outer.name}/${this.str(TypeRef, row, 1)}` };
      }
      return { ns: this.str(TypeRef, row, 2), name: this.str(TypeRef, row, 1) };
    }
    return { ns: "", name: `TypeSpec#${row}` };
  }

  fullName(table: number, row: number): string {
    const { ns, name } = this.typeName(table, row);
    return ns ? `${ns}.${name}` : name;
  }

  /** TypeDef row by full name ("Windows.Foundation.Uri", "Windows.Win32.Foundation.RECT", "Outer/Nested"). */
  findType(full: string): number | undefined {
    if (!this.typeIndex) {
      this.typeIndex = new Map();
      for (let row = 1; row <= this.rows[T.TypeDef]; row++) this.typeIndex.set(this.fullName(T.TypeDef, row), row);
    }
    return this.typeIndex.get(full);
  }

  enclosing(typeRow: number): number | undefined {
    if (!this.nestIndex) {
      this.nestIndex = new Map();
      this.nestedIndex = new Map();
      for (let r = 1; r <= this.rows[T.NestedClass]; r++) {
        const nested = this.col(T.NestedClass, r, 0);
        const outer = this.col(T.NestedClass, r, 1);
        this.nestIndex.set(nested, outer);
        const list = this.nestedIndex.get(outer) ?? [];
        list.push(nested);
        this.nestedIndex.set(outer, list);
      }
    }
    return this.nestIndex.get(typeRow);
  }

  nestedTypes(typeRow: number): number[] {
    this.enclosing(typeRow);
    return this.nestedIndex!.get(typeRow) ?? [];
  }

  /** "interface" | "enum" | "struct" | "delegate" | "attribute" | "class" */
  kind(typeRow: number): string {
    const flags = this.col(T.TypeDef, typeRow, 0);
    if (flags & 0x20) return "interface";
    const ext = this.col(T.TypeDef, typeRow, 3);
    if (!ext) return "class";
    const [table, row] = this.decode("TypeDefOrRef", ext);
    const base = this.typeName(table, row);
    if (base.ns === "System") {
      if (base.name === "Enum") return "enum";
      if (base.name === "ValueType") return "struct";
      if (base.name === "MulticastDelegate") return "delegate";
      if (base.name === "Attribute") return "attribute";
    }
    return "class";
  }

  interfaceImpls(typeRow: number): number[] {
    if (!this.ifaceIndex) {
      this.ifaceIndex = new Map();
      for (let r = 1; r <= this.rows[T.InterfaceImpl]; r++) {
        const owner = this.col(T.InterfaceImpl, r, 0);
        const list = this.ifaceIndex.get(owner) ?? [];
        list.push(r);
        this.ifaceIndex.set(owner, list);
      }
    }
    return this.ifaceIndex.get(typeRow) ?? [];
  }

  /** Type signature of an InterfaceImpl, Event or other TypeDefOrRef value. */
  typeDefOrRef(value: number): TypeSig {
    const [table, row] = this.decode("TypeDefOrRef", value);
    const { TypeSpec } = T;
    if (table === TypeSpec) return this.parseType(this.blobAt(TypeSpec, row, 0), { p: 0 });
    return { kind: "named", ...this.typeName(table, row), valueType: false, table, row };
  }

  genericParams(table: number, row: number): string[] {
    if (!this.genericIndex) {
      this.genericIndex = new Map();
      for (let r = 1; r <= this.rows[T.GenericParam]; r++) {
        const [ownerTable, owner] = this.decode("TypeOrMethodDef", this.col(T.GenericParam, r, 2));
        const key = ownerTable * 0x1000000 + owner;
        const list = this.genericIndex.get(key) ?? [];
        list[this.col(T.GenericParam, r, 0)] = this.str(T.GenericParam, r, 3);
        this.genericIndex.set(key, list);
      }
    }
    return this.genericIndex.get(table * 0x1000000 + row) ?? [];
  }

  guid(index: number): string {
    return formatGuid(this.bytes.subarray(this.guidHeap + (index - 1) * 16, this.guidHeap + index * 16));
  }

  parseType(sig: Uint8Array, pos: { p: number }): TypeSig {
    const code = sig[pos.p++];
    if (PRIM[code]) return { kind: "prim", name: PRIM[code] };
    switch (code) {
      case 0x0e:
        return { kind: "string" };
      case 0x1c:
        return { kind: "object" };
      case 0x0f:
        return { kind: "ptr", inner: this.parseType(sig, pos) };
      case 0x10:
        return { kind: "byref", inner: this.parseType(sig, pos) };
      case 0x1d:
        return { kind: "array", elem: this.parseType(sig, pos) };
      case 0x14: {
        const elem = this.parseType(sig, pos);
        const rank = readCompressed(sig, pos);
        const sizes = readCompressed(sig, pos);
        let length = 1;
        for (let i = 0; i < sizes; i++) length *= readCompressed(sig, pos);
        const lowBounds = readCompressed(sig, pos);
        for (let i = 0; i < lowBounds; i++) readCompressed(sig, pos);
        return rank && sizes ? { kind: "fixed", elem, length } : { kind: "array", elem };
      }
      case 0x11:
      case 0x12: {
        const [table, row] = this.decode("TypeDefOrRef", readCompressed(sig, pos));
        return { kind: "named", ...this.typeName(table, row), valueType: code === 0x11, table, row };
      }
      case 0x13:
      case 0x1e:
        return { kind: "var", index: readCompressed(sig, pos), method: code === 0x1e };
      case 0x15: {
        const base = this.parseType(sig, pos);
        const n = readCompressed(sig, pos);
        const args: TypeSig[] = [];
        for (let i = 0; i < n; i++) args.push(this.parseType(sig, pos));
        return { kind: "generic", base, args };
      }
      case 0x1b:
        this.parseMethodSig(sig, pos);
        return { kind: "fnptr" };
      case 0x1f:
      case 0x20: {
        const [table, row] = this.decode("TypeDefOrRef", readCompressed(sig, pos));
        const modifier = this.typeName(table, row);
        const inner = this.parseType(sig, pos);
        return modifier.name === "IsConst" ? { kind: "const", inner } : inner;
      }
      case 0x45:
        return this.parseType(sig, pos);
      default:
        return { kind: "unknown", code };
    }
  }

  private parseMethodSig(sig: Uint8Array, pos: { p: number }) {
    const conv = sig[pos.p++];
    if (conv & 0x10) readCompressed(sig, pos);
    const n = readCompressed(sig, pos);
    const ret = this.parseType(sig, pos);
    const params: TypeSig[] = [];
    for (let i = 0; i < n; i++) {
      if (sig[pos.p] === 0x41) pos.p++;
      params.push(this.parseType(sig, pos));
    }
    return { ret, params };
  }

  methodSig(row: number): { ret: TypeSig; params: TypeSig[] } {
    return this.parseMethodSig(this.blobAt(T.MethodDef, row, 4), { p: 0 });
  }

  fieldSig(row: number): TypeSig {
    const sig = this.blobAt(T.Field, row, 2);
    return this.parseType(sig, { p: 1 });
  }

  propertySig(row: number): TypeSig {
    const sig = this.blobAt(T.Property, row, 2);
    const pos = { p: 1 };
    const n = readCompressed(sig, pos);
    const type = this.parseType(sig, pos);
    void n;
    return type;
  }

  /** Params of a MethodDef keyed by sequence (0 = return value). */
  params(methodRow: number): Map<number, { name: string; flags: number; row: number }> {
    const [first, last] = this.range(T.MethodDef, methodRow, 5, T.Param);
    const out = new Map<number, { name: string; flags: number; row: number }>();
    for (let p = first; p < last; p++)
      out.set(this.col(T.Param, p, 1), { name: this.str(T.Param, p, 2), flags: this.col(T.Param, p, 0), row: p });
    return out;
  }

  /** Custom attributes on a row of any HasCustomAttribute table. */
  attributes(table: number, row: number): Attribute[] {
    if (!this.attrIndex) {
      this.attrIndex = new Map();
      const tags = CODED.HasCustomAttribute.tables;
      for (let r = 1; r <= this.rows[T.CustomAttribute]; r++) {
        const value = this.col(T.CustomAttribute, r, 0);
        const key = tags[value & 31] * 0x1000000 + (value >>> 5);
        const list = this.attrIndex.get(key);
        if (list) list.push(r);
        else this.attrIndex.set(key, [r]);
      }
    }
    const rows = this.attrIndex.get(table * 0x1000000 + row);
    return rows ? rows.map(r => this.attribute(r)) : [];
  }

  attribute(row: number): Attribute {
    const [ctorTable, ctorRow] = this.decode("CustomAttributeType", this.col(T.CustomAttribute, row, 1));
    let owner: { ns: string; name: string };
    let ctor: { ret: TypeSig; params: TypeSig[] };
    const { MemberRef } = T;
    if (ctorTable === MemberRef) {
      const [parentTable, parentRow] = this.decode("MemberRefParent", this.col(MemberRef, ctorRow, 0));
      owner = this.typeName(parentTable, parentRow);
      ctor = this.parseMethodSig(this.blobAt(MemberRef, ctorRow, 2), { p: 0 });
    } else {
      owner = this.typeName(T.TypeDef, this.methodOwner(ctorRow));
      ctor = this.methodSig(ctorRow);
    }
    const name = owner.name.endsWith("Attribute") ? owner.name.slice(0, -9) : owner.name;
    const blob = this.blobAt(T.CustomAttribute, row, 2);
    const pos = { p: 2 };
    const args: unknown[] = [];
    const named: Record<string, unknown> = {};
    try {
      for (const param of ctor.params) args.push(this.readFixedArg(blob, pos, param));
      const count = blob.length >= pos.p + 2 ? blob[pos.p] | (blob[pos.p + 1] << 8) : 0;
      pos.p += 2;
      for (let i = 0; i < count; i++) {
        pos.p++;
        const type = this.readFieldOrPropType(blob, pos);
        const key = readSerString(blob, pos) ?? "";
        named[key] = this.readElem(blob, pos, type);
      }
    } catch {}
    return { ns: owner.ns, name, args, named };
  }

  private methodOwnerIndex?: Int32Array;
  methodOwner(methodRow: number): number {
    if (!this.methodOwnerIndex) {
      this.methodOwnerIndex = new Int32Array(this.rows[T.MethodDef] + 2);
      for (let r = 1; r <= this.rows[T.TypeDef]; r++) {
        const [first, last] = this.range(T.TypeDef, r, 5, T.MethodDef);
        for (let m = first; m < last; m++) this.methodOwnerIndex[m] = r;
      }
    }
    return this.methodOwnerIndex[methodRow];
  }

  private readFieldOrPropType(blob: Uint8Array, pos: { p: number }): TypeSig | string {
    const code = blob[pos.p++];
    if (code === 0x55) return `enum:${readSerString(blob, pos)}`;
    if (code === 0x50) return "type";
    if (code === 0x51) return "boxed";
    if (code === 0x1d) return { kind: "array", elem: this.readFieldOrPropType(blob, pos) as TypeSig };
    if (code === 0x0e) return { kind: "string" };
    return { kind: "prim", name: PRIM[code] ?? "i32" };
  }

  private readElem(blob: Uint8Array, pos: { p: number }, type: TypeSig | string): unknown {
    if (typeof type === "string") {
      if (type === "type") return readSerString(blob, pos);
      if (type === "boxed") return this.readElem(blob, pos, this.readFieldOrPropType(blob, pos));
      return this.readPrim(blob, pos, "i32");
    }
    return this.readFixedArg(blob, pos, type);
  }

  private readPrim(blob: Uint8Array, pos: { p: number }, name: string): number | bigint | boolean {
    const v = new DataView(blob.buffer, blob.byteOffset + pos.p);
    const size: Record<string, number> = { bool: 1, i8: 1, u8: 1, char16: 2, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4 };
    pos.p += size[name] ?? 8;
    switch (name) {
      case "bool":
        return v.getUint8(0) !== 0;
      case "i8":
        return v.getInt8(0);
      case "u8":
        return v.getUint8(0);
      case "i16":
        return v.getInt16(0, true);
      case "u16":
      case "char16":
        return v.getUint16(0, true);
      case "i32":
        return v.getInt32(0, true);
      case "u32":
        return v.getUint32(0, true);
      case "f32":
        return v.getFloat32(0, true);
      case "f64":
        return v.getFloat64(0, true);
      case "i64":
        return v.getBigInt64(0, true);
      default:
        return v.getBigUint64(0, true);
    }
  }

  private readFixedArg(blob: Uint8Array, pos: { p: number }, type: TypeSig): unknown {
    switch (type.kind) {
      case "prim":
        return this.readPrim(blob, pos, type.name);
      case "string":
        return readSerString(blob, pos);
      case "array": {
        const n = new DataView(blob.buffer, blob.byteOffset + pos.p).getUint32(0, true);
        pos.p += 4;
        if (n === 0xffffffff) return null;
        const out: unknown[] = [];
        for (let i = 0; i < n; i++) out.push(this.readFixedArg(blob, pos, type.elem));
        return out;
      }
      case "object":
        return this.readElem(blob, pos, "boxed");
      case "named":
        if (type.ns === "System" && type.name === "Type") return readSerString(blob, pos);
        return this.readPrim(blob, pos, this.enumUnderlying(type) ?? "i32");
      default:
        throw new Error("unsupported attribute argument");
    }
  }

  /** Underlying primitive of an enum TypeDef (or TypeRef resolvable in this file). */
  enumUnderlying(type: { table: number; row: number; ns: string; name: string }): string | undefined {
    const row = type.table === T.TypeDef ? type.row : this.findType(type.ns ? `${type.ns}.${type.name}` : type.name);
    if (!row) return undefined;
    const [first, last] = this.range(T.TypeDef, row, 4, T.Field);
    for (let f = first; f < last; f++) {
      if (this.str(T.Field, f, 1) === "value__") {
        const sig = this.fieldSig(f);
        return sig.kind === "prim" ? sig.name : undefined;
      }
    }
    return undefined;
  }

  /** Decoded Constant row value attached to a Field, Param or Property. */
  constant(table: number, row: number): number | bigint | string | boolean | null | undefined {
    if (!this.constIndex) {
      this.constIndex = new Map();
      const tags = CODED.HasConstant.tables;
      for (let r = 1; r <= this.rows[T.Constant]; r++) {
        const value = this.col(T.Constant, r, 2);
        this.constIndex.set(tags[value & 3] * 0x1000000 + (value >>> 2), r);
      }
    }
    const r = this.constIndex.get(table * 0x1000000 + row);
    if (!r) return undefined;
    const type = this.col(T.Constant, r, 0);
    const blob = this.blobAt(T.Constant, r, 3);
    if (type === 0x0e) {
      let s = "";
      for (let i = 0; i + 1 < blob.length; i += 2) s += String.fromCharCode(blob[i] | (blob[i + 1] << 8));
      return s;
    }
    if (type === 0x12) return null;
    const value = this.readPrim(blob, { p: 0 }, PRIM[type] ?? "u64");
    return value;
  }

  classLayout(typeRow: number): { pack: number; size: number } | undefined {
    if (!this.layoutIndex) {
      this.layoutIndex = new Map();
      for (let r = 1; r <= this.rows[T.ClassLayout]; r++) this.layoutIndex.set(this.col(T.ClassLayout, r, 2), r);
    }
    const r = this.layoutIndex.get(typeRow);
    return r ? { pack: this.col(T.ClassLayout, r, 0), size: this.col(T.ClassLayout, r, 1) } : undefined;
  }

  fieldOffset(fieldRow: number): number | undefined {
    if (!this.fieldOffsetIndex) {
      this.fieldOffsetIndex = new Map();
      for (let r = 1; r <= this.rows[T.FieldLayout]; r++)
        this.fieldOffsetIndex.set(this.col(T.FieldLayout, r, 1), this.col(T.FieldLayout, r, 0));
    }
    return this.fieldOffsetIndex.get(fieldRow);
  }

  /** P/Invoke target of a MethodDef: DLL (lowercase) and entry point. */
  implMap(methodRow: number): { dll: string; entry: string; flags: number } | undefined {
    if (!this.implIndex) {
      this.implIndex = new Map();
      for (let r = 1; r <= this.rows[T.ImplMap]; r++) {
        const [table, row] = this.decode("MemberForwarded", this.col(T.ImplMap, r, 1));
        if (table === T.MethodDef) this.implIndex.set(row, r);
      }
    }
    const r = this.implIndex.get(methodRow);
    if (!r) return undefined;
    return {
      flags: this.col(T.ImplMap, r, 0),
      entry: this.str(T.ImplMap, r, 2),
      dll: this.str(T.ModuleRef, this.col(T.ImplMap, r, 3), 0).toLowerCase(),
    };
  }
}

function readCompressed(sig: Uint8Array, pos: { p: number }): number {
  const b = sig[pos.p];
  if ((b & 0x80) === 0) {
    pos.p += 1;
    return b;
  }
  if ((b & 0xc0) === 0x80) {
    pos.p += 2;
    return ((b & 0x3f) << 8) | sig[pos.p - 1];
  }
  pos.p += 4;
  return ((b & 0x1f) * 0x1000000) | (sig[pos.p - 3] << 16) | (sig[pos.p - 2] << 8) | sig[pos.p - 1];
}

function readSerString(blob: Uint8Array, pos: { p: number }): string | null {
  if (blob[pos.p] === 0xff) {
    pos.p++;
    return null;
  }
  const len = readCompressed(blob, pos);
  const text = new TextDecoder().decode(blob.subarray(pos.p, pos.p + len));
  pos.p += len;
  return text;
}

function formatGuid(b: Uint8Array): string {
  const v = new DataView(b.buffer, b.byteOffset, 16);
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
  const tail = Array.from(b.subarray(8, 16), x => hex(x, 2)).join("");
  return `${hex(v.getUint32(0, true), 8)}-${hex(v.getUint16(4, true), 4)}-${hex(v.getUint16(6, true), 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** GUID from a GuidAttribute's fixed args (u32, u16, u16, u8 x 8). */
function guidFromArgs(args: unknown[]): string {
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, Number(args[0]), true);
  v.setUint16(4, Number(args[1]), true);
  v.setUint16(6, Number(args[2]), true);
  for (let i = 0; i < 8; i++) b[8 + i] = Number(args[3 + i]);
  return formatGuid(b);
}

export type WinrtNamespace = {
  interfaces: Record<string, unknown>;
  classes: Record<string, unknown>;
  enums: Record<string, unknown>;
  delegates?: Record<string, unknown>;
};

/**
 * WinRT model of a .winmd, per namespace: interfaces (IID, ABI methods with vtable slots), runtime
 * classes (default interface, statics, factories), enums and delegates. Consumed by bun:winrt and
 * scripts/aphrody/winrt/gen.ts.
 */
function winrtModel(data: Uint8Array): Map<string, WinrtNamespace> {
  const md = new Winmd(data);
  const typeKind = new Map<string, { row: number; kind: string }>();

  // Custom attributes keyed by "<table>:<row>", blobs kept raw.
  const attrs = new Map<string, { name: string; blob: Uint8Array }[]>();
  for (let row = 1; row <= md.count(T.CustomAttribute); row++) {
    const [parentTable, parentRow] = md.decode("HasCustomAttribute", md.col(T.CustomAttribute, row, 0));
    const [ctorTable, ctorRow] = md.decode("CustomAttributeType", md.col(T.CustomAttribute, row, 1));
    let name = "";
    const { MemberRef } = T;
    if (ctorTable === MemberRef) {
      const [ownerTable, ownerRow] = md.decode("MemberRefParent", md.col(MemberRef, ctorRow, 0));
      name = md.typeName(ownerTable, ownerRow).name;
    }
    const key = `${parentTable}:${parentRow}`;
    let list = attrs.get(key);
    if (!list) attrs.set(key, (list = []));
    list.push({ name, blob: md.blobAt(T.CustomAttribute, row, 2) });
  }
  const attr = (table: number, row: number, name: string) =>
    attrs.get(`${table}:${row}`)?.filter(a => a.name === name) ?? [];
  const serString = (blob: Uint8Array) => readSerString(blob, { p: 2 }) ?? "";

  for (let row = 1; row <= md.count(T.TypeDef); row++) {
    const ns = md.str(T.TypeDef, row, 2);
    if (ns) typeKind.set(`${ns}.${md.str(T.TypeDef, row, 1)}`, { row, kind: md.kind(row) });
  }

  const guidOf = (row: number) => {
    const blob = attr(T.TypeDef, row, "GuidAttribute")[0]?.blob;
    return blob ? formatGuid(blob.subarray(2, 18)) : undefined;
  };

  const enumUnderlying = (row: number) => {
    const { Field } = T;
    const [first, last] = md.range(T.TypeDef, row, 4, Field);
    for (let f = first; f < last; f++) {
      if (md.str(Field, f, 1) === "value__") return md.blobAt(Field, f, 2)[1] === 0x09 ? "u32" : "i32";
    }
    return "i32";
  };

  // Generic instantiations become ["TypedEventHandler", "Object", "Ns.Type", ...] (signatureOf in bun:winrt).
  const genericType = (sig: TypeSig): unknown => {
    switch (sig.kind) {
      case "object":
        return "Object";
      case "string":
        return "String";
      case "prim":
        return sig.name;
      case "named":
        return `${sig.ns}.${sig.name}`;
      case "generic": {
        const base = sig.base.kind === "named" ? sig.base : undefined;
        const name = base ? base.name.replace(/`\d+$/, "") : "Object";
        const foundation = base?.ns === "Windows.Foundation" || base?.ns === "Windows.Foundation.Collections";
        return [foundation ? name : `${base?.ns}.${name}`, ...sig.args.map(genericType)];
      }
      default:
        return "Object";
    }
  };

  const typeOfRef = (coded: number): unknown => {
    const [table, r] = md.decode("TypeDefOrRef", coded);
    const { TypeSpec } = T;
    if (table === TypeSpec) return genericType(md.parseType(md.blobAt(TypeSpec, r, 0), { p: 0 }));
    const n = md.typeName(table, r);
    return `${n.ns}.${n.name}`;
  };

  // [kind, type, unsupported reason]
  const marshal = (sig: TypeSig): [string, unknown, string?] => {
    switch (sig.kind) {
      case "prim":
        return ["prim", sig.name];
      case "string":
        return ["hstring", ""];
      case "object":
        return ["object", ""];
      case "generic":
        return ["object", genericType(sig)];
      case "named": {
        const full = `${sig.ns}.${sig.name}`;
        const info = typeKind.get(full);
        if (info?.kind === "enum") return ["prim", enumUnderlying(info.row)];
        if (info?.kind === "interface") return ["iface", full];
        if (info?.kind === "class") return ["class", full];
        if (info?.kind === "delegate") return ["object", full];
        // EventRegistrationToken { int64 value } travels as a plain 64-bit integer.
        if (full === "Windows.Foundation.EventRegistrationToken") return ["prim", "i64"];
        return ["object", full, sig.valueType ? `struct ${full} by value` : undefined];
      }
      case "array":
        return ["object", "", "array parameter"];
      default:
        return ["object", "", `signature ${sig.kind}`];
    }
  };

  const interfaceDesc = (row: number) => {
    const [first, last] = md.range(T.TypeDef, row, 5, T.MethodDef);
    const methods: unknown[] = [];
    let slot = 6;
    for (let m = first; m < last; m++, slot++) {
      // Overloads keep their ABI name (OverloadAttribute), which is also unique in JS.
      const overload = attr(T.MethodDef, m, "OverloadAttribute")[0];
      const name = overload ? serString(overload.blob) : md.str(T.MethodDef, m, 3);
      const sig = md.methodSig(m);
      const paramRows = md.params(m);
      let unsupported: string | undefined;
      const params = sig.params.map((p, i) => {
        const ps = p.kind === "const" ? p.inner : p;
        const out = (paramRows.get(i + 1)?.flags ?? 0) & 2 || ps.kind === "byref";
        const [kind, type, reason] = marshal(ps.kind === "byref" ? ps.inner : ps);
        unsupported ??= reason;
        return [out ? "out" : "in", kind, type];
      });
      let ret: unknown = null;
      if (!(sig.ret.kind === "prim" && sig.ret.name === "void")) {
        const [kind, type, reason] = marshal(sig.ret);
        unsupported ??= reason;
        ret = [kind, type];
      }
      methods.push(unsupported ? [name, slot, params, ret, unsupported] : [name, slot, params, ret]);
    }
    return { iid: guidOf(row), methods };
  };

  let constants: Map<number, number> | undefined;
  const fieldConstants = () => {
    if (constants) return constants;
    constants = new Map();
    for (let k = 1; k <= md.count(T.Constant); k++) {
      const [table, r] = md.decode("HasConstant", md.col(T.Constant, k, 2));
      if (table === T.Field) constants.set(r, k);
    }
    return constants;
  };

  const namespaces = new Map<string, WinrtNamespace>();
  const bucket = (ns: string) => {
    let b = namespaces.get(ns);
    if (!b) namespaces.set(ns, (b = { interfaces: {}, classes: {}, enums: {} }));
    return b;
  };

  for (const [full, { row, kind }] of typeKind) {
    if (full.includes("`")) continue;
    const ns = md.str(T.TypeDef, row, 2);
    if (kind === "interface") {
      const desc = interfaceDesc(row);
      if (desc.iid) bucket(ns).interfaces[full] = desc;
    } else if (kind === "delegate") {
      const iid = guidOf(row);
      const [first, last] = md.range(T.TypeDef, row, 5, T.MethodDef);
      for (let m = first; m < last; m++) {
        if (md.str(T.MethodDef, m, 3) !== "Invoke") continue;
        const params = md.methodSig(m).params.map(ps => marshal(ps).slice(0, 2));
        if (iid) (bucket(ns).delegates ??= {})[full] = { iid, params };
      }
    } else if (kind === "enum") {
      const values: Record<string, number> = {};
      const [first, last] = md.range(T.TypeDef, row, 4, T.Field);
      for (let f = first; f < last; f++) {
        const name = md.str(T.Field, f, 1);
        if (name === "value__") continue;
        const k = fieldConstants().get(f);
        if (k !== undefined) {
          const blob = md.blobAt(T.Constant, k, 3);
          values[name] = new DataView(blob.buffer, blob.byteOffset, 4).getInt32(0, true);
        }
      }
      bucket(ns).enums[full] = values;
    } else if (kind === "class") {
      const statics: string[] = [];
      const factories: string[] = [];
      let activatable = false;
      for (const a of attr(T.TypeDef, row, "StaticAttribute")) statics.push(serString(a.blob));
      for (const a of attr(T.TypeDef, row, "ActivatableAttribute")) {
        // ActivatableAttribute(uint version[, string platform]) vs ActivatableAttribute(Type factory, uint version).
        const { blob } = a;
        if (blob.length >= 6 && blob[2] > 4 && blob[3] !== 0) {
          const name = serString(blob);
          if (name.includes(".")) {
            factories.push(name);
            continue;
          }
        }
        activatable = true;
      }
      // ComposableAttribute(Type factory, CompositionType type, uint version): CreateInstance(outer, out inner).
      for (const a of attr(T.TypeDef, row, "ComposableAttribute")) factories.push(serString(a.blob));
      let defaultInterface: unknown;
      const interfaces: unknown[] = [];
      for (const i of md.interfaceImpls(row)) {
        const type = typeOfRef(md.col(T.InterfaceImpl, i, 1));
        interfaces.push(type);
        if (attr(T.InterfaceImpl, i, "DefaultAttribute").length !== 0) defaultInterface = type;
      }
      const extendsValue = md.col(T.TypeDef, row, 3);
      const base = extendsValue ? (typeOfRef(extendsValue) as string) : undefined;
      bucket(ns).classes[full] = {
        defaultInterface,
        statics,
        factories,
        activatable,
        ...(base && base !== "System.Object" ? { base } : {}),
        interfaces,
      };
    }
  }
  return namespaces;
}

export default { Winmd, Tables: T, readCompressed, formatGuid, guidFromArgs, winrtModel };
