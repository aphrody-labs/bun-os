// SPDX-License-Identifier: MIT
/** Thin adb wrapper. Works against Waydroid (adb over the container IP), redroid, an emulator or a phone. */

export interface AdbResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

export interface AdbDevice {
  serial: string;
  state: string;
  props: Record<string, string>;
}

export class Adb {
  constructor(
    readonly serial?: string,
    readonly bin: string = process.env.ADB ?? "adb",
  ) {}

  /** Run `adb [-s serial] ...args`. Never throws on a non-zero exit; callers check `code`. */
  async run(args: string[], opts: { stdin?: Uint8Array | string; timeoutMs?: number } = {}): Promise<AdbResult> {
    const cmd = [this.bin, ...(this.serial ? ["-s", this.serial] : []), ...args];
    const proc = Bun.spawn(cmd, {
      stdin: opts.stdin === undefined ? "ignore" : new Response(typeof opts.stdin === "string" ? opts.stdin : opts.stdin.slice()),
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeoutMs ?? 120_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).bytes(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  async text(args: string[]): Promise<string> {
    const r = await this.run(args);
    if (r.code !== 0) throw new Error(`adb ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
    return new TextDecoder().decode(r.stdout);
  }

  shell(command: string): Promise<string> {
    return this.text(["shell", command]);
  }

  async devices(): Promise<AdbDevice[]> {
    return parseDevices(await this.text(["devices", "-l"]));
  }

  async waitForDevice(timeoutMs = 120_000): Promise<void> {
    const r = await this.run(["wait-for-device"], { timeoutMs });
    if (r.code !== 0) throw new Error(`wait-for-device: ${r.stderr.trim()}`);
  }

  /** Poll `sys.boot_completed` until it is 1. Returns the elapsed milliseconds. */
  async waitForBoot(timeoutMs = 300_000): Promise<number> {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const r = await this.run(["shell", "getprop", "sys.boot_completed"], { timeoutMs: 10_000 });
      if (r.code === 0 && new TextDecoder().decode(r.stdout).trim() === "1") return performance.now() - t0;
      await Bun.sleep(1000);
    }
    throw new Error(`device not booted after ${timeoutMs} ms`);
  }

  async connect(hostPort: string): Promise<string> {
    return (await this.text(["connect", hostPort])).trim();
  }

  async install(apk: string): Promise<string> {
    return (await this.text(["install", "-r", apk])).trim();
  }

  async installBytes(bytes: Uint8Array, name = "upload.apk"): Promise<string> {
    const tmp = `/data/local/tmp/${name.replace(/[^\w.-]/g, "_")}`;
    const dir = await import("node:fs/promises").then(fs => fs.mkdtemp(`${(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp").replace(/\\/g, "/")}/wd-apk-`));
    const local = `${dir}/${name.replace(/[^\w.-]/g, "_")}`;
    await Bun.write(local, bytes);
    try {
      await this.text(["push", local, tmp]);
      return (await this.shell(`pm install -r ${tmp}; rm -f ${tmp}`)).trim();
    } finally {
      await import("node:fs/promises").then(fs => fs.rm(dir, { recursive: true, force: true }));
    }
  }

  async push(local: string, remote: string): Promise<void> {
    await this.text(["push", local, remote]);
  }

  async pull(remote: string, local: string): Promise<void> {
    await this.text(["pull", remote, local]);
  }

  /** PNG screenshot via `exec-out screencap -p`. */
  async screenshot(): Promise<Uint8Array> {
    const r = await this.run(["exec-out", "screencap", "-p"]);
    if (r.code !== 0) throw new Error(`screencap: ${r.stderr.trim()}`);
    return r.stdout;
  }

  async launch(pkg: string): Promise<string> {
    if (!/^[A-Za-z][\w.]*$/.test(pkg)) throw new Error(`invalid package name: ${pkg}`);
    return this.shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  }

  async isInstalled(pkg: string): Promise<boolean> {
    if (!/^[A-Za-z][\w.]*$/.test(pkg)) return false;
    return (await this.shell(`pm list packages ${pkg}`)).split(/\r?\n/).includes(`package:${pkg}`);
  }

  /** `adb forward tcp:0 <remote>` and return the allocated local port. */
  async forward(remote: string): Promise<number> {
    const out = (await this.text(["forward", "tcp:0", remote])).trim();
    const port = Number(out);
    if (!Number.isInteger(port) || port <= 0) throw new Error(`unexpected forward output: ${out}`);
    return port;
  }

  async forwardRemove(port: number): Promise<void> {
    await this.run(["forward", "--remove", `tcp:${port}`]);
  }

  async displaySize(): Promise<{ width: number; height: number }> {
    const m = /(\d+)x(\d+)/.exec(await this.shell("wm size"));
    if (!m) throw new Error("wm size: no size reported");
    return { width: Number(m[1]), height: Number(m[2]) };
  }
}

export function parseDevices(out: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || !parts[0]) continue;
    const props: Record<string, string> = {};
    for (const kv of parts.slice(2)) {
      const i = kv.indexOf(":");
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
    }
    devices.push({ serial: parts[0], state: parts[1]!, props });
  }
  return devices;
}
