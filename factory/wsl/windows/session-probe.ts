#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Start a Linux desktop session in the bunos distro and time it until its window is on the Windows desktop.
//
//   bun session-probe.ts <session-id> [--title <substring>] [--timeout 60] [--keep] [--cmd "<shell line>"]
//   bun session-probe.ts stop          end every running session (after --keep)
//
// Default command: `bunos-session <id>` as the distro user under WSLg (docs/DESKTOP-SESSIONS.md). --cmd replaces it
// (e.g. a bunos-wayland-win run). The window is any top-level window of msrdc.exe (WSLg) or bunos-wayland-win.exe whose
// title contains --title (default: any new window). Prints JSON: ms from spawn to the window, its title and size.
// The session runs detached in the guest (setsid), so it outlives this probe; without --keep it is stopped afterwards.
import { CString, JSCallback, dlopen, FFIType, ptr } from "bun:ffi";

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const id = argv[0];
if (!id || id.startsWith("--")) throw new Error("usage: bun session-probe.ts <session-id> [--title T] [--cmd LINE]");
const timeout = Number(opt("--timeout", "60")) * 1000;
const title = opt("--title");
const distro = process.env.BUNOS_WSL_DISTRO ?? "bunos";
if (id === "stop") {
  stop();
  process.exit(0);
}

const user32 = dlopen("user32.dll", {
  EnumWindows: { args: [FFIType.function, FFIType.i64], returns: FFIType.i32 },
  GetWindowTextW: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
  IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
  GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const kernel32 = dlopen("kernel32.dll", {
  OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
  QueryFullProcessImageNameW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
});

const exeName = new Map<number, string>();
function processName(pid: number): string {
  const known = exeName.get(pid);
  if (known !== undefined) return known;
  const h = kernel32.symbols.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid);
  let name = "";
  if (h) {
    const buf = new Uint16Array(512);
    const len = new Uint32Array([buf.length]);
    if (kernel32.symbols.QueryFullProcessImageNameW(h, 0, ptr(buf), ptr(len)))
      name = String.fromCharCode(...buf.subarray(0, len[0]))
        .split("\\")
        .pop()!
        .toLowerCase();
    kernel32.symbols.CloseHandle(h);
  }
  exeName.set(pid, name);
  return name;
}

type Win = { hwnd: number; title: string; exe: string; w: number; h: number };
function windows(): Win[] {
  const out: Win[] = [];
  const text = new Uint16Array(512);
  const pid = new Uint32Array(1);
  const rect = new Int32Array(4);
  const cb = new JSCallback(
    (hwnd: number) => {
      if (!user32.symbols.IsWindowVisible(hwnd)) return 1;
      user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pid));
      const exe = processName(pid[0]!);
      if (exe !== "msrdc.exe" && exe !== "bunos-wayland-win.exe") return 1;
      const n = user32.symbols.GetWindowTextW(hwnd, ptr(text), text.length);
      user32.symbols.GetWindowRect(hwnd, ptr(rect));
      out.push({
        hwnd,
        title: String.fromCharCode(...text.subarray(0, n)),
        exe,
        w: rect[2]! - rect[0]!,
        h: rect[3]! - rect[1]!,
      });
      return 1;
    },
    { args: [FFIType.ptr, FFIType.i64], returns: FFIType.i32 },
  );
  user32.symbols.EnumWindows(cb.ptr!, 0);
  cb.close();
  return out;
}

const before = new Set(windows().map(w => w.hwnd));
const line = opt("--cmd") ?? `exec bunos-session ${id}`;
const log = `/tmp/session-probe-${id}.log`;
const t0 = Bun.nanoseconds();
// The line goes through base64: wsl.exe re-parses its command line and would split or unquote it.
const proc = Bun.spawn(
  [
    "wsl.exe",
    "-d",
    distro,
    "--",
    "sh",
    "-c",
    `echo ${Buffer.from(line).toString("base64")} | base64 -d >/tmp/session-probe-${id}.sh; setsid -f sh /tmp/session-probe-${id}.sh >${log} 2>&1 </dev/null`,
  ],
  { stdout: "ignore", stderr: "ignore" },
);
let found: Win | undefined;
while (!found && (Bun.nanoseconds() - t0) / 1e6 < timeout) {
  found = windows().find(w => !before.has(w.hwnd) && w.w > 50 && w.h > 50 && (!title || w.title.includes(title)));
  if (!found) await Bun.sleep(20);
}
const ms = Math.round((Bun.nanoseconds() - t0) / 1e6);
const exited = proc.exitCode;
const tail = Bun.spawnSync(["wsl.exe", "-d", distro, "--", "tail", "-n", "15", log]).stdout.toString();
console.log(
  JSON.stringify(
    { session: id, ok: !!found, ms: found ? ms : null, window: found ?? null, exited, log: tail.trim().split("\n") },
    null,
    2,
  ),
);
if (!argv.includes("--keep")) stop();
process.exit(found ? 0 : 1);

/** End what a session started (compositor, its helpers, viewer, wayvnc, dbus-run-session): TERM, then KILL. */
function stop() {
  const pattern =
    "bunos-session|wlvncc|wayvnc|Hyprland|/usr/bin/cosmic|cosmic-comp|gnome-shell|mutter-devkit|dbus-run-session";
  const script = `pkill -f '${pattern}'; sleep 1; pkill -9 -f '${pattern}'; true`;
  Bun.spawnSync([
    "wsl.exe",
    "-d",
    distro,
    "--",
    "sh",
    "-c",
    `echo ${Buffer.from(script).toString("base64")} | base64 -d | sh`,
  ]);
}
