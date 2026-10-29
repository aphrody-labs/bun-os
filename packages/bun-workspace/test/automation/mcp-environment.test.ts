// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  existingMcpConfigTargets,
  loadPreparedMcpEnvironment,
  planMcpEnvironmentConfiguration,
  prepareMcpEnvironment,
  probeMcpEnvironment,
  readMcpProcessEnvironment,
} from "../../src/automation/mcp-environment.ts";
import { hasMode, POSIX_MODES } from "../../src/automation/portable-fs.ts";

/** A shebang script on POSIX; Windows cannot exec one directly, so it is compiled to a real executable. */
async function fixtureExecutable(path: string, source: string) {
  if (process.platform !== "win32") {
    writeFileSync(path, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    return;
  }
  const entry = `${path}.ts`;
  writeFileSync(entry, source);
  const build = Bun.spawnSync([process.execPath, "build", "--compile", entry, "--outfile", path], {
    windowsHide: true,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mcp-environment-"));
  roots.push(root);
  return root;
}
const requirements = {
  required: ["APHRODY_MCP_DATABASE_URL"],
  processKeys: ["APHRODY_MCP_DATABASE_URL"],
  aliases: {},
};
const profile = (
  root: string,
  env: Record<string, string> = {
    HOME: root,
    PATH: "/fixture/bin",
    APHRODY_MCP_DATABASE_URL: "fixture-only-password",
  },
) =>
  prepareMcpEnvironment({
    profile: "aphrody",
    repoRoot: root,
    outputDir: join(root, "private"),
    requirements,
    env,
  });

test("private JSON profile keeps values out of metadata and has deterministic fingerprint", () => {
  const root = fixture(),
    prepared = profile(root);
  expect(hasMode(statSync(prepared.path).mode, 0o600)).toBe(true);
  expect(hasMode(statSync(join(root, "private")).mode, 0o700)).toBe(true);
  expect(JSON.parse(readFileSync(prepared.path, "utf8")).APHRODY_MCP_DATABASE_URL).toBe("fixture-only-password");
  expect(JSON.stringify(prepared)).not.toContain("fixture-only-password");
  expect(prepared.missingRequired).toEqual([]);
  expect(
    profile(root, {
      APHRODY_MCP_DATABASE_URL: "fixture-only-password",
      PATH: "/fixture/bin",
      HOME: root,
    }).fingerprint,
  ).toBe(prepared.fingerprint);
});

test("explicit sources fill missing keys and cannot replace domain or host environment", () => {
  const root = fixture(),
    path = join(root, "source.json");
  writeFileSync(path, JSON.stringify({ APHRODY_MCP_DATABASE_URL: "fixture-only-password" }), {
    mode: 0o600,
  });
  const options = {
    profile: "aphrody" as const,
    repoRoot: root,
    outputDir: join(root, "private"),
    requirements,
    env: { HOME: root, PATH: "/fixture/bin" },
    sourceFiles: [path],
  };
  expect(prepareMcpEnvironment(options).sources[1]?.keys).toEqual(["APHRODY_MCP_DATABASE_URL"]);
  writeFileSync(path, JSON.stringify({ HOME: "another-home" }));
  expect(() => prepareMcpEnvironment(options)).toThrow("inherited host or domain");
  expect(() => prepareMcpEnvironment({ ...options, env: { APHRODY_PROFILE: "dbfr" } })).toThrow("inherited domain");
});

test("public, symbolic and malformed private source files fail without exposing values", () => {
  const root = fixture(),
    path = join(root, "source.json"),
    alias = join(root, "alias.json");
  const run = (source: string) =>
    prepareMcpEnvironment({
      profile: "aphrody",
      repoRoot: root,
      outputDir: join(root, "private"),
      requirements,
      env: {},
      sourceFiles: [source],
    });
  writeFileSync(path, "fixture-only-password", { mode: 0o644 });
  if (POSIX_MODES) expect(run.bind(null, path)).toThrow("owned, private regular file");
  chmodSync(path, 0o600);
  expect(run.bind(null, path)).toThrow("invalid JSON");
  symlinkSync(path, alias);
  expect(run.bind(null, alias)).toThrow("owned, private regular file");
  writeFileSync(path, JSON.stringify({ TOKEN: 123 }));
  expect(run.bind(null, path)).toThrow("invalid entries");
});

test("provider configuration preserves canonical options and unrelated TOML and JSON fields", () => {
  const root = fixture(),
    prepared = profile(root),
    codex = join(root, "config.toml"),
    agy = join(root, "agy.json");
  writeFileSync(
    codex,
    '# retained\nmodel="fixture"\n[mcp_servers.other]\ncommand="other"\n[mcp_servers.aphrody]\ncommand="/fixture/aphrody-mcp"\nstartup_timeout_sec=60\nenabled=true\n',
    { mode: 0o600 },
  );
  writeFileSync(
    agy,
    JSON.stringify({
      other: true,
      mcpServers: {
        other: { command: "other" },
        aphrody: { command: "/fixture/aphrody-mcp", timeout: 12 },
      },
    }),
    { mode: 0o600 },
  );
  const plan = planMcpEnvironmentConfiguration(prepared, "/fixture/aphrody-mcp", [
    { provider: "codex", path: codex },
    { provider: "agy", path: agy },
  ]);
  const toml = Bun.TOML.parse(plan[0]!.content) as {
    mcp_servers: Record<string, Record<string, unknown>>;
  };
  expect(toml.mcp_servers.aphrody?.startup_timeout_sec).toBe(60);
  expect(toml.mcp_servers.other?.command).toBe("other");
  expect(plan[0]!.content).toContain("# retained");
  expect(plan[0]!.content).not.toContain("fixture-only-password");
  expect(JSON.parse(plan[1]!.content).mcpServers.aphrody.timeout).toBe(12);
  expect(readFileSync(codex, "utf8")).not.toContain("APHRODY_MCP_ENV_FILE");
});

test("unpreserved inline credentials and tampered profiles prevent configuration planning", () => {
  const root = fixture(),
    prepared = profile(root),
    config = join(root, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        aphrody: {
          command: "/fixture/aphrody-mcp",
          env: { TOKEN: "fixture-unpreserved" },
        },
      },
    }),
    { mode: 0o600 },
  );
  expect(() =>
    planMcpEnvironmentConfiguration(prepared, "/fixture/aphrody-mcp", [{ provider: "claude", path: config }]),
  ).toThrow("absent from the prepared profile");
  writeFileSync(prepared.path, "{}\n");
  expect(() => planMcpEnvironmentConfiguration(prepared, "/fixture/aphrody-mcp", [])).toThrow(
    "changed after preparation",
  );
});

test("existing targets do not invent provider files and wrong process source fails closed", () => {
  const root = fixture();
  mkdirSync(join(root, ".codex"));
  writeFileSync(join(root, ".codex/config.toml"), "", { mode: 0o600 });
  expect(existingMcpConfigTargets(root).map(target => target.provider)).toEqual(["codex"]);
  expect(() => readMcpProcessEnvironment(process.pid, process.execPath, ["TOKEN"])).toThrow(
    "canonical-server validation",
  );
  expect(() => readMcpProcessEnvironment(-1, process.execPath, [])).toThrow("invalid");
});

test("unsupported native loader cannot activate provider configuration", async () => {
  const root = fixture(),
    prepared = profile(root);
  const result = await probeMcpEnvironment(prepared, join(root, "aphrody-mcp"), 100);
  expect(result.completed).toBe(false);
  expect(result.failure).toBe("native-probe-unavailable");
  expect(JSON.stringify(result)).not.toContain("fixture-only-password");
});

test("native verification uses structured config for paths with spaces and reports only readiness", async () => {
  const root = fixture(),
    directory = join(root, "binary with spaces");
  mkdirSync(directory);
  const binary = join(directory, process.platform === "win32" ? "aphrody-mcp.exe" : "aphrody-mcp"),
    prepared = profile(root);
  await fixtureExecutable(
    binary,
    `const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage --env-file');}
else {
  if(args.includes('--stdio')||args.includes('probe'))process.exit(8);
  const config=await Bun.file(args[args.indexOf('--config')+1]).json();
  const server=config.mcpServers.aphrody;
  if(server.command!==(process.platform==='win32'?process.execPath:process.argv[1])||server.args[0]!=='--env-file'||server.args[1]!==args[1])process.exit(9);
  if(args.includes('list')){
    console.log(JSON.stringify({kind:'server_info',tool_count:1}));
    console.log(JSON.stringify({kind:'tool',name:'aphrody_shenron_rag_search'}));
  }else if(args.includes('call'))console.log(JSON.stringify({result:{content:[{type:'text',text:JSON.stringify(process.env.PROBE_FIXTURE_ERROR?{error:{code:'503',message:process.env.PROBE_FIXTURE_ERROR}}:{results:[],mode:'lexical'})}]}}));
  else process.exit(10);
}
`,
  );
  const result = await probeMcpEnvironment(prepared, binary, 2000);
  expect(result.supported).toBe(true);
  expect(result.completed).toBe(true);
  expect(result.ragReady).toBe(true);
  expect(result.toolCount).toBe(1);
  expect(JSON.stringify(result)).not.toContain("fixture-only-password");
  const unavailable = profile(root, {
    HOME: root,
    PATH: "/fixture/bin",
    APHRODY_MCP_DATABASE_URL: "fixture-only-password",
    PROBE_FIXTURE_ERROR: "RAG database unavailable",
  });
  const failed = await probeMcpEnvironment(unavailable, binary, 2000);
  expect(failed.completed).toBe(false);
  expect(failed.failure).toBe("native-rag-database-unavailable");
  const privateFailure = profile(root, {
    HOME: root,
    PATH: "/fixture/bin",
    APHRODY_MCP_DATABASE_URL: "fixture-only-password",
    PROBE_FIXTURE_ERROR: "fixture-only-password",
  });
  const sanitized = await probeMcpEnvironment(privateFailure, binary, 2000);
  expect(sanitized.completed).toBe(false);
  expect(sanitized.failure).toBe("native-rag-backend-error");
  expect(JSON.stringify(sanitized)).not.toContain("fixture-only-password");
  // Windows compiles the fixture executable first.
}, 30_000);

test("recurring preparation preserves auth after agents contain only profile references", () => {
  const root = fixture(),
    first = profile(root),
    config = join(root, "agent.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        aphrody: {
          command: "/fixture/aphrody-mcp",
          env: { APHRODY_MCP_ENV_FILE: first.path },
        },
      },
    }),
    { mode: 0o600 },
  );
  const refreshed = prepareMcpEnvironment({
    profile: "aphrody",
    repoRoot: root,
    outputDir: join(root, "private"),
    requirements,
    env: { HOME: root, PATH: "/fixture/bin" },
    configTargets: [{ provider: "claude", path: config }],
  });
  const env = JSON.parse(readFileSync(refreshed.path, "utf8"));
  expect(env.APHRODY_MCP_DATABASE_URL).toBe("fixture-only-password");
  expect(env.APHRODY_MCP_ENV_FILE).toBeUndefined();
  expect(refreshed.missingRequired).toEqual([]);
  expect(refreshed.fingerprint).toBe(first.fingerprint);
  expect(JSON.stringify(refreshed)).not.toContain("fixture-only-password");
  const changed = profile(root, {
    HOME: root,
    PATH: "/fixture/bin",
    APHRODY_MCP_DATABASE_URL: "fixture-new-password",
  });
  expect(changed.fingerprint).not.toBe(first.fingerprint);
  writeFileSync(
    refreshed.path,
    JSON.stringify({
      APHRODY_AGENT_DOMAIN: "dbfr",
      APHRODY_MCP_DATABASE_URL: "fixture-other-domain",
    }),
  );
  expect(() => profile(root)).toThrow("another domain");
});

test("prepared-profile inspection neither refreshes launch environment nor reports readiness", () => {
  const root = fixture(),
    prepared = profile(root),
    bytes = readFileSync(prepared.path, "utf8");
  const loaded = loadPreparedMcpEnvironment({
    profile: "aphrody",
    path: prepared.path,
    repoRoot: root,
    requirements,
  });
  expect(loaded.fingerprint).toBe(prepared.fingerprint);
  expect(loaded.missingRequired).toEqual([]);
  expect(readFileSync(prepared.path, "utf8")).toBe(bytes);
  expect("completed" in loaded).toBe(false);
  expect(JSON.stringify(loaded)).not.toContain("fixture-only-password");
  expect(() =>
    loadPreparedMcpEnvironment({
      profile: "dbfr",
      path: prepared.path,
      repoRoot: root,
      requirements,
    }),
  ).toThrow("another domain");
  writeFileSync(
    prepared.path,
    JSON.stringify({
      APHRODY_AGENT_DOMAIN: "aphrody",
      APHRODY_MCP_ENV_FILE: prepared.path,
    }),
  );
  expect(() =>
    loadPreparedMcpEnvironment({
      profile: "aphrody",
      path: prepared.path,
      repoRoot: root,
      requirements,
    }),
  ).toThrow("recursive routing");
  expect(() =>
    loadPreparedMcpEnvironment({
      profile: "dbfr",
      path: prepared.path,
      repoRoot: root,
      requirements,
    }),
  ).toThrow("another domain");
});
