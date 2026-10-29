/* oxlint-disable eslint/no-await-in-loop -- recipes run one after another against one fixture */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const just = Bun.which("just");
const profileTest = just !== null && process.platform !== "win32" ? test : test.skip;
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "yolo profiles "));
  fixtures.push(dir);
  const log = join(dir, "calls.jsonl");
  const wrapper = join(dir, "cargo owner");
  const bin = join(dir, "bin");
  const recorder = `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.YOLO_PROFILE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`;
  await Bun.write(wrapper, recorder);
  await chmod(wrapper, 0o700);
  await mkdir(bin);
  const rustup = join(bin, "rustup");
  await Bun.write(
    rustup,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.YOLO_PROFILE_PREFLIGHT_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.YOLO_PROFILE_MISSING_NIGHTLY === "1") process.exit(1);
`,
  );
  await chmod(rustup, 0o700);
  return {
    dir,
    log,
    wrapper,
    recorder,
    bin,
    preflightLog: join(dir, "preflight.jsonl"),
  };
}

async function runRecipes(
  setup: Awaited<ReturnType<typeof fixture>>,
  recipes: string[],
  workingDirectory = root,
  environment: Record<string, string> = {},
) {
  const child = Bun.spawn(
    [
      just!,
      "--shell",
      "bash",
      "--clear-shell-args",
      "--shell-arg",
      "-c",
      "--justfile",
      join(workingDirectory, "packages/engine/yolo/yolo.just"),
      ...recipes,
    ],
    {
      windowsHide: true,
      cwd: workingDirectory,
      env: {
        ...process.env,
        YOLO_CARGO_WRAPPER: setup.wrapper,
        YOLO_PROFILE_LOG: setup.log,
        YOLO_PROFILE_PREFLIGHT_LOG: setup.preflightLog,
        APHRODY_BUN_CHECKOUT: join(setup.dir, "qualified bun fork"),
        PATH: `${setup.bin}:${process.env.PATH}`,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr };
}

async function calls(log: string): Promise<string[][]> {
  return (await Bun.file(log).text())
    .trim()
    .split("\n")
    .map(line => JSON.parse(line) as string[]);
}

/** Package names of the manifests under crates/, skipping dependency and build trees (slow on bind mounts). */
async function workspacePackageNames(): Promise<string[]> {
  const manifests: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async entry => {
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "target" && !entry.name.startsWith("."))
            await walk(join(dir, entry.name));
        } else if (entry.name === "Cargo.toml") manifests.push(join(dir, entry.name));
      }),
    );
  };
  await walk(join(root, "crates"));
  const names = await Promise.all(
    manifests.map(async path => {
      const manifest = Bun.TOML.parse(await Bun.file(path).text()) as {
        package?: { name?: string };
      };
      return manifest.package?.name;
    }),
  );
  return names.filter((name): name is string => Boolean(name));
}

function packages(args: string[]): string[] {
  return args.flatMap((value, index) => (value === "-p" ? [args[index + 1]!] : []));
}

profileTest("historical full ship refuses a missing factory contract before bootstrap", async () => {
  const setup = await fixture();
  await mkdir(join(setup.dir, "scripts/release"), { recursive: true });
  await Bun.write(join(setup.dir, "VERSION"), "0.0.0\n");
  await Bun.write(
    join(setup.dir, "scripts/release/bootstrap_remote.sh"),
    "#!/usr/bin/env bash\nprintf started > bootstrap.started\nexit 98\n",
  );
  for (const environment of [
    { APHRODY_BUILD_HOST: "", YOLO_CARGO_WRAPPER: setup.wrapper },
    {
      APHRODY_BUILD_HOST: "vps",
      YOLO_CARGO_WRAPPER: join(setup.dir, "missing owner"),
    },
  ]) {
    const child = Bun.spawn(["bash", join(root, "scripts/release/ship_remote.sh"), "fixture", setup.dir, setup.dir], {
      windowsHide: true,
      cwd: setup.dir,
      env: { ...process.env, ...environment },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    expect(exitCode, stderr).toBe(64);
    expect(await Bun.file(join(setup.dir, "bootstrap.started")).exists()).toBe(false);
    expect(await Bun.file(join(setup.dir, "STATUS")).exists()).toBe(false);
  }
});

profileTest("core recipes execute only the minimal packages through the declared Cargo owner", async () => {
  const setup = await fixture();
  const result = await runRecipes(setup, ["rust-fmt-check", "check-core", "clippy", "test-crates", "runtime-build"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const [formatter, ...commands] = await calls(setup.log);
  expect(formatter).toEqual(["fmt", "--check", "-p", "yolo-core", "-p", "yolo-runtime"]);
  expect(commands.map(args => args[0])).toEqual(["check", "clippy", "nextest", "build"]);
  for (const args of commands) {
    expect(args).toContain("--locked");
    expect(args).toContain("--no-default-features");
    expect(args).not.toContain("--workspace");
    if (args[0] === "build") {
      // The runtime artifact is the single C-ABI library, with the yolo_* browser exports.
      expect(packages(args)).toEqual(["aphrody-ffi"]);
      expect(args[args.indexOf("--features") + 1]).toBe("browser,tooling");
    } else {
      expect(args).not.toContain("--features");
      expect(packages(args).toSorted()).toEqual(["yolo-core", "yolo-runtime"]);
    }
  }
  expect(commands[1]!.slice(-3)).toEqual(["--", "-D", "warnings"]);
});

profileTest("provider recipes keep desktop, browser, Python and upstream selections explicit", async () => {
  const setup = await fixture();
  const result = await runRecipes(setup, [
    "qualify-desktop",
    "qualify-browser",
    "check-python",
    "clippy-python",
    "test-python-crate",
    "qualify-upstream",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  const executed = await calls(setup.log);
  const formatters = executed.filter(args => args[0] === "fmt");
  expect(formatters).toContainEqual(["fmt", "--check", "-p", "aphrody-app"]);
  expect(formatters).toContainEqual(["fmt", "--check", "-p", "yolo-core", "-p", "yolo-runtime"]);
  expect(formatters).toContainEqual(["fmt", "--all", "--check"]);
  const commands = executed.filter(args => args[0] !== "fmt");
  expect(commands).toHaveLength(11);
  for (const args of commands) expect(args).toContain("--locked");
  for (const args of commands.slice(0, 3)) expect(packages(args)).toEqual(["aphrody-app"]);
  for (const args of commands.slice(3, 6)) {
    expect(packages(args)).toEqual(["yolo-runtime"]);
    expect(args[args.indexOf("--features") + 1]).toBe("browser");
  }
  for (const args of commands.slice(6, 9)) {
    expect(packages(args)).toEqual(["yolo-pyo3"]);
    expect(args[args.indexOf("--manifest-path") + 1]).toBe(
      join(setup.dir, "qualified bun fork", "packages/bun-runtime-sdk/Cargo.toml"),
    );
  }

  // Every upstream selector still names a workspace package.
  const names = await workspacePackageNames();
  for (const pattern of packages(commands[10]!)) {
    const glob = new Bun.Glob(pattern);
    expect(
      names.some(name => glob.match(name)),
      pattern,
    ).toBe(true);
  }
});

profileTest("factory recipes dispatch a pinned profile through the native owner and reject invalid input", async () => {
  const setup = await fixture();
  await Bun.write(
    join(setup.dir, "packages/engine/yolo/yolo.just"),
    Bun.file(join(root, "packages/engine/yolo/yolo.just")),
  );
  const yolo = join(setup.dir, "bin/aphrody");
  await Bun.write(yolo, setup.recorder);
  await chmod(yolo, 0o700);
  const revision = "a".repeat(40);
  const result = await runRecipes(setup, ["factory", "desktop", revision], setup.dir);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(await calls(setup.log)).toEqual([
    ["ops", "build-factory", "run", "--repo", "yolo", "--revision", revision, "--", "just", "qualify-desktop"],
  ]);
  const bun = await runRecipes(setup, ["factory", "bun", revision], setup.dir);
  expect(bun.exitCode, bun.stderr).toBe(0);
  expect((await calls(setup.log))[1]).toEqual([
    "ops",
    "build-factory",
    "run",
    "--repo",
    "yolo",
    "--revision",
    revision,
    "--",
    "just",
    "qualify-upstream",
  ]);
  for (const args of [
    ["invalid", revision],
    ["browser", "main"],
  ]) {
    const rejected = await runRecipes(setup, ["factory", ...args], setup.dir);
    expect(rejected.exitCode).not.toBe(0);
  }
  expect(await calls(setup.log)).toHaveLength(2);
});
