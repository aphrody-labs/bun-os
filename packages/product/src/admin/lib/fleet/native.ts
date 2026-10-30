// SPDX-License-Identifier: Apache-2.0
// Native Windows resources and an in-process CPython planner; no alternate Python launcher.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { PythonAsync } from "@aphrody/runtime-sdk/python";
import { hostname, userInfo, freemem, totalmem, availableParallelism, release } from "node:os";
import * as windows from "./windows.ts";

export async function tunnelKey(home: string, owner: string) {
  if (!isAbsolute(home)) throw new Error("configured protected home must be absolute");
  const directory = join(home, "private", "gpu-fleet");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "wireguard.key");
  async function keyCommand(args: string[], input?: string) {
    const child = Bun.spawn([owner, "infra", "wg", ...args], {
      stdin: input ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
    try {
      const [value, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      if (code !== 0 || !/^[A-Za-z0-9+/]{43}=$/.test(value.trim()))
        throw new Error("native WireGuard key operation failed");
      return value.trim();
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!existsSync(path)) writeFileSync(path, await keyCommand(["genkey"]), { mode: 0o600 });
  const token = join(directory, "api.token");
  if (!existsSync(token)) writeFileSync(token, randomBytes(32).toString("hex"), { mode: 0o600 });
  if (process.platform === "win32") {
    const identity = { computerName: hostname(), userName: userInfo().username };
    const child = Bun.spawn(
      [
        "icacls",
        directory,
        "/inheritance:r",
        "/grant:r",
        `${identity.computerName}\\${identity.userName}:(OI)(CI)F`,
        "SYSTEM:(OI)(CI)F",
      ],
      { stdout: "ignore", stderr: "ignore", windowsHide: true },
    );
    if ((await child.exited) !== 0) throw new Error("protected GPU key ACL failed");
    await Promise.all(
      [path, token].map(async file => {
        const acl = Bun.spawn(
          [
            "icacls",
            file,
            "/inheritance:r",
            "/grant:r",
            `${identity.computerName}\\${identity.userName}:F`,
            "SYSTEM:F",
          ],
          { stdout: "ignore", stderr: "ignore", windowsHide: true },
        );
        if ((await acl.exited) !== 0) throw new Error("protected GPU key file ACL failed");
      }),
    );
  }
  const publicKey = await keyCommand(["pubkey"], readFileSync(path, "utf8").trim());
  writeFileSync(join(directory, "wireguard.pub"), publicKey, { mode: 0o600 });
  return { publicKey };
}

export async function nativeInventory(member: "aphro-pc" | "omar", root: string) {
  if (process.platform !== "win32") throw new Error("Windows inventory requires Windows");
  const child = Bun.spawn(
    ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"],
    { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
  );
  const deadline = setTimeout(() => child.kill("SIGKILL"), 8000);
  let output: string;
  try {
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error("native NVIDIA probe failed");
    output = text.trim();
  } finally {
    clearTimeout(deadline);
  }
  const rows = output.split(/\r?\n/);
  if (rows.length !== 1) throw new Error("fleet requires an explicit GPU selection on multi-GPU hosts");
  const [gpu, total, free, driver] = rows[0]!.split(",").map(s => s.trim());
  const disk = windows.drives().find(d => resolve(root).toLowerCase().startsWith(d.root.toLowerCase()));
  if (!disk) throw new Error("configured storage drive unavailable");
  return {
    node: {
      member,
      address: member === "omar" ? "10.200.77.10" : "10.200.77.4",
      gpu,
      vram_mib: Number(total),
      free_vram_mib: Number(free),
      ram_bytes: totalmem(),
      available_ram_bytes: freemem(),
      disk_bytes: disk.totalBytes,
      available_disk_bytes: disk.availableBytes,
      // A driver query cannot qualify CUDA arithmetic in the intended container.
      docker_cuda: false,
    },
    native: {
      pid: process.pid,
      executable: process.execPath,
      driver,
      windows: release(),
      elevated: windows.isElevated(),
      windows11: windows.isWindows11(),
      processors: availableParallelism(),
      localAppData: windows.knownFolder("LocalAppData"),
      services: await windows.services(/^(sshd|WireGuard|com\.docker)/i),
      toolchain: { arch: process.arch },
      // Registry-only enumeration does not start WSL.
      wslRegistrations: await windows.wslDistributions(),
    },
  };
}

export async function openPlanner(source: string): Promise<PythonAsync> {
  if (!isAbsolute(source) || !existsSync(join(source, "aphrody", "inference", "fleet.py")))
    throw new Error("configured Aphrody Python source missing");
  const { Python } = await import("@aphrody/runtime-sdk/python");
  const py = await Python.async();
  try {
    await py.exec(`import sys, os\nsys.path.insert(0, ${JSON.stringify(source)})`);
    const environment = process.env.VIRTUAL_ENV;
    if (environment) {
      const site = join(environment, "Lib", "site-packages");
      if (process.platform === "win32" && existsSync(site))
        await py.exec(`import site\nsite.addsitedir(${JSON.stringify(site)})`);
    }
    const pid = Number(await py.eval("os.getpid()"));
    if (pid !== process.pid) throw new Error("Python host is not in the dedicated Bun process");
    await py.exec("import aphrody.inference.fleet");
    return py;
  } catch (error) {
    await py.close();
    throw error;
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const root = resolve(flag("--root") ?? process.env.APHRODY_INFRA_ROOT ?? process.cwd());
  if (argv[0] === "tunnel-key") {
    console.log(
      JSON.stringify(
        await tunnelKey(resolve(flag("--home") ?? join(homedir(), ".aphrody")), flag("--aphrody-bin") ?? "aphrody"),
      ),
    );
    return 0;
  }
  const source = resolve(flag("--python-source") ?? join(root, "py/packages/aphrody/src"));
  if (argv[0] === "inventory") {
    const member = flag("--member") ?? "aphro-pc";
    if (member !== "aphro-pc" && member !== "omar") throw new Error("unknown member");
    console.log(JSON.stringify(await nativeInventory(member, root)));
    return 0;
  }
  if (argv[0] === "plan" || argv[0] === "cuda-probe") {
    await using py = await openPlanner(source);
    if (argv[0] === "cuda-probe") {
      console.log(await py.call("aphrody.inference.fleet", "cuda_probe_json"));
      return 0;
    }
    const path = flag("--snapshot");
    if (!path || !isAbsolute(path)) throw new Error("plan requires an absolute measured snapshot path");
    console.log(await py.call("aphrody.inference.fleet", "plan_json", readFileSync(path, "utf8")));
    return 0;
  }
  throw new Error("usage: aphrody-product admin flotte inventory|plan|cuda-probe [--root path] [--python-source path]");
}
