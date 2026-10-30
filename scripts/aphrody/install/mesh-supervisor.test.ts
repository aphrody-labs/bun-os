// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  composeArgs,
  adapterDue,
  windowsCapabilities,
  environment,
  probes,
  validateConfig,
  type MeshConfig,
} from "./mesh-supervisor.ts";

const home = join(tmpdir(), "mesh-protected-home");
const config = (): MeshConfig => ({
  version: 1,
  member: "omar",
  root: tmpdir(),
  home,
  compose: [
    {
      file: join(tmpdir(), "compose.yaml"),
      services: ["pc"],
      profiles: ["pc"],
    },
  ],
  adapters: [],
  health: [],
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("native recovery condition timed out");
    // oxlint-disable-next-line no-await-in-loop -- bounded polling of an actual process/health receipt
    await Bun.sleep(50);
  }
}

test.skipIf(process.platform !== "win32")(
  "exports the Windows job surface without executing its operations",
  async () => {
    const result = await windowsCapabilities();
    expect(result.supported).toBe(true);
    expect(result.exports).toEqual(["Job"]);
  },
);

test("native recovery stays online without Docker and isolates env errors, then tears down owned children", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "mesh-recovery-test-"));
  if (dirname(resolve(fixture)) !== resolve(tmpdir())) throw new Error("invalid fixture cleanup path");
  const fixtureHome = join(fixture, "home");
  const nativeMarker = join(fixture, "native.json");
  const receiptPath = join(fixtureHome, "run", "mesh.json");
  const nativePath = join(fixture, "native.ts");
  const configPath = join(fixture, "mesh.json");
  mkdirSync(join(fixtureHome, "private"), { recursive: true });
  writeFileSync(
    nativePath,
    `import { writeFileSync } from "node:fs";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("native-recovery-ready") });
writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, url: server.url.toString() }));
await new Promise(() => {});
`,
  );
  const marker = (): { pid: number; url: string } | undefined => {
    try {
      return JSON.parse(readFileSync(nativeMarker, "utf8"));
    } catch {
      return undefined;
    }
  };
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      try {
        const target = marker();
        if (target) return await fetch(target.url, { signal: AbortSignal.timeout(500) });
      } catch {
        /* An absent owned child is unhealthy. */
      }
      return new Response(null, { status: 503 });
    },
  });
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config(),
      member: "dbfr",
      root: fixture,
      home: fixtureHome,
      compose: [{ file: join(fixture, "absent-compose.yaml"), services: ["pc"] }],
      adapters: [
        {
          id: "bad-env",
          argv: [process.execPath, "-e", "throw new Error('must not run')"],
          envFile: join(fixtureHome, "private", "missing.env"),
        },
        {
          id: "recovery",
          argv: [process.execPath, "--no-env-file", nativePath, nativeMarker],
        },
      ],
      health: [{ id: "native", url: probe.url.toString() }],
    }),
  );
  const supervisor = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      join(import.meta.dir, "mesh-supervisor.ts"),
      "run",
      "--config",
      configPath,
      "--locked",
    ],
    {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: join(fixture, "no-docker"),
        APHRODY_HOME: fixtureHome,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    },
  );
  let receipt:
    | {
        status: string;
        compose: { status: string }[];
        health: { healthy: boolean }[];
        adapters: { id: string; pid: number | null; error: string | null }[];
      }
    | undefined;
  try {
    await waitUntil(() => {
      if (!existsSync(receiptPath)) return false;
      try {
        receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      } catch {
        return false;
      }
      return receipt?.health[0]?.healthy === true && receipt?.compose[0]?.status === "degraded";
    });
    expect(supervisor.exitCode).toBeNull();
    expect(receipt!.status).toBe("degraded");
    expect(receipt!.adapters.find(a => a.id === "bad-env")).toMatchObject({
      pid: null,
      error: "native adapter or protected environment unavailable",
    });
    expect(receipt!.adapters.find(a => a.id === "recovery")?.error).toBeNull();
    const native = marker()!;
    expect(alive(native.pid)).toBe(true);
    expect(await (await fetch(native.url)).text()).toBe("native-recovery-ready");
    supervisor.kill();
    await supervisor.exited;
    await waitUntil(() => !alive(native.pid), 3000);
    expect(alive(native.pid)).toBe(false);
  } finally {
    if (supervisor.exitCode === null) supervisor.kill();
    await supervisor.exited;
    const native = marker();
    if (native && alive(native.pid)) process.kill(native.pid, "SIGKILL");
    await probe.stop(true);
    rmSync(fixture, { recursive: true, force: true });
  }
}, 15_000);

test("periodic maintenance never duplicates a running child or loops after success", () => {
  const adapter = {
    id: "update",
    argv: ["aphrody", "self", "update"],
    intervalSeconds: 3600,
  };
  expect(adapterDue(adapter, false, 4_000_000)).toBe(false);
  expect(adapterDue(adapter, true, 5000)).toBe(false);
  expect(adapterDue(adapter, true, 3_600_000)).toBe(true);
  expect(() =>
    validateConfig({
      ...config(),
      adapters: [{ ...adapter, intervalSeconds: 0 }],
    }),
  ).toThrow();
});

test("reject credentials in command arguments, URLs and env outside the protected host store", () => {
  expect(() =>
    validateConfig({
      ...config(),
      adapters: [{ id: "remote", argv: ["aphrody", "--token=secret"] }],
    }),
  ).toThrow();
  expect(() =>
    validateConfig({
      ...config(),
      health: [{ id: "screen", url: "http://localhost/#token=secret" }],
    }),
  ).toThrow();
  expect(() =>
    validateConfig({
      ...config(),
      compose: [
        {
          ...config().compose[0],
          envFile: join(home, "private-other", "token.env"),
        },
      ],
    }),
  ).toThrow();
  expect(
    validateConfig({
      ...config(),
      adapters: [
        {
          id: "mcp",
          argv: ["aphrody-mcp"],
          envFile: join(home, "private", "mcp-http.env"),
        },
      ],
    }).member,
  ).toBe("omar");
});

test("startup selects declared existing services and waits for their real health, without building", () => {
  const argv = composeArgs(config().compose[0]!, "up");
  expect(argv.slice(-7)).toEqual(["up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "pc"]);
  expect(argv).not.toContain("--remove-orphans");
  expect(argv).not.toContain("--build");
  expect(() =>
    validateConfig({
      ...config(),
      compose: [
        {
          file: join(tmpdir(), "compose.yaml"),
          services: ["--remove-orphans"],
        },
      ],
    }),
  ).toThrow();
});

test("protected env values preserve equals signs and are never interpolated", () => {
  expect(environment('# comment\nTOKEN="a=b=$HOME"\nOTHER=ok')).toEqual({
    TOKEN: "a=b=$HOME",
    OTHER: "ok",
  });
  expect(() => environment("export TOKEN=foo")).toThrow();
});

test("health fails on errors, redirects and authentication failure instead of accepting a listener", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      return new Response(null, {
        status: new URL(req.url).pathname === "/healthy" ? 200 : 401,
      });
    },
  });
  try {
    const c = config();
    c.health = [
      { id: "good", url: `${server.url}healthy` },
      { id: "auth", url: `${server.url}private` },
    ];
    expect(await probes(c)).toEqual([
      { id: "good", healthy: true, status: 200 },
      { id: "auth", healthy: false, status: 401 },
    ]);
  } finally {
    await server.stop(true);
  }
});

test.skipIf(process.platform !== "win32")("Windows Job closes its owned long-running child", async () => {
  const { Job } = await (await import("./mesh-supervisor")).windows();
  const job = new Job({ killOnClose: true });
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(120000)"], {
    windowsHide: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    job.assign(child);
    job.close();
    expect(await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)])).toBe(true);
  } finally {
    job.close();
    child.kill();
  }
});
