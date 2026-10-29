// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { suffix } from "bun:ffi";
import { stageNativeConsumer } from "../../src/automation/bun-native.ts";

const builder = join(import.meta.dir, "../../src/automation/bun-native.ts");

test("SDK staging resolves transitive source dependencies without copying runtime state", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-sdk-closure-"));
  try {
    const consumer = join(root, "consumer");
    const helper = join(consumer, "node_modules/@fixture/helper");
    const leaf = join(helper, "node_modules/@fixture/leaf");
    const packages = [
      [consumer, "@aphrody/bun", "@fixture/helper", 'export { value } from "@fixture/helper";'],
      [helper, "@fixture/helper", "@fixture/leaf", 'export { value } from "@fixture/leaf";'],
      [leaf, "@fixture/leaf", "", "export const value = 42;"],
    ] as const;
    await Promise.all(
      packages.map(async ([path, name, dependency, code]) => {
        await mkdir(join(path, "src"), { recursive: true });
        await writeFile(
          join(path, "package.json"),
          JSON.stringify({
            name,
            main: "src/index.ts",
            type: "module",
            dependencies: dependency ? { [dependency]: "1.0.0" } : {},
          }),
        );
        await writeFile(join(path, "src/index.ts"), code);
        await writeFile(join(path, "runtime-state.json"), "fixture-only");
      }),
    );
    const staged = await stageNativeConsumer(consumer, join(root, "isolated"));
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      const { value } = await import(${JSON.stringify(join(staged, "src/index.ts"))});
      if (value !== 42) throw new Error("wrong staged dependency result");
    `,
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    expect(child.exitCode).toBe(0);
    expect(child.stderr.toString()).toBe("");
    expect(await Bun.file(join(root, "isolated/node_modules/@fixture/leaf/src/index.ts")).text()).toBe(
      "export const value = 42;",
    );
    expect(await Bun.file(join(staged, "runtime-state.json")).exists()).toBe(false);
    expect(existsSync(join(staged, "node_modules"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// A workstation that exports the root of another checkout must not decide which aphrody.config.json the builder reads.
const hostRoots = ["BUN_OS_ROOT", "APHRODY_ROOT", "APHRODY_WORKSPACE_ROOT", "APHRODY_MONOREPO_ROOT", "APHRODY_BUN_CHECKOUT"];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !hostRoots.includes(key)));

async function run(args: string[], env: Record<string, string | undefined> = cleanEnv()) {
  const child = Bun.spawn([process.execPath, builder, ...args], {
    windowsHide: true,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-native-builder-"));
  const ffi = join(root, "crates/aphrody-ffi");
  const consumer = join(root, "packages/aphrody-bun");
  await mkdir(join(ffi, "src"), { recursive: true });
  await mkdir(join(consumer, "src"), { recursive: true });
  const wrapper =
    process.platform === "win32"
      ? "scripts/aphrody/build/rust/cargo-serial.ts"
      : "scripts/aphrody/build/rust/cargo-serial.sh";
  const serialScript = join(root, wrapper);
  await mkdir(dirname(serialScript), { recursive: true });
  await cp(join(import.meta.dir, "../../../..", wrapper), serialScript);
  await cp(join(import.meta.dir, "../../../..", "aphrody.config.json"), join(root, "aphrody.config.json"));
  await writeFile(join(root, "Cargo.toml"), '[workspace]\nresolver="3"\nmembers=["crates/aphrody-ffi"]\n');
  await writeFile(
    join(ffi, "Cargo.toml"),
    '[package]\nname="aphrody-ffi"\nversion="1.0.0"\nedition="2024"\n[features]\ngpu=[]\n[lib]\ncrate-type=["cdylib"]\n',
  );
  await writeFile(join(ffi, "src/lib.rs"), "");
  await writeFile(join(consumer, "package.json"), '{"name":"@aphrody/bun","version":"1.0.0","type":"module"}');
  await Promise.all(
    ["library.ts", "index.ts", "n2b.ts", "oxc.ts"].map(file => writeFile(join(consumer, "src", file), "export {};\n")),
  );
  await writeFile(
    join(consumer, "src/native-artifact.ts"),
    "export const NATIVE_ABI_VERSIONS = { aphrody_abi_version: 1 };\n",
  );
  for (const args of [
    ["init", "--quiet"],
    [
      "-c",
      "user.name=aphrody-code",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "test: initialize native builder fixture",
    ],
  ]) {
    const result = Bun.spawnSync(["git", "-C", root, ...args], {
      windowsHide: true,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }
  return { root, ffi, consumer };
}

test("inference builds reject a crate that lacks its native model owner", async () => {
  const { root } = await fixture();
  try {
    const result = await run([`--root=${root}`, "--inference", "--unlocked"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("aphrody-ffi does not expose the native llama inference owner");
    expect(existsSync(join(root, "target"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native builder rejects legacy/unknown options without touching a source", async () => {
  expect(await run(["--root", "/missing", "--debug"])).toEqual({
    stdout: "",
    stderr:
      "bun-native: unknown argument --root\nusage: bun-native [--root=<monorepo>] [--package-root=<consumer>] [--debug] [--gpu] [--jobs] [--inference] [--offline] [--unlocked] [--stage-existing=<debug-artifact>] [--artifact-sha256=<hex>]\n",
    code: 2,
  });
});

test("native builder fails before build when the serialization wrapper is absent", async () => {
  const { root } = await fixture();
  try {
    await rm(
      join(
        root,
        process.platform === "win32"
          ? "scripts/aphrody/build/rust/cargo-serial.ts"
          : "scripts/aphrody/build/rust/cargo-serial.sh",
      ),
    );
    const result = await run([`--root=${root}`, "--debug", "--offline", "--unlocked"], {
      ...cleanEnv(),
      CARGO_TARGET_DIR: join(root, "target"),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Cargo serialization wrapper missing");
    expect(result.stdout).not.toContain("[bun-native]");
    expect(
      await Bun.file(
        join(root, "target/debug", `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`),
      ).exists(),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native builder requires the aggregate monorepo owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-native-missing-"));
  try {
    expect(await run([`--root=${root}`, "--debug"])).toEqual({
      stdout: "",
      stderr: `bun-native: aggregate crate missing: ${join(root, "crates/aphrody-ffi/Cargo.toml")}\n`,
      code: 1,
    });
    expect(await Bun.file(join(root, "packages/aphrody-bun/native/manifest.json")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing artifacts cannot claim release or GPU qualification", async () => {
  const results = await Promise.all(
    [[], ["--debug", "--gpu"]].map(flags => run(["--stage-existing=/missing", ...flags])),
  );
  for (const result of results) {
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("requires --debug and forbids --gpu");
  }
});

async function waitForMarker(path: string, expires: number): Promise<string> {
  if (await Bun.file(path).exists()) return Bun.file(path).text();
  if (Date.now() > expires) throw new Error("fake Cargo did not start its descendant");
  await Bun.sleep(25);
  return waitForMarker(path, expires);
}

test.skipIf(process.platform !== "linux")(
  "SIGTERM stops the owned Cargo process tree and preserves wrapper",
  async () => {
    const { root, ffi } = await fixture();
    const binaryDirectory = join(root, "bin");
    const marker = join(root, "cargo-tree.json");
    await mkdir(binaryDirectory);
    const metadata = {
      packages: [
        {
          id: "fake-owner",
          name: "aphrody-ffi",
          version: "1.0.0",
          manifest_path: join(ffi, "Cargo.toml"),
          features: { gpu: [] },
        },
      ],
      target_directory: join(root, "target"),
    };
    const fakeCargo = join(binaryDirectory, "cargo");
    await writeFile(
      fakeCargo,
      `#!${process.execPath}\n
    if (process.argv[2] === "metadata") { console.log(${JSON.stringify(JSON.stringify(metadata))}); }
    else {
      const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" });
      await Bun.write(${JSON.stringify(marker)}, JSON.stringify({ cargo: process.pid, descendant: child.pid, wrapper: process.env.RUSTC_WRAPPER, jobs: process.env.CARGO_BUILD_JOBS, incremental: process.env.CARGO_INCREMENTAL }));
      setInterval(() => {}, 1000);
    }
  `,
    );
    await chmod(fakeCargo, 0o755);
    const child = Bun.spawn([process.execPath, builder, `--root=${root}`, "--debug", "--offline", "--unlocked"], {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: binaryDirectory + ":" + process.env.PATH,
        RUSTC_WRAPPER: "/inherited-wrapper",
        // A private lock keeps the fake build from queueing behind real Cargo work on the host.
        APHRODY_CARGO_LOCK_DIR: join(root, "lock"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    let descendants:
      | {
          cargo: number;
          descendant: number;
          wrapper: string;
          jobs: string;
          incremental: string;
        }
      | undefined;
    try {
      descendants = JSON.parse(await waitForMarker(marker, Date.now() + 10_000));
      // cargo-serial.sh defaults to 6 jobs, or to the CPU count (max 6) in a Claude cloud session.
      const cloud = process.env.CLAUDE_CODE_REMOTE === "true" || process.env.APHRODY_CLOUD === "1";
      const defaultJobs = cloud ? String(Math.min(availableParallelism(), 6)) : "6";
      expect(descendants?.jobs).toBe(process.env.APHRODY_CARGO_JOBS ?? defaultJobs);
      expect(descendants?.incremental).toBe("0");
      child.kill("SIGTERM");
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(1);
      expect(stdout).toContain("cargo build");
      expect(stderr).toContain("native operation aborted");
      expect(descendants!.wrapper).toBe("/inherited-wrapper");
      const states = await Promise.all(
        [descendants!.cargo, descendants!.descendant].map(pid =>
          Bun.file(`/proc/${pid}/stat`)
            .text()
            .catch(() => ""),
        ),
      );
      for (const state of states) {
        // A killed child can briefly remain a zombie until its adopting init reaps it.
        expect(state === "" || /\) Z /.test(state)).toBe(true);
      }
      const markers = await Array.fromAsync(new Bun.Glob("**/manifest.json").scan({ cwd: root }));
      expect(markers).toEqual([]);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await child.exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  15_000,
);

test("expected artifact checksum is only accepted for explicitly reused artifacts", async () => {
  const result = await run([`--artifact-sha256=${"a".repeat(64)}`]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("--artifact-sha256 requires --stage-existing");
});

test("native builder refuses a foreign consumer before Cargo or staging", async () => {
  const { root, consumer } = await fixture();
  try {
    await writeFile(join(consumer, "package.json"), '{"name":"@foreign/package"}');
    expect(await run([`--root=${root}`, "--debug", "--offline", "--unlocked"])).toEqual({
      stdout: "",
      stderr: `bun-native: consumer is not @aphrody/bun: ${consumer}\n`,
      code: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native builder requires actual GPU forwarding rather than accepting an unused feature", async () => {
  const { root } = await fixture();
  try {
    expect(await run([`--root=${root}`, "--gpu", "--debug", "--offline", "--unlocked"])).toEqual({
      stdout: "",
      stderr: "bun-native: aphrody-ffi does not forward the GPU feature to aphrody-bun\n",
      code: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("jobs qualification requires actual forwarding and cannot attest reused artifacts", async () => {
  const { root } = await fixture();
  try {
    const missing = await run([`--root=${root}`, "--jobs", "--offline", "--unlocked"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("does not forward the jobs feature");
    const reused = await run(["--debug", "--jobs", "--stage-existing=/missing"]);
    expect(reused.code).toBe(1);
    expect(reused.stderr).toContain("forbids --jobs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const nativeRoot = process.env.APHRODY_NATIVE_TEST_ROOT;
const existingArtifact = process.env.APHRODY_NATIVE_TEST_ARTIFACT;
// Existing-debug gates prove staging/loadability, separately from Cargo build/source closure.
test.skipIf(!nativeRoot)(
  "native builder stages a hash-verified real aggregate into an isolated consumer",
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "aphrody-native-clean-"));
    try {
      const consumer = join(temporary, "consumer");
      const source = join(nativeRoot!, "packages/aphrody-bun");
      await mkdir(consumer, { recursive: true });
      await cp(join(source, "src"), join(consumer, "src"), { recursive: true });
      await cp(join(source, "package.json"), join(consumer, "package.json"));
      const result = await run([
        `--root=${nativeRoot}`,
        `--package-root=${consumer}`,
        "--debug",
        "--offline",
        ...(existingArtifact ? [`--stage-existing=${existingArtifact}`] : []),
        ...(process.env.APHRODY_NATIVE_TEST_SHA256
          ? [`--artifact-sha256=${process.env.APHRODY_NATIVE_TEST_SHA256}`]
          : []),
      ]);
      expect(result.stderr).not.toContain("bun-native:");
      expect(result.code).toBe(0);
      const markers = await Array.fromAsync(new Bun.Glob("native/**/manifest.json").scan({ cwd: consumer }));
      expect(markers).toHaveLength(1);
      const marker = join(consumer, markers[0]!);
      const manifest = JSON.parse(await readFile(marker, "utf8"));
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        package: "@aphrody/bun",
        crate: "aphrody-ffi",
        profile: "debug",
        features: existingArtifact ? null : [],
        provenance: existingArtifact ? "existing-debug" : "cargo-build",
        consumerSmoke: "passed",
      });
      expect(manifest.abi).toMatchObject({
        aphrody_abi_version: 1,
        node2bun_abi_version: 2,
        aphrody_oxc_abi_version: 1,
        bun_rs_abi_version: 1,
      });
      const artifact = join(dirname(marker), manifest.artifact);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(artifact)) hash.update(chunk);
      expect(manifest.sha256).toBe(hash.digest("hex"));
      expect(manifest.bytes).toBe(Bun.file(artifact).size);
      expect(manifest.cargoLockSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.observedSourceHead).toMatch(/^[a-f0-9]{40}$/);
      if (existingArtifact) {
        expect(manifest.buildSourceHead).toBeNull();
        expect(manifest.version).toBeNull();
      }
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `
      const { loadNativeLibrary, closeNativeLibrary } = await import(${JSON.stringify(join(consumer, "src/library.ts"))});
      const library = loadNativeLibrary();
      if (library.symbols.bun_rs_add(2, 3) !== 5) throw new Error("wrong native result");
      const shared = globalThis[Symbol.for("aphrody.ffi.library.v1")];
      console.log(shared.path);
      closeNativeLibrary();
    `,
        ],
        {
          windowsHide: true,
          cwd: temporary,
          env: {
            ...process.env,
            APHRODY_FFI_LIB: undefined,
            APHRODY_FFI_DEV: "1",
            CARGO_TARGET_DIR: join(temporary, "no-cargo-artifacts"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ stdout, stderr, code }).toEqual({
        stdout: artifact + "\n",
        stderr: "",
        code: 0,
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
  180_000,
);
