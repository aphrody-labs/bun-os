#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// DirectX 12 GPU check for the Bun OS WSL distro (docs/WSL.md, "DirectX 12"). Needs no display: OpenGL ES runs
// on a surfaceless EGL context through bun:ffi and renders into an offscreen 1920x1080 framebuffer, and Vulkan,
// OpenCL and VA-API are probed headless. Prints one JSON report.
//
//   bun factory/wsl/gpu-check.ts            d3d12 GL + llvmpipe GL, Dozen (vkmark headless), rusticl, VA-API
//   bun factory/wsl/gpu-check.ts --gl-only  (internal) one GL run in this process's environment
import { CString, dlopen, FFIType, ptr } from "bun:ffi";

const W = 1920;
const H = 1080;
const SECONDS = Number(Bun.env.GPU_CHECK_SECONDS ?? 4);

function gl() {
  const egl = dlopen("libEGL.so.1", {
    eglGetPlatformDisplay: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    eglInitialize: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    eglBindAPI: { args: [FFIType.u32], returns: FFIType.u32 },
    eglCreateContext: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    eglMakeCurrent: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    eglGetError: { args: [], returns: FFIType.i32 },
  }).symbols;
  const g = dlopen("libGLESv2.so.2", {
    glGetString: { args: [FFIType.u32], returns: FFIType.ptr },
    glGenTextures: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.void },
    glBindTexture: { args: [FFIType.u32, FFIType.u32], returns: FFIType.void },
    glTexStorage2D: { args: [FFIType.u32, FFIType.i32, FFIType.u32, FFIType.i32, FFIType.i32], returns: FFIType.void },
    glGenFramebuffers: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.void },
    glBindFramebuffer: { args: [FFIType.u32, FFIType.u32], returns: FFIType.void },
    glFramebufferTexture2D: {
      args: [FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.i32],
      returns: FFIType.void,
    },
    glCheckFramebufferStatus: { args: [FFIType.u32], returns: FFIType.u32 },
    glCreateShader: { args: [FFIType.u32], returns: FFIType.u32 },
    glShaderSource: { args: [FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    glCompileShader: { args: [FFIType.u32], returns: FFIType.void },
    glGetShaderiv: { args: [FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
    glCreateProgram: { args: [], returns: FFIType.u32 },
    glAttachShader: { args: [FFIType.u32, FFIType.u32], returns: FFIType.void },
    glLinkProgram: { args: [FFIType.u32], returns: FFIType.void },
    glGetProgramiv: { args: [FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
    glUseProgram: { args: [FFIType.u32], returns: FFIType.void },
    glGetUniformLocation: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    glUniform1f: { args: [FFIType.i32, FFIType.f32], returns: FFIType.void },
    glViewport: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.void },
    glDrawArrays: { args: [FFIType.u32, FFIType.i32, FFIType.i32], returns: FFIType.void },
    glFlush: { args: [], returns: FFIType.void },
    glFinish: { args: [], returns: FFIType.void },
  }).symbols;

  const dpy = egl.eglGetPlatformDisplay(0x31dd /* EGL_PLATFORM_SURFACELESS_MESA */, null, null);
  if (!dpy || !egl.eglInitialize(dpy, null, null)) throw new Error(`eglInitialize failed: 0x${egl.eglGetError().toString(16)}`);
  egl.eglBindAPI(0x30a0 /* EGL_OPENGL_ES_API */);
  const attrs = new Int32Array([0x3098 /* EGL_CONTEXT_MAJOR_VERSION */, 3, 0x3038 /* EGL_NONE */]);
  const ctx = egl.eglCreateContext(dpy, null /* EGL_NO_CONFIG_KHR */, null, attrs);
  if (!ctx || !egl.eglMakeCurrent(dpy, null, null, ctx))
    throw new Error(`surfaceless GLES 3 context failed: 0x${egl.eglGetError().toString(16)}`);
  const str = (name: number) => new CString(g.glGetString(name)!).toString();

  const ids = new Uint32Array(2);
  g.glGenTextures(1, ids);
  g.glBindTexture(0x0de1, ids[0]);
  g.glTexStorage2D(0x0de1, 1, 0x8058 /* RGBA8 */, W, H);
  g.glGenFramebuffers(1, ids.subarray(1));
  g.glBindFramebuffer(0x8d40, ids[1]);
  g.glFramebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, ids[0], 0);
  if (g.glCheckFramebufferStatus(0x8d40) !== 0x8cd5) throw new Error("offscreen framebuffer incomplete");

  const shader = (type: number, src: string) => {
    const s = g.glCreateShader(type);
    const text = Buffer.from(`${src}\0`);
    g.glShaderSource(s, 1, new BigUint64Array([BigInt(ptr(text))]), null);
    g.glCompileShader(s);
    const ok = new Int32Array(1);
    g.glGetShaderiv(s, 0x8b81, ok);
    if (!ok[0]) throw new Error(`shader compile failed (type 0x${type.toString(16)})`);
    return s;
  };
  const prog = g.glCreateProgram();
  g.glAttachShader(
    prog,
    shader(0x8b31, "#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}"),
  );
  g.glAttachShader(
    prog,
    shader(
      0x8b30,
      "#version 300 es\nprecision highp float;out vec4 o;uniform float t;" +
        "void main(){vec2 p=gl_FragCoord.xy/vec2(1920.0,1080.0);float a=0.0;" +
        "for(int i=0;i<64;i++){float f=float(i);a+=sin(p.x*f+t)*cos(p.y*f-t);}o=vec4(a,p,1.0);}",
    ),
  );
  g.glLinkProgram(prog);
  const linked = new Int32Array(1);
  g.glGetProgramiv(prog, 0x8b82, linked);
  if (!linked[0]) throw new Error("program link failed");
  g.glUseProgram(prog);
  const t = g.glGetUniformLocation(prog, Buffer.from("t\0"));
  g.glViewport(0, 0, W, H);

  const frame = (i: number) => {
    g.glUniform1f(t, i * 0.01);
    g.glDrawArrays(0x0004, 0, 3);
    g.glFlush();
  };
  for (let i = 0; i < 20; i++) frame(i);
  g.glFinish();
  let frames = 0;
  const start = performance.now();
  while (performance.now() - start < SECONDS * 1000) {
    for (let i = 0; i < 10; i++) frame(frames++);
    g.glFinish();
  }
  const secs = (performance.now() - start) / 1000;
  return {
    renderer: str(0x1f01),
    version: str(0x1f02),
    fps: Math.round((frames / secs) * 10) / 10,
    gpixelsPerSecond: Math.round(((frames * W * H) / secs / 1e9) * 100) / 100,
  };
}

async function run(cmd: string[], env: Record<string, string | undefined> = {}, timeout = 120_000) {
  const headless = { ...Bun.env, DISPLAY: undefined, WAYLAND_DISPLAY: undefined, ...env };
  try {
    const p = Bun.spawn(cmd, { env: headless as Record<string, string>, stdout: "pipe", stderr: "pipe", timeout });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: out + err };
  } catch (e) {
    return { code: -1, out: String(e) };
  }
}
const pick = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1].trim());

if (Bun.argv.includes("--gl-only")) {
  try {
    console.log(JSON.stringify(gl()));
  } catch (e) {
    console.log(JSON.stringify({ error: String(e) }));
  }
  process.exit(0);
}

const self = [process.execPath, import.meta.path, "--gl-only"];
const glRun = async (env: Record<string, string>) => {
  const r = await run(self, env);
  try {
    return JSON.parse(r.out.split("\n").find((l) => l.startsWith("{"))!);
  } catch {
    return { error: r.out.slice(-400) };
  }
};
const vk = await run(["vulkaninfo", "--summary"]);
const vkmark = await run(["vkmark", "--winsys", "headless", "-b", "vertex:duration=3", "-b", "texture:duration=3", "-b", "shading:duration=3"]);
const cl = await run(["clinfo", "-l"]);
const va = await run(["vainfo", "--display", "drm", "--device", "/dev/dri/renderD128"]);
const pkgs = await run(["pacman", "-Q", "mesa", "bunos-mesa", "vulkan-dzn", "bunos-vulkan-dzn", "bunos-opencl-mesa"]);

console.log(
  JSON.stringify(
    {
      packages: pick(pkgs.out, /^(\S+ \S+)$/gm),
      gl: { d3d12: await glRun({}), llvmpipe: await glRun({ LIBGL_ALWAYS_SOFTWARE: "1" }) },
      vulkan: {
        devices: pick(vk.out, /deviceName\s*=\s*(.+)/g),
        drivers: pick(vk.out, /driverInfo\s*=\s*(.+)/g),
        vkmark: Number(pick(vkmark.out, /vkmark Score:\s*(\d+)/g)[0] ?? NaN),
      },
      opencl: { devices: pick(cl.out, /Device #\d+:\s*(.+)/g), code: cl.code },
      vaapi: {
        driver: pick(va.out, /Driver version:\s*(.+)/g)[0] ?? null,
        entrypoints: pick(va.out, /(VAProfile\S+\s*:\s*VAEntrypoint\S+)/g).length,
      },
    },
    null,
    2,
  ),
);
