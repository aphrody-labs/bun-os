import { join, resolve } from "node:path";
import { appCapabilities } from "../packages/bun-workspace/src/capabilities.ts";
import type { Config as LibraryConfig } from "../packages/bun-workspace/src/index.ts";
import { packageRoot, type Config, type Profile, type Target } from "../src/distribution.ts";
import { planArchDistribution, type Composition, type DesktopSession } from "./arch/index.ts";
import { inspectGitSourceOwners } from "../src/workspace-manifests.ts";

export interface FactoryGraphOptions {
  root?: string;
  profile: Profile;
  target: Target;
  config?: Config;
  /** Release/performance profile and installed OS composition are independent. */
  composition?: Composition;
  desktopSession?: DesktopSession;
  snapshot?: string;
}

export interface FactoryGraphCommand {
  cwd: string;
  argv: string[];
}

export interface FactoryGraphReceipt {
  owner: string;
  path?: string;
  requirement: string;
  state: "missing" | "present-unverified" | "input-required";
}

export interface FactoryGraphNode {
  id: string;
  kind:
    | "source"
    | "toolchain"
    | "workspace"
    | "cargo"
    | "package"
    | "frontend"
    | "app"
    | "system"
    | "image"
    | "qualification"
    | "release";
  owner: string;
  catalog: string;
  path?: string;
  target: string;
  profile: string;
  composition: Composition;
  dependsOn: string[];
  command?: FactoryGraphCommand;
  state: "declared" | "blocked" | "source-only";
  reasons: string[];
  requiredReceipts: FactoryGraphReceipt[];
  metadata?: Record<string, unknown>;
}

export interface FactoryGraphPlan {
  schemaVersion: 2;
  kind: "bun-os-factory-graph";
  root: string;
  target: string;
  profile: string;
  composition: Composition;
  desktopSession: DesktopSession | null;
  inputs: { factoryArch: Awaited<ReturnType<typeof planArchDistribution>> };
  executable: false;
  qualified: false;
  nodes: FactoryGraphNode[];
  edges: { from: string; to: string }[];
  diagnostics: string[];
  limits: string[];
}

interface BunManifest {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Distribution {
  profiles: Record<string, Record<string, unknown>>;
  targets: Record<string, { rust: string; abi: string; libc: string; container: boolean }>;
}

interface SourceLock {
  repositories: {
    id: string;
    repository: string;
    revision: string;
    mount: string;
    parent?: string;
  }[];
}

interface ArchSourceReference {
  id: string;
  repository: string;
  revision: string;
  referenceRevision?: string;
  checkoutRevision?: string;
  mount: string;
}

interface NativeCatalog {
  targets: {
    id: string;
    sourceId: string;
    revision: string;
    host: string;
    architecture: string;
    abi: string;
    portRequired?: boolean;
    unqualified: string[];
  }[];
}

interface AppCatalog {
  targets: string[];
  apps: { id: string; kind: string; entrypoint: string }[];
}

/** A graph of existing owners and missing contracts; this function never starts a job. */
export async function planFactoryGraph(options: FactoryGraphOptions): Promise<FactoryGraphPlan> {
  const root = resolve(options.root ?? packageRoot);
  const read = async <T>(path: string): Promise<T> => Bun.file(join(root, path)).json();
  const distribution = await read<Distribution>("distribution.json");
  const sources = await read<SourceLock>("sources.lock.json");
  const libraries = await read<LibraryConfig>("aphrody.config.json");
  const native = await read<NativeCatalog>("factory/native-targets.json");
  const applications = await read<AppCatalog>("infra/apps.json");
  const product = await read<BunManifest>("package.json");
  const gitSources = await inspectGitSourceOwners(root);
  const cargo = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as {
    workspace: { members: string[] };
  };
  const target = distribution.targets[options.target];
  if (!target || !distribution.profiles[options.profile]) throw new Error("Unknown factory target or profile.");
  const composition = options.composition ?? "server";
  const factoryArch = await planArchDistribution({
    target: options.target,
    composition,
    desktopSession: options.desktopSession,
    snapshot: options.snapshot,
  });
  if (!Array.isArray(product.workspaces) || !Array.isArray(cargo.workspace?.members))
    throw new Error("Root workspace membership is missing.");
  const nodes: FactoryGraphNode[] = [];
  const diagnostics: string[] = [...factoryArch.blockers];
  const command = (path: string, args: string[] = []): FactoryGraphCommand => ({
    cwd: root,
    argv: [process.execPath, path, ...args],
  });
  const receipt = async (owner: string, requirement: string, path?: string): Promise<FactoryGraphReceipt> => ({
    owner,
    requirement,
    ...(path ? { path } : {}),
    state: path ? ((await Bun.file(join(root, path)).exists()) ? "present-unverified" : "missing") : "input-required",
  });
  const add = (
    node: Omit<FactoryGraphNode, "target" | "profile" | "composition" | "requiredReceipts" | "reasons"> & {
      reasons?: string[];
      requiredReceipts?: FactoryGraphReceipt[];
    },
  ): FactoryGraphNode => {
    const result = {
      target: options.target,
      profile: options.profile,
      composition,
      reasons: [],
      requiredReceipts: [],
      ...node,
    };
    nodes.push(result);
    return result;
  };

  add({
    id: "workspace:sources",
    kind: "workspace",
    owner: "src/cli.ts workspace",
    catalog: "infra/source-workspace.json",
    dependsOn: [],
    state: "declared",
    command: command("src/cli.ts", ["workspace"]),
  });
  for (const source of sources.repositories) {
    add({
      id: `source:${source.id}`,
      kind: "source",
      owner: source.repository,
      catalog: "sources.lock.json",
      path: source.mount,
      dependsOn: ["workspace:sources", ...(source.parent ? [`source:${source.parent}`] : [])],
      state: "source-only",
      metadata: { revision: source.revision, repository: source.repository },
      requiredReceipts: [
        await receipt(
          "factory/source-export.ts",
          "Complete pinned source export, Git-tree/LFS coverage and content integrity",
        ),
      ],
    });
  }
  if (!Array.isArray(gitSources.submodules) || !Array.isArray(factoryArch.sources.sources))
    throw new Error("Vendor Git owners and Arch source references are missing.");
  const archReferences = (factoryArch.sources.sources as ArchSourceReference[]).map(source => ({
    id: source.id,
    repository: source.repository,
    mount: source.mount,
    revision: source.revision,
    referenceRevision: source.referenceRevision ?? source.revision,
    checkoutRevision: source.checkoutRevision,
  }));
  const vendorIds = new Map<string, string>();
  for (const source of gitSources.submodules.filter(source => source.path.startsWith("vendor/"))) {
    if (
      !/^vendor\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(source.path) ||
      !source.revision ||
      !/^[a-f0-9]{40}$/.test(source.revision) ||
      typeof source.repository !== "string" ||
      !source.repository ||
      typeof source.initialized !== "boolean"
    )
      throw new Error("Invalid flat vendor Git owner.");
    const path = source.path;
    const key = path.toLowerCase();
    if (vendorIds.has(key)) throw new Error(`Duplicate vendor source owner: ${path}`);
    const id = `vendor:${source.path.slice("vendor/".length)}`;
    vendorIds.set(key, id);
    add({
      id,
      kind: "source",
      owner: source.repository,
      catalog: "Git index + .gitmodules",
      path,
      dependsOn: ["workspace:sources"],
      state: source.initialized ? "source-only" : "blocked",
      reasons: [
        source.initialized
          ? "Git metadata is present; checkout revision, worktree state and artifact qualification still need verification."
          : "Lazy source owner is registered but uninitialized; no checkout, fetch or build is started by this plan.",
      ],
      metadata: {
        pinnedRevision: source.revision,
        initialized: source.initialized,
        remotes: { declared: source.repository },
        sourceOnly: true,
        lazy: !source.initialized,
        references: archReferences.filter(reference => reference.mount === path),
      },
      requiredReceipts: [
        await receipt(
          "factory/source-export.ts + existing Git owner",
          "Exact checkout and reference revisions, complete Git/object/source closure, licenses and preserved worktree state",
        ),
      ],
    });
  }
  const archSourceOwners = [
    ...new Set(
      archReferences.map(source => {
        let declaration = gitSources.submodules.find(owner => owner.path === source.mount);
        if (!declaration) {
          const candidates = gitSources.submodules.filter(
            owner =>
              owner.path.startsWith("vendor/") &&
              owner.repository?.replace(/^(?:https?:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, "") ===
                source.repository,
          );
          if (candidates.length === 1) declaration = candidates[0];
        }
        const id = declaration && vendorIds.get(declaration.path.toLowerCase());
        if (!id || !declaration) {
          const missing = `source:unresolved-arch-${source.id}`;
          diagnostics.push(`Arch source has no indexed Git owner: ${source.mount}`);
          add({
            id: missing,
            kind: "source",
            owner: source.repository,
            catalog: "factory/arch/sources.json",
            path: source.mount,
            dependsOn: ["workspace:sources"],
            state: "blocked",
            reasons: ["The source contract has no unambiguous indexed Git owner."],
            metadata: { expectedRevision: source.revision },
          });
          return missing;
        }
        const node = nodes.find(node => node.id === id)!;
        if (declaration.path !== source.mount) {
          diagnostics.push(`Arch source mount requires reconciliation: ${source.mount} -> ${declaration.path}`);
          node.state = "blocked";
          node.reasons.push(`Factory mount ${source.mount} differs from the indexed owner ${declaration.path}.`);
          node.metadata = {
            ...node.metadata,
            references: [...((node.metadata?.references as ArchSourceReference[]) ?? []), source],
          };
        }
        if (declaration.revision !== source.revision) {
          diagnostics.push(`Arch source pin differs from indexed owner: ${source.id}`);
          node.state = "blocked";
          node.reasons.push(`Factory pin ${source.revision} differs from index pin ${declaration.revision}.`);
        }
        return id;
      }),
    ),
  ];
  const sourceIds = new Set(sources.repositories.map(source => source.id));
  const runtime = add({
    id: "toolchain:bun",
    kind: "toolchain",
    owner: "oven-sh/bun scripts/build.ts",
    catalog: "sources.lock.json + aphrody.config.json",
    dependsOn: sourceIds.has("bun") ? ["source:bun"] : [],
    state: "blocked",
    reasons: [
      "Select an eligible clean runtime checkout and target-specific immutable runtime receipt; development binaries do not qualify release pins.",
    ],
    requiredReceipts: [
      await receipt(
        "Bun runtime owner",
        "Native-runtime gate, exact source revision, target/ABI, executable hash and size",
      ),
    ],
    metadata: {
      source: sources.repositories.find(source => source.id === "bun"),
      releasePin:
        libraries.runtimeTargets?.[
          (options.target === "macos-arm64" ? "darwin-arm64" : options.target) as keyof NonNullable<
            LibraryConfig["runtimeTargets"]
          >
        ] ?? libraries.runtime,
      sdk: libraries.desktop.source,
    },
  });
  if (options.config?.checkouts?.bun) {
    runtime.command = {
      cwd: resolve(root, options.config.checkouts.bun),
      argv: [process.execPath, "bd", "--release"],
    };
  }
  add({
    id: "workspace:install",
    kind: "workspace",
    owner: "native Bun installer",
    catalog: "package.json + bun.lock + bunfig.toml",
    dependsOn: ["workspace:sources", "toolchain:bun"],
    state: "declared",
    command: {
      cwd: root,
      argv: [process.execPath, "install", "--frozen-lockfile"],
    },
    requiredReceipts: [
      await receipt(
        "scripts/node-modules.ts",
        "Frozen install with lock hash invariant and required isolated consumer projections",
      ),
    ],
  });
  add({
    id: "workspace:cargo",
    kind: "workspace",
    owner: "scripts/cargo.ts",
    catalog: "Cargo.toml + Cargo.lock + rust-toolchain.toml + .cargo/config.toml",
    dependsOn: ["workspace:sources", "toolchain:bun"],
    state: "declared",
    command: command("scripts/cargo.ts", ["metadata"]),
    reasons: ["Root membership does not prove migration of remaining nested source workspaces."],
  });

  const crateIds = new Map<string, string>();
  for (const member of cargo.workspace.members) {
    if (!/^crates\/[A-Za-z0-9._-]+$/.test(member)) {
      diagnostics.push(`Cargo member is not a flat product owner: ${member}`);
      continue;
    }
    const file = Bun.file(join(root, member, "Cargo.toml"));
    if (!(await file.exists())) {
      add({
        id: `cargo:${member}`,
        kind: "cargo",
        owner: member,
        catalog: "Cargo.toml",
        path: member,
        dependsOn: ["workspace:cargo"],
        state: "blocked",
        reasons: ["Declared Cargo manifest is missing."],
      });
      continue;
    }
    const manifest = Bun.TOML.parse(await file.text()) as {
      package?: { name?: string };
    };
    const name = manifest.package?.name;
    if (!name) throw new Error(`Cargo package identity missing: ${member}`);
    const id = `cargo:${name}`;
    crateIds.set(name, id);
    add({
      id,
      kind: "cargo",
      owner: "scripts/cargo.ts",
      catalog: "Cargo.toml",
      path: member,
      dependsOn: ["workspace:cargo"],
      state: "declared",
      command: command("scripts/cargo.ts", [
        "exec",
        "--",
        "build",
        "--locked",
        "--release",
        "--target",
        target.rust,
        "-p",
        name,
      ]),
      requiredReceipts: [
        await receipt(
          "scripts/cargo-build-proof.ts",
          "Exact target/features/source/toolchain and final artifact coverage",
          "build/vendor/cargo-build-receipt.json",
        ),
      ],
      metadata: {
        package: name,
        rustTarget: target.rust,
        profileFeatures: "No target/profile feature mapping has been qualified.",
      },
    });
  }

  const packageNodes = new Map<string, FactoryGraphNode>();
  const packageManifests = new Map<string, BunManifest>();
  for (const member of product.workspaces) {
    if (!/^(?:packages|apps)\/[A-Za-z0-9._-]+$/.test(member)) {
      diagnostics.push(`Bun member is not a flat product owner: ${member}`);
      continue;
    }
    if (!(await Bun.file(join(root, member, "package.json")).exists())) {
      add({
        id: `package:${member}`,
        kind: "package",
        owner: member,
        catalog: "package.json",
        path: member,
        dependsOn: ["workspace:install"],
        state: "blocked",
        reasons: ["Declared Bun manifest is missing."],
      });
      continue;
    }
    const manifest = await read<BunManifest>(`${member}/package.json`);
    if (!manifest.name) throw new Error(`Bun package identity missing: ${member}`);
    const build = manifest.scripts?.build;
    const node = add({
      id: `package:${manifest.name}`,
      kind: "package",
      owner: member,
      catalog: `${member}/package.json`,
      path: member,
      dependsOn: ["workspace:install"],
      state: build ? "declared" : "source-only",
      ...(build
        ? {
            command: {
              cwd: join(root, member),
              argv: [process.execPath, "run", "build"],
            },
          }
        : {}),
      reasons: build
        ? [
            "Uses the existing declared leaf build recipe; profile/target support and output receipt remain unqualified.",
          ]
        : ["No build script declared; source-only classification is not an execution qualification."],
      requiredReceipts: build
        ? [await receipt(member, "Build outputs, consumed input closure, target/profile and exact native gates")]
        : [],
      metadata: { name: manifest.name, script: build ?? null },
    });
    packageNodes.set(manifest.name, node);
    packageManifests.set(manifest.name, manifest);
  }
  for (const [name, manifest] of packageManifests) {
    const node = packageNodes.get(name)!;
    // Shared installation owns development tooling; it is not a production artifact edge.
    node.metadata = {
      ...node.metadata,
      developmentDependencies: Object.keys(manifest.devDependencies ?? {}).map(name => ({
        name,
        provider: packageNodes.get(name)?.id ?? null,
        owner: "workspace:install",
      })),
    };
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      const provider = packageNodes.get(dependency);
      if (provider && provider.id !== node.id) node.dependsOn.push(provider.id);
    }
  }
  const frontend = packageNodes.get("@frontend/source");
  if (frontend) {
    add({
      id: "frontend:artcraft",
      kind: "frontend",
      owner: "scripts/build-frontend.ts",
      catalog: "package.json scripts.frontend:build",
      path: frontend.path,
      dependsOn: [frontend.id],
      state: "declared",
      command: command("scripts/build-frontend.ts", ["build"]),
      requiredReceipts: [
        await receipt(
          "scripts/build-frontend.ts",
          "Compiled frontend source/lock/runtime and artifact tree; execution/deployment separate",
          "build/frontend/artcraft/build-receipt.json",
        ),
      ],
      reasons: ["Default output must be fresh. Source fingerprint does not yet bind the entire mutable input tree."],
    });
  }

  const capabilities = new Map(appCapabilities(libraries).map(capability => [capability.libraryId, capability.id]));
  for (const app of applications.apps) {
    const module = libraries.modules.find(module => module.id === app.id);
    const capability = module && capabilities.get(module.id);
    const crate = module?.cargoPackage && crateIds.get(module.cargoPackage);
    const reasons = [];
    if (!applications.targets.includes(options.target))
      reasons.push("Application inventory does not declare this target.");
    if (app.kind === "native-cli" && (!module?.binary || !capability))
      reasons.push("Native engine binary/capability owner is not declared.");
    if (app.kind === "native-cli" && !crate)
      reasons.push("Native engine still builds from its source workspace, outside the migrated root Cargo graph.");
    const commandArgs = capability
      ? [
          "scripts/build-apps.ts",
          "build",
          "--app",
          capability,
          "--target",
          `bun-${options.target.replace("macos-", "darwin-")}`,
        ]
      : ["infra/app-build.ts", "build", app.id, "--config", "infra/apps.json", "--target", options.target];
    add({
      id: `app:${app.id}`,
      kind: "app",
      owner: capability ? "scripts/build-apps.ts + @aphrody/bun-artifacts" : "infra/app-build.ts",
      catalog: "infra/apps.json + aphrody.config.json",
      path: app.entrypoint,
      dependsOn: ["toolchain:bun", "workspace:install", ...(crate ? [crate] : [])],
      state: "blocked",
      command: command(commandArgs[0]!, commandArgs.slice(1)),
      reasons: [
        ...reasons,
        "Explicit fresh output, qualified host/runtime, shared assets and native receipt inputs are still required.",
      ],
      requiredReceipts: [
        await receipt(
          "infra/app-build.ts",
          "Native source/ABI/runtime/payload/extraction and independent app behavior gates",
        ),
      ],
    });
  }

  for (const recipe of native.targets) {
    const source = sources.repositories.find(source => source.id === recipe.sourceId);
    add({
      id: `system:${recipe.id}`,
      kind: "system",
      owner: "factory/native-targets.ts",
      catalog: "factory/native-targets.json",
      dependsOn: source ? [`source:${source.id}`] : [],
      state: "blocked",
      reasons: [
        "Select explicit source, fresh output, toolchain inputs and admitted execution host.",
        ...(recipe.portRequired ? ["The source owner has not implemented the required native port."] : []),
        ...(source?.revision !== recipe.revision ? ["Recipe pin differs from source lock."] : []),
        ...recipe.unqualified,
      ],
      requiredReceipts: [
        await receipt(
          "factory/native-targets.ts",
          "Pinned source/toolchain/ABI artifact hashes; runtime qualification is a separate gate",
        ),
      ],
      metadata: {
        host: recipe.host,
        architecture: recipe.architecture,
        abi: recipe.abi,
        revision: recipe.revision,
      },
    });
  }
  const archNodeIds = new Map([
    ["arch:image", "image:composition"],
    ["arch:qualify", "qualification:product"],
  ]);
  const archId = (id: string): string => archNodeIds.get(id) ?? id;
  const archStages: Record<string, FactoryGraphNode["kind"]> = {
    "arch:sources": "source",
    "arch:resolve": "package",
    "arch:rootfs": "system",
    "arch:payload": "workspace",
  };
  for (const stage of factoryArch.graph) {
    const kind = archStages[stage.id];
    if (!kind) continue;
    add({
      id: stage.id,
      kind,
      owner: stage.owner,
      catalog: "factory/profile.json + factory/arch/index.ts",
      dependsOn: [
        ...stage.dependsOn.map(archId),
        ...(stage.id === "arch:sources" ? ["workspace:sources", ...archSourceOwners] : []),
        ...(stage.id === "arch:payload" ? ["toolchain:bun"] : []),
      ],
      state: "blocked",
      reasons: factoryArch.blockers,
      metadata: {
        packageManager: factoryArch.packageManager,
        snapshot: factoryArch.snapshot,
        requestedPackages: factoryArch.requestedPackages,
        releaseProfile: options.profile,
        composition,
        input: "inputs.factoryArch",
        ...(stage.id === "arch:sources" ? { sourceReferences: archReferences } : {}),
      },
      requiredReceipts: [
        await receipt(
          stage.owner,
          stage.id === "arch:resolve"
            ? "Exact package closure, authenticated repository snapshot, approved signing identities and lock digest"
            : stage.id === "arch:rootfs"
              ? "Verified package signatures/hashes, exact installed inventory and input-bound Arch rootfs receipt"
              : stage.id === "arch:payload"
                ? "Complete staged Bun source/runtime identity for the selected release profile"
                : "Pinned external source histories, recipe patches/licenses and source parity",
        ),
      ],
    });
  }
  add({
    id: "product:payload",
    kind: "package",
    owner: "factory/product-payload.ts prepareProductPayload",
    catalog: "root productPayload configuration + package.json + bun.lock",
    dependsOn: ["workspace:sources", "toolchain:bun"],
    state: "blocked",
    reasons: [
      "Select a fresh Linux factory output, complete pinned product source closure, shared install cache and source-bound generated inputs.",
    ],
    requiredReceipts: [
      await receipt(
        "factory/product-payload.ts",
        "Frozen installed product tree, permissions, source inventory, lock and selected runtime identity",
      ),
    ],
    metadata: {
      route: ["build", "product"],
      configured: Boolean(options.config?.productPayload),
      nativeCommandsQualified: false,
    },
  });
  add({
    id: "qualification:product-surfaces",
    kind: "qualification",
    owner: "factory/product-qualification.ts qualifyProductPayload",
    catalog: "product payload + product CLI qualification receipts",
    dependsOn: ["product:payload"],
    state: "blocked",
    reasons: [
      "Execute CLI discovery, route-target, CLI-WASM, native FFI gates on the matching Linux factory runtime. Remaining native commands and the full product retain separate qualification.",
    ],
    requiredReceipts: [
      await receipt(
        "factory/product-qualification.ts",
        "Passed product-cli, cli-wasm and ffi gates bound to installed bytes, permissions, runtime and source revision",
      ),
    ],
    metadata: {
      route: ["build", "product-qualify"],
      scope: "CLI discovery, CLI-WASM, native FFI",
    },
  });
  nodes.find(node => node.id === "arch:payload")?.dependsOn.push("qualification:product-surfaces");
  const imageStage = factoryArch.graph.find(stage => stage.id === "arch:image");
  add({
    id: "image:composition",
    kind: "image",
    owner: imageStage?.owner ?? "src/distribution.ts buildImage",
    catalog: "factory/profile.json + distribution.json + Arch package lock",
    dependsOn: [
      ...(imageStage?.dependsOn.map(archId) ?? ["arch:rootfs", "arch:payload"]),
      "toolchain:bun",
      "qualification:product-surfaces",
    ],
    state: "blocked",
    reasons: [
      "Arch rootfs and staged Bun payload must bind the exact package lock, source/runtime identity, target and selected composition.",
      "full/perf selects release/performance behavior; server/desktop/gaming selects installed OS capabilities and session.",
      ...factoryArch.blockers,
    ],
    metadata: {
      backend: "archlinux",
      packageManager: factoryArch.packageManager,
      releaseProfile: options.profile,
      composition,
      desktopSession: factoryArch.desktopSession,
      snapshot: factoryArch.snapshot,
      input: "inputs.factoryArch",
    },
    requiredReceipts: [
      await receipt(
        "factory/arch/pacman.ts",
        "Arch rootfs artifact hash, signed exact package inventory and lock digest",
      ),
      await receipt("src/cli.ts stage", "Complete staged source/runtime identity"),
      await receipt(
        "factory/product-qualification.ts",
        "CLI workspace identity and passed discovery bound to the staged product",
      ),
      await receipt(
        "src/cli.ts image",
        "Immutable image digest, in-rootfs CLI/WASM/FFI qualification and target/composition runtime smoke; boot/session remains separate",
      ),
    ],
  });
  add({
    id: "qualification:product",
    kind: "qualification",
    owner: "existing native/source/app/image validators",
    catalog: "factory/profile.json + distribution.json + existing receipt contracts",
    dependsOn: nodes
      .filter(node => ["cargo", "package", "frontend", "app", "system", "image"].includes(node.kind))
      .map(node => node.id),
    state: "blocked",
    reasons: [
      "No aggregate product qualification recipe binds all selected receipts yet. Declared sources/recipes are not passing gates.",
      "Validate the server headless boundary, selected COSMIC desktop or Gamescope gaming session independently of full/perf release settings.",
    ],
    requiredReceipts: [
      await receipt(
        "root distribution",
        "Input-bound target/release-profile/composition gate closure referencing existing receipt hashes",
      ),
    ],
  });
  add({
    id: "release:product",
    kind: "release",
    owner: "distribution staging + Aphrody Infra/edge publication",
    catalog: "infra/apps.json + tools/config/downloads.json",
    dependsOn: ["qualification:product"],
    state: "blocked",
    reasons: [
      "No unified distribution release recipe is declared. Imported release routes contain unresolved legacy/out-of-scope inputs; host activation remains Infra-owned.",
    ],
    requiredReceipts: [
      await receipt("infra/app-build.ts stageAppRelease", "Immutable artifact/notice hashes and qualified ABI/runtime"),
      await receipt("Aphrody Infra/edge", "Publication/catalog/channel readback and host-specific activation"),
    ],
  });

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate factory graph identity: ${node.id}`);
    ids.add(node.id);
    node.dependsOn = [...new Set(node.dependsOn)];
  }
  for (const node of nodes)
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Missing factory graph dependency: ${dependency}`);
    }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const cycles = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) {
      cycles.add(id);
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    active.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  if (cycles.size)
    diagnostics.push(`Declared member dependency cycles require owner review: ${[...cycles].sort().join(", ")}`);
  return {
    schemaVersion: 2,
    kind: "bun-os-factory-graph",
    root,
    target: options.target,
    profile: options.profile,
    composition,
    desktopSession: factoryArch.desktopSession,
    inputs: { factoryArch },
    executable: false,
    qualified: false,
    nodes,
    edges: nodes.flatMap(node => node.dependsOn.map(from => ({ from, to: node.id }))),
    diagnostics,
    limits: [
      "Read-only catalog graph; no child commands, builds, installs, tests or remote calls were executed.",
      "Commands identify existing owners; required inputs, host admission and immutable runtime provenance remain separate gates.",
      "Present receipts have not been validated against current inputs or artifact bytes.",
      "Dependency cycles and undeclared target/profile/feature support prevent claiming an executable DAG.",
      "External SDK/runtime workspace exceptions and remaining nested source consumers are not migrated by graph discovery.",
      "All source members remain inventoried; only an authenticated composition-specific package/feature closure can select actual image contents.",
      "Release/performance profile full/perf is independent of OS composition server/desktop/gaming.",
    ],
  };
}
