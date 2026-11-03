// SPDX-License-Identifier: Apache-2.0
// Free-threaded COM delegates on upstream Bun, replacing the aphrody-labs/bun fork's native
// `src/runtime/windows/com.rs` (`jsComDelegate`, reached through `$newRustFunction`).
//
// A delegate is a COM object with one callback interface: IUnknown plus Invoke at vtable slot 3. WinRT calls it
// from any thread (the completion of an IAsync* operation arrives on a thread-pool thread), so IUnknown must answer
// synchronously off the JS thread. A JSCallback cannot do that, so the four slots are 138 bytes of x86-64 machine
// code (assembled from the listing below) copied once into an executable page; only Invoke and the final Release
// reach JavaScript, through one `threadsafe` JSCallback per delegate, which queues the call on the JS thread.
//
// Object layout (72 bytes, process heap):
//   +0 vtable  +8 refcount (u32, atomic)  +16 delegate IID  +32 IID_IUnknown  +48 IID_IAgileObject  +64 callback
//
//   QueryInterface(this, riid, out)  out=this and refcount++ for the three IIDs, else *out=0, E_NOINTERFACE
//   AddRef(this)                     lock xadd +1, returns the new count
//   Release(this)                    lock xadd -1; at zero tail-calls callback(0, 0, 0, 0, _) (destroy)
//   Invoke(this, a, b, c, d)         refcount++ (owned by the queued call), tail-calls callback(this, a, b, c, d)
import { CFunction, dlopen, FFIType, JSCallback, ptr, read, toArrayBuffer, type Pointer } from "bun:ffi";

// prettier-ignore
const CODE = new Uint8Array([
  // QueryInterface (0x00)
  0x4d, 0x85, 0xc0, 0x74, 0x32, 0x4c, 0x8b, 0x0a, 0x4c, 0x8b, 0x52, 0x08, 0x4c, 0x3b, 0x49, 0x10, 0x75, 0x06, 0x4c,
  0x3b, 0x51, 0x18, 0x74, 0x25, 0x4c, 0x3b, 0x49, 0x20, 0x75, 0x06, 0x4c, 0x3b, 0x51, 0x28, 0x74, 0x19, 0x4c, 0x3b,
  0x49, 0x30, 0x75, 0x06, 0x4c, 0x3b, 0x51, 0x38, 0x74, 0x0d, 0x49, 0xc7, 0x00, 0x00, 0x00, 0x00, 0x00, 0xb8, 0x02,
  0x40, 0x00, 0x80, 0xc3, 0x49, 0x89, 0x08, 0xf0, 0xff, 0x41, 0x08, 0x31, 0xc0, 0xc3, 0x66, 0x0f, 0x1f, 0x84, 0x00,
  0x00, 0x00, 0x00, 0x00,
  // AddRef (0x50)
  0xb8, 0x01, 0x00, 0x00, 0x00, 0xf0, 0x0f, 0xc1, 0x41, 0x08, 0xff, 0xc0, 0xc3, 0x0f, 0x1f, 0x00,
  // Release (0x60)
  0xb8, 0xff, 0xff, 0xff, 0xff, 0xf0, 0x0f, 0xc1, 0x41, 0x08, 0xff, 0xc8, 0x75, 0x10, 0x48, 0x8b, 0x41, 0x40, 0x31,
  0xc9, 0x31, 0xd2, 0x45, 0x31, 0xc0, 0x45, 0x31, 0xc9, 0xff, 0xe0, 0xc3, 0x90,
  // Invoke (0x80)
  0xf0, 0xff, 0x41, 0x08, 0x48, 0x8b, 0x41, 0x40, 0xff, 0xe0,
]);
const SLOTS = [0x00, 0x50, 0x60, 0x80];
const VTABLE_OFFSET = 0x90;
const OBJECT_SIZE = 72;

const IID_IUNKNOWN = "00000000-0000-0000-c000-000000000046";
const IID_IAGILEOBJECT = "94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90";

let kernel: ReturnType<typeof loadKernel> | undefined;
function loadKernel() {
  return dlopen("kernel32.dll", {
    VirtualAlloc: { args: ["ptr", "u64", "u32", "u32"], returns: "ptr" },
    VirtualProtect: { args: ["ptr", "u64", "u32", "ptr"], returns: "i32" },
    FlushInstructionCache: { args: ["u64", "ptr", "u64"], returns: "i32" },
    GetCurrentProcess: { args: [], returns: "u64" },
    GetProcessHeap: { args: [], returns: "u64" },
    HeapAlloc: { args: ["u64", "u32", "u64"], returns: "ptr" },
    HeapFree: { args: ["u64", "u32", "ptr"], returns: "i32" },
  }).symbols;
}

let vtable: number | undefined;
function stubs(): number {
  if (vtable !== undefined) return vtable;
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("COM delegates need Windows on x86-64 (the IUnknown stubs are x86-64 machine code)");
  kernel ??= loadKernel();
  const MEM_COMMIT_RESERVE = 0x3000;
  const PAGE_READWRITE = 0x04;
  const PAGE_EXECUTE_READ = 0x20;
  const page = kernel.VirtualAlloc(null, 4096, MEM_COMMIT_RESERVE, PAGE_READWRITE);
  if (!page) throw new Error("VirtualAlloc failed for the COM delegate stubs");
  const memory = new Uint8Array(toArrayBuffer(page, 0, 4096));
  memory.set(CODE, 0);
  const table = new BigUint64Array(toArrayBuffer(page, VTABLE_OFFSET, 8 * SLOTS.length));
  SLOTS.forEach((offset, i) => (table[i] = BigInt(page) + BigInt(offset)));
  const old = new Uint32Array(1);
  if (!kernel.VirtualProtect(page, 4096, PAGE_EXECUTE_READ, ptr(old)))
    throw new Error("VirtualProtect failed for the COM delegate stubs");
  kernel.FlushInstructionCache(kernel.GetCurrentProcess(), page, CODE.length);
  vtable = Number(page) + VTABLE_OFFSET;
  return vtable;
}

function guidBytes(text: string | Uint8Array): Uint8Array {
  if (text instanceof Uint8Array) {
    if (text.byteLength !== 16) throw new TypeError("a GUID is 16 bytes");
    return text;
  }
  const m = /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i.exec(text);
  if (!m) throw new TypeError(`invalid GUID: ${text}`);
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, parseInt(m[1]!, 16), true);
  view.setUint16(4, parseInt(m[2]!, 16), true);
  view.setUint16(6, parseInt(m[3]!, 16), true);
  const tail = m[4]! + m[5]!;
  for (let i = 0; i < 8; i++) bytes[8 + i] = parseInt(tail.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

let liveDelegates = 0;
let keepAlive: ReturnType<typeof setInterval> | undefined;

/** Delegates created and not yet destroyed by their final Release. */
export function live(): number {
  return liveDelegates;
}

export type DelegateHandler = (a: number, b: number, c: number, d: number) => unknown;

/**
 * A free-threaded COM delegate implementing `iid` (IUnknown + Invoke). `handler(a, b, c, d)` runs on the JS thread
 * with the raw Invoke arguments (pointer-sized integers). Returns the object address with one reference owned by
 * the caller (give it to the producer, then {@link release} it). The process stays alive while a delegate lives.
 */
export function delegate(iid: string | Uint8Array, handler: DelegateHandler): number {
  if (typeof handler !== "function") throw new TypeError("handler must be a function");
  const table = stubs();
  const heap = kernel!.GetProcessHeap();
  const HEAP_ZERO_MEMORY = 0x08;
  const object = kernel!.HeapAlloc(heap, HEAP_ZERO_MEMORY, OBJECT_SIZE);
  if (!object) throw new Error("HeapAlloc failed for a COM delegate");
  const address = Number(object);
  const words = new BigUint64Array(toArrayBuffer(object, 0, OBJECT_SIZE));
  const bytes = new Uint8Array(words.buffer, words.byteOffset, OBJECT_SIZE);
  let callback: JSCallback | undefined;
  callback = new JSCallback(
    (self: number | null, a: number, b: number, c: number, d: number) => {
      if (!self) {
        // Final Release: no further Invoke can reach this delegate.
        const closing = callback;
        callback = undefined;
        if (--liveDelegates === 0 && keepAlive !== undefined) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
        setImmediate(() => {
          closing?.close();
          kernel!.HeapFree(heap, 0, object);
        });
        return 0;
      }
      try {
        handler(a, b, c, d);
      } finally {
        release(self);
      }
      return 0;
    },
    {
      args: ["ptr", FFIType.u64_fast, FFIType.u64_fast, FFIType.u64_fast, FFIType.u64_fast],
      returns: "i32",
      threadsafe: true,
    },
  );
  words[0] = BigInt(table);
  new Uint32Array(words.buffer, words.byteOffset + 8, 1)[0] = 1;
  bytes.set(guidBytes(iid), 16);
  bytes.set(guidBytes(IID_IUNKNOWN), 32);
  bytes.set(guidBytes(IID_IAGILEOBJECT), 48);
  words[8] = BigInt(callback.ptr as unknown as number);
  if (liveDelegates++ === 0) keepAlive = setInterval(() => {}, 0x7fffffff);
  return address;
}

const releaseCalls = new Map<number, (self: number) => number>();

/** IUnknown::Release on any COM object; returns the new reference count. */
export function release(object: number | Pointer): number {
  if (!object) return 0;
  const slot = Number(read.ptr(read.ptr(object as Pointer, 0) as unknown as Pointer, 16));
  let call = releaseCalls.get(slot);
  if (!call) {
    call = CFunction({ ptr: slot as unknown as Pointer, args: ["ptr"], returns: "u32" }) as unknown as (
      self: number,
    ) => number;
    releaseCalls.set(slot, call);
  }
  return call(Number(object));
}

export default { delegate, release, live };
