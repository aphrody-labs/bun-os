#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS for Windows latency probe (docs/WSL.md section 8). Runs on the Windows host with Bun.
//
//   bun latency.ts [--distro bunos] [--cold] [--docker] [--json out.json]
//
// wsl-cold   `wsl --shutdown`, then `wsl -d <distro> -- true` (VM boot + distro start), ms
// wsl-warm   median of 20 `wsl -d <distro> -- true` with the VM running, ms
// p9-stat    median ms of one stat + 4 KiB read of /etc/os-release through \\wsl.localhost (Plan 9 / virtiofs), 50 runs
// p9-list    ms to list /usr/bin through \\wsl.localhost
// tcp-rtt    1-byte ping-pong between a Windows client and a Bun echo server in the distro on 127.0.0.1, 2000 runs, µs
// docker-run `docker run --rm hello-world` through wsl.exe (image already pulled), median of 5, ms; docker-exe-run the
// same from Windows docker.exe over 127.0.0.1:2375, docker-exe-version a bare API round trip
import { readdirSync, readFileSync, statSync } from "node:fs";
import { connect } from "node:net";

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1]! : d);
const distro = opt("--distro", "bunos");
const wsl = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\wsl.exe`;
const sh = (args: string[]) =>
  Bun.spawnSync([wsl, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, WSL_UTF8: "1" } });
const ms = (f: () => void) => {
  const t = Bun.nanoseconds();
  f();
  return (Bun.nanoseconds() - t) / 1e6;
};
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { median: +q(0.5).toFixed(3), p99: +q(0.99).toFixed(3), min: +s[0]!.toFixed(3) };
};
const out: Record<string, unknown> = {
  distro,
  kernel: sh(["-d", distro, "--", "uname", "-r"]).stdout.toString().trim(),
  at: new Date().toISOString(),
};

if (argv.includes("--cold")) {
  sh(["--shutdown"]);
  out["wsl-cold"] = +ms(() => sh(["-d", distro, "--", "true"])).toFixed(1);
}
sh(["-d", distro, "--", "true"]);
out["wsl-warm"] = stats(Array.from({ length: 20 }, () => ms(() => sh(["-d", distro, "--", "true"]))));

const root = `\\\\wsl.localhost\\${distro}`;
readFileSync(`${root}\\etc\\os-release`);
out["p9-stat"] = stats(
  Array.from({ length: 50 }, () =>
    ms(() => (statSync(`${root}\\etc\\os-release`), readFileSync(`${root}\\etc\\os-release`))),
  ),
);
let n = 0;
out["p9-list"] = { ms: +ms(() => (n = readdirSync(`${root}\\usr\\bin`).length)).toFixed(1), entries: n };

// Echo server in the distro; with networkingMode=mirrored 127.0.0.1 is shared, with NAT WSL forwards localhost.
const port = 47811;
const server = Bun.spawn(
  [
    wsl,
    "-d",
    distro,
    "--",
    "bun",
    "-e",
    `Bun.listen({hostname:"0.0.0.0",port:${port},socket:{data(s,d){s.write(d)}}});console.log("up")`,
  ],
  { stdout: "pipe", stderr: "inherit" },
);
await server.stdout.getReader().read();
const rtts: number[] = [];
// NAT mode forwards localhost only after its port scan sees the listener; retry the connect for up to 10 s.
const open = async () => {
  for (let i = 0; ; i++) {
    try {
      return await new Promise<ReturnType<typeof connect>>((ok, ko) => {
        const c = connect({ host: "127.0.0.1", port, noDelay: true }, () => ok(c));
        c.once("error", ko);
      });
    } catch (e) {
      if (i >= 100) throw e;
      await Bun.sleep(100);
    }
  }
};
const sock = await open();
await new Promise<void>((done, fail) => {
  const c = sock;
  let t = 0;
  const tick = () => {
    if (rtts.length >= 2000) return (c.end(), done());
    t = Bun.nanoseconds();
    c.write("x");
  };
  c.on("data", () => (rtts.push((Bun.nanoseconds() - t) / 1e3), tick()));
  c.on("error", fail);
  tick();
});
server.kill();
out["tcp-rtt-us"] = stats(rtts.slice(100));

if (argv.includes("--docker")) {
  sh(["-d", distro, "-u", "root", "--", "docker", "pull", "-q", "hello-world"]);
  out["docker-run"] = stats(
    Array.from({ length: 5 }, () =>
      ms(() => sh(["-d", distro, "-u", "root", "--", "docker", "run", "--rm", "hello-world"])),
    ),
  );
  // The Windows CLI straight to dockerd over the mirrored loopback (no wsl.exe in the path).
  const exe = Bun.which("docker");
  if (exe) {
    const docker = (...a: string[]) => Bun.spawnSync([exe, ...a], { stdout: "ignore", stderr: "ignore" });
    docker("run", "--rm", "hello-world");
    out["docker-exe-run"] = stats(Array.from({ length: 5 }, () => ms(() => docker("run", "--rm", "hello-world"))));
    out["docker-exe-version"] = stats(Array.from({ length: 10 }, () => ms(() => docker("version"))));
  }
}

console.log(JSON.stringify(out, null, 2));
if (argv.includes("--json")) await Bun.write(opt("--json", "latency.json"), `${JSON.stringify(out, null, 2)}\n`);
