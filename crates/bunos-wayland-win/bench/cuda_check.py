# SPDX-License-Identifier: Apache-2.0
"""CUDA driver-API check without the toolkit: JIT a PTX saxpy kernel through libcuda (WSL user-mode driver), run it on
the GPU, verify the result, and time host<->device copies and the kernel."""
import ctypes as C, struct, time, sys

cu = C.CDLL("/usr/lib/wsl/lib/libcuda.so.1")

def ok(r, what):
    if r != 0:
        s = C.c_char_p()
        cu.cuGetErrorString(r, C.byref(s))
        sys.exit(f"{what}: {r} {s.value}")

ok(cu.cuInit(0), "cuInit")
ver = C.c_int(); ok(cu.cuDriverGetVersion(C.byref(ver)), "version")
dev = C.c_int(); ok(cu.cuDeviceGet(C.byref(dev), 0), "device")
name = C.create_string_buffer(128); ok(cu.cuDeviceGetName(name, 128, dev), "name")
mem = C.c_size_t(); ok(cu.cuDeviceTotalMem_v2(C.byref(mem), dev), "mem")
maj, mnr = C.c_int(), C.c_int()
cu.cuDeviceGetAttribute(C.byref(maj), 75, dev); cu.cuDeviceGetAttribute(C.byref(mnr), 76, dev)
sms = C.c_int(); cu.cuDeviceGetAttribute(C.byref(sms), 16, dev)
print(f"driver CUDA {ver.value//1000}.{ver.value%1000//10}, {name.value.decode()}, sm_{maj.value}{mnr.value}, "
      f"{sms.value} SMs, {mem.value/2**30:.1f} GiB")

ctx = C.c_void_p(); ok(cu.cuCtxCreate_v2(C.byref(ctx), 0, dev), "ctx")

ptx = b"""
.version 7.0
.target sm_52
.address_size 64
.visible .entry saxpy(.param .u64 x, .param .u64 y, .param .f32 a, .param .u32 n) {
  .reg .pred p; .reg .b32 i, nn, t0, t1, t2; .reg .b64 px, py, off; .reg .f32 fa, fx, fy;
  ld.param.u64 px, [x]; ld.param.u64 py, [y]; ld.param.f32 fa, [a]; ld.param.u32 nn, [n];
  mov.u32 t0, %ctaid.x; mov.u32 t1, %ntid.x; mov.u32 t2, %tid.x; mad.lo.u32 i, t0, t1, t2;
  setp.ge.u32 p, i, nn; @p ret;
  cvta.to.global.u64 px, px; cvta.to.global.u64 py, py;
  mul.wide.u32 off, i, 4; add.u64 px, px, off; add.u64 py, py, off;
  ld.global.f32 fx, [px]; ld.global.f32 fy, [py]; fma.rn.f32 fy, fa, fx, fy; st.global.f32 [py], fy;
  ret;
}
"""
mod = C.c_void_p(); ok(cu.cuModuleLoadData(C.byref(mod), ptx), "module (PTX JIT)")
fn = C.c_void_p(); ok(cu.cuModuleGetFunction(C.byref(fn), mod, b"saxpy"), "function")

n = 1 << 26  # 64 Mi floats = 256 MiB per buffer
nbytes = n * 4
hx = (C.c_float * n)(); hy = (C.c_float * n)()
for i in range(0, n, 4096):
    hx[i] = 1.0; hy[i] = 2.0
dx, dy = C.c_uint64(), C.c_uint64()
ok(cu.cuMemAlloc_v2(C.byref(dx), C.c_size_t(nbytes)), "alloc x"); ok(cu.cuMemAlloc_v2(C.byref(dy), C.c_size_t(nbytes)), "alloc y")
t = time.perf_counter()
ok(cu.cuMemcpyHtoD_v2(dx, hx, C.c_size_t(nbytes)), "h2d"); ok(cu.cuMemcpyHtoD_v2(dy, hy, C.c_size_t(nbytes)), "h2d")
h2d = 2 * nbytes / (time.perf_counter() - t) / 1e9

a = C.c_float(3.0); nn = C.c_uint32(n)
params = (C.c_void_p * 4)(C.cast(C.byref(dx), C.c_void_p), C.cast(C.byref(dy), C.c_void_p),
                          C.cast(C.byref(a), C.c_void_p), C.cast(C.byref(nn), C.c_void_p))
block = 256; grid = (n + block - 1) // block
ok(cu.cuLaunchKernel(fn, grid, 1, 1, block, 1, 1, 0, None, params, None), "launch warm-up")
ok(cu.cuCtxSynchronize(), "sync")
# undo warm-up effect on y so the check is exact: y = 3*1+2 = 5 after warm-up; one more launch -> 8
reps = 20
t = time.perf_counter()
for _ in range(reps):
    ok(cu.cuLaunchKernel(fn, grid, 1, 1, block, 1, 1, 0, None, params, None), "launch")
ok(cu.cuCtxSynchronize(), "sync")
dt = (time.perf_counter() - t) / reps
t = time.perf_counter()
ok(cu.cuMemcpyDtoH_v2(hy, dy, C.c_size_t(nbytes)), "d2h")
d2h = nbytes / (time.perf_counter() - t) / 1e9
expect = 2.0 + 3.0 * (reps + 1)
bad = sum(1 for i in range(0, n, 4096) if hy[i] != expect)
print(f"saxpy over {n} floats: {dt*1e3:.2f} ms/launch, {3*nbytes/dt/1e9:.0f} GB/s effective; "
      f"H2D {h2d:.1f} GB/s, D2H {d2h:.1f} GB/s; check {'PASS' if bad == 0 else f'FAIL ({bad} wrong)'} (y={hy[0]}, expected {expect})")
