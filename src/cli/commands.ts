// SPDX-License-Identifier: Apache-2.0
// Every Bun OS command, defined once. package.json scripts are aliases of these; nothing else hard-codes a path.
import { existsSync } from "node:fs";
import { abs, define, native, script, sequence, spawn, root, type Command } from "./registry.ts";

const workspaceCli = "packages/bun-workspace/src/cli.ts";

/** Ignore patterns shared by lint and format (previously repeated in three package.json scripts). */
const FORMAT_IGNORE = [
  "**/*.html",
  "**/*.inc",
  "**/*.wxs",
  "**/.clang-*",
  "factory/bunos/pkgbuilds/**",
  "packages/re/**",
  // Byte copies of the @napi-rs/canvas npm files, checked against the registry by the canvas prepack.
  "packages/canvas/vendor/**",
  "packages/iecode-cpp/**",
  "packages/niepy/**",
  "packages/nie-blender/**",
  "vendor/dbxv2/**",
  "packages/iecode-scripts/**",
  "packages/iecode-docs/**",
  "packages/bun-tauri/crates/aphrody-tauri-cli/templates/**",
].flatMap(p => ["--ignore-pattern", p]);
const FORMAT_PATHS = ["src", "container", "factory", "infra", "packages", "apps/desktop", "scripts"];
const LINT_PATHS = ["src", "container", "factory", "infra", "packages", "apps", "scripts"];

/** `node_modules/.bin/<name>` of the root install (turbo and similar unrelated tools). */
function localBin(name: string): string {
  const base = abs(`node_modules/.bin/${name}`);
  return process.platform === "win32" && existsSync(`${base}.exe`) ? `${base}.exe` : base;
}

const viaFactory = (verb: string, ...fixed: string[]): Pick<Command, "target" | "run"> => ({
  target: "src/cli/factory.ts",
  run: async args => (await import("./factory.ts")).runFactoryCli([verb, ...fixed, ...args]),
});

const bunRun = (cwd: string, scriptName: string) => ({
  target: `${cwd}/package.json`,
  run: (args: string[]) => spawn([process.execPath, "run", "--cwd", abs(cwd), scriptName, ...args]),
});

define(
  // Top level ---------------------------------------------------------------------------------
  {
    group: "",
    name: "design",
    summary: "Search UI/UX guidance and generate M3 design systems",
    usage: "<query> [--stack m3] [options] | compile --prompt <brief> [--color <hex>] [--design-system <id>]",
    target: "packages/m3-design/src/cli.ts",
    run: args => spawn([process.execPath, abs("packages/m3-design/src/cli.ts"), ...args]),
  },
  {
    group: "",
    name: "engine",
    summary: "Bun Engine runtime, app, frontend and native builds",
    usage: "<probe|build|run|compile|recompile|web|frontend|shell|library|qualify|launch> [args]",
    ...script("packages/bun-engine/src/cli.ts"),
  },
  {
    group: "",
    name: "re",
    summary: "Reverse engineering workflows and REA MCP tools",
    usage: "<rea arguments>",
    ...script("packages/re/scripts/rea.mjs"),
  },
  {
    group: "",
    name: "rea",
    summary: "REA reverse-engineering CLI and standalone MCP server",
    usage: "<rea arguments>",
    ...script("vendor/rea/scripts/rea.mjs"),
  },
  {
    group: "",
    name: "setup",
    summary: "Install dependencies, submodules and shared setup",
    ...script("scripts/setup.ts"),
  },
  {
    group: "",
    name: "doctor",
    summary: "Check the workspace, toolchains and runtime",
    ...script(workspaceCli, "doctor"),
  },
  {
    group: "",
    name: "status",
    summary: "Workspace and source status",
    ...script(workspaceCli, "status"),
  },
  {
    group: "",
    name: "sync",
    summary: "Synchronize the workspace with its pinned sources",
    ...script(workspaceCli, "sync"),
  },
  {
    group: "",
    name: "check",
    summary: "Type check the workspace (upstream bun check)",
    ...native("check", "--no-script", "-p", "tsconfig.json", "--threads=2", "--no-pretty"),
  },
  {
    group: "",
    name: "lint",
    summary: "Lint the workspace (upstream bun lint)",
    ...native(
      "lint",
      "--no-script",
      "-c",
      ".oxlintrc.json",
      "--max-warnings=0",
      "--ignore-pattern",
      "**/fixtures/**",
      "--ignore-pattern",
      "packages/wasm/test/programs/**",
      "--ignore-pattern",
      "**/node_modules/**",
      ...LINT_PATHS,
    ),
  },
  {
    group: "",
    name: "format",
    summary: "Format the workspace (upstream bun fmt)",
    usage: "[--check]",
    run: args =>
      spawn([
        process.execPath,
        "fmt",
        "--no-script",
        args.includes("--check") ? "--check" : "--write",
        "--config",
        "bun-format.json",
        ...FORMAT_IGNORE,
        ...FORMAT_PATHS,
      ]),
  },
  {
    group: "",
    name: "release",
    summary: "Build and publish a release",
    ...script("scripts/release.ts"),
  },

  // cargo -------------------------------------------------------------------------------------
  {
    group: "cargo",
    name: "metadata",
    summary: "Cargo workspace metadata",
    ...script("scripts/cargo.ts", "metadata"),
  },
  {
    group: "cargo",
    name: "fmt",
    summary: "Check Rust formatting of the crates this repository owns",
    ...script("scripts/cargo.ts", "fmt"),
  },
  {
    group: "cargo",
    name: "check",
    summary: "cargo check --locked --workspace (serialized)",
    ...script("scripts/cargo.ts", "check"),
  },
  {
    group: "cargo",
    name: "test",
    summary: "cargo test --locked --workspace (serialized)",
    ...script("scripts/cargo.ts", "test"),
  },
  {
    group: "cargo",
    name: "exec",
    summary: "Run any cargo command through the serialized wrapper",
    usage: "-- <cargo arguments>",
    advanced: true,
    ...script("scripts/cargo.ts", "exec"),
  },
  {
    group: "cargo",
    name: "nie",
    summary: "cargo check the NIE crates",
    ...script("scripts/cargo.ts", "exec", "--", "check", "--locked", "-p", "aphrody-nie-*"),
  },
  {
    group: "cargo",
    name: "nie-build",
    summary: "Build the NIE crates",
    ...script("scripts/cargo-nie.ts"),
  },
  {
    group: "cargo",
    name: "fmt-crates",
    summary: "rustfmt batches of the owned crates",
    advanced: true,
    ...script("scripts/cargo-fmt.ts"),
  },
  {
    group: "cargo",
    name: "proof",
    summary: "Cargo build proof receipt",
    advanced: true,
    ...script("scripts/cargo-build-proof.ts"),
  },
  {
    group: "cargo",
    name: "vendor",
    summary: "Vendor Cargo sources",
    advanced: true,
    ...script("scripts/vendor-cargo.ts"),
  },

  // workspace ---------------------------------------------------------------------------------
  {
    group: "workspace",
    name: "list",
    summary: "Capability catalog",
    ...script(workspaceCli, "list"),
  },
  {
    group: "workspace",
    name: "status",
    summary: "Workspace status",
    ...script(workspaceCli, "status"),
  },
  {
    group: "workspace",
    name: "doctor",
    summary: "Workspace doctor",
    ...script(workspaceCli, "doctor"),
  },
  {
    group: "workspace",
    name: "sync",
    summary: "Sync the workspace",
    ...script(workspaceCli, "sync"),
  },
  {
    group: "workspace",
    name: "run",
    summary: "Workspace automation owner",
    usage: "<command> [args]",
    advanced: true,
    ...script(workspaceCli),
  },
  {
    group: "workspace",
    name: "assets",
    summary: "Shared assets (R2) plan and publish",
    ...script("packages/bun-workspace/src/assets-cli.ts"),
  },
  {
    group: "workspace",
    name: "manifests",
    summary: "Check workspace manifests",
    ...script("scripts/workspace-manifests.ts"),
  },
  {
    group: "workspace",
    name: "crates",
    summary: "Crate inventory",
    ...script("scripts/crate-inventory.ts"),
  },
  {
    group: "workspace",
    name: "node-modules",
    summary: "Shared node_modules owner",
    advanced: true,
    ...script("scripts/node-modules.ts"),
  },
  {
    group: "workspace",
    name: "submodules",
    summary: "Provision flat Git submodules",
    advanced: true,
    ...script("scripts/setup-submodules.ts"),
  },
  {
    group: "workspace",
    name: "inventory",
    summary: "Source workspace inventory",
    usage: "[--config FILE] [--out FILE]",
    ...viaFactory("workspace"),
  },
  {
    group: "workspace",
    name: "check",
    summary: "Root invariants: nested Bun/Cargo locks and Cargo workspaces need a docs/cargo-exceptions.json entry",
    target: "src/workspace-check.ts",
    run: async () => {
      const result = await (await import("../workspace-check.ts")).checkWorkspaceInvariants(root);
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    },
  },
  {
    group: "workspace",
    name: "graph",
    summary: "Factory source graph",
    usage: "[--profile full|perf] [--target TARGET]",
    ...viaFactory("graph"),
  },

  // build -------------------------------------------------------------------------------------
  {
    group: "build",
    name: "apps",
    summary: "Plan or build the standalone apps",
    usage: "<plan|build> [args]",
    ...script("scripts/build-apps.ts"),
  },
  {
    group: "build",
    name: "packages",
    summary: "Plan or build the npm packages",
    usage: "<plan|build> [args]",
    ...script("scripts/build-packages.ts"),
  },
  {
    group: "build",
    name: "apt",
    summary: "Build the APT portability target",
    ...script("src/build-apt.ts"),
  },
  {
    group: "build",
    name: "frontend",
    summary: "Build the frontend source",
    usage: "[build]",
    ...script("scripts/build-frontend.ts", "build"),
  },
  {
    group: "build",
    name: "frontend-dev",
    summary: "Run the frontend source in development",
    target: "package.json",
    run: args => spawn([process.execPath, "run", "--filter", "@frontend/source", "dev", ...args]),
  },
  {
    group: "build",
    name: "frontend-install",
    summary: "Install the frontend source dependencies",
    target: "package.json",
    run: args => spawn([process.execPath, "install", "--filter", "@frontend/source", "--frozen-lockfile", ...args]),
  },
  {
    group: "build",
    name: "video",
    summary: "Build FilmCraft",
    ...script(workspaceCli, "build", "filmcraft"),
  },
  {
    group: "build",
    name: "plan",
    summary: "Distribution plan",
    usage: "[--profile full|perf] [--target T]",
    ...viaFactory("plan"),
  },
  {
    group: "build",
    name: "sources",
    summary: "Assemble the committed, pinned sources",
    usage: "--out DIR [--config FILE]",
    ...viaFactory("sources"),
  },
  {
    group: "build",
    name: "stage",
    summary: "Stage a runtime into a distribution",
    usage:
      "--out DIR --runtime FILE --receipt FILE [--product DIR --product-receipt FILE --product-qualification FILE]",
    ...viaFactory("stage"),
  },
  {
    group: "build",
    name: "product",
    summary: "Prepare the pinned product workspace and frozen dependencies on the Linux factory",
    usage: "--out DIR --runtime FILE --receipt FILE --config FILE",
    ...viaFactory("product"),
  },
  {
    group: "build",
    name: "product-qualify",
    summary: "Qualify product CLI discovery against its frozen payload on the Linux factory",
    usage: "--product DIR --product-receipt FILE --runtime FILE --out FILE",
    ...viaFactory("product-qualify"),
  },
  {
    group: "build",
    name: "rootfs-stage",
    summary: "Stage an Arch rootfs",
    usage: "--out DIR --receipt FILE",
    ...viaFactory("rootfs-stage"),
  },
  {
    group: "build",
    name: "wasm",
    summary: "Build the portable libm3 WebAssembly",
    usage: "--out DIR",
    ...viaFactory("wasm"),
  },
  {
    group: "build",
    name: "image",
    summary: "Build a distribution image",
    usage: "--out DIR --root DIR --tag TAG",
    ...viaFactory("image"),
  },

  // factory -----------------------------------------------------------------------------------
  {
    group: "factory",
    name: "arch",
    summary: "Arch/pacman factory: plan, host, resolve, rootfs",
    usage: "--action [plan|host|resolve|rootfs] --composition [server|desktop|gaming]",
    ...viaFactory("factory"),
  },
  {
    group: "factory",
    name: "msys2",
    summary: "MSYS2 desktop: plan, doctor or lock",
    usage: "<plan|doctor|lock> [--abi ABI]",
    ...viaFactory("msys2"),
  },
  {
    group: "factory",
    name: "images",
    summary: "bunos-gaming, bunos-alpine and bunos-ubuntu images",
    usage: "<plan|fetch|build|status> <image> [--target T] [--desktop-session cosmic|omarchy-hyprland]",
    target: "factory/images/build.ts",
    run: async args => {
      const { main } = await import("../../factory/images/build.ts");
      console.log(JSON.stringify(await main(args), null, 2));
      return 0;
    },
  },
  {
    group: "factory",
    name: "usr",
    summary: "Plan, fetch or build the usr tree",
    usage: "<plan|build|fetch> [--composition server|desktop|gaming] [--desktop-session cosmic|omarchy-hyprland]",
    target: "factory/usr/build.ts",
    run: async args => {
      const { main } = await import("../../factory/usr/build.ts");
      console.log(JSON.stringify(await main(args), null, 2));
      return 0;
    },
  },
  {
    group: "factory",
    name: "ubuntu",
    summary: "Ubuntu compatibility factory",
    ...script("factory/ubuntu.ts"),
  },

  // source ------------------------------------------------------------------------------------
  {
    group: "source",
    name: "plan",
    summary: "Plan the source portal mirrors",
    ...script("scripts/source-portal.ts", "plan"),
  },
  {
    group: "source",
    name: "refresh",
    summary: "Refresh the source portal inventory and format it",
    target: "scripts/source-portal.ts",
    ...sequence(
      () => spawn([process.execPath, abs("scripts/source-portal.ts"), "refresh"]),
      () =>
        spawn([
          process.execPath,
          "fmt",
          "--no-script",
          "--write",
          "--config",
          "bun-format.json",
          "infra/source-portal.json",
        ]),
    ),
  },
  {
    group: "source",
    name: "verify",
    summary: "Verify the live source portal",
    ...script("scripts/source-portal.ts", "verify", "--live"),
  },

  // docs --------------------------------------------------------------------------------------
  {
    group: "docs",
    name: "check",
    summary: "Check documentation links and structure",
    ...script("scripts/docs-check.ts"),
  },

  // desktop -----------------------------------------------------------------------------------
  {
    group: "desktop",
    name: "dev",
    summary: "Run the Bun desktop in development",
    ...bunRun("apps/desktop", "dev"),
  },
  {
    group: "desktop",
    name: "native-dev",
    summary: "Run the native desktop shell",
    ...bunRun("apps/desktop", "desktop:dev"),
  },
  {
    group: "desktop",
    name: "native-build",
    summary: "Build the native desktop shell",
    ...bunRun("apps/desktop", "desktop:build"),
  },
  {
    group: "desktop",
    name: "web-build",
    summary: "Build the desktop web UI",
    ...bunRun("apps/desktop", "build"),
  },

  // webos -------------------------------------------------------------------------------------
  {
    group: "webos",
    name: "build",
    summary: "Build aphrody.com into apps/webos/dist",
    ...script("apps/webos/build-product.ts"),
  },
  {
    group: "webos",
    name: "craft",
    summary: "Compile Craft browser apps to WebAssembly",
    usage: "[id ...]",
    ...script("apps/webos/build-craft.ts"),
  },
  {
    group: "webos",
    name: "serve",
    summary: "Serve apps/webos/dist locally with the production Worker code",
    usage: "[port]",
    ...script("apps/webos/serve.ts"),
  },
  {
    group: "webos",
    name: "deploy",
    summary: "Build and deploy aphrody.com to Cloudflare",
    ...script("apps/webos/deploy.ts"),
  },
  {
    group: "superapp",
    name: "build",
    summary: "Build the unified Aphrody super-site and workspace catalog",
    ...script("apps/webos/build-product.ts"),
  },
  {
    group: "superapp",
    name: "craft",
    summary: "Compile Craft apps for the super-site WebAssembly app store",
    usage: "[id ...]",
    ...script("apps/webos/build-craft.ts"),
  },
  {
    group: "superapp",
    name: "serve",
    summary: "Serve the unified Aphrody super-site locally",
    usage: "[port]",
    ...script("apps/webos/serve.ts"),
  },
  {
    group: "superapp",
    name: "deploy",
    summary: "Build and deploy the unified Aphrody super-site",
    ...script("apps/webos/deploy.ts"),
  },

  // iecode ------------------------------------------------------------------------------------
  {
    group: "iecode",
    name: "setup",
    summary: "Fresh IECODE setup",
    ...script("scripts/iecode/tools/setup-fresh.ts"),
  },
  {
    group: "iecode",
    name: "setup-data",
    summary: "IECODE data setup",
    ...script("scripts/iecode/tools/data/setup-data.ts"),
  },
  {
    group: "iecode",
    name: "data-status",
    summary: "IECODE data compression status",
    ...script("scripts/iecode/tools/data/data-compression.ts", "status"),
  },
  {
    group: "iecode",
    name: "data-verify",
    summary: "Verify IECODE data",
    ...script("scripts/iecode/tools/data/data-compression.ts", "verify"),
  },
  {
    group: "iecode",
    name: "docs-check",
    summary: "IECODE documentation check",
    ...script("scripts/iecode/validation/docs.ts"),
  },
  {
    group: "iecode",
    name: "db-schema-sqlite",
    summary: "Apply the SQLite schema",
    ...script("scripts/iecode/migration/apply-inagle-schema.ts", "--sqlite"),
  },
  {
    group: "iecode",
    name: "db-schema-postgres",
    summary: "Apply the Postgres schema",
    ...script("scripts/iecode/migration/apply-inagle-schema.ts", "--postgres"),
  },
  {
    group: "iecode",
    name: "db-schema-verify",
    summary: "Verify the schema",
    ...script("scripts/iecode/migration/apply-inagle-schema.ts", "--verify"),
  },
  {
    group: "iecode",
    name: "db-restore",
    summary: "Restore a dump into SQLite",
    ...script("scripts/iecode/migration/restore-dump-to-sqlite.ts"),
  },
  {
    group: "iecode",
    name: "storage-status",
    summary: "Storage runtime status",
    ...script("scripts/iecode/tools/storage-runtime.ts", "status"),
  },
  {
    group: "iecode",
    name: "inagle",
    summary: "Run the inagle CLI on the storage runtime",
    ...script(
      "scripts/iecode/tools/storage-runtime.ts",
      "run",
      "--",
      process.execPath,
      abs("packages/inagle/src/cli.ts"),
    ),
  },
  {
    group: "iecode",
    name: "web-build",
    summary: "Build the IECODE web app",
    ...bunRun("apps/iecode-web", "build"),
  },

  // NIE and Inagle builds --------------------------------------------------------------------------
  {
    group: "nie",
    name: "build",
    summary: "Build and type check the NIE packages",
    target: "turbo.json",
    run: args =>
      spawn([
        localBin("turbo"),
        "run",
        "build",
        "typecheck",
        "cargo:nie",
        "--filter=./packages/inagle*",
        "--filter=./packages/nie-*",
        "--filter=./apps/iecode-web",
        "--filter=//",
        ...args,
      ]),
  },
  {
    group: "nie",
    name: "turbo-cargo-build",
    summary: "Run the NIE cargo build task through turbo",
    target: "turbo.json",
    run: args => spawn([localBin("turbo"), "run", "cargo:nie:build", "--filter=//", ...args]),
  },
  {
    group: "nie",
    name: "cargo",
    summary: "cargo check the NIE crates",
    ...script("scripts/cargo.ts", "exec", "--", "check", "--locked", "-p", "aphrody-nie-*"),
  },
  {
    group: "nie",
    name: "cargo-build",
    summary: "Build the NIE crates",
    ...script("scripts/cargo-nie.ts"),
  },

  // in-process owners ---------------------------------------------------------------------------
  {
    group: "infra",
    name: "run",
    summary: "Hosts, services, deployment, probes and pipelines",
    usage: "<command> [args]",
    target: "packages/bun-workspace/src/automation/runtime.ts",
    run: async args => {
      const { runInfra } = await import("../../packages/bun-workspace/src/automation/runtime.ts");
      return (await runInfra({ args, stdout: "inherit", stderr: "inherit" })).exitCode;
    },
  },
  {
    group: "ops",
    name: "run",
    summary: "Workspace operations",
    usage: "<command> [args]",
    target: "packages/bun-workspace/src/automation/ops.ts",
    run: async args => (await import("../../packages/bun-workspace/src/automation/ops.ts")).runOps(args),
  },
  {
    group: "server",
    name: "serve",
    summary: "Serve or verify the Bun OS product server",
    usage: "serve [ROOT] | verify [BINARY] [RECEIPT] | --version",
    target: "packages/bun-app-host/src/cli.ts",
    run: async args => {
      await (await import("../../packages/bun-app-host/src/cli.ts")).runProductCLI(args);
      return 0;
    },
  },
);
