#!/usr/bin/env bun
// Load only the selected operation so unrelated products do not own its dependencies.
import type { PackageOperation } from "./packages.ts";
import { join } from "node:path";

/** `yolo ops <operation> [arguments...]`: run one Workspace operation and return its exit status. */
export async function runOps(argv: readonly string[]): Promise<number> {
  const [operation, ...rest] = argv;
  if (operation === "jan-absorption") {
    return await (await import("./jan-absorption.ts")).runJanAbsorption(rest);
  }
  if (operation === "optimize") {
    return await (await import("./optimize.ts")).runOptimize(rest);
  }
  if (operation === "path-audit") {
    return await (await import("./path-audit.ts")).runPathAudit(rest);
  }
  if (operation === "plugins" || operation === "agent-plugins") {
    return await (await import("./agent-plugins.ts")).runAgentPlugins(rest);
  }
  if (operation === "mcp-environment") {
    return await (await import("./mcp-environment.ts")).runMcpEnvironment(rest);
  }
  if (operation === "build-factory") {
    return await (await import("./build-factory.ts")).runBuildFactory(rest);
  }
  if (operation === "build-fleet") {
    return await (await import("./build-fleet.ts")).runBuildFleet(rest);
  }
  if (operation === "native-runtime") {
    return await (await import("./native-runtime.ts")).runNativeRuntime(rest);
  }
  if (operation === "repo-sync") {
    return await (await import("./repo-sync.ts")).runRepoSync(rest);
  }
  if (operation === "cli-help") {
    return await (await import("./cli-help.ts")).runCliHelp(rest);
  }
  if (operation === "docs") {
    return await (await import("./documentation.ts")).runDocumentation(rest);
  }
  if (operation === "discord") {
    return await (await import("./discord.ts")).runDiscord(rest);
  }
  if (operation === "agent-sync") {
    return await (await import("./agent-sync.ts")).runAgentSync(rest);
  }
  if (operation === "agent-live") {
    return await (await import("./agent-live.ts")).runAgentLive(rest);
  }
  if (operation === "agent-home-drive-sync" || operation === "drive-sync") {
    const task = Bun.spawn([process.execPath, join(import.meta.dir, "agent-home-drive-sync.ts"), ...rest], {
      windowsHide: true,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await task.exited;
  }
  if (operation === "web-migration") {
    return await (await import("./web-migration.ts")).runWebMigration(rest);
  }
  if (operation === "consolidation") {
    return await (await import("./consolidation.ts")).runConsolidation(rest);
  }
  if (operation === "bridge") {
    const [bridgeOperation, ...bridgeArgs] = rest;
    if (!bridgeOperation || bridgeOperation === "status") {
      if (bridgeArgs.length > 0) throw new Error("usage: yolo ops bridge [status|rust <binary> [arguments...]]");
      console.log(JSON.stringify(await (await import("./bridges.ts")).loadAphrodyBridgeCatalog(), null, 2));
      return 0;
    }
    if (bridgeOperation !== "rust") {
      throw new Error("usage: yolo ops bridge [status|rust <binary> [arguments...]]");
    }
    const [binary, ...args] = bridgeArgs;
    if (!binary) throw new Error("usage: yolo ops bridge rust <aphrody-binary> [arguments...]");
    return await (await import("./bridges.ts")).runRustBridge(binary, args, { stdout: "inherit", stderr: "inherit" });
  }
  if (operation === "infra") {
    return await (
      await import("./bridges.ts")
    ).runRustBridge("aphrody-infra", rest, {
      stdout: "inherit",
      stderr: "inherit",
    });
  }
  if (operation === "infra-audit") return await (await import("./infra-audit.ts")).runInfraAudit(rest);
  if (operation === "orchestrate") {
    const [action = "status", ...args] = rest;
    const usesTarget = action !== "catalog";
    const target = usesTarget && !args.includes("--target") ? ["--target", "local"] : [];
    return await (
      await import("./bridges.ts")
    ).runRustBridge("aphrody-infra", ["service", action, ...args, ...target], {
      stdout: "inherit",
      stderr: "inherit",
    });
  }
  if (operation === "audit-scripts") {
    const index = rest.indexOf("--repo");
    const repo = index === -1 ? undefined : rest[index + 1];
    if (!repo || rest.length !== 2) throw new Error("usage: yolo ops audit-scripts --repo <name>");
    await (await import("./audit-scripts.ts")).runScriptAudit(repo);
    return 0;
  }
  if (operation === "imports-exports") {
    const rootIndex = rest.indexOf("--root");
    const root = rootIndex === -1 ? process.cwd() : rest[rootIndex + 1];
    if (!root || root.startsWith("--"))
      throw new Error("usage: yolo ops imports-exports [--root <repository>] [--workspace <name-or-path>] [--json]");
    const args = rootIndex === -1 ? rest : rest.filter((_, index) => index !== rootIndex && index !== rootIndex + 1);
    await (await import("./imports-exports.ts")).runImportsExports(args, root);
    return 0;
  }
  if (operation === "monorepo-gate") {
    return await (await import("./monorepo-gate.ts")).runMonorepoGate(rest);
  }
  if (operation === "cargo-package-repair") {
    return await (await import("./cargo-package-repair.ts")).runCargoPackageRepair(rest);
  }
  if (operation === "cargo-release-audit") {
    return await (await import("./cargo-release-audit.ts")).runCargoReleaseAudit(rest);
  }
  if (operation === "workspace-repair") {
    return await (await import("./workspace-repair.ts")).runWorkspaceRepair(rest);
  }
  if (operation === "repository-health") {
    return await (await import("./repository-health.ts")).runRepositoryHealth(rest);
  }
  if (operation === "git-attribution") {
    return await (await import("./git-attribution.ts")).runGitAttribution(rest);
  }
  if (operation === "clean-public-ai") {
    return await (await import("./clean-public-ai.ts")).runCleanPublicAi(rest);
  }
  if (operation === "windows-paths") {
    return await (await import("./windows-paths.ts")).runWindowsPaths(rest);
  }
  if (operation === "runtime-versions") {
    return (await import("./runtime-versions.ts")).runRuntimeVersions(rest);
  }
  if (operation === "gitignored-audit") {
    return await (await import("./gitignored-audit.ts")).runGitignoredAudit(rest);
  }
  if (operation === "docs-overlaps") {
    return (await import("./docs-overlaps.ts")).runDocsOverlaps(rest);
  }
  if (operation === "docs-consolidate") {
    return await (await import("./docs-consolidation.ts")).runDocsConsolidation(rest);
  }
  if (operation === "python-quality") {
    return (await import("./python-quality.ts")).runPythonQuality(rest);
  }
  if (operation === "agent-plugin-sync") {
    return await (await import("./agent-plugin-sync.ts")).runAgentPluginSync(rest);
  }
  if (operation === "agent-home") {
    return (await import("./agent-home.ts")).runAgentHome(rest);
  }
  if (operation === "ai-release-gate") {
    return (await import("./ai-release-gate.ts")).runAiReleaseGate(rest);
  }
  if (operation === "powershell-syntax") {
    return await (await import("./powershell-syntax.ts")).runPowerShellSyntax(rest);
  }
  if (operation === "workspace-clean") {
    return await (await import("./workspace-clean.ts")).runWorkspaceClean(rest);
  }
  if (operation === "pipeline-catalog") {
    return await (await import("./pipeline-catalog.ts")).runPipelineCatalog(rest);
  }
  if (operation === "repository-state") {
    return await (await import("./repository-state.ts")).runRepositoryState(rest);
  }
  if (operation === "iecode-doctor") {
    return await (await import("./iecode-doctor.ts")).runIecodeDoctor(rest);
  }
  if (operation === "runtime-gate") {
    return await (await import("./runtime-gate.ts")).runRuntimeGate(rest);
  }
  if (operation === "automation-inventory") {
    return await (await import("./automation-inventory.ts")).runAutomationInventory(rest);
  }
  if (operation === "aphrody-packages") {
    return await (await import("./aphrody-packages.ts")).runAphrodyPackages(rest);
  }
  if (operation === "system-packages") {
    return await (await import("./system-packages.ts")).runSystemPackages(rest);
  }
  if (operation === "workspace-subsystem") {
    return await (await import("./workspace-subsystem.ts")).runWorkspaceSubsystem(rest);
  }
  if (operation === "cargo-boundaries") {
    return await (await import("./cargo-boundaries.ts")).runCargoBoundaries(rest);
  }
  if (operation === "docs-gen") {
    return await (await import("./documentation.ts")).runDocumentation(["generate", ...rest]);
  }
  if (operation === "workspace-layout") {
    return await (await import("./workspace-layout.ts")).runWorkspaceLayout(rest);
  }
  if (operation === "ecosystem-deps") {
    return await (await import("./ecosystem-deps.ts")).runEcosystemDeps(rest);
  }
  if (operation === "bun-upstream-docs") {
    return await (await import("./bun-upstream-docs.ts")).runBunUpstreamDocs(rest);
  }
  if (operation === "workspace-deps") {
    return await (await import("./workspace-deps.ts")).runWorkspaceDeps(rest);
  }
  if (operation === "vendor-license-audit") {
    return await (await import("./vendor-license-audit.ts")).runVendorLicenseAudit(rest);
  }
  if (operation === "docs-links") {
    return await (await import("./docs-links.ts")).runDocsLinks(rest);
  }
  if (operation === "spaceui-to-m3") {
    return await (await import("./spaceui-to-m3.ts")).runSpaceUiToM3(rest);
  }
  if (operation === "desktop-smoke") {
    return await (await import("./desktop-smoke.ts")).runDesktopSmoke(rest);
  }
  if (operation === "spaceui-icons") {
    return await (await import("./spaceui-icons.ts")).runSpaceUiIcons(rest);
  }
  if (operation === "bun-native") {
    return await (await import("./bun-native.ts")).runBunNative(rest);
  }
  if (operation === "tauri") {
    return await (await import("./tauri.ts")).runTauri(rest);
  }
  if (operation === "tauri-apps") {
    return await (await import("@aphrody/update/src/tauri/apps.ts")).runTauriApps(rest);
  }
  if (operation === "tauri-sync") {
    return await (await import("@aphrody/update/src/tauri/sync.ts")).runTauriSync(rest);
  }
  if (operation === "upstream-sources") {
    return await (await import("@aphrody/update/src/sources/restore.ts")).runUpstreamSources(rest);
  }
  if (operation === "deps-sync") {
    return await (await import("@aphrody/update/src/deps/sync.ts")).runDepsSync(rest);
  }
  if (operation === "update") {
    return await (await import("@aphrody/update/src/cli.ts")).runUpdate(rest);
  }
  if (operation === "stack-dedup") {
    return await (await import("./stack-dedup.ts")).runStackDedup(rest);
  }
  // The UI scaffolding CLIs (web-to-tauri, scaffold) are `yolo m3 web-to-tauri|scaffold`.
  if (operation === "drive-daemon") {
    return await (await import("./drive-daemon.ts")).runDriveDaemon(rest);
  }
  if (operation === "drive-upstream-audit") {
    return await (await import("./drive-upstream-audit.ts")).runDriveUpstreamAudit(rest);
  }
  if (operation === "bun-workspace") {
    return await (await import("./bun-workspace.ts")).runBunWorkspace(rest);
  }
  if (operation === "monorepo-audit") {
    return await (await import("./monorepo-audit.ts")).runMonorepoAudit(rest);
  }
  if (operation === "fleet") {
    console.log(JSON.stringify(await (await import("./fleet.ts")).loadFleet(), null, 2));
    return 0;
  }
  if (operation === "n2b") return await (await import("./n2b.ts")).runN2b(rest);
  if (operation === "binaries") {
    console.log(JSON.stringify(await (await import("./binaries.ts")).discoverAphrodyBinaries(), null, 2));
    return 0;
  }
  if (operation === "packages") {
    const [packageOperation, ...packageArgs] = rest;
    if (!packageOperation || !["status", "install", "outdated", "audit"].includes(packageOperation)) {
      throw new Error("usage: yolo ops packages <status|install|outdated|audit> [--repo <name>]");
    }
    const repoIndex = packageArgs.indexOf("--repo");
    const repository = repoIndex === -1 ? undefined : packageArgs[repoIndex + 1];
    if (repoIndex !== -1 && (!repository || packageArgs.length !== 2)) {
      throw new Error("usage: yolo ops packages <operation> [--repo <name>]");
    }
    if (repoIndex === -1 && packageArgs.length > 0)
      throw new Error("usage: yolo ops packages <operation> [--repo <name>]");
    return await (
      await import("./packages.ts")
    ).runPackageOperation(packageOperation as PackageOperation, { repository });
  }
  if (operation === "binary") {
    const [binary, ...args] = rest;
    if (!binary) throw new Error("usage: yolo ops binary <aphrody-binary> [arguments...]");
    return await (await import("./binaries.ts")).runAphrodyBinary(binary, args);
  }
  const aliases: Record<string, string[]> = {
    doctor: ["doctor", "--strict", "--json"],
    status: ["status", "--json"],
    inventory: ["inventory", "--json"],
    pipeline: ["pipeline", "--stage"],
    "github-audit": ["workspace-git-audit", "--json"],
  };
  const args =
    operation && aliases[operation]
      ? [...aliases[operation], ...(operation === "pipeline" ? [rest.shift() ?? "plan", ...rest] : rest)]
      : [...argv];
  const result = await (await import("./runtime.ts")).runInfra({ args, stdout: "inherit", stderr: "inherit" });
  return result.exitCode;
}

// Direct execution remains for callers outside the yolo CLI until they move to `yolo ops`: the installed link
// ~/.local/bin/aphrody-ops and the Rust `aphrody git source|attribution|clean-public` commands
// (crates/infra/aphrody-command/src/git_cmd.rs).
if (import.meta.main) process.exit(await runOps(process.argv.slice(2)));
