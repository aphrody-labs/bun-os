#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS NT layer end-to-end check. Runs on the workstation (driver absent: user-mode paths) and, after the owner
// loads bunos.sys in a VM or on their PC, exercises the kernel paths too. Usage:
//   bun factory/windows/nt/end-to-end.ts [--bridge-exe <path>] [--nt-exe <path>]
// It (1) checks the bun:ffi client contract, (2) starts a loopback bridge and drives it with the bunos-win client,
// (3) if \\.\BunOS is open, round-trips version/ping/caps/events. Exit non-zero on the first failure.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ntDriver } from "@aphrody/windows";
import { callOverTcp } from "../../../crates/bunos-nt-bridge/client/bunos-win.ts";

const root = join(import.meta.dir, "../../..");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const targetDir = process.env.CARGO_TARGET_DIR ?? join(root, "build/rust");
const bridgeExe = arg("--bridge-exe", join(targetDir, "release/bunos-winbridge.exe"));

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// 1. bun:ffi contract (no driver needed).
check("control codes pinned", ntDriver.IOCTL_BUNOS_CAPS === 0x0022_6008 && ntDriver.IOCTL_BUNOS_EVENTS_READ === 0x0022_6044);
check("parseSources", ntDriver.parseSources("process,image") === 5 && ntDriver.parseSources("all") === 15);

// 2. Bridge over loopback.
const port = 40000 + Math.floor(Math.random() * 20000);
const token = "e2e-" + Math.random().toString(16).slice(2);
const server = spawn(bridgeExe, ["serve", "--transport", "loopback", "--port", String(port), "--token", token], {
  stdio: ["ignore", "inherit", "inherit"],
});
process.env.BUNOS_BRIDGE_TOKEN = token;
try {
  await Bun.sleep(1200);
  const hello = await callOverTcp("127.0.0.1", port, "hello", {});
  check("bridge hello", hello.ok === true && Array.isArray(hello.tools) && hello.tools!.includes("nt_status"),
    `${hello.tools?.length ?? 0} tools`);
  const status = (await callOverTcp("127.0.0.1", port, "nt_status", {})).result as { driver?: string } | undefined;
  check("bridge nt_status", !!status?.driver, `driver ${status?.driver}`);
  const denied = await callOverTcp("127.0.0.1", port, "delete_path", { path: "x" });
  check("bridge enforces the allow-list", denied.ok === false && (denied.error ?? "").includes("not served"));
  const badToken = await (async () => {
    process.env.BUNOS_BRIDGE_TOKEN = "wrong";
    try {
      return await callOverTcp("127.0.0.1", port, "ping", {});
    } finally {
      process.env.BUNOS_BRIDGE_TOKEN = token;
    }
  })();
  check("bridge rejects a bad token", badToken.ok === false);
} finally {
  server.kill();
}

// 3. Kernel paths when the driver is loaded (skipped otherwise).
if (process.platform === "win32" && ntDriver.available()) {
  using device = ntDriver.BunOsDevice.open()!;
  check("driver version", device.version().startsWith("bunos.sys "));
  const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
  check("driver ping echoes", Buffer.from(device.ping(payload)).equals(Buffer.from(payload)));
  const caps = device.configure("process,image");
  check("driver configure", caps.sourcesActive.includes("process") && caps.sourcesActive.includes("image"));
  Bun.spawnSync(["cmd.exe", "/c", "exit"]);
  const batch = device.readEvents(512);
  check("driver streams process events", batch.events.some(e => e.kind === "process_create"), `${batch.events.length} events`);
  device.configure(0);
} else {
  console.log("skip driver round trip — \\\\.\\BunOS not open (driver not loaded / not elevated)");
}

console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
