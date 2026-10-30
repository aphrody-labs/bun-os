// D3D12HelloWindow, headless subset through bun:ffi: raw COM vtable calls on a WARP device. Prints "OK r,g,b,a".
// Vtable slots follow d3d12.h / dxgi1_4.h; GUIDs are the public IIDs.
import { CFunction, dlopen, FFIType, ptr, read, toArrayBuffer } from "bun:ffi";

const { CreateDXGIFactory1 } = dlopen("dxgi.dll", { CreateDXGIFactory1: { args: ["ptr", "ptr"], returns: "i32" } }).symbols;
const { D3D12CreateDevice } = dlopen("d3d12.dll", { D3D12CreateDevice: { args: ["ptr", "i32", "ptr", "ptr"], returns: "i32" } }).symbols;

const guid = (s: string) => {
  const b = Buffer.alloc(16);
  const h = s.replace(/-/g, "");
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), "hex").copy(b, 8);
  return b;
};
const IID = {
  factory4: guid("1bc6ea02-ef36-464f-bf0c-21ca39e5168a"),
  adapter: guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"),
  device: guid("189819f1-1db6-4b57-be54-1821339b85f7"),
  queue: guid("0ec870a6-5d7e-4c22-8cfc-5baae07616ed"),
  allocator: guid("6102dee4-af59-4b09-b999-b44d73f09b24"),
  list: guid("5b160d0f-ac1b-4185-8ba8-b3ae42a5a455"),
  resource: guid("696442be-a72e-4059-bc79-5b5c98040fad"),
  heap: guid("8efb471d-616c-4f49-90f7-127bb763fa51"),
  fence: guid("0a753dcf-c4d8-4b91-adf6-be5a60d95a76"),
};

const fail = (m: string): never => { console.log(`FAIL ${m}`); process.exit(1); };
const hr = (code: number, what: string) => { if (code < 0) fail(`${what} 0x${(code >>> 0).toString(16).padStart(8, "0")}`); };

type T = "ptr" | "i32" | "u32" | "u64" | "void";
const cache = new Map<string, ReturnType<typeof CFunction>>();
/** Call vtable slot `slot` of COM object `obj` with `args` (the `this` pointer is added). */
function com(obj: bigint | number, slot: number, args: T[], ret: T, ...values: unknown[]): any {
  const vtbl = read.ptr(obj as any, 0) as any;
  const fn = read.ptr(vtbl, slot * 8) as any;
  const key = `${fn}:${args}:${ret}`;
  let f = cache.get(key);
  if (!f) { f = CFunction({ ptr: fn, args: ["ptr", ...args] as any, returns: ret as any }); cache.set(key, f); }
  return (f as any)(obj, ...values);
}
const out = () => { const b = new BigUint64Array(1); return { b, p: ptr(b) }; };

let o = out();
hr(CreateDXGIFactory1(ptr(IID.factory4), o.p), "CreateDXGIFactory1");
const factory = o.b[0]!;
o = out();
hr(com(factory, 27, ["ptr", "ptr"], "i32", ptr(IID.adapter), o.p), "EnumWarpAdapter");
const warp = o.b[0]!;
o = out();
hr(D3D12CreateDevice(Number(warp) as any, 0xb000, ptr(IID.device), o.p), "D3D12CreateDevice");
const device = o.b[0]!;

// Device slots (ID3D12Device derives from ID3D12Object, not DeviceChild): CreateCommandQueue 8, CreateCommandAllocator 9, CreateCommandList 12,
// CreateDescriptorHeap 14, CreateRenderTargetView 20, CreateCommittedResource 27, CreateFence 36.
const qd = new Uint32Array(4); // Type DIRECT(0), Priority, Flags, NodeMask
o = out();
hr(com(device, 8, ["ptr", "ptr", "ptr"], "i32", ptr(qd), ptr(IID.queue), o.p), "CreateCommandQueue");
const queue = o.b[0]!;
o = out();
hr(com(device, 9, ["i32", "ptr", "ptr"], "i32", 0, ptr(IID.allocator), o.p), "CreateCommandAllocator");
const alloc = o.b[0]!;
o = out();
hr(com(device, 12, ["u32", "i32", "ptr", "ptr", "ptr", "ptr"], "i32", 0, 0, Number(alloc), null, ptr(IID.list), o.p), "CreateCommandList");
const list = o.b[0]!;

const heapProps = (type: number) => new Uint32Array([type, 0, 0, 1, 1]);
// D3D12_RESOURCE_DESC (56 bytes): Dimension@0 Alignment@8 Width@16 Height@24 DepthOrArraySize@28 MipLevels@30 Format@32 SampleDesc@36 Layout@44 Flags@48
function resDesc(dim: number, width: bigint, height: number, format: number, layout: number, flags: number) {
  const b = new DataView(new ArrayBuffer(56));
  b.setInt32(0, dim, true); b.setBigUint64(16, width, true); b.setUint32(24, height, true);
  b.setUint16(28, 1, true); b.setUint16(30, 1, true); b.setInt32(32, format, true); b.setUint32(36, 1, true);
  b.setInt32(44, layout, true); b.setInt32(48, flags, true);
  return new Uint8Array(b.buffer);
}
function committed(type: number, desc: Uint8Array, state: number) {
  const hp = heapProps(type);
  const r = out();
  hr(com(device, 27, ["ptr", "i32", "ptr", "i32", "ptr", "ptr", "ptr"], "i32", ptr(hp), 0, ptr(desc), state, null, ptr(IID.resource), r.p), "CreateCommittedResource");
  return r.b[0]!;
}
const rt = committed(1, resDesc(3, 64n, 64, 28, 0, 1), 0x4); // DEFAULT heap, TEXTURE2D RGBA8, ALLOW_RENDER_TARGET, state RENDER_TARGET
const readback = committed(3, resDesc(1, 256n * 64n, 1, 0, 1, 0), 0x400); // READBACK heap, BUFFER, ROW_MAJOR, COPY_DEST

o = out();
hr(com(device, 14, ["ptr", "ptr", "ptr"], "i32", ptr(new Uint32Array([2, 1, 0, 0])), ptr(IID.heap), o.p), "CreateDescriptorHeap"); // RTV x1
const rtvHeap = o.b[0]!;
const hbuf = new BigUint64Array(1);
com(rtvHeap, 9, ["ptr"], "ptr", ptr(hbuf)); // GetCPUDescriptorHandleForHeapStart returns the handle through the hidden pointer
const rtv = hbuf[0]!;
com(device, 20, ["ptr", "ptr", "u64"], "void", Number(rt), null, rtv);

// List slots: Close 9, CopyTextureRegion 16, ResourceBarrier 26, ClearRenderTargetView 48. Queue: ExecuteCommandLists 10, Signal 14.
com(list, 48, ["u64", "ptr", "u32", "ptr"], "void", rtv, ptr(new Float32Array([0, 0.2, 0.4, 1])), 0, null);
const barrier = new DataView(new ArrayBuffer(32)); // Type TRANSITION(0), Flags, pResource@8, Subresource@16, Before@20, After@24
barrier.setBigUint64(8, rt, true); barrier.setUint32(16, 0xffffffff, true); barrier.setUint32(20, 0x4, true); barrier.setUint32(24, 0x800, true);
com(list, 26, ["u32", "ptr"], "void", 1, ptr(new Uint8Array(barrier.buffer)));
const dst = new DataView(new ArrayBuffer(48)); // PLACED_FOOTPRINT: Offset@16 Format@24 Width@28 Height@32 Depth@36 RowPitch@40
dst.setBigUint64(0, readback, true); dst.setInt32(8, 1, true); dst.setInt32(24, 28, true);
dst.setUint32(28, 64, true); dst.setUint32(32, 64, true); dst.setUint32(36, 1, true); dst.setUint32(40, 256, true);
const src = new DataView(new ArrayBuffer(48)); // SUBRESOURCE_INDEX 0
src.setBigUint64(0, rt, true);
com(list, 16, ["ptr", "u32", "u32", "u32", "ptr", "ptr"], "void", ptr(new Uint8Array(dst.buffer)), 0, 0, 0, ptr(new Uint8Array(src.buffer)), null);
hr(com(list, 9, [], "i32"), "Close");
com(queue, 10, ["u32", "ptr"], "void", 1, ptr(new BigUint64Array([list])));

o = out();
hr(com(device, 36, ["u64", "i32", "ptr", "ptr"], "i32", 0n, 0, ptr(IID.fence), o.p), "CreateFence");
const fence = o.b[0]!;
hr(com(queue, 14, ["ptr", "u64"], "i32", Number(fence), 1n), "Signal");
const deadline = Date.now() + 30_000;
while (BigInt(com(fence, 8, [], "u64")) < 1n) {
  if (Date.now() > deadline) fail("fence timeout");
  await Bun.sleep(0);
}

const mapped = out();
hr(com(readback, 8, ["u32", "ptr", "ptr"], "i32", 0, ptr(new BigUint64Array([0n, 256n * 64n])), mapped.p), "Map");
const px = new Uint8Array(toArrayBuffer(Number(mapped.b[0]!) as any, 0, 4));
const pixel = [px[0], px[1], px[2], px[3]];
com(readback, 9, ["u32", "ptr"], "void", 0, null);
if (pixel.join() === "0,51,102,255") console.log("OK 0,51,102,255");
else fail(`pixel ${pixel}`);
