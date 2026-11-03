// SPDX-License-Identifier: Apache-2.0
// Bun as PID 1 (factory/kernel/ROADMAP.md, Phase 0 step 3). Compiled with `bun build --compile` into the initramfs
// as /init; the kernel runs it as the first process (Documentation/admin-guide/initrd.rst, `rdinit=`).
// PID 1 duties done here through bun:ffi system calls: mount the API filesystems, reap orphaned children
// (waitpid(-1, WNOHANG) on every SIGCHLD), never exit, and power off or reboot through reboot(2).
//
// Kernel command line: bunos.init=selftest   mount, report, write BUNOS-INIT-OK, power off (qualification)
//                      bunos.init=serve      as above, then serve http://0.0.0.0:80/ (health and /proc data)
import { dlopen, FFIType, ptr } from "bun:ffi";

const libc = dlopen("libc.so.6", {
  mount: { args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  reboot: { args: [FFIType.i32], returns: FFIType.i32 },
  sync: { args: [], returns: FFIType.void },
  sethostname: { args: [FFIType.cstring, FFIType.u64], returns: FFIType.i32 },
});

const MS_NOSUID = 2;
const MS_NODEV = 4;
const MS_NOEXEC = 8;
const WNOHANG = 1;
const RB_POWER_OFF = 0x4321fedc;
const RB_AUTOBOOT = 0x01234567;

const cstr = (s: string) => ptr(Buffer.from(`${s}\0`));
const log = (msg: string) => console.log(`[bunos-init] ${msg}`);

function mount(source: string, target: string, type: string, flags: number, data = "") {
  try {
    require("node:fs").mkdirSync(target, { recursive: true });
  } catch {}
  const rc = libc.symbols.mount(cstr(source), cstr(target), cstr(type), flags, data ? cstr(data) : null);
  log(`mount ${type} on ${target}: ${rc === 0 ? "ok" : "failed"}`);
  return rc === 0;
}

function reap() {
  const status = new Int32Array(1);
  let n = 0;
  while (libc.symbols.waitpid(-1, ptr(status), WNOHANG) > 0) n++;
  return n;
}

function halt(cmd: number): never {
  libc.symbols.sync();
  libc.symbols.reboot(cmd);
  // reboot(2) only returns on failure; PID 1 must never exit, so stay alive.
  for (;;) Bun.sleepSync(60_000);
}

// The self-test child is this same compiled executable (process.execPath is /init, not a bun CLI): it only
// reports and exits, so the self-test never recurses.
if (process.env.BUNOS_INIT_CHILD === "1") {
  console.log(`bunos-init child ${process.pid}`);
  process.exit(0);
}

const isPid1 = process.pid === 1;
log(`Bun ${Bun.version} (${Bun.revision.slice(0, 9)}) as pid ${process.pid}`);

if (isPid1) {
  mount("proc", "/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC);
  mount("sysfs", "/sys", "sysfs", MS_NOSUID | MS_NODEV | MS_NOEXEC);
  mount("devtmpfs", "/dev", "devtmpfs", MS_NOSUID, "mode=0755");
  mount("tmpfs", "/run", "tmpfs", MS_NOSUID | MS_NODEV, "mode=0755");
  mount("tmpfs", "/tmp", "tmpfs", MS_NOSUID | MS_NODEV);
  libc.symbols.sethostname(cstr("bunos"), 5);
  process.on("SIGCHLD", reap);
  setInterval(reap, 1000);
  // A signal to PID 1 that has no handler is ignored by the kernel; handle the shutdown ones explicitly.
  process.on("SIGTERM", () => halt(RB_POWER_OFF));
  process.on("SIGINT", () => halt(RB_AUTOBOOT));
}

const fs = require("node:fs") as typeof import("node:fs");
const read = (p: string) => {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
};
const cmdline = read("/proc/cmdline");
const mode = /(?:^|\s)bunos\.init=(\S+)/.exec(cmdline)?.[1] ?? "selftest";
const facts = {
  kernel: read("/proc/sys/kernel/osrelease"),
  cmdline,
  cpus: (read("/proc/cpuinfo").match(/^processor\s/gm) ?? []).length,
  memTotal: /MemTotal:\s+(\d+)/.exec(read("/proc/meminfo"))?.[1],
  uptime: read("/proc/uptime").split(" ")[0],
};
log(`kernel ${facts.kernel}, ${facts.cpus} cpu, ${facts.memTotal} kB, uptime ${facts.uptime}s`);

// Self-test: spawn a child and let it exit, so the reaper is exercised as it would be for a real service.
const child = Bun.spawnSync([process.execPath], { env: { ...process.env, BUNOS_INIT_CHILD: "1" } });
log(`child process exit ${child.exitCode}, stdout ${child.stdout.toString().trim()}`);
const ok = facts.kernel !== "" && child.exitCode === 0;
console.log(ok ? "BUNOS-INIT-OK" : "BUNOS-INIT-FAILED");

if (mode === "serve") {
  Bun.serve({
    port: 80,
    hostname: "0.0.0.0",
    fetch: req =>
      new URL(req.url).pathname === "/health"
        ? Response.json({ status: "ok", init: "bun", pid: process.pid, ...facts })
        : new Response("Bun OS: Bun is PID 1\n"),
  });
  log("serving on :80");
} else if (isPid1) {
  halt(RB_POWER_OFF);
}
