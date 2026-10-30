export { infraExecutable, infraRoot, runInfra } from "./runtime.ts";
export type { InfraInvocation, InfraResult } from "./runtime.ts";
export { loadFleet } from "./fleet.ts";
export type { Fleet } from "./fleet.ts";
export { runN2b } from "./n2b.ts";
export { discoverAphrodyBinaries, runAphrodyBinary } from "./binaries.ts";
export type { AphrodyBinary } from "./binaries.ts";

export { discoverBunPackageWorkspaces, runPackageOperation } from "./packages.ts";
export type { BunPackageWorkspace, PackageOperation } from "./packages.ts";
export { loadAphrodyBridgeCatalog, runRustBridge } from "./bridges.ts";
export type { AphrodyBridgeCatalog } from "./bridges.ts";
export { runScriptAudit } from "./audit-scripts.ts";

export { runImportsExports, scanImportsExports } from "./imports-exports.ts";
export { runMonorepoAudit } from "./monorepo-audit.ts";
export { runBunWorkspace } from "./bun-workspace.ts";
export { runTauri } from "./tauri.ts";
export { runTauriApps } from "@aphrody/update/src/tauri/apps.ts";
export { runTauriSync } from "@aphrody/update/src/tauri/sync.ts";
export { runUpstreamSources } from "@aphrody/update/src/sources/restore.ts";
export { runBunNative } from "./bun-native.ts";
export { runSpaceUiIcons } from "./spaceui-icons.ts";
export { runDesktopSmoke } from "./desktop-smoke.ts";
export { runSpaceUiToM3 } from "./spaceui-to-m3.ts";
export { runDocsLinks } from "./docs-links.ts";
export { runVendorLicenseAudit } from "./vendor-license-audit.ts";
export { runWorkspaceDeps } from "./workspace-deps.ts";
export { runBunUpstreamDocs } from "./bun-upstream-docs.ts";
export { runEcosystemDeps, syncManifest, syncXaiPackage } from "./ecosystem-deps.ts";
export { runWorkspaceLayout } from "./workspace-layout.ts";
export { runCargoBoundaries } from "./cargo-boundaries.ts";
export { runAutomationInventory } from "./automation-inventory.ts";
export { runRuntimeGate } from "./runtime-gate.ts";
export { runIecodeDoctor } from "./iecode-doctor.ts";
export { runPowerShellSyntax } from "./powershell-syntax.ts";
export { runWorkspaceClean } from "./workspace-clean.ts";
export { scanRepository, runRepositoryState } from "./repository-state.ts";
export { runAiReleaseGate } from "./ai-release-gate.ts";
export { runAgentHome } from "./agent-home.ts";
export { runAgentPluginSync } from "./agent-plugin-sync.ts";
export { runPythonQuality } from "./python-quality.ts";
export { runDocsOverlaps } from "./docs-overlaps.ts";
export { runDocsConsolidation } from "./docs-consolidation.ts";
export { runGitignoredAudit } from "./gitignored-audit.ts";
export { runRuntimeVersions } from "./runtime-versions.ts";
export { runMonorepoGate } from "./monorepo-gate.ts";
export { runInfraAudit, sourceInventory, observeCommand } from "./infra-audit.ts";

export { runWindowsPaths, scanWindowsPaths } from "./windows-paths.ts";
export type { WindowsPathFinding } from "./windows-paths.ts";
export { runGitAttribution, stripAttributionTrailers } from "./git-attribution.ts";
export { runCleanPublicAi, auditPublicSurfaces, scanFileForAiLeaks } from "./clean-public-ai.ts";
export { runRepositoryHealth } from "./repository-health.ts";
export { runWorkspaceRepair } from "./workspace-repair.ts";
export { runCargoPackageRepair } from "./cargo-package-repair.ts";
export { runCargoReleaseAudit, auditCargoRelease, classifyRequirements } from "./cargo-release-audit.ts";

export { pipelineCatalog, runPipelineCatalog } from "./pipeline-catalog.ts";
export { collectAgentLive, runAgentLive } from "./agent-live.ts";
export { runStackDedup } from "./stack-dedup.ts";

export { runDocumentation, buildDocumentationManifest, renderDocumentationAgentIndex } from "./documentation.ts";

export * from "@aphrody/paths";
