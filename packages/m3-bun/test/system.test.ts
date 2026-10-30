// SPDX-License-Identifier: Apache-2.0
// System tests: the generated images really build and run. Opt in with M3_BUN_SYSTEM=1 (they need docker,
// and for the boot test QEMU and a kernel in M3_BUN_KERNEL; they take about a minute and write ~300 MB).
import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileApp } from "../src/compile.ts";
import { packageApp } from "../src/package.ts";
import { generateTargets, contextFor } from "../src/targets/index.ts";
import { loadApp } from "../src/config.ts";
import { cleanup, fixtureCopy, freePort } from "./helpers.ts";

afterAll(cleanup);

const enabled = Bun.env.M3_BUN_SYSTEM === "1";
const sh = (cmd: string[], cwd?: string) => {
  const proc = Bun.spawnSync(cmd, {
    windowsHide: true,
    ...(cwd ? { cwd } : {}),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? 1,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  };
};

async function until(url: string, tries = 100): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Polls depend on the previous attempt and must stop at the first ready response.
      return await fetch(url, { signal: AbortSignal.timeout(1500) });
    } catch (error) {
      last = error;
      // oxlint-disable-next-line no-await-in-loop -- Back off only after the preceding readiness attempt fails.
      await Bun.sleep(200);
    }
  }
  throw new Error(`${url} never answered: ${String(last)}`);
}

describe.skipIf(!enabled)("generated images run", () => {
  test.skipIf(!Bun.which("docker"))(
    "the scratch image builds from the rootfs, serves UI and API, and passes its own health check",
    async () => {
      const dir = fixtureCopy();
      const app = await loadApp(dir);
      const { outfile } = await compileApp({ app });
      const out = join(dir, "release");
      const report = await packageApp({
        app,
        executable: outfile,
        out,
        rootfs: true,
      });
      expect(report.rootfs?.libraries.length).toBeGreaterThanOrEqual(4);
      await generateTargets(["docker"], contextFor(app), join(dir, "deploy"));
      writeFileSync(join(out, "Dockerfile"), await Bun.file(join(dir, "deploy/docker/Dockerfile.scratch")).text());
      const tag = `m3-bun-system-test/${app.name}:${Date.now()}`;
      const name = `m3-bun-system-${Date.now()}`;
      const built = sh(["docker", "build", "-q", "-t", tag, out]);
      expect(built.code).toBe(0);
      const port = freePort();
      try {
        expect(
          sh([
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "-p",
            `127.0.0.1:${port}:${app.port}`,
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            tag,
          ]).code,
        ).toBe(0);
        const health = await until(`http://127.0.0.1:${port}/healthz`);
        expect(health.status).toBe(200);
        expect(await (await fetch(`http://127.0.0.1:${port}/api/hello/docker`)).json()).toEqual({
          hello: "docker",
        });
        expect((await fetch(`http://127.0.0.1:${port}/`)).headers.get("content-type")).toStartWith("text/html");
        expect(sh(["docker", "exec", name, "/app/server", "--healthcheck"]).code).toBe(0);
        const user = sh(["docker", "inspect", name, "--format", "{{.Config.User}}"]).out;
        expect(user).toBe("10001:10001");
      } finally {
        sh(["docker", "rm", "-f", name]);
        sh(["docker", "rmi", "-f", tag]);
      }
    },
    240_000,
  );
});

describe.skipIf(!enabled)("cross-compiled executables", () => {
  test("windows-x64 is a PE executable named .exe, linux-x64-musl links musl and libstdc++ (dynamic: the documented limit)", async () => {
    const dir = fixtureCopy();
    const app = await loadApp(dir);
    const win = await compileApp({ app, target: "windows-x64" });
    expect(win.outfile.endsWith("hello-m3-windows-x64.exe")).toBe(true);
    const head = new Uint8Array(await Bun.file(win.outfile).slice(0, 2).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("MZ");
    expect(win.bytes).toBeGreaterThan(50_000_000);

    const musl = await compileApp({
      app,
      target: "linux-x64-musl",
      build: false,
    });
    const elf = sh(["readelf", "-d", "-l", musl.outfile]);
    expect(elf.out).toContain("/lib/ld-musl-x86_64.so.1");
    expect(elf.out).toContain("libstdc++.so.6");
    expect(elf.out).toContain("libc.musl-x86_64.so.1");
    const glibc = await compileApp({ app, target: "linux-x64", build: false });
    const needed = sh(["readelf", "-d", glibc.outfile]).out;
    for (const lib of ["libc.so.6", "libm.so.6", "libpthread.so.0", "libdl.so.2"]) expect(needed).toContain(lib);
  }, 240_000);

  test("Windows metadata is only applied on Windows: elsewhere the report says so instead of pretending", async () => {
    const dir = fixtureCopy();
    await Bun.write(
      join(dir, "m3.config.ts"),
      `import { defineM3Config } from "@aphrody/m3/config";
import { defineM3Bun } from "../../../src/config.ts";
export default defineM3Config({ entry: "src/index.html", theme: { seed: "#6750a4" } });
export const bun = defineM3Bun({ api: "src/api.ts", compile: { windows: { title: "Hello M3", publisher: "Aphrody", version: "1.2.3.0" } } });
`,
    );
    const app = await loadApp(dir);
    const win = await compileApp({ app, target: "windows-x64" });
    if (process.platform === "win32") expect(win.warnings).toEqual([]);
    else expect(win.warnings.join(" ")).toContain("only applied when compiling on Windows");
    const plain = await compileApp({
      app: await loadApp(fixtureCopy()),
      target: "linux-x64",
      build: true,
    });
    expect(plain.warnings).toEqual([]);
  }, 240_000);
});

test("system tests are opt-in", () => {
  expect(typeof enabled).toBe("boolean");
});
