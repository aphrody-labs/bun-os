// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeUnit, hostRoot, loadCatalog } from "../src/host/index.ts";
import { applyPlan, hostPlan, type Plan, renderPlan, type Runner, unitFacts } from "../src/host/plan.ts";

const unitText = (bind: string) => `[Unit]
Description=fixture

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/apps/x/shared/a2a
EnvironmentFile=-/etc/aphrody/x.env
ExecStart=/home/ubuntu/.local/bin/aphrody a2a serve --bind ${bind} --coord-dir /home/ubuntu/apps/x/shared/coord
ReadWritePaths=/home/ubuntu/apps/x/shared/a2a /home/ubuntu/apps/x/shared/coord
BindPaths=-/home/ubuntu/apps/x/shared/coord /home/ubuntu/apps/x/state:/home/ubuntu/apps/x/state
`;

const unit = (service: string, port: number, host = "vps") => ({
  service,
  unit: `${service}.service`,
  path: `systemd/aphrody/${service}.service`,
  dropIns: [],
  ownerRepo: "aphrody",
  targetHost: host,
  port,
});

let dir: string;
let root: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "host-plan-"));
  root = join(dir, "infra/config/host");
  mkdirSync(join(root, "systemd/aphrody"), { recursive: true });
  mkdirSync(join(root, "systemd/shared"), { recursive: true });
  mkdirSync(join(dir, "scripts/tools/infra"), { recursive: true });
  writeFileSync(
    join(root, "catalog.json"),
    JSON.stringify({
      units: [
        unit("aphrody-a2a", 8788),
        unit("aphrody-mcp-http", 8789),
        unit("other", 9000, "dbfr"),
        unit("aphrody-ai-gateway-dbfr", 8786, "dbfr"),
      ],
    }),
  );
  writeFileSync(join(root, "systemd/aphrody/aphrody-a2a.service"), unitText("127.0.0.1:8788"));
  writeFileSync(
    join(root, "systemd/aphrody/aphrody-mcp-http.service"),
    unitText("127.0.0.1:8789").replace("aphrody a2a serve", "aphrody-mcp http"),
  );
  writeFileSync(join(root, "systemd/aphrody/other.service"), unitText("127.0.0.1:9000"));
  writeFileSync(
    join(root, "systemd/aphrody/aphrody-ai-gateway-dbfr.service"),
    `[Unit]\nDescription=fixture\n\n[Service]\nUser=ubuntu\nEnvironmentFile=/etc/aphrody/aphrody-ai-gateway.env\nExecStart=/home/ubuntu/.local/bin/aphrody gateway serve --addr 127.0.0.1:8786 --provider openai\n`,
  );
  writeFileSync(
    join(dir, "infra/config/service-catalog.json"),
    JSON.stringify({
      services: [
        { id: "aphrody-a2a", port: 8788, health: "http://127.0.0.1:8788/ping" },
        {
          id: "aphrody-mcp-http",
          port: 8789,
          health: "http://127.0.0.1:8789/healthz",
        },
        { id: "other", port: 9001 },
        {
          id: "aphrody-ai-gateway-dbfr",
          port: 8786,
          health: "http://127.0.0.1:8786/health",
          modelId: "demo-chat-v2",
        },
      ],
    }),
  );
  writeFileSync(join(dir, "ai.json"), '{"id":"fixture"}\n');
  writeFileSync(join(dir, "scripts/tools/infra/mcp-tools-count.ts"), "// fixture\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("unit facts: binary, loopback bind, env files and writable paths come from the composed unit", () => {
  const entry = loadCatalog(root).units[0];
  const facts = unitFacts(entry, unitText("127.0.0.1:8788"));
  expect(facts.binary).toBe("/home/ubuntu/.local/bin/aphrody");
  expect(facts.bind).toEqual({ host: "127.0.0.1", port: 8788 });
  expect(facts.envFiles).toEqual([{ path: "/etc/aphrody/x.env", optional: true }]);
  expect(facts.writePaths).toEqual([
    "/home/ubuntu/apps/x/shared/a2a",
    "/home/ubuntu/apps/x/shared/coord",
    "/home/ubuntu/apps/x/state",
  ]);
});

test("gateway unit facts: --addr is treated as a private loopback bind", () => {
  const entry = loadCatalog(root).units[0];
  const text = unitText("127.0.0.1:8786").replace("--bind", "--addr");
  expect(unitFacts(entry, text).bind).toEqual({
    host: "127.0.0.1",
    port: 8786,
  });
});

test("gateway host plan pins and authenticates the installed binary and generation smoke test", () => {
  const plan = hostPlan(["aphrody-ai-gateway-dbfr"], {
    root,
    target: "dbfr",
    binary: { from: "/tmp/aphrody-test", sha256: "a".repeat(64) },
  });
  const ids = plan.steps.map(step => step.id);
  expect(plan.target).toBe("dbfr");
  expect(ids).toContain("aphrody-ai-gateway-dbfr/generate-token");
  expect(ids).toContain("aphrody-ai-gateway-dbfr/install-binary");
  expect(ids).toContain("aphrody-ai-gateway-dbfr/auth-required");
  expect(ids).toContain("aphrody-ai-gateway-dbfr/auth-wrong-token");
  expect(ids).toContain("aphrody-ai-gateway-dbfr/authenticated-generation");
  expect(plan.steps.find(step => step.id.endsWith("authenticated-generation"))?.run).toContain("demo-chat-v2");
});

test("a unit that would bind anything but loopback is refused", () => {
  const entry = loadCatalog(root).units[0];
  for (const bind of ["0.0.0.0:8788", "51.77.147.152:8788", "[::]:8788"]) {
    expect(() => unitFacts(entry, unitText(bind))).toThrow("not a loopback address");
  }
  for (const bind of ["127.0.0.1:8788", "[::1]:8788", "localhost:8788"]) {
    expect(unitFacts(entry, unitText(bind)).bind?.port).toBe(8788);
  }
});

test("plan: preflight checks come first, then provision, install, verify and a rollback", () => {
  const plan = hostPlan(["aphrody-mcp-http", "aphrody-a2a"], {
    root,
    expectTools: 137,
  });
  expect(plan.target).toBe("vps");
  const mcp = plan.steps.filter(s => s.unit === "aphrody-mcp-http.service");
  const phases = mcp.map(s => s.phase);
  expect(phases).toEqual(phases.toSorted((a, b) => order(a) - order(b)));
  expect(mcp.find(s => s.id.endsWith("/port-free"))?.run).toContain("sport = :8789");
  expect(mcp.find(s => s.id.endsWith("/tools-count"))?.run).toContain("--expect 137");
  expect(mcp.find(s => s.id.endsWith("/tools-count"))?.kind).toBe("check");
  expect(mcp.find(s => s.id.endsWith("/health"))?.run).toContain("http://127.0.0.1:8789/healthz");
  const a2a = plan.steps.filter(s => s.unit === "aphrody-a2a.service");
  expect(a2a.find(s => s.id.endsWith("/ai-json"))?.run).toContain(Buffer.from('{"id":"fixture"}\n').toString("base64"));
  expect(a2a.some(s => s.id.endsWith("/tools-count"))).toBe(false);
  // nothing in the plan opens a public listener: every verify probe targets loopback
  for (const s of plan.steps.filter(x => x.id.endsWith("/health"))) expect(s.run).toContain("127.0.0.1");
});

test("tools-count is informative, not a gate, when no expected count is given", () => {
  const plan = hostPlan(["aphrody-mcp-http"], { root });
  const step = plan.steps.find(s => s.id.endsWith("/tools-count"));
  expect(step?.kind).toBe("info");
  expect(step?.run).not.toContain("--expect");
});

test("plan refuses an unknown unit, a foreign target and a port that differs from the service catalog", () => {
  expect(() => hostPlan(["nope"], { root })).toThrow("unknown unit");
  expect(() => hostPlan(["aphrody-a2a", "other"], { root })).toThrow("target");
  expect(() => hostPlan(["aphrody-a2a"], { root, target: "dbfr" })).toThrow("not dbfr");
  expect(() => hostPlan(["other"], { root })).toThrow("declares :9001");
});

test("rendering names every step and marks mutations", () => {
  const text = renderPlan(hostPlan(["aphrody-a2a"], { root }));
  expect(text).toContain("host-plan target=vps units=aphrody-a2a.service");
  expect(text).toContain("[MUTATE] aphrody-a2a/install");
  expect(text).toContain("[check ] aphrody-a2a/port-free");
});

const order = (p: string) => ["preflight", "provision", "install", "verify", "rollback"].indexOf(p);
const recorder = (fail: (command: string) => boolean = () => false) => {
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return { code: fail(command) ? 1 : 0, stdout: "", stderr: "" };
  };
  return { commands, run };
};
const quiet = () => {};

test("apply: a failed preflight check stops before any mutation", async () => {
  const plan: Plan = hostPlan(["aphrody-mcp-http"], { root });
  const { commands, run } = recorder(c => c.includes("sport = :8789") && c.includes("socket_rows="));
  const failed = await applyPlan(plan, run, quiet);
  expect(failed).toEqual(["aphrody-mcp-http/port-free"]);
  expect(
    commands.some(c => c.includes("systemctl enable") || c.includes("sudo install") || c.includes("base64 -d")),
  ).toBe(false);
});

test("apply: runs preflight, provision, install and verify in order, no rollback when all pass", async () => {
  const plan = hostPlan(["aphrody-a2a"], { root });
  const { commands, run } = recorder();
  expect(await applyPlan(plan, run, quiet)).toEqual([]);
  const at = (needle: string) => commands.findIndex(c => c.includes(needle));
  expect(at("test -x")).toBeLessThan(at("ai.json"));
  expect(at("ai.json")).toBeLessThan(at("sudo install"));
  expect(at("sudo install")).toBeLessThan(at("enable --now"));
  expect(at("enable --now")).toBeLessThan(at("curl -fsS"));
  expect(commands.some(c => c.includes("disable --now"))).toBe(false);
});

test("apply: a failed verify check rolls the unit back and reports the step", async () => {
  const plan = hostPlan(["aphrody-a2a"], { root });
  const { commands, run } = recorder(c => c.startsWith("curl -fsS"));
  expect(await applyPlan(plan, run, quiet)).toEqual(["aphrody-a2a/health"]);
  expect(commands.at(-1)).toContain("systemctl disable --now aphrody-a2a.service");
});

const freePorts = (plan: Plan) =>
  plan.steps.filter(s => s.id.endsWith("/port-free")).map(s => /:(\d+)"/.exec(s.run)?.[1]);

test("the declared loopback units plan against the real catalog", () => {
  expect(freePorts(hostPlan(["aphrody-a2a"], { root: hostRoot() }))).toEqual(["8788"]);
  expect(freePorts(hostPlan(["aphrody-mcp-http-dbfr"], { root: hostRoot() }))).toEqual(["8793"]);
  for (const name of ["aphrody-mcp-http-dbfr.service", "aphrody-a2a.service"]) {
    const text = composeUnit(name);
    expect(text).toContain("User=ubuntu");
    expect(text).toContain("ProtectHome=tmpfs");
    expect(text).toContain("NoNewPrivileges=true");
    expect(text).toContain("--bind 127.0.0.1:");
    expect(text).toContain("Restart=on-failure");
    expect(text).not.toMatch(/(SECRET|TOKEN|PASSWORD|DATABASE_URL)=/);
  }
});

const BUILD = {
  from: "/home/ubuntu/build/cache/cargo/aphrody-wsl/release/aphrody",
  sha256: "ab".repeat(32),
};

test("mcp-http: a token generated on the host, the build installed, authentication proven before the count", () => {
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], {
    root: hostRoot(),
    expectTools: 137,
    binary: BUILD,
  });
  const id = (name: string) => plan.steps.findIndex(s => s.id === `aphrody-mcp-http-dbfr/${name}`);
  const run = (name: string) => plan.steps[id(name)]?.run ?? "";
  expect(id("generate-token")).toBeGreaterThan(-1);
  expect(id("generate-token")).toBeLessThan(id("install"));
  expect(run("generate-token")).toContain("openssl rand -hex 32");
  expect(run("generate-token")).toContain("chmod 0600");
  expect(run("generate-token")).not.toMatch(/[0-9a-f]{64}/);
  expect(id("install-binary")).toBeLessThan(id("install"));
  expect(run("install-binary")).toContain(".prev");
  expect(plan.steps.some(s => s.id === "aphrody-mcp-http-dbfr/binary")).toBe(false);
  expect(run("binary-artifact")).toContain(BUILD.sha256);
  // 401 without a token and with a wrong one, then the count with the token, which is read on the host and never printed
  expect(run("auth-required")).toContain("= 401");
  expect(run("auth-wrong-token")).toContain("Bearer 0000");
  expect(id("auth-required")).toBeLessThan(id("tools-count"));
  expect(run("tools-count")).toContain("--token-env APHRODY_MCP_HTTP_TOKEN");
  expect(run("tools-count")).toContain("--expect 137");
  expect(run("tools-count")).toContain("sudo -n sed -n 's/^APHRODY_MCP_HTTP_TOKEN=//p'");
  // no step carries a real token: the only Bearer literal is the all-zero wrong token of the 401 check
  for (const s of plan.steps)
    for (const [, bearer] of s.run.matchAll(/Bearer ([0-9a-f]{20,})/g)) expect(bearer).toMatch(/^0+$/);
});

test("a2a: require a protected credential before activating autonomous execution", () => {
  const plan = hostPlan(["aphrody-a2a"], { root: hostRoot() });
  const token = plan.steps.find(s => s.id === "aphrody-a2a/generate-token");
  expect(token?.run).toContain("APHRODY_A2A_COORD_TOKEN");
  expect(token?.run).toContain("openssl rand -hex 32");
  expect(token?.run).toContain("chmod 0600");
  expect(plan.steps.indexOf(token!)).toBeLessThan(plan.steps.findIndex(s => s.id === "aphrody-a2a/enable-now"));
  const text = composeUnit("aphrody-a2a.service");
  expect(text).toContain("EnvironmentFile=/etc/aphrody/aphrody-a2a.env");
  expect(text).toContain("UnsetEnvironment=APHRODY_A2A_DRY_RUN");
  expect(text).toContain("Environment=APHRODY_A2A_DEFAULT_PEER=codex");
  expect(text).toContain("BindReadOnlyPaths=/home/ubuntu/.local/bin/aphrody /home/ubuntu/.local/bin/aphrody-mcp");
  expect(text).not.toContain("Environment=APHRODY_A2A_DRY_RUN=1");
  expect(plan.steps.find(s => s.id === "aphrody-a2a/auth-required")?.run).toContain("= 401");
  expect(plan.steps.find(s => s.id === "aphrody-a2a/auth-wrong-token")?.run).toContain("Bearer 0000");
  expect(plan.steps.find(s => s.id === "aphrody-a2a/auth-valid-token")?.run).toContain("-o /dev/null");
});

test("native hub units require a verified build and retain their previous binaries", () => {
  expect(() =>
    hostPlan(["aphrody-mcp-http-dbfr"], {
      root: hostRoot(),
      binary: { from: BUILD.from, sha256: "nope" },
    }),
  ).toThrow("64 hex");
  const a2a = hostPlan(["aphrody-a2a"], { root: hostRoot(), binary: BUILD });
  expect(a2a.steps.find(s => s.id.endsWith("/install-binary"))?.run).toContain("/home/ubuntu/.local/bin/aphrody.prev");
  expect(() =>
    hostPlan(["aphrody-a2a"], {
      root: hostRoot(),
      binary: { from: BUILD.from, sha256: "nope" },
    }),
  ).toThrow("64 hex");
});

test("mcp-http: without a build the installed binary is checked; the unit's env file is required", () => {
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], { root: hostRoot() });
  expect(plan.steps.some(s => s.id === "aphrody-mcp-http-dbfr/binary")).toBe(true);
  expect(plan.steps.some(s => s.id.endsWith("/install-binary"))).toBe(false);
  const text = composeUnit("aphrody-mcp-http-dbfr.service");
  expect(text).toMatch(/^EnvironmentFile=\/etc\/aphrody\/aphrody-mcp-http\.env$/m);
  expect(text).toContain("aphrody-mcp http --bind 127.0.0.1:8793");
  expect(text).not.toMatch(/--bind 127\.0\.0\.1:8789/);
});

test("socket gates preserve the declared WireGuard relay and reject occupied, wildcard and unknown listeners", async () => {
  const fixture = join(dir, "socket-fixtures");
  const policy = join(root, "wireguard/aphrody-tunnel.json");
  mkdirSync(fixture, { recursive: true });
  mkdirSync(join(root, "wireguard"), { recursive: true });
  const socket = join(fixture, "ss");
  const sleep = join(fixture, "sleep");
  writeFileSync(socket, '#!/bin/sh\nprintf "%s\\n" "$TASK_SOCKET_ROWS"\n', {
    mode: 0o700,
  });
  writeFileSync(sleep, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const relay = {
    host: "vps",
    unit: "aphrody-mcp-http",
    port: 8789,
    expose: "socket-proxyd",
    upstream: "127.0.0.1:8789",
    address: "10.200.77.1",
  };
  const declaration = {
    subnet: "10.200.77.0/24",
    hub: { peer: "vps", address: "10.200.77.1" },
    peers: [],
    services: [relay],
  };
  writeFileSync(policy, JSON.stringify(declaration));
  const steps = hostPlan(["aphrody-mcp-http"], { root }).steps;
  const execute = async (id: string, addresses: string[]) => {
    const command = steps
      .find(step => step.id.endsWith("/" + id))!
      .run.replaceAll("ss -H -ltn", `'${socket}' -H -ltn`)
      .replaceAll("sleep 0.25", `'${sleep}' 0.25`);
    const child = Bun.spawn(["sh", "-c", command], {
      windowsHide: true,
      env: {
        ...process.env,
        TASK_SOCKET_ROWS: addresses.map(address => `LISTEN 0 128 ${address}:8789 *:*`).join("\n"),
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    return child.exited;
  };
  try {
    expect(await execute("port-free", [])).toBe(0);
    expect(await execute("port-free", ["10.200.77.1"])).toBe(0);
    expect(
      await Promise.all(
        ["127.0.0.1", "0.0.0.0", "[::]", "*", "51.77.147.152"].map(address =>
          execute("port-free", ["10.200.77.1", address]),
        ),
      ),
    ).toEqual([1, 1, 1, 1, 1]);
    expect(await execute("listen-loopback", ["127.0.0.1", "10.200.77.1"])).toBe(0);
    expect(await execute("listen-loopback", ["127.0.0.1"])).toBe(0);
    expect(await execute("listen-loopback", ["10.200.77.1"])).toBe(1);
    expect(await execute("listen-loopback", ["127.0.0.1", "51.77.147.152"])).toBe(1);
    expect(await execute("listen-loopback", ["127.0.0.1", "10.200.77.99"])).toBe(1);
    writeFileSync(
      policy,
      JSON.stringify({
        ...declaration,
        services: [{ ...relay, address: "51.77.147.152" }],
      }),
    );
    expect(() => hostPlan(["aphrody-mcp-http"], { root })).toThrow("private WireGuard address");
  } finally {
    rmSync(policy, { force: true });
  }
}, 20_000);
