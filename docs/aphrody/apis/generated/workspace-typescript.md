<!-- Generated from source by @aphrody/workspace. Do not edit. -->
# Source reference: workspace-typescript

Syntax-only explicit exports and JSDoc. Initializers and implementation bodies are omitted; inferred types and re-export resolution are not computed.

## Source: packages/infra/workspace/src/client.ts

SHA-256: `9d938bb5304645914574e00e59d8832a23231dc29eacfcd1c954e7f92bf4d40b`

### Source line 1

```typescript
export type InfraApiClient = {
    baseUrl: string;
    request<T>(path: string, init?: RequestInit): Promise<T>;
};
```

### Source line 7

```typescript
/** Typed boundary for the HTTP API exposed by `aphrody-infra serve`. */
```

```typescript
export function createInfraClient(baseUrl = "http://127.0.0.1:8787"): InfraApiClient;
```

## Source: packages/infra/workspace/src/index.ts

SHA-256: `40d63fee07eccd668130908c1a91765d290488a85e041bec7b4d6dfc1dd07e1c`

### Source line 1

```typescript
export { infraExecutable, infraRoot, runInfra } from "./runtime.ts";
```

### Source line 2

```typescript
export type { InfraInvocation, InfraResult } from "./runtime.ts";
```

### Source line 3

```typescript
export { loadFleet } from "./fleet.ts";
```

### Source line 4

```typescript
export type { Fleet } from "./fleet.ts";
```

### Source line 5

```typescript
export { runN2b } from "./n2b.ts";
```

### Source line 6

```typescript
export { discoverAphrodyBinaries, runAphrodyBinary } from "./binaries.ts";
```

### Source line 7

```typescript
export type { AphrodyBinary } from "./binaries.ts";
```

### Source line 9

```typescript
export { discoverBunPackageWorkspaces, runPackageOperation } from "./packages.ts";
```

### Source line 10

```typescript
export type { BunPackageWorkspace, PackageOperation } from "./packages.ts";
```

### Source line 11

```typescript
export { loadAphrodyBridgeCatalog, runRustBridge } from "./bridges.ts";
```

### Source line 12

```typescript
export type { AphrodyBridgeCatalog } from "./bridges.ts";
```

### Source line 13

```typescript
export { runScriptAudit } from "./audit-scripts.ts";
```

### Source line 15

```typescript
export { runImportsExports, scanImportsExports } from "./imports-exports.ts";
```

### Source line 16

```typescript
export { runMonorepoAudit } from "./monorepo-audit.ts";
```

### Source line 17

```typescript
export { runBunWorkspace } from "./bun-workspace.ts";
```

### Source line 18

```typescript
export { runDriveUpstreamAudit } from "./drive-upstream-audit.ts";
```

### Source line 19

```typescript
export { runDriveDaemon } from "./drive-daemon.ts";
```

### Source line 20

```typescript
export { runTauri } from "./tauri.ts";
```

### Source line 21

```typescript
export { runTauriApps } from "@aphrody/update/src/tauri/apps.ts";
```

### Source line 22

```typescript
export { runTauriSync } from "@aphrody/update/src/tauri/sync.ts";
```

### Source line 23

```typescript
export { runUpstreamSources } from "@aphrody/update/src/sources/restore.ts";
```

### Source line 24

```typescript
export { runBunNative } from "./bun-native.ts";
```

### Source line 25

```typescript
export { runSpaceUiIcons } from "./spaceui-icons.ts";
```

### Source line 26

```typescript
export { runDesktopSmoke } from "./desktop-smoke.ts";
```

### Source line 27

```typescript
export { runSpaceUiToM3 } from "./spaceui-to-m3.ts";
```

### Source line 28

```typescript
export { runDocsLinks } from "./docs-links.ts";
```

### Source line 29

```typescript
export { runVendorLicenseAudit } from "./vendor-license-audit.ts";
```

### Source line 30

```typescript
export { runWorkspaceDeps } from "./workspace-deps.ts";
```

### Source line 31

```typescript
export { runBunUpstreamDocs } from "./bun-upstream-docs.ts";
```

### Source line 32

```typescript
export { runEcosystemDeps, syncManifest, syncXaiPackage } from "./ecosystem-deps.ts";
```

### Source line 33

```typescript
export { runWorkspaceLayout } from "./workspace-layout.ts";
```

### Source line 34

```typescript
export { runCargoBoundaries } from "./cargo-boundaries.ts";
```

### Source line 35

```typescript
export { runAutomationInventory } from "./automation-inventory.ts";
```

### Source line 36

```typescript
export { runRuntimeGate } from "./runtime-gate.ts";
```

### Source line 37

```typescript
export { runIecodeDoctor } from "./iecode-doctor.ts";
```

### Source line 38

```typescript
export { runPowerShellSyntax } from "./powershell-syntax.ts";
```

### Source line 39

```typescript
export { runWorkspaceClean } from "./workspace-clean.ts";
```

### Source line 40

```typescript
export { scanRepository, runRepositoryState } from "./repository-state.ts";
```

### Source line 41

```typescript
export { runAiReleaseGate } from "./ai-release-gate.ts";
```

### Source line 42

```typescript
export { runAgentHome } from "./agent-home.ts";
```

### Source line 43

```typescript
export { runAgentPluginSync } from "./agent-plugin-sync.ts";
```

### Source line 44

```typescript
export { runPythonQuality } from "./python-quality.ts";
```

### Source line 45

```typescript
export { runDocsOverlaps } from "./docs-overlaps.ts";
```

### Source line 46

```typescript
export { runDocsConsolidation } from "./docs-consolidation.ts";
```

### Source line 47

```typescript
export { runGitignoredAudit } from "./gitignored-audit.ts";
```

### Source line 48

```typescript
export { runRuntimeVersions } from "./runtime-versions.ts";
```

### Source line 49

```typescript
export { runMonorepoGate } from "./monorepo-gate.ts";
```

### Source line 50

```typescript
export { runInfraAudit, sourceInventory, observeCommand } from "./infra-audit.ts";
```

### Source line 52

```typescript
export { runWindowsPaths, scanWindowsPaths } from "./windows-paths.ts";
```

### Source line 53

```typescript
export type { WindowsPathFinding } from "./windows-paths.ts";
```

### Source line 54

```typescript
export { runGitAttribution, stripAttributionTrailers } from "./git-attribution.ts";
```

### Source line 55

```typescript
export { runCleanPublicAi, auditPublicSurfaces, scanFileForAiLeaks } from "./clean-public-ai.ts";
```

### Source line 56

```typescript
export { runRepositoryHealth } from "./repository-health.ts";
```

### Source line 57

```typescript
export { runWorkspaceRepair } from "./workspace-repair.ts";
```

### Source line 58

```typescript
export { runCargoPackageRepair } from "./cargo-package-repair.ts";
```

### Source line 59

```typescript
export { runCargoReleaseAudit, auditCargoRelease, classifyRequirements, } from "./cargo-release-audit.ts";
```

### Source line 65

```typescript
export { getDiscordBotsStatus, runDiscord } from "./discord.ts";
```

### Source line 66

```typescript
export type { DiscordBotStatus } from "./discord.ts";
```

### Source line 68

```typescript
export { pipelineCatalog, runPipelineCatalog } from "./pipeline-catalog.ts";
```

### Source line 69

```typescript
export { collectAgentLive, runAgentLive } from "./agent-live.ts";
```

### Source line 70

```typescript
export { runStackDedup } from "./stack-dedup.ts";
```

### Source line 72

```typescript
export { runDocumentation, buildDocumentationManifest, renderDocumentationAgentIndex, } from "./documentation.ts";
```

### Source line 78

```typescript
export * from "@aphrody/paths";
```
