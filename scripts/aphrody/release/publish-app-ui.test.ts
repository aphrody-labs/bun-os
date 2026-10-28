// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  artifactManifest,
  canonicalBunInputs,
  searchEnvironment,
  buildCommand,
  declarationCommand,
  prerequisiteCommands,
  smokeCommand,
  verifyArtifactProvenance,
  releasePlan,
  runtimeCommand,
  run,
  backendReleasePlan,
  backendEnvironment,
  backendArtifactManifest,
  backendActivationCommand,
  type BackendConfig,
  type ReleaseConfig,
  repository,
  serverSource,
  downloadsConfig,
  uiSourcePaths,
  releaseBunCheckout,
} from "./publish-app-ui";
const nativeShell =
  process.platform === "win32"
    ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe")
    : Bun.which("sh");
const backendConfig: BackendConfig = {
  schemaVersion: 1,
  module: {
    revision: "b".repeat(40),
    sha256: createHash("sha256").update("export {};").digest("hex"),
  },
  root: "/home/ubuntu/apps/downloads/public-index",
  collections: {
    "public-docs": {
      pointer: "public-docs.pointer.json",
      hosts: ["example.test"],
      policySha256: "c".repeat(64),
      owner: "aphrody-web-crawl",
    },
  },
};
const backendOwnerConfig: ReleaseConfig = {
  host: { target: "vps", root: "/home/ubuntu/apps/downloads" },
  site: {
    appUi: {
      directory: "app-ui",
      declaration: "app-ui/deployment.json",
      nativeRpc: false,
      googleSearch: {
        owner: "/home/ubuntu/.local/bin/aphrody",
        module: "current/google-search.ts",
        environmentFile: "current/google-search.env",
      },
    },
  },
};
test("backend-only plan isolates SDK/env/server from UI and preserves Google configuration", () => {
  const plan = backendReleasePlan(backendOwnerConfig, "a".repeat(40), backendConfig);
  expect(plan.base).toBe("/home/ubuntu/apps/downloads/backend");
  expect(plan.module).toBe(plan.base + "/current/public-index.ts");
  expect(plan.uiCurrent).toBe("/home/ubuntu/apps/downloads/app-ui/current");
  const env = backendEnvironment(plan);
  expect(env).toContain('PUBLIC_INDEX_COLLECTIONS=\'{"public-docs"');
  expect(env).not.toContain("GOOGLE_SEARCH");
  expect(env).not.toContain("PUBLIC_SEARCH_BACKEND");
  const routed = backendReleasePlan(backendOwnerConfig, "a".repeat(40), {
    ...backendConfig,
    searchCollection: "public-docs",
  });
  expect(backendEnvironment(routed)).toContain(
    "PUBLIC_SEARCH_BACKEND=public-index\nPUBLIC_INDEX_DEFAULT_COLLECTION=public-docs\n",
  );
  expect(routed.id).not.toBe(plan.id);
});
test("backend plans reject implicit/private stores, policy drift and unpinned modules", () => {
  const cases: BackendConfig[] = [
    { ...backendConfig, root: "/home/ubuntu/.aphrody/db" },
    { ...backendConfig, module: { ...backendConfig.module, revision: "main" } },
    { ...backendConfig, searchCollection: "missing" },
    { ...backendConfig, collections: {} },
    {
      ...backendConfig,
      collections: {
        "public-docs": {
          ...backendConfig.collections["public-docs"]!,
          pointer: "../private.json",
        },
      },
    },
    {
      ...backendConfig,
      collections: {
        "public-docs": {
          ...backendConfig.collections["public-docs"]!,
          hosts: ["localhost"],
        },
      },
    },
    {
      ...backendConfig,
      collections: {
        "public-docs": {
          ...backendConfig.collections["public-docs"]!,
          hosts: ["127.0.0.1"],
        },
      },
    },
    {
      ...backendConfig,
      collections: {
        "public-docs": {
          ...backendConfig.collections["public-docs"]!,
          hosts: ["user@public.test"],
        },
      },
    },
    { ...backendConfig, credentials: "forbidden" } as BackendConfig,
  ];
  for (const invalid of cases) expect(() => backendReleasePlan(backendOwnerConfig, "a".repeat(40), invalid)).toThrow();
  expect(() =>
    backendReleasePlan(
      {
        ...backendOwnerConfig,
        host: { ...backendOwnerConfig.host, target: "dbfr" },
      },
      "a".repeat(40),
      backendConfig,
    ),
  ).toThrow("VPS");
});
test("backend artifacts verify SDK/server/env bytes and reject extra files or symlink metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "backend-manifest-"));
  try {
    const plan = backendReleasePlan(backendOwnerConfig, "a".repeat(40), backendConfig);
    const server = "export const server = 1;";
    const serverSha = createHash("sha256").update(server).digest("hex");
    writeFileSync(join(root, "server.ts"), server);
    writeFileSync(join(root, "public-index.ts"), "export {};");
    writeFileSync(join(root, "public-index.env"), backendEnvironment(plan));
    const manifest = backendArtifactManifest(root, plan, serverSha);
    expect(manifest.files).toHaveLength(3);
    expect(manifest.bun).toBe(backendConfig.module.revision);
    expect(manifest.files[1]!.sha256).toBe(backendConfig.module.sha256);
    writeFileSync(join(root, "public-index.env"), backendEnvironment(plan) + "SECRET=forbidden\n");
    expect(() => backendArtifactManifest(root, plan, serverSha)).toThrow("checksum");
    writeFileSync(join(root, "public-index.env"), backendEnvironment(plan));
    writeFileSync(join(root, "public-index.ts"), "tampered");
    expect(() => backendArtifactManifest(root, plan, serverSha)).toThrow("checksum");
    writeFileSync(join(root, "public-index.ts"), "export {};");
    writeFileSync(join(root, "unexpected.json"), "{}");
    expect(() => backendArtifactManifest(root, plan, serverSha)).toThrow("declared");
    rmSync(join(root, "unexpected.json"));
    symlinkSync(root, join(root, "release-manifest.json"), "junction");
    expect(() => backendArtifactManifest(root, plan, serverSha)).toThrow("Unsafe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("backend activation is guarded, rollback-aware and native-shell syntax-valid", () => {
  const plan = backendReleasePlan(backendOwnerConfig, "a".repeat(40), backendConfig);
  const command = backendActivationCommand(plan, {
    archiveSha256: "d".repeat(64),
    serverSha256: "e".repeat(64),
    expectedServerSha256: "f".repeat(64),
    expectedCurrent: "absent",
    expectedEnvironmentSha256: "absent",
  });
  expect(command).toContain("Foreign server change preserved; rollback refused");
  expect(command).toContain("EnvironmentFile=-" + plan.environmentFile);
  expect(command).toContain("createPublicIndexSearch");
  expect(command).toContain("127.0.0.1:8797/api/index/search");
  expect(command.indexOf("trap 'status=$?")).toBeLessThan(command.indexOf(plan.server + ".pending'; mv"));
  expect(command).not.toContain("reload nginx");
  expect(command).not.toContain("daemon-reload");
  expect(command).not.toContain("ln -s 'releases/app-ui-");
  const previous = "releases/backend-" + "1".repeat(40) + "-" + "2".repeat(12) + "-" + "3".repeat(12);
  const restoreCommand = backendActivationCommand(plan, {
    archiveSha256: "d".repeat(64),
    serverSha256: "e".repeat(64),
    expectedServerSha256: "f".repeat(64),
    expectedCurrent: previous,
    expectedEnvironmentSha256: "9".repeat(64),
  });
  expect(restoreCommand).toContain("realpath -m -- '" + plan.base + "/" + previous + "'");
  expect(restoreCommand).toContain("public-index.env' | sha256sum -c - || return 2");
  expect(() =>
    backendActivationCommand(plan, {
      archiveSha256: "d".repeat(64),
      serverSha256: "e".repeat(64),
      expectedServerSha256: "f".repeat(64),
      expectedCurrent: "../foreign",
      expectedEnvironmentSha256: "absent",
    }),
  ).toThrow("guards");
  if (nativeShell && existsSync(nativeShell)) {
    const root = mkdtempSync(join(tmpdir(), "backend-shell-syntax-"));
    try {
      const script = join(root, "activation.sh");
      writeFileSync(script, command);
      const child = Bun.spawnSync([nativeShell, "-n", script]);
      expect(child.stderr.toString()).toBe("");
      expect(child.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
test.skipIf(!nativeShell || !existsSync(nativeShell))(
  "backend filesystem transaction rolls back failed HTTP smoke with mocked service/runtime",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "backend-rollback-"));
    const path = root.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => "/" + drive.toLowerCase());
    const owner = backendReleasePlan(backendOwnerConfig, "a".repeat(40), backendConfig);
    const plan = {
      ...owner,
      base: path + "/backend",
      release: path + "/backend/releases/" + owner.id,
      server: path + "/app/server.ts",
      module: path + "/backend/current/public-index.ts",
      environmentFile: path + "/backend/current/public-index.env",
      uiCurrent: path + "/app-ui/current",
      googleEnvironment: path + "/app-ui/current/google-search.env",
      settings: { ...owner.settings, root: path + "/public-index" },
    };
    try {
      for (const directory of [
        "backend/releases",
        "backend/backups",
        "app",
        "app-ui/releases/old",
        "public-index",
        "artifact",
      ])
        mkdirSync(join(root, directory), { recursive: true });
      symlinkSync(join(root, "app-ui/releases/old"), join(root, "app-ui/current"), "junction");
      writeFileSync(join(root, "app-ui/current/google-search.env"), "GOOGLE_SEARCH_OWNER=original\n");
      const originalUi = readlinkSync(join(root, "app-ui/current"));
      const originalEnv = readFileSync(join(root, "app-ui/current/google-search.env"), "utf8");
      const oldServer = "old-server";
      writeFileSync(join(root, "app/server.ts"), oldServer);
      writeFileSync(join(root, "artifact/server.ts"), "new-server");
      writeFileSync(join(root, "artifact/public-index.ts"), "export {};");
      writeFileSync(join(root, "artifact/public-index.env"), backendEnvironment(plan));
      const newServerSha = createHash("sha256").update("new-server").digest("hex");
      const files = backendArtifactManifest(join(root, "artifact"), plan, newServerSha).files;
      writeFileSync(
        join(root, "artifact/SHA256SUMS"),
        files.map(file => file.sha256 + "  " + file.path).join("\n") + "\n",
      );
      const archive = join(root, "backend", plan.id + ".tar.gz.pending");
      await run(["tar", "-czf", archive, "-C", join(root, "artifact"), "."]);
      const script = join(root, "rollback.sh");
      const mock = `systemctl() { if test "$1" = cat; then printf '%s\\n' 'EnvironmentFile=-${plan.environmentFile}' 'ExecStart=/home/ubuntu/.bun/bin/bun ${plan.server}'; fi; }\nsudo() { "$@"; }\ncurl() { case "$*" in *api/index/search?*) printf 503;; *api/index/search*) printf 404;; *) return 0;; esac; }\n`;
      const command = backendActivationCommand(plan, {
        archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
        serverSha256: newServerSha,
        expectedServerSha256: createHash("sha256").update(oldServer).digest("hex"),
        expectedCurrent: "absent",
        expectedEnvironmentSha256: "absent",
      }).replace("'/home/ubuntu/.bun/bin/bun' -e", "true -e");
      writeFileSync(script, mock + command);
      const child = Bun.spawn([nativeShell!, script], {
        env: { ...process.env, MSYS: "winsymlinks:nativestrict" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(stderr).not.toContain("syntax error");
      expect(code).not.toBe(0);
      expect(readFileSync(join(root, "app/server.ts"), "utf8")).toBe(oldServer);
      expect(readFileSync(join(root, "backend/backups", plan.id, "server.ts"), "utf8")).toBe(oldServer);
      expect(existsSync(join(root, "backend/current"))).toBe(false);
      expect(readlinkSync(join(root, "app-ui/current"))).toBe(originalUi);
      expect(readFileSync(join(root, "app-ui/current/google-search.env"), "utf8")).toBe(originalEnv);
      // The module and service/HTTP calls above are deliberately mocked. This
      // qualifies filesystem rollback, not live SDK/Google/host activation.
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
test("canonical Tauri exports typed sources directly without obsolete generation", async () => {
  const manifest = await Bun.file(join(repository, "packages/bun-tauri/package.json")).json();
  expect(manifest.exports["./api"]).toBe("./js/api/index.ts");
  expect(Bun.resolveSync("@aphrody/tauri/api", repository)).toBe(
    join(repository, "packages/bun-tauri/js/api/index.ts"),
  );
  expect(Bun.resolveSync("@aphrody/tauri/plugins/dialog", repository)).toBe(
    join(repository, "packages/bun-tauri/js/plugins/dialog.ts"),
  );
  expect(prerequisiteCommands().flat()).not.toContain("../build-js.ts");
});

test("release source gates cover existing flat owners and canonical runtime overrides", () => {
  for (const path of [...uiSourcePaths, serverSource]) expect(existsSync(join(repository, path))).toBe(true);
  expect(downloadsConfig).toBe("tools/aphrody/config/downloads.json");
  expect(releaseBunCheckout(repository, {})).toBe(join(repository, "sources/bun"));
  expect(releaseBunCheckout(repository, { APHRODY_BUN_CHECKOUT: repository })).toBe(repository);
  expect(uiSourcePaths).toContain("packages");
  expect(uiSourcePaths).toContain("apps/aphrody-app");
});
test("failed build commands retain bounded stdout and stderr compiler diagnostics", async () => {
  await expect(
    run([
      "bun",
      "-e",
      "console.log('x'.repeat(5000)+'compiler stdout diagnostic');console.error('compiler stderr diagnostic');process.exit(2)",
    ]),
  ).rejects.toThrow("compiler stdout diagnostic");
  try {
    await run([
      "bun",
      "-e",
      "console.log('x'.repeat(5000)+'compiler stdout diagnostic');console.error('compiler stderr diagnostic');process.exit(2)",
    ]);
    throw new Error("Fixture failure was not reported");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("compiler stderr diagnostic");
    expect((error as Error).message.length).toBeLessThan(3020);
  }
});
test("Bun prerequisites and builds execute the exact selected runtime without changing Infra or Git", () => {
  const command = runtimeCommand([
    "bun",
    "-e",
    "console.log(JSON.stringify({executable:process.execPath,version:Bun.version}))",
  ]);
  const child = Bun.spawnSync(command);
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual({
    executable: process.execPath,
    version: Bun.version,
  });
  for (const prerequisite of prerequisiteCommands()) expect(runtimeCommand(prerequisite)[0]).toBe(process.execPath);
  expect(runtimeCommand(buildCommand("C:/artifact"))).toEqual([
    process.execPath,
    "packages/app-ui/build.ts",
    "--out",
    "C:/artifact",
  ]);
  expect(runtimeCommand(["git", "rev-parse", "HEAD"])).toEqual(["git", "rev-parse", "HEAD"]);
  expect(runtimeCommand(["aphrody", "infra", "ssh", "exec"])).toEqual(["aphrody", "infra", "ssh", "exec"]);
});
test("clean builds prepare identity through its canonical owner, without setup hooks", () => {
  expect(prerequisiteCommands()).toEqual([
    ["bun", "scripts/m3/fonts-sync.ts", "--quiet"],
    ["bun", "scripts/m3/fonts-sync.ts", "--check", "--quiet"],
    ["bun", "--cwd", "packages/identity", "scripts/sprite.ts"],
  ]);
  expect(prerequisiteCommands().flat()).not.toContain("install");
});
test.skipIf(!nativeShell || !existsSync(nativeShell))(
  "native shell writes valid JSON with a real trailing newline",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "app-ui-declaration-test-"));
    try {
      const process = Bun.spawn([nativeShell!, "-c", declarationCommand("deployment.json")], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await process.exited).toBe(0);
      const bytes = readFileSync(join(root, "deployment.json"), "utf8");
      expect(bytes).toBe('{"schemaVersion":1,"root":"current"}\n');
      expect(JSON.parse(bytes)).toEqual({ schemaVersion: 1, root: "current" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("remote declaration emits one printf escape and health checks precede trap dismissal", () => {
  const command = declarationCommand("/home/ubuntu/apps/downloads/app-ui/deployment.json.pending");
  expect(command).toContain("printf '%s" + String.fromCharCode(92) + "n'");
  expect(command).not.toContain("%s" + String.fromCharCode(92, 92) + "n");
  expect(command).toContain('{"schemaVersion":1,"root":"current"}');
  const smoke = smokeCommand("/home/ubuntu/apps/downloads/app-ui/backups/test");
  expect(smoke).toContain("--retry-max-time 15");
  expect(smoke).toContain("127.0.0.1:8797/health");
  expect(smoke).toContain("127.0.0.1:8797/os");
  expect(smoke).toContain('name="aphrody-rpc" content="unavailable"');
  expect(smoke).not.toContain("Cookie");
});
const revision = "a".repeat(40);
const config: ReleaseConfig = {
  host: { target: "dbfr", root: "/home/ubuntu/apps/downloads" },
  site: {
    appUi: {
      directory: "app-ui",
      declaration: "app-ui/deployment.json",
      nativeRpc: false,
    },
  },
};
test("public assets flag reaches the real owner build and binds artifact provenance", () => {
  expect(buildCommand("C:/artifact", true)).toEqual([
    "bun",
    "packages/app-ui/build.ts",
    "--out",
    "C:/artifact",
    "--public-assets",
  ]);
  expect(buildCommand("C:/artifact")).not.toContain("--public-assets");
  const original = {
    revision,
    publicAssets: true,
    files: [{ path: "app.js", sha256: "abc" }],
  };
  expect(() => verifyArtifactProvenance(original, { ...original, publicAssets: false })).toThrow("provenance");
  expect(() =>
    verifyArtifactProvenance(original, {
      ...original,
      files: [{ path: "app.js", sha256: "changed" }],
    }),
  ).toThrow("checksum");
  verifyArtifactProvenance(original, original);
});
test("dry-run plan stays in the declared downloads service and refuses proxy/host drift", () => {
  const plan = releasePlan(config, revision);
  expect(plan.release).toBe("/home/ubuntu/apps/downloads/app-ui/releases/app-ui-" + revision);
  expect(plan.restart).toContain("sudo systemctl restart 'aphrody-downloads.service'");
  expect(plan.restart).toContain("systemctl is-active --quiet");
  expect(plan.nativeRpc).toBe(false);
  expect(() => releasePlan(config, "main")).toThrow("exact");
  expect(() => releasePlan({ ...config, host: { ...config.host, root: "/" } }, revision)).toThrow("catalog");
  expect(() =>
    releasePlan({ ...config, site: { appUi: { ...config.site.appUi, nativeRpc: true } } }, revision),
  ).toThrow("isolation");
});
test("manifest verifies completeness and records changed bytes with exact source provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "app-ui-manifest-test-"));
  try {
    expect(() => artifactManifest(root, revision)).toThrow("Incomplete");
    for (const name of ["index.html", "public-home.html", "app.js", "app.css", "public-docs.json"])
      writeFileSync(join(root, name), name);
    mkdirSync(join(root, "fonts"));
    writeFileSync(join(root, "fonts/font.woff2"), "font");
    const before = artifactManifest(root, revision);
    expect(before.revision).toBe(revision);
    expect(before.files).toHaveLength(6);
    expect(() => artifactManifest(root, revision, true)).toThrow("public assets declaration");
    writeFileSync(join(root, "public-assets.json"), '{"schemaVersion":1}');
    expect(artifactManifest(root, revision, true).publicAssets).toBe(true);
    writeFileSync(join(root, "app.js"), "changed");
    expect(artifactManifest(root, revision).files.find(file => file.path === "app.js")?.sha256).not.toBe(
      before.files.find(file => file.path === "app.js")?.sha256,
    );
    symlinkSync(root, join(root, "escape"), "junction");
    expect(() => artifactManifest(root, revision)).toThrow("unsafe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Google deployment binds the SDK and environment to the same rollback symlink", () => {
  const withSearch: ReleaseConfig = {
    ...config,
    site: {
      appUi: {
        ...config.site.appUi,
        googleSearch: {
          owner: "/home/ubuntu/.local/bin/aphrody",
          module: "current/google-search.ts",
          environmentFile: "current/google-search.env",
        },
      },
    },
  };
  const plan = releasePlan(withSearch, revision);
  expect(plan.search?.environmentFile).toBe(plan.base + "/current/google-search.env");
  expect(searchEnvironment(plan.search!.module, plan.search!.owner)).toBe(
    "GOOGLE_SEARCH_SDK_MODULE=" +
      plan.base +
      "/current/google-search.ts\nGOOGLE_SEARCH_OWNER=/home/ubuntu/.local/bin/aphrody\n",
  );
  expect(() => searchEnvironment("/tmp/foreign.ts", plan.search!.owner)).toThrow("owner");
  expect(() => releasePlan({ ...withSearch, host: { ...config.host, service: "foreign" } }, revision)).toThrow(
    "service",
  );
});

test("Bun transferred docs and packaged Google source require verified checksums", () => {
  const root = mkdtempSync(join(tmpdir(), "app-ui-bun-receipt-"));
  try {
    const destination = "packages/web/rust/crates/site/data/docs.json";
    mkdirSync(join(root, "packages/web/rust/crates/site/data"), {
      recursive: true,
    });
    mkdirSync(join(root, "packages/bun-google/src"), { recursive: true });
    writeFileSync(join(root, "packages/web/rust/crates/site/data/docs.json"), "[]");
    writeFileSync(join(root, "packages/bun-google/src/search.ts"), "export {};");
    const hash = createHash("sha256").update("[]").digest("hex");
    writeFileSync(
      join(root, "packages/web/rust/transfer-receipt.json"),
      JSON.stringify({
        schemaVersion: 1,
        sourceCommit: revision,
        files: [
          {
            source: "crates/web/site/data/docs.json",
            destination,
            sha256: hash,
          },
        ],
      }),
    );
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, timeout: 10_000 });
      if (result.exitCode !== 0) throw new Error("Fixture Git operation failed");
      return result.stdout.toString().trim();
    };
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "fixture inputs",
    );
    const pinnedRevision = git("rev-parse", "HEAD");
    const inputs = canonicalBunInputs(root, pinnedRevision);
    expect(inputs.docs.sha256).toBe(hash);
    expect(inputs.search.path).toBe("packages/bun-google/src/search.ts");
    const artifact = join(root, "artifact");
    mkdirSync(join(artifact, "fonts"), { recursive: true });
    for (const name of [
      "index.html",
      "public-home.html",
      "app.js",
      "app.css",
      "public-docs.json",
      "fonts/fixture.woff2",
    ])
      writeFileSync(join(artifact, name), "fixture");
    writeFileSync(join(artifact, "google-search.ts"), "export {};");
    expect(artifactManifest(artifact, pinnedRevision, false, inputs).sources?.bun).toBe(pinnedRevision);
    writeFileSync(join(artifact, "google-search.ts"), "altered");
    expect(() => artifactManifest(artifact, revision, false, inputs)).toThrow("search source checksum");
    expect(() => canonicalBunInputs(root, "main")).toThrow("revision");
    writeFileSync(join(root, destination), "changed");
    expect(() => canonicalBunInputs(root, pinnedRevision)).toThrow("pinned Git blob");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
