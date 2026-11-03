// @ts-nocheck -- ported verbatim from the fork, whose src/js modules are loosely typed builtins.
// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun src/js/bun/winrt.ts (commit 62fcdb38ec9, MIT, Copyright Oven and contributors) to
// upstream Bun as the Bun OS `bun:winrt` module (src/bun-plugin.ts). The fork API is kept unchanged. The only engine
// piece, the free-threaded completion delegate of src/runtime/windows/com.rs, is ./com-delegate.ts (bun:ffi plus
// x86-64 IUnknown stubs). Relation to ../winrt.ts: that module is the typed windows-rs N-API facade of
// @aphrody/windows (parseUri, folderInfo, deviceFamily); this one is the general metadata-driven projection.
//
// bun:winrt — Windows Runtime projection. Namespaces are read on demand from System32WinMetadata (or a
// framework .winmd), activation goes through combase RoGetActivationFactory and methods are called through
// the COM vtable with bun:ffi. IAsync* results become Promises (completion handlers are native COM delegates,
// see ./com-delegate.ts), IVector/IVectorView results are iterable.
import type { FFIType } from "bun:ffi";
import type { WinrtNamespace } from "./winmd";
import comDelegate from "./com-delegate";
import winmd from "./winmd";

const ffi = require("bun:ffi");
const { dlopen, CFunction, JSCallback, toArrayBuffer } = ffi;
const { read, ptr }: Pick<typeof import("bun:ffi"), "read" | "ptr"> = ffi;

let combaseSymbols;
const combase = () =>
  (combaseSymbols ??= dlopen("combase.dll", {
    RoInitialize: { args: ["u32"], returns: "i32" },
    RoGetActivationFactory: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
    WindowsCreateString: { args: ["ptr", "u32", "ptr"], returns: "i32" },
    WindowsDeleteString: { args: ["ptr"], returns: "i32" },
    WindowsGetStringRawBuffer: { args: ["ptr", "ptr"], returns: "ptr" },
  }).symbols);

const RPC_E_CHANGED_MODE = 0x80010106 | 0;
// 0 = not initialized, 1 = multithreaded (default), 2 = single-threaded (UI threads: XAML, WinUI).
let apartment = 0;
function init(options?: { singleThreaded?: boolean }) {
  const singleThreaded = options?.singleThreaded === true;
  if (apartment && (!singleThreaded || apartment === 2)) return;
  const hr = combase().RoInitialize(singleThreaded ? 0 : 1);
  if (hr === RPC_E_CHANGED_MODE && singleThreaded) {
    const error = hresultError(hr, "RoInitialize(single-threaded)");
    error.message +=
      " (this thread already joined the multithreaded apartment; initialize the UI module before any other WinRT call)";
    throw error;
  }
  if (hr < 0 && hr !== RPC_E_CHANGED_MODE) throw hresultError(hr, "RoInitialize");
  apartment = singleThreaded ? 2 : 1;
}

function hresultError(hr, what) {
  const error: Error & { hresult?: number } = new Error(
    `${what} failed: HRESULT 0x${(hr >>> 0).toString(16).padStart(8, "0")}`,
  );
  error.code = "ERR_WINRT_HRESULT";
  error.hresult = hr >>> 0;
  return error;
}

function check(hr, what) {
  if (hr < 0) throw hresultError(hr, what);
}

function guid(text) {
  if (typeof text !== "string" || !/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(text)) {
    throw new TypeError(`invalid WinRT GUID: ${text}`);
  }
  if ((text.startsWith("{") && !text.endsWith("}")) || (!text.startsWith("{") && text.endsWith("}"))) {
    throw new TypeError(`invalid WinRT GUID: ${text}`);
  }
  const hex = text.replace(/[{}-]/g, "");
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, parseInt(hex.slice(0, 8), 16), true);
  view.setUint16(4, parseInt(hex.slice(8, 12), 16), true);
  view.setUint16(6, parseInt(hex.slice(12, 16), 16), true);
  for (let i = 0; i < 8; i++) bytes[8 + i] = parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16);
  return bytes;
}

function createHString(value) {
  const text = String(value);
  if (text.length === 0) return 0;
  const utf16 = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) utf16[i] = text.charCodeAt(i);
  const out = new BigUint64Array(1);
  check(combase().WindowsCreateString(ptr(utf16), text.length, ptr(out)), "WindowsCreateString");
  return Number(out[0]);
}

function readHString(handle, release) {
  if (!handle) return "";
  const length = new Uint32Array(1);
  const raw = combase().WindowsGetStringRawBuffer(handle, ptr(length));
  const text = length[0] && raw ? new TextDecoder("utf-16le").decode(toArrayBuffer(raw, 0, length[0] * 2)) : "";
  if (release) combase().WindowsDeleteString(handle);
  return text;
}

const FFI = {
  bool: "bool",
  char16: "u16",
  i8: "i8",
  u8: "u8",
  i16: "i16",
  u16: "u16",
  i32: "i32",
  u32: "u32",
  i64: "i64",
  u64: "u64",
  f32: "f32",
  f64: "f64",
  isize: "i64",
  usize: "u64",
};

const callCache = new Map();
function vfunc(object, slot, args) {
  const vtable = read.ptr(object, 0);
  const fn = read.ptr(vtable, slot * 8);
  const key = `${fn}:${args.join(",")}`;
  let call = callCache.get(key);
  if (!call) {
    call = CFunction({ ptr: fn, args: ["ptr", ...args], returns: "i32" });
    callCache.set(key, call);
  }
  return call;
}

const registry = {
  interfaces: new Map(),
  classes: new Map(),
  enums: new Map(),
  delegates: new Map(),
};
const release = new FinalizationRegistry(object => vfunc(object, 2, [])(object));

function readOut(view, kind, type) {
  switch (kind) {
    case "hstring":
      return readHString(Number(view.getBigUint64(0, true)), true);
    case "iface":
    case "class":
    case "object": {
      const object = Number(view.getBigUint64(0, true));
      if (!object) return null;
      if (kind === "class" && typeof type === "string") {
        ensureType(type);
        const defaultInterface = registry.classes.get(type)?.defaultInterface;
        if (ASYNC[Array.isArray(defaultInterface) ? defaultInterface[0] : defaultInterface]) {
          return asyncPromise(object, defaultInterface);
        }
      }
      if (ASYNC[Array.isArray(type) ? type[0] : type]) return asyncPromise(object, type);
      if (Array.isArray(type) && (type[0] === "IVector" || type[0] === "IVectorView") && type.length === 2) {
        const interfaceName = vectorInterface(type[1], type[0] === "IVectorView");
        return wrap(object, interfaceName, interfaceName);
      }
      if (typeof type !== "string") return wrap(object, undefined, undefined);
      ensureType(type);
      return wrap(object, kind === "class" ? registry.classes.get(type)?.defaultInterface : type, type);
    }
    case "prim":
      switch (type) {
        case "bool":
          return view.getUint8(0) !== 0;
        case "i8":
          return view.getInt8(0);
        case "u8":
          return view.getUint8(0);
        case "i16":
          return view.getInt16(0, true);
        case "u16":
        case "char16":
          return view.getUint16(0, true);
        case "i32":
          return view.getInt32(0, true);
        case "u32":
          return view.getUint32(0, true);
        case "i64":
        case "isize":
          return view.getBigInt64(0, true);
        case "u64":
        case "usize":
          return view.getBigUint64(0, true);
        case "f32":
          return view.getFloat32(0, true);
        case "f64":
          return view.getFloat64(0, true);
      }
  }
  throw new TypeError(`unsupported WinRT out kind ${kind}:${type}`);
}

function toPointer(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const { ptr } = value;
    if (typeof ptr === "number") return ptr;
  }
  throw new TypeError("expected a WinRT object");
}

function invoke(object, method, values) {
  const [name, slot, params, ret] = method;
  if (method[4]) throw new Error(`WinRT method ${name} uses an ABI shape bun:ffi cannot express yet (${method[4]})`);
  const ffiArgs: (FFIType | keyof typeof FFIType)[] = [];
  const callArgs = [object];
  const outs: [DataView, string, unknown][] = [];
  const strings: number[] = [];
  const temporaries: number[] = [];
  let input = 0;
  for (const [direction, kind, type] of params) {
    if (direction === "out") {
      const buffer = new BigUint64Array(1);
      outs.push([new DataView(buffer.buffer), kind, type]);
      ffiArgs.push("ptr");
      callArgs.push(ptr(buffer));
      continue;
    }
    const value = values[input++];
    if (kind === "hstring") {
      const handle = createHString(value);
      strings.push(handle);
      ffiArgs.push("ptr");
      callArgs.push(handle);
    } else if (kind === "prim") {
      ffiArgs.push(FFI[type]);
      callArgs.push(value);
    } else {
      ffiArgs.push("ptr");
      // A class parameter takes its default interface and an interface parameter that exact interface:
      // a wrapper holding another interface of the object is converted with QueryInterface for the call.
      const target =
        kind === "class" ? registry.classes.get(type)?.defaultInterface : kind === "iface" ? type : undefined;
      const desc = target && registry.interfaces.get(target);
      if (desc && value instanceof WinRTObject && value.interfaceName !== target) {
        const converted = queryInterface(value.ptr, desc.iid);
        temporaries.push(converted);
        callArgs.push(converted);
      } else {
        callArgs.push(toPointer(value));
      }
    }
  }
  let retView;
  if (ret) {
    const buffer = new BigUint64Array(1);
    retView = new DataView(buffer.buffer);
    ffiArgs.push("ptr");
    callArgs.push(ptr(buffer));
  }
  try {
    check(vfunc(object, slot, ffiArgs)(...callArgs), name);
  } finally {
    for (const handle of strings) if (handle) combase().WindowsDeleteString(handle);
    for (const object of temporaries) vfunc(object, 2, [])(object);
  }
  const results = outs.map(([view, kind, type]) => readOut(view, kind, type));
  if (ret) {
    const value = readOut(retView, ret[0], ret[1]);
    return results.length ? [value, ...results] : value;
  }
  return results.length === 0 ? undefined : results.length === 1 ? results[0] : results;
}

function queryInterface(object, iid) {
  const out = new BigUint64Array(1);
  check(vfunc(object, 0, ["ptr", "ptr"])(object, ptr(guid(iid)), ptr(out)), "QueryInterface");
  return Number(out[0]);
}

class WinRTObject {
  declare ptr: number;
  declare interfaceName: string | undefined;
  declare className: string | undefined;
  declare Size: number;
  declare Type: number;
  declare GetAt: (index: number) => unknown;
  declare [Symbol.iterator]: () => IterableIterator<unknown>;

  constructor(object, interfaceName, className) {
    this.ptr = object;
    this.interfaceName = interfaceName;
    this.className = className;
    release.register(this, object);
  }
  as(interfaceName) {
    const desc = registry.interfaces.get(interfaceName);
    if (!desc) throw new Error(`WinRT interface ${interfaceName} is not loaded; require its namespace family first`);
    return wrap(queryInterface(this.ptr, desc.iid), interfaceName, this.className);
  }
  get runtimeClassName() {
    const out = new BigUint64Array(1);
    check(vfunc(this.ptr, 4, ["ptr"])(this.ptr, ptr(out)), "GetRuntimeClassName");
    return readHString(Number(out[0]), true);
  }
}

// With `iid`, each call goes through QueryInterface(iid) on object() (members of a non-default interface).
function bindMethods(target, object, desc, iid?) {
  for (const method of desc.methods) {
    const name = method[0];
    const fn = iid
      ? (...values) => {
          const target = queryInterface(object(), iid);
          try {
            return invoke(target, method, values);
          } finally {
            vfunc(target, 2, [])(target);
          }
        }
      : (...values) => invoke(object(), method, values);
    if (!(name in target)) Object.defineProperty(target, name, { value: fn, enumerable: true });
    if (name.startsWith("get_") && method[2].filter(p => p[0] === "in").length === 0) {
      const property = name.slice(4);
      if (!(property in target)) Object.defineProperty(target, property, { get: fn, enumerable: true });
    }
  }
}

function addRef(object) {
  vfunc(object, 1, [])(object);
  return object;
}

// Wraps a pointer the caller does not own (delegate arguments): AddRef first, the wrapper releases it.
function wrapBorrowed(object, interfaceName?, className?) {
  return object ? wrap(addRef(object), interfaceName, className) : null;
}

function wrap(object, interfaceName?, className?) {
  if (className) ensureType(className);
  if (interfaceName) ensureType(interfaceName);
  const wrapper = new WinRTObject(object, interfaceName, className);
  const desc = interfaceName && registry.interfaces.get(interfaceName);
  if (desc) bindMethods(wrapper, () => wrapper.ptr, desc);
  // Members of the class's other interfaces and base classes, called through QueryInterface.
  for (let name = className; name; name = registry.classes.get(name)?.base) {
    const cls = registry.classes.get(name);
    if (!cls) break;
    for (const other of cls.interfaces ?? []) {
      if (typeof other !== "string" || other === interfaceName) continue;
      ensureType(other);
      const odesc = registry.interfaces.get(other);
      if (odesc) bindMethods(wrapper, () => wrapper.ptr, odesc, odesc.iid);
    }
  }
  if (typeof wrapper.GetAt === "function" && "Size" in wrapper) {
    wrapper[Symbol.iterator] = function* () {
      for (let i = 0, n = wrapper.Size; i < n; i++) yield wrapper.GetAt(i);
    };
  }
  return wrapper;
}

// Loads the System32\WinMetadata namespace that declares `type` when it is not registered yet.
const missingNamespaces = new Set();
function ensureType(type) {
  if (typeof type !== "string" || !type.includes(".")) return;
  if (registry.classes.has(type) || registry.interfaces.has(type) || registry.delegates.has(type)) return;
  if (registry.enums.has(type)) return;
  const namespace = type.slice(0, type.lastIndexOf("."));
  if (missingNamespaces.has(namespace)) return;
  missingNamespaces.add(namespace);
  try {
    systemMetadata(namespace);
  } catch {}
}

// IAsyncAction / IAsyncOperation<T> (and the WithProgress variants) as Promises: put_Completed with a
// native COM delegate, which WinRT may call on any thread pool thread, then GetResults on the JS thread.
const ASYNC = {
  "Windows.Foundation.IAsyncAction": {
    handler: "a4ed5c81-76c9-40bd-8be6-b1d90fb20ae7",
    completed: 6,
    results: 8,
  },
  IAsyncOperation: { handler: "AsyncOperationCompletedHandler", completed: 6, results: 8 },
  IAsyncOperationWithProgress: {
    handler: "AsyncOperationWithProgressCompletedHandler",
    completed: 8,
    results: 10,
  },
  IAsyncActionWithProgress: {
    handler: "AsyncActionWithProgressCompletedHandler",
    completed: 8,
    results: 10,
  },
};
const ASYNC_CANCELED = 2;
const ASYNC_ERROR = 3;
const IID_IASYNCINFO = "00000036-0000-0000-c000-000000000046";

function asyncPromise(object, type) {
  const generic = Array.isArray(type);
  const shape = ASYNC[generic ? type[0] : type];
  const handlerIid = generic ? iidOf([shape.handler, ...type.slice(1)]) : shape.handler;
  const resultType = generic && type[0].startsWith("IAsyncOperation") ? type[1] : undefined;
  const { promise, resolve, reject } = Promise.withResolvers();
  let settled = false;
  Object.defineProperty(promise, "cancel", {
    value() {
      if (settled) return;
      const info = queryInterface(object, IID_IASYNCINFO);
      try {
        check(vfunc(info, 9, [])(info), "IAsyncInfo.Cancel");
      } finally {
        vfunc(info, 2, [])(info);
      }
    },
  });
  const handler = comDelegate.delegate(handlerIid, (_info, status) => {
    if (settled) return;
    settled = true;
    try {
      status = typeof status === "bigint" ? Number(BigInt.asUintN(32, status)) : status >>> 0;
      if (status === ASYNC_CANCELED) {
        const error = new Error("WinRT async operation was canceled");
        error.name = "AbortError";
        reject(error);
        return;
      }
      // GetResults reports the operation's error HRESULT when status is Error.
      const ret = resultType === undefined ? null : kindOf(resultType);
      const value = invoke(object, ["GetResults", shape.results, [], ret], []);
      if (status === ASYNC_ERROR) reject(hresultError(0x80004005 | 0, "WinRT async operation"));
      else resolve(value);
    } catch (error) {
      reject(error);
    } finally {
      vfunc(object, 2, [])(object);
    }
  });
  try {
    check(vfunc(object, shape.completed, ["ptr"])(object, handler), "put_Completed");
  } catch (error) {
    vfunc(object, 2, [])(object);
    throw error;
  } finally {
    comDelegate.release(handler);
  }
  return promise;
}

function activationFactory(className, iid) {
  init();
  const name = createHString(className);
  const out = new BigUint64Array(1);
  try {
    check(combase().RoGetActivationFactory(name, ptr(guid(iid)), ptr(out)), `RoGetActivationFactory(${className})`);
  } finally {
    combase().WindowsDeleteString(name);
  }
  return Number(out[0]);
}

const IACTIVATIONFACTORY = "00000035-0000-0000-c000-000000000046";

function runtimeClass(name, desc) {
  const cls: { className: string; activate?: () => WinRTObject } = { className: name };
  const factories = new Map();
  const factory = interfaceName => {
    let object = factories.get(interfaceName);
    if (!object) {
      object = activationFactory(name, registry.interfaces.get(interfaceName).iid);
      factories.set(interfaceName, object);
    }
    return object;
  };
  for (const interfaceName of [...desc.statics, ...desc.factories]) {
    const idesc = registry.interfaces.get(interfaceName);
    if (idesc) bindMethods(cls, () => factory(interfaceName), idesc);
  }
  if (desc.activatable) {
    cls.activate = () => {
      const object = activationFactory(name, IACTIVATIONFACTORY);
      const out = new BigUint64Array(1);
      try {
        check(vfunc(object, 6, ["ptr"])(object, ptr(out)), `${name}.ActivateInstance`);
      } finally {
        vfunc(object, 2, [])(object);
      }
      const instance = wrap(Number(out[0]), undefined, name);
      return desc.defaultInterface ? instance.as(desc.defaultInterface) : instance;
    };
  }
  return Object.freeze(cls);
}

type NamespaceModel = WinrtNamespace & { namespace: string };

function defineNamespace(data: NamespaceModel) {
  for (const [name, desc] of Object.entries(data.interfaces)) registry.interfaces.set(name, desc);
  for (const [name, desc] of Object.entries(data.delegates ?? {})) registry.delegates.set(name, desc);
  for (const [name, desc] of Object.entries(data.classes)) registry.classes.set(name, desc);
  for (const [name, values] of Object.entries(data.enums)) registry.enums.set(name, values);
  const exports: {
    namespace: string;
    interfaces?: Readonly<Record<string, string>>;
    [member: string]: unknown;
  } = { namespace: data.namespace };
  for (const [full, values] of Object.entries(data.enums))
    exports[full.slice(data.namespace.length + 1)] = Object.freeze(values);
  for (const [full, desc] of Object.entries(data.classes)) {
    let cached;
    Object.defineProperty(exports, full.slice(data.namespace.length + 1), {
      get: () => (cached ??= runtimeClass(full, desc)),
      enumerable: true,
    });
  }
  // winrtModel's interface records carry the ECMA-335-derived IID; its shared model leaves descriptor values opaque.
  exports.interfaces = Object.freeze(
    Object.fromEntries(Object.entries(data.interfaces).map(([k, v]) => [k, (v as { iid: string }).iid])),
  );
  return exports;
}

// Parameterized interface IIDs: the "pinterface" signature hashed with SHA-1 under the WinRT namespace
// 11f47ad5-7b73-42c0-abae-878b1e16adee, so generic delegates and collections can be implemented and queried.
const PINTERFACE_NAMESPACE = Uint8Array.from("11f47ad57b7342c0abae878b1e16adee".match(/../g)!, h => parseInt(h, 16));
const GENERIC = {
  TypedEventHandler: "9de1c534-6ae1-11e0-84e1-18a905bcc53f",
  EventHandler: "9de1c535-6ae1-11e0-84e1-18a905bcc53f",
  IVector: "913337e9-11a1-4345-a3a2-4e7f956e222d",
  IVectorView: "bbe1fa4c-b0e3-4583-baef-1f1b2e483e56",
  IIterable: "faa585ea-6214-4217-afda-7f46de5869b3",
  IIterator: "6a79e863-4300-459a-9966-cbb660963ee1",
  IObservableVector: "5917eb53-50b4-4a0d-b309-65862b3f1dbc",
  IMap: "3c2925fe-8519-45c1-aa79-197b6718c1c1",
  IMapView: "e480ce40-a338-4ada-adcf-272272e48cb9",
  IObservableMap: "65df2bf5-bf39-41b5-aebc-5a9d865e472b",
  IKeyValuePair: "02b51929-c1c4-4a7e-8940-0312b5c18500",
  IReference: "61c17706-2d65-11e0-9ae8-d48564015472",
  IReferenceArray: "61c17707-2d65-11e0-9ae8-d48564015472",
  IAsyncOperation: "9fc2b0bb-e446-44e2-aa61-9cab8f636af2",
  IAsyncOperationWithProgress: "b5d036d7-e297-498f-ba60-0289e76e23dd",
  IAsyncActionWithProgress: "1f6db258-e803-48a1-9546-eb7353398884",
  AsyncOperationCompletedHandler: "fcdcf02c-e5d8-4478-915a-4d90b74b83a5",
  AsyncOperationWithProgressCompletedHandler: "e85df41d-6aa7-46e3-a8e2-f009d840c627",
  AsyncActionWithProgressCompletedHandler: "9c029f91-cc84-44fd-ac26-0a6c4e555281",
  VectorChangedEventHandler: "0c051752-9fbf-4c70-aa0c-0e4c82d9a761",
  MapChangedEventHandler: "179517f3-94ee-41f8-bddc-768a895544f3",
};

function parameterizedIid(signatureText) {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(PINTERFACE_NAMESPACE);
  hasher.update(signatureText);
  const hash = new Uint8Array(hasher.digest()).subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const PRIMITIVE_SIGNATURE = {
  bool: "b1",
  char16: "c2",
  i8: "i1",
  u8: "u1",
  i16: "i2",
  u16: "u2",
  i32: "i4",
  u32: "u4",
  i64: "i8",
  u64: "u8",
  f32: "f4",
  f64: "f8",
};

// signatureOf("Object" | "String" | "i32" | "Ns.Class" | "Ns.IFace" | "Ns.Delegate" | ["IVector", "Ns.Class"])
function signatureOf(type) {
  if (Array.isArray(type)) {
    const [generic, ...args] = type;
    const iid =
      GENERIC[String(generic).replace(/`\d+$/, "")] ?? (/^[0-9a-f-]{36}$/i.test(generic) ? generic : undefined);
    if (!iid) throw new TypeError(`unknown WinRT generic type ${generic}`);
    return `pinterface({${iid}};${args.map(signatureOf).join(";")})`;
  }
  if (type === "Object") return "cinterface(IInspectable)";
  if (type === "String") return "string";
  if (type === "Guid") return "g16";
  if (PRIMITIVE_SIGNATURE[type]) return PRIMITIVE_SIGNATURE[type];
  ensureType(type);
  const cls = registry.classes.get(type);
  if (cls) return `rc(${type};${signatureOf(cls.defaultInterface)})`;
  const iface = registry.interfaces.get(type);
  if (iface) return `{${iface.iid}}`;
  const del = registry.delegates.get(type);
  if (del) return `delegate({${del.iid}})`;
  if (registry.enums.has(type)) return `enum(${type};i4)`;
  throw new TypeError(`WinRT type ${type} is not loaded; require its namespace family first`);
}

function iidOf(type) {
  if (Array.isArray(type)) return parameterizedIid(signatureOf(type));
  const desc = registry.interfaces.get(type) ?? registry.delegates.get(type);
  if (!desc) throw new TypeError(`WinRT interface ${type} is not loaded; require its namespace family first`);
  return desc.iid;
}

// COM objects implemented in JavaScript: delegates (event handlers) and composable outers (Application).
// Each object owns one vtable per implemented interface (tear-offs); IUnknown slots are shared JSCallbacks
// that look the object up by address. XAML raises events on the UI thread, which is the JS thread pumping
// messages, so every slot runs synchronously inside DispatchMessageW.
const IID_IUNKNOWN = guid("00000000-0000-0000-c000-000000000046");
const IID_IINSPECTABLE = guid("af86e2e0-b12d-4c6a-9c5a-d7aa65101e90");
const IID_IAGILEOBJECT = guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90");
const E_NOINTERFACE = 0x80004002 | 0;
const E_FAIL = 0x80004005 | 0;
const comObjects = new Map();
let unknownSlots;

function sameGuid(address, bytes) {
  const actual = new Uint8Array(toArrayBuffer(address, 0, 16));
  for (let i = 0; i < 16; i++) if (actual[i] !== bytes[i]) return false;
  return true;
}

function writePointer(address, value) {
  new BigUint64Array(toArrayBuffer(address, 0, 8))[0] = BigInt(value);
}

function iunknown() {
  if (unknownSlots) return unknownSlots;
  const queryInterfaceSlot = new JSCallback(
    (self, riid, out) => {
      const entry = comObjects.get(Number(self));
      if (!entry || !out) return E_NOINTERFACE;
      const { state } = entry;
      for (const [iids, address] of state.tearOffs) {
        if (iids.some(iid => sameGuid(riid, iid))) {
          state.refs++;
          writePointer(out, address);
          return 0;
        }
      }
      const { inner } = state;
      if (inner) return vfunc(inner, 0, ["ptr", "ptr"])(inner, riid, out);
      writePointer(out, 0);
      return E_NOINTERFACE;
    },
    { args: ["ptr", "ptr", "ptr"], returns: "i32" },
  );
  const addRefSlot = new JSCallback(
    self => {
      const entry = comObjects.get(Number(self));
      return entry ? ++entry.state.refs : 1;
    },
    { args: ["ptr"], returns: "u32" },
  );
  const releaseSlot = new JSCallback(
    self => {
      const entry = comObjects.get(Number(self));
      if (!entry) return 0;
      const { state } = entry;
      if (--state.refs === 0) {
        for (const [, address] of state.tearOffs) comObjects.delete(address);
        setImmediate(() => {
          for (const callback of state.callbacks) callback.close();
        });
      }
      return state.refs;
    },
    { args: ["ptr"], returns: "u32" },
  );
  unknownSlots = [queryInterfaceSlot, addRefSlot, releaseSlot];
  return unknownSlots;
}

// forward(slot, args): a vtable slot that calls the same slot on the aggregated inner object.
function forward(slot, args, returns = "i32") {
  return { forward: slot, args, returns };
}

// IInspectable slots 3..5 (GetIids, GetRuntimeClassName, GetTrustLevel): forwarded to the aggregated inner
// object when there is one, otherwise no IIDs, no class name and BaseTrust.
function inspectableSlots(state) {
  const callInner = (slot, values) =>
    vfunc(
      state.inner,
      slot,
      values.map(() => "ptr"),
    )(state.inner, ...values);
  return [
    {
      args: ["ptr", "ptr"],
      fn: (count, iids) => {
        if (state.inner) return callInner(3, [count, iids]);
        new Uint32Array(toArrayBuffer(count, 0, 4))[0] = 0;
        writePointer(iids, 0);
        return 0;
      },
    },
    {
      args: ["ptr"],
      fn: name => (state.inner ? callInner(4, [name]) : (writePointer(name, 0), 0)),
    },
    {
      args: ["ptr"],
      fn: level => (state.inner ? callInner(5, [level]) : ((new Int32Array(toArrayBuffer(level, 0, 4))[0] = 0), 0)),
    },
  ];
}

// comObject(interfaces[, inner]): interfaces is [{ iids: [iid...], methods: [slot...], inspectable? }], the first
// entry being the identity. WinRT interfaces (inspectable, the default) get the IInspectable slots before their
// methods; delegates pass inspectable: false. A slot is { fn, args, returns } (fn receives the arguments after
// `this`) or forward(slot, args). Unknown IIDs go to `inner` (composition, see setInner), else E_NOINTERFACE.
interface ComState {
  refs: number;
  tearOffs: [Uint8Array[], number][];
  callbacks: { close(): void; ptr: number | null }[];
  inner: number;
  memory?: ArrayBuffer;
  innerWrapper?: unknown;
  kept?: unknown[];
}

function comObject(interfaces, inner?) {
  const [queryInterfaceSlot, addRefSlot, releaseSlot] = iunknown();
  const state: ComState = {
    refs: 1,
    tearOffs: [],
    callbacks: [],
    inner: inner ?? 0,
    memory: undefined,
  };
  interfaces = interfaces.map(desc =>
    desc.inspectable === false ? desc : { ...desc, methods: [...inspectableSlots(state), ...desc.methods] },
  );
  const sizes = interfaces.map(i => 3 + i.methods.length);
  const memory = new ArrayBuffer(8 * (interfaces.length + sizes.reduce((a, b) => a + b, 0)));
  state.memory = memory;
  const selves = new BigUint64Array(memory, 0, interfaces.length);
  let offset = 8 * interfaces.length;
  interfaces.forEach((desc, index) => {
    const vtable = new BigUint64Array(memory, offset, sizes[index]);
    offset += 8 * sizes[index];
    vtable[0] = BigInt(queryInterfaceSlot.ptr);
    vtable[1] = BigInt(addRefSlot.ptr);
    vtable[2] = BigInt(releaseSlot.ptr);
    desc.methods.forEach((method, i) => {
      const slot = 3 + i;
      const callback =
        method.forward !== undefined
          ? new JSCallback(
              (_self, ...values) => vfunc(state.inner, method.forward, method.args)(state.inner, ...values),
              {
                args: ["ptr", ...method.args],
                returns: method.returns,
              },
            )
          : new JSCallback((_self, ...values) => method.fn(...values), {
              args: ["ptr", ...method.args],
              returns: method.returns ?? "i32",
            });
      state.callbacks.push(callback);
      vtable[slot] = BigInt(callback.ptr!);
    });
    selves[index] = BigInt(ptr(vtable));
  });
  interfaces.forEach((desc, index) => {
    const address = ptr(selves) + 8 * index;
    const iids = desc.iids.map(iid => (typeof iid === "string" ? guid(iid) : iid));
    if (index === 0) iids.push(IID_IUNKNOWN);
    if (index === 0 && desc.inspectable !== false) iids.push(IID_IINSPECTABLE);
    state.tearOffs.push([iids, address]);
    comObjects.set(address, { state });
  });
  const address = ptr(selves);
  let released = false;
  return {
    ptr: address,
    tearOff(iid) {
      const bytes = guid(iid);
      const found = state.tearOffs.find(([iids]) => iids.some(b => b.every((v, i) => v === bytes[i])));
      return found ? found[1] : 0;
    },
    // The outer owns the inner object for its whole life: keep the wrapper (and its reference) reachable.
    setInner(object) {
      state.innerWrapper = object;
      state.inner = toPointer(object);
    },
    // Objects whose lifetime must follow this one (forwarding targets such as a metadata provider).
    keep(...objects) {
      (state.kept ??= []).push(...objects);
    },
    get refs() {
      return state.refs;
    },
    release() {
      if (released) return;
      released = true;
      vfunc(address, 2, [])(address);
    },
  };
}

function argumentOf(kind, type, value) {
  switch (kind) {
    case "hstring":
      return readHString(value, false);
    case "prim":
      return value;
    case "class":
      return wrapBorrowed(value, registry.classes.get(type)?.defaultInterface, type);
    case "iface":
      return wrapBorrowed(value, type, undefined);
    default:
      return wrapBorrowed(value, registry.interfaces.has(type) ? type : undefined, undefined);
  }
}

function delegateParams(type) {
  const [generic, ...args] = type;
  const param = t =>
    t === "Object"
      ? ["object", ""]
      : registry.classes.has(t)
        ? ["class", t]
        : registry.interfaces.has(t)
          ? ["iface", t]
          : PRIMITIVE_SIGNATURE[t]
            ? ["prim", t]
            : ["object", t];
  const name = String(generic).replace(/`\d+$/, "");
  if (name === "TypedEventHandler") return args.map(param);
  if (name === "EventHandler") return [["object", ""], ...args.map(param)];
  throw new TypeError(`params are required for the generic delegate ${generic}`);
}

// delegate(type, fn[, params]): a COM delegate whose Invoke calls fn with wrapped arguments. type is a
// delegate from a loaded family ("Microsoft.UI.Xaml.RoutedEventHandler") or a generic delegate such as
// ["TypedEventHandler", "Object", "Microsoft.UI.Xaml.WindowEventArgs"]. params: [kind, type] per argument.
function delegate(type, fn, params?) {
  const desc = Array.isArray(type) ? undefined : registry.delegates.get(type);
  if (!desc && !Array.isArray(type))
    throw new TypeError(`WinRT delegate ${type} is not loaded; require its namespace family first`);
  const iid = desc ? desc.iid : iidOf(type);
  params ??= desc ? desc.params : delegateParams(type);
  const invoke = {
    args: params.map(([kind, t]) => (kind === "prim" ? FFI[t] : "ptr")),
    returns: "i32",
    fn(...values) {
      try {
        const result = fn(...values.map((value, i) => argumentOf(params[i][0], params[i][1], value)));
        if (result && typeof result.then === "function") result.then(undefined, reportError);
        return 0;
      } catch (error) {
        reportError(error);
        return E_FAIL;
      }
    },
  };
  return Object.assign(comObject([{ iids: [iid, IID_IAGILEOBJECT], methods: [invoke], inspectable: false }]), { iid });
}

// Metadata read at run time from a .winmd (a framework package's own metadata, or System32\WinMetadata),
// cached as JSON per file size and mtime so later runs skip the parse.
const loadedMetadata = new Map();

function loadMetadata(path, options?) {
  const fs = require("node:fs");
  const stat = fs.statSync(path);
  const key = `${path}|${stat.size}|${stat.mtimeMs}`;
  let exports = loadedMetadata.get(key);
  if (exports) return exports;
  let model: Record<string, WinrtNamespace> | undefined;
  const cacheDir =
    options?.cache === false ? undefined : require("node:path").join(require("node:os").tmpdir(), "bun-winrt-metadata");
  const cacheFile = cacheDir && require("node:path").join(cacheDir, `${Bun.hash(key).toString(16)}.json`);
  if (cacheFile) {
    try {
      model = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {}
  }
  if (!model) {
    model = Object.fromEntries(winmd.winrtModel(new Uint8Array(fs.readFileSync(path))));
    if (cacheFile) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(`${cacheFile}.${process.pid}`, JSON.stringify(model));
        fs.renameSync(`${cacheFile}.${process.pid}`, cacheFile);
      } catch {}
    }
  }
  exports = {};
  for (const [namespace, data] of Object.entries(model)) exports[namespace] = defineNamespace({ namespace, ...data });
  loadedMetadata.set(key, exports);
  return exports;
}

// systemMetadata("Windows.Foundation"): the namespace from C:\Windows\System32\WinMetadata\<prefix>.winmd.
function systemMetadata(namespace) {
  const path = require("node:path");
  const dir = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WinMetadata");
  const parts = namespace.split(".");
  for (let n = parts.length; n >= 2; n--) {
    const file = path.join(dir, `${parts.slice(0, n).join(".")}.winmd`);
    if (require("node:fs").existsSync(file)) {
      const exports = loadMetadata(file)[namespace];
      if (exports) return exports;
    }
  }
  throw new Error(`WinRT namespace ${namespace} has no metadata in ${dir}`);
}

// findMethod("Microsoft.UI.Xaml.Controls.Button", "add_Click") walks the class, its interfaces and base classes.
function findMethod(className, methodName) {
  const { interfaces } = registry;
  if (!registry.classes.has(className) && interfaces.has(className)) {
    const method = interfaces.get(className).methods.find(m => m[0] === methodName);
    return method ? { interfaceName: className, method } : undefined;
  }
  for (let name = className; name;) {
    const desc = registry.classes.get(name);
    if (!desc) break;
    for (let interfaceName of desc.interfaces ?? [desc.defaultInterface]) {
      if (Array.isArray(interfaceName)) {
        if (interfaceName[0] !== "IVector" || interfaceName.length !== 2) continue;
        interfaceName = vectorInterface(interfaceName[1]);
      }
      const method = registry.interfaces.get(interfaceName)?.methods.find(m => m[0] === methodName);
      if (method) return { interfaceName, method };
    }
    name = desc.base;
  }
  return undefined;
}

// callMethod(object, "FindName", "ok"): QueryInterface to the interface declaring the method, then invoke it.
function callMethod(object, methodName, ...values) {
  const className = object.className ?? object.runtimeClassName;
  const found = findMethod(className, methodName);
  if (!found) throw new TypeError(`${className} has no WinRT method ${methodName}`);
  const { interfaceName, method } = found;
  if (object.interfaceName === interfaceName) return invoke(object.ptr, method, values);
  const target = queryInterface(object.ptr, registry.interfaces.get(interfaceName).iid);
  try {
    return invoke(target, method, values);
  } finally {
    vfunc(target, 2, [])(target);
  }
}

function kindOf(type) {
  ensureType(type);
  if (type === "String") return ["hstring", ""];
  if (type === "Object") return ["object", ""];
  if (PRIMITIVE_SIGNATURE[type]) return ["prim", type];
  if (registry.classes.has(type)) return ["class", type];
  if (registry.interfaces.has(type)) return ["iface", type];
  return ["object", type];
}

// IVector<T> / IVectorView<T> described from their well-known ABI and registered as "IVector<T>" / "IVectorView<T>".
function vectorInterface(elementType, view = false) {
  const signature = [view ? "IVectorView" : "IVector", elementType];
  const interfaceName = `${signature[0]}<${elementType}>`;
  const { interfaces } = registry;
  if (!interfaces.has(interfaceName)) {
    const element = kindOf(elementType);
    const u32 = ["prim", "u32"];
    if (view) {
      interfaces.set(interfaceName, {
        iid: iidOf(signature),
        methods: [
          ["GetAt", 6, [["in", ...u32]], element],
          ["get_Size", 7, [], u32],
          [
            "IndexOf",
            8,
            [
              ["in", ...element],
              ["out", ...u32],
            ],
            ["prim", "bool"],
          ],
        ],
      });
      return interfaceName;
    }
    interfaces.set(interfaceName, {
      iid: iidOf(signature),
      methods: [
        ["GetAt", 6, [["in", ...u32]], element],
        ["get_Size", 7, [], u32],
        [
          "IndexOf",
          9,
          [
            ["in", ...element],
            ["out", ...u32],
          ],
          ["prim", "bool"],
        ],
        [
          "SetAt",
          10,
          [
            ["in", ...u32],
            ["in", ...element],
          ],
          null,
        ],
        [
          "InsertAt",
          11,
          [
            ["in", ...u32],
            ["in", ...element],
          ],
          null,
        ],
        ["RemoveAt", 12, [["in", ...u32]], null],
        ["Append", 13, [["in", ...element]], null],
        ["RemoveAtEnd", 14, [], null],
        ["Clear", 15, [], null],
      ],
    });
  }
  return interfaceName;
}

// vector(object, "Microsoft.UI.Xaml.UIElement"): the object's IVector<T> (Panel.Children, ItemCollection...).
function vector(object, elementType) {
  const interfaceName = vectorInterface(elementType);
  const result = wrap(queryInterface(toPointer(object), registry.interfaces.get(interfaceName).iid), interfaceName);
  result[Symbol.iterator] = function* () {
    for (let i = 0, n = result.Size; i < n; i++) yield result.GetAt(i);
  };
  return result;
}

// box(value) / unbox(object): Windows.Foundation.PropertyValue for strings, numbers and booleans.
const IID_IPROPERTYVALUE = "4bd682dd-7554-40e9-9a9b-82654ede7e62";
function box(value) {
  const { PropertyValue } = systemMetadata("Windows.Foundation");
  if (typeof value === "string") return PropertyValue.CreateString(value);
  if (typeof value === "boolean") return PropertyValue.CreateBoolean(value);
  if (typeof value === "number")
    return Number.isInteger(value) && Math.abs(value) <= 0x7fffffff
      ? PropertyValue.CreateInt32(value)
      : PropertyValue.CreateDouble(value);
  if (typeof value === "bigint") return PropertyValue.CreateInt64(value);
  throw new TypeError(`cannot box a ${typeof value} as a WinRT value`);
}

const UNBOX = {
  1: "GetUInt8",
  2: "GetInt16",
  3: "GetUInt16",
  4: "GetInt32",
  5: "GetUInt32",
  6: "GetInt64",
  7: "GetUInt64",
  8: "GetSingle",
  9: "GetDouble",
  10: "GetChar16",
  11: "GetBoolean",
  12: "GetString",
};
function unbox(object) {
  if (!object || typeof object.ptr !== "number") return object;
  systemMetadata("Windows.Foundation");
  const out = new BigUint64Array(1);
  const hr = vfunc(object.ptr, 0, ["ptr", "ptr"])(object.ptr, ptr(guid(IID_IPROPERTYVALUE)), ptr(out));
  if (hr < 0 || !out[0]) return object;
  const value = wrap(Number(out[0]), "Windows.Foundation.IPropertyValue");
  const getter = UNBOX[value.Type];
  return getter ? value[getter]() : object;
}

export default {
  namespace: systemMetadata,
  defineNamespace,
  activationFactory,
  createHString,
  readHString,
  guid,
  wrap,
  wrapBorrowed,
  addRef,
  queryInterface,
  registry,
  init,
  delegate,
  comObject,
  forward,
  toPointer,
  vfunc,
  parameterizedIid,
  signatureOf,
  iidOf,
  hresultError,
  invoke,
  loadMetadata,
  systemMetadata,
  findMethod,
  callMethod,
  vector,
  box,
  unbox,
  WinRTObject,
};

export {
  systemMetadata as namespace,
  defineNamespace,
  activationFactory,
  createHString,
  readHString,
  guid,
  wrap,
  wrapBorrowed,
  addRef,
  queryInterface,
  registry,
  init,
  delegate,
  comObject,
  forward,
  toPointer,
  vfunc,
  parameterizedIid,
  signatureOf,
  iidOf,
  hresultError,
  invoke,
  loadMetadata,
  systemMetadata,
  findMethod,
  callMethod,
  vector,
  box,
  unbox,
  WinRTObject,
};
